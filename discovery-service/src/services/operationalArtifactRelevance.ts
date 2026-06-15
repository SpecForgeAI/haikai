/**
 * Operational-Artifact Relevance Predicate + File-Count Cap (pure).
 *
 * Spec: 2026-06-14 Generic Operational-Artifact Discovery (D1), Task Group 2.
 *
 * This module is the BROAD inverse of `scanPlanBuilder.SOURCE_EXTENSIONS`. It is
 * pure (no I/O, no LLM, no findings): given a file's relative path, a small
 * head of its bytes, and the set of paths the deterministic packs already
 * consumed, it answers "is this file an unclaimed-but-relevant operational
 * artifact, and which relevance signal selected it?".
 *
 * Why broad (Decision 2 -- load-bearing): a strict extension allow-list would
 * simply re-create the very `SOURCE_EXTENSIONS` whitelist gap D1 exists to
 * close (extensionless shell scripts, `.cfg` / `.conf` / `.properties`, `.jil`,
 * `.pl`, proprietary configs would all be missed again). So a file is IN when
 * it is UNCLAIMED by a deterministic parser/pack AND hits >= 1 relevance
 * signal:
 *   - an operational file extension (`OPERATIONAL_ARTIFACT_EXTENSIONS`), OR
 *   - a shebang first line (`#!`), OR
 *   - residence in a priority directory (`OPERATIONAL_ARTIFACT_PRIORITY_DIRS`), OR
 *   - being referenced / invoked by a known atom (caller supplies the set),
 * then survives the standard exclusion sets (`SKIP_DIRECTORIES` /
 * `EXCLUDED_FILENAMES` / `EXCLUDED_EXTENSIONS` from `scanPlanBuilder.ts`) plus
 * the binary / null-byte / >= 1MB filters.
 *
 * Plain `.xml` is IN by default but DEDUPED against XML the packs already
 * consumed -- "unclaimed by a parser" is the gate, so a config XML a pack
 * parsed is not re-summarised. The caller passes the set of pack-consumed /
 * claimed file paths.
 */

import * as path from 'path';
import {
  SKIP_DIRECTORIES,
  EXCLUDED_FILENAMES,
  EXCLUDED_EXTENSIONS,
} from './scanPlanBuilder';
import {
  OPERATIONAL_ARTIFACT_EXTENSIONS,
  OPERATIONAL_ARTIFACT_PRIORITY_DIRS,
  OPERATIONAL_ARTIFACT_FILE_CAP,
} from '../config';

/**
 * Hard byte ceiling: files at/above this size are rejected before/at read so
 * the always-on pass stays affordable without a cost cap (Decision 2/3). 1MB.
 */
export const OPERATIONAL_ARTIFACT_MAX_BYTES = 1024 * 1024;

/**
 * The relevance signal that selected a file. Rides on `detailJson` later so a
 * reviewer can see WHY the file was summarised. `claimed` / `excluded` /
 * `binary` / `too_large` / `no_signal` are the NON-selecting outcomes.
 */
export type RelevanceSignal =
  | 'operational_extension'
  | 'shebang'
  | 'priority_dir'
  | 'referenced_by_atom';

export type RelevanceOutcome =
  | RelevanceSignal
  | 'claimed'
  | 'excluded'
  | 'binary'
  | 'too_large'
  | 'no_signal';

/**
 * Inputs to {@link evaluateOperationalArtifactRelevance}.
 *
 * `filePath` is the repo-relative path (forward-slash or back-slash tolerated).
 * `headBytes` is a small prefix of the file's raw bytes -- enough to detect a
 * NUL byte (binary) and read the first line (shebang). `sizeBytes` is the
 * file's total size on disk. `claimedPaths` are the paths the deterministic
 * packs already consumed (a config XML a pack parsed is excluded). `atomPaths`
 * are paths referenced/invoked by a known atom (the fourth relevance signal).
 *
 * `extensions` / `priorityDirs` default to the env-tunable config lists; tests
 * may override them for determinism.
 */
export interface RelevanceInput {
  filePath: string;
  headBytes: Buffer;
  sizeBytes: number;
  claimedPaths?: ReadonlySet<string>;
  atomPaths?: ReadonlySet<string>;
  extensions?: readonly string[];
  priorityDirs?: readonly string[];
}

export interface RelevanceResult {
  /** True when the file is an unclaimed-but-relevant operational artifact. */
  included: boolean;
  /** The selecting signal when included; otherwise the rejection reason. */
  outcome: RelevanceOutcome;
}

/** Normalise a path to forward slashes for consistent matching. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Detect a NUL byte in the head buffer -- the same cheap binary heuristic used
 * across discovery (a text file never contains a literal 0x00 in its first
 * chunk).
 */
function looksBinary(headBytes: Buffer): boolean {
  for (let i = 0; i < headBytes.length; i += 1) {
    if (headBytes[i] === 0) return true;
  }
  return false;
}

/** Read the first line of the head buffer as UTF-8 (for shebang detection). */
function firstLine(headBytes: Buffer): string {
  const text = headBytes.toString('utf-8');
  const nl = text.indexOf('\n');
  return nl >= 0 ? text.slice(0, nl) : text;
}

/**
 * Is the file excluded by the standard `scanPlanBuilder` skip sets? Mirrors
 * `isExcludedFromLlmAnalysis` (filename + extension) AND adds the
 * `SKIP_DIRECTORIES` segment check so the always-on pass never wanders into
 * `node_modules` / `.git` / `target` / vendored trees.
 */
function isExcludedByStandardSets(
  normalized: string,
  priorityDirs: readonly string[],
): boolean {
  // D1's skip set is `SKIP_DIRECTORIES` MINUS the operational priority dirs.
  // This is load-bearing: `scanPlanBuilder.SKIP_DIRECTORIES` lists `bin` (where
  // .NET / compiled binaries live) -- but `bin`/`scripts`/`ops` are EXACTLY where
  // operational shell artifacts live and are D1 priority dirs (Decision 2).
  // Inheriting `bin` as a skip dir would re-create the very gap D1 closes, so we
  // subtract any priority dir from the skip-dir test.
  const prioritySet = new Set(priorityDirs.map((d) => d.toLowerCase()));
  const segments = normalized.split('/');
  // Any path segment that is a skip directory (and NOT a priority dir) excludes.
  for (const seg of segments.slice(0, -1)) {
    if (SKIP_DIRECTORIES.has(seg) && !prioritySet.has(seg.toLowerCase())) return true;
  }
  const basename = segments[segments.length - 1] || '';
  if (EXCLUDED_FILENAMES.has(basename)) return true;
  const ext = path.extname(basename).toLowerCase();
  if (ext.length > 0 && EXCLUDED_EXTENSIONS.has(ext)) return true;
  return false;
}

/**
 * Does the file reside under a priority directory at ANY depth? Matched
 * case-insensitively against each path segment (excluding the basename).
 */
function residesInPriorityDir(
  normalized: string,
  priorityDirs: readonly string[],
): boolean {
  if (priorityDirs.length === 0) return false;
  const prioritySet = new Set(priorityDirs.map((d) => d.toLowerCase()));
  const segments = normalized.split('/').slice(0, -1);
  for (const seg of segments) {
    if (prioritySet.has(seg.toLowerCase())) return true;
  }
  return false;
}

/**
 * Evaluate a single file. Pure: no I/O -- the caller reads `headBytes` /
 * `sizeBytes` and supplies the claimed/atom path sets.
 *
 * Order of operations (cheapest + hardest exclusions first):
 *   1. >= 1MB        -> rejected (`too_large`).
 *   2. standard sets -> rejected (`excluded`): skip-dirs, lock/JSON, package.json.
 *   3. binary/NUL    -> rejected (`binary`).
 *   4. claimed       -> rejected (`claimed`): a parser/pack already consumed it.
 *   5. relevance     -> first matching signal wins, in a stable priority:
 *      operational_extension > shebang > priority_dir > referenced_by_atom.
 *   6. none          -> rejected (`no_signal`).
 */
export function evaluateOperationalArtifactRelevance(
  input: RelevanceInput,
): RelevanceResult {
  const normalized = normalizePath(input.filePath);
  const extensions = input.extensions ?? OPERATIONAL_ARTIFACT_EXTENSIONS;
  const priorityDirs = input.priorityDirs ?? OPERATIONAL_ARTIFACT_PRIORITY_DIRS;
  const claimedPaths = input.claimedPaths;
  const atomPaths = input.atomPaths;

  // 1. Size ceiling (reject by size before any content inspection).
  if (input.sizeBytes >= OPERATIONAL_ARTIFACT_MAX_BYTES) {
    return { included: false, outcome: 'too_large' };
  }

  // 2. Standard exclusion sets (skip-dirs minus priority dirs, lock files,
  //    JSON, package.json).
  if (isExcludedByStandardSets(normalized, priorityDirs)) {
    return { included: false, outcome: 'excluded' };
  }

  // 3. Binary / null-byte.
  if (looksBinary(input.headBytes)) {
    return { included: false, outcome: 'binary' };
  }

  // 4. Already claimed by a deterministic parser/pack (dedupe XML etc.).
  if (claimedPaths && (claimedPaths.has(normalized) || claimedPaths.has(input.filePath))) {
    return { included: false, outcome: 'claimed' };
  }

  // 5. Relevance signals (any one suffices; stable priority).
  const ext = path.extname(normalized).toLowerCase();
  if (ext.length > 0 && extensions.includes(ext)) {
    return { included: true, outcome: 'operational_extension' };
  }
  // Plain `.xml` is IN by default (deduped above against claimed paths).
  if (ext === '.xml') {
    return { included: true, outcome: 'operational_extension' };
  }
  if (firstLine(input.headBytes).startsWith('#!')) {
    return { included: true, outcome: 'shebang' };
  }
  if (residesInPriorityDir(normalized, priorityDirs)) {
    return { included: true, outcome: 'priority_dir' };
  }
  if (atomPaths && (atomPaths.has(normalized) || atomPaths.has(input.filePath))) {
    return { included: true, outcome: 'referenced_by_atom' };
  }

  return { included: false, outcome: 'no_signal' };
}

/**
 * A file selected by the relevance predicate, carrying the signal that chose it.
 */
export interface SelectedOperationalArtifact<T = unknown> {
  filePath: string;
  relevanceSignal: RelevanceSignal;
  /** Opaque carrier (e.g. absolute path) the caller threads through. */
  carrier: T;
}

/**
 * The result of applying the file-count cap to a deterministically-ordered list
 * of selected files.
 */
export interface CapResult<T = unknown> {
  /** The first N selected files (N = cap). */
  selected: SelectedOperationalArtifact<T>[];
  /** Total number of files that were over the cap (never silently dropped). */
  overflowCount: number;
  /** A small sample of overflow paths for the run-level skip Finding. */
  overflowSample: string[];
  /** The cap that was applied. */
  cap: number;
}

/**
 * Apply the file-count cap (Decision 3). Sorts the selected files into a
 * deterministic path order (mirroring `buildScanPlanFromFilesystem`'s
 * `localeCompare` sort) then takes the first `cap`. Returns the overflow count
 * + a sample so the pass can emit ONE run-level skip Finding -- NEVER a silent
 * drop.
 *
 * @param selected the relevance-selected files (any order)
 * @param cap defaults to `OPERATIONAL_ARTIFACT_FILE_CAP`
 * @param sampleSize number of overflow paths to surface (default 20)
 */
export function applyFileCountCap<T>(
  selected: SelectedOperationalArtifact<T>[],
  cap: number = OPERATIONAL_ARTIFACT_FILE_CAP,
  sampleSize = 20,
): CapResult<T> {
  const sorted = [...selected].sort((a, b) => a.filePath.localeCompare(b.filePath));
  const effectiveCap = Number.isFinite(cap) && cap >= 0 ? cap : OPERATIONAL_ARTIFACT_FILE_CAP;
  const kept = sorted.slice(0, effectiveCap);
  const overflow = sorted.slice(effectiveCap);
  return {
    selected: kept,
    overflowCount: overflow.length,
    overflowSample: overflow.slice(0, sampleSize).map((s) => s.filePath),
    cap: effectiveCap,
  };
}
