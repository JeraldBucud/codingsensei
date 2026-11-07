import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultLocalModel,
  downloadVerified,
  fileMatchesChecksum
} from "../src/chat/localModelStore";

const temporaryDirectories: string[] = [];

async function destinationPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "codingsensei-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "model.gguf");
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("managed model downloads", () => {
  it("pins an upstream model, licence, and SHA-256 checksum", () => {
    expect(defaultLocalModel.license).toBe("Apache-2.0");
    expect(defaultLocalModel.url).toMatch(/^https:\/\/huggingface\.co\/ggml-org\//);
    expect(defaultLocalModel.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("writes and rechecks a verified download", async () => {
    const payload = "safe gguf test payload";
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const destination = await destinationPath();
    const progress: number[] = [];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(payload, { headers: { "content-length": String(payload.length) } })
    );
    await downloadVerified(
      { destination, url: "https://example.org/fake.gguf", sha256, maxBytes: 1024 },
      undefined,
      (received) => {
        progress.push(received);
      }
    );
    expect(await readFile(destination, "utf8")).toBe(payload);
    expect(await fileMatchesChecksum(destination, sha256)).toBe(true);
    expect(progress.at(-1)).toBe(payload.length);
  });

  it("rejects tampered files before installing them", async () => {
    const destination = await destinationPath();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("tampered"));
    await expect(
      downloadVerified({
        destination,
        url: "https://example.org/fake.gguf",
        sha256: "0".repeat(64),
        maxBytes: 1024
      })
    ).rejects.toThrow("SHA-256");
    expect(await fileMatchesChecksum(destination, "0".repeat(64))).toBe(false);
  });

  it("rejects oversized responses before writing to disk", async () => {
    const destination = await destinationPath();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("too large", { headers: { "content-length": "9999" } })
    );
    await expect(
      downloadVerified({
        destination,
        url: "https://example.org/fake.gguf",
        sha256: "0".repeat(64),
        maxBytes: 100
      })
    ).rejects.toThrow("larger than the allowed size");
  });
});
