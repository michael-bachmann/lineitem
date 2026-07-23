/**
 * Gated debug logging. On automatically in the dev server (`wxt dev`, where
 * `import.meta.env.DEV` is true) and in a debug build (`pnpm build:debug`, which
 * defines `__DEBUG__ = true`). Off in the shipped `wxt build`. `dlog()` is a
 * no-op unless enabled, so it's safe to call from any hot path.
 */

// Injected by wxt.config's vite `define` for `pnpm build:debug`; absent (hence
// the typeof guard) under vitest, which doesn't run that define.
declare const __DEBUG__: boolean | undefined;

let enabled =
  import.meta.env.DEV === true ||
  (typeof __DEBUG__ !== "undefined" && __DEBUG__ === true);

/** Whether gated debug logging is currently on. */
export function isDebugEnabled(): boolean {
  return enabled;
}

/** Override the flag. Used by tests; production code relies on the build-time
 *  default above. */
export function setDebugEnabled(value: boolean): void {
  enabled = value;
}

/** Log under `[lineitem:<scope>]` when debug logging is on; otherwise a no-op. */
export function dlog(scope: string, ...args: unknown[]): void {
  if (enabled) console.log(`[lineitem:${scope}]`, ...args);
}
