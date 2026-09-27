import { describe, expect, it } from "vitest";

import type { LanguageAnalysis, LanguageDocumentInput } from "../src/language/models";
import {
  DeterministicLanguageAdapter,
  LanguageIntelligenceService,
  type LanguageProviderAdapter
} from "../src/language/languageIntelligence";
import { analyzeDeterministicStructure } from "../src/language/relationships";

function documentInput(overrides: Partial<LanguageDocumentInput> = {}): LanguageDocumentInput {
  return {
    uri: "file:///demo/src/App.tsx",
    fileName: "App.tsx",
    relativePath: "src/App.tsx",
    languageId: "typescriptreact",
    version: 1,
    text: "import React from 'react';\nfunction App() {\n  return <Header />;\n}\n",
    cursor: { line: 1, character: 10 },
    projectRootUri: "file:///demo",
    projectRelativePath: "src/App.tsx",
    knownProjectFiles: ["src/App.tsx", "src/Header.tsx", "src/services/UserService.java"],
    ...overrides
  };
}

function analysisFor(document: LanguageDocumentInput, name = "App"): LanguageAnalysis {
  return {
    status: "available",
    file: document.relativePath,
    languageId: document.languageId,
    source: "vscode-provider",
    symbols: [
      {
        name,
        kind: "function",
        range: { startLine: 0, startCharacter: 0, endLine: 4, endCharacter: 0 },
        selectionRange: { startLine: 1, startCharacter: 9, endLine: 1, endCharacter: 12 }
      }
    ],
    currentSymbol: undefined,
    imports: [],
    relationships: [],
    entryPointSignals: [],
    truncated: false
  };
}

describe("language intelligence", () => {
  it("extracts deterministic symbols, imports, and local relationships", async () => {
    const adapter = new DeterministicLanguageAdapter();
    const analysis = await adapter.analyzeDocument(documentInput());

    expect(analysis.source).toBe("deterministic");
    expect(analysis.symbols.map((symbol) => symbol.name)).toContain("App");
    expect(analysis.imports[0]).toMatchObject({ type: "import", target: "react" });
    expect(analysis.relationships[0]).toMatchObject({ type: "renders", target: "Header" });
  });

  it("resolves local TS/JS imports to known project files conservatively", async () => {
    const service = new LanguageIntelligenceService();
    const analysis = await service.analyze(
      documentInput({
        text: "import LoginForm from './components/LoginForm';\nfunction App() { return <LoginForm />; }",
        knownProjectFiles: ["src/App.tsx", "src/components/LoginForm.tsx"]
      })
    );

    expect(analysis.imports[0]).toMatchObject({
      target: "./components/LoginForm",
      targetFile: "src/components/LoginForm.tsx",
      confidence: "high"
    });
  });

  it("leaves unresolved imports conservative instead of inventing paths", async () => {
    const service = new LanguageIntelligenceService();
    const analysis = await service.analyze(
      documentInput({
        text: "import Missing from './Missing';\nfunction App() { return <Missing />; }",
        knownProjectFiles: ["src/App.tsx"]
      })
    );

    expect(analysis.imports[0]?.targetFile).toBeUndefined();
  });

  it("detects Java service dependencies and entry points without AST parsing", () => {
    const structure = analyzeDeterministicStructure({
      fileName: "DemoController.java",
      languageId: "java",
      text: "class DemoController {\n private final AccountService accountService;\n public static void main(String[] args) {}\n}"
    });

    expect(structure.relationships[0]).toMatchObject({
      type: "service-dependency",
      target: "AccountService"
    });
    expect(structure.entryPointSignals).toContain("Java main method");
  });

  it("does not mistake Java generic types for JSX renders", () => {
    const structure = analyzeDeterministicStructure({
      fileName: "ReportService.java",
      languageId: "java",
      text: "class ReportService {\n List<Sale> sales;\n private final EmailService emailService;\n}"
    });

    expect(structure.relationships).not.toContainEqual(
      expect.objectContaining({ type: "renders", target: "Sale" })
    );
    expect(structure.relationships).toContainEqual(
      expect.objectContaining({ type: "service-dependency", target: "EmailService" })
    );
  });

  it("keeps JSX render relationships scoped to JSX and TSX documents", () => {
    const tsx = analyzeDeterministicStructure({
      fileName: "App.tsx",
      languageId: "typescriptreact",
      text: "export function App() { return <LoginForm />; }"
    });
    const jsx = analyzeDeterministicStructure({
      fileName: "App.jsx",
      languageId: "javascriptreact",
      text: "export function App() { return <LoginForm />; }"
    });

    expect(tsx.relationships).toContainEqual(
      expect.objectContaining({ type: "renders", target: "LoginForm" })
    );
    expect(jsx.relationships).toContainEqual(
      expect.objectContaining({ type: "renders", target: "LoginForm" })
    );
  });

  it("keeps Express route relationships in JavaScript-family documents only", () => {
    const javascript = analyzeDeterministicStructure({
      fileName: "routes.js",
      languageId: "javascript",
      text: "router.get('/users', handler);"
    });
    const java = analyzeDeterministicStructure({
      fileName: "Routes.java",
      languageId: "java",
      text: "router.get('/users', handler);"
    });

    expect(javascript.relationships).toContainEqual(
      expect.objectContaining({ type: "route-handler", target: "GET route" })
    );
    expect(java.relationships).not.toContainEqual(
      expect.objectContaining({ type: "route-handler" })
    );
  });

  it("detects bounded calls inside known function ranges", () => {
    const structure = analyzeDeterministicStructure({
      fileName: "auth.ts",
      languageId: "typescript",
      text: "function authenticate() {\n  validateUser();\n  userService.loadUser();\n}\n\nfunction validateUser() { return true; }"
    });

    expect(structure.relationships).toContainEqual(
      expect.objectContaining({
        type: "call",
        target: "validateUser",
        sourceSymbol: "authenticate"
      })
    );
    expect(structure.relationships).toContainEqual(
      expect.objectContaining({
        type: "call",
        target: "loadUser",
        sourceSymbol: "authenticate",
        qualifier: "userService"
      })
    );
  });

  it("detects JavaScript and TypeScript methods without treating ordinary calls as declarations", () => {
    const structure = analyzeDeterministicStructure({
      fileName: "UserService.ts",
      languageId: "typescript",
      text: "class UserService {\n  loadUser() {\n    return validateUser();\n  }\n}\nfunction validateUser() { return true; }"
    });

    expect(structure.symbols).toContainEqual(
      expect.objectContaining({ name: "loadUser", kind: "method" })
    );
    expect(structure.symbols.filter((symbol) => symbol.name === "validateUser")).toHaveLength(1);
    expect(structure.relationships).toContainEqual(
      expect.objectContaining({
        type: "call",
        target: "validateUser",
        sourceSymbol: "loadUser"
      })
    );
  });

  it("resolves Java service dependencies when one known local candidate exists", async () => {
    const service = new LanguageIntelligenceService();
    const analysis = await service.analyze(
      documentInput({
        uri: "file:///demo/src/main/java/app/UserController.java",
        fileName: "UserController.java",
        relativePath: "src/main/java/app/UserController.java",
        projectRelativePath: "src/main/java/app/UserController.java",
        languageId: "java",
        text: "class UserController {\n private final UserService userService;\n}",
        knownProjectFiles: [
          "src/main/java/app/UserController.java",
          "src/main/java/app/UserService.java"
        ]
      })
    );

    expect(analysis.relationships[0]).toMatchObject({
      type: "service-dependency",
      targetFile: "src/main/java/app/UserService.java",
      symbol: "UserService"
    });
  });

  it("extends fallback symbol ranges with bounded block heuristics", async () => {
    const service = new LanguageIntelligenceService();
    const analysis = await service.analyze(
      documentInput({
        text: "function App() {\n  const value = 1;\n  return value;\n}\n",
        cursor: { line: 2, character: 5 }
      })
    );

    expect(analysis.currentSymbol?.name).toBe("App");
  });

  it("reuses cached provider analysis for cursor movement", async () => {
    let calls = 0;
    const adapter: LanguageProviderAdapter = {
      analyzeDocument: (document) => {
        calls += 1;
        return Promise.resolve(analysisFor(document));
      }
    };
    const service = new LanguageIntelligenceService(adapter);

    await service.analyze(documentInput());
    const cached = service.getCached({
      uri: "file:///demo/src/App.tsx",
      version: 1,
      cursor: { line: 2, character: 5 }
    });

    expect(calls).toBe(1);
    expect(cached.currentSymbol?.name).toBe("App");
  });

  it("filters provider relationships when cursor movement changes the current symbol", async () => {
    let calls = 0;
    const adapter: LanguageProviderAdapter = {
      analyzeDocument: (document) => {
        calls += 1;
        return Promise.resolve({
          ...analysisFor(document),
          symbols: [
            {
              name: "App",
              kind: "function",
              range: { startLine: 0, startCharacter: 0, endLine: 3, endCharacter: 1 },
              selectionRange: { startLine: 0, startCharacter: 9, endLine: 0, endCharacter: 12 }
            },
            {
              name: "Helper",
              kind: "function",
              range: { startLine: 5, startCharacter: 0, endLine: 7, endCharacter: 1 },
              selectionRange: { startLine: 5, startCharacter: 9, endLine: 5, endCharacter: 15 }
            }
          ],
          relationships: [
            {
              type: "definition",
              target: "App",
              targetFile: "src/AppDefinition.ts",
              symbol: "App",
              providerDerived: true,
              confidence: "high",
              reason: "VS Code resolved the local definition for the current symbol."
            },
            {
              type: "renders",
              target: "Header",
              targetFile: "src/Header.tsx",
              symbol: "Header",
              confidence: "medium",
              reason: "A JSX element with a component-style name appears in the active file."
            }
          ]
        });
      }
    };
    const service = new LanguageIntelligenceService(adapter);

    await service.analyze(documentInput({ cursor: { line: 1, character: 2 } }));
    const cached = service.getCached({
      uri: "file:///demo/src/App.tsx",
      version: 1,
      cursor: { line: 6, character: 2 }
    });

    expect(calls).toBe(1);
    expect(cached.currentSymbol?.name).toBe("Helper");
    expect(cached.relationships).toEqual([
      expect.objectContaining({ type: "renders", target: "Header" })
    ]);
  });

  it("primes the cache from restored persistent analysis without calling the provider", () => {
    let calls = 0;
    const service = new LanguageIntelligenceService({
      analyzeDocument: (document) => {
        calls += 1;
        return Promise.resolve(analysisFor(document, "Provider"));
      }
    });
    const input = documentInput({ cursor: { line: 2, character: 5 } });
    const restored = analysisFor(input, "Restored");

    const analysis = service.prime(input, restored);

    expect(calls).toBe(0);
    expect(analysis.currentSymbol?.name).toBe("Restored");
    expect(
      service.getCached({
        uri: input.uri,
        version: input.version,
        cursor: input.cursor
      }).symbols[0]?.name
    ).toBe("Restored");
  });

  it("does not call the provider again for the same document version", async () => {
    let calls = 0;
    const adapter: LanguageProviderAdapter = {
      analyzeDocument: (document) => {
        calls += 1;
        return Promise.resolve(analysisFor(document));
      }
    };
    const service = new LanguageIntelligenceService(adapter);
    const input = documentInput();

    await service.analyze(input);
    await service.analyze(input);

    expect(calls).toBe(1);
  });

  it("recomputes language structure after the document version changes", async () => {
    let calls = 0;
    const adapter: LanguageProviderAdapter = {
      analyzeDocument: (document) => {
        calls += 1;
        return Promise.resolve(analysisFor(document, `Version${String(document.version)}`));
      }
    };
    const service = new LanguageIntelligenceService(adapter);

    await service.analyze(documentInput({ version: 1 }));
    const second = await service.analyze(documentInput({ version: 2 }));

    expect(calls).toBe(2);
    expect(second.symbols[0]?.name).toBe("Version2");
  });

  it("prevents stale provider results from replacing newer language analysis", async () => {
    let releaseFirst: ((analysis: LanguageAnalysis) => void) | undefined;
    const adapter: LanguageProviderAdapter = {
      analyzeDocument: (document) =>
        document.version === 1
          ? new Promise((resolve) => {
              releaseFirst = resolve;
            })
          : Promise.resolve(analysisFor(document, "Newer"))
    };
    const service = new LanguageIntelligenceService(adapter);

    const first = service.analyze(documentInput({ version: 1 }));
    const second = await service.analyze(documentInput({ version: 2 }));
    releaseFirst?.(analysisFor(documentInput({ version: 1 }), "Older"));
    await first;
    const cached = service.getCached({
      uri: "file:///demo/src/App.tsx",
      version: 2,
      cursor: { line: 1, character: 10 }
    });

    expect(second.symbols[0]?.name).toBe("Newer");
    expect(cached.symbols[0]?.name).toBe("Newer");
  });

  it("keeps stale analysis protection scoped per document URI", async () => {
    let releaseFirst: ((analysis: LanguageAnalysis) => void) | undefined;
    const adapter: LanguageProviderAdapter = {
      analyzeDocument: (document) =>
        document.uri.endsWith("One.ts")
          ? new Promise((resolve) => {
              releaseFirst = resolve;
            })
          : Promise.resolve(analysisFor(document, "Two"))
    };
    const service = new LanguageIntelligenceService(adapter);

    const one = service.analyze(
      documentInput({ uri: "file:///demo/src/One.ts", fileName: "One.ts" })
    );
    const two = await service.analyze(
      documentInput({ uri: "file:///demo/src/Two.ts", fileName: "Two.ts" })
    );
    releaseFirst?.(
      analysisFor(documentInput({ uri: "file:///demo/src/One.ts", fileName: "One.ts" }), "One")
    );
    await one;

    expect(two.symbols[0]?.name).toBe("Two");
    expect(
      service.getCached({
        uri: "file:///demo/src/One.ts",
        version: 1,
        cursor: { line: 1, character: 1 }
      }).symbols[0]?.name
    ).toBe("One");
  });

  it("bounds the language analysis cache", async () => {
    const service = new LanguageIntelligenceService({
      analyzeDocument: (document) => Promise.resolve(analysisFor(document, document.fileName))
    });

    for (let index = 0; index < 55; index += 1) {
      await service.analyze(
        documentInput({
          uri: `file:///demo/src/File${String(index)}.ts`,
          fileName: `File${String(index)}.ts`
        })
      );
    }

    expect(
      service.getCached({
        uri: "file:///demo/src/File0.ts",
        version: 1,
        cursor: { line: 1, character: 1 }
      }).status
    ).toBe("analyzing");
    expect(
      service.getCached({
        uri: "file:///demo/src/File54.ts",
        version: 1,
        cursor: { line: 1, character: 1 }
      }).symbols[0]?.name
    ).toBe("File54.ts");
  });
});
