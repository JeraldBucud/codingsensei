import { describe, expect, it } from "vitest";

import { buildProjectChatPrompt } from "../src/chat/projectChatPrompt";
import type { ProjectEvidencePackage } from "../src/project/projectEvidence";

const evidence: ProjectEvidencePackage = {
  projectId: "local-project-id",
  query: "where is UserService?",
  activeFile: "src/routes.ts",
  coverage: { indexedFiles: 3, totalFiles: 4 },
  likelyEntryFiles: ["src/routes.ts"],
  files: [
    {
      file: "src/services/UserService.ts",
      score: 20,
      reasons: ["symbol matches UserService"],
      roles: ["service"],
      frameworks: []
    },
    {
      file: "src/services/UserService.test.ts",
      score: 10,
      reasons: ["related test"],
      roles: ["test"],
      frameworks: []
    }
  ],
  symbols: [
    {
      file: "src/services/UserService.ts",
      name: "UserService",
      kind: "class",
      line: 5
    }
  ],
  relationships: [
    {
      type: "related-test",
      fromFile: "src/services/UserService.ts",
      toFile: "src/services/UserService.test.ts",
      confidence: "high",
      reason: "Related test."
    }
  ]
};

describe("project chat prompt", () => {
  it("builds two grounded messages with exact file and 1-based line references", () => {
    const prompt = buildProjectChatPrompt({ question: "Where is UserService?", evidence });
    expect(prompt.messages).toHaveLength(2);
    expect(prompt.messages[0]?.role).toBe("system");
    expect(prompt.messages[1]?.role).toBe("user");
    expect(prompt.messages[1]?.content).toContain('"file": "src/services/UserService.ts"');
    expect(prompt.messages[1]?.content).toContain('"line": 6');
    expect(prompt.includedFiles).toContain("src/services/UserService.ts");
    expect(prompt.truncated).toBe(false);
  });

  it("treats external evidence as untrusted data and does not include project identity", () => {
    const prompt = buildProjectChatPrompt({ question: "Explain these files", evidence });
    const result = JSON.stringify(prompt);
    expect(result).toContain("untrusted data");
    expect(result).not.toContain("local-project-id");
    expect(result).not.toContain("sourceText");
  });

  it("rejects empty or oversized questions", () => {
    expect(() => buildProjectChatPrompt({ question: "   ", evidence })).toThrow(
      "A project chat question is required."
    );
    expect(() => buildProjectChatPrompt({ question: "x".repeat(2001), evidence })).toThrow("2,000");
  });

  it("bounds file, symbol and relationship counts and drops out-of-scope relationships", () => {
    const files = Array.from({ length: 30 }, (_, i) => ({
      file: `src/file${String(i)}.ts`,
      score: 1,
      reasons: ["match"],
      roles: [] as const,
      frameworks: [] as const
    }));
    const prompt = buildProjectChatPrompt({
      question: "Where are my functions?",
      evidence: {
        ...evidence,
        files,
        symbols: Array.from({ length: 30 }, (_, i) => ({
          file: files[i]?.file ?? "",
          line: i,
          name: `function${String(i)}`,
          kind: "function" as const
        })),
        relationships: evidence.relationships
      }
    });
    expect(prompt.includedFiles).toHaveLength(8);
    expect(prompt.truncated).toBe(true);
    expect(prompt.messages[1]?.content).not.toContain("src/file29.ts");
    expect(prompt.messages[1]?.content).not.toContain("Related test.");
  });
});
