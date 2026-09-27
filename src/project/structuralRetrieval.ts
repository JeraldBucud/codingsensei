import { fileName, normalizePath } from "./pathUtils";
import type {
  StructuralEdge,
  StructuralGraph,
  StructuralSymbolNode
} from "./structuralGraph";

export interface StructuralRetrievalItem {
  readonly file: string;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly matchedSymbols: readonly string[];
  readonly line?: number;
}

interface MutableRetrievalScore {
  score: number;
  readonly reasons: Set<string>;
  readonly matchedSymbols: Set<string>;
  line?: number;
}

export interface StructuralRetrievalOptions {
  readonly activeFile?: string;
  readonly query?: string;
  readonly limit?: number;
}

export function retrieveStructuralContext(
  graph: StructuralGraph,
  options: StructuralRetrievalOptions
): readonly StructuralRetrievalItem[] {
  const limit = Math.max(1, Math.min(options.limit ?? 8, 20));
  const activeFile = options.activeFile ? normalizePath(options.activeFile) : undefined;
  const tokens = tokenize(options.query ?? "");
  const scores = new Map<string, MutableRetrievalScore>();

  for (const node of graph.nodes) {
    if (node.kind === "file") {
      scores.set(node.file, {
        score: 0,
        reasons: new Set(),
        matchedSymbols: new Set()
      });
    }
  }

  if (activeFile) {
    scoreStructuralNeighbors(graph, activeFile, scores);
  }

  if (tokens.length > 0) {
    scoreQueryMatches(graph, tokens, scores);
  }

  return [...scores.entries()]
    .filter(([file, value]) => value.score > 0 && file !== activeFile)
    .map(([file, value]) => ({
      file,
      score: value.score,
      reasons: [...value.reasons],
      matchedSymbols: [...value.matchedSymbols].sort(),
      line: value.line
    }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, limit);
}

function scoreStructuralNeighbors(
  graph: StructuralGraph,
  activeFile: string,
  scores: Map<string, MutableRetrievalScore>
): void {
  for (const edge of graph.edges) {
    if (!edge.toFile || edge.type === "contains") {
      continue;
    }

    if (edge.fromFile === activeFile) {
      addScore(scores, edge.toFile, edgeWeight(edge), relationshipReason(edge, "outgoing"));
    } else if (edge.toFile === activeFile) {
      addScore(
        scores,
        edge.fromFile,
        Math.max(1, edgeWeight(edge) - 1),
        relationshipReason(edge, "incoming")
      );
    }
  }
}

function scoreQueryMatches(
  graph: StructuralGraph,
  tokens: readonly string[],
  scores: Map<string, MutableRetrievalScore>
): void {
  const symbolsByFile = new Map<string, StructuralSymbolNode[]>();
  for (const node of graph.nodes) {
    if (node.kind !== "symbol") {
      continue;
    }
    const list = symbolsByFile.get(node.file) ?? [];
    list.push(node);
    symbolsByFile.set(node.file, list);
  }

  for (const [file, value] of scores) {
    const normalizedFile = file.toLowerCase();
    const basename = fileName(file).toLowerCase();

    for (const token of tokens) {
      if (basename === token || basename.startsWith(`${token}.`)) {
        value.score += 7;
        value.reasons.add(`file name matches "${token}"`);
      } else if (normalizedFile.includes(token)) {
        value.score += 3;
        value.reasons.add(`file path matches "${token}"`);
      }

      for (const symbol of symbolsByFile.get(file) ?? []) {
        const symbolName = symbol.name.toLowerCase();
        if (symbolName === token) {
          value.score += 10;
          value.reasons.add(`symbol matches "${token}"`);
          value.matchedSymbols.add(symbol.name);
          value.line ??= symbol.line;
        } else if (symbolName.includes(token) || token.includes(symbolName)) {
          value.score += 5;
          value.reasons.add(`symbol relates to "${token}"`);
          value.matchedSymbols.add(symbol.name);
          value.line ??= symbol.line;
        }
      }
    }
  }
}

function addScore(
  scores: Map<string, MutableRetrievalScore>,
  file: string,
  amount: number,
  reason: string
): void {
  const normalized = normalizePath(file);
  const value = scores.get(normalized);
  if (!value) {
    return;
  }
  value.score += amount;
  value.reasons.add(reason);
}

function edgeWeight(edge: StructuralEdge): number {
  const confidenceBonus = edge.confidence === "high" ? 2 : edge.confidence === "medium" ? 1 : 0;
  switch (edge.type) {
    case "calls":
      return 9 + confidenceBonus;
    case "imports":
    case "renders":
    case "service-dependency":
      return 8 + confidenceBonus;
    case "definition":
    case "reference":
      return 7 + confidenceBonus;
    case "related-test":
      return 6 + confidenceBonus;
    case "contains":
      return 0;
  }
}

function relationshipReason(edge: StructuralEdge, direction: "incoming" | "outgoing"): string {
  const label =
    edge.type === "related-test" ? "source/test relationship" : edge.type.replace("-", " ");
  return direction === "outgoing"
    ? `direct ${label} from the active file`
    : `direct ${label} into the active file`;
}

function tokenize(query: string): readonly string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9_$.-]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    )
  ];
}
