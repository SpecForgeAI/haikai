/**
 * Runtime Evidence LLM Context Builder
 *
 * Produces the compact `runtimeEvidenceSummary` JSON block that is
 * injected into the LLM gap-fill prompt alongside `packCandidates` and
 * `ir`. The shape is pinned in `RuntimeEvidenceLlmContext` and matches
 * the spec's "LLM context shape (for gap-fill prompt)" example
 * verbatim.
 *
 * Privacy / compactness rules (per Spec 5):
 *   - NO raw log content (full lines, snippets, IPs, user agents,
 *     referrers) ever appears in the output.
 *   - Per-endpoint timestamp window (`firstSeen` / `lastSeen`),
 *     source-file lists, sample line refs, top-status-codes, and
 *     `topStatusCodes` arrays are stripped — only the run-level
 *     `logWindow` is exposed.
 *   - Aim ≤500 tokens; even on large fixtures the serialized block
 *     should remain well under an 8KB byte budget.
 *
 * Skipped variants:
 *   - When the run summary is `{ skipped: true, reason: 'no_log_artifacts' }`
 *     OR `{ skipped: true, reason: 'log_processing_failed', warnings: [] }`
 *     the builder returns a minimal "no runtime evidence" context the
 *     gap-fill stage can interpret as such (zero counts, empty arrays).
 */

import {
  MatchedRuntimeEvidence,
  NoUsageRuntimeEvidence,
  RuntimeEvidenceRunSummary,
  RuntimeEvidenceLlmContext,
  UnmatchedRouteHint,
} from './httpRuntimeObservation';

/** Happy-path variant of `RuntimeEvidenceRunSummary` (excludes the `skipped` shapes). */
type HappyRunSummary = Exclude<RuntimeEvidenceRunSummary, { skipped: true }>;

/** Type guard discriminating the happy-path summary from the skipped variants. */
function isHappySummary(s: RuntimeEvidenceRunSummary): s is HappyRunSummary {
  return !('skipped' in s) || s.skipped !== true;
}

/** Empty `runtimeEvidenceSummary` returned when the runtime stage was skipped. */
function emptyContext(): RuntimeEvidenceLlmContext {
  return {
    runtimeEvidenceSummary: {
      logFilesProcessed: 0,
      logWindow: {},
      matchedEndpoints: [],
      codeEndpointsWithNoObservedUsage: [],
      unmatchedRuntimeRouteHints: [],
    },
  };
}

/**
 * Strip a `MatchedRuntimeEvidence` row to the LLM-facing fields only.
 * The `pathTemplate` is the code candidate's original (un-normalized)
 * template, preserved so the LLM can reason about the canonical
 * endpoint identity rather than the log-derived normalization.
 */
function compactMatched(m: MatchedRuntimeEvidence): RuntimeEvidenceLlmContext['runtimeEvidenceSummary']['matchedEndpoints'][number] {
  return {
    candidateId: m.candidateId,
    method: m.method,
    pathTemplate: m.codePathTemplate,
    observedUsageCount: m.observedUsageCount,
    status2xxCount: m.status2xxCount,
    status3xxCount: m.status3xxCount,
    status4xxCount: m.status4xxCount,
    status5xxCount: m.status5xxCount,
  };
}

/**
 * Strip a `NoUsageRuntimeEvidence` row to the LLM-facing identity-only
 * fields. The LLM only needs to know which endpoints had no observed
 * usage; counts are all zero by definition and would waste tokens.
 *
 * The path template is sourced from the matched-evidence payload's
 * sibling field on the same candidate when available; for no-usage
 * rows it is not carried on the row itself, so the builder requires
 * the caller to provide a `candidateIdToPathTemplate` lookup (the
 * orchestrator owns this view of the deterministic candidate set).
 */
function compactNoUsage(
  n: NoUsageRuntimeEvidence,
  pathTemplate: string,
  method: string,
): RuntimeEvidenceLlmContext['runtimeEvidenceSummary']['codeEndpointsWithNoObservedUsage'][number] {
  return {
    candidateId: n.candidateId,
    method,
    pathTemplate,
  };
}

/** Strip an `UnmatchedRouteHint` to the LLM-facing fields only. */
function compactHint(h: UnmatchedRouteHint): RuntimeEvidenceLlmContext['runtimeEvidenceSummary']['unmatchedRuntimeRouteHints'][number] {
  return {
    method: h.method,
    pathTemplate: h.pathTemplate,
    observedUsageCount: h.observedUsageCount,
  };
}

/**
 * Optional lookup from candidateId → `{ method, pathTemplate }`. When
 * provided, no-usage rows render with their candidate's identity. When
 * absent, no-usage rows still render but with placeholder method/path
 * (`'UNKNOWN'`, `''`) — preferable to omitting them, since the LLM
 * needs the count of no-usage endpoints to weigh tier signals.
 */
export interface CandidateIdentityLookup {
  get(candidateId: string): { method: string; pathTemplate: string } | undefined;
}

/**
 * Build the compact LLM-facing runtime evidence context.
 *
 * @param matched     Per-candidate matched runtime evidence rows.
 * @param noUsage     Per-candidate "no usage observed" rows.
 * @param runSummary  The persistence-shape run-level summary
 *                    (carries `logFilesProcessed`, `logWindow`, and
 *                    `unmatchedRouteHints`).
 * @param candidateIdentities  Optional candidateId → identity lookup
 *                    used to populate `method` + `pathTemplate` on
 *                    no-usage rows.
 */
export function buildRuntimeEvidenceLlmContext(
  matched: MatchedRuntimeEvidence[],
  noUsage: NoUsageRuntimeEvidence[],
  runSummary: RuntimeEvidenceRunSummary,
  candidateIdentities?: CandidateIdentityLookup,
): RuntimeEvidenceLlmContext {
  // Variant: skipped (no log artifacts OR log processing failed).
  if (!isHappySummary(runSummary)) {
    return emptyContext();
  }

  const matchedEndpoints = matched.map(compactMatched);

  const codeEndpointsWithNoObservedUsage = noUsage.map((n) => {
    const identity = candidateIdentities?.get(n.candidateId);
    return compactNoUsage(
      n,
      identity?.pathTemplate ?? '',
      identity?.method ?? 'UNKNOWN',
    );
  });

  const unmatchedRuntimeRouteHints = runSummary.unmatchedRouteHints.map(compactHint);

  return {
    runtimeEvidenceSummary: {
      logFilesProcessed: runSummary.logFilesProcessed,
      logWindow: runSummary.logWindow,
      matchedEndpoints,
      codeEndpointsWithNoObservedUsage,
      unmatchedRuntimeRouteHints,
    },
  };
}
