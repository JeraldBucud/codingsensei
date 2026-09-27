import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  FileType: { Directory: 2 },
  RelativePattern: class RelativePattern {
    constructor(
      readonly base: unknown,
      readonly pattern: string
    ) {}
  },
  Uri: {
    parse: (value: string) => ({
      toString: () => value,
      fsPath: value.replace("file://", ""),
      path: value.replace("file://", "")
    }),
    joinPath: (base: { toString: () => string }, name: string) => ({
      toString: () => `${base.toString().replace(/\/$/, "")}/${name}`,
      fsPath: name,
      path: name
    })
  },
  window: {},
  workspace: {
    asRelativePath: vi.fn(),
    findFiles: vi.fn(),
    getWorkspaceFolder: vi.fn(),
    fs: {
      stat: vi.fn(),
      readFile: vi.fn()
    }
  }
}));

import type { ActiveEditorContext, GitProjectState, WorkspaceRoot } from "../src/core/models";
import { normalizePath } from "../src/project/pathUtils";
import {
  ProjectIntelligenceService,
  type ProjectWorkspaceAdapter
} from "../src/project/projectIntelligence";
import { createProjectCatalog, serializeProjectCatalog } from "../src/project/projectCatalog";
import {
  ProjectPersistenceService,
  type ProjectPersistenceAdapter
} from "../src/project/projectPersistence";
import { buildProjectIndex } from "../src/project/projectScanner";
import {
  resolveProjectRootFromMarkers,
  stripProjectPrefix,
  type ProjectRootResolution
} from "../src/project/projectRootResolver";

const workspaceRoot: WorkspaceRoot = {
  name: "workspace",
  uri: "file:///workspace",
  path: "/workspace"
};

interface MemoryWorkspaceInput {
  readonly markers?: readonly string[];
  readonly sourceFiles?: readonly string[];
  readonly activeFile: string;
}

function editor(relativePath: string): ActiveEditorContext {
  return {
    fileName: relativePath.split("/").at(-1) ?? relativePath,
    relativePath,
    languageId: "typescript",
    isUntitled: false,
    isDirty: false,
    lineCount: 10,
    diagnostics: [],
    todoMarkers: []
  };
}

function gitState(activeFile: string | undefined): GitProjectState {
  return {
    available: true,
    isRepository: true,
    branch: "main",
    isDirty: activeFile === "src/auth.ts",
    changedFileCount: activeFile === "src/auth.ts" ? 1 : 0,
    activeFileStatus: activeFile === "src/auth.ts" ? "modified" : "clean"
  };
}

function createMemoryAdapter(input: MemoryWorkspaceInput): {
  readonly adapter: ProjectWorkspaceAdapter;
  readonly setActiveFile: (path: string) => void;
  readonly counts: {
    readonly sourceScans: () => number;
    readonly metadataScans: () => number;
    readonly gitReads: () => number;
  };
} {
  let activeFile = normalizePath(input.activeFile);
  let sourceScans = 0;
  let metadataScans = 0;
  let gitReads = 0;
  const sourceFiles = (
    input.sourceFiles ?? ["src/auth.ts", "src/auth.test.ts", "src/other.ts"]
  ).map(normalizePath);
  const markerPaths = (input.markers ?? ["package.json"]).map(normalizePath);

  const resolve = (relativePath: string | undefined): ProjectRootResolution =>
    resolveProjectRootFromMarkers({
      workspaceRoot,
      activeFile: relativePath,
      markerPaths
    });

  return {
    adapter: {
      getActiveWorkspaceRoot: () => workspaceRoot,
      resolveProjectRoot: (activeEditor) =>
        Promise.resolve(resolve(activeEditor?.relativePath ?? activeFile)),
      resolveProjectRootForUri: () => Promise.resolve(resolve(activeFile)),
      findSourceFiles: (root) => {
        sourceScans += 1;
        return Promise.resolve(
          sourceFiles
            .filter((path) => isInsideRoot(path, root))
            .map((path) => ({ relativePath: stripProjectPrefix(path, root.relativePath) }))
        );
      },
      findMetadataFiles: (root) => {
        metadataScans += 1;
        return Promise.resolve(
          markerPaths
            .filter((path) => isInsideRoot(path, root))
            .map((path) => ({
              relativePath: stripProjectPrefix(path, root.relativePath),
              content: path.endsWith("package.json")
                ? JSON.stringify({ scripts: { test: "vitest" } })
                : ""
            }))
        );
      },
      readSourceDocument: (root, relativePath) => {
        const languageId = relativePath.endsWith(".py")
          ? "python"
          : relativePath.endsWith(".java")
            ? "java"
            : relativePath.endsWith(".tsx")
              ? "typescriptreact"
              : "typescript";
        const text = relativePath.endsWith("auth.ts")
          ? 'import { other } from "./other";\nexport function auth() { return other(); }'
          : relativePath.endsWith("auth.test.ts")
            ? 'import { auth } from "./auth";\nexport function testAuth() { return auth(); }'
            : "export function other() { return true; }";
        return Promise.resolve({
          uri: `${root.uri}/${relativePath}`,
          fileName: relativePath.split("/").at(-1) ?? relativePath,
          languageId,
          text
        });
      },
      readGitState: (_root, activeProjectFile): Promise<GitProjectState> => {
        gitReads += 1;
        return Promise.resolve(gitState(activeProjectFile));
      }
    },
    setActiveFile: (path) => {
      activeFile = normalizePath(path);
    },
    counts: {
      sourceScans: () => sourceScans,
      metadataScans: () => metadataScans,
      gitReads: () => gitReads
    }
  };
}

function isInsideRoot(path: string, root: WorkspaceRoot): boolean {
  const rootPath = root.relativePath ? normalizePath(root.relativePath) : "";
  return !rootPath || path === rootPath || path.startsWith(`${rootPath}/`);
}

function createMemoryPersistenceService(
  root: WorkspaceRoot,
  sourceFiles: readonly string[]
): ProjectPersistenceService {
  const projectId = "2c0df18a-8ac2-4b68-84e3-0b6f2c3d6d41";
  const identity = JSON.stringify({
    schemaVersion: 1,
    projectId,
    createdAt: "2026-09-27T08:00:00.000Z"
  });
  const catalog = serializeProjectCatalog(
    createProjectCatalog(
      projectId,
      buildProjectIndex({
        root,
        sourceFiles: sourceFiles.map((relativePath) => ({ relativePath })),
        metadataFiles: [{ relativePath: "package.json", content: "{}" }],
        scanLimit: 2500,
        scanTruncated: false
      }),
      () => new Date("2026-09-27T08:00:00.000Z")
    )
  );
  const adapter: ProjectPersistenceAdapter = {
    readProjectIdentity: () => Promise.resolve(identity),
    writeProjectIdentity: () => Promise.resolve(),
    writeProjectManifest: () => Promise.resolve(),
    readProjectCatalog: () => Promise.resolve(catalog),
    writeProjectCatalog: () => Promise.resolve(),
    readProjectKnowledge: () => Promise.resolve(undefined),
    writeProjectKnowledge: () => Promise.resolve(),
    deleteProjectKnowledge: () => Promise.resolve(),
    deleteAllProjectKnowledge: () => Promise.resolve(),
    deleteProjectStorage: () => Promise.resolve()
  };
  return new ProjectPersistenceService(adapter, {
    now: () => new Date("2026-09-27T08:00:00.000Z")
  });
}

function createWritablePersistenceService(
  root: WorkspaceRoot,
  sourceFiles: readonly string[]
): {
  readonly service: ProjectPersistenceService;
  readonly knowledge: Map<string, string>;
} {
  const projectId = "2c0df18a-8ac2-4b68-84e3-0b6f2c3d6d41";
  const identity = JSON.stringify({
    schemaVersion: 1,
    projectId,
    createdAt: "2026-09-27T08:00:00.000Z"
  });
  const catalog = serializeProjectCatalog(
    createProjectCatalog(
      projectId,
      buildProjectIndex({
        root,
        sourceFiles: sourceFiles.map((relativePath) => ({ relativePath })),
        metadataFiles: [{ relativePath: "package.json", content: "{}" }],
        scanLimit: 2500,
        scanTruncated: false
      }),
      () => new Date("2026-09-27T08:00:00.000Z")
    )
  );
  const knowledge = new Map<string, string>();
  const adapter: ProjectPersistenceAdapter = {
    readProjectIdentity: () => Promise.resolve(identity),
    writeProjectIdentity: () => Promise.resolve(),
    writeProjectManifest: () => Promise.resolve(),
    readProjectCatalog: () => Promise.resolve(catalog),
    writeProjectCatalog: () => Promise.resolve(),
    readProjectKnowledge: (id, key) => Promise.resolve(knowledge.get(`${id}:${key}`)),
    writeProjectKnowledge: (id, key, content) => {
      knowledge.set(`${id}:${key}`, content);
      return Promise.resolve();
    },
    deleteProjectKnowledge: (id, key) => {
      knowledge.delete(`${id}:${key}`);
      return Promise.resolve();
    },
    deleteAllProjectKnowledge: (id) => {
      for (const key of [...knowledge.keys()]) {
        if (key.startsWith(`${id}:`)) {
          knowledge.delete(key);
        }
      }
      return Promise.resolve();
    },
    deleteProjectStorage: () => Promise.resolve()
  };
  return {
    service: new ProjectPersistenceService(adapter, {
      now: () => new Date("2026-09-27T08:00:00.000Z")
    }),
    knowledge
  };
}

describe("project intelligence service", () => {
  it("detects a nested Maven project root from the active file", async () => {
    const { adapter } = createMemoryAdapter({
      activeFile: "EBusinessSystem/src/main/java/app/Auth.java",
      markers: ["EBusinessSystem/pom.xml"],
      sourceFiles: ["EBusinessSystem/src/main/java/app/Auth.java"]
    });
    const service = new ProjectIntelligenceService(adapter);

    const analysis = await service.analyze(editor("EBusinessSystem/src/main/java/app/Auth.java"), {
      force: false,
      refreshGit: true
    });

    expect(analysis.snapshot?.root.name).toBe("EBusinessSystem");
    expect(analysis.snapshot?.tools.map((tool) => tool.id)).toEqual(["maven"]);
    expect(analysis.snapshot?.sourceFileCount).toBe(1);
  });

  it("detects nested Node and Python project roots", async () => {
    const node = createMemoryAdapter({
      activeFile: "frontend/src/app.ts",
      markers: ["frontend/package.json"],
      sourceFiles: ["frontend/src/app.ts"]
    });
    const python = createMemoryAdapter({
      activeFile: "backend/app.py",
      markers: ["backend/pyproject.toml"],
      sourceFiles: ["backend/app.py"]
    });

    const nodeAnalysis = await new ProjectIntelligenceService(node.adapter).analyze(
      editor("frontend/src/app.ts"),
      { force: false, refreshGit: false }
    );
    const pythonAnalysis = await new ProjectIntelligenceService(python.adapter).analyze(
      editor("backend/app.py"),
      { force: false, refreshGit: false }
    );

    expect(nodeAnalysis.snapshot?.root.name).toBe("frontend");
    expect(nodeAnalysis.snapshot?.tools.map((tool) => tool.id)).toEqual([]);
    expect(nodeAnalysis.snapshot?.ecosystems).toContain("typescript");
    expect(pythonAnalysis.snapshot?.root.name).toBe("backend");
    expect(pythonAnalysis.snapshot?.tools.map((tool) => tool.id)).toEqual(["pyproject"]);
  });

  it("uses the nearest strong marker instead of an outer workspace marker", async () => {
    const { adapter } = createMemoryAdapter({
      activeFile: "packages/app/src/app.ts",
      markers: ["package.json", "packages/app/package.json"],
      sourceFiles: ["packages/app/src/app.ts"]
    });

    const analysis = await new ProjectIntelligenceService(adapter).analyze(
      editor("packages/app/src/app.ts"),
      { force: false, refreshGit: false }
    );

    expect(analysis.snapshot?.root.relativePath).toBe("packages/app");
    expect(analysis.snapshot?.sourceFileCount).toBe(1);
  });

  it("falls back to the workspace root when no strong marker contains the active file", async () => {
    const { adapter } = createMemoryAdapter({
      activeFile: "src/app.java",
      markers: [],
      sourceFiles: ["src/app.java"]
    });

    const analysis = await new ProjectIntelligenceService(adapter).analyze(editor("src/app.java"), {
      force: false,
      refreshGit: false
    });

    expect(analysis.snapshot?.root.uri).toBe(workspaceRoot.uri);
    expect(analysis.snapshot?.tools).toEqual([]);
  });

  it("uses cached structural analysis for fast context without rescanning or reading Git", async () => {
    const { adapter, counts } = createMemoryAdapter({ activeFile: "src/auth.ts" });
    const service = new ProjectIntelligenceService(adapter);

    await service.analyze(editor("src/auth.ts"), { force: false, refreshGit: true });
    const firstFast = service.getCached(editor("src/auth.ts"));
    const secondFast = service.getCached(editor("src/auth.ts"));

    expect(counts.sourceScans()).toBe(1);
    expect(counts.metadataScans()).toBe(1);
    expect(counts.gitReads()).toBe(1);
    expect(firstFast.snapshot?.relatedFiles[0]).toMatchObject({
      path: "src/auth.test.ts",
      relationship: "test"
    });
    expect(secondFast.snapshot?.git.activeFileStatus).toBe("modified");
  });

  it("switches active files inside one nested project without structurally rescanning", async () => {
    const { adapter, counts } = createMemoryAdapter({
      activeFile: "frontend/src/auth.ts",
      markers: ["frontend/package.json"],
      sourceFiles: ["frontend/src/auth.ts", "frontend/src/auth.test.ts", "frontend/src/other.ts"]
    });
    const service = new ProjectIntelligenceService(adapter);

    await service.analyze(editor("frontend/src/auth.ts"), { force: false, refreshGit: true });
    const testAnalysis = await service.analyze(editor("frontend/src/auth.test.ts"), {
      force: false,
      refreshGit: true
    });

    expect(counts.sourceScans()).toBe(1);
    expect(counts.metadataScans()).toBe(1);
    expect(counts.gitReads()).toBe(2);
    expect(testAnalysis.snapshot?.relatedFiles[0]).toMatchObject({
      path: "src/auth.ts",
      relationship: "source"
    });
  });

  it("keeps sibling projects in separate structural caches", async () => {
    const memory = createMemoryAdapter({
      activeFile: "frontend/src/app.ts",
      markers: ["frontend/package.json", "backend/pyproject.toml"],
      sourceFiles: ["frontend/src/app.ts", "backend/app.py"]
    });
    const service = new ProjectIntelligenceService(memory.adapter);

    await service.analyze(editor("frontend/src/app.ts"), { force: false, refreshGit: false });
    memory.setActiveFile("backend/app.py");
    const backend = await service.analyze(editor("backend/app.py"), {
      force: false,
      refreshGit: false
    });

    expect(memory.counts.sourceScans()).toBe(2);
    expect(memory.counts.metadataScans()).toBe(2);
    expect(backend.snapshot?.root.name).toBe("backend");
    expect(backend.snapshot?.sourceFileCount).toBe(1);
  });

  it("restores a persisted structural catalog before background validation completes", async () => {
    const memory = createMemoryAdapter({
      activeFile: "src/app.ts",
      sourceFiles: ["src/app.ts"]
    });
    const persistence = createMemoryPersistenceService(workspaceRoot, [
      "src/app.ts",
      "src/app.test.ts",
      "src/persisted.ts"
    ]);
    const service = new ProjectIntelligenceService(memory.adapter, persistence);

    const analysis = await service.analyze(editor("src/app.ts"), {
      force: false,
      refreshGit: false
    });

    expect(analysis.status).toBe("ready");
    expect(analysis.persistence?.projectId).toBe("2c0df18a-8ac2-4b68-84e3-0b6f2c3d6d41");
    expect(analysis.snapshot?.codeFiles).toContain("src/persisted.ts");
    expect(analysis.snapshot?.sourceFileCount).toBe(2);
    expect(analysis.snapshot?.testFileCount).toBe(1);
  });

  it("deep indexes project files, builds a graph and reuses unchanged knowledge", async () => {
    const memory = createMemoryAdapter({
      activeFile: "src/auth.ts",
      sourceFiles: ["src/auth.ts", "src/auth.test.ts", "src/other.ts"]
    });
    const persisted = createWritablePersistenceService(workspaceRoot, [
      "src/auth.ts",
      "src/auth.test.ts",
      "src/other.ts"
    ]);
    const service = new ProjectIntelligenceService(memory.adapter, persisted.service);

    await service.analyze(editor("src/auth.ts"), { force: false, refreshGit: false });
    const first = await service.buildDeepProjectIntelligence(editor("src/auth.ts"));
    const graph = await service.getStructuralGraph(editor("src/auth.ts"));
    const results = await service.retrieveStructuralContext(
      editor("src/auth.ts"),
      "other",
      5
    );
    const second = await service.buildDeepProjectIntelligence(editor("src/auth.ts"));

    expect(first).toMatchObject({
      indexed: 3,
      reused: 0,
      skipped: 0,
      cancelled: false,
      truncated: false
    });
    expect(persisted.knowledge.size).toBe(3);
    expect(graph).toMatchObject({
      totalFileCount: 3,
      indexedFileCount: 3
    });
    expect(
      graph?.edges.some(
        (edge) =>
          edge.type === "imports" &&
          edge.fromFile === "src/auth.ts" &&
          edge.toFile === "src/other.ts"
      )
    ).toBe(true);
    expect(results[0]?.file).toBe("src/other.ts");
    expect(second).toMatchObject({
      indexed: 0,
      reused: 3,
      skipped: 0
    });
  });

  it("refreshes Git on save without structurally rescanning", async () => {
    const { adapter, counts } = createMemoryAdapter({ activeFile: "src/auth.ts" });
    const service = new ProjectIntelligenceService(adapter);

    await service.analyze(editor("src/auth.ts"), { force: false, refreshGit: true });
    const saved = await service.refreshGit(editor("src/other.ts"));

    expect(counts.sourceScans()).toBe(1);
    expect(counts.metadataScans()).toBe(1);
    expect(counts.gitReads()).toBe(2);
    expect(saved.snapshot?.git.activeFileStatus).toBe("clean");
  });

  it("manual forced refresh structurally rescans and refreshes Git", async () => {
    const { adapter, counts } = createMemoryAdapter({ activeFile: "src/auth.ts" });
    const service = new ProjectIntelligenceService(adapter);

    await service.analyze(editor("src/auth.ts"), { force: false, refreshGit: true });
    await service.analyze(editor("src/auth.ts"), { force: true, refreshGit: true });

    expect(counts.sourceScans()).toBe(2);
    expect(counts.metadataScans()).toBe(2);
    expect(counts.gitReads()).toBe(2);
  });

  it("does not let a stale Git refresh overwrite newer active-file state", async () => {
    const pending = new Map<string, (state: GitProjectState) => void>();
    let gitReads = 0;
    const memory = createMemoryAdapter({ activeFile: "src/auth.ts" });
    const adapter: ProjectWorkspaceAdapter = {
      ...memory.adapter,
      readGitState: (_root, activeProjectFile): Promise<GitProjectState> => {
        gitReads += 1;
        return new Promise((resolve) => {
          pending.set(activeProjectFile ?? "", resolve);
        });
      }
    };
    const service = new ProjectIntelligenceService(adapter);

    await service.analyze(editor("src/auth.ts"), { force: false, refreshGit: false });
    const first = service.refreshGit(editor("src/auth.ts"));
    const second = service.refreshGit(editor("src/other.ts"));
    await Promise.resolve();

    pending.get("src/other.ts")?.(gitState("src/other.ts"));
    const secondAnalysis = await second;
    pending.get("src/auth.ts")?.(gitState("src/auth.ts"));
    const firstAnalysis = await first;
    const cached = service.getCached(editor("src/other.ts"));

    expect(gitReads).toBe(2);
    expect(secondAnalysis.snapshot?.git.activeFileStatus).toBe("clean");
    expect(firstAnalysis.snapshot?.git.activeFileStatus).toBe("clean");
    expect(cached.snapshot?.git.activeFileStatus).toBe("clean");
  });
});
