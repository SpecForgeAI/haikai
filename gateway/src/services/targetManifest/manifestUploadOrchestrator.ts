/**
 * Manifest upload orchestrator — the full (re-)upload iterate loop.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3) — Task Group 4
 * (task 4.0 end-to-end wiring; consumes Groups 2 + 3 + the precedence layer).
 *
 * Given the parsed manifests (Group 1) this:
 *   1. RESOLVES versions (Group 2) → resolved manifests.
 *   2. DERIVES the dependency-answerable candidate set (Group 3).
 *   3. Applies MANUAL-WINS PRECEDENCE (Group 4): drops candidates whose current
 *      winning row was manually set (preserved; logged), keeps the rest.
 *   4. WRITES the surviving candidates via the EXISTING POST seam (Group 3),
 *      which drives AMS's append-only supersession of older manifest-derived
 *      rows for the same code (re-upload supersede). POST-only; no PATCH/DELETE.
 *   5. RECOMPUTES the resolved target-version set from the latest manifests +
 *      surviving manual edits (`version-unknown` passes through) — the
 *      structured target-version source Spec 4 (Group 6) consumes.
 *
 * Never throws on a write failure — the partial outcome from the auto-answerer
 * is surfaced so the route can report partial success.
 */

import { logger } from '../logger';
import {
  ManifestAutoAnswererDeps,
  ManifestAnswerCandidate,
  defaultManifestAutoAnswererDeps,
  deriveManifestAnswerCandidates,
  runManifestAutoAnswer,
  ManifestAutoAnswerOutcome,
} from './manifestAutoAnswerer';
import {
  ManifestPrecedenceDeps,
  ResolvedTargetVersion,
  defaultManifestPrecedenceDeps,
  filterCandidatesByPrecedence,
  recomputeResolvedTargetVersions,
} from './manifestPrecedence';
import { ParsedManifest } from './parsedManifestModel';
import {
  ResolvedManifest,
  resolveManifestVersions,
} from './manifestVersionResolution';

export interface ManifestUploadOrchestratorDeps
  extends ManifestAutoAnswererDeps,
    ManifestPrecedenceDeps {}

export const defaultManifestUploadOrchestratorDeps: ManifestUploadOrchestratorDeps = {
  ...defaultManifestAutoAnswererDeps,
  ...defaultManifestPrecedenceDeps,
};

export interface ProcessManifestUploadArgs {
  projectId: string;
  targetArchitectureId: string;
  conversationThreadId?: string | null;
  /** Parsed manifests from the Group 1 upload route. */
  parsedManifests: readonly ParsedManifest[];
}

export interface ProcessManifestUploadResult {
  /** Group 2 resolved manifests (resolved versions / version-unknown). */
  resolvedManifests: ResolvedManifest[];
  /** Group 3 candidate set BEFORE precedence filtering (full inspection set). */
  allCandidates: ManifestAnswerCandidate[];
  /** Candidates that survived manual-wins precedence (the ones written). */
  survivingCandidates: ManifestAnswerCandidate[];
  /** Codes skipped because a manual answer was preserved (logged). */
  skippedManualCodes: string[];
  /** The auto-answer write outcome (rows written, partial-failure, abort). */
  writeOutcome: ManifestAutoAnswerOutcome;
  /**
   * The recomputed structured target-version set (latest manifests + surviving
   * manual edits; `version-unknown` passthrough). Spec 4 hand-off source.
   */
  resolvedTargetVersions: ResolvedTargetVersion[];
}

/**
 * Run the full (re-)upload iterate loop for a set of parsed manifests. Pure with
 * respect to its injected deps (the POST + read seams). Returns a structured
 * result the route surfaces to the caller; never throws on a write failure.
 */
export async function processManifestUpload(
  args: ProcessManifestUploadArgs,
  deps: ManifestUploadOrchestratorDeps = defaultManifestUploadOrchestratorDeps,
): Promise<ProcessManifestUploadResult> {
  // 1. Resolve versions (Group 2).
  const resolvedManifests = args.parsedManifests.map((m) =>
    resolveManifestVersions(m),
  );

  // 2. Derive candidate set (Group 3).
  const allCandidates = deriveManifestAnswerCandidates(resolvedManifests);

  // 3. Manual-wins precedence (Group 4).
  const precedence = await filterCandidatesByPrecedence(
    args.projectId,
    args.targetArchitectureId,
    allCandidates,
    deps,
  );

  // 4. Write the surviving candidates (Group 3 writer, prefill-shaped
  //    robustness). The POST drives AMS append-only supersession of older
  //    manifest-derived rows (re-upload supersede); manual rows were already
  //    filtered out in step 3 (preserve).
  const writeOutcome = await runManifestAutoAnswer(
    {
      projectId: args.projectId,
      targetArchitectureId: args.targetArchitectureId,
      conversationThreadId: args.conversationThreadId ?? null,
      resolvedManifests,
      candidates: precedence.survivingCandidates,
    },
    deps,
  );

  // 5. Recompute the resolved target-version set (Group 4 / Group 6 hand-off).
  //    Uses the full candidate set (so every manifest-derived dependency code is
  //    represented) overlaid with surviving manual answers (manual wins).
  const resolvedTargetVersions = recomputeResolvedTargetVersions({
    resolvedManifests,
    manifestCandidates: allCandidates,
    latestDecisions: precedence.latestDecisions,
  });

  logger.debug('target-manifest upload processed', {
    projectId: args.projectId,
    targetArchitectureId: args.targetArchitectureId,
    parsedManifests: args.parsedManifests.length,
    candidates: allCandidates.length,
    surviving: precedence.survivingCandidates.length,
    skippedManual: precedence.skippedManualCodes.length,
    rowsWritten: writeOutcome.rowsWritten,
    aborted: writeOutcome.aborted,
    resolvedTargetVersions: resolvedTargetVersions.length,
  });

  return {
    resolvedManifests,
    allCandidates,
    survivingCandidates: precedence.survivingCandidates,
    skippedManualCodes: precedence.skippedManualCodes,
    writeOutcome,
    resolvedTargetVersions,
  };
}
