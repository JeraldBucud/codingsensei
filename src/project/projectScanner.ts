import type { GitProjectState, ProjectSnapshot, ProjectTool, WorkspaceRoot } from "../core/models";
import { isTestFile } from "../learning/languageProfiles";
import {
  collectMetadataPackageNames,
  detectEcosystems,
  detectTools,
  parsePackageJson
} from "./projectMetadata";
import { findRelatedFiles } from "./sourceTestRelations";
import { dirname, extension, fileName, normalizePath } from "./pathUtils";

export interface ProjectFileRecord {
  readonly relativePath: string;
  readonly content?: string;
}

export interface ProjectIndexInput {
  readonly root: WorkspaceRoot;
  readonly sourceFiles: readonly ProjectFileRecord[];
  readonly metadataFiles: readonly ProjectFileRecord[];
  readonly scanLimit: number;
  readonly scanTruncated: boolean;
}

export interface ProjectIndex {
  readonly root: WorkspaceRoot;
  readonly allPaths: readonly string[];
  readonly codeFiles: readonly string[];
  readonly sourceFiles: readonly string[];
  readonly testFiles: readonly string[];
  readonly ecosystems: readonly ProjectSnapshot["ecosystems"][number][];
  readonly tools: readonly ProjectTool[];
  readonly manifestFiles: readonly string[];
  readonly configFiles: readonly string[];
  readonly sourceRoots: readonly string[];
  readonly testRoots: readonly string[];
  readonly sourceFileCount: number;
  readonly testFileCount: number;
  readonly scanLimit: number;
  readonly scanTruncated: boolean;
  readonly scripts: readonly ProjectSnapshot["scripts"][number][];
  readonly metadata: ProjectSnapshot["metadata"];
}

export interface ProjectSnapshotInput {
  readonly index: ProjectIndex;
  readonly activeFile?: string;
  readonly git: GitProjectState;
}

export const metadataFileNames = [
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "setup.cfg",
  "pytest.ini",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "gradlew",
  "gradlew.bat",
  "mvnw",
  "mvnw.cmd"
] as const;

const manifestNames = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "setup.cfg",
  "pytest.ini",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "gradlew",
  "gradlew.bat",
  "mvnw",
  "mvnw.cmd",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock"
]);

const configNames = new Set(["tsconfig.json", "jsconfig.json"]);

export function buildProjectIndex(input: ProjectIndexInput): ProjectIndex {
  const sourceFilePaths = input.sourceFiles.map((file) => normalizePath(file.relativePath));
  const metadataFilePaths = input.metadataFiles.map((file) => normalizePath(file.relativePath));
  const allPaths = [...new Set([...sourceFilePaths, ...metadataFilePaths])].sort();
  const packageJson = input.metadataFiles.find(
    (file) => fileName(file.relativePath) === "package.json"
  );
  const packageJsonSummary = packageJson?.content
    ? parsePackageJson(packageJson.content)
    : undefined;
  const codeFiles = allPaths.filter(isSourceFile);
  const testFiles = codeFiles.filter(isTestFile);
  const testSet = new Set(testFiles);
  const nonTestSourceFiles = codeFiles.filter((path) => !testSet.has(path));

  return {
    root: input.root,
    allPaths,
    codeFiles,
    sourceFiles: nonTestSourceFiles,
    testFiles,
    ecosystems: detectEcosystems(allPaths),
    tools: sortTools(detectTools(allPaths)),
    manifestFiles: allPaths.filter((path) => manifestNames.has(fileName(path))),
    configFiles: allPaths.filter((path) => configNames.has(fileName(path))),
    sourceRoots: findLikelyRoots(nonTestSourceFiles, false),
    testRoots: findLikelyRoots(testFiles, true),
    sourceFileCount: nonTestSourceFiles.length,
    testFileCount: testFiles.length,
    scanLimit: input.scanLimit,
    scanTruncated: input.scanTruncated,
    scripts: packageJsonSummary?.scripts ?? [],
    metadata: {
      packageNames: collectMetadataPackageNames(input.metadataFiles)
    }
  };
}

export function updateProjectIndexSourcePath(
  index: ProjectIndex,
  relativePath: string,
  change: "create" | "delete"
): ProjectIndex {
  const normalized = normalizePath(relativePath);
  if (!isSourceFile(normalized)) {
    return index;
  }

  const codeFiles = new Set(index.codeFiles);
  if (change === "create") {
    codeFiles.add(normalized);
  } else {
    codeFiles.delete(normalized);
  }

  const nextCodeFiles = [...codeFiles].sort();
  const testFiles = nextCodeFiles.filter(isTestFile);
  const testSet = new Set(testFiles);
  const sourceFiles = nextCodeFiles.filter((path) => !testSet.has(path));
  const nonCodePaths = index.allPaths.filter((path) => !isSourceFile(path));
  const allPaths = [...new Set([...nextCodeFiles, ...nonCodePaths])].sort();

  return {
    ...index,
    allPaths,
    codeFiles: nextCodeFiles,
    sourceFiles,
    testFiles,
    ecosystems: detectEcosystems(allPaths),
    sourceRoots: findLikelyRoots(sourceFiles, false),
    testRoots: findLikelyRoots(testFiles, true),
    sourceFileCount: sourceFiles.length,
    testFileCount: testFiles.length
  };
}

export function buildProjectSnapshot(input: ProjectSnapshotInput): ProjectSnapshot {
  return {
    root: input.index.root,
    ecosystems: input.index.ecosystems,
    tools: input.index.tools,
    codeFiles: input.index.codeFiles,
    manifestFiles: input.index.manifestFiles,
    configFiles: input.index.configFiles,
    sourceRoots: input.index.sourceRoots,
    testRoots: input.index.testRoots,
    sourceFileCount: input.index.sourceFileCount,
    testFileCount: input.index.testFileCount,
    scanLimit: input.index.scanLimit,
    scanTruncated: input.index.scanTruncated,
    scripts: input.index.scripts,
    metadata: input.index.metadata,
    relatedFiles: findRelatedFiles(input.activeFile, input.index.codeFiles),
    git: input.git
  };
}

export function isIgnoredProjectPath(path: string): boolean {
  const normalized = normalizePath(path);
  return /(^|\/)(\.git|node_modules|dist|build|out|target|coverage|\.next|\.venv|venv|__pycache__|vendor|generated)(\/|$)/.test(
    normalized
  );
}

export function isKnownMetadataFile(path: string): boolean {
  return metadataFileNames.includes(fileName(path) as (typeof metadataFileNames)[number]);
}

function isSourceFile(path: string): boolean {
  return [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".py", ".java"].includes(
    extension(path)
  );
}

function findLikelyRoots(paths: readonly string[], testOnly: boolean): readonly string[] {
  const roots = new Set<string>();

  for (const path of paths) {
    const normalized = normalizePath(path);
    if (normalized.includes("src/test/java/")) {
      if (testOnly) {
        roots.add("src/test/java");
      }
    } else if (normalized.includes("src/main/java/")) {
      if (!testOnly) {
        roots.add("src/main/java");
      }
    } else if (/(^|\/)(__tests__|tests?|test)\//.test(normalized)) {
      if (testOnly) {
        roots.add(dirname(normalized).split("/").slice(0, 2).join("/"));
      }
    } else if (!testOnly && normalized.includes("src/")) {
      roots.add("src");
    }
  }

  return [...roots].filter(Boolean).sort();
}

function sortTools(tools: readonly ProjectTool[]): readonly ProjectTool[] {
  const rank = new Map<string, number>([
    ["pnpm", 0],
    ["npm", 1],
    ["yarn", 2],
    ["maven", 3],
    ["gradle", 4],
    ["pyproject", 5],
    ["requirements", 6]
  ]);
  return [...tools].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
}
