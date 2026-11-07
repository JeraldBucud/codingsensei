import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface VerifiedDownload {
  readonly url: string;
  readonly sha256: string;
  readonly destination: string;
  readonly maxBytes: number;
}

export type DownloadProgress = (receivedBytes: number, totalBytes?: number) => void;

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export async function fileMatchesChecksum(
  filePath: string,
  expectedSha256: string
): Promise<boolean> {
  try {
    if (!(await stat(filePath)).isFile()) {
      return false;
    }
    return (await sha256File(filePath)) === expectedSha256.toLowerCase();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function downloadVerified(
  input: VerifiedDownload,
  signal?: AbortSignal,
  onProgress?: DownloadProgress
): Promise<void> {
  if (!/^https:\/\//.test(input.url) || !/^[a-f0-9]{64}$/i.test(input.sha256)) {
    throw new Error("A trusted HTTPS download and SHA-256 checksum are required.");
  }
  if (input.maxBytes <= 0 || !Number.isSafeInteger(input.maxBytes)) {
    throw new Error("Invalid maximum download size.");
  }

  await mkdir(dirname(input.destination), { recursive: true });
  const tempFile = `${input.destination}.${randomUUID()}.part`;
  const response = await fetch(input.url, { signal });
  if (!response.ok || !response.body) {
    throw new Error(`The download server returned HTTP ${String(response.status)}.`);
  }

  const length = response.headers.get("content-length");
  const total = length ? Number(length) : undefined;
  if (total !== undefined && total > input.maxBytes) {
    await response.body.cancel();
    throw new Error("Download is larger than the allowed size.");
  }

  const hash = createHash("sha256");
  const handle = await open(tempFile, "wx");
  let received = 0;
  try {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        received += value.byteLength;
        if (received > input.maxBytes) {
          throw new Error("Download exceeded its allowed size.");
        }
        hash.update(value);
        let offset = 0;
        while (offset < value.byteLength) {
          const { bytesWritten } = await handle.write(
            value,
            offset,
            value.byteLength - offset,
            null
          );
          if (bytesWritten <= 0) {
            throw new Error("Unable to write downloaded data.");
          }
          offset += bytesWritten;
        }
        onProgress?.(received, total);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }

    if (total !== undefined && received !== total) {
      throw new Error("The download was incomplete.");
    }
    if (hash.digest("hex") !== input.sha256.toLowerCase()) {
      throw new Error("SHA-256 verification failed. The file was not installed.");
    }
    await handle.close();
    await rm(input.destination, { force: true });
    await rename(tempFile, input.destination);
  } finally {
    await handle.close().catch(() => undefined);
    await rm(tempFile, { force: true }).catch(() => undefined);
  }
}

export const defaultLocalModel = {
  id: "qwen3-1.7b-q4km",
  label: "CodingSensei Lite — Qwen3 1.7B",
  description: "One small model for project reasoning and code planning (Q4_K_M).",
  license: "Apache-2.0",
  publisher: "ggml-org / Qwen",
  approximateDownloadBytes: 1_282_000_000,
  fileName: "Qwen3-1.7B-Q4_K_M.gguf",
  url: "https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf",
  sha256: "d2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5"
} as const;

export class LocalModelStore {
  constructor(private readonly storagePath: string) {}

  get modelPath(): string {
    return join(this.storagePath, "models", defaultLocalModel.fileName);
  }

  async isInstalled(): Promise<boolean> {
    return fileMatchesChecksum(this.modelPath, defaultLocalModel.sha256);
  }

  async install(signal?: AbortSignal, onProgress?: DownloadProgress): Promise<void> {
    if (await this.isInstalled()) {
      return;
    }
    await downloadVerified(
      {
        url: defaultLocalModel.url,
        sha256: defaultLocalModel.sha256,
        destination: this.modelPath,
        maxBytes: 2_000_000_000
      },
      signal,
      onProgress
    );
  }
}
