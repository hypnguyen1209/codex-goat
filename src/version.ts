/**
 * Compile-time version, used when `package.json` is not reachable at runtime — which is
 * the case inside a `bun build --compile` binary.
 *
 * `scripts/verify-bundle.mjs` fails the build if this drifts from `package.json`.
 */
export const VERSION = "0.1.2";
