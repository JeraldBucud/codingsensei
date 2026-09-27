import { describe, expect, it } from "vitest";

import type { WorkspaceRoot } from "../src/core/models";
import type { LanguageAnalysis } from "../src/language/models";
import { buildProjectIndex } from "../src/project/projectScanner";
import {
  ProjectPersistenceService,
  type ProjectPersistenceAdapter
} from "../src/project/projectPersistence";

const projectId = "2c0df18a-8ac2-4b68-84e3-0b6f2c3d6d41";
const root: WorkspaceRoot = {
  name: "demo",
  uri: "file:///demo",
  path: "/demo"
};

function createMemoryAdapter() {
  const identities = new Map<string, string>();
  const manifests = new Map<string, string>();
  const catalogs = new Map<string, string>();
  const knowledge = new Map<string, string>();
  let identityWrites = 0;
  let metadataIgnoreWrites = 0;
  let manifestWrites = 0;
  let catalogWrites = 0;
  let storageDeletes = 0;

  const adapter: ProjectPersistenceAdapter = {
    readProjectIdentity: (projectRoot) => Promise.resolve(identities.get(projectRoot.uri)),
    writeProjectIdentity: (projectRoot, content) => {
      identityWrites += 1;
      identities.set(projectRoot.uri, content);
      return Promise.resolve();
    },
    ensureProjectMetadataIgnored: () => {
      metadataIgnoreWrites += 1;
      return Promise.resolve();
    },
    writeProjectManifest: (id, content) => {
      manifestWrites += 1;
      manifests.set(id, content);
      return Promise.resolve();
    },
    readProjectCatalog: (id) => Promise.resolve(catalogs.get(id)),
    writeProjectCatalog: (id, content) => {
      catalogWrites += 1;
      catalogs.set(id, content);
      return Promise.resolve();
    },
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
    deleteProjectStorage: (id) => {
      storageDeletes += 1;
      manifests.delete(id);
      catalogs.delete(id);
      for (const key of [...knowledge.keys()]) {
        if (key.startsWith(`${id}:`)) {
          knowledge.delete(key);
        }
      }
      return Promise.resolve();
    }
  };

  return {
    adapter,
    identities,
    manifests,
    catalogs,
    knowledge,
    identityWrites: () => identityWrites,
    metadataIgnoreWrites: () => metadataIgnoreWrites,
    manifestWrites: () => manifestWrites,
    catalogWrites: () => catalogWrites,
    storageDeletes: () => storageDeletes
  };
}

describe("project persistence service", () => {
  it("creates a tiny project identity and a local external manifest once", async () => {
    const memory = createMemoryAdapter();
    const service = new ProjectPersistenceService(memory.adapter, {
      createId: () => projectId,
      now: () => new Date("2026-09-26T14:30:00.000Z")
    });

    const first = await service.ensureProject(root);
    const second = await service.ensureProject(root);

    expect(first).toEqual({
      status: "ready",
      projectId,
      identityCreated: true
    });
    expect(second).toEqual(first);
    expect(memory.identityWrites()).toBe(1);
    expect(memory.metadataIgnoreWrites()).toBe(1);
    expect(memory.manifestWrites()).toBe(1);
    expect(JSON.parse(memory.identities.get(root.uri) ?? "{}")).toMatchObject({
      schemaVersion: 1,
      projectId
    });
    expect(JSON.parse(memory.manifests.get(projectId) ?? "{}")).toEqual({
      schemaVersion: 1,
      projectId,
      createdAt: "2026-09-26T14:30:00.000Z",
      lastOpenedAt: "2026-09-26T14:30:00.000Z",
      lastKnownRootUri: root.uri
    });
  });

  it("does not fail persistence when self-ignore metadata cannot be written", async () => {
    const memory = createMemoryAdapter();
    const adapter: ProjectPersistenceAdapter = {
      ...memory.adapter,
      ensureProjectMetadataIgnored: () => Promise.reject(new Error("read-only ignore file"))
    };
    const service = new ProjectPersistenceService(adapter, {
      createId: () => projectId,
      now: () => new Date("2026-09-26T14:30:00.000Z")
    });

    const state = await service.ensureProject(root);

    expect(state).toEqual({
      status: "ready",
      projectId,
      identityCreated: true
    });
    expect(memory.identities.get(root.uri)).toBeDefined();
    expect(memory.manifests.get(projectId)).toBeDefined();
  });

  it("reuses an existing identity when the same project appears at a new root", async () => {
    const memory = createMemoryAdapter();
    const original = new ProjectPersistenceService(memory.adapter, {
      createId: () => projectId,
      now: () => new Date("2026-09-26T14:30:00.000Z")
    });
    await original.ensureProject(root);

    const movedRoot: WorkspaceRoot = {
      name: "demo-renamed",
      uri: "file:///moved/demo-renamed",
      path: "/moved/demo-renamed"
    };
    memory.identities.set(movedRoot.uri, memory.identities.get(root.uri) ?? "");

    const reopened = new ProjectPersistenceService(memory.adapter, {
      createId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      now: () => new Date("2026-09-27T01:00:00.000Z")
    });
    const state = await reopened.ensureProject(movedRoot);

    expect(state.projectId).toBe(projectId);
    expect(state.identityCreated).toBe(false);
    expect(JSON.parse(memory.manifests.get(projectId) ?? "{}")).toMatchObject({
      projectId,
      lastOpenedAt: "2026-09-27T01:00:00.000Z",
      lastKnownRootUri: movedRoot.uri
    });
  });

  it("persists and reloads a structural project catalog across service instances", async () => {
    const memory = createMemoryAdapter();
    const service = new ProjectPersistenceService(memory.adapter, {
      createId: () => projectId,
      now: () => new Date("2026-09-26T14:30:00.000Z")
    });
    const index = buildProjectIndex({
      root,
      sourceFiles: [{ relativePath: "src/app.ts" }, { relativePath: "src/app.test.ts" }],
      metadataFiles: [{ relativePath: "package.json", content: "{}" }],
      scanLimit: 2500,
      scanTruncated: false
    });

    expect(await service.saveProjectCatalog(root, index)).toBe(true);
    expect(memory.catalogWrites()).toBe(1);

    const reopened = new ProjectPersistenceService(memory.adapter, {
      now: () => new Date("2026-09-27T01:00:00.000Z")
    });
    const catalog = await reopened.loadProjectCatalog(root);

    expect(catalog).toMatchObject({
      schemaVersion: 1,
      projectId,
      sourceFiles: ["src/app.ts"],
      testFiles: ["src/app.test.ts"],
      codeFiles: ["src/app.test.ts", "src/app.ts"]
    });
  });

  it("persists file knowledge without storing source contents", async () => {
    const memory = createMemoryAdapter();
    const service = new ProjectPersistenceService(memory.adapter, {
      createId: () => projectId,
      now: () => new Date("2026-09-27T02:00:00.000Z")
    });
    const analysis: LanguageAnalysis = {
      status: "available",
      file: "src/app.ts",
      languageId: "typescript",
      source: "deterministic",
      symbols: [],
      imports: [],
      relationships: [],
      entryPointSignals: [],
      truncated: false
    };
    const sourceText = "const secretLookingValue = 42;";

    expect(
      await service.saveFileKnowledge(
        root,
        {
          fileName: "app.ts",
          projectRelativePath: "src/app.ts",
          languageId: "typescript",
          text: sourceText
        },
        analysis,
        []
      )
    ).toBe(true);

    const loaded = await service.loadFileKnowledge(root, "src/app.ts");
    expect(loaded).toMatchObject({
      projectId,
      relativePath: "src/app.ts",
      languageId: "typescript"
    });
    expect(JSON.stringify([...memory.knowledge.values()])).not.toContain(sourceText);

    expect(await service.deleteFileKnowledge(root, "src/app.ts")).toBe(true);
    expect(await service.loadFileKnowledge(root, "src/app.ts")).toBeUndefined();
  });

  it("loads project knowledge in bounded path order", async () => {
    const memory = createMemoryAdapter();
    const service = new ProjectPersistenceService(memory.adapter, {
      createId: () => projectId,
      now: () => new Date("2026-09-27T02:00:00.000Z")
    });
    const analysis: LanguageAnalysis = {
      status: "available",
      file: "src/app.ts",
      languageId: "typescript",
      source: "deterministic",
      symbols: [],
      imports: [],
      relationships: [],
      entryPointSignals: [],
      truncated: false
    };

    for (const relativePath of ["src/a.ts", "src/b.ts", "src/c.ts"]) {
      await service.saveFileKnowledge(
        root,
        {
          fileName: relativePath.split("/").at(-1) ?? relativePath,
          projectRelativePath: relativePath,
          languageId: "typescript",
          text: `export const value = "${relativePath}";`
        },
        analysis,
        []
      );
    }

    const loaded = await service.loadProjectKnowledge(
      root,
      ["src/a.ts", "src/b.ts", "src/c.ts"],
      2
    );

    expect(loaded.map((record) => record.relativePath)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("clears persisted file knowledge without removing the project catalog", async () => {
    const memory = createMemoryAdapter();
    const service = new ProjectPersistenceService(memory.adapter, {
      createId: () => projectId,
      now: () => new Date("2026-09-27T02:00:00.000Z")
    });
    const index = buildProjectIndex({
      root,
      sourceFiles: [{ relativePath: "src/app.ts" }],
      metadataFiles: [{ relativePath: "package.json", content: "{}" }],
      scanLimit: 2500,
      scanTruncated: false
    });
    const analysis: LanguageAnalysis = {
      status: "available",
      file: "src/app.ts",
      languageId: "typescript",
      source: "deterministic",
      symbols: [],
      imports: [],
      relationships: [],
      entryPointSignals: [],
      truncated: false
    };

    await service.saveProjectCatalog(root, index);
    await service.saveFileKnowledge(
      root,
      {
        fileName: "app.ts",
        projectRelativePath: "src/app.ts",
        languageId: "typescript",
        text: "export const value = 1;"
      },
      analysis,
      []
    );

    expect(await service.clearFileKnowledge(root)).toBe(true);
    expect(await service.loadFileKnowledge(root, "src/app.ts")).toBeUndefined();
    expect(await service.loadProjectCatalog(root)).toBeDefined();
  });

  it("clears external project data without deleting the stable project identity", async () => {
    const memory = createMemoryAdapter();
    const service = new ProjectPersistenceService(memory.adapter, {
      createId: () => projectId,
      now: () => new Date("2026-09-26T14:30:00.000Z")
    });
    const index = buildProjectIndex({
      root,
      sourceFiles: [{ relativePath: "src/app.ts" }],
      metadataFiles: [],
      scanLimit: 2500,
      scanTruncated: false
    });
    await service.saveProjectCatalog(root, index);

    expect(await service.clearProjectData(root)).toBe(true);
    expect(memory.storageDeletes()).toBe(1);
    expect(memory.catalogs.get(projectId)).toBeUndefined();
    expect(memory.identities.get(root.uri)).toBeDefined();

    const reopened = await service.ensureProject(root);
    expect(reopened.projectId).toBe(projectId);
    expect(reopened.identityCreated).toBe(false);
  });

  it("does not overwrite a malformed identity file", async () => {
    const memory = createMemoryAdapter();
    memory.identities.set(root.uri, '{"schemaVersion":1,"projectId":"broken"}');
    const service = new ProjectPersistenceService(memory.adapter, {
      createId: () => projectId
    });

    const state = await service.ensureProject(root);

    expect(state.status).toBe("unavailable");
    expect(state.message).toContain("invalid projectId");
    expect(memory.identityWrites()).toBe(0);
    expect(memory.manifestWrites()).toBe(0);
  });
});
