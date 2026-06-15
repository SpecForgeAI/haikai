/**
 * logScansEvidenceBuilder.ts
 *
 * Spec 6 (2026-05-11): Log Evidence in Candidate Details UI — Task Group 3.
 *
 * Pure module (no React, no CSS, no API imports). Replaces the Spec 3
 * placeholder `buildLogScansEvidenceSection` in `candidateEvidenceBuilder.ts`
 * (Group 4 will swap call sites). Dispatches by `candidate.candidate_type`
 * to one of four per-type builders, each returning a normalized
 * `CandidateEvidenceSection`:
 *
 *   - `endpoints` → `buildEndpointLogEvidenceSection`
 *       Reads `candidate.log_enrichment.runtime` directly. Matched
 *       evidence yields the observed-calls summary plus Status codes /
 *       First seen / Last seen fields. `noUsageObserved` yields the
 *       "no matching log observations" available-status summary.
 *   - `interfaces` → `buildInterfaceLogEvidenceSection`
 *       Reads the precomputed `interfaceRollupByCandidateId` rollup.
 *       Status is `available` when all related endpoints observed,
 *       `partial` when only some, `not_available` when no rollup entry
 *       (or no observed endpoints at all).
 *   - `logical_data_entities` → `buildLogicalDataEntityLogEvidenceSection`
 *       Reads the precomputed `logicalDataEntityRollupByCandidateId`
 *       rollup. Read-like and write-like rows are hidden when zero.
 *   - `interface_logical_entities` →
 *       `buildInterfaceLogicalEntityLogEvidenceSection`
 *       Reads the precomputed `interfaceLogicalEntityRollupByCandidateId`
 *       rollup. Request / Response / Unknown role rows are hidden when
 *       zero; the Total observed contract usage row is always shown when
 *       at least one supporting endpoint exists.
 *
 * Renderer contract preserved verbatim — `CandidateEvidenceSectionCard.tsx`
 * is unchanged. Per-field testids `log-scans-field-{slug}` are emitted by
 * the renderer's existing `slugifyLabel` helper. Examples:
 *   `Status codes`            → `log-scans-field-status-codes`
 *   `Top endpoint`            → `log-scans-field-top-endpoint`
 *   `Read-like traffic`       → `log-scans-field-read-like-traffic`
 *   `First seen` / `Last seen` → `log-scans-field-first-seen` / `-last-seen`
 *
 * Number / date formatting:
 *   - Numbers: `Intl.NumberFormat(undefined).format(n)` for thousand
 *     separators (matches the brief's `"1,842"` / `"12,430"` examples).
 *   - Dates: `YYYY-MM-DD` via `iso.slice(0, 10)` — locale-independent so
 *     tests assert exact strings. The existing `formatDate` utility at
 *     `DiscoveryRunDetailView.tsx:140-146` uses `toLocaleString()` which
 *     is wall-clock locale-dependent and not date-only; not suitable for
 *     the brief's exact-format requirement.
 *
 * Spec 7 (2026-05-11): Confidence, Tier, and Runtime Badges -- Task Group 3.3.
 *
 * The top-level dispatcher `buildLogScansEvidenceSection` is extended
 * additively: when the candidate's display confidence exceeds its base
 * confidence (i.e. there is an actual log delta to explain), the
 * dispatcher decorates the per-type-builder's section with
 * `confidenceImpactLabel` / `confidenceImpactReason` from the strings
 * already produced by `getDisplayConfidence` (Group 2 source-of-truth
 * for impact wording):
 *
 *   confidenceImpactLabel  ← result.upliftLabel ("Confidence increased")
 *   confidenceImpactReason ← result.upliftReason
 *     - endpoints: "Runtime logs observed N successful/redirect calls
 *       matching this candidate." (N = thousand-separated
 *       observedUsageCount).
 *     - interfaces / logical_data_entities / interface_logical_entities:
 *       "Related endpoint runtime usage observed."
 *
 * Implementation choice: re-derive `getDisplayConfidence` inside the
 * dispatcher rather than threading a precomputed value from the
 * orchestrator. Rationale — Group 2 already centralises the wording;
 * calling it here keeps each per-type builder a strict
 * Spec-6-shaped function and avoids passing an extra derived struct
 * through every signature. The lookup is O(1) Map access against the
 * precomputed Spec 6 context.
 *
 * The per-type builders themselves are unchanged. The "Log scan evidence
 * was not found for this run." fallback string and existing field/summary
 * shapes are preserved exactly. The impact decoration is applied at the
 * dispatcher boundary so it does not interact with the per-type builder
 * output beyond writing the two new optional fields.
 */

import type { DiscoveryCandidateDto } from '../../api/discoveryApi';
import type {
  CandidateEvidenceField,
  CandidateEvidenceSection,
  CandidateEvidenceStatus,
  InterfaceLogicalEntityRuntimeRollup,
  InterfaceRuntimeRollup,
  LogEnrichmentRuntimeBlock,
  LogicalDataEntityRuntimeRollup,
  MatchedRuntimeEvidence,
  RuntimeEvidenceContext,
} from './candidateEvidenceTypes';
import { getDisplayConfidence } from './displayConfidence';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TITLE = 'Log Scans';

/** Single fallback summary for ALL no-evidence cases (Spec 6 §3 / shaping §4). */
const NOT_FOUND_SUMMARY = 'Log scan evidence was not found for this run.';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const NUMBER_FORMAT = new Intl.NumberFormat(undefined);

function formatNumber(n: number): string {
  return NUMBER_FORMAT.format(n);
}

/**
 * Format an ISO-8601 timestamp as `YYYY-MM-DD`. Slice-based: locale-
 * independent and deterministic, which matches the brief's exact-string
 * requirement and keeps the test assertions stable across environments.
 *
 * Returns the input unchanged when it is not a recognisable ISO date
 * prefix (defensive — Spec 5 always emits ISO-8601, but the JSONB
 * envelope is `Record<string, unknown>` so we cannot guarantee shape).
 */
function formatDateOnly(iso: string | undefined): string | undefined {
  if (!iso || iso.length < 10) return undefined;
  // Validate the YYYY-MM-DD prefix shape; fall back to the raw input on
  // mismatch (the renderer will still display it as text).
  const slice = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(slice) ? slice : iso;
}

/**
 * Compose a compact status-code line, dropping classes whose count is
 * zero (per the spec's "only include status classes that are available"
 * rule). When ALL classes are zero, returns `undefined` so the field is
 * suppressed entirely.
 */
function formatStatusCodes(breakdown: {
  status2xxCount: number;
  status3xxCount: number;
  status4xxCount: number;
  status5xxCount: number;
}): string | undefined {
  const parts: string[] = [];
  if (breakdown.status2xxCount > 0) {
    parts.push(`2xx: ${formatNumber(breakdown.status2xxCount)}`);
  }
  if (breakdown.status3xxCount > 0) {
    parts.push(`3xx: ${formatNumber(breakdown.status3xxCount)}`);
  }
  if (breakdown.status4xxCount > 0) {
    parts.push(`4xx: ${formatNumber(breakdown.status4xxCount)}`);
  }
  if (breakdown.status5xxCount > 0) {
    parts.push(`5xx: ${formatNumber(breakdown.status5xxCount)}`);
  }
  return parts.length > 0 ? parts.join(' \u00b7 ') : undefined;
}

// ---------------------------------------------------------------------------
// Narrowing helper for the endpoints builder
// ---------------------------------------------------------------------------

/**
 * Narrow the wide `Record<string, unknown>` `logEnrichment` envelope to a
 * strict `LogEnrichmentRuntimeBlock`. Returns `undefined` when no runtime
 * block is present or when the block does not satisfy either union variant.
 *
 * Mirrors the same narrowing used in `runtimeEvidenceContextBuilder.ts`
 * — duplicated here so the per-type builder remains self-contained and
 * doesn't introduce a cross-module dependency on internal narrowing
 * helpers.
 */
function readRuntimeBlock(
  candidate: DiscoveryCandidateDto
): LogEnrichmentRuntimeBlock | undefined {
  const runtime = candidate.log_enrichment?.runtime;
  if (!runtime || typeof runtime !== 'object') return undefined;
  const asRecord = runtime as Record<string, unknown>;
  if (asRecord.noUsageObserved === true) {
    return runtime as unknown as LogEnrichmentRuntimeBlock;
  }
  if (asRecord.matched && typeof asRecord.matched === 'object') {
    return runtime as unknown as LogEnrichmentRuntimeBlock;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Section factory for the "no evidence" case (shared across all types)
// ---------------------------------------------------------------------------

function notFoundSection(): CandidateEvidenceSection {
  return {
    title: TITLE,
    status: 'not_available',
    summary: NOT_FOUND_SUMMARY,
    fields: [],
  };
}

// ---------------------------------------------------------------------------
// Per-type builder: endpoints
// ---------------------------------------------------------------------------

/**
 * Build the Log Scans evidence section for an `endpoints` candidate.
 *
 * Reads `candidate.log_enrichment.runtime` directly (no precomputed
 * context needed — the evidence is per-candidate, not derived).
 */
export function buildEndpointLogEvidenceSection(
  candidate: DiscoveryCandidateDto
): CandidateEvidenceSection {
  const block = readRuntimeBlock(candidate);
  if (!block) {
    return notFoundSection();
  }

  // No-usage variant — zero IS evidence.
  if ('noUsageObserved' in block && block.noUsageObserved === true) {
    return {
      title: TITLE,
      status: 'available',
      summary: 'No matching log observations in processed log window.',
      fields: [],
    };
  }

  // Matched variant.
  const matched = (block as { matched: MatchedRuntimeEvidence }).matched;
  const fields: CandidateEvidenceField[] = [];

  const statusLine = formatStatusCodes({
    status2xxCount: matched.status2xxCount,
    status3xxCount: matched.status3xxCount,
    status4xxCount: matched.status4xxCount,
    status5xxCount: matched.status5xxCount,
  });
  if (statusLine !== undefined) {
    fields.push({ label: 'Status codes', value: statusLine });
  }

  const firstSeen = formatDateOnly(matched.firstSeen);
  if (firstSeen !== undefined) {
    fields.push({ label: 'First seen', value: firstSeen });
  }

  const lastSeen = formatDateOnly(matched.lastSeen);
  if (lastSeen !== undefined) {
    fields.push({ label: 'Last seen', value: lastSeen });
  }

  return {
    title: TITLE,
    status: 'available',
    summary: `Observed ${formatNumber(matched.observedUsageCount)} successful/redirect calls in supplied logs.`,
    fields,
  };
}

// ---------------------------------------------------------------------------
// Per-type builder: interfaces
// ---------------------------------------------------------------------------

/**
 * Decide the rollup status for `interfaces`:
 *
 *   - `available` when every related endpoint that exists also has
 *     observed evidence (`observedEndpointCount === totalEndpointCount`
 *     AND > 0).
 *   - `partial` when SOME related endpoints have evidence and SOME don't
 *     (`observedEndpointCount > 0` AND `< totalEndpointCount`).
 *   - `not_available` when NO related endpoints have evidence
 *     (`observedEndpointCount === 0`) — caller routes this case to the
 *     standard "not found" section so wording stays consistent.
 */
function interfaceRollupStatus(
  observedEndpointCount: number,
  totalEndpointCount: number
): CandidateEvidenceStatus {
  if (observedEndpointCount === 0) return 'not_available';
  if (observedEndpointCount < totalEndpointCount) return 'partial';
  return 'available';
}

/**
 * Build the Log Scans evidence section for an `interfaces` candidate.
 *
 * Reads the precomputed `interfaceRollupByCandidateId` map; when the
 * map has no entry for this candidate (e.g. context not yet built),
 * falls back to the standard "not found" section.
 */
export function buildInterfaceLogEvidenceSection(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext?: RuntimeEvidenceContext
): CandidateEvidenceSection {
  const rollup = runtimeEvidenceContext?.interfaceRollupByCandidateId.get(
    candidate.id
  );
  if (!rollup) {
    return notFoundSection();
  }
  return interfaceSectionFromRollup(rollup);
}

function interfaceSectionFromRollup(
  rollup: InterfaceRuntimeRollup
): CandidateEvidenceSection {
  const status = interfaceRollupStatus(
    rollup.observedEndpointCount,
    rollup.totalEndpointCount
  );

  // No related endpoints with evidence at all → fall back to the
  // standard "not found" section so the wording is consistent with the
  // missing-rollup case.
  if (status === 'not_available') {
    return notFoundSection();
  }

  const fields: CandidateEvidenceField[] = [
    {
      label: 'Observed endpoints',
      value: `${formatNumber(rollup.observedEndpointCount)} of ${formatNumber(
        rollup.totalEndpointCount
      )} related endpoints.`,
    },
  ];

  const top = rollup.topEndpoints[0];
  if (top !== undefined) {
    fields.push({
      label: 'Top endpoint',
      value: `${top.method} ${top.pathTemplate} \u2014 ${formatNumber(top.observedUsageCount)} calls`,
    });
  }

  const statusLine = formatStatusCodes(rollup.statusBreakdown);
  if (statusLine !== undefined) {
    fields.push({ label: 'Status codes', value: statusLine });
  }

  const firstSeen = formatDateOnly(rollup.firstSeen);
  if (firstSeen !== undefined) {
    fields.push({ label: 'First seen', value: firstSeen });
  }

  const lastSeen = formatDateOnly(rollup.lastSeen);
  if (lastSeen !== undefined) {
    fields.push({ label: 'Last seen', value: lastSeen });
  }

  return {
    title: TITLE,
    status,
    summary: `Related endpoints observed ${formatNumber(rollup.totalObservedCalls)} successful/redirect calls.`,
    fields,
  };
}

// ---------------------------------------------------------------------------
// Per-type builder: logical_data_entities
// ---------------------------------------------------------------------------

/**
 * Build the Log Scans evidence section for a `logical_data_entities`
 * candidate. Reads the precomputed `logicalDataEntityRollupByCandidateId`
 * map; missing rollup entry → "not found" fallback.
 *
 * The Spec 2 LDE rollup carries `relatedEndpointCount` (denominator) and
 * `totalObservedCalls` / read-like / write-like (numerators) but does
 * NOT carry an `observedEndpointCount` — meaning we cannot reliably
 * distinguish "all related endpoints observed" from "some related
 * endpoints observed" at this layer. The status mapping therefore
 * collapses the interface rule down to a binary `available` / no-evidence:
 *
 *   - `available` when at least one observed call rolled up.
 *   - "not found" fallback when no observations rolled up at all.
 *
 * Future spec can add an `observedEndpointCount` to the rollup if a
 * `partial` signal is needed here.
 */
export function buildLogicalDataEntityLogEvidenceSection(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext?: RuntimeEvidenceContext
): CandidateEvidenceSection {
  const rollup =
    runtimeEvidenceContext?.logicalDataEntityRollupByCandidateId.get(
      candidate.id
    );
  if (!rollup) {
    return notFoundSection();
  }
  return logicalDataEntitySectionFromRollup(rollup);
}

function logicalDataEntitySectionFromRollup(
  rollup: LogicalDataEntityRuntimeRollup
): CandidateEvidenceSection {
  if (rollup.totalObservedCalls === 0) {
    return notFoundSection();
  }

  const fields: CandidateEvidenceField[] = [];

  if (rollup.readLikeCount > 0) {
    fields.push({
      label: 'Read-like traffic',
      value: formatNumber(rollup.readLikeCount),
    });
  }
  if (rollup.writeLikeCount > 0) {
    fields.push({
      label: 'Write/change-like traffic',
      value: formatNumber(rollup.writeLikeCount),
    });
  }

  const firstSeen = formatDateOnly(rollup.firstSeen);
  if (firstSeen !== undefined) {
    fields.push({ label: 'First seen', value: firstSeen });
  }

  const lastSeen = formatDateOnly(rollup.lastSeen);
  if (lastSeen !== undefined) {
    fields.push({ label: 'Last seen', value: lastSeen });
  }

  return {
    title: TITLE,
    status: 'available',
    summary: `Related endpoints observed ${formatNumber(rollup.totalObservedCalls)} successful/redirect calls.`,
    fields,
  };
}

// ---------------------------------------------------------------------------
// Per-type builder: interface_logical_entities
// ---------------------------------------------------------------------------

/**
 * Build the Log Scans evidence section for an `interface_logical_entities`
 * candidate. Reads the precomputed
 * `interfaceLogicalEntityRollupByCandidateId` map; missing entry →
 * "not found" fallback.
 *
 * Status mapping:
 *   - `available` when every supporting endpoint contributed to a known
 *     role (Request OR Response — Unknown role bucket is empty).
 *   - `partial` when at least one supporting endpoint fell into the
 *     Unknown role bucket (degradation signal — non-Spring adapter or a
 *     missing `requestBodyType` / `responseType` on the endpoint).
 *   - "not found" fallback when no supporting endpoints at all.
 */
export function buildInterfaceLogicalEntityLogEvidenceSection(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext?: RuntimeEvidenceContext
): CandidateEvidenceSection {
  const rollup =
    runtimeEvidenceContext?.interfaceLogicalEntityRollupByCandidateId.get(
      candidate.id
    );
  if (!rollup) {
    return notFoundSection();
  }
  return interfaceLogicalEntitySectionFromRollup(rollup);
}

function interfaceLogicalEntitySectionFromRollup(
  rollup: InterfaceLogicalEntityRuntimeRollup
): CandidateEvidenceSection {
  if (rollup.supportingEndpointCount === 0) {
    return notFoundSection();
  }

  const status: CandidateEvidenceStatus =
    rollup.unknownRoleUsageCount > 0 ? 'partial' : 'available';

  const fields: CandidateEvidenceField[] = [];

  if (rollup.requestBodyUsageCount > 0) {
    fields.push({
      label: 'Request body usage',
      value: `${formatNumber(rollup.requestBodyUsageCount)} calls`,
    });
  }
  if (rollup.responseBodyUsageCount > 0) {
    fields.push({
      label: 'Response body usage',
      value: `${formatNumber(rollup.responseBodyUsageCount)} calls`,
    });
  }
  if (rollup.unknownRoleUsageCount > 0) {
    fields.push({
      label: 'Unknown role usage',
      value: `${formatNumber(rollup.unknownRoleUsageCount)} calls`,
    });
  }

  // Total observed contract usage — always shown when supportingEndpointCount > 0.
  fields.push({
    label: 'Total observed contract usage',
    value: `${formatNumber(rollup.totalObservedContractUsage)} successful/redirect calls`,
  });

  return {
    title: TITLE,
    status,
    summary: `This interface/data relationship is supported by ${formatNumber(rollup.supportingEndpointCount)} observed endpoints.`,
    fields,
  };
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

/**
 * Top-level Log Scans evidence builder. Dispatches by
 * `candidate.candidate_type` to one of the four per-type builders.
 *
 * For unsupported candidate types (those not in the Spec 1 expandable
 * allowlist), returns the standard "not found" section. The wider
 * `candidateDetailsSupport.ts` allowlist gate prevents those types from
 * being expanded in the UI today, but the dispatcher is defensive.
 *
 * Spec 7 (2026-05-11) Task Group 3.3: when `runtimeEvidenceContext` is
 * supplied AND the candidate's display confidence exceeds its base
 * confidence, the dispatcher decorates the per-type-builder's section
 * with the Spec 7 impact block (label "Confidence increased" + the
 * `getDisplayConfidence` upliftReason wording). Decoration happens only
 * at this dispatcher boundary so each per-type builder remains a strict
 * Spec-6 function.
 */
export function buildLogScansEvidenceSection(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext?: RuntimeEvidenceContext
): CandidateEvidenceSection {
  let section: CandidateEvidenceSection;
  switch (candidate.candidate_type) {
    case 'endpoints':
      section = buildEndpointLogEvidenceSection(candidate);
      break;
    case 'interfaces':
      section = buildInterfaceLogEvidenceSection(candidate, runtimeEvidenceContext);
      break;
    case 'logical_data_entities':
      section = buildLogicalDataEntityLogEvidenceSection(
        candidate,
        runtimeEvidenceContext
      );
      break;
    case 'interface_logical_entities':
      section = buildInterfaceLogicalEntityLogEvidenceSection(
        candidate,
        runtimeEvidenceContext
      );
      break;
    default:
      section = notFoundSection();
      break;
  }

  // Spec 7: populate impact block ONLY when there is an actual log delta
  // to explain. Without a runtime context we cannot derive the delta;
  // leave the impact fields unset so the renderer hides the block.
  if (runtimeEvidenceContext) {
    const result = getDisplayConfidence(candidate, runtimeEvidenceContext);
    const hasUplift =
      result.baseConfidence !== null &&
      result.displayConfidence !== null &&
      result.displayConfidence > result.baseConfidence;
    if (hasUplift && result.upliftLabel.length > 0) {
      section.confidenceImpactLabel = result.upliftLabel;
      if (result.upliftReason.length > 0) {
        section.confidenceImpactReason = result.upliftReason;
      }
    }
  }

  return section;
}
