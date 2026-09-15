import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, DEFAULT_ROUTES, parseCodexVersion, resolveRouteModel } from "../state/routing.js";

test("parses the version out of `codex --version` output", () => {
  assert.equal(parseCodexVersion("codex-cli 0.147.0"), "0.147.0");
  assert.equal(parseCodexVersion("codex-cli 0.155.0-alpha.3"), "0.155.0");
  assert.equal(parseCodexVersion("garbage"), null);
});

test("compares versions numerically, not lexically", () => {
  assert.equal(compareVersions("0.153.0", "0.153.0"), 0);
  assert.equal(compareVersions("0.147.0", "0.153.0"), -1);
  assert.equal(compareVersions("0.154.0", "0.153.0"), 1);
  // "0.9.0" < "0.10.0" numerically; a string compare would get this backwards.
  assert.equal(compareVersions("0.9.0", "0.10.0"), -1);
  assert.equal(compareVersions("1.0.0", "0.999.0"), 1);
});

test("a route without a gate is honoured as-is", () => {
  assert.deepEqual(resolveRouteModel({ model: "gpt-5.6-luna" }, null), { model: "gpt-5.6-luna" });
  assert.deepEqual(resolveRouteModel({ model: "gpt-5.6-luna" }, "0.1.0"), { model: "gpt-5.6-luna" });
});

test("a gated route falls back below its minimum and explains itself", () => {
  const route = { model: "gpt-6-astra", minCodex: "0.153.0", fallback: "gpt-5.6-sol" };
  const below = resolveRouteModel(route, "0.147.0");
  assert.equal(below?.model, "gpt-5.6-sol");
  assert.match(below?.note ?? "", /gpt-6-astra needs Codex >= 0\.153\.0 \(installed 0\.147\.0\); using gpt-5\.6-sol/);

  assert.deepEqual(resolveRouteModel(route, "0.153.0"), { model: "gpt-6-astra" });
  assert.deepEqual(resolveRouteModel(route, "0.154.0"), { model: "gpt-6-astra" });
});

// Launching a model the server will refuse is a worse failure than launching the previous
// default, so an unknown version is treated as too old rather than optimistically.
test("an unreadable version falls back too, and says the version could not be read", () => {
  const route = { model: "gpt-6-astra", minCodex: "0.153.0", fallback: "gpt-5.6-sol" };
  const unknown = resolveRouteModel(route, null);
  assert.equal(unknown?.model, "gpt-5.6-sol");
  assert.match(unknown?.note ?? "", /could not be read/);
});

test("a route with no model resolves to nothing", () => {
  assert.equal(resolveRouteModel({ effort: "high" }, "0.154.0"), null);
});

// Guard: every gated default must carry a fallback, or the gate has nothing to fall to.
test("every gated default route names a fallback", () => {
  for (const [stage, route] of Object.entries(DEFAULT_ROUTES)) {
    if (route.minCodex) assert.ok(route.fallback, `${stage} declares minCodex without a fallback`);
    if (route.fallback) assert.ok(route.minCodex, `${stage} declares a fallback without a minCodex`);
  }
});
