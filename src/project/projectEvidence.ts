import { analyzeArchitecture, type ArchitectureRole } from "./architectureInsights";
import { normalizePath } from "./pathUtils";
import { retrieveStructuralContext } from "./structuralRetrieval";
import type { StructuralEdgeType, StructuralGraph, StructuralSymbolNode } from "./structuralGraph";

export interface ProjectEvidenceFile {
  readonly file: string;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly roles: readonly ArchitectureRole[];
  readonly frameworks: readonly string[];
}

export interface ProjectEvidenceSymbol {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly kind: StructuralSymbolNode["symbolKind"];
}

export interface ProjectEvidenceRelationship {
  readonly type: StructuralEdgeType;
  readonly fromFile: string;
  readonly toFile: string;
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
}

export interface ProjectEvidencePackage {
  readonly projectId: string;
  readonly query: string;
  readonly activeFile?: string;
  readonly files: readonly ProjectEvidenceFile[];
  readonly symbols: readonly ProjectEvidenceSymbol[];
  readonly relationships: readonly ProjectEvidenceRelationship[];
  readonly likelyEntryFiles: readonly string[];
  readonly coverage: {
    readonly indexedFiles: number;
    readonly totalFiles: number;
  };
}

export function buildProjectEvidencePackage(input: {
  readonly graph: StructuralGraph;
  readonly query: string;
  readonly activeFile?: string;
  readonly limit?: number;
}): ProjectEvidencePackage {
  const activeFile = input.activeFile ? normalizePath(input.activeFile) : undefined;
  const results = retrieveStructuralContext(input.graph, {
    activeFile,
    query: input.query,
    limit: input.limit ?? 8
  });
  const architecture = analyzeArchitecture(input.graph);
  const architectureByFile = new Map(architecture.files.map((insight) => [insight.file, insight]));

  const files = results.map((result): ProjectEvidenceFile => {
    const architectureInsight = architectureByFile.get(result.file);
    return {
      file: result.file,
      score: result.score,
      reasons: [...result.reasons],
      roles: [...(architectureInsight?.roles ?? [])],
      frameworks: [...(architectureInsight?.frameworks ?? [])]
    };
  });

  const selectedFiles = new Set(files.map((file) => file.file));
  if (activeFile) {
    selectedFiles.add(activeFile);
  }

  const matchedSymbols = new Map(
    results.map((result) => [result.file, new Set(result.matchedSymbols)])
  );
  const symbols = input.graph.nodes
    .filter((node): node is StructuralSymbolNode => node.kind === "symbol")
    .filter((node) => {
      const matches = matchedSymbols.get(node.file);
      return matches?.has(node.name) ?? false;
    })
    .map((node): ProjectEvidenceSymbol => ({
      file: node.file,
      line: node.line,
      name: node.name,
      kind: node.symbolKind
    }))
    .sort(
      (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name)
    );

  const relationships = input.graph.edges
    .filter(
      (edge) =>
        edge.toFile !== undefined &&
        edge.type !== "contains" &&
        selectedFiles.has(edge.fromFile) &&
        selectedFiles.has(edge.toFile)
    )
    .map((edge): ProjectEvidenceRelationship => ({
      type: edge.type,
      fromFile: edge.fromFile,
      toFile: edge.toFile!,
      confidence: edge.confidence,
      reason: edge.reason
    }))
    .sort(
      (a, b) =>
        a.fromFile.localeCompare(b.fromFile) ||
        a.toFile.localeCompare(b.toFile) ||
        a.type.localeCompare(b.type)
    );

  return {
    projectId: input.graph.projectId,
    query: input.query,
    activeFile,
    files,
    symbols,
    relationships,
    likelyEntryFiles: architecture.entryFiles.filter((file) => selectedFiles.has(file)),
    coverage: {
      indexedFiles: input.graph.indexedFileCount,
      totalFiles: input.graph.totalFileCount
    }
  };
}
