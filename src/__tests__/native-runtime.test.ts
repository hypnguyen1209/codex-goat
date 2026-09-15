import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  type FetchLike,
  installNativeRuntime,
  parseChecksums,
  releaseAssetUrl,
  runtimeAssetName,
  sha256,
} from "../setup/native-runtime.js";

const sandbox = mkdtempSync(join(tmpdir(), "goat-native-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

test("asset names follow the release matrix, and unsupported platforms get null", () => {
  assert.equal(runtimeAssetName("0.1.6", "linux", "x64"), "goat-runtime-0.1.6-linux-x64");
  assert.equal(runtimeAssetName("0.1.6", "linux", "arm64"), "goat-runtime-0.1.6-linux-arm64");
  assert.equal(runtimeAssetName("0.1.6", "darwin", "arm64"), "goat-runtime-0.1.6-darwin-arm64");
  assert.equal(runtimeAssetName("0.1.6", "win32", "x64"), "goat-runtime-0.1.6-windows-x64.exe");
  assert.equal(runtimeAssetName("0.1.6", "win32", "arm64"), null);
  assert.equal(runtimeAssetName("0.1.6", "freebsd", "x64"), null);
  assert.equal(releaseAssetUrl("0.1.6", "checksums.txt"), "https://github.com/hypnguyen1209/codex-goat/releases/download/v0.1.6/checksums.txt");
});

test("checksums.txt parses the sha256sum format, including a binary-mode marker", () => {
  const sums = parseChecksums(["abc".padEnd(64, "0") + "  goat-runtime-0.1.6-linux-x64", "def".padEnd(64, "1") + " *goat-runtime-0.1.6-windows-x64.exe", "not a checksum line"].join("\n"));
  assert.equal(sums.get("goat-runtime-0.1.6-linux-x64"), "abc".padEnd(64, "0"));
  assert.equal(sums.get("goat-runtime-0.1.6-windows-x64.exe"), "def".padEnd(64, "1"));
  assert.equal(sums.size, 2);
});

/** A fake GitHub: checksums.txt plus one asset, with an injectable status per URL. */
function fakeRelease(assets: Record<string, Uint8Array>, statuses: Record<string, number> = {}): FetchLike {
  const sums = Object.entries(assets)
    .map(([name, bytes]) => `${sha256(bytes)}  ${name}`)
    .join("\n");
  return async (url) => {
    const name = url.slice(url.lastIndexOf("/") + 1);
    const status = statuses[name] ?? (name === "checksums.txt" || name in assets ? 200 : 404);
    const body = name === "checksums.txt" ? new TextEncoder().encode(sums) : (assets[name] ?? new Uint8Array());
    return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer };
  };
}

test("a verified download lands as bin/goat-runtime, executable, and passes the smoke test", async () => {
  const bytes = new TextEncoder().encode("#!/bin/sh\necho '{}'\n");
  const dest = join(sandbox, "ok", "bin");
  const result = await installNativeRuntime({
    version: "0.1.6",
    platform: "linux",
    arch: "x64",
    destDir: dest,
    fetch: fakeRelease({ "goat-runtime-0.1.6-linux-x64": bytes }),
    smoke: () => true,
  });
  assert.equal(result.status, "installed", result.detail);
  const binary = join(dest, "goat-runtime");
  assert.ok(existsSync(binary));
  assert.equal(readFileSync(binary, "utf8"), "#!/bin/sh\necho '{}'\n");
  if (process.platform !== "win32") assert.ok(statSync(binary).mode & 0o100, "not executable");
  assert.ok(!existsSync(`${binary}.download`), "staging file left behind");
});

test("a checksum mismatch installs nothing", async () => {
  const good = new TextEncoder().encode("good");
  const fetch = fakeRelease({ "goat-runtime-0.1.6-linux-x64": good });
  // Serve different bytes than the checksum was computed from.
  const tampered: FetchLike = async (url, init) => {
    const response = await fetch(url, init);
    if (url.endsWith("linux-x64")) return { ...response, arrayBuffer: async () => new TextEncoder().encode("evil").buffer as ArrayBuffer };
    return response;
  };
  const dest = join(sandbox, "bad", "bin");
  const result = await installNativeRuntime({ version: "0.1.6", platform: "linux", arch: "x64", destDir: dest, fetch: tampered, smoke: () => true });
  assert.equal(result.status, "failed");
  assert.match(result.detail, /checksum mismatch/);
  assert.ok(!existsSync(join(dest, "goat-runtime")));
});

test("a release that does not exist yet is skipped, not failed", async () => {
  const result = await installNativeRuntime({
    version: "9.9.9",
    platform: "linux",
    arch: "x64",
    destDir: join(sandbox, "none"),
    fetch: fakeRelease({}, { "checksums.txt": 404 }),
    smoke: () => true,
  });
  assert.equal(result.status, "skipped");
  assert.match(result.detail, /no checksums\.txt yet \(HTTP 404\)/);
});

test("an unsupported platform is skipped before any network call", async () => {
  let calls = 0;
  const fetch: FetchLike = async () => {
    calls += 1;
    throw new Error("must not be called");
  };
  const result = await installNativeRuntime({ version: "0.1.6", platform: "freebsd", arch: "x64", destDir: join(sandbox, "bsd"), fetch });
  assert.equal(result.status, "skipped");
  assert.equal(calls, 0);
});

test("a binary that fails the smoke test is removed and reported", async () => {
  const bytes = new TextEncoder().encode("garbage");
  const dest = join(sandbox, "smoke", "bin");
  const result = await installNativeRuntime({
    version: "0.1.6",
    platform: "linux",
    arch: "x64",
    destDir: dest,
    fetch: fakeRelease({ "goat-runtime-0.1.6-linux-x64": bytes }),
    smoke: () => false,
  });
  assert.equal(result.status, "failed");
  assert.match(result.detail, /smoke test/);
  assert.ok(!existsSync(join(dest, "goat-runtime")));
});

test("a network error is reported, never thrown", async () => {
  const fetch: FetchLike = async () => {
    throw new Error("ENOTFOUND github.com");
  };
  const result = await installNativeRuntime({ version: "0.1.6", platform: "linux", arch: "x64", destDir: join(sandbox, "net"), fetch });
  assert.equal(result.status, "failed");
  assert.match(result.detail, /ENOTFOUND/);
});
