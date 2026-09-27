import * as vscode from "vscode";

import type {
  ActiveEditorContext,
  GitProjectState,
  ProjectAnalysis,
  ProjectPersistenceSummary,
  WorkspaceRoot
} from "../core/models";
import { detectFrameworks } from "../framework/frameworkIntelligence";
import type { FrameworkDetection } from "../framework/models";
import { LanguageIntelligenceService } from "../language/languageIntelligence";
import type { LanguageAnalysis, LanguageDocumentInput } from "../language/models";
import {
  analyzeArchitecture,
  type ArchitectureInsights
} from "./architectureInsights";
import { readGitState } from "./gitAdapter";
import { ProjectIndexCache } from "./projectCache";
import { createProjectCatalog, restoreProjectIndexFromCatalog } from "./projectCatalog";
import { hashContent, restoreLanguageAnalysisFromKnowledge } from "./projectKnowledge";
import type { ProjectPersistenceService } from "./projectPersistence";
import { buildStructuralGraph, type StructuralGraph } from "./structuralGraph";
import { retrieveStructuralContext, type StructuralRetrievalItem } from "./structuralRetrieval";
import { dirname, extension, fileName, normalizePath } from "./pathUtils";
import {
  isPathInsideProject,
  isStrongProjectMarker,
  resolveProjectRootFromMarkers,
  stripProjectPrefix,
  strongProjectMarkerNames,
  type ProjectRootResolution
} from "./projectRootResolver";
import {
  buildProjectIndex,
  buildProjectSnapshot,
  isIgnoredProjectPath,
  isKnownMetadataFile,
  metadataFileNames,
  type ProjectFileRecord,
  type ProjectIndex,
  updateProjectIndexSourcePath
} from "./projectScanner";

const scanLimit = 2500;
const metadataReadLimitBytes = 128 * 1024;
const backgroundSourceReadLimitBytes = 256 * 1024;
const maxStructuralKnowledgeFiles = 1000;
const maxDeepIndexFiles = 1000;
const sourceIncludePattern = "**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs,py,java}";
const excludePattern =
  "**/{.git,node_modules,dist,build,out,target,coverage,.next,.venv,venv,__pycache__,vendor,generated}/**";

export interface ProjectWorkspaceAdapter {
  readonly getActiveWorkspaceRoot: () => WorkspaceRoot | undefined;
  readonly resolveProjectRoot: (
    activeEditor: ActiveEditorContext | undefined
  ) => Promise<ProjectRootResolution | undefined>;
  readonly resolveProjectRootForUri: (
    uri: vscode.Uri
  ) => Promise<ProjectRootResolution | undefined>;
  readonly findSourceFiles: (
    root: WorkspaceRoot,
    limit: number
  ) => Promise<readonly ProjectFileRecord[]>;
  readonly findMetadataFiles: (root: WorkspaceRoot) => Promise<readonly ProjectFileRecord[]>;
  readonly readSourceDocument?: (
    root: WorkspaceRoot,
    relativePath: string
  ) => Promise<Pick<LanguageDocumentInput, "uri" | "fileName" | "languageId" | "text"> | undefined>;
  readonly readGitState: (root: WorkspaceRoot, activeFile?: string) => Promise<GitProjectState>;
}

export interface RestoredLanguageKnowledge {
  readonly analysis: LanguageAnalysis;
  readonly frameworks: readonly FrameworkDetection[];
}

export interface DeepProjectIndexProgress {
  readonly processed: number;
  readonly total: number;
  readonly indexed: number;
  readonly reused: number;
  readonly skipped: number;
}

export interface DeepProjectIndexSummary extends DeepProjectIndexProgress {
  readonly cancelled: boolean;
  readonly truncated: boolean;
}

export class ProjectIntelligenceService {
  private readonly cache = new ProjectIndexCache();
  private readonly adapter: ProjectWorkspaceAdapter;
  private readonly backgroundLanguageService = new LanguageIntelligenceService();
  private gitCache = new Map<string, GitProjectState>();
  private gitGenerations = new Map<string, number>();
  private persistenceState = new Map<string, ProjectPersistenceSummary>();
  private structuralGraphCache = new Map<string, StructuralGraph>();
  private analyzing = new Set<string>();

  constructor(
    adapter: ProjectWorkspaceAdapter = createVsCodeProjectAdapter(),
    private readonly persistenceService?: ProjectPersistenceService
  ) {
    this.adapter = adapter;
  }

  getCached(activeEditor?: ActiveEditorContext): ProjectAnalysis {
    const workspaceRoot = this.adapter.getActiveWorkspaceRoot();
    if (!workspaceRoot) {
      return { status: "no-workspace", message: "Open a workspace to analyze project context." };
    }

    const cached = this.findCachedEntry(workspaceRoot, activeEditor?.relativePath);
    if (!cached) {
      return this.analyzing.has(workspaceRoot.uri)
        ? {
            status: "analyzing",
            root: workspaceRoot,
            message: "Analyzing project context locally."
          }
        : {
            status: "analyzing",
            root: workspaceRoot,
            message: "Project context has not been analyzed yet."
          };
    }

    const activeFile = activeEditor?.relativePath
      ? stripProjectPrefix(activeEditor.relativePath, cached.root.relativePath)
      : undefined;
    return this.buildAnalysis(cached.index, activeFile, this.gitCache.get(cached.root.uri));
  }

  async analyze(
    activeEditor: ActiveEditorContext | undefined,
    options: { readonly force: boolean; readonly refreshGit: boolean }
  ): Promise<ProjectAnalysis> {
    const resolution = await this.adapter.resolveProjectRoot(activeEditor);
    if (!resolution) {
      return { status: "no-workspace", message: "Open a workspace to analyze project context." };
    }

    const root = resolution.projectRoot;
    const activeFile = resolution.activeFile;
    await this.ensurePersistence(root);
    const cached = this.cache.get(root.uri);
    if (!options.force && cached) {
      const git = options.refreshGit
        ? await this.refreshGitForRoot(root, activeFile)
        : this.gitCache.get(root.uri);
      return this.buildAnalysis(cached.index, activeFile, git);
    }

    if (!options.force) {
      const restored = await this.restorePersistentIndex(root);
      if (restored) {
        const git = options.refreshGit
          ? await this.refreshGitForRoot(root, activeFile)
          : this.gitCache.get(root.uri);
        void this.validateRestoredIndex(root);
        return this.buildAnalysis(restored, activeFile, git);
      }
    }

    const generation = this.cache.begin(root);
    this.analyzing.add(root.uri);

    try {
      const index = await this.scanIndex(root);
      if (!this.cache.setCurrent(root, generation, index)) {
        const current = this.cache.get(root.uri);
        return current
          ? this.buildAnalysis(current.index, activeFile, this.gitCache.get(root.uri))
          : { status: "analyzing", root, message: "Analyzing project context locally." };
      }

      if (this.persistenceService) {
        this.structuralGraphCache.delete(root.uri);
        void this.persistenceService.saveProjectCatalog(root, index);
      }

      const git = options.refreshGit
        ? await this.refreshGitForRoot(root, activeFile)
        : this.gitCache.get(root.uri);
      return this.buildAnalysis(index, activeFile, git);
    } catch (error) {
      return {
        status: "unavailable",
        root,
        message: error instanceof Error ? error.message : "Project analysis unavailable."
      };
    } finally {
      this.analyzing.delete(root.uri);
    }
  }

  async restoreLanguageKnowledge(
    root: WorkspaceRoot | undefined,
    document: LanguageDocumentInput
  ): Promise<RestoredLanguageKnowledge | undefined> {
    if (!root || !this.persistenceService) {
      return undefined;
    }

    const relativePath = document.projectRelativePath ?? document.relativePath ?? document.fileName;
    const knowledge = await this.persistenceService.loadFileKnowledge(root, relativePath);
    if (
      !knowledge ||
      knowledge.languageId !== document.languageId ||
      knowledge.contentHash !== hashContent(document.text)
    ) {
      return undefined;
    }

    return {
      analysis: restoreLanguageAnalysisFromKnowledge(knowledge),
      frameworks: knowledge.frameworks.map((framework) => ({
        ...framework,
        evidence: framework.evidence.map((evidence) => ({ ...evidence })),
        roles: [...framework.roles]
      }))
    };
  }

  async indexSourceFile(uri: vscode.Uri): Promise<boolean> {
    if (!this.persistenceService || !this.adapter.readSourceDocument) {
      return false;
    }

    const resolution = await this.adapter.resolveProjectRootForUri(uri);
    if (!resolution?.activeFile) {
      return false;
    }

    const root = resolution.projectRoot;
    await this.ensurePersistence(root);
    const source = await this.adapter.readSourceDocument(root, resolution.activeFile);
    if (!source) {
      return false;
    }

    const cached = this.cache.get(root.uri);
    const document: LanguageDocumentInput = {
      ...source,
      relativePath: resolution.activeFile,
      projectRootUri: root.uri,
      projectRelativePath: resolution.activeFile,
      knownProjectFiles: cached?.index.codeFiles,
      version: 0
    };
    const analysis = await this.backgroundLanguageService.analyze(document, true);
    const frameworks = detectFrameworks({
      fileName: document.fileName,
      relativePath: document.relativePath,
      languageId: document.languageId,
      text: document.text,
      languageAnalysis: analysis,
      manifestFiles: cached?.index.manifestFiles,
      metadataPackageNames: cached?.index.metadata.packageNames
    });

    const saved = await this.persistenceService.saveFileKnowledge(
      root,
      document,
      analysis,
      frameworks
    );
    if (saved) {
      this.structuralGraphCache.delete(root.uri);
    }
    return saved;
  }

  async buildDeepProjectIntelligence(
    activeEditor: ActiveEditorContext | undefined,
    options: {
      readonly limit?: number;
      readonly shouldCancel?: () => boolean;
      readonly onProgress?: (progress: DeepProjectIndexProgress) => void;
    } = {}
  ): Promise<DeepProjectIndexSummary | undefined> {
    if (!this.persistenceService || !this.adapter.readSourceDocument) {
      return undefined;
    }

    const resolution = await this.adapter.resolveProjectRoot(activeEditor);
    if (!resolution) {
      return undefined;
    }

    const root = resolution.projectRoot;
    await this.ensurePersistence(root);

    let index = this.cache.get(root.uri)?.index;
    if (!index) {
      await this.analyze(activeEditor, { force: false, refreshGit: false });
      index = this.cache.get(root.uri)?.index;
    }
    if (!index) {
      return undefined;
    }

    const limit = Math.max(1, Math.min(options.limit ?? maxDeepIndexFiles, maxDeepIndexFiles));
    const paths = index.codeFiles.slice(0, limit);
    let processed = 0;
    let indexed = 0;
    let reused = 0;
    let skipped = 0;
    let cancelled = false;

    for (const relativePath of paths) {
      if (options.shouldCancel?.()) {
        cancelled = true;
        break;
      }

      const source = await this.adapter.readSourceDocument(root, relativePath);
      if (!source) {
        skipped += 1;
        processed += 1;
        options.onProgress?.({
          processed,
          total: paths.length,
          indexed,
          reused,
          skipped
        });
        continue;
      }

      const existing = await this.persistenceService.loadFileKnowledge(root, relativePath);
      if (
        existing &&
        existing.languageId === source.languageId &&
        existing.contentHash === hashContent(source.text)
      ) {
        reused += 1;
        processed += 1;
        options.onProgress?.({
          processed,
          total: paths.length,
          indexed,
          reused,
          skipped
        });
        continue;
      }

      const document: LanguageDocumentInput = {
        ...source,
        relativePath,
        projectRootUri: root.uri,
        projectRelativePath: relativePath,
        knownProjectFiles: index.codeFiles,
        version: 0
      };
      const analysis = await this.backgroundLanguageService.analyze(document, true);
      const frameworks = detectFrameworks({
        fileName: document.fileName,
        relativePath: document.relativePath,
        languageId: document.languageId,
        text: document.text,
        languageAnalysis: analysis,
        manifestFiles: index.manifestFiles,
        metadataPackageNames: index.metadata.packageNames
      });

      if (
        analysis.status !== "unavailable" &&
        (await this.persistenceService.saveFileKnowledge(root, document, analysis, frameworks))
      ) {
        indexed += 1;
      } else {
        skipped += 1;
      }
      processed += 1;
      options.onProgress?.({
        processed,
        total: paths.length,
        indexed,
        reused,
        skipped
      });
    }

    this.structuralGraphCache.delete(root.uri);
    return {
      processed,
      total: paths.length,
      indexed,
      reused,
      skipped,
      cancelled,
      truncated: index.codeFiles.length > paths.length
    };
  }

  async saveLanguageKnowledge(
    root: WorkspaceRoot | undefined,
    document: LanguageDocumentInput,
    analysis: LanguageAnalysis,
    frameworks: readonly FrameworkDetection[]
  ): Promise<boolean> {
    if (!root || !this.persistenceService || analysis.status === "unavailable") {
      return false;
    }
    const saved = await this.persistenceService.saveFileKnowledge(
      root,
      document,
      analysis,
      frameworks
    );
    if (saved) {
      this.structuralGraphCache.delete(root.uri);
    }
    return saved;
  }

  async getStructuralGraph(
    activeEditor: ActiveEditorContext | undefined
  ): Promise<StructuralGraph | undefined> {
    if (!this.persistenceService) {
      return undefined;
    }

    const resolution = await this.adapter.resolveProjectRoot(activeEditor);
    if (!resolution) {
      return undefined;
    }

    const root = resolution.projectRoot;
    const cachedGraph = this.structuralGraphCache.get(root.uri);
    if (cachedGraph) {
      return cachedGraph;
    }

    await this.ensurePersistence(root);
    let catalog = await this.persistenceService.loadProjectCatalog(root);
    if (!catalog) {
      const cachedIndex = this.cache.get(root.uri)?.index;
      const state = this.persistenceService.getState(root.uri);
      if (!cachedIndex || state?.status !== "ready" || !state.projectId) {
        return undefined;
      }
      catalog = createProjectCatalog(state.projectId, cachedIndex);
    }

    const knowledge = await this.persistenceService.loadProjectKnowledge(
      root,
      catalog.codeFiles,
      maxStructuralKnowledgeFiles
    );
    const graph = buildStructuralGraph({ catalog, knowledge });
    this.structuralGraphCache.set(root.uri, graph);
    return graph;
  }

  async getArchitectureInsights(
    activeEditor: ActiveEditorContext | undefined
  ): Promise<ArchitectureInsights | undefined> {
    const graph = await this.getStructuralGraph(activeEditor);
    return graph ? analyzeArchitecture(graph) : undefined;
  }

  async retrieveStructuralContext(
    activeEditor: ActiveEditorContext | undefined,
    query: string,
    limit = 8
  ): Promise<readonly StructuralRetrievalItem[]> {
    const resolution = await this.adapter.resolveProjectRoot(activeEditor);
    if (!resolution) {
      return [];
    }

    const graph = await this.getStructuralGraph(activeEditor);
    if (!graph) {
      return [];
    }

    return retrieveStructuralContext(graph, {
      activeFile: resolution.activeFile,
      query,
      limit
    });
  }

  async clearPersistentData(activeEditor: ActiveEditorContext | undefined): Promise<boolean> {
    if (!this.persistenceService) {
      return false;
    }

    const resolution = await this.adapter.resolveProjectRoot(activeEditor);
    if (!resolution) {
      return false;
    }

    const cleared = await this.persistenceService.clearProjectData(resolution.projectRoot);
    if (cleared) {
      this.persistenceState.delete(resolution.projectRoot.uri);
      this.structuralGraphCache.delete(resolution.projectRoot.uri);
    }
    return cleared;
  }

  async refreshGit(activeEditor: ActiveEditorContext | undefined): Promise<ProjectAnalysis> {
    const resolution = await this.adapter.resolveProjectRoot(activeEditor);
    if (!resolution) {
      return { status: "no-workspace", message: "Open a workspace to analyze project context." };
    }

    const root = resolution.projectRoot;
    const git = await this.refreshGitForRoot(root, resolution.activeFile);
    const cached = this.cache.get(root.uri);
    return cached
      ? this.buildAnalysis(cached.index, resolution.activeFile, git)
      : { status: "analyzing", root, message: "Project context has not been analyzed yet." };
  }

  async updateSourceFile(
    uri: vscode.Uri,
    change: "create" | "change" | "delete"
  ): Promise<WorkspaceRoot | undefined> {
    const resolution = await this.adapter.resolveProjectRootForUri(uri);
    if (!resolution) {
      return undefined;
    }

    const root = resolution.projectRoot;
    const activeFile = resolution.activeFile;

    if (change === "change") {
      this.structuralGraphCache.delete(root.uri);
      if (activeFile && this.persistenceService) {
        void this.persistenceService.deleteFileKnowledge(root, activeFile);
      }
      return root;
    }

    const cached = this.cache.get(root.uri);
    if (!cached || !activeFile) {
      this.invalidateRoot(root.uri);
      return root;
    }

    this.structuralGraphCache.delete(root.uri);
    const generation = this.cache.begin(root);
    const index = updateProjectIndexSourcePath(cached.index, activeFile, change);
    if (change === "delete" && this.persistenceService) {
      void this.persistenceService.deleteFileKnowledge(root, activeFile);
    }
    if (this.cache.setCurrent(root, generation, index) && this.persistenceService) {
      void this.persistenceService.saveProjectCatalog(root, index);
    }
    return root;
  }

  async invalidateUri(uri: vscode.Uri): Promise<WorkspaceRoot | undefined> {
    const resolution = await this.adapter.resolveProjectRootForUri(uri);
    if (!resolution) {
      return undefined;
    }

    if (this.persistenceService) {
      void this.persistenceService.clearFileKnowledge(resolution.projectRoot);
    }
    this.structuralGraphCache.delete(resolution.projectRoot.uri);
    this.invalidateRoot(resolution.projectRoot.uri);
    return resolution.projectRoot;
  }

  invalidateRoot(rootUri: string): void {
    this.cache.invalidate(rootUri);
    this.structuralGraphCache.delete(rootUri);
    this.gitCache.delete(rootUri);
    this.gitGenerations.set(rootUri, (this.gitGenerations.get(rootUri) ?? 0) + 1);
  }

  private findCachedEntry(workspaceRoot: WorkspaceRoot, activeFile: string | undefined) {
    const entries = this.cache.values();
    const matching = entries
      .filter(
        (entry) =>
          isWorkspaceProject(entry.root, workspaceRoot) &&
          isPathInsideProject(activeFile, entry.root)
      )
      .sort((a, b) => (b.root.relativePath?.length ?? 0) - (a.root.relativePath?.length ?? 0));

    return matching[0] ?? this.cache.get(workspaceRoot.uri);
  }

  private async restorePersistentIndex(root: WorkspaceRoot): Promise<ProjectIndex | undefined> {
    if (!this.persistenceService) {
      return undefined;
    }

    const catalog = await this.persistenceService.loadProjectCatalog(root);
    if (!catalog) {
      return undefined;
    }

    const index = restoreProjectIndexFromCatalog(root, catalog);
    const generation = this.cache.begin(root);
    return this.cache.setCurrent(root, generation, index) ? index : undefined;
  }

  private async validateRestoredIndex(root: WorkspaceRoot): Promise<void> {
    const restored = this.cache.get(root.uri)?.index;
    const generation = this.cache.begin(root);
    try {
      const index = await this.scanIndex(root);
      if (!this.cache.setCurrent(root, generation, index)) {
        return;
      }
      if (this.persistenceService) {
        if (restored && projectMetadataSignature(restored) !== projectMetadataSignature(index)) {
          await this.persistenceService.clearFileKnowledge(root);
        }
        this.structuralGraphCache.delete(root.uri);
        await this.persistenceService.saveProjectCatalog(root, index);
      }
    } catch {
      // Restored project intelligence remains usable if background validation fails.
    }
  }

  private async scanIndex(root: WorkspaceRoot): Promise<ProjectIndex> {
    const sourceFiles = await this.adapter.findSourceFiles(root, scanLimit + 1);
    const scanTruncated = sourceFiles.length > scanLimit;
    const boundedSourceFiles = sourceFiles.slice(0, scanLimit);
    const metadataFiles = await this.adapter.findMetadataFiles(root);

    return buildProjectIndex({
      root,
      sourceFiles: boundedSourceFiles,
      metadataFiles,
      scanLimit,
      scanTruncated
    });
  }

  private async ensurePersistence(root: WorkspaceRoot): Promise<void> {
    if (!this.persistenceService) {
      return;
    }

    const state = await this.persistenceService.ensureProject(root);
    this.persistenceState.set(root.uri, state);
  }

  private async refreshGitForRoot(
    root: WorkspaceRoot,
    activeFile: string | undefined
  ): Promise<GitProjectState> {
    const generation = (this.gitGenerations.get(root.uri) ?? 0) + 1;
    this.gitGenerations.set(root.uri, generation);
    const git = await this.adapter.readGitState(root, activeFile);

    if (this.gitGenerations.get(root.uri) === generation) {
      this.gitCache.set(root.uri, git);
      return git;
    }

    return (
      this.gitCache.get(root.uri) ?? {
        available: false,
        isRepository: false,
        error: "A newer Git refresh is already in progress."
      }
    );
  }

  private buildAnalysis(
    index: ProjectIndex,
    activeFile: string | undefined,
    git: GitProjectState | undefined
  ): ProjectAnalysis {
    return {
      status: "ready",
      root: index.root,
      snapshot: buildProjectSnapshot({
        index,
        activeFile,
        git: git ?? {
          available: false,
          isRepository: false,
          error: "Git state has not been refreshed yet."
        }
      }),
      persistence: this.persistenceState.get(index.root.uri)
    };
  }
}

function createVsCodeProjectAdapter(): ProjectWorkspaceAdapter {
  return {
    getActiveWorkspaceRoot: resolveActiveWorkspaceRoot,
    resolveProjectRoot: resolveActiveProjectRoot,
    resolveProjectRootForUri,
    findSourceFiles: findSourceFilesForRoot,
    findMetadataFiles: findMetadataFilesForRoot,
    readSourceDocument: readSourceDocumentForRoot,
    readGitState: async (root, activeFile) =>
      root.uri.startsWith("file:")
        ? readGitState({ rootPath: vscode.Uri.parse(root.uri).fsPath, activeFile })
        : {
            available: false,
            isRepository: false,
            error: "Git state is unavailable for non-file workspace roots."
          }
  };
}

async function findSourceFilesForRoot(
  root: WorkspaceRoot,
  limit: number
): Promise<readonly ProjectFileRecord[]> {
  const folderUri = vscode.Uri.parse(root.uri);
  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folderUri, sourceIncludePattern),
    excludePattern,
    limit
  );

  return uris
    .map((uri) => uriRelativePath(uri, folderUri))
    .filter((path) => !isIgnoredProjectPath(path))
    .map((relativePath) => ({ relativePath }));
}

async function readSourceDocumentForRoot(
  root: WorkspaceRoot,
  relativePath: string
): Promise<Pick<LanguageDocumentInput, "uri" | "fileName" | "languageId" | "text"> | undefined> {
  const languageId = languageIdForSourcePath(relativePath);
  if (!languageId) {
    return undefined;
  }

  const uri = vscode.Uri.joinPath(vscode.Uri.parse(root.uri), ...relativePath.split("/"));
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type === vscode.FileType.Directory || stat.size > backgroundSourceReadLimitBytes) {
      return undefined;
    }
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    return {
      uri: uri.toString(),
      fileName: fileName(relativePath),
      languageId,
      text
    };
  } catch {
    return undefined;
  }
}

function languageIdForSourcePath(relativePath: string): string | undefined {
  switch (extension(relativePath)) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "typescriptreact";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "javascriptreact";
    case ".py":
      return "python";
    case ".java":
      return "java";
    default:
      return undefined;
  }
}

async function findMetadataFilesForRoot(
  root: WorkspaceRoot
): Promise<readonly ProjectFileRecord[]> {
  const folderUri = vscode.Uri.parse(root.uri);
  const records = await Promise.all(
    metadataFileNames.map(async (name): Promise<ProjectFileRecord | undefined> => {
      const uri = vscode.Uri.joinPath(folderUri, name);
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.Directory) {
          return undefined;
        }

        const relativePath = name;
        if (!isKnownMetadataFile(relativePath) || stat.size > metadataReadLimitBytes) {
          return { relativePath };
        }

        const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        return { relativePath, content };
      } catch {
        return undefined;
      }
    })
  );

  return records.filter((record): record is ProjectFileRecord => record !== undefined);
}

function resolveActiveWorkspaceRoot(): WorkspaceRoot | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const folder =
    activeUri && activeUri.scheme !== "untitled"
      ? vscode.workspace.getWorkspaceFolder(activeUri)
      : vscode.workspace.workspaceFolders?.[0];

  return folder ? toWorkspaceRoot(folder) : undefined;
}

function toWorkspaceRoot(folder: vscode.WorkspaceFolder): WorkspaceRoot {
  return {
    name: folder.name,
    uri: folder.uri.toString(),
    path: folder.uri.fsPath || folder.uri.path
  };
}

async function resolveActiveProjectRoot(
  activeEditor: ActiveEditorContext | undefined
): Promise<ProjectRootResolution | undefined> {
  const workspaceRoot = resolveActiveWorkspaceRoot();
  if (!workspaceRoot) {
    return undefined;
  }

  if (!activeEditor?.relativePath) {
    return resolveProjectRootFromMarkers({ workspaceRoot, markerPaths: [] });
  }

  const markerPaths = await findAncestorProjectMarkers(
    vscode.Uri.parse(workspaceRoot.uri),
    activeEditor.relativePath
  );
  return resolveProjectRootFromMarkers({
    workspaceRoot,
    activeFile: activeEditor.relativePath,
    markerPaths
  });
}

async function resolveProjectRootForUri(
  uri: vscode.Uri
): Promise<ProjectRootResolution | undefined> {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    return undefined;
  }

  const workspaceRoot = toWorkspaceRoot(folder);
  const activeFile = uriRelativePath(uri, folder.uri);
  const markerPaths = isStrongProjectMarker(activeFile)
    ? [activeFile, ...(await findAncestorProjectMarkers(folder.uri, activeFile))]
    : await findAncestorProjectMarkers(folder.uri, activeFile);

  return resolveProjectRootFromMarkers({ workspaceRoot, activeFile, markerPaths });
}

async function findAncestorProjectMarkers(
  workspaceUri: vscode.Uri,
  workspaceRelativePath: string
): Promise<readonly string[]> {
  const markers: string[] = [];
  const directories = ancestorDirectories(dirname(workspaceRelativePath));

  for (const directory of directories) {
    for (const marker of strongProjectMarkerNames) {
      const relativePath = directory ? `${directory}/${marker}` : marker;
      const uri = vscode.Uri.joinPath(workspaceUri, ...relativePath.split("/"));
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type !== vscode.FileType.Directory) {
          markers.push(relativePath);
        }
      } catch {
        // Missing markers are expected while walking ancestors.
      }
    }
  }

  return markers;
}

function ancestorDirectories(startDirectory: string): readonly string[] {
  const directories: string[] = [];
  let current = normalizePath(startDirectory);

  directories.push(current);
  while (current) {
    current = dirname(current);
    directories.push(current);
  }

  return directories;
}

function uriRelativePath(uri: vscode.Uri, rootUri: vscode.Uri): string {
  const rootPath = normalizePath(rootUri.path);
  const childPath = normalizePath(uri.path);
  return childPath === rootPath
    ? ""
    : childPath.startsWith(`${rootPath}/`)
      ? childPath.slice(rootPath.length + 1)
      : normalizePath(vscode.workspace.asRelativePath(uri, false));
}

function projectMetadataSignature(index: ProjectIndex): string {
  return JSON.stringify({
    manifestFiles: index.manifestFiles,
    configFiles: index.configFiles,
    tools: index.tools,
    scripts: index.scripts,
    packageNames: index.metadata.packageNames
  });
}

function isWorkspaceProject(projectRoot: WorkspaceRoot, workspaceRoot: WorkspaceRoot): boolean {
  return (
    projectRoot.uri === workspaceRoot.uri ||
    projectRoot.containingWorkspaceUri === workspaceRoot.uri ||
    projectRoot.uri.startsWith(`${workspaceRoot.uri.replace(/\/$/, "")}/`)
  );
}
