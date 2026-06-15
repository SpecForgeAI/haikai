/**
 * candidateEvidenceTypes.ts
 *
 * Spec 3 (2026-05-10): Candidate Evidence Data Contract — Task Group 1.2.
 *
 * Pure types module (no React, no CSS, no API imports). Defines the
 * normalized evidence contract that the Candidate Details Panel renders
 * from. The contract is shape-compatible with Spec 2's `CodeDetectionDisplay`
 * (so `codeDetectionEvidenceBuilder.ts` is a thin adapter) and is forward-
 * compatible with Spec 5/6 (log evidence) and Spec 7 (confidence/runtime
 * badges).
 *
 * Resolved decisions (shaping notes §7):
 * - All four `CandidateEvidenceStatus` values are defined now. `available`
 *   and `not_available` carry the semantic styling shipping today;
 *   `partial` and `warning` are defined for forward-compatibility only
 *   (Spec 5/6 will populate `partial`).
 * - `confidenceImpactLabel` and `confidenceImpactReason` are defined here
 *   but NOT populated in Spec 3 — Spec 7 owns the impact-wording rules
 *   and population logic.
 * - `notes` is defined here but NOT populated in Spec 3 — defer to the
 *   spec that first introduces a populator.
 *
 * Spec 6 (2026-05-11): Log Evidence in Candidate Details UI — Task Group 1.3.
 *
 * Adds (additive) the runtime-evidence type family consumed by the four
 * per-type Log Scans builders and the cross-candidate aggregator:
 *
 *   - `MatchedRuntimeEvidence` / `NoUsageRuntimeEvidence` — re-declared
 *     verbatim from Spec 5's persistence shape. The JSONB column passes
 *     camelCase through unchanged so frontend types match the wire.
 *   - `LogEnrichmentRuntimeBlock` — the union shape that lives at
 *     `DiscoveryCandidateDto.logEnrichment.runtime`.
 *   - `RuntimeEvidenceForCandidate` — wrapper carrying the candidate-
 *     type-specific evidence each per-section builder needs.
 *   - `InterfaceRuntimeRollup` / `LogicalDataEntityRuntimeRollup` /
 *     `InterfaceLogicalEntityRuntimeRollup` — the three derived rollup
 *     shapes the cross-candidate aggregator emits.
 *   - `RuntimeEvidenceContext` — the precomputed bundle threaded from
 *     `DiscoveryCandidateTable` through `<CandidateDetailsPanel>` into
 *     the per-section builders.
 *
 * All Spec 6 additions are additive; no existing export was reshaped or
 * removed.
 */

/**
 * Status taxonomy for an evidence section.
 *
 * - `available`: section has populated evidence (curated fields, source
 *   files, reason). Today this is the codeDetection section when the
 *   Spec 2 mapper finds curated content.
 * - `not_available`: section has no evidence to display. Today this is
 *   the logScans / llmReview placeholders, plus the codeDetection
 *   section when the Spec 2 mapper flags `isMostlyEmpty`.
 * - `partial`: section has some but not all expected evidence. Reserved
 *   for Spec 5/6 (log evidence partial matches).
 * - `warning`: section has evidence with conflicting or suspicious
 *   signals. Reserved for future specs.
 */
export type CandidateEvidenceStatus = 'available' | 'not_available' | 'partial' | 'warning';

/**
 * One curated evidence row, identical in shape to Spec 2's
 * `CodeDetectionField` so the codeDetection wrapper builder can pass
 * the array through unchanged.
 *
 * `value` may be a single string (rendered on the same line as the
 * label) or a `string[]` (rendered as a vertical list under the label).
 */
export type CandidateEvidenceField = {
  label: string;
  value: string | string[];
};

/**
 * Optional supplementary note attached to a section. The renderer
 * displays each note as a small line keyed by index. Spec 3 defines
 * the type but no builder populates `notes` yet.
 */
export type CandidateEvidenceNote = {
  level: 'info' | 'warning' | 'success';
  text: string;
};

/**
 * One evidence section (column body) in the Candidate Details Panel.
 *
 * The codeDetection section sets `reason`, `fields`, `detectedBy`, and
 * `sourceFiles`. The logScans / llmReview placeholder sections set
 * `summary` only and leave the rest empty / undefined.
 *
 * `sourceFiles` and `detectedBy` are optional (added beyond the brief)
 * so the placeholder sections can omit them. See shaping notes §3.3.
 */
export type CandidateEvidenceSection = {
  title: string;
  status: CandidateEvidenceStatus;
  summary?: string;
  reason?: string;
  fields: CandidateEvidenceField[];
  sourceFiles?: string[];
  detectedBy?: string;
  notes?: CandidateEvidenceNote[];
  confidenceImpactLabel?: string;
  confidenceImpactReason?: string;
};

/**
 * Top-level evidence contract for a single candidate. Composed of the
 * three section objects plus the candidate's id and type for display
 * / debugging convenience.
 */
export type CandidateEvidenceDetails = {
  candidateId: string;
  candidateType: string;
  codeDetection: CandidateEvidenceSection;
  logScans: CandidateEvidenceSection;
  llmReview: CandidateEvidenceSection;
};

// ============================================================================
// Spec 6 — Runtime evidence type family
// ============================================================================

/**
 * Spec 5's matched-evidence shape, re-declared verbatim on the frontend.
 *
 * Persisted under `DiscoveryCandidate.logEnrichment.runtime.matched` for
 * `endpoints` candidates whose normalized URI matched at least one entry
 * in the supplied web-access logs. The JSONB column passes camelCase
 * through unchanged so this interface maps the wire shape one-to-one.
 *
 * Status counts (`status2xxCount`/`status3xxCount`/`status4xxCount`/
 * `status5xxCount`) and `observedUsageCount` are always present (zero is
 * a valid value); first/last seen and source-log breakdowns are optional
 * because Spec 5 emits them only when present in the underlying log
 * window.
 */
export type MatchedRuntimeEvidence = {
  method: string;
  codePathTemplate: string;
  normalizedLogPath: string;
  observedUsageCount: number;
  totalLogRequests: number;
  status2xxCount: number;
  status3xxCount: number;
  status4xxCount: number;
  status5xxCount: number;
  topStatusCodes?: Array<{ status: number; count: number }>;
  firstSeen?: string;
  lastSeen?: string;
  sourceLogFileCount?: number;
  sourceLogFiles?: string[];
  sampleLineRefs?: Array<{ file: string; line: number }>;
  matchConfidence: number;
  matchReason: string;
};

/**
 * Spec 5's "log window processed but this endpoint never appeared"
 * shape. Persisted under `DiscoveryCandidate.logEnrichment.runtime` for
 * `endpoints` candidates whose normalized URI did NOT match any entry
 * in the supplied logs. Zero observation IS evidence — the per-section
 * builder maps this to `status: 'available'` with a "no matching
 * observations" summary, NOT to `status: 'not_available'`.
 */
export type NoUsageRuntimeEvidence = {
  noUsageObserved: true;
  observedUsageCount: 0;
  status2xxCount: 0;
  status3xxCount: 0;
  status4xxCount: 0;
  status5xxCount: 0;
  note: string;
};

/**
 * Union shape that lives at `DiscoveryCandidateDto.logEnrichment.runtime`
 * for `endpoints` candidates. The wider envelope on the DTO is
 * `Record<string, unknown>` (see `discoveryApi.ts`); per-section
 * builders narrow to this union at the call site.
 */
export type LogEnrichmentRuntimeBlock =
  | { matched: MatchedRuntimeEvidence }
  | NoUsageRuntimeEvidence;

/**
 * Per-candidate slice the per-section builder reads. Today this carries
 * the strict `LogEnrichmentRuntimeBlock` for `endpoints` candidates.
 * Future candidate types may add their own slice variants here without
 * changing the surrounding `RuntimeEvidenceContext` shape.
 */
export type RuntimeEvidenceForCandidate = {
  runtime: LogEnrichmentRuntimeBlock;
};

/**
 * Cross-candidate rollup for an `interfaces` candidate.
 *
 * Built by walking the candidate list once and aggregating runtime
 * evidence from all `endpoints` candidates whose
 * `data.controllerClassName` matches the interface's `data.className`.
 *
 * - `totalObservedCalls`: sum of `observedUsageCount` across matched
 *   evidence on related endpoints.
 * - `observedEndpointCount`: count of related endpoints with matched
 *   evidence and `observedUsageCount > 0`.
 * - `totalEndpointCount`: count of related endpoints regardless of
 *   evidence (drives the "M of N related endpoints" line and the
 *   `partial` vs `available` status decision).
 * - `topEndpoints`: single endpoint with the highest
 *   `observedUsageCount` (top 1; the array shape is forward-compatible
 *   with future top-N expansion).
 * - `statusBreakdown`: aggregate 2xx/3xx/4xx/5xx counts across related
 *   endpoints.
 * - `firstSeen` / `lastSeen`: min/max across related endpoints' matched
 *   evidence (optional — absent when no related endpoint has either).
 */
export type InterfaceRuntimeRollup = {
  totalObservedCalls: number;
  observedEndpointCount: number;
  totalEndpointCount: number;
  topEndpoints: Array<{
    method: string;
    pathTemplate: string;
    observedUsageCount: number;
  }>;
  statusBreakdown: {
    status2xxCount: number;
    status3xxCount: number;
    status4xxCount: number;
    status5xxCount: number;
  };
  firstSeen?: string;
  lastSeen?: string;
};

/**
 * Cross-candidate rollup for a `logical_data_entities` candidate.
 *
 * Built by walking the `interface_logical_entities` candidates whose
 * `data.logicalEntityName` matches the entity's `data.className`, then
 * deriving related endpoints via `interfaceClassName ↔ controllerClassName`.
 *
 * `readLikeCount` aggregates `observedUsageCount` for endpoints with HTTP
 * method ∈ {GET, HEAD, OPTIONS}; `writeLikeCount` aggregates for methods
 * ∈ {POST, PUT, PATCH, DELETE}. The split is computed in the aggregator
 * — the per-section builder hides a row whose count is zero.
 */
export type LogicalDataEntityRuntimeRollup = {
  totalObservedCalls: number;
  relatedEndpointCount: number;
  readLikeCount: number;
  writeLikeCount: number;
  firstSeen?: string;
  lastSeen?: string;
};

/**
 * Cross-candidate rollup for an `interface_logical_entities` candidate.
 *
 * Built by deriving related endpoints via the same
 * `interfaceClassName ↔ controllerClassName` chain, then classifying the
 * candidate's `logicalEntityName` against each related endpoint's
 * `data.requestBodyType` (→ `requestBodyUsageCount`) and
 * `data.responseType ?? data.unwrappedReturnType ?? data.returnType` (→
 * `responseBodyUsageCount`). Same endpoint may contribute to BOTH
 * buckets when it uses the entity in both positions. When matched
 * evidence is present but neither field matches the entity name, the
 * `observedUsageCount` rolls up into `unknownRoleUsageCount` instead.
 *
 * `supportingEndpointCount` is the count of related endpoints with
 * matched evidence (regardless of role classification).
 * `totalObservedContractUsage` is the sum across all three role
 * buckets.
 */
export type InterfaceLogicalEntityRuntimeRollup = {
  supportingEndpointCount: number;
  requestBodyUsageCount: number;
  responseBodyUsageCount: number;
  unknownRoleUsageCount: number;
  totalObservedContractUsage: number;
  statusBreakdown?: {
    status2xxCount: number;
    status3xxCount: number;
    status4xxCount: number;
    status5xxCount: number;
  };
  firstSeen?: string;
  lastSeen?: string;
};

/**
 * Precomputed bundle of all four cross-candidate maps. Built once at
 * `DiscoveryCandidateTable` level via `useMemo` and threaded through
 * `<CandidateDetailsPanel>` into the per-section builders. Per-row
 * render reads from this context — never aggregates per row.
 *
 * `byCandidateId` carries the per-`endpoints`-candidate slice (matched
 * vs no-usage). The three `*RollupByCandidateId` maps carry the
 * derived rollups for the three indirection-driven candidate types.
 *
 * Builders accept the entire context as an optional parameter and read
 * only the slice they need; missing entries map to `status:
 * 'not_available'` with the standard placeholder summary.
 */
export type RuntimeEvidenceContext = {
  byCandidateId: Map<string, RuntimeEvidenceForCandidate>;
  interfaceRollupByCandidateId: Map<string, InterfaceRuntimeRollup>;
  logicalDataEntityRollupByCandidateId: Map<string, LogicalDataEntityRuntimeRollup>;
  interfaceLogicalEntityRollupByCandidateId: Map<string, InterfaceLogicalEntityRuntimeRollup>;
};
