import { dirname, fileName, normalizePath, withoutExtension } from "./pathUtils";
import { isLikelyTestPath } from "./sourceTestRelations";
import type {
  StructuralEdge,
  StructuralEdgeType,
  StructuralFileNode,
  StructuralGraph
} from "./structuralGraph";

export type ArchitectureRole =
  | "ui"
  | "routing"
  | "service"
  | "data"
  | "test"
  | "bootstrap"
  | "other";

export interface ArchitectureFileInsight {
  readonly file: string;
  readonly roles: readonly ArchitectureRole[];
  readonly frameworks: readonly string[];
  readonly inboundRelationshipCount: number;
  readonly outboundRelationshipCount: number;
}

export interface ArchitectureCluster {
  readonly id: string;
  readonly label: string;
  readonly files: readonly string[];
  readonly roles: readonly ArchitectureRole[];
  readonly frameworks: readonly string[];
}

export interface ArchitectureInsights {
  readonly files: readonly ArchitectureFileInsight[];
  readonly clusters: readonly ArchitectureCluster[];
  readonly entryFiles: readonly string[];
  readonly roleCounts: Readonly<Record<ArchitectureRole, number>>;
  readonly edgeCounts: Readonly<Partial<Record<StructuralEdgeType, number>>>;
}

export function analyzeArchitecture(graph: StructuralGraph): ArchitectureInsights {
  const fileNodes = graph.nodes.filter(
    (node): node is StructuralFileNode => node.kind === "file"
  );
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  const edgeCounts: Partial<Record<StructuralEdgeType, number>> = {};

  for (const node of fileNodes) {
    inbound.set(node.file, 0);
    outbound.set(node.file, 0);
    adjacency.set(node.file, new Set());
  }

  for (const edge of graph.edges) {
    edgeCounts[edge.type] = (edgeCounts[edge.type] ?? 0) + 1;
    if (!edge.toFile || edge.type === "contains") {
      continue;
    }

    outbound.set(edge.fromFile, (outbound.get(edge.fromFile) ?? 0) + 1);
    inbound.set(edge.toFile, (inbound.get(edge.toFile) ?? 0) + 1);
    adjacency.get(edge.fromFile)?.add(edge.toFile);
    adjacency.get(edge.toFile)?.add(edge.fromFile);
  }

  const files = fileNodes
    .map((node) => ({
      file: node.file,
      roles: classifyFile(node),
      frameworks: [...(node.frameworks ?? [])].sort(),
      inboundRelationshipCount: inbound.get(node.file) ?? 0,
      outboundRelationshipCount: outbound.get(node.file) ?? 0
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

  const fileInsightByPath = new Map(files.map((insight) => [insight.file, insight]));
  const roleCounts = emptyRoleCounts();
  for (const insight of files) {
    for (const role of insight.roles) {
      roleCounts[role] += 1;
    }
  }

  const clusters = connectedComponents(fileNodes.map((node) => node.file), adjacency)
    .map((clusterFiles, index) =>
      buildCluster(index, clusterFiles, fileInsightByPath)
    )
    .sort(
      (a, b) =>
        b.files.length - a.files.length ||
        a.label.localeCompare(b.label) ||
        a.id.localeCompare(b.id)
    );

  const entryFiles = files
    .filter(
      (insight) =>
        insight.roles.includes("bootstrap") ||
        (!insight.roles.includes("test") &&
          insight.inboundRelationshipCount === 0 &&
          insight.outboundRelationshipCount > 0)
    )
    .map((insight) => insight.file);

  return {
    files,
    clusters,
    entryFiles,
    roleCounts,
    edgeCounts
  };
}

function classifyFile(node: StructuralFileNode): readonly ArchitectureRole[] {
  const roles = new Set<ArchitectureRole>();
  const file = normalizePath(node.file);
  const frameworks = new Set(node.frameworks ?? []);

  if (isLikelyTestPath(file)) {
    roles.add("test");
  }

  for (const role of node.frameworkRoles ?? []) {
    switch (role) {
      case "component":
      case "hook":
        roles.add("ui");
        break;
      case "view":
        roles.add(frameworks.has("django") ? "routing" : "ui");
        break;
      case "router":
      case "route-handler":
      case "url-configuration":
      case "controller":
        roles.add("routing");
        break;
      case "service":
        roles.add("service");
        break;
      case "model":
      case "repository":
        roles.add("data");
        break;
      case "application-bootstrap":
        roles.add("bootstrap");
        break;
    }
  }

  if ((node.entryPointSignals?.length ?? 0) > 0) {
    roles.add("bootstrap");
  }

  const lower = file.toLowerCase();
  if (/(^|\/)(components?|pages?|ui)(\/|$)/.test(lower)) {
    roles.add("ui");
  }
  if (/(^|\/)(routes?|routers?|controllers?|api)(\/|$)/.test(lower)) {
    roles.add("routing");
  }
  if (/(^|\/)(services?)(\/|$)/.test(lower)) {
    roles.add("service");
  }
  if (/(^|\/)(models?|repositories?|data)(\/|$)/.test(lower)) {
    roles.add("data");
  }

  if (roles.size === 0) {
    roles.add("other");
  }
  return [...roles].sort(roleRank);
}

function connectedComponents(
  files: readonly string[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>
): readonly (readonly string[])[] {
  const unseen = new Set(files);
  const components: string[][] = [];

  for (const start of [...files].sort()) {
    if (!unseen.has(start)) {
      continue;
    }

    const component: string[] = [];
    const queue = [start];
    unseen.delete(start);
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      component.push(current);

      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (unseen.delete(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
    components.push(component.sort());
  }

  return components;
}

function buildCluster(
  index: number,
  files: readonly string[],
  insightByFile: ReadonlyMap<string, ArchitectureFileInsight>
): ArchitectureCluster {
  const roles = new Set<ArchitectureRole>();
  const frameworks = new Set<string>();

  for (const file of files) {
    const insight = insightByFile.get(file);
    for (const role of insight?.roles ?? []) {
      roles.add(role);
    }
    for (const framework of insight?.frameworks ?? []) {
      frameworks.add(framework);
    }
  }

  return {
    id: `cluster-${String(index + 1)}`,
    label: clusterLabel(files, [...roles]),
    files: [...files],
    roles: [...roles].sort(roleRank),
    frameworks: [...frameworks].sort()
  };
}

function clusterLabel(files: readonly string[], roles: readonly ArchitectureRole[]): string {
  const directory = commonMeaningfulDirectory(files);
  if (directory) {
    return humanize(directory);
  }

  const rankedRole = roles.find((role) => role !== "test" && role !== "other");
  if (rankedRole) {
    return `${humanize(rankedRole)} cluster`;
  }

  const first = files[0];
  return first ? `${humanize(withoutExtension(fileName(first)))} cluster` : "Project cluster";
}

function commonMeaningfulDirectory(files: readonly string[]): string | undefined {
  if (files.length === 0) {
    return undefined;
  }

  const directories = files.map((file) => dirname(normalizePath(file)).split("/").filter(Boolean));
  const shortest = Math.min(...directories.map((parts) => parts.length));
  const shared: string[] = [];

  for (let index = 0; index < shortest; index += 1) {
    const value = directories[0]?.[index];
    if (!value || directories.some((parts) => parts[index] !== value)) {
      break;
    }
    shared.push(value);
  }

  const generic = new Set(["src", "app", "lib", "source", "main"]);
  return [...shared].reverse().find((part) => !generic.has(part.toLowerCase()));
}

function humanize(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function roleRank(a: ArchitectureRole, b: ArchitectureRole): number {
  const order: ArchitectureRole[] = [
    "bootstrap",
    "routing",
    "service",
    "data",
    "ui",
    "test",
    "other"
  ];
  return order.indexOf(a) - order.indexOf(b);
}

function emptyRoleCounts(): Record<ArchitectureRole, number> {
  return {
    ui: 0,
    routing: 0,
    service: 0,
    data: 0,
    test: 0,
    bootstrap: 0,
    other: 0
  };
}
