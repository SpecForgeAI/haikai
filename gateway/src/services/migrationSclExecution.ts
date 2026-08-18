/**
 * SCL execution integration (SCL pipeline spec 10 of 10, 2026-08-18 design:
 * agent-os/planning/2026-08-18-scl-pipeline-design.md, "Final rulings round 3"
 * + build-program item 10).
 *
 * Two driver-facing seams, both FAIL-SOFT for every non-SCL story (zero
 * behaviour change outside `provenance:scl_corpus` items):
 *
 * 1. DISPATCH ({@link buildSclInitialCommit}): when the driver dispatches an
 *    SCL corpus story it resolves the story's contracts
 *    (fetchLatestSclContracts filtered by `scl_contract_keys`), resolves the
 *    target basePackage from the CONFIRMED manifest artifacts (the
 *    seed-build-files source of truth; fail-soft default `com.example.app`
 *    with a loud warn), runs the deterministic suite generator, and returns
 *    the files for the IVS `initial_commit_files` payload — the suite + its
 *    `scl-suite-manifest.json` become the story branch's FIRST commit,
 *    written by the TOOL, never transcribed by the implementer. Generation
 *    failure → the driver dispatches WITHOUT initial files + a loud warn +
 *    a run decision-log warning entry (never a blocked dispatch).
 *
 * 2. BUILD-RESULTS ({@link evaluateSclSuiteIntegrity}): when a build-results
 *    callback lands for an SCL story, the gateway asks IVS for the branch's
 *    CURRENT shipped-file hashes (GET /jobs/{job_id}/file-hashes — computed
 *    via `git show <branch>:<path>`, so worktree reclamation is irrelevant)
 *    and runs the no-modification guard (checkSuiteIntegrity) against the
 *    branch's own shipped manifest, plus quarantine accounting
 *    (scl-quarantine.json → evaluateContestThresholds). Verdicts:
 *      - modified/missing shipped files → `SCL_SUITE_MODIFIED` (LOUD) — a
 *        warning/attention entry on the run's decision log;
 *      - per-spec upheld-contest rate over threshold → halt the SPEC (the
 *        run item fails with the reason);
 *      - run-level aggregate quarantine rate over threshold → halt the RUN.
 *    Any read/parse hiccup degrades to `skipped` (the callback advance is
 *    never broken by the integrity layer).
 */

import { logger } from './logger';
import {
  SclContractDto,
  fetchLatestSclContracts,
} from './sclCorpusPlanner';
import {
  SclGeneratedSuite,
  generateSclTestSuite,
} from './sclTestSuiteGenerator';
import {
  SclShippedManifest,
  checkSuiteIntegrity,
  evaluateContestThresholds,
  parseQuarantineManifest,
} from './sclTestIntegrity';
import { SCL_CORPUS_STORY_TAG } from './sclSpecCarriage';
import {
  TargetManifestArtifactWire,
  fetchLatestTargetManifestArtifacts,
} from './targetManifestArtifactsClient';
import {
  JobFileHashesResult,
  fetchJobFileHashes,
} from './migrationOrchestrationSubmit';

// ---------------------------------------------------------------------------
// Constants (pinned by tests)
// ---------------------------------------------------------------------------

/** The one first-commit message every shipped SCL suite carries. */
export const SCL_INITIAL_COMMIT_MESSAGE =
  'SCL generated behaviour suite (red) — do not modify shipped tests';

/** Repo-root path of the shipped suite manifest. */
export const SCL_SUITE_MANIFEST_PATH = 'scl-suite-manifest.json';

/** Fail-soft base package when no confirmed manifest coordinates resolve. */
export const SCL_DEFAULT_BASE_PACKAGE = 'com.example.app';

/** Decision-log entry type for per-item suite verdicts (run accounting). */
export const SCL_SUITE_VERDICT_LOG_TYPE = 'scl_suite_verdict';

/** Decision-log entry type for a dispatch-time generation failure warning. */
export const SCL_SUITE_GENERATION_FAILED_LOG_TYPE = 'scl_suite_generation_failed';

// ---------------------------------------------------------------------------
// basePackage resolution (confirmed manifest coordinates — the
// seed-build-files source of truth, re-read not re-derived)
// ---------------------------------------------------------------------------

/** Strip `<parent>...</parent>` so the PROJECT groupId is matched, not the
 * parent's; fall back to the parent block when the project inherits it. */
function extractPomCoordinate(content: string, tag: 'groupId' | 'artifactId'): string | null {
  const withoutParent = content.replace(/<parent>[\s\S]*?<\/parent>/g, '');
  const re = new RegExp(`<${tag}>\\s*([^<\\s][^<]*?)\\s*<\\/${tag}>`);
  const own = withoutParent.match(re);
  if (own) return own[1];
  const parentBlock = content.match(/<parent>([\s\S]*?)<\/parent>/);
  const inherited = parentBlock ? parentBlock[1].match(re) : null;
  return inherited ? inherited[1] : null;
}

/** A legal-Java package segment from an arbitrary coordinate token. */
function packageSegment(token: string): string | null {
  const cleaned = token.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleaned.length === 0) return null;
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/**
 * PURE basePackage derivation from the confirmed manifest artifacts: the
 * latest `maven_pom` artifact's `<groupId>` (+ `<artifactId>` as the final
 * segment, the standard Maven package convention). Null when no maven pom /
 * no groupId resolves — the caller falls back to the loud default.
 */
export function deriveBasePackageFromManifests(
  artifacts: TargetManifestArtifactWire[]
): string | null {
  const pom = artifacts.find(
    (a) => (a.kind === 'maven_pom' || a.ecosystem === 'maven') && !!a.content
  );
  if (!pom?.content) return null;
  const groupId = extractPomCoordinate(pom.content, 'groupId');
  if (!groupId) return null;
  const groupSegments = groupId
    .split('.')
    .map(packageSegment)
    .filter((s): s is string => s !== null);
  if (groupSegments.length === 0) return null;
  const artifactId = extractPomCoordinate(pom.content, 'artifactId');
  const artifactSegment = artifactId ? packageSegment(artifactId) : null;
  const segments =
    artifactSegment && artifactSegment !== groupSegments[groupSegments.length - 1]
      ? [...groupSegments, artifactSegment]
      : groupSegments;
  return segments.join('.');
}

// ---------------------------------------------------------------------------
// Dispatch-time suite build (part 1.2)
// ---------------------------------------------------------------------------

/** The SCL story facts the dispatch descriptor carries (spec 7 blob markers). */
export interface SclDispatchStory {
  title: string;
  tags: string[];
  sclContractKeys: string[] | null;
  sclLayer: string | null;
  sclControllerClass: string | null;
}

/** True when the descriptor's story is corpus-derived (spec 8 recognition). */
export function isSclDispatchStory(story: Pick<SclDispatchStory, 'tags'>): boolean {
  return (story.tags ?? []).includes(SCL_CORPUS_STORY_TAG);
}

export interface SclInitialCommit {
  files: Array<{ path: string; content: string }>;
  message: string;
  /** rowTests + goldenPaths — the denominator the quarantine thresholds use. */
  suiteTestCount: number;
  basePackage: string;
  /** Non-fatal degradations worth surfacing (e.g. the base-package fallback). */
  warnings: string[];
}

export interface BuildSclInitialCommitDeps {
  fetchSclContracts: typeof fetchLatestSclContracts;
  fetchManifestArtifacts: typeof fetchLatestTargetManifestArtifacts;
  generateSuite: typeof generateSclTestSuite;
}

const defaultBuildDeps: BuildSclInitialCommitDeps = {
  fetchSclContracts: fetchLatestSclContracts,
  fetchManifestArtifacts: fetchLatestTargetManifestArtifacts,
  generateSuite: generateSclTestSuite,
};

/**
 * Build the first-commit payload for one SCL story dispatch. THROWS on any
 * hard failure (no scan / zero resolvable contracts / generator error) — the
 * CALLER owns the fail-soft posture (dispatch WITHOUT initial files + loud
 * warn + decision-log warning). The basePackage read is fail-soft INTERNALLY
 * (default + warning): a missing manifest must not lose the whole suite.
 */
export async function buildSclInitialCommit(args: {
  projectId: string;
  currentArchitectureId: string;
  targetArchitectureId: string | null;
  story: SclDispatchStory;
  deps?: Partial<BuildSclInitialCommitDeps>;
}): Promise<SclInitialCommit> {
  const deps: BuildSclInitialCommitDeps = { ...defaultBuildDeps, ...args.deps };
  const warnings: string[] = [];

  // -- Contracts: the story's scl_contract_keys against the latest scan ------
  const keys = args.story.sclContractKeys ?? [];
  if (keys.length === 0) {
    throw new Error('story carries no scl_contract_keys');
  }
  const all = await deps.fetchSclContracts(args.projectId, args.currentArchitectureId);
  if (!all) {
    throw new Error('no SCL scan exists for the current architecture');
  }
  const byKey = new Map<string, SclContractDto>();
  for (const contract of all) {
    if (typeof contract.contract_key === 'string' && !byKey.has(contract.contract_key)) {
      byKey.set(contract.contract_key, contract);
    }
  }
  const missing = keys.filter((k) => !byKey.has(k));
  if (missing.length > 0) {
    throw new Error(
      `SCL contract(s) ${missing.map((k) => `'${k}'`).join(', ')} are not resolvable ` +
        'from the latest scan — re-run the code scan, then Resume'
    );
  }

  // -- basePackage: confirmed manifest coordinates (fail-soft default) -------
  let basePackage = SCL_DEFAULT_BASE_PACKAGE;
  try {
    if (!args.targetArchitectureId) {
      throw new Error('book carries no target_architecture_id');
    }
    const artifacts = await deps.fetchManifestArtifacts(
      args.projectId,
      args.targetArchitectureId
    );
    const derived = deriveBasePackageFromManifests(artifacts);
    if (derived) {
      basePackage = derived;
    } else {
      warnings.push(
        `no confirmed maven_pom coordinates resolve a base package — ` +
          `using the '${SCL_DEFAULT_BASE_PACKAGE}' default`
      );
    }
  } catch (error) {
    warnings.push(
      `confirmed-manifest read failed (${error instanceof Error ? error.message : 'unknown'}) — ` +
        `using the '${SCL_DEFAULT_BASE_PACKAGE}' default base package`
    );
  }
  if (basePackage === SCL_DEFAULT_BASE_PACKAGE) {
    logger.warn('[diag-gateway] migration_scl_execution base_package_default', {
      projectId: args.projectId,
      storyTitle: args.story.title,
      basePackage,
    });
  }

  // -- Deterministic generation + the shipped manifest sidecar ---------------
  const suite: SclGeneratedSuite = deps.generateSuite({
    story: {
      title: args.story.title,
      sclContractKeys: keys,
      layer: args.story.sclLayer,
      controllerClass: args.story.sclControllerClass,
      tags: args.story.tags,
    },
    // Resolution set = ALL scan contracts, so ref:S-key fixture targets and
    // callee shapes outside the story's own keys still resolve.
    contracts: all,
    basePackage,
  });
  if (suite.files.length === 0) {
    throw new Error('the suite generator produced zero files for this story');
  }
  const manifestJson =
    `${JSON.stringify({ ...suite.manifest, stats: suite.stats }, null, 2)}\n`;
  return {
    files: [
      ...suite.files.map((f) => ({ path: f.path, content: f.content })),
      { path: SCL_SUITE_MANIFEST_PATH, content: manifestJson },
    ],
    message: SCL_INITIAL_COMMIT_MESSAGE,
    suiteTestCount: suite.stats.rowTests + suite.stats.goldenPaths,
    basePackage,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Build-results-time integrity + quarantine verdict (part 1.3)
// ---------------------------------------------------------------------------

export type SclSuiteVerdict =
  /** The story is not SCL — nothing to do (zero behaviour change). */
  | { kind: 'not_scl' }
  /** SCL, but the check could not run — fail-soft, advance untouched. */
  | { kind: 'skipped'; reason: string }
  | {
      kind: 'checked';
      intact: boolean;
      modified: string[];
      missing: string[];
      suiteTestCount: number;
      quarantined: number;
      haltSpec: boolean;
      haltRun: boolean;
      specRate: number;
      runRate: number;
      /** Appended to the run's decision_log_json (run-level accounting). */
      decisionEntry: Record<string, unknown>;
    };

export interface EvaluateSclSuiteDeps {
  fetchFileHashes: typeof fetchJobFileHashes;
}

const defaultEvaluateDeps: EvaluateSclSuiteDeps = {
  fetchFileHashes: fetchJobFileHashes,
};

/** Tolerant parse of the branch's shipped manifest (files + stats). */
function parseShippedManifest(text: string): {
  shipped: SclShippedManifest;
  suiteTestCount: number;
} | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Record<string, unknown>;
  const files = Array.isArray(doc.files)
    ? (doc.files as Array<Record<string, unknown>>)
        .filter((f) => typeof f?.path === 'string' && typeof f?.sha256 === 'string')
        .map((f) => ({ path: f.path as string, sha256: f.sha256 as string }))
    : [];
  if (files.length === 0) return null;
  const stats = (doc.stats ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    shipped: { files },
    suiteTestCount: num(stats.rowTests) + num(stats.goldenPaths),
  };
}

/** Sum prior scl_suite_verdict decision-log entries (run-level accounting),
 * excluding entries for the CURRENT run item (a retry replaces its own row). */
function priorRunTotals(
  decisionLog: Array<Record<string, unknown>> | null | undefined,
  currentRunItemId: string
): { tests: number; quarantined: number } {
  let tests = 0;
  let quarantined = 0;
  for (const entry of decisionLog ?? []) {
    if (entry?.type !== SCL_SUITE_VERDICT_LOG_TYPE) continue;
    if (entry.run_item_id === currentRunItemId) continue;
    if (typeof entry.suite_tests === 'number') tests += entry.suite_tests;
    if (typeof entry.quarantined === 'number') quarantined += entry.quarantined;
  }
  return { tests, quarantined };
}

/**
 * Run the shipped-suite integrity + quarantine-threshold check for one SCL
 * run item at build-results time. NEVER throws; every degradation is a
 * `skipped` verdict with the reason (the advance must not be broken by the
 * integrity layer). The caller is responsible for:
 *   - appending `decisionEntry` to the run's decision log,
 *   - the LOUD `SCL_SUITE_MODIFIED` surfacing when `!intact`,
 *   - halting the spec/run when `haltSpec`/`haltRun`.
 */
export async function evaluateSclSuiteIntegrity(args: {
  jobId: string;
  runItemId: string;
  /** The matched book blob item's tags (SCL recognition). */
  storyTags: string[];
  /** The run's decision log — the prior verdicts feed run-level totals. */
  runDecisionLog: Array<Record<string, unknown>> | null | undefined;
  deps?: Partial<EvaluateSclSuiteDeps>;
}): Promise<SclSuiteVerdict> {
  if (!(args.storyTags ?? []).includes(SCL_CORPUS_STORY_TAG)) {
    return { kind: 'not_scl' };
  }
  const deps: EvaluateSclSuiteDeps = { ...defaultEvaluateDeps, ...args.deps };

  let hashes: JobFileHashesResult;
  try {
    hashes = await deps.fetchFileHashes(args.jobId);
  } catch (error) {
    return {
      kind: 'skipped',
      reason: `file-hashes read threw: ${error instanceof Error ? error.message : 'unknown'}`,
    };
  }
  if (!hashes.ok) {
    return { kind: 'skipped', reason: hashes.error ?? 'file-hashes read failed' };
  }
  if (!hashes.manifest) {
    return {
      kind: 'skipped',
      reason: `the branch carries no ${SCL_SUITE_MANIFEST_PATH} — nothing to verify`,
    };
  }
  const parsed = parseShippedManifest(hashes.manifest);
  if (!parsed) {
    return {
      kind: 'skipped',
      reason: `${SCL_SUITE_MANIFEST_PATH} on the branch is unparseable`,
    };
  }

  const integrity = checkSuiteIntegrity(
    parsed.shipped,
    hashes.hashes
      .filter((h): h is { path: string; sha256: string } => h.sha256 !== null)
      .map((h) => ({ path: h.path, sha256: h.sha256 }))
  );

  const quarantineEntries = parseQuarantineManifest(hashes.quarantine ?? '');
  const quarantined = quarantineEntries.length;
  const prior = priorRunTotals(args.runDecisionLog, args.runItemId);
  const thresholds = evaluateContestThresholds({
    suiteTestCount: parsed.suiteTestCount,
    quarantinedCount: quarantined,
    runTotalTests: prior.tests + parsed.suiteTestCount,
    runQuarantined: prior.quarantined + quarantined,
  });

  return {
    kind: 'checked',
    intact: integrity.intact,
    modified: integrity.modified,
    missing: integrity.missing,
    suiteTestCount: parsed.suiteTestCount,
    quarantined,
    haltSpec: thresholds.haltSpec,
    haltRun: thresholds.haltRun,
    specRate: thresholds.specRate,
    runRate: thresholds.runRate,
    decisionEntry: {
      type: SCL_SUITE_VERDICT_LOG_TYPE,
      run_item_id: args.runItemId,
      job_id: args.jobId,
      suite_tests: parsed.suiteTestCount,
      quarantined,
      modified: integrity.modified,
      missing: integrity.missing,
      spec_rate: thresholds.specRate,
      run_rate: thresholds.runRate,
      at: new Date().toISOString(),
    },
  };
}
