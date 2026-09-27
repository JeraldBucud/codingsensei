import type { CodeRange } from "../core/models";
import type { LanguageRelationship, LanguageSymbol } from "./models";

export function analyzeDeterministicStructure(input: {
  readonly text: string;
  readonly languageId: string;
  readonly fileName: string;
}): {
  readonly symbols: readonly LanguageSymbol[];
  readonly imports: readonly LanguageRelationship[];
  readonly relationships: readonly LanguageRelationship[];
  readonly entryPointSignals: readonly string[];
} {
  const lines = input.text.split(/\r?\n/);
  const symbols: LanguageSymbol[] = [];
  const imports: LanguageRelationship[] = [];
  const relationships: LanguageRelationship[] = [];
  const entryPointSignals: string[] = [];

  const relationshipContext = {
    jsx: isJsxDocument(input.languageId, input.fileName),
    java: input.languageId === "java" || /\.java$/i.test(input.fileName),
    python: input.languageId === "python" || /\.py$/i.test(input.fileName),
    javascriptFamily:
      ["javascript", "javascriptreact", "typescript", "typescriptreact"].includes(
        input.languageId
      ) || /\.(?:[cm]?[jt]sx?)$/i.test(input.fileName)
  };

  lines.forEach((line, index) => {
    collectImports(line, imports);
    collectSymbols(line, index, symbols, relationshipContext);
    collectRelationships(line, relationships, relationshipContext);
    if (/if\s*\(?(?:__name__\s*==\s*["']__main__["']|require\.main\s*===\s*module)\)?/.test(line)) {
      entryPointSignals.push("possible main/module entry point");
    }
    if (/public\s+static\s+void\s+main\s*\(/.test(line)) {
      entryPointSignals.push("Java main method");
    }
  });

  const extendedSymbols = extendSymbolRanges(symbols, lines);
  collectCallRelationships(lines, extendedSymbols, relationships);
  return { symbols: extendedSymbols, imports, relationships, entryPointSignals };
}

function collectImports(line: string, imports: LanguageRelationship[]): void {
  const patterns = [
    /import\s+.*?from\s+["']([^"']+)["']/,
    /import\s+["']([^"']+)["']/,
    /require\s*\(\s*["']([^"']+)["']\s*\)/,
    /from\s+([\w.]+)\s+import\s+(.+)/,
    /import\s+([\w.]+)/,
    /import\s+([\w.*]+);/
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (match?.[1]) {
      const target = match[1];
      imports.push({
        type: "import",
        target,
        targetFile: isLocalImport(target) ? target : undefined,
        confidence: isLocalImport(target) ? "high" : "medium",
        reason: isLocalImport(target)
          ? "The active file imports a local project module."
          : "The active file imports an external module or package."
      });
      return;
    }
  }
}

function collectSymbols(
  line: string,
  index: number,
  symbols: LanguageSymbol[],
  context: {
    readonly java: boolean;
    readonly python: boolean;
    readonly javascriptFamily: boolean;
  }
): void {
  const checks: Array<[RegExp, LanguageSymbol["kind"]]> = [
    [/\bclass\s+([A-Za-z_$][\w$]*)/, "class"],
    [/\binterface\s+([A-Za-z_$][\w$]*)/, "interface"]
  ];

  if (context.javascriptFamily) {
    checks.push(
      [/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/, "function"],
      [/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?[^=]*\)?\s*=>/, "function"],
      [
        /^\s*(?:(?:public|private|protected|static|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^={]+)?\s*\{/,
        "method"
      ]
    );
  }

  if (context.python) {
    checks.push([/\bdef\s+([A-Za-z_][\w]*)\s*\(/, "function"]);
  }

  if (context.java) {
    checks.push([
      /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?[A-Za-z_$][\w$<>[\], ?]*\s+([A-Za-z_$][\w$]*)\s*\(/,
      "method"
    ]);
  }

  const ignoredMethodNames = new Set(["if", "for", "while", "switch", "catch"]);
  for (const [pattern, kind] of checks) {
    const match = pattern.exec(line);
    if (match?.[1] && !(kind === "method" && ignoredMethodNames.has(match[1]))) {
      const name = match[1];
      symbols.push({
        name,
        kind: name === "constructor" ? "constructor" : kind,
        range: lineRange(index, line),
        selectionRange: lineRange(index, line)
      });
      return;
    }
  }
}

function collectRelationships(
  line: string,
  relationships: LanguageRelationship[],
  context: { readonly jsx: boolean; readonly java: boolean; readonly javascriptFamily: boolean }
): void {
  const renderMatch = context.jsx ? /<([A-Z][A-Za-z0-9_]*)\b/.exec(line) : undefined;
  if (renderMatch?.[1]) {
    relationships.push({
      type: "renders",
      target: renderMatch[1],
      symbol: renderMatch[1],
      confidence: "medium",
      reason: "A JSX element with a component-style name appears in the active file."
    });
  }
  const serviceMatch = context.java
    ? /(?:private|public|protected)?\s+(?:final\s+)?([A-Z][A-Za-z0-9_]*Service)\s+([a-z][A-Za-z0-9_]*)/.exec(
        line
      )
    : undefined;
  if (serviceMatch?.[1]) {
    relationships.push({
      type: "service-dependency",
      target: serviceMatch[1],
      symbol: serviceMatch[1],
      confidence: "medium",
      reason: "A service-typed field or dependency appears in the active file."
    });
  }
  const routeMatch = context.javascriptFamily
    ? /\b(?:app|router)\.(get|post|put|delete|patch|use)\s*\(/.exec(line)
    : undefined;
  if (routeMatch?.[1]) {
    relationships.push({
      type: "route-handler",
      target: `${routeMatch[1].toUpperCase()} route`,
      confidence: "medium",
      reason: "The active file declares an Express-style route."
    });
  }
}

function collectCallRelationships(
  lines: readonly string[],
  symbols: readonly LanguageSymbol[],
  relationships: LanguageRelationship[]
): void {
  const callableKinds = new Set<LanguageSymbol["kind"]>(["function", "method", "constructor"]);
  const ignoredCalls = new Set([
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "function",
    "def",
    "return",
    "typeof",
    "new",
    "super",
    "this",
    "class",
    "interface"
  ]);
  const seen = new Set<string>();

  for (const source of symbols) {
    if (!callableKinds.has(source.kind)) {
      continue;
    }

    const endLine = Math.min(source.range.endLine, source.range.startLine + 500);
    for (let lineNumber = source.range.startLine; lineNumber <= endLine; lineNumber += 1) {
      const line = lines[lineNumber] ?? "";
      const memberCalls = /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g;
      let memberMatch: RegExpExecArray | null;
      while ((memberMatch = memberCalls.exec(line)) !== null) {
        const qualifier = memberMatch[1];
        const target = memberMatch[2];
        if (qualifier && target) {
          addCallRelationship(
            source,
            target,
            qualifier,
            ignoredCalls,
            seen,
            relationships
          );
        }
      }

      const plainCalls = /\b([A-Za-z_$][\w$]*)\s*\(/g;
      let plainMatch: RegExpExecArray | null;
      while ((plainMatch = plainCalls.exec(line)) !== null) {
        const target = plainMatch[1];
        const previousCharacter = plainMatch.index > 0 ? line[plainMatch.index - 1] : "";
        if (!target || previousCharacter === ".") {
          continue;
        }
        if (lineNumber === source.range.startLine && target === source.name) {
          continue;
        }
        addCallRelationship(source, target, undefined, ignoredCalls, seen, relationships);
      }
    }
  }
}

function addCallRelationship(
  source: LanguageSymbol,
  target: string,
  qualifier: string | undefined,
  ignoredCalls: ReadonlySet<string>,
  seen: Set<string>,
  relationships: LanguageRelationship[]
): void {
  if (ignoredCalls.has(target) || target === source.name) {
    return;
  }
  const key = `${source.name}->${qualifier ? `${qualifier}.` : ""}${target}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  relationships.push({
    type: "call",
    target,
    symbol: target,
    sourceSymbol: source.name,
    qualifier,
    confidence: "medium",
    reason: `The symbol ${source.name} calls ${qualifier ? `${qualifier}.` : ""}${target}.`
  });
}

function isJsxDocument(languageId: string, fileName: string): boolean {
  return (
    languageId === "javascriptreact" ||
    languageId === "typescriptreact" ||
    /\.(?:jsx|tsx)$/i.test(fileName)
  );
}

function lineRange(line: number, text: string): CodeRange {
  return { startLine: line, startCharacter: 0, endLine: line, endCharacter: text.length };
}

function extendSymbolRanges(
  symbols: readonly LanguageSymbol[],
  lines: readonly string[]
): readonly LanguageSymbol[] {
  return symbols.map((symbol) => ({
    ...symbol,
    range: estimateBlockRange(symbol.range.startLine, lines) ?? symbol.range
  }));
}

function estimateBlockRange(startLine: number, lines: readonly string[]): CodeRange | undefined {
  const braceRange = estimateBraceRange(startLine, lines);
  if (braceRange) {
    return braceRange;
  }
  return estimateIndentRange(startLine, lines);
}

function estimateBraceRange(startLine: number, lines: readonly string[]): CodeRange | undefined {
  let depth = 0;
  let started = false;
  for (
    let lineNumber = startLine;
    lineNumber < Math.min(lines.length, startLine + 500);
    lineNumber += 1
  ) {
    const line = lines[lineNumber] ?? "";
    for (const character of line) {
      if (character === "{") {
        depth += 1;
        started = true;
      } else if (character === "}") {
        depth -= 1;
        if (started && depth <= 0) {
          return {
            startLine,
            startCharacter: 0,
            endLine: lineNumber,
            endCharacter: line.length
          };
        }
      }
    }
  }
  return undefined;
}

function estimateIndentRange(startLine: number, lines: readonly string[]): CodeRange | undefined {
  const declaration = lines[startLine];
  if (!declaration?.trim().endsWith(":")) {
    return undefined;
  }
  const baseIndent = leadingSpaces(declaration);
  let endLine = startLine;
  for (
    let lineNumber = startLine + 1;
    lineNumber < Math.min(lines.length, startLine + 500);
    lineNumber += 1
  ) {
    const line = lines[lineNumber] ?? "";
    if (!line.trim()) {
      continue;
    }
    if (leadingSpaces(line) <= baseIndent) {
      break;
    }
    endLine = lineNumber;
  }
  return endLine > startLine
    ? {
        startLine,
        startCharacter: 0,
        endLine,
        endCharacter: lines[endLine]?.length ?? 0
      }
    : undefined;
}

function leadingSpaces(value: string): number {
  return value.length - value.trimStart().length;
}

function isLocalImport(target: string): boolean {
  return target.startsWith(".") || target.startsWith("/");
}
