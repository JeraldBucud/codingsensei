import { describe, expect, it } from "vitest";

import type { StructuralGraph } from "../src/project/structuralGraph";
import { retrieveStructuralContext } from "../src/project/structuralRetrieval";

const graph: StructuralGraph = {
  projectId: "2c0df18a-8ac2-4b68-84e3-0b6f2c3d6d41",
  totalFileCount: 4,
  indexedFileCount: 4,
  fileCount: 4,
  symbolCount: 3,
  relationshipCount: 3,
  nodes: [
    { id: "file:src/App.tsx", kind: "file", file: "src/App.tsx" },
    { id: "file:src/UserService.ts", kind: "file", file: "src/UserService.ts" },
    { id: "file:src/App.test.tsx", kind: "file", file: "src/App.test.tsx" },
    { id: "file:src/routes.ts", kind: "file", file: "src/routes.ts" },
    {
      id: "symbol:src/App.tsx:1:0:function:App",
      kind: "symbol",
      file: "src/App.tsx",
      name: "App",
      symbolKind: "function",
      line: 1
    },
    {
      id: "symbol:src/UserService.ts:0:0:class:UserService",
      kind: "symbol",
      file: "src/UserService.ts",
      name: "UserService",
      symbolKind: "class",
      line: 0
    },
    {
      id: "symbol:src/routes.ts:2:0:function:registerRoutes",
      kind: "symbol",
      file: "src/routes.ts",
      name: "registerRoutes",
      symbolKind: "function",
      line: 2
    }
  ],
  edges: [
    {
      id: "imports:file:src/App.tsx->file:src/UserService.ts",
      type: "imports",
      from: "file:src/App.tsx",
      to: "file:src/UserService.ts",
      fromFile: "src/App.tsx",
      toFile: "src/UserService.ts",
      confidence: "high",
      reason: "Resolved local import."
    },
    {
      id: "related-test:file:src/App.tsx->file:src/App.test.tsx",
      type: "related-test",
      from: "file:src/App.tsx",
      to: "file:src/App.test.tsx",
      fromFile: "src/App.tsx",
      toFile: "src/App.test.tsx",
      confidence: "high",
      reason: "Matches a common source/test naming convention."
    },
    {
      id: "imports:file:src/routes.ts->file:src/UserService.ts",
      type: "imports",
      from: "file:src/routes.ts",
      to: "file:src/UserService.ts",
      fromFile: "src/routes.ts",
      toFile: "src/UserService.ts",
      confidence: "medium",
      reason: "Resolved local import."
    }
  ]
};

describe("structural retrieval", () => {
  it("prioritizes files directly related to the active file", () => {
    const results = retrieveStructuralContext(graph, {
      activeFile: "src/App.tsx",
      limit: 5
    });

    expect(results[0]?.file).toBe("src/UserService.ts");
    expect(results.some((item) => item.file === "src/App.test.tsx")).toBe(true);
    expect(results[0]?.reasons[0]).toContain("direct");
  });

  it("uses symbol matches to answer project-wide structural queries", () => {
    const results = retrieveStructuralContext(graph, {
      query: "Where is UserService handled?",
      limit: 5
    });

    expect(results[0]?.file).toBe("src/UserService.ts");
    expect(results[0]?.matchedSymbols).toContain("UserService");
    expect(results[0]?.line).toBe(0);
  });

  it("combines query and active-file evidence deterministically", () => {
    const results = retrieveStructuralContext(graph, {
      activeFile: "src/routes.ts",
      query: "user service",
      limit: 5
    });

    expect(results[0]?.file).toBe("src/UserService.ts");
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });
});
