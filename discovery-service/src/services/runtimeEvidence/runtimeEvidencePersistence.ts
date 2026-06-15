/**
 * Runtime Evidence Persistence
 *
 * Owns TWO distinct responsibilities for the runtime-evidence sub-stage:
 *
 *   1. `applyRuntimeEvidenceToCandidates(candidates, matched, noUsage)` —
 *      mutate the in-memory deterministic candidate objects in place,
 *      adding a `runtime` sub-key on each candidate's `logEnrichment`
 *      blob. This runs INSIDE the V3 pipeline before the candidates
 *      are persisted; the bulk-save path in `RunManager.bulkSaveCandidates`
 *      then serialises the mutated `logEnrichment` (including the new
 *      `runtime` sub-key) end-to-end through `mapCandidateToBackend` ->
 *      AMS `DiscoveryCandidateDto.logEnrichment` -> the JSONB column on
 *      `DiscoveryCandidateEntity`. No per-candidate PUT is required.
 *
 *   2. `persistRuntimeEvidence({ projectId, runId, runSummary, ... })` —
 *      write the run-level `steps_payload.v3.runtimeEvidence` block via
 *      `archModelClient.updateDiscoveryRun`. The run row already exists
 *      in AMS at this point (the run record is created up-front), so
 *      this PUT is safe to issue from inside the pipeline.
 *
 * Bug history (hotfix 2026-05-12-A):
 *   The previous implementation also PUT each candidate via
 *   `archModelClient.updateCandidate(projectId, runId, candidateId, ...)`.
 *   That ran INSIDE the V3 pipeline (Stage 2.5), BEFORE `RunManager`
 *   bulk-saved Stage 2's candidates to AMS — every per-candidate write
 *   returned 400 "Candidate not found". The fix moves the per-candidate
 *   write OUT of this module and into an in-memory mutation that piggy-
 *   backs on the bulk-save serialisation path.
 *
 * Read-modify-write semantics:
 *   - Per-candidate `logEnrichment.runtime` writes (now done by
 *     `applyRuntimeEvidenceToCandidates`) are ADDITIVE. The pre-existing
 *     `{ enriched, logAtomCount, signalSummary }` keys (from Increment 14)
 *     MUST be preserved alongside the new `runtime` sub-key.
 *   - Run-level writes are NAMESPACED-MERGED into `steps_payload.v3`. The
 *     pre-existing sibling keys (e.g. `gapFill`) MUST be preserved
 *     alongside the new `runtimeEvidence` key.
 *
 * Failure isolation:
 *   - The run-level write is wrapped in try/catch and emits a warning;
 *     the discovery run never fails because the run-level summary
 *     transiently errored.
 */

import {
  MatchedRuntimeEvidence,
  NoUsageRuntimeEvidence,
  RuntimeEvidenceRunSummary,
  LogEnrichmentRuntimeBlock,
} from './httpRuntimeObservation';
import { archModelClient as defaultArchModelClient } from '../archModelClient';
import { DiscoveryCandidate } from '../../types/candidate';

/**
 * Loose type for the existing per-candidate `logEnrichment` blob plus the
 * additive `runtime` sub-key. The base `LogEnrichmentMetadata` interface in
 * `types/candidate.ts` does not enumerate `runtime` because Spec 5 keeps
 * the canonical shape unchanged; the JSONB column accepts the extra key.
 */
type LogEnrichmentWithRuntime = Record<string, unknown> & {
  runtime?: LogEnrichmentRuntimeBlock;
};

/**
 * Minimal client surface this module relies on. Defined as a structural
 * subset of the `archModelClient` singleton so unit tests can pass a small
 * stub object instead of replicating the full 22-method interface.
 *
 * Note: `updateCandidate` and `getCandidatesByRun` are NO LONGER used by
 * this module (the bulk-save path persists candidates). The structural
 * type only pins the two methods we still call.
 */
type RuntimeEvidenceClient = Pick<
  typeof defaultArchModelClient,
  'updateDiscoveryRun' | 'getDiscoveryRun'
>;

interface PersistRuntimeEvidenceArgs {
  projectId: string;
  runId: string;
  runSummary: RuntimeEvidenceRunSummary;
  /**
   * Optional override for unit tests. Defaults to the singleton
   * `archModelClient` exported from `archModelClient.ts`.
   */
  archModelClient?: RuntimeEvidenceClient;
}

/**
 * Mutate the in-memory deterministic candidate list, attaching the
 * matched / no-usage runtime evidence as a `runtime` sub-key on each
 * candidate's `logEnrichment` blob.
 *
 * Pre-existing keys on `logEnrichment` (notably `enriched`,
 * `logAtomCount`, `signalSummary` from Increment 14) are preserved.
 * Candidates that appear in neither the matched nor the no-usage list
 * are left untouched.
 *
 * The mutation is in place — callers continue to operate on the same
 * candidate object references. The downstream bulk-save serialisation
 * (`mapCandidateToBackend` in `archModelClient.ts`) then carries the
 * mutated `logEnrichment` through to AMS without any per-candidate PUT.
 */
export function applyRuntimeEvidenceToCandidates(
  candidates: DiscoveryCandidate[],
  matched: MatchedRuntimeEvidence[],
  noUsage: NoUsageRuntimeEvidence[],
): void {
  const byId = new Map<string, DiscoveryCandidate>();
  for (const c of candidates) {
    byId.set(c.id, c);
  }

  const applyBlock = (candidateId: string, runtimeBlock: LogEnrichmentRuntimeBlock): void => {
    const target = byId.get(candidateId);
    if (!target) return;
    const existing =
      ((target.logEnrichment as unknown) as LogEnrichmentWithRuntime | undefined) ?? {};
    const merged: LogEnrichmentWithRuntime = {
      ...existing,
      runtime: runtimeBlock,
    };
    // Cast through unknown: `LogEnrichmentMetadata` does not enumerate
    // `runtime`, but the JSONB column accepts the extended shape and
    // the bulk-save mapper preserves whatever keys are present.
    target.logEnrichment = merged as unknown as DiscoveryCandidate['logEnrichment'];
  };

  for (const m of matched) {
    applyBlock(m.candidateId, { matched: m });
  }
  for (const n of noUsage) {
    // The persisted shape mirrors the previous per-candidate PUT body:
    // a `{ noUsageObserved: true, ...evidence }` spread. The spread
    // already includes `noUsageObserved: true` from `NoUsageRuntimeEvidence`,
    // but we keep the explicit form for clarity / future-proofing.
    applyBlock(n.candidateId, { ...n });
  }
}

/**
 * Read-modify-write the run-level `steps_payload.v3.runtimeEvidence` key,
 * preserving any sibling keys under `steps_payload.v3` (e.g. `gapFill`).
 */
async function persistRunSummary(
  client: RuntimeEvidenceClient,
  projectId: string,
  runId: string,
  runSummary: RuntimeEvidenceRunSummary,
): Promise<void> {
  const run = await client.getDiscoveryRun(projectId, runId);
  const stepsPayload =
    (run?.steps_payload as Record<string, unknown> | undefined) ?? {};
  const v3 = (stepsPayload.v3 as Record<string, unknown> | undefined) ?? {};

  const mergedV3 = {
    ...v3,
    runtimeEvidence: runSummary,
  };
  const mergedStepsPayload = {
    ...stepsPayload,
    v3: mergedV3,
  };

  await client.updateDiscoveryRun(projectId, runId, {
    steps_payload: mergedStepsPayload,
  });
}

/**
 * Persist the run-level runtime evidence summary.
 *
 * Per the hotfix 2026-05-12-A refactor this function NO LONGER writes
 * per-candidate `logEnrichment.runtime`. Those writes were the source
 * of the "Candidate not found" 400 errors observed in production: the
 * V3 pipeline runs this stage BEFORE Stage 2's candidates are bulk-saved
 * to AMS, so the per-candidate PUT had no row to update. In-memory
 * mutation via `applyRuntimeEvidenceToCandidates` happens upstream of
 * this call; the run row itself does already exist by this point, so
 * the run-level PUT is safe.
 *
 * Returns void. The orchestrator owns observability; this module's job
 * is exclusively the persistence side-effect.
 */
export async function persistRuntimeEvidence(
  args: PersistRuntimeEvidenceArgs,
): Promise<void> {
  const {
    projectId,
    runId,
    runSummary,
    archModelClient = defaultArchModelClient,
  } = args;

  // Run-level summary write — single read-modify-write to preserve siblings.
  try {
    await persistRunSummary(archModelClient, projectId, runId, runSummary);
  } catch (err) {
    console.warn(
      `[runtimeEvidencePersistence] Failed to persist run-level runtime evidence summary for run ${runId}: ${(err as Error).message}`,
    );
  }
}
