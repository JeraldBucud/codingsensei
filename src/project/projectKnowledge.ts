import { createHash } from "node:crypto";

import type { FrameworkDetection } from "../framework/models";
import type {
  LanguageAnalysis,
  LanguageDocumentInput,
  LanguageRelationship,
  LanguageSymbol
} from "../language/models";
import { normalizePath } from "./pathUtils";

export const projectKnowledgeSchemaVersion = 1 as const;

export interface PersistentFileKnowledge {
  readonly schemaVersion: typeof projectKnowledgeSchemaVersion;
  readonly projectId: string;
  readonly relativePath: string;
  readonly languageId: string;
  readonly contentHash: string;
  readonly indexedAt: string;
  readonly analysisSource: LanguageAnalysis["source"];
  readonly symbols: readonly LanguageSymbol[];
  readonly imports: readonly LanguageRelationship[];
  readonly relationships: readonly LanguageRelationship[];
  readonly entryPointSignals: readonly string[];
  readonly frameworks: readonly FrameworkDetection[];
  readonly truncated: boolean;
}

export function createPersistentFileKnowledge(input: {
  readonly projectId: string;
  readonly document: Pick<
    LanguageDocumentInput,
    "projectRelativePath" | "relativePath" | "fileName" | "languageId" | "text"
  >;
  readonly analysis: LanguageAnalysis;
  readonly frameworks: readonly FrameworkDetection[];
  readonly now?: () => Date;
}): PersistentFileKnowledge {
  const relativePath = normalizePath(
    input.document.projectRelativePath ?? input.document.relativePath ?? input.document.fileName
  );
  const now = input.now ?? (() => new Date());

  return {
    schemaVersion: projectKnowledgeSchemaVersion,
    projectId: input.projectId,
    relativePath,
    languageId: input.document.languageId,
    contentHash: hashContent(input.document.text),
    indexedAt: now().toISOString(),
    analysisSource: input.analysis.source,
    symbols: input.analysis.symbols.map((symbol) => ({ ...symbol })),
    imports: input.analysis.imports.map((relationship) => ({ ...relationship })),
    relationships: input.analysis.relationships.map((relationship) => ({ ...relationship })),
    entryPointSignals: [...input.analysis.entryPointSignals],
    frameworks: input.frameworks.map((framework) => ({
      ...framework,
      evidence: framework.evidence.map((evidence) => ({ ...evidence })),
      roles: [...framework.roles]
    })),
    truncated: input.analysis.truncated
  };
}

export function restoreLanguageAnalysisFromKnowledge(
  knowledge: PersistentFileKnowledge
): LanguageAnalysis {
  return {
    status: "partial",
    file: knowledge.relativePath,
    languageId: knowledge.languageId,
    source: knowledge.analysisSource,
    symbols: knowledge.symbols.map((symbol) => ({ ...symbol })),
    imports: knowledge.imports.map((relationship) => ({ ...relationship })),
    relationships: knowledge.relationships
      .filter((relationship) => !relationship.providerDerived)
      .map((relationship) => ({ ...relationship })),
    entryPointSignals: [...knowledge.entryPointSignals],
    truncated: knowledge.truncated,
    message: "Restored from persistent local project knowledge."
  };
}

export function projectKnowledgeKey(relativePath: string): string {
  return createHash("sha256").update(normalizePath(relativePath)).digest("hex");
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function serializePersistentFileKnowledge(knowledge: PersistentFileKnowledge): string {
  return `${JSON.stringify(knowledge, null, 2)}\n`;
}

export function parsePersistentFileKnowledge(content: string): PersistentFileKnowledge | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || parsed.schemaVersion !== projectKnowledgeSchemaVersion) {
    return undefined;
  }
  if (
    typeof parsed.projectId !== "string" ||
    typeof parsed.relativePath !== "string" ||
    typeof parsed.languageId !== "string" ||
    typeof parsed.contentHash !== "string" ||
    !/^[0-9a-f]{64}$/i.test(parsed.contentHash) ||
    typeof parsed.indexedAt !== "string" ||
    Number.isNaN(Date.parse(parsed.indexedAt)) ||
    !isAnalysisSource(parsed.analysisSource) ||
    typeof parsed.truncated !== "boolean"
  ) {
    return undefined;
  }
  if (
    !isLanguageSymbols(parsed.symbols) ||
    !isLanguageRelationships(parsed.imports) ||
    !isLanguageRelationships(parsed.relationships) ||
    !isStringArray(parsed.entryPointSignals) ||
    !isFrameworkDetections(parsed.frameworks)
  ) {
    return undefined;
  }

  return {
    schemaVersion: projectKnowledgeSchemaVersion,
    projectId: parsed.projectId,
    relativePath: parsed.relativePath,
    languageId: parsed.languageId,
    contentHash: parsed.contentHash,
    indexedAt: parsed.indexedAt,
    analysisSource: parsed.analysisSource,
    symbols: parsed.symbols,
    imports: parsed.imports,
    relationships: parsed.relationships,
    entryPointSignals: parsed.entryPointSignals,
    frameworks: parsed.frameworks,
    truncated: parsed.truncated
  };
}

function isAnalysisSource(value: unknown): value is LanguageAnalysis["source"] {
  return value === "vscode-provider" || value === "deterministic" || value === "unavailable";
}

function isLanguageSymbols(value: unknown): value is LanguageSymbol[] {
  const kinds = new Set<LanguageSymbol["kind"]>([
    "class",
    "interface",
    "function",
    "method",
    "constructor",
    "field",
    "property",
    "variable",
    "constant",
    "enum",
    "module",
    "unknown"
  ]);
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.name === "string" &&
        typeof item.kind === "string" &&
        kinds.has(item.kind as LanguageSymbol["kind"]) &&
        isCodeRange(item.range) &&
        isCodeRange(item.selectionRange) &&
        (item.containerName === undefined || typeof item.containerName === "string") &&
        (item.detail === undefined || typeof item.detail === "string")
    )
  );
}

function isLanguageRelationships(value: unknown): value is LanguageRelationship[] {
  const types = new Set<LanguageRelationship["type"]>([
    "import",
    "definition",
    "reference",
    "call",
    "contains",
    "renders",
    "route-handler",
    "service-dependency"
  ]);
  const confidence = new Set<LanguageRelationship["confidence"]>(["high", "medium", "low"]);
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.type === "string" &&
        types.has(item.type as LanguageRelationship["type"]) &&
        typeof item.target === "string" &&
        (item.targetFile === undefined || typeof item.targetFile === "string") &&
        (item.symbol === undefined || typeof item.symbol === "string") &&
        (item.sourceSymbol === undefined || typeof item.sourceSymbol === "string") &&
        (item.providerDerived === undefined || typeof item.providerDerived === "boolean") &&
        typeof item.confidence === "string" &&
        confidence.has(item.confidence as LanguageRelationship["confidence"]) &&
        typeof item.reason === "string"
    )
  );
}

function isFrameworkDetections(value: unknown): value is FrameworkDetection[] {
  const frameworks = new Set<FrameworkDetection["framework"]>([
    "react",
    "express",
    "django",
    "spring-boot"
  ]);
  const confidence = new Set<FrameworkDetection["confidence"]>(["high", "medium", "low"]);
  const evidenceSources = new Set<FrameworkDetection["evidence"][number]["source"]>([
    "metadata",
    "language",
    "text",
    "file-structure"
  ]);
  const roles = new Set<FrameworkDetection["roles"][number]>([
    "component",
    "hook",
    "router",
    "route-handler",
    "model",
    "view",
    "url-configuration",
    "controller",
    "service",
    "repository",
    "application-bootstrap"
  ]);

  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.framework === "string" &&
        frameworks.has(item.framework as FrameworkDetection["framework"]) &&
        typeof item.confidence === "string" &&
        confidence.has(item.confidence as FrameworkDetection["confidence"]) &&
        Array.isArray(item.evidence) &&
        item.evidence.every(
          (evidence) =>
            isRecord(evidence) &&
            typeof evidence.source === "string" &&
            evidenceSources.has(
              evidence.source as FrameworkDetection["evidence"][number]["source"]
            ) &&
            typeof evidence.description === "string"
        ) &&
        Array.isArray(item.roles) &&
        item.roles.every(
          (role) =>
            typeof role === "string" && roles.has(role as FrameworkDetection["roles"][number])
        )
    )
  );
}

function isCodeRange(value: unknown): value is LanguageSymbol["range"] {
  return (
    isRecord(value) &&
    typeof value.startLine === "number" &&
    typeof value.startCharacter === "number" &&
    typeof value.endLine === "number" &&
    typeof value.endCharacter === "number"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
