/**
 * Preflight cached clone helper
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 5.4.
 *
 * Wraps {@link gitCloneRepoAccess.cloneRepo} with a `(projectId, repoUrl,
 * branch)`-keyed cache + 10-minute TTL at
 * `os.tmpdir()/discovery-preflight-<projectId>-<repoUrlSlug>-<branch>/`.
 * Subsequent same-tuple preflight requests reuse the cached clone; the
 * actual library-scan run also reuses the cached clone if still warm,
 * otherwise re-clones to the run's `discovery-<runId>/` dir (handled by
 * the orchestrator).
 *
 * For local repo locations (file paths), the cache short-circuits and
 * returns the absolute local path directly — there's no actual git
 * clone happening.
 */

import * as os from 'os';
import * as path from 'path';
import { gitCloneRepoAccess, isGitRepoUrl, normalizeRepoLocation, repoSlug } from './repoAccess';

const PREFLIGHT_TTL_MS = 10 * 60 * 1000; // 10 minutes per spec.

interface PreflightCacheEntry {
  dir: string;
  expiresAt: number;
}

const cache = new Map<string, PreflightCacheEntry>();

function cacheKey(projectId: string, repoUrl: string, branch: string): string {
  return `${projectId}::${repoUrl}::${branch}`;
}

/**
 * Returns a directory containing the cloned repo, reusing the cache when
 * the same `(projectId, repoUrl, branch)` tuple was cloned within the
 * 10-minute TTL window.
 *
 * For local file paths (anything not matching `git@` / `http://` /
 * `https://`), returns the normalised path directly with no clone.
 *
 * @param projectId - The project UUID (cache-key isolation across projects).
 * @param repoUrl   - Either a remote URL or a local filesystem path.
 * @param branch    - Branch hint (default `'main'` is the caller's job).
 * @returns Absolute path to the (possibly cached) clone or local source.
 */
export async function getOrClonePreflightRepo(
  projectId: string,
  repoUrl: string,
  branch: string,
): Promise<string> {
  const normalised = normalizeRepoLocation(repoUrl);

  if (!isGitRepoUrl(normalised)) {
    return normalised;
  }

  const key = cacheKey(projectId, normalised, branch);
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.dir;
  }

  const dir = path.join(
    os.tmpdir(),
    `discovery-preflight-${projectId}-${repoSlug(normalised)}-${branch}`,
  );
  await gitCloneRepoAccess.cloneRepo(normalised, branch, dir);

  cache.set(key, {
    dir,
    expiresAt: now + PREFLIGHT_TTL_MS,
  });

  return dir;
}

/**
 * Looks up an existing cached preflight clone. Returns undefined when no
 * (still-warm) cache entry exists. The actual run uses this to reuse the
 * preflight clone instead of re-cloning to its `discovery-<runId>/` dir.
 */
export function getCachedPreflightDir(
  projectId: string,
  repoUrl: string,
  branch: string,
): string | undefined {
  const normalised = normalizeRepoLocation(repoUrl);
  const key = cacheKey(projectId, normalised, branch);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.dir;
}

/**
 * Clears the preflight cache. Test-only helper.
 */
export function clearPreflightCache(): void {
  cache.clear();
}
