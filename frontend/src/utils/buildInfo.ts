/**
 * Build info (2026-08-20): version + repo commit + build/start time for the
 * Product -> Info modal.
 *
 * The values are compile-time constants injected by vite.config.ts `define`
 * (repo-root VERSION file, `git rev-parse --short HEAD`, dev-server/build
 * start time). The typeof guards make this module safe in any environment
 * where the defines are absent (plain tsc, a stripped test config): every
 * field degrades to 'unknown', never a ReferenceError.
 */

declare const __APP_VERSION__: string | undefined;
declare const __APP_COMMIT__: string | undefined;
declare const __APP_BUILT_AT__: string | undefined;

export interface BuildInfo {
  /** Repo-root VERSION file content (e.g. "0.30.0"), or 'unknown'. */
  version: string;
  /** Short git commit id of the running clone (e.g. "f41ec8c3"), or 'unknown'. */
  commit: string;
  /** ISO time the frontend build / dev server started, or 'unknown'. */
  builtAt: string;
}

function defined(value: string | undefined): string {
  return typeof value === 'string' && value.length > 0 ? value : 'unknown';
}

export function getBuildInfo(): BuildInfo {
  return {
    version: defined(typeof __APP_VERSION__ === 'undefined' ? undefined : __APP_VERSION__),
    commit: defined(typeof __APP_COMMIT__ === 'undefined' ? undefined : __APP_COMMIT__),
    builtAt: defined(typeof __APP_BUILT_AT__ === 'undefined' ? undefined : __APP_BUILT_AT__),
  };
}
