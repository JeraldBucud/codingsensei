import type {
  ProjectEcosystem,
  ProjectMetadataSummary,
  ProjectScript,
  ProjectTool,
  WorkspaceRoot
} from "../core/models";
import type { ProjectIndex } from "./projectScanner";

export const projectCatalogSchemaVersion = 1 as const;

export interface PersistentProjectCatalog {
  readonly schemaVersion: typeof projectCatalogSchemaVersion;
  readonly projectId: string;
  readonly savedAt: string;
  readonly scanLimit: number;
  readonly scanTruncated: boolean;
  readonly allPaths: readonly string[];
  readonly codeFiles: readonly string[];
  readonly sourceFiles: readonly string[];
  readonly testFiles: readonly string[];
  readonly manifestFiles: readonly string[];
  readonly configFiles: readonly string[];
  readonly sourceRoots: readonly string[];
  readonly testRoots: readonly string[];
  readonly ecosystems: readonly ProjectEcosystem[];
  readonly tools: readonly ProjectTool[];
  readonly scripts: readonly ProjectScript[];
  readonly metadata: ProjectMetadataSummary;
}

export function createProjectCatalog(
  projectId: string,
  index: ProjectIndex,
  now: () => Date = () => new Date()
): PersistentProjectCatalog {
  return {
    schemaVersion: projectCatalogSchemaVersion,
    projectId,
    savedAt: now().toISOString(),
    scanLimit: index.scanLimit,
    scanTruncated: index.scanTruncated,
    allPaths: [...index.allPaths],
    codeFiles: [...index.codeFiles],
    sourceFiles: [...index.sourceFiles],
    testFiles: [...index.testFiles],
    manifestFiles: [...index.manifestFiles],
    configFiles: [...index.configFiles],
    sourceRoots: [...index.sourceRoots],
    testRoots: [...index.testRoots],
    ecosystems: [...index.ecosystems],
    tools: index.tools.map((tool) => ({ ...tool, evidence: [...tool.evidence] })),
    scripts: index.scripts.map((script) => ({ ...script })),
    metadata: {
      packageNames: [...index.metadata.packageNames]
    }
  };
}

export function restoreProjectIndexFromCatalog(
  root: WorkspaceRoot,
  catalog: PersistentProjectCatalog
): ProjectIndex {
  return {
    root,
    allPaths: [...catalog.allPaths],
    codeFiles: [...catalog.codeFiles],
    sourceFiles: [...catalog.sourceFiles],
    testFiles: [...catalog.testFiles],
    ecosystems: [...catalog.ecosystems],
    tools: catalog.tools.map((tool) => ({ ...tool, evidence: [...tool.evidence] })),
    manifestFiles: [...catalog.manifestFiles],
    configFiles: [...catalog.configFiles],
    sourceRoots: [...catalog.sourceRoots],
    testRoots: [...catalog.testRoots],
    sourceFileCount: catalog.sourceFiles.length,
    testFileCount: catalog.testFiles.length,
    scanLimit: catalog.scanLimit,
    scanTruncated: catalog.scanTruncated,
    scripts: catalog.scripts.map((script) => ({ ...script })),
    metadata: {
      packageNames: [...catalog.metadata.packageNames]
    }
  };
}

export function parseProjectCatalog(content: string): PersistentProjectCatalog | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || parsed.schemaVersion !== projectCatalogSchemaVersion) {
    return undefined;
  }
  if (
    typeof parsed.projectId !== "string" ||
    typeof parsed.savedAt !== "string" ||
    typeof parsed.scanLimit !== "number" ||
    typeof parsed.scanTruncated !== "boolean"
  ) {
    return undefined;
  }

  const pathArrays = [
    "allPaths",
    "codeFiles",
    "sourceFiles",
    "testFiles",
    "manifestFiles",
    "configFiles",
    "sourceRoots",
    "testRoots"
  ] as const;
  if (pathArrays.some((key) => !isStringArray(parsed[key]))) {
    return undefined;
  }
  if (!isProjectEcosystems(parsed.ecosystems)) {
    return undefined;
  }
  if (!isProjectTools(parsed.tools) || !isProjectScripts(parsed.scripts)) {
    return undefined;
  }
  if (!isRecord(parsed.metadata) || !isStringArray(parsed.metadata.packageNames)) {
    return undefined;
  }

  return {
    schemaVersion: projectCatalogSchemaVersion,
    projectId: parsed.projectId,
    savedAt: parsed.savedAt,
    scanLimit: parsed.scanLimit,
    scanTruncated: parsed.scanTruncated,
    allPaths: parsed.allPaths,
    codeFiles: parsed.codeFiles,
    sourceFiles: parsed.sourceFiles,
    testFiles: parsed.testFiles,
    manifestFiles: parsed.manifestFiles,
    configFiles: parsed.configFiles,
    sourceRoots: parsed.sourceRoots,
    testRoots: parsed.testRoots,
    ecosystems: parsed.ecosystems,
    tools: parsed.tools,
    scripts: parsed.scripts,
    metadata: {
      packageNames: parsed.metadata.packageNames
    }
  };
}

export function serializeProjectCatalog(catalog: PersistentProjectCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function isProjectEcosystems(value: unknown): value is ProjectEcosystem[] {
  const allowed = new Set<ProjectEcosystem>(["javascript", "typescript", "python", "java"]);
  return Array.isArray(value) && value.every((item) => allowed.has(item as ProjectEcosystem));
}

function isProjectTools(value: unknown): value is ProjectTool[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.label === "string" &&
        isStringArray(item.evidence)
    )
  );
}

function isProjectScripts(value: unknown): value is ProjectScript[] {
  const allowedKinds = new Set<ProjectScript["kind"]>([
    "test",
    "build",
    "lint",
    "dev",
    "start",
    "other"
  ]);
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.name === "string" &&
        typeof item.kind === "string" &&
        allowedKinds.has(item.kind as ProjectScript["kind"])
    )
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
