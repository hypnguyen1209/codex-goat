import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Fetch the prebuilt `goat-runtime` for this platform from the GitHub release that matches
 * the installed package version.
 *
 * The native binary is the fast path for the SessionStart and Stop hooks; codex-goat works
 * without it and falls back to Node. Until 0.1.6 the README asked users to download it by
 * hand from the release page. `npm install` now does that: every release publishes one raw
 * binary per platform next to the archives, plus a `checksums.txt`, so this needs an HTTP
 * GET, a SHA-256, and a rename — no archive parser, no dependency.
 *
 * Everything here is best-effort and reports rather than throws. An install must never
 * fail because GitHub was unreachable or the platform has no prebuilt binary.
 */

export const RELEASE_REPO = "hypnguyen1209/codex-goat";

/** Release asset name per `process.platform-process.arch`, matching release.yml's matrix. */
export const RUNTIME_TARGETS: Readonly<Record<string, string>> = {
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
  "darwin-x64": "darwin-x64",
  "darwin-arm64": "darwin-arm64",
  "win32-x64": "windows-x64",
};

export function runtimeBinaryName(platform: string = process.platform): string {
  return platform === "win32" ? "goat-runtime.exe" : "goat-runtime";
}

/** `goat-runtime-0.1.6-linux-x64`, `goat-runtime-0.1.6-windows-x64.exe`, or null when unsupported. */
export function runtimeAssetName(version: string, platform: string = process.platform, arch: string = process.arch): string | null {
  const target = RUNTIME_TARGETS[`${platform}-${arch}`];
  if (!target) return null;
  return `goat-runtime-${version}-${target}${platform === "win32" ? ".exe" : ""}`;
}

export function releaseAssetUrl(version: string, asset: string): string {
  return `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${asset}`;
}

/** `sha256sum` output: `<hex>  <filename>` per line. */
export function parseChecksums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (match?.[1] && match[2]) out.set(match[2].trim(), match[1].toLowerCase());
  }
  return out;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface NativeInstallOptions {
  version: string;
  destDir: string;
  platform?: string;
  arch?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
  /** Runs the freshly written binary once. Defaults to the real hook smoke test. */
  smoke?: (binary: string) => boolean;
}

export interface NativeInstallResult {
  status: "installed" | "skipped" | "failed";
  detail: string;
  binary?: string;
}

/** The runtime must answer garbage with `{}` — the same contract the hook tests pin. */
export function nativeSmokeTest(binary: string): boolean {
  const result = spawnSync(binary, ["hook"], { input: "not json", encoding: "utf8", timeout: 5_000, windowsHide: true });
  return result.status === 0 && result.stdout.trim() === "{}";
}

export async function installNativeRuntime(options: NativeInstallOptions): Promise<NativeInstallResult> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const asset = runtimeAssetName(options.version, platform, arch);
  if (!asset) return { status: "skipped", detail: `no prebuilt goat-runtime for ${platform}-${arch}; the Node hook path is used` };

  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) return { status: "skipped", detail: "no fetch available in this Node; the Node hook path is used" };
  const timeoutMs = options.timeoutMs ?? 20_000;

  const get = async (url: string): Promise<{ status: number; bytes: Uint8Array | null }> => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { status: response.status, bytes: null };
    return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
  };

  try {
    const sums = await get(releaseAssetUrl(options.version, "checksums.txt"));
    if (!sums.bytes) {
      return { status: "skipped", detail: `release v${options.version} has no checksums.txt yet (HTTP ${sums.status}); the Node hook path is used` };
    }
    const expected = parseChecksums(Buffer.from(sums.bytes).toString("utf8")).get(asset);
    if (!expected) return { status: "skipped", detail: `release v${options.version} publishes no ${asset}; the Node hook path is used` };

    const download = await get(releaseAssetUrl(options.version, asset));
    if (!download.bytes) return { status: "failed", detail: `download of ${asset} returned HTTP ${download.status}` };
    const actual = sha256(download.bytes);
    if (actual !== expected) {
      return { status: "failed", detail: `checksum mismatch for ${asset} (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…); not installed` };
    }

    mkdirSync(options.destDir, { recursive: true });
    const binary = join(options.destDir, runtimeBinaryName(platform));
    const staging = `${binary}.download`;
    writeFileSync(staging, download.bytes);
    if (platform !== "win32") chmodSync(staging, 0o755);
    if (existsSync(binary)) rmSync(binary, { force: true });
    renameSync(staging, binary);

    const smoke = options.smoke ?? nativeSmokeTest;
    if (!smoke(binary)) {
      rmSync(binary, { force: true });
      return { status: "failed", detail: `${asset} downloaded but did not answer the hook smoke test; removed, the Node hook path is used` };
    }
    return { status: "installed", detail: `${asset} verified and installed`, binary };
  } catch (error) {
    return { status: "failed", detail: `could not fetch ${asset}: ${(error as Error).message}; the Node hook path is used` };
  }
}
