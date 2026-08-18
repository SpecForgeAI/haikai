/**
 * SCL shipped-suite integrity + contested-test quarantine helpers (SCL
 * pipeline spec 9 of 10, 2026-08-18 design: "Final rulings round 3").
 *
 * PURE helpers the execution driver (spec 10) uses to enforce the TDD ruling:
 *
 *   - red/green/NO-MODIFICATION guard: the generated suite ships with a
 *     sha256 manifest ({@link buildShippedManifest}); at verification time
 *     {@link checkSuiteIntegrity} compares the shipped manifest against the
 *     branch's current test files — any modified or missing shipped test
 *     fails the no-modification guard (implementers may NEVER edit a shipped
 *     test; the contested-test protocol is the only exit).
 *
 *   - quarantine manifest: UPHELD contests quarantine the test
 *     (skipped-with-reason in `scl-quarantine.json`, never edited/deleted —
 *     "green 34/36 · quarantined 2"). {@link renderQuarantineManifest} emits
 *     stable JSON; {@link parseQuarantineManifest} reads it tolerantly.
 *
 *   - threshold circuit breakers ({@link evaluateContestThresholds}): the
 *     ONLY halts in the protocol. Per-spec upheld-contest rate > the spec
 *     threshold (default 0.2) → halt that spec (systematic extraction
 *     misread); run-level aggregate quarantine rate > the run threshold
 *     (default 0.05) → halt the run. Thresholds are CONFIG values
 *     (SCL_CONTEST_SPEC_THRESHOLD / SCL_CONTEST_RUN_THRESHOLD).
 */

import { createHash } from 'node:crypto';
import { getConfig } from '../config';

// ---------------------------------------------------------------------------
// Shipped-manifest integrity (the no-modification guard)
// ---------------------------------------------------------------------------

export interface SclShippedManifest {
  files: Array<{ path: string; sha256: string }>;
}

function sha256hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Manifest for a set of shipped files — same shape as the generator manifest's
 * `files` block (path + sha256 of the exact content), deterministically sorted
 * by path.
 */
export function buildShippedManifest(
  files: Array<{ path: string; content: string }>
): SclShippedManifest {
  return {
    files: [...files]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((f) => ({ path: f.path, sha256: sha256hex(f.content) })),
  };
}

export interface SclSuiteIntegrityResult {
  /** Shipped paths present on the branch with a DIFFERENT sha256. */
  modified: string[];
  /** Shipped paths absent from the branch entirely. */
  missing: string[];
  /** true ⇔ every shipped file is present and byte-identical. */
  intact: boolean;
}

/**
 * The no-modification guard: compare the SHIPPED manifest (first commit)
 * against the branch's CURRENT test-file hashes. Extra (new) test files on the
 * branch are legal — implementers may ADD tests, never touch shipped ones.
 */
export function checkSuiteIntegrity(
  shipped: SclShippedManifest,
  current: Array<{ path: string; sha256: string }>
): SclSuiteIntegrityResult {
  const currentByPath = new Map(current.map((f) => [f.path, f.sha256]));
  const modified: string[] = [];
  const missing: string[] = [];
  for (const file of shipped.files) {
    const sha = currentByPath.get(file.path);
    if (sha === undefined) missing.push(file.path);
    else if (sha !== file.sha256) modified.push(file.path);
  }
  modified.sort();
  missing.sort();
  return { modified, missing, intact: modified.length === 0 && missing.length === 0 };
}

// ---------------------------------------------------------------------------
// Quarantine manifest (scl-quarantine.json)
// ---------------------------------------------------------------------------

/** One UPHELD contest: the test is skipped-with-reason, never edited/deleted. */
export interface SclQuarantineEntry {
  test_path: string;
  test_method: string;
  contract_key: string;
  row_index: number;
  contest_evidence: string;
  verdict: 'upheld';
  arbitrated_at: string;
}

/**
 * Stable JSON for the branch's `scl-quarantine.json`: entries sorted by
 * (test_path, test_method, row_index), fixed key order, 2-space indent,
 * trailing newline — byte-deterministic for a given entry set.
 */
export function renderQuarantineManifest(entries: SclQuarantineEntry[]): string {
  const sorted = [...entries].sort(
    (a, b) =>
      a.test_path.localeCompare(b.test_path) ||
      a.test_method.localeCompare(b.test_method) ||
      a.row_index - b.row_index
  );
  const doc = {
    version: 1,
    entries: sorted.map((e) => ({
      test_path: e.test_path,
      test_method: e.test_method,
      contract_key: e.contract_key,
      row_index: e.row_index,
      contest_evidence: e.contest_evidence,
      verdict: e.verdict,
      arbitrated_at: e.arbitrated_at,
    })),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Tolerant read of a quarantine manifest: accepts the rendered document shape
 * OR a bare entry array; skips malformed entries; unparseable text ⇒ [] (a
 * missing/corrupt manifest never crashes verification — the driver treats it
 * as "no quarantines" and the integrity guard still holds).
 */
export function parseQuarantineManifest(text: string): SclQuarantineEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).entries)
      ? ((raw as Record<string, unknown>).entries as unknown[])
      : [];
  const entries: SclQuarantineEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (
      typeof e.test_path !== 'string' ||
      typeof e.test_method !== 'string' ||
      typeof e.contract_key !== 'string' ||
      typeof e.row_index !== 'number'
    ) {
      continue;
    }
    entries.push({
      test_path: e.test_path,
      test_method: e.test_method,
      contract_key: e.contract_key,
      row_index: e.row_index,
      contest_evidence: typeof e.contest_evidence === 'string' ? e.contest_evidence : '',
      verdict: 'upheld',
      arbitrated_at: typeof e.arbitrated_at === 'string' ? e.arbitrated_at : '',
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Threshold circuit breakers (the ONLY halts in the contested-test protocol)
// ---------------------------------------------------------------------------

export interface SclContestThresholdResult {
  /** Per-spec upheld-contest rate EXCEEDS the spec threshold. */
  haltSpec: boolean;
  /** Run-level aggregate quarantine rate EXCEEDS the run threshold. */
  haltRun: boolean;
  specRate: number;
  runRate: number;
}

const DEFAULT_SPEC_THRESHOLD = 0.2;
const DEFAULT_RUN_THRESHOLD = 0.05;

function configuredThresholds(): { specThreshold: number; runThreshold: number } {
  try {
    const config = getConfig();
    return {
      specThreshold: config.sclContestSpecThreshold,
      runThreshold: config.sclContestRunThreshold,
    };
  } catch {
    // Config unavailable in some unit-test contexts — design defaults.
    return { specThreshold: DEFAULT_SPEC_THRESHOLD, runThreshold: DEFAULT_RUN_THRESHOLD };
  }
}

/**
 * Rates are strict-exceed (`>` — a rate exactly AT the threshold does not
 * halt, per the design's "~20% / ~5%" posture). Zero-sized denominators yield
 * rate 0 (an empty suite/run can never halt on contests).
 */
export function evaluateContestThresholds(
  args: {
    suiteTestCount: number;
    quarantinedCount: number;
    runTotalTests: number;
    runQuarantined: number;
  },
  cfg?: { specThreshold: number; runThreshold: number }
): SclContestThresholdResult {
  const { specThreshold, runThreshold } = cfg ?? configuredThresholds();
  const specRate = args.suiteTestCount > 0 ? args.quarantinedCount / args.suiteTestCount : 0;
  const runRate = args.runTotalTests > 0 ? args.runQuarantined / args.runTotalTests : 0;
  return {
    haltSpec: specRate > specThreshold,
    haltRun: runRate > runThreshold,
    specRate,
    runRate,
  };
}
