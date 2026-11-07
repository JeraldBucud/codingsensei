import { describe, expect, it } from "vitest";

import { OllamaLocalProvider } from "../src/chat/ollamaLocalProvider";

const localModels = {
  models: [
    { name: "qwen3:14b", size: 9_000_000_000, details: { family: "qwen3" } },
    { name: "remote:cloud", size: 0, details: { family: "remote" } }
  ]
};

describe("local Ollama provider", () => {
  it("lists local installed models and filters cloud models", async () => {
    const paths: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      paths.push(String(input));
      return Response.json(localModels);
    };
    const provider = new OllamaLocalProvider(fetcher);
    expect(await provider.listModels()).toEqual([
      { name: "qwen3:14b", sizeBytes: 9_000_000_000, family: "qwen3" }
    ]);
    expect(paths).toEqual(["http://127.0.0.1:11434/api/tags"]);
  });

  it("sends bounded message contents only to the fixed localhost endpoint", async () => {
    const calls: { readonly url: string; readonly init?: RequestInit }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return String(input).endsWith("/api/tags")
        ? Response.json(localModels)
        : Response.json({ done: true, message: { role: "assistant", content: "Read UserService." } });
    };
    const provider = new OllamaLocalProvider(fetcher);
    const result = await provider.chat({
      model: "qwen3:14b",
      messages: [
        { role: "system", content: "Use only evidence." },
        { role: "user", content: "Where is the service?" }
      ],
      keepAlive: "0"
    });
    expect(result).toBe("Read UserService.");
    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/chat"
    ]);
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      model: "qwen3:14b",
      messages: [
        { role: "system", content: "Use only evidence." },
        { role: "user", content: "Where is the service?" }
      ],
      stream: false,
      keep_alive: "0"
    });
  });

  it("never requests a missing or cloud model", async () => {
    let chatCalls = 0;
    const fetcher: typeof fetch = async (input) => {
      if (String(input).endsWith("/api/chat")) {
        chatCalls += 1;
      }
      return Response.json(localModels);
    };
    const provider = new OllamaLocalProvider(fetcher);
    await expect(
      provider.chat({
        model: "missing:7b",
        messages: [{ role: "user", content: "Hello" }],
        keepAlive: "0"
      })
    ).rejects.toThrow("not installed locally");
    await expect(
      provider.chat({
        model: "remote:cloud",
        messages: [{ role: "user", content: "Hello" }],
        keepAlive: "0"
      })
    ).rejects.toThrow("valid locally installed model");
    expect(chatCalls).toBe(0);
  });

  it("reports offline Ollama without attempting a cloud fallback", async () => {
    const fetcher: typeof fetch = async () => {
      throw new TypeError("connect ECONNREFUSED");
    };
    const provider = new OllamaLocalProvider(fetcher);
    await expect(provider.listModels()).rejects.toThrow(
      "Could not connect to local Ollama at 127.0.0.1:11434"
    );
  });

  it("rejects invalid model lists, failed requests and empty answers", async () => {
    const badModels = new OllamaLocalProvider(async () => Response.json({ bad: [] }));
    await expect(badModels.listModels()).rejects.toThrow("invalid installed-model list");

    const unavailable = new OllamaLocalProvider(async () => new Response("", { status: 500 }));
    await expect(unavailable.listModels()).rejects.toThrow("HTTP 500");

    const empty = new OllamaLocalProvider(async (input) =>
      String(input).endsWith("/api/tags")
        ? Response.json(localModels)
        : Response.json({ done: true, message: { content: "" } })
    );
    await expect(
      empty.chat({
        model: "qwen3:14b",
        messages: [{ role: "user", content: "Hello" }],
        keepAlive: "0"
      })
    ).rejects.toThrow("did not return a text answer");
  });
});
