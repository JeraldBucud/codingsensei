import type { LocalChatRequest, LocalModelInfo, LocalModelProvider } from "./localModelProvider";

const ollamaBaseUrl = "http://127.0.0.1:11434";
const timeoutMs = 180_000;
const maxModelNameLength = 160;
const maxAnswerLength = 40_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class OllamaLocalProvider implements LocalModelProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async listModels(signal?: AbortSignal): Promise<readonly LocalModelInfo[]> {
    const response = await this.request("/api/tags", { method: "GET" }, signal);
    const data: unknown = await response.json();
    if (!isRecord(data) || !Array.isArray(data.models)) {
      throw new Error("Ollama returned an invalid installed-model list.");
    }

    const models: readonly unknown[] = data.models;
    return models.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      const name = item["name"];
      const size = item["size"];
      const details = item["details"];
      if (
        typeof name !== "string" ||
        name.length === 0 ||
        name.length > maxModelNameLength ||
        name.includes(":cloud")
      ) {
        return [];
      }
      return [
        {
          name,
          sizeBytes: typeof size === "number" && size > 0 ? size : 0,
          family:
            isRecord(details) && typeof details["family"] === "string"
              ? details["family"]
              : undefined
        }
      ];
    });
  }

  async chat(request: LocalChatRequest): Promise<string> {
    if (
      !request.model ||
      request.model.length > maxModelNameLength ||
      request.model.includes(":cloud")
    ) {
      throw new Error("Select a valid locally installed model.");
    }
    if (request.messages.length === 0 || request.messages.some((item) => !item.content.trim())) {
      throw new Error("A non-empty message is required.");
    }

    const installed = await this.listModels(request.signal);
    if (!installed.some((model) => model.name === request.model)) {
      throw new Error("The selected model is not installed locally in Ollama.");
    }

    const response = await this.request(
      "/api/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: false,
          keep_alive: request.keepAlive
        })
      },
      request.signal
    );
    const data: unknown = await response.json();
    if (!isRecord(data)) {
      throw new Error("Ollama returned an invalid chat response.");
    }
    const apiError = data["error"];
    if (typeof apiError === "string") {
      throw new Error(`Ollama: ${apiError.slice(0, 500)}`);
    }
    const message = data["message"];
    const content = isRecord(message) ? message["content"] : undefined;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("The local model did not return a text answer.");
    }
    if (content.length > maxAnswerLength) {
      throw new Error("The local model response exceeded the size limit.");
    }
    return content;
  }

  private async request(
    path: "/api/tags" | "/api/chat",
    options: RequestInit,
    upstreamSignal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController();
    const onAbort = (): void => {
      controller.abort();
    };
    upstreamSignal?.addEventListener("abort", onAbort, { once: true });
    if (upstreamSignal?.aborted) {
      controller.abort();
    }
    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const response = await this.fetchImpl(`${ollamaBaseUrl}${path}`, {
        ...options,
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Ollama request failed (HTTP ${String(response.status)}).`);
      }
      return response;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("The local model request was cancelled or timed out.");
      }
      if (error instanceof TypeError) {
        throw new Error(
          "Could not connect to local Ollama at 127.0.0.1:11434. Start Ollama and try again."
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener("abort", onAbort);
    }
  }
}
