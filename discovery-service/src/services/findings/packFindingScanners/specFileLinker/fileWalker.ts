/**
 * Repo walker for the `specFileLinker` scanner sub-module.
 *
 * Spec: agent-os/specs/2026-05-17-spec-file-auto-linking-phase-3/spec.md
 *
 * Pure-function repo walker that finds candidate OAS-shaped files. The
 * signature detector (`signatureDetector.ts`) decides which of the
 * returned paths actually qualify as an OAS spec; the walker itself
 * does no content inspection beyond extension filtering.
 *
 * Public API:
 *   findSpecFileCandidates(repoRoot, serviceRootPath)
 *     -> SpecFileCandidate[]    // { path, content, format }
 *
 * Three walked scopes:
 *  1. `src/main/resources/**\/*.{yaml,yml,json}` -- recursive under the
 *     standard Spring/Maven resources directory.
 *  2. Direct `src/main/resources/` children -- top-level `.{yaml,yml,json}`
 *     files directly under the resources directory (already covered by
 *     scope 1's recursion, called out for spec parity).
 *  3. The project root -- top-level `.{yaml,yml,json}` files directly
 *     under the repo root (NOT recursive across the entire repo).
 *
 * Service-root scoping rule (P-17): when `serviceRootPath` is non-null,
 * files whose repo-relative path does NOT start with the service-root
 * prefix are filtered out before being returned. Cross-service spec
 * sharing in a monorepo is intentionally invisible to the matcher --
 * the orphan / ambiguous emission path runs only over in-scope files.
 *
 * Side effects: READ-ONLY. The walker calls `fs.readdirSync` to discover
 * paths and `fs.readFileSync` to load contents. It performs NO writes
 * and holds NO cross-call cache. The disk reads are a deterministic
 * function of `(repoRoot, serviceRootPath)`.
 *
 * Design-point references: P-17 (service-root scoping).
 */

import * as fs from 'fs';
import * as path from 'path';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

/**
 * Candidate spec-file record returned by the walker. Path is repo-relative
 * (uses forward slashes for stable cross-platform comparison against the
 * downstream service-root prefix string).
 */
export interface SpecFileCandidate {
  /** Repo-relative path with forward-slash separators. */
  path: string;
  /** File contents as a UTF-8 string. */
  content: string;
  /** Inferred format from file extension. */
  format: 'yaml' | 'json';
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const SPEC_EXTENSIONS: ReadonlySet<string> = new Set(['.yaml', '.yml', '.json']);

/** Normalize a path to use forward slashes (stable cross-platform). */
function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Detect format from extension. Returns null when the extension is not
 * one of the three accepted types.
 */
function detectFormat(filePath: string): 'yaml' | 'json' | null {
  const ext = path.extname(filePath).toLowerCase();
  if (!SPEC_EXTENSIONS.has(ext)) return null;
  if (ext === '.json') return 'json';
  return 'yaml';
}

/**
 * Recursive directory walker. Returns absolute paths to every file under
 * `absDir`. Silently swallows directory-read errors (the walker should
 * never abort a discovery run on a missing optional path).
 */
function walkRecursive(absDir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      // Skip common heavy directories that never contain spec files.
      if (entry.name === 'node_modules' || entry.name === 'target' || entry.name === '.git') {
        continue;
      }
      out.push(...walkRecursive(abs));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Non-recursive directory listing -- returns absolute paths to every
 * regular file directly under `absDir`. Silently swallows missing-dir
 * errors.
 */
function listTopLevelFiles(absDir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isFile()) {
      out.push(path.join(absDir, entry.name));
    }
  }
  return out;
}

/** Convert an absolute path to a repo-relative posix string. */
function toRepoRelative(repoRoot: string, absPath: string): string {
  const rel = path.relative(repoRoot, absPath);
  return toPosix(rel);
}

/**
 * Service-root prefix test. `serviceRootPath` is treated as a posix-style
 * repo-relative directory prefix. A file is in-scope when its repo-relative
 * path equals the prefix OR begins with `${prefix}/`.
 *
 * `null` `serviceRootPath` means "no scoping" -- every candidate file
 * passes through.
 */
function isInServiceScope(
  repoRelPath: string,
  serviceRootPath: string | null,
): boolean {
  if (!serviceRootPath) return true;
  const normalized = serviceRootPath.replace(/^[\\/]+|[\\/]+$/g, ''); // strip leading/trailing slashes
  if (normalized.length === 0) return true;
  const posixPrefix = normalized.split(path.sep).join('/');
  if (repoRelPath === posixPrefix) return true;
  return repoRelPath.startsWith(`${posixPrefix}/`);
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Walk the three documented scopes and return every candidate spec-file
 * record (path + content + format). Caller (signature detector) decides
 * which of these qualify as an OAS spec file.
 *
 * Service-root scoping per P-17: when `serviceRootPath` is supplied,
 * files outside the prefix are NOT returned.
 *
 * Pure (other than disk reads).
 */
export function findSpecFileCandidates(
  repoRoot: string,
  serviceRootPath: string | null,
): SpecFileCandidate[] {
  // The three scopes overlap (scope 1 is a superset of scope 2; scope 3 is
  // disjoint from 1+2). We collect into a Map keyed on repo-relative path
  // to dedupe and preserve a stable per-path order.
  const collected = new Map<string, SpecFileCandidate>();

  // Scope 1 + 2: recursive walk of `src/main/resources/`.
  const resourcesDir = path.join(repoRoot, 'src', 'main', 'resources');
  for (const abs of walkRecursive(resourcesDir)) {
    const format = detectFormat(abs);
    if (!format) continue;
    const rel = toRepoRelative(repoRoot, abs);
    if (!isInServiceScope(rel, serviceRootPath)) continue;
    if (collected.has(rel)) continue;
    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    collected.set(rel, { path: rel, content, format });
  }

  // Scope 3: top-level files under the project root (NOT recursive).
  for (const abs of listTopLevelFiles(repoRoot)) {
    const format = detectFormat(abs);
    if (!format) continue;
    const rel = toRepoRelative(repoRoot, abs);
    if (!isInServiceScope(rel, serviceRootPath)) continue;
    if (collected.has(rel)) continue;
    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    collected.set(rel, { path: rel, content, format });
  }

  return Array.from(collected.values());
}
