import type { LocalChatRequest, LocalModelInfo, LocalModelProvider } from "./localModelProvider";

const ollamaBaseUrl = "http://127.0.0.1:11434";
const timeoutMs = 180_000;
const maxModelNameLength = 160;
const maxAnswerLength = 40_000;

interface OllamaModelResponse {
  readonly models?: readonly {
    readonly name?: unknown;
    readonly size?: unknown;
    readonly details?: { readonly family?: unknown };
  }[];
}

interface OllamaChatResponse {
  readonly message?: { readonly content?: unknown };
  readonly done?: unknown;
  readonly error?: unknown;
}

export class OllamaLocalProvider implements LocalModelProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async listModels(signal?: AbortSignal): Promise<readonly LocalModelInfo[]> {
    const response = await this.request("/api/tags", { method: "GET" }, signal);
    const data = (await response.json()) as OllamaModelResponse;
    if (!Array.isArray(data.models)) {
      throw new Error("Ollama returned an invalid installed-model list.");
    }

    return data.models.flatMap((model) => {
      if (
        typeof model.name !== "string" ||
        model.name.length === 0 ||
        model.name.length > maxModelNameLength ||
        model.name.includes(":cloud")
      ) {
        return [];
      }

      return [
        {
          name: model.name,
          sizeBytes: typeof model.size === "number" && model.size > 0 ? model.size : 0,
          family: typeof model.details?.family === "string" ? model.details.family : undefined
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
    const data = (await response.json()) as OllamaChatResponse;
    if (typeof data.error === "string") {
      throw new Error(`Ollama: ${data.error.slice(0, 500)}`);
    }
    const content = data.message?.content;
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
    const onAbort = (): void => controller.abort();
    upstreamSignal?.addEventListener("abort", onAbort, { once: true });
    if (upstreamSignal?.aborted) {
      controller.abort();
    }
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
