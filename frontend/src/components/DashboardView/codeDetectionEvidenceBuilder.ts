/**
 * codeDetectionEvidenceBuilder.ts
 *
 * Spec 3 (2026-05-10): Candidate Evidence Data Contract — Task Group 1.3.
 *
 * Pure module (no React, no CSS, no API imports). Thin wrapper that
 * adapts Spec 2's `CodeDetectionDisplay` into the normalized
 * `CandidateEvidenceSection` shape introduced by Spec 3.
 *
 * Spec 2's `codeDetectionMappers.ts` is consumed VERBATIM. This wrapper
 * is a strict adapter — no mapper logic is duplicated and no fields are
 * transformed beyond the field-name remapping below.
 *
 * Mapping rules (per spec.md and shaping notes §3.3):
 *   title         → 'Code Detection' (constant)
 *   status        → 'not_available' when display.isMostlyEmpty, else 'available'
 *   reason        → display.reason
 *   fields        → display.fields (shape-compatible)
 *   detectedBy    → display.detectedBy
 *   sourceFiles   → display.sourceFiles
 *
 * Spec 7 (2026-05-11): Confidence, Tier, and Runtime Badges -- Task Group 3.2.
 *
 * The signature is extended additively to accept an optional
 * `runtimeEvidenceContext`. When supplied AND the candidate's display
 * confidence exceeds its base confidence (i.e. there is an actual log
 * delta to explain), the builder populates `confidenceImpactLabel` /
 * `confidenceImpactReason` from the strings already produced by
 * `getDisplayConfidence` (Group 2 source-of-truth for impact wording):
 *
 *   confidenceImpactLabel  ← result.baseLabel  ("Base confidence")
 *   confidenceImpactReason ← result.baseReason
 *     - "Deterministic code adapter evidence." for `*-adapter`
 *     - "Initial LLM-derived confidence."     for `llm-*`
 *
 * Implementation choice: re-derive `getDisplayConfidence` inside this
 * builder rather than threading a precomputed value from the orchestrator.
 * Rationale — Group 2 already centralises the wording; calling it here
 * keeps the builder a strict adapter and avoids passing an extra derived
 * struct through every call site. The lookup is O(1) Map access against
 * the precomputed Spec 6 context.
 *
 * When `runtimeEvidenceContext` is omitted OR `displayConfidence ===
 * baseConfidence`, the builder leaves both impact fields UNSET and the
 * existing Spec 3 renderer hides the impact block automatically.
 *
 * Deliberately NOT set:
 *   notes — no populator yet; defer to the spec that first uses notes.
 */

import type { DiscoveryCandidateDto } from '../../api/discoveryApi';
import { buildCodeDetectionDetails } from './codeDetectionMappers';
import type {
  CandidateEvidenceSection,
  RuntimeEvidenceContext,
} from './candidateEvidenceTypes';
import { getDisplayConfidence } from './displayConfidence';

/**
 * Build the Code Detection evidence section for a candidate.
 *
 * Calls Spec 2's `buildCodeDetectionDetails(candidate)` to obtain the
 * curated `CodeDetectionDisplay`, then maps each field onto the
 * `CandidateEvidenceSection` shape. The returned section preserves
 * every value from the underlying mapper output unchanged.
 *
 * The optional `runtimeEvidenceContext` is consumed only for the
 * Spec 7 impact-block population (see file header). When omitted, the
 * Code Detection section is identical to its Spec 3 shape.
 */
export function buildCodeDetectionEvidenceSection(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext?: RuntimeEvidenceContext
): CandidateEvidenceSection {
  const display = buildCodeDetectionDetails(candidate);
  const section: CandidateEvidenceSection = {
    title: 'Code Detection',
    status: display.isMostlyEmpty ? 'not_available' : 'available',
    reason: display.reason,
    fields: display.fields,
    detectedBy: display.detectedBy,
    sourceFiles: display.sourceFiles,
  };

  // Spec 7: populate impact block ONLY when there is an actual log delta
  // to explain. Without a runtime context we cannot derive the delta;
  // leave the impact fields unset so the renderer hides the block.
  if (runtimeEvidenceContext) {
    const result = getDisplayConfidence(candidate, runtimeEvidenceContext);
    const hasUplift =
      result.baseConfidence !== null &&
      result.displayConfidence !== null &&
      result.displayConfidence > result.baseConfidence;
    if (hasUplift && result.baseLabel.length > 0) {
      section.confidenceImpactLabel = result.baseLabel;
      if (result.baseReason.length > 0) {
        section.confidenceImpactReason = result.baseReason;
      }
    }
  }

  return section;
}
