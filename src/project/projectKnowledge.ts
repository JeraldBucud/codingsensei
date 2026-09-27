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
    typeof parsed.indexedAt !== "string" ||
    typeof parsed.analysisSource !== "string" ||
    typeof parsed.truncated !== "boolean"
  ) {
    return undefined;
  }
  if (
    !Array.isArray(parsed.symbols) ||
    !Array.isArray(parsed.imports) ||
    !Array.isArray(parsed.relationships) ||
    !isStringArray(parsed.entryPointSignals) ||
    !Array.isArray(parsed.frameworks)
  ) {
    return undefined;
  }

  return parsed as unknown as PersistentFileKnowledge;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
