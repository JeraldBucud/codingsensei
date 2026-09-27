import { describe, expect, it } from "vitest";

import type { PersistentProjectCatalog } from "../src/project/projectCatalog";
import type { PersistentFileKnowledge } from "../src/project/projectKnowledge";
import { buildStructuralGraph } from "../src/project/structuralGraph";

const projectId = "2c0df18a-8ac2-4b68-84e3-0b6f2c3d6d41";

const catalog: PersistentProjectCatalog = {
  schemaVersion: 1,
  projectId,
  savedAt: "2026-09-27T13:00:00.000Z",
  scanLimit: 2500,
  scanTruncated: false,
  allPaths: ["src/App.tsx", "src/UserService.ts", "src/App.test.tsx", "package.json"],
  codeFiles: ["src/App.test.tsx", "src/App.tsx", "src/UserService.ts"],
  sourceFiles: ["src/App.tsx", "src/UserService.ts"],
  testFiles: ["src/App.test.tsx"],
  manifestFiles: ["package.json"],
  configFiles: [],
  sourceRoots: ["src"],
  testRoots: [],
  ecosystems: ["typescript"],
  tools: [],
  scripts: [],
  metadata: { packageNames: ["react"] }
};

function knowledge(input: {
  file: string;
  symbols?: PersistentFileKnowledge["symbols"];
  imports?: PersistentFileKnowledge["imports"];
  relationships?: PersistentFileKnowledge["relationships"];
}): PersistentFileKnowledge {
  return {
    schemaVersion: 1,
    projectId,
    relativePath: input.file,
    languageId: input.file.endsWith(".tsx") ? "typescriptreact" : "typescript",
    contentHash: "a".repeat(64),
    indexedAt: "2026-09-27T13:00:00.000Z",
    analysisSource: "deterministic",
    symbols: input.symbols ?? [],
    imports: input.imports ?? [],
    relationships: input.relationships ?? [],
    entryPointSignals: [],
    frameworks: [],
    truncated: false
  };
}

describe("structural graph", () => {
  it("builds file, symbol, import and test relationships from persistent knowledge", () => {
    const graph = buildStructuralGraph({
      catalog,
      knowledge: [
        knowledge({
          file: "src/App.tsx",
          symbols: [
            {
              name: "App",
              kind: "function",
              range: { startLine: 1, startCharacter: 0, endLine: 5, endCharacter: 1 },
              selectionRange: { startLine: 1, startCharacter: 16, endLine: 1, endCharacter: 19 }
            }
          ],
          imports: [
            {
              type: "import",
              target: "./UserService",
              targetFile: "src/UserService.ts",
              confidence: "high",
              reason: "Resolved local import."
            }
          ],
          relationships: [
            {
              type: "call",
              target: "UserService",
              symbol: "UserService",
              sourceSymbol: "App",
              confidence: "medium",
              reason: "App calls UserService."
            }
          ]
        }),
        knowledge({
          file: "src/UserService.ts",
          symbols: [
            {
              name: "UserService",
              kind: "class",
              range: { startLine: 0, startCharacter: 0, endLine: 8, endCharacter: 1 },
              selectionRange: { startLine: 0, startCharacter: 13, endLine: 0, endCharacter: 24 }
            }
          ]
        })
      ]
    });

    expect(graph.fileCount).toBe(3);
    expect(graph.indexedFileCount).toBe(2);
    expect(graph.symbolCount).toBe(2);
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "imports" &&
          edge.fromFile === "src/App.tsx" &&
          edge.toFile === "src/UserService.ts"
      )
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "calls" &&
          edge.fromFile === "src/App.tsx" &&
          edge.toFile === "src/UserService.ts" &&
          edge.from.startsWith("symbol:src/App.tsx:") &&
          edge.to.startsWith("symbol:src/UserService.ts:")
      )
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.type === "related-test" &&
          edge.fromFile === "src/App.tsx" &&
          edge.toFile === "src/App.test.tsx"
      )
    ).toBe(true);
    expect(graph.edges.filter((edge) => edge.type === "contains")).toHaveLength(2);
  });

  it("does not infer a cross-file call from a matching symbol name without dependency evidence", () => {
    const graph = buildStructuralGraph({
      catalog,
      knowledge: [
        knowledge({
          file: "src/App.tsx",
          symbols: [
            {
              name: "App",
              kind: "function",
              range: { startLine: 0, startCharacter: 0, endLine: 2, endCharacter: 1 },
              selectionRange: { startLine: 0, startCharacter: 9, endLine: 0, endCharacter: 12 }
            }
          ],
          relationships: [
            {
              type: "call",
              target: "UserService",
              symbol: "UserService",
              sourceSymbol: "App",
              confidence: "medium",
              reason: "App calls UserService."
            }
          ]
        }),
        knowledge({
          file: "src/UserService.ts",
          symbols: [
            {
              name: "UserService",
              kind: "class",
              range: { startLine: 0, startCharacter: 0, endLine: 5, endCharacter: 1 },
              selectionRange: { startLine: 0, startCharacter: 6, endLine: 0, endCharacter: 17 }
            }
          ]
        })
      ]
    });

    expect(graph.edges.some((edge) => edge.type === "calls")).toBe(false);
  });

  it("keeps intra-file calls as symbol-to-symbol call graph edges", () => {
    const graph = buildStructuralGraph({
      catalog: {
        ...catalog,
        allPaths: ["src/auth.ts", "package.json"],
        codeFiles: ["src/auth.ts"],
        sourceFiles: ["src/auth.ts"],
        testFiles: []
      },
      knowledge: [
        knowledge({
          file: "src/auth.ts",
          symbols: [
            {
              name: "authenticate",
              kind: "function",
              range: { startLine: 0, startCharacter: 0, endLine: 3, endCharacter: 1 },
              selectionRange: { startLine: 0, startCharacter: 9, endLine: 0, endCharacter: 21 }
            },
            {
              name: "validateUser",
              kind: "function",
              range: { startLine: 5, startCharacter: 0, endLine: 7, endCharacter: 1 },
              selectionRange: { startLine: 5, startCharacter: 9, endLine: 5, endCharacter: 21 }
            }
          ],
          relationships: [
            {
              type: "call",
              target: "validateUser",
              symbol: "validateUser",
              sourceSymbol: "authenticate",
              confidence: "medium",
              reason: "authenticate calls validateUser."
            }
          ]
        })
      ]
    });

    const call = graph.edges.find((edge) => edge.type === "calls");
    expect(call).toMatchObject({
      fromFile: "src/auth.ts",
      toFile: "src/auth.ts"
    });
    expect(call?.from).toContain(":authenticate");
    expect(call?.to).toContain(":validateUser");
  });

  it("does not resolve qualified built-in calls to similarly named local symbols", () => {
    const graph = buildStructuralGraph({
      catalog: {
        ...catalog,
        allPaths: ["src/logger.ts", "package.json"],
        codeFiles: ["src/logger.ts"],
        sourceFiles: ["src/logger.ts"],
        testFiles: []
      },
      knowledge: [
        knowledge({
          file: "src/logger.ts",
          symbols: [
            {
              name: "run",
              kind: "function",
              range: { startLine: 0, startCharacter: 0, endLine: 4, endCharacter: 1 },
              selectionRange: { startLine: 0, startCharacter: 9, endLine: 0, endCharacter: 12 }
            },
            {
              name: "log",
              kind: "function",
              range: { startLine: 6, startCharacter: 0, endLine: 8, endCharacter: 1 },
              selectionRange: { startLine: 6, startCharacter: 9, endLine: 6, endCharacter: 12 }
            }
          ],
          relationships: [
            {
              type: "call",
              target: "log",
              symbol: "log",
              sourceSymbol: "run",
              qualifier: "console",
              confidence: "medium",
              reason: "run calls console.log."
            }
          ]
        })
      ]
    });

    expect(graph.edges.some((edge) => edge.type === "calls")).toBe(false);
  });

  it("resolves this-qualified calls to unique local methods", () => {
    const graph = buildStructuralGraph({
      catalog: {
        ...catalog,
        allPaths: ["src/UserService.ts", "package.json"],
        codeFiles: ["src/UserService.ts"],
        sourceFiles: ["src/UserService.ts"],
        testFiles: []
      },
      knowledge: [
        knowledge({
          file: "src/UserService.ts",
          symbols: [
            {
              name: "load",
              kind: "method",
              range: { startLine: 1, startCharacter: 0, endLine: 3, endCharacter: 1 },
              selectionRange: { startLine: 1, startCharacter: 2, endLine: 1, endCharacter: 6 }
            },
            {
              name: "validate",
              kind: "method",
              range: { startLine: 5, startCharacter: 0, endLine: 7, endCharacter: 1 },
              selectionRange: { startLine: 5, startCharacter: 2, endLine: 5, endCharacter: 10 }
            }
          ],
          relationships: [
            {
              type: "call",
              target: "validate",
              symbol: "validate",
              sourceSymbol: "load",
              qualifier: "this",
              confidence: "medium",
              reason: "load calls this.validate."
            }
          ]
        })
      ]
    });

    const call = graph.edges.find((edge) => edge.type === "calls");
    expect(call?.from).toContain(":load");
    expect(call?.to).toContain(":validate");
  });

  it("does not trust provider-derived cross-file relationships in the project graph", () => {
    const graph = buildStructuralGraph({
      catalog,
      knowledge: [
        knowledge({
          file: "src/App.tsx",
          relationships: [
            {
              type: "definition",
              target: "UserService",
              targetFile: "src/UserService.ts",
              symbol: "UserService",
              providerDerived: true,
              confidence: "high",
              reason: "Provider definition."
            }
          ]
        })
      ]
    });

    expect(graph.edges.some((edge) => edge.type === "definition")).toBe(false);
  });

  it("ignores knowledge records for files no longer present in the catalog", () => {
    const graph = buildStructuralGraph({
      catalog,
      knowledge: [
        knowledge({
          file: "src/Deleted.ts",
          symbols: [
            {
              name: "Deleted",
              kind: "function",
              range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 10 },
              selectionRange: { startLine: 0, startCharacter: 9, endLine: 0, endCharacter: 16 }
            }
          ]
        })
      ]
    });

    expect(graph.indexedFileCount).toBe(0);
    expect(graph.symbolCount).toBe(0);
  });
});
