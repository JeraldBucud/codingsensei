import { describe, expect, it } from "vitest";

import { CodingSenseiAgent } from "../src/agent/codingSenseiAgent";
import type { LocalInferenceRequest, LocalModelProvider } from "../src/chat/localModelProvider";
import type { ProjectEvidencePackage } from "../src/project/projectEvidence";

const evidence: ProjectEvidencePackage = {
  projectId: "private-project-uuid",
  query: "Where is registration handled?",
  activeFile: "src/routes.ts",
  coverage: { indexedFiles: 2, totalFiles: 3 },
  likelyEntryFiles: ["src/routes.ts"],
  files: [
    {
      file: "src/services/account.ts",
      score: 18,
      reasons: ["symbol matches registration"],
      roles: ["service"],
      frameworks: []
    }
  ],
  symbols: [
    { file: "src/services/account.ts", line: 4, name: "register", kind: "function" }
  ],
  relationships: []
};

class FakeProvider implements LocalModelProvider {
  readonly requests: LocalInferenceRequest[] = [];

  generate(request: LocalInferenceRequest): Promise<string> {
    this.requests.push(request);
    return Promise.resolve("Evidence-based result.");
  }
}

describe("CodingSensei single-model agent", () => {
  it("uses one provider for reasoning and coding with distinct task instructions", async () => {
    const provider = new FakeProvider();
    const agent = new CodingSenseiAgent(provider);
    const input = {
      question: "Where is user registration handled?",
      evidence,
      modelPath: "/models/local.gguf"
    };
    const reasoning = await agent.run({ ...input, task: "reason" });
    const coding = await agent.run({
      ...input,
      task: "code",
      sourceExcerpts: [
        { file: "src/services/account.ts", content: "export function register() {}" }
      ]
    });

    expect(reasoning.task).toBe("reason");
    expect(coding.task).toBe("code");
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.modelPath).toBe(provider.requests[1]?.modelPath);
    expect(provider.requests[0]?.messages[0]?.content).toContain("explain or reason");
    expect(provider.requests[1]?.messages[0]?.content).toContain("propose a code change");
    expect(provider.requests[1]?.messages[1]?.content).toContain("export function register");
    expect(provider.requests[0]?.messages[1]?.content).not.toContain("export function register");
    expect(reasoning.evidenceFiles).toEqual(["src/services/account.ts"]);
    expect(JSON.stringify(provider.requests)).not.toContain("private-project-uuid");
  });

  it("keeps Learning Mode in teaching behaviour", async () => {
    const provider = new FakeProvider();
    await new CodingSenseiAgent(provider).run({
      task: "learn",
      question: "How do I add a test?",
      evidence,
      modelPath: "/models/local.gguf"
    });
    expect(provider.requests[0]?.messages[0]?.content).toContain("small actionable hint");
  });

  it("filters unrelated source excerpts and bounds provided source content", async () => {
    const provider = new FakeProvider();
    const result = await new CodingSenseiAgent(provider).run({
      task: "code",
      question: "Suggest a change",
      evidence,
      modelPath: "/models/local.gguf",
      sourceExcerpts: [
        { file: "../private.env", content: "SHOULD_NOT_BE_INCLUDED" },
        { file: "src/services/account.ts", content: "x".repeat(8000) }
      ]
    });
    const userMessage = provider.requests[0]?.messages[1]?.content ?? "";
    expect(userMessage).not.toContain("SHOULD_NOT_BE_INCLUDED");
    expect(userMessage).not.toContain("x".repeat(7000));
    expect(result.truncated).toBe(true);
  });

  it("does not invoke the model when already cancelled", async () => {
    const provider = new FakeProvider();
    const controller = new AbortController();
    controller.abort();
    await expect(
      new CodingSenseiAgent(provider).run({
        task: "reason",
        question: "Explain this",
        evidence,
        modelPath: "/models/local.gguf",
        signal: controller.signal
      })
    ).rejects.toThrow("cancelled");
    expect(provider.requests).toHaveLength(0);
  });
});
