/**
 * Manual-wins precedence + re-upload supersede / preserve / recompute.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3) — Task Group 4.
 *
 * Sits BETWEEN Group 2 (resolved manifests) and Group 3 (the captured-decision
 * writer). It enforces the iterate-loop precedence rules over the EXISTING
 * append-only supersession convention in `target_state_captured_decisions`
 * (POST-only — AMS sets `supersededById` on the prior row inside its
 * transaction; this module NEVER PATCHes or DELETEs):
 *
 *   1. MANUAL ANSWER ALWAYS WINS. Before a manifest-derived row is written, the
 *      latest captured decisions are consulted (`fetchLatestCapturedDecisions`).
 *      If the current WINNING row for a code was MANUALLY set, the manifest does
 *      NOT overwrite it — that code's candidate is SKIPPED and the skip is
 *      LOGGED (no silent drop). A `version-unknown` manual override is honoured
 *      exactly like any other manual answer (it is preserved).
 *
 *   2. MANIFEST SUPERSEDES OLDER MANIFEST. A manifest-derived row DOES win over
 *      an older manifest-derived row for the same code (the re-upload supersede
 *      path). This needs no special handling here: the candidate is kept and the
 *      POST drives AMS's append-only supersession of the prior manifest row.
 *
 *   3. RECOMPUTE. After a (re-)upload, the resolved target-version set is
 *      recomputed from the LATEST manifests + the SURVIVING manual edits, with
 *      `version-unknown` entries passing through unchanged. This recomputed set
 *      is the STRUCTURED target-version source handed to Spec 4 (Group 6).
 *
 * WHAT COUNTS AS "MANUAL": every captured-decision row EXCEPT the two automated
 * derivations — the manifest auto-answer (`target-manifest-auto-answer`) and the
 * LLM tech-stack pre-fill (`tech-stack-md-prefill`). So a user-walked answer
 * (`architect-persona-conversation`), an ad-hoc decision, a discussion note, and
 * any future inline manual edit are all PRESERVED; a manifest may only supersede
 * a prior manifest row or an (overridable) LLM-prefill row.
 *
 * PURE except the injected reader. No HTTP here directly; the read seam is
 * injected for the test seam (mirrors the Group 3 POST-seam injection).
 */

import { isVersionSentinel } from '../../config/architect-conversation/frameworkVersionShape';
import { logger } from '../logger';
import {
  fetchLatestCapturedDecisions as defaultFetchLatestCapturedDecisions,
  TargetStateCapturedDecision,
} from '../targetStateCapturedDecisionsClient';
import { TARGET_MANIFEST_AUTO_ANSWER_TASK_NAME } from './manifestAutoAnswerer';
import type { ManifestAnswerCandidate } from './manifestAutoAnswerer';
import { ResolvedManifest } from './manifestVersionResolution';

/** The LLM tech-stack pre-fill task name (a manifest may override this). */
export const TECH_STACK_PREFILL_TASK_NAME = 'tech-stack-md-prefill';

/**
 * The closed set of AUTOMATED `createdByTask` values that a fresh manifest
 * upload is permitted to supersede. Everything NOT in this set is treated as a
 * MANUAL answer and is preserved (manual-wins precedence). Kept as a small local
 * constant (not a cross-module import of the orchestrator graph) so this
 * precedence module stays dependency-light; the literals are the documented
 * source-of-truth task names.
 */
export const MANIFEST_SUPERSEDABLE_TASKS: ReadonlySet<string> = new Set([
  TARGET_MANIFEST_AUTO_ANSWER_TASK_NAME,
  TECH_STACK_PREFILL_TASK_NAME,
]);

/**
 * True iff the supplied winning row was MANUALLY set (i.e. it is NOT one of the
 * automated derivations a manifest may supersede). A manual row must be
 * preserved.
 */
export function isManualDecisionRow(row: TargetStateCapturedDecision): boolean {
  return !MANIFEST_SUPERSEDABLE_TASKS.has(row.createdByTask);
}

// ---------------------------------------------------------------------------
// Injectable read seam (test seam)
// ---------------------------------------------------------------------------

export interface ManifestPrecedenceDeps {
  fetchLatestCapturedDecisions: typeof defaultFetchLatestCapturedDecisions;
}

export const defaultManifestPrecedenceDeps: ManifestPrecedenceDeps = {
  fetchLatestCapturedDecisions: defaultFetchLatestCapturedDecisions,
};

// ---------------------------------------------------------------------------
// Precedence filtering
// ---------------------------------------------------------------------------

export interface PrecedenceFilterResult {
  /** Candidates that SURVIVED precedence (safe to write). */
  survivingCandidates: ManifestAnswerCandidate[];
  /**
   * Decision codes SKIPPED because the current winning row was manually set
   * (preserved). Logged; surfaced for the response so the UI can explain the
   * skip.
   */
  skippedManualCodes: string[];
  /** The latest captured decisions consulted (so the caller can recompute). */
  latestDecisions: TargetStateCapturedDecision[];
}

/**
 * Build a `decisionCode -> winning row` index from the latest (non-superseded)
 * captured decisions, restricted to architecture-scope rows (the scope manifest
 * auto-answers write at). The latest list already contains only non-superseded
 * rows; if more than one row shares a code we keep the most recent by
 * `createdAt`.
 */
export function indexWinningArchitectureDecisions(
  latest: readonly TargetStateCapturedDecision[],
): Map<string, TargetStateCapturedDecision> {
  const byCode = new Map<string, TargetStateCapturedDecision>();
  for (const row of latest) {
    if (row.scopeKind !== 'architecture') continue;
    const existing = byCode.get(row.decisionCode);
    if (!existing || row.createdAt > existing.createdAt) {
      byCode.set(row.decisionCode, row);
    }
  }
  return byCode;
}

/**
 * Apply manual-wins precedence to a candidate set: drop any candidate whose code
 * currently has a MANUALLY-set winning row (preserve the manual answer), keep
 * the rest (which either have no prior row, or whose prior row is an automated
 * derivation a manifest may supersede). Every skip is logged (no silent drop).
 *
 * The read is injected so the unit test seam needs no HTTP.
 */
export async function filterCandidatesByPrecedence(
  projectId: string,
  targetArchitectureId: string,
  candidates: readonly ManifestAnswerCandidate[],
  deps: ManifestPrecedenceDeps = defaultManifestPrecedenceDeps,
): Promise<PrecedenceFilterResult> {
  let latestDecisions: TargetStateCapturedDecision[] = [];
  try {
    latestDecisions = await deps.fetchLatestCapturedDecisions(
      projectId,
      targetArchitectureId,
    );
  } catch (err) {
    // Fail-soft: if the read fails we cannot prove a manual answer exists, so we
    // do NOT silently overwrite. Treat the read failure as "every candidate is
    // blocked" would be too aggressive (it would drop a legitimate first
    // upload); instead surface the failure and proceed WITHOUT precedence
    // filtering, logging loudly so the operator sees the degraded run.
    logger.error(
      'target-manifest precedence: could not read latest captured decisions; ' +
        'proceeding WITHOUT manual-wins filtering (manual answers may be superseded by AMS supersession key only)',
      {
        projectId,
        targetArchitectureId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return {
      survivingCandidates: [...candidates],
      skippedManualCodes: [],
      latestDecisions: [],
    };
  }

  const winningByCode = indexWinningArchitectureDecisions(latestDecisions);
  const survivingCandidates: ManifestAnswerCandidate[] = [];
  const skippedManualCodes: string[] = [];

  for (const candidate of candidates) {
    const winning = winningByCode.get(candidate.decisionCode);
    if (winning && isManualDecisionRow(winning)) {
      skippedManualCodes.push(candidate.decisionCode);
      logger.info(
        'target-manifest precedence: manual answer preserved; manifest write skipped',
        {
          projectId,
          targetArchitectureId,
          decisionCode: candidate.decisionCode,
          manualCreatedByTask: winning.createdByTask,
        },
      );
      continue;
    }
    survivingCandidates.push(candidate);
  }

  return { survivingCandidates, skippedManualCodes, latestDecisions };
}

// ---------------------------------------------------------------------------
// Recompute the resolved target-version set (Group 6 hand-off source)
// ---------------------------------------------------------------------------

/**
 * One entry in the recomputed structured target-version set. This is the shape
 * Spec 4 consumes (alongside manual `{framework, version}` answers) for
 * reduction/steering; `version-unknown` passes through so Spec 4 can render
 * "remaining — fix version unknown". Provenance distinguishes a manifest-derived
 * value from a surviving manual edit.
 */
export interface ResolvedTargetVersion {
  decisionCode: string;
  framework: string;
  /** Concrete version OR a sentinel like `version-unknown` (passthrough). */
  version: string;
  /** True iff `version` is a sentinel (e.g. `version-unknown`). */
  versionUnknown: boolean;
  /** Where this winning value came from. */
  provenance: 'manifest' | 'manual';
  /** `sourceFile` when manifest-derived (null for a manual answer). */
  sourceFile: string | null;
}

/** Parsed `{ framework, version }` out of a captured-decision `answerValue`. */
function readFrameworkVersionFromRow(
  row: TargetStateCapturedDecision,
): { framework: string; version: string; sourceFile: string | null } | null {
  try {
    const parsed = JSON.parse(row.answerValue) as {
      value?: unknown;
      sourceFile?: unknown;
    };
    const value = parsed.value;
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as { framework?: unknown }).framework === 'string' &&
      typeof (value as { version?: unknown }).version === 'string'
    ) {
      const v = value as { framework: string; version: string };
      const sourceFile =
        typeof parsed.sourceFile === 'string' ? parsed.sourceFile : null;
      return { framework: v.framework, version: v.version, sourceFile };
    }
  } catch {
    // Not a structured { framework, version } row — ignore for the version set.
  }
  return null;
}

/**
 * Recompute the resolved target-version set AFTER a (re-)upload. Combines:
 *   - the SURVIVING manual `{framework, version}` answers (manual wins), and
 *   - the freshly-resolved manifest candidates for every other dependency code.
 *
 * A surviving manual answer for a code takes precedence over the manifest's
 * value for that same code; otherwise the manifest value (concrete OR
 * `version-unknown`) is used. `version-unknown` passes through unchanged — never
 * coerced to a fabricated version.
 *
 * `latestDecisions` should be the post-write latest set (or, for a synchronous
 * recompute, the pre-write set already reflects the surviving manual rows since
 * manual rows are exactly the ones not superseded by this upload).
 */
export function recomputeResolvedTargetVersions(args: {
  resolvedManifests: readonly ResolvedManifest[];
  manifestCandidates: readonly ManifestAnswerCandidate[];
  latestDecisions: readonly TargetStateCapturedDecision[];
}): ResolvedTargetVersion[] {
  const byCode = new Map<string, ResolvedTargetVersion>();

  // 1. Seed with the manifest candidates (manifest provenance).
  for (const c of args.manifestCandidates) {
    byCode.set(c.decisionCode, {
      decisionCode: c.decisionCode,
      framework: c.framework,
      version: c.version,
      versionUnknown: isVersionSentinel(c.version),
      provenance: 'manifest',
      sourceFile: c.sourceFile,
    });
  }

  // 2. Overlay surviving MANUAL answers (manual wins over manifest).
  const winningByCode = indexWinningArchitectureDecisions(args.latestDecisions);
  for (const [code, row] of winningByCode.entries()) {
    if (!isManualDecisionRow(row)) continue; // only manual rows override
    const fv = readFrameworkVersionFromRow(row);
    if (!fv) continue; // not a structured framework/version answer
    byCode.set(code, {
      decisionCode: code,
      framework: fv.framework,
      version: fv.version,
      versionUnknown: isVersionSentinel(fv.version),
      provenance: 'manual',
      sourceFile: fv.sourceFile,
    });
  }

  return [...byCode.values()];
}
