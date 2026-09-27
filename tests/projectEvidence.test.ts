import { describe, expect, it } from "vitest";

import { buildProjectEvidencePackage } from "../src/project/projectEvidence";
import type { StructuralGraph } from "../src/project/structuralGraph";

const graph: StructuralGraph = {
  projectId: "2c0df18a-8ac2-4b68-84e3-0b6f2c3d6d41",
  totalFileCount: 3,
  indexedFileCount: 3,
  fileCount: 3,
  symbolCount: 2,
  relationshipCount: 2,
  nodes: [
    {
      id: "file:src/routes.ts",
      kind: "file",
      file: "src/routes.ts",
      frameworks: ["express"],
      frameworkRoles: ["router", "route-handler"],
      entryPointSignals: []
    },
    {
      id: "file:src/services/UserService.ts",
      kind: "file",
      file: "src/services/UserService.ts",
      frameworks: [],
      frameworkRoles: ["service"],
      entryPointSignals: []
    },
    {
      id: "file:src/services/UserService.test.ts",
      kind: "file",
      file: "src/services/UserService.test.ts",
      frameworks: [],
      frameworkRoles: [],
      entryPointSignals: []
    },
    {
      id: "symbol:src/routes.ts:2:0:function:registerRoutes",
      kind: "symbol",
      file: "src/routes.ts",
      name: "registerRoutes",
      symbolKind: "function",
      line: 2
    },
    {
      id: "symbol:src/services/UserService.ts:5:0:class:UserService",
      kind: "symbol",
      file: "src/services/UserService.ts",
      name: "UserService",
      symbolKind: "class",
      line: 5
    }
  ],
  edges: [
    {
      id: "calls:file:src/routes.ts->file:src/services/UserService.ts",
      type: "calls",
      from: "file:src/routes.ts",
      to: "file:src/services/UserService.ts",
      fromFile: "src/routes.ts",
      toFile: "src/services/UserService.ts",
      confidence: "medium",
      reason: "registerRoutes calls UserService."
    },
    {
      id: "related-test:file:src/services/UserService.ts->file:src/services/UserService.test.ts",
      type: "related-test",
      from: "file:src/services/UserService.ts",
      to: "file:src/services/UserService.test.ts",
      fromFile: "src/services/UserService.ts",
      toFile: "src/services/UserService.test.ts",
      confidence: "high",
      reason: "Related test."
    }
  ]
};

describe("project evidence packages", () => {
  it("packages ranked files, symbol lines and structural reasons without source contents", () => {
    const evidence = buildProjectEvidencePackage({
      graph,
      activeFile: "src/routes.ts",
      query: "Where is UserService handled?",
      limit: 5
    });

    expect(evidence.projectId).toBe(graph.projectId);
    expect(evidence.activeFile).toBe("src/routes.ts");
    expect(evidence.files[0]).toMatchObject({
      file: "src/services/UserService.ts",
      roles: ["service"]
    });
    expect(evidence.symbols).toContainEqual({
      file: "src/services/UserService.ts",
      line: 5,
      name: "UserService",
      kind: "class"
    });
    expect(evidence.relationships).toContainEqual(
      expect.objectContaining({
        type: "calls",
        fromFile: "src/routes.ts",
        toFile: "src/services/UserService.ts"
      })
    );
    expect(evidence.coverage).toEqual({ indexedFiles: 3, totalFiles: 3 });
    expect(JSON.stringify(evidence)).not.toContain("sourceText");
  });

  it("keeps evidence bounded to selected files and their relationships", () => {
    const evidence = buildProjectEvidencePackage({
      graph,
      activeFile: "src/routes.ts",
      query: "UserService",
      limit: 1
    });

    expect(evidence.files).toHaveLength(1);
    expect(evidence.files[0]?.file).toBe("src/services/UserService.ts");
    expect(
      evidence.relationships.some(
        (relationship) => relationship.toFile === "src/services/UserService.test.ts"
      )
    ).toBe(false);
  });
});
