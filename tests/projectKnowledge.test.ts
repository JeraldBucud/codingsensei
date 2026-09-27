import { describe, expect, it } from "vitest";

import type { FrameworkDetection } from "../src/framework/models";
import type { LanguageAnalysis } from "../src/language/models";
import {
  createPersistentFileKnowledge,
  hashContent,
  parsePersistentFileKnowledge,
  projectKnowledgeKey,
  serializePersistentFileKnowledge
} from "../src/project/projectKnowledge";

const analysis: LanguageAnalysis = {
  status: "available",
  file: "src/app.ts",
  languageId: "typescript",
  source: "deterministic",
  symbols: [
    {
      name: "run",
      kind: "function",
      range: { startLine: 0, startCharacter: 0, endLine: 2, endCharacter: 1 },
      selectionRange: { startLine: 0, startCharacter: 9, endLine: 0, endCharacter: 12 }
    }
  ],
  imports: [
    {
      type: "import",
      target: "./service",
      targetFile: "src/service.ts",
      confidence: "high",
      reason: "Local import."
    }
  ],
  relationships: [],
  entryPointSignals: ["exported function"],
  truncated: false
};

const frameworks: readonly FrameworkDetection[] = [
  {
    framework: "react",
    confidence: "high",
    evidence: [{ source: "metadata", description: "React dependency" }],
    roles: ["component"]
  }
];

describe("persistent file knowledge", () => {
  it("stores structural knowledge and a content fingerprint without source text", () => {
    const knowledge = createPersistentFileKnowledge({
      projectId: "2c0df18a-8ac2-4b68-84e3-0b6f2c3d6d41",
      document: {
        fileName: "app.ts",
        projectRelativePath: "src/app.ts",
        languageId: "typescript",
        text: "export function run() { return 1; }"
      },
      analysis,
      frameworks,
      now: () => new Date("2026-09-27T02:00:00.000Z")
    });

    expect(knowledge.relativePath).toBe("src/app.ts");
    expect(knowledge.contentHash).toBe(hashContent("export function run() { return 1; }"));
    expect(knowledge.symbols[0]?.name).toBe("run");
    expect(knowledge.frameworks[0]?.framework).toBe("react");
    expect(JSON.stringify(knowledge)).not.toContain("return 1");
  });

  it("uses a stable path hash as the storage key", () => {
    expect(projectKnowledgeKey("src\\app.ts")).toBe(projectKnowledgeKey("src/app.ts"));
    expect(projectKnowledgeKey("src/app.ts")).not.toBe(projectKnowledgeKey("src/other.ts"));
  });

  it("round-trips valid knowledge and rejects invalid schema versions", () => {
    const knowledge = createPersistentFileKnowledge({
      projectId: "2c0df18a-8ac2-4b68-84e3-0b6f2c3d6d41",
      document: {
        fileName: "app.ts",
        relativePath: "src/app.ts",
        languageId: "typescript",
        text: "const value = 1;"
      },
      analysis,
      frameworks: [],
      now: () => new Date("2026-09-27T02:00:00.000Z")
    });

    expect(parsePersistentFileKnowledge(serializePersistentFileKnowledge(knowledge))).toEqual(
      knowledge
    );
    expect(
      parsePersistentFileKnowledge(JSON.stringify({ ...knowledge, schemaVersion: 99 }))
    ).toBeUndefined();
  });
});
