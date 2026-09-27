import type { ProjectPersistenceSummary, WorkspaceRoot } from "../core/models";
import type { FrameworkDetection } from "../framework/models";
import type { LanguageAnalysis, LanguageDocumentInput } from "../language/models";
import {
  createProjectCatalog,
  parseProjectCatalog,
  serializeProjectCatalog,
  type PersistentProjectCatalog
} from "./projectCatalog";
import {
  createProjectIdentity,
  parseProjectIdentity,
  serializeProjectIdentity,
  type ProjectIdentity,
  type ProjectIdentityFactory
} from "./projectIdentity";
import {
  createPersistentFileKnowledge,
  parsePersistentFileKnowledge,
  projectKnowledgeKey,
  serializePersistentFileKnowledge,
  type PersistentFileKnowledge
} from "./projectKnowledge";
import { normalizePath } from "./pathUtils";
import type { ProjectIndex } from "./projectScanner";

export const projectStorageSchemaVersion = 1 as const;

export interface ProjectPersistenceAdapter {
  readonly readProjectIdentity: (root: WorkspaceRoot) => Promise<string | undefined>;
  readonly writeProjectIdentity: (root: WorkspaceRoot, content: string) => Promise<void>;
  readonly ensureProjectMetadataIgnored?: (root: WorkspaceRoot) => Promise<void>;
  readonly writeProjectManifest: (projectId: string, content: string) => Promise<void>;
  readonly readProjectCatalog: (projectId: string) => Promise<string | undefined>;
  readonly writeProjectCatalog: (projectId: string, content: string) => Promise<void>;
  readonly readProjectKnowledge: (
    projectId: string,
    knowledgeKey: string
  ) => Promise<string | undefined>;
  readonly writeProjectKnowledge: (
    projectId: string,
    knowledgeKey: string,
    content: string
  ) => Promise<void>;
  readonly deleteProjectKnowledge: (projectId: string, knowledgeKey: string) => Promise<void>;
  readonly deleteAllProjectKnowledge: (projectId: string) => Promise<void>;
  readonly deleteProjectStorage: (projectId: string) => Promise<void>;
}

export interface PersistentProjectManifest {
  readonly schemaVersion: typeof projectStorageSchemaVersion;
  readonly projectId: string;
  readonly createdAt: string;
  readonly lastOpenedAt: string;
  readonly lastKnownRootUri: string;
}

export type ProjectPersistenceDependencies = ProjectIdentityFactory;

export class ProjectPersistenceService {
  private readonly stateByRoot = new Map<string, ProjectPersistenceSummary>();
  private readonly pendingByRoot = new Map<string, Promise<ProjectPersistenceSummary>>();

  constructor(
    private readonly adapter: ProjectPersistenceAdapter,
    private readonly dependencies: ProjectPersistenceDependencies = {}
  ) {}

  getState(rootUri: string): ProjectPersistenceSummary | undefined {
    return this.stateByRoot.get(rootUri);
  }

  async ensureProject(root: WorkspaceRoot): Promise<ProjectPersistenceSummary> {
    const cached = this.stateByRoot.get(root.uri);
    if (cached?.status === "ready") {
      return cached;
    }

    const pending = this.pendingByRoot.get(root.uri);
    if (pending) {
      return pending;
    }

    const next = this.ensureProjectInternal(root).finally(() => {
      this.pendingByRoot.delete(root.uri);
    });
    this.pendingByRoot.set(root.uri, next);
    return next;
  }

  async loadProjectCatalog(root: WorkspaceRoot): Promise<PersistentProjectCatalog | undefined> {
    const state = await this.ensureProject(root);
    if (state.status !== "ready" || !state.projectId) {
      return undefined;
    }

    try {
      const content = await this.adapter.readProjectCatalog(state.projectId);
      if (!content) {
        return undefined;
      }
      const catalog = parseProjectCatalog(content);
      return catalog?.projectId === state.projectId ? catalog : undefined;
    } catch {
      return undefined;
    }
  }

  async saveProjectCatalog(root: WorkspaceRoot, index: ProjectIndex): Promise<boolean> {
    const state = await this.ensureProject(root);
    if (state.status !== "ready" || !state.projectId) {
      return false;
    }

    try {
      const catalog = createProjectCatalog(state.projectId, index, this.dependencies.now);
      await this.adapter.writeProjectCatalog(state.projectId, serializeProjectCatalog(catalog));
      return true;
    } catch {
      return false;
    }
  }

  async saveFileKnowledge(
    root: WorkspaceRoot,
    document: Pick<
      LanguageDocumentInput,
      "projectRelativePath" | "relativePath" | "fileName" | "languageId" | "text"
    >,
    analysis: LanguageAnalysis,
    frameworks: readonly FrameworkDetection[]
  ): Promise<boolean> {
    const state = await this.ensureProject(root);
    if (state.status !== "ready" || !state.projectId) {
      return false;
    }

    const relativePath = document.projectRelativePath ?? document.relativePath ?? document.fileName;
    try {
      const knowledge = createPersistentFileKnowledge({
        projectId: state.projectId,
        document,
        analysis,
        frameworks,
        now: this.dependencies.now
      });
      await this.adapter.writeProjectKnowledge(
        state.projectId,
        projectKnowledgeKey(relativePath),
        serializePersistentFileKnowledge(knowledge)
      );
      return true;
    } catch {
      return false;
    }
  }

  async loadFileKnowledge(
    root: WorkspaceRoot,
    relativePath: string
  ): Promise<PersistentFileKnowledge | undefined> {
    const state = await this.ensureProject(root);
    if (state.status !== "ready" || !state.projectId) {
      return undefined;
    }

    try {
      const content = await this.adapter.readProjectKnowledge(
        state.projectId,
        projectKnowledgeKey(relativePath)
      );
      if (!content) {
        return undefined;
      }
      const knowledge = parsePersistentFileKnowledge(content);
      return knowledge?.projectId === state.projectId ? knowledge : undefined;
    } catch {
      return undefined;
    }
  }

  async loadProjectKnowledge(
    root: WorkspaceRoot,
    relativePaths: readonly string[],
    limit = 1000
  ): Promise<readonly PersistentFileKnowledge[]> {
    const boundedPaths = [...new Set(relativePaths.map(normalizePath))].slice(
      0,
      Math.max(0, limit)
    );
    const records: PersistentFileKnowledge[] = [];
    const batchSize = 32;

    for (let index = 0; index < boundedPaths.length; index += batchSize) {
      const batch = boundedPaths.slice(index, index + batchSize);
      const loaded = await Promise.all(
        batch.map((relativePath) => this.loadFileKnowledge(root, relativePath))
      );
      for (const knowledge of loaded) {
        if (knowledge) {
          records.push(knowledge);
        }
      }
    }

    return records;
  }

  async deleteFileKnowledge(root: WorkspaceRoot, relativePath: string): Promise<boolean> {
    const state = await this.ensureProject(root);
    if (state.status !== "ready" || !state.projectId) {
      return false;
    }

    try {
      await this.adapter.deleteProjectKnowledge(state.projectId, projectKnowledgeKey(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async clearFileKnowledge(root: WorkspaceRoot): Promise<boolean> {
    const state = await this.ensureProject(root);
    if (state.status !== "ready" || !state.projectId) {
      return false;
    }

    try {
      await this.adapter.deleteAllProjectKnowledge(state.projectId);
      return true;
    } catch {
      return false;
    }
  }

  async clearProjectData(root: WorkspaceRoot): Promise<boolean> {
    const state = await this.ensureProject(root);
    if (state.status !== "ready" || !state.projectId) {
      return false;
    }

    try {
      await this.adapter.deleteProjectStorage(state.projectId);
      this.stateByRoot.delete(root.uri);
      return true;
    } catch {
      return false;
    }
  }

  clearCachedState(rootUri: string): void {
    this.stateByRoot.delete(rootUri);
  }

  private async ensureProjectInternal(root: WorkspaceRoot): Promise<ProjectPersistenceSummary> {
    try {
      const existing = await this.adapter.readProjectIdentity(root);
      const identity = existing
        ? parseProjectIdentity(existing)
        : createProjectIdentity(this.dependencies);
      const identityCreated = existing === undefined;

      if (identityCreated) {
        await this.adapter.writeProjectIdentity(root, serializeProjectIdentity(identity));
      }

      try {
        await this.adapter.ensureProjectMetadataIgnored?.(root);
      } catch {
        // Keeping local project metadata out of Git is best-effort and must not disable persistence.
      }

      const manifest = createPersistentManifest(identity, root, this.dependencies.now);
      await this.adapter.writeProjectManifest(
        identity.projectId,
        `${JSON.stringify(manifest, null, 2)}\n`
      );

      const state: ProjectPersistenceSummary = {
        status: "ready",
        projectId: identity.projectId,
        identityCreated
      };
      this.stateByRoot.set(root.uri, state);
      return state;
    } catch (error) {
      const state: ProjectPersistenceSummary = {
        status: "unavailable",
        message: error instanceof Error ? error.message : "Project persistence is unavailable."
      };
      this.stateByRoot.set(root.uri, state);
      return state;
    }
  }
}

function createPersistentManifest(
  identity: ProjectIdentity,
  root: WorkspaceRoot,
  nowFactory: (() => Date) | undefined
): PersistentProjectManifest {
  const now = nowFactory ?? (() => new Date());
  return {
    schemaVersion: projectStorageSchemaVersion,
    projectId: identity.projectId,
    createdAt: identity.createdAt,
    lastOpenedAt: now().toISOString(),
    lastKnownRootUri: root.uri
  };
}
