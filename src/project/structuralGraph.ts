import type { FrameworkDetection } from "../framework/models";
import type { LanguageRelationship, LanguageSymbol } from "../language/models";
import type { PersistentProjectCatalog } from "./projectCatalog";
import type { PersistentFileKnowledge } from "./projectKnowledge";
import { normalizePath } from "./pathUtils";
import { findRelatedFiles, isLikelyTestPath } from "./sourceTestRelations";

export type StructuralNodeKind = "file" | "symbol";
export type StructuralEdgeType =
  | "contains"
  | "imports"
  | "renders"
  | "service-dependency"
  | "definition"
  | "reference"
  | "calls"
  | "related-test";

export interface StructuralFileNode {
  readonly id: string;
  readonly kind: "file";
  readonly file: string;
  readonly languageId?: string;
  readonly frameworks?: readonly FrameworkDetection["framework"][];
  readonly frameworkRoles?: readonly FrameworkDetection["roles"][number][];
  readonly entryPointSignals?: readonly string[];
}

export interface StructuralSymbolNode {
  readonly id: string;
  readonly kind: "symbol";
  readonly file: string;
  readonly name: string;
  readonly symbolKind: LanguageSymbol["kind"];
  readonly line: number;
  readonly containerName?: string;
}

export type StructuralNode = StructuralFileNode | StructuralSymbolNode;

export interface StructuralEdge {
  readonly id: string;
  readonly type: StructuralEdgeType;
  readonly from: string;
  readonly to: string;
  readonly fromFile: string;
  readonly toFile?: string;
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
}

export interface StructuralGraph {
  readonly projectId: string;
  readonly nodes: readonly StructuralNode[];
  readonly edges: readonly StructuralEdge[];
  readonly totalFileCount: number;
  readonly indexedFileCount: number;
  readonly fileCount: number;
  readonly symbolCount: number;
  readonly relationshipCount: number;
}

export function buildStructuralGraph(input: {
  readonly catalog: PersistentProjectCatalog;
  readonly knowledge: readonly PersistentFileKnowledge[];
}): StructuralGraph {
  const codeFiles = [...new Set(input.catalog.codeFiles.map(normalizePath))].sort();
  const knownFiles = new Set(codeFiles);
  const knowledgeByFile = new Map<string, PersistentFileKnowledge>();
  for (const record of input.knowledge) {
    const file = normalizePath(record.relativePath);
    if (knownFiles.has(file) && !knowledgeByFile.has(file)) {
      knowledgeByFile.set(file, record);
    }
  }

  const nodes: StructuralNode[] = codeFiles.map((file) => {
    const record = knowledgeByFile.get(file);
    return {
      id: fileNodeId(file),
      kind: "file",
      file,
      languageId: record?.languageId,
      frameworks: unique(record?.frameworks.map((framework) => framework.framework) ?? []),
      frameworkRoles: unique(record?.frameworks.flatMap((framework) => framework.roles) ?? []),
      entryPointSignals: [...(record?.entryPointSignals ?? [])]
    };
  });
  const edges = new Map<string, StructuralEdge>();
  const indexedFiles = new Set(knowledgeByFile.keys());
  const symbolOwners = new Map<string, Set<string>>();

  for (const record of knowledgeByFile.values()) {
    const file = normalizePath(record.relativePath);

    for (const symbol of record.symbols) {
      const node = toSymbolNode(file, symbol);
      nodes.push(node);
      const owners = symbolOwners.get(symbol.name) ?? new Set<string>();
      owners.add(file);
      symbolOwners.set(symbol.name, owners);
      addEdge(edges, {
        id: edgeId("contains", fileNodeId(file), node.id),
        type: "contains",
        from: fileNodeId(file),
        to: node.id,
        fromFile: file,
        confidence: "high",
        reason: "The symbol is declared in this file."
      });
    }

  }

  for (const record of knowledgeByFile.values()) {
    const file = normalizePath(record.relativePath);
    for (const relationship of [...record.imports, ...record.relationships]) {
      addRelationshipEdge(edges, relationship, file, knownFiles, symbolOwners);
    }
  }

  for (const file of codeFiles) {
    for (const related of findRelatedFiles(file, codeFiles)) {
      if (!related.exists || related.relationship === "suggested-test") {
        continue;
      }

      const target = normalizePath(related.path);
      if (!knownFiles.has(target) || target === file) {
        continue;
      }

      const sourceFile = isLikelyTestPath(file) ? target : file;
      const testFile = isLikelyTestPath(file) ? file : target;
      if (sourceFile === testFile || !isLikelyTestPath(testFile)) {
        continue;
      }

      const from = fileNodeId(sourceFile);
      const to = fileNodeId(testFile);
      addEdge(edges, {
        id: edgeId("related-test", from, to),
        type: "related-test",
        from,
        to,
        fromFile: sourceFile,
        toFile: testFile,
        confidence: related.confidence === "high" ? "high" : "medium",
        reason: related.reason
      });
    }
  }

  const orderedNodes = [...nodes].sort(compareNodes);
  const orderedEdges = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  const symbolCount = orderedNodes.filter((node) => node.kind === "symbol").length;
  const relationshipCount = orderedEdges.filter((edge) => edge.type !== "contains").length;

  return {
    projectId: input.catalog.projectId,
    nodes: orderedNodes,
    edges: orderedEdges,
    totalFileCount: codeFiles.length,
    indexedFileCount: indexedFiles.size,
    fileCount: codeFiles.length,
    symbolCount,
    relationshipCount
  };
}

export function fileNodeId(file: string): string {
  return `file:${normalizePath(file)}`;
}

function toSymbolNode(file: string, symbol: LanguageSymbol): StructuralSymbolNode {
  const normalizedFile = normalizePath(file);
  return {
    id: symbolNodeId(normalizedFile, symbol),
    kind: "symbol",
    file: normalizedFile,
    name: symbol.name,
    symbolKind: symbol.kind,
    line: symbol.selectionRange.startLine,
    containerName: symbol.containerName
  };
}

function symbolNodeId(file: string, symbol: LanguageSymbol): string {
  return [
    "symbol",
    normalizePath(file),
    String(symbol.selectionRange.startLine),
    String(symbol.selectionRange.startCharacter),
    symbol.kind,
    symbol.name
  ].join(":");
}

function addRelationshipEdge(
  edges: Map<string, StructuralEdge>,
  relationship: LanguageRelationship,
  sourceFile: string,
  knownFiles: ReadonlySet<string>,
  symbolOwners: ReadonlyMap<string, ReadonlySet<string>>
): void {
  if (relationship.providerDerived) {
    return;
  }

  const targetFile = relationship.targetFile
    ? normalizePath(relationship.targetFile)
    : relationship.type === "call" && relationship.symbol
      ? uniqueSymbolOwner(relationship.symbol, sourceFile, symbolOwners)
      : undefined;
  if (!targetFile || !knownFiles.has(targetFile) || targetFile === sourceFile) {
    return;
  }

  const type = edgeTypeForRelationship(relationship);
  if (!type) {
    return;
  }

  const from = fileNodeId(sourceFile);
  const to = fileNodeId(targetFile);
  addEdge(edges, {
    id: edgeId(type, from, to),
    type,
    from,
    to,
    fromFile: sourceFile,
    toFile: targetFile,
    confidence: relationship.confidence,
    reason: relationship.reason
  });
}

function edgeTypeForRelationship(
  relationship: LanguageRelationship
): StructuralEdgeType | undefined {
  switch (relationship.type) {
    case "import":
      return "imports";
    case "renders":
      return "renders";
    case "service-dependency":
      return "service-dependency";
    case "definition":
      return "definition";
    case "reference":
      return "reference";
    case "call":
      return "calls";
    default:
      return undefined;
  }
}

function uniqueSymbolOwner(
  symbol: string,
  sourceFile: string,
  symbolOwners: ReadonlyMap<string, ReadonlySet<string>>
): string | undefined {
  const owners = [...(symbolOwners.get(symbol) ?? [])].filter((file) => file !== sourceFile);
  return owners.length === 1 ? owners[0] : undefined;
}

function addEdge(edges: Map<string, StructuralEdge>, edge: StructuralEdge): void {
  if (!edges.has(edge.id)) {
    edges.set(edge.id, edge);
  }
}

function edgeId(type: StructuralEdgeType, from: string, to: string): string {
  return `${type}:${from}->${to}`;
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function compareNodes(a: StructuralNode, b: StructuralNode): number {
  if (a.kind !== b.kind) {
    return a.kind === "file" ? -1 : 1;
  }
  return a.id.localeCompare(b.id);
}
