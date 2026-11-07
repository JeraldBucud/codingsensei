import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { availableParallelism } from "node:os";
import { dirname } from "node:path";
import { createServer } from "node:net";

import type { LocalInferenceRequest, LocalModelProvider } from "./localModelProvider";
import type { ManagedRuntimeStore } from "./managedRuntimeStore";

const startupTimeoutMs = 90_000;
const responseTimeoutMs = 180_000;
const maxAnswerChars = 40_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function allocatePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Could not allocate a local inference port."));
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

async function waitForReady(
  port: number,
  child: ChildProcess,
  signal?: AbortSignal
): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (signal?.aborted) {
      throw new Error("Local AI request cancelled.");
    }
    if (child.exitCode !== null) {
      throw new Error("The managed AI runtime exited while starting.");
    }
    if (Date.now() - started > startupTimeoutMs) {
      throw new Error("The local AI runtime did not become ready in time.");
    }

    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/health`, {
        signal: AbortSignal.timeout(1_500)
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Model loading is asynchronous. Retry until ready, cancelled, or timed out.
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 350);
    });
  }
}

async function postChat(
  port: number,
  apiKey: string,
  request: LocalInferenceRequest
): Promise<string> {
  const controller = new AbortController();
  const cancel = (): void => {
    controller.abort();
  };
  request.signal?.addEventListener("abort", cancel, { once: true });
  if (request.signal?.aborted) {
    controller.abort();
  }
  const timeout = setTimeout(cancel, responseTimeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "local",
        messages: request.messages,
        stream: false,
        max_tokens: 768
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Local inference failed (HTTP ${String(response.status)}).`);
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload["choices"])) {
      throw new Error("The managed model returned an invalid response.");
    }
    const choices: readonly unknown[] = payload["choices"];
    const first = choices[0];
    const message = isRecord(first) ? first["message"] : undefined;
    const answer = isRecord(message) ? message["content"] : undefined;
    if (typeof answer !== "string" || !answer.trim()) {
      throw new Error("The local model returned no text answer.");
    }
    if (answer.length > maxAnswerChars) {
      throw new Error("The local model response exceeded the size limit.");
    }
    return answer;
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", cancel);
  }
}

export function createLlamaServerArgs(
  modelPath: string,
  port: number,
  apiKey: string
): readonly string[] {
  if (!modelPath || !Number.isInteger(port) || port < 1 || port > 65535 || !apiKey) {
    throw new Error("Invalid managed runtime configuration.");
  }
  return [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--model",
    modelPath,
    "--ctx-size",
    "6144",
    "--parallel",
    "1",
    "--threads",
    String(Math.max(1, Math.min(availableParallelism(), 8))),
    "--n-gpu-layers",
    "0",
    "--api-key",
    apiKey,
    "--no-webui"
  ];
}

export class ManagedLlamaCppProvider implements LocalModelProvider {
  constructor(private readonly runtime: ManagedRuntimeStore) {}

  async generate(request: LocalInferenceRequest): Promise<string> {
    const binary = await this.runtime.installedBinary();
    if (!binary) {
      throw new Error("The CodingSensei AI runtime is not installed.");
    }

    const port = await allocatePort();
    const apiKey = randomBytes(24).toString("hex");
    const child = spawn(binary, createLlamaServerArgs(request.modelPath, port, apiKey), {
      cwd: dirname(binary),
      shell: false,
      windowsHide: true,
      stdio: "ignore"
    });
    let spawnError: Error | undefined;
    child.once("error", (error: Error) => {
      spawnError = error;
    });
    const abort = (): void => {
      child.kill();
    };
    request.signal?.addEventListener("abort", abort, { once: true });
    try {
      await waitForReady(port, child, request.signal);
      if (spawnError) {
        throw spawnError;
      }
      return await postChat(port, apiKey, request);
    } finally {
      request.signal?.removeEventListener("abort", abort);
      child.kill();
    }
  }
}
