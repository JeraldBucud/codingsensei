import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import { downloadVerified, type DownloadProgress } from "./localModelStore";

const execFileAsync = promisify(execFile);
const releaseTag = "b12142";
const releaseApi = `https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/${releaseTag}`;
const releaseAssets = `https://github.com/ggml-org/llama.cpp/releases/download/${releaseTag}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function runtimeAssetName(platform: NodeJS.Platform, arch: string): string | undefined {
  const platformName =
    platform === "win32"
      ? "win-cpu"
      : platform === "darwin"
        ? "macos"
        : platform === "linux"
          ? "ubuntu"
          : undefined;
  const architecture = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : undefined;
  if (!platformName || !architecture) {
    return undefined;
  }
  const suffix = platform === "win32" ? "zip" : "tar.gz";
  return `llama-${releaseTag}-bin-${platformName}-${architecture}.${suffix}`;
}

export function isSafeArchiveEntry(entry: string): boolean {
  const normalized = entry.replaceAll("\\", "/");
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !/^[a-zA-Z]:/.test(normalized) &&
    !normalized.split("/").includes("..")
  );
}

async function findServerBinary(directory: string, depth = 0): Promise<string | undefined> {
  if (depth > 4) {
    return undefined;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && (entry.name === "llama-server" || entry.name === "llama-server.exe")) {
      return join(directory, entry.name);
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = await findServerBinary(join(directory, entry.name), depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

async function getPinnedDigest(assetName: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(releaseApi, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "CodingSensei" },
    signal
  });
  if (!response.ok) {
    throw new Error(
      `Cannot verify the pinned llama.cpp release (HTTP ${String(response.status)}).`
    );
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload["assets"])) {
    throw new Error("The pinned runtime release returned invalid metadata.");
  }
  const assets: readonly unknown[] = payload["assets"];
  const asset = assets.find((item) => isRecord(item) && item["name"] === assetName);
  if (!isRecord(asset)) {
    throw new Error("No compatible CPU runtime is published for this platform.");
  }
  const digest = asset["digest"];
  if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(digest)) {
    throw new Error("The official runtime asset has no verifiable SHA-256 digest.");
  }
  return digest.slice("sha256:".length).toLowerCase();
}

export class ManagedRuntimeStore {
  constructor(
    private readonly storagePath: string,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly arch: string = process.arch
  ) {}

  private get assetName(): string {
    const asset = runtimeAssetName(this.platform, this.arch);
    if (!asset) {
      throw new Error("This platform is not yet supported by CodingSensei's local AI engine.");
    }
    return asset;
  }

  private get runtimeDirectory(): string {
    return join(this.storagePath, "runtime", `${releaseTag}-${this.platform}-${this.arch}`);
  }

  async installedBinary(): Promise<string | undefined> {
    try {
      return await findServerBinary(this.runtimeDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async install(signal?: AbortSignal, onProgress?: DownloadProgress): Promise<string> {
    const existing = await this.installedBinary();
    if (existing) {
      return existing;
    }

    const assetName = this.assetName;
    const digest = await getPinnedDigest(assetName, signal);
    const runtimeRoot = dirname(this.runtimeDirectory);
    const archive = join(runtimeRoot, `${randomUUID()}-${basename(assetName)}`);
    const staging = join(runtimeRoot, `staging-${randomUUID()}`);
    await mkdir(staging, { recursive: true });
    try {
      await downloadVerified(
        {
          url: `${releaseAssets}/${assetName}`,
          sha256: digest,
          destination: archive,
          maxBytes: 200_000_000
        },
        signal,
        onProgress
      );
      const { stdout } = await execFileAsync("tar", ["-tf", archive], {
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
        signal
      });
      const entries = stdout.split(/\r?\n/).filter(Boolean);
      if (entries.length === 0 || !entries.every(isSafeArchiveEntry)) {
        throw new Error("The runtime archive contains unsafe paths or no files.");
      }
      await execFileAsync("tar", ["-xf", archive, "-C", staging], {
        timeout: 60_000,
        signal
      });
      const binary = await findServerBinary(staging);
      if (!binary) {
        throw new Error("The verified runtime archive did not include llama-server.");
      }
      if (this.platform !== "win32") {
        await chmod(binary, 0o755);
      }
      await rm(this.runtimeDirectory, { recursive: true, force: true });
      await rename(staging, this.runtimeDirectory);
      const ready = await this.installedBinary();
      if (!ready || !(await stat(ready)).isFile()) {
        throw new Error("The runtime installation did not produce an executable.");
      }
      return ready;
    } finally {
      await rm(archive, { force: true }).catch(() => undefined);
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
