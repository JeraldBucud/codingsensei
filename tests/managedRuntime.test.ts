import { describe, expect, it } from "vitest";

import { createLlamaServerArgs } from "../src/chat/managedLlamaCppProvider";
import { isSafeArchiveEntry, runtimeAssetName } from "../src/chat/managedRuntimeStore";

describe("managed llama.cpp runtime", () => {
  it("selects only curated CPU artifacts for supported platforms", () => {
    expect(runtimeAssetName("win32", "x64")).toBe("llama-b12142-bin-win-cpu-x64.zip");
    expect(runtimeAssetName("win32", "arm64")).toBe("llama-b12142-bin-win-cpu-arm64.zip");
    expect(runtimeAssetName("darwin", "arm64")).toBe("llama-b12142-bin-macos-arm64.tar.gz");
    expect(runtimeAssetName("darwin", "x64")).toBe("llama-b12142-bin-macos-x64.tar.gz");
    expect(runtimeAssetName("linux", "x64")).toBe("llama-b12142-bin-ubuntu-x64.tar.gz");
    expect(runtimeAssetName("linux", "arm64")).toBe("llama-b12142-bin-ubuntu-arm64.tar.gz");
    expect(runtimeAssetName("freebsd", "x64")).toBeUndefined();
    expect(runtimeAssetName("linux", "ppc64")).toBeUndefined();
  });

  it("rejects archive path traversal and absolute paths", () => {
    expect(isSafeArchiveEntry("bin/llama-server")).toBe(true);
    expect(isSafeArchiveEntry("lib/libggml.so")).toBe(true);
    expect(isSafeArchiveEntry("../outside.txt")).toBe(false);
    expect(isSafeArchiveEntry("bin/../../outside.txt")).toBe(false);
    expect(isSafeArchiveEntry("/etc/passwd")).toBe(false);
    expect(isSafeArchiveEntry("C:\\temp\\bad.exe")).toBe(false);
    expect(isSafeArchiveEntry("bin\\..\\bad.exe")).toBe(false);
  });

  it("binds the model runtime only to localhost with an API key", () => {
    const args = createLlamaServerArgs("/models/local.gguf", 43435, "secret-token");
    expect(args).toContain("127.0.0.1");
    expect(args).toContain("/models/local.gguf");
    expect(args).toContain("--api-key");
    expect(args).toContain("secret-token");
    expect(args).toContain("--no-webui");
    expect(args).toContain("--n-gpu-layers");
    expect(args).not.toContain("0.0.0.0");
    expect(() => createLlamaServerArgs("", 43435, "secret-token")).toThrow(
      "Invalid managed runtime configuration"
    );
    expect(() => createLlamaServerArgs("/models/local.gguf", 0, "secret-token")).toThrow(
      "Invalid managed runtime configuration"
    );
  });
});
