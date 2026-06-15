/**
 * candidateEvidenceBuilder.ts
 *
 * Spec 3 (2026-05-10): Candidate Evidence Data Contract — Task Group 1.4.
 *
 * Pure module (no React, no CSS, no API imports). Top-level composition
 * builder that produces a `CandidateEvidenceDetails` object from a
 * `DiscoveryCandidateDto`. The returned object is the normalized
 * evidence model the Candidate Details Panel renders from.
 *
 * Composition:
 *   - codeDetection: built via `buildCodeDetectionEvidenceSection` (Spec 2
 *     mapper consumed verbatim through a thin adapter).
 *   - logScans: built via `buildLogScansEvidenceSection` (Spec 6 Task
 *     Group 3 dispatcher imported from `./logScansEvidenceBuilder`).
 *     The dispatcher routes by `candidate.candidate_type` and consumes
 *     the optional `runtimeEvidenceContext` precomputed at the
 *     `DiscoveryCandidateTable` level.
 *   - llmReview: hardcoded placeholder section. No populator planned in
 *     the current 7-spec roadmap.
 *
 * Spec 6 (2026-05-11): Log Evidence in Candidate Details UI — Task Group 4.2.
 *
 * The Spec 3 inline `buildLogScansEvidenceSection` placeholder has been
 * removed in favour of the Group 3 dispatcher. The dispatcher is
 * re-exported from this module so existing call sites that import
 * `buildLogScansEvidenceSection` from `candidateEvidenceBuilder`
 * continue to compile. The top-level `buildCandidateEvidenceDetails`
 * signature is extended additively to accept an optional
 * `runtimeEvidenceContext`; existing call sites that omit it continue
 * to compile and produce the standard "not found" Log Scans section.
 *
 * The single fallback string `"Log scan evidence was not found for this
 * run."` lives in `logScansEvidenceBuilder.ts` and is used for all
 * no-evidence cases (no logs supplied, logs supplied but no row match,
 * logs with other-row match).
 *
 * Spec 7 (2026-05-11): Confidence, Tier, and Runtime Badges -- Task Group 3.4.
 *
 * The orchestrator now threads the optional `runtimeEvidenceContext`
 * to BOTH section builders (code-detection AND log-scans). Each
 * builder re-derives `getDisplayConfidence(candidate, ctx)` internally
 * to populate its own impact block when (and only when)
 * `displayConfidence > baseConfidence`. We chose the re-derive pattern
 * over precomputing-once-and-passing-down to keep each builder's
 * signature additive (the orchestrator does not own the wording or the
 * uplift cap rule — `displayConfidence.ts` is the single source of
 * truth, and both builders consume it directly).
 */

import type { DiscoveryCandidateDto } from '../../api/discoveryApi';
import { buildCodeDetectionEvidenceSection } from './codeDetectionEvidenceBuilder';
import { buildLogScansEvidenceSection } from './logScansEvidenceBuilder';
import type {
  CandidateEvidenceDetails,
  CandidateEvidenceSection,
  RuntimeEvidenceContext,
} from './candidateEvidenceTypes';

/**
 * Re-export of the Spec 6 Group 3 Log Scans dispatcher. Kept as a named
 * re-export so existing imports of `buildLogScansEvidenceSection` from
 * this module continue to resolve unchanged.
 */
export { buildLogScansEvidenceSection };

/**
 * Hardcoded placeholder for the LLM Review section.
 *
 * Returned regardless of candidate type / data. No populator is
 * planned in the current roadmap.
 */
export function buildLlmReviewEvidenceSection(
  _candidate: DiscoveryCandidateDto
): CandidateEvidenceSection {
  return {
    title: 'LLM Review',
    status: 'not_available',
    summary: 'No candidate-specific LLM review details are available yet.',
    fields: [],
  };
}

/**
 * Build the full normalized evidence model for a candidate.
 *
 * Composes the three section builders into one object. The orchestrator
 * (`CandidateDetailsPanel`) calls this and renders three columns from
 * the result.
 *
 * The optional `runtimeEvidenceContext` is the precomputed bundle of
 * cross-candidate rollups built at the `DiscoveryCandidateTable` level
 * via `useMemo`. Threaded into BOTH the Code Detection and Log Scans
 * builders so each can populate its Spec 7 impact block when
 * `displayConfidence > baseConfidence`. LLM Review does not need it.
 * When omitted, the Log Scans dispatcher falls back to the standard
 * "not found" section for the three indirection-driven candidate types,
 * the Code Detection section emits no impact block, and `endpoints`
 * candidates' direct `logEnrichment.runtime` block is still read by
 * the per-type endpoints builder.
 */
export function buildCandidateEvidenceDetails(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext?: RuntimeEvidenceContext
): CandidateEvidenceDetails {
  return {
    candidateId: candidate.id,
    candidateType: candidate.candidate_type,
    codeDetection: buildCodeDetectionEvidenceSection(
      candidate,
      runtimeEvidenceContext
    ),
    logScans: buildLogScansEvidenceSection(candidate, runtimeEvidenceContext),
    llmReview: buildLlmReviewEvidenceSection(candidate),
  };
}
