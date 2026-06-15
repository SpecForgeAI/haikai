# Specification: Confidence, Tier, and Runtime Badges

## Goal
Surface log-derived runtime relevance at the candidate-review table level (without expansion) by adding a sibling RuntimeBadge next to the existing TierBadge, an inline confidence-uplift indicator, and Spec 3's previously-defined `confidenceImpactLabel` / `confidenceImpactReason` populated only when an actual delta exists. This is Spec 7 of 7 — the final spec in the discovery candidate evidence explainability roadmap. Frontend-only display layer; reads Spec 5 + 6 data read-only and never mutates persisted candidate state.

## User Stories
- As a discovery reviewer, I want runtime relevance visible directly in the candidate table so that I can scan which candidates are corroborated by logs without expanding every row.
- As a discovery reviewer, I want displayed confidence to reflect log-evidence corroboration with a clear `+N` indicator so that I can see at a glance which rows have been strengthened by runtime data.
- As a discovery reviewer, I want the expanded panel to explain exactly why displayed confidence differs from the base score so that the table-level uplift remains traceable to its underlying log evidence.

## Specific Requirements

**Scope summary**
- Frontend-only display layer. NO backend, NO gateway, NO discovery-service, NO AMS code or schema changes.
- Reads existing data only: per-candidate `logEnrichment.runtime` (Spec 5) and the precomputed `RuntimeEvidenceContext` (Spec 6) already memoized in `DiscoveryCandidateTable`.
- Persisted `candidate.confidence` (0..1) is NEVER mutated; uplift is a display-only computation.
- Existing 7-column header (`Name | Tier | Type | Confidence | Review Status | Synthesized At | Actions`) is preserved verbatim — no new column added.

**Runtime signal placement — inline sibling pill, not a new column**
- The Tier `<td>` becomes a small inline cluster: `<TierBadge addedBy={...} />` followed by an optional `<RuntimeBadge label={...} variant={...} />` when associated runtime evidence exists.
- `TierBadge` rendering and labels (`adapter`, `gap-fill`, `ir-guided`, `llm-solo`, `—`) remain BYTE-IDENTICAL. NO edits to `TierBadge.tsx` or its CSS module.
- The "+ LOGS" semantic from the brief is conveyed by RuntimeBadge's PRESENCE — no separate "+LOGS" pill is rendered. The runtime metric text (e.g. `Observed 1.8k`, `High usage`, `Elevated errors`) is the badge's own label.
- Per code-inspection finding, `_addedBy` is a single string and `dedupLlmCandidates` enforces mutual exclusivity between adapter and LLM provenance, so `ADAPTER + LLM` and `ADAPTER + LLM + LOGS` combinations from the brief never appear in practice. No special-casing needed.
- When the candidate has no associated log evidence (per `hasAssociatedLogEvidence(...) === false`), NO RuntimeBadge is rendered; the row reverts to the byte-identical pre-Spec-7 Tier cell.

**New constants module — `frontend/src/components/DashboardView/runtimeBadgeThresholds.ts`**
- Single source of truth for thresholds; compile-time constants, no UI tuning surface.
- `HIGH_USAGE_ENDPOINT_THRESHOLD = 1000`
- `MEDIUM_USAGE_ENDPOINT_THRESHOLD = 100`
- `LOW_USAGE_ENDPOINT_THRESHOLD = 1`
- `ELEVATED_5XX_COUNT_THRESHOLD = 10`
- `ELEVATED_5XX_RATE_THRESHOLD = 0.01`
- `INTERFACE_HIGH_USAGE_THRESHOLD = 1000` (used both for badge "High usage" and for the +4 interface uplift rule)
- `MAX_LOG_CORROBORATED_CONFIDENCE = 99` (decimal 0.99)
- `MAX_LLM_LOG_ONLY_CONFIDENCE = 95` (decimal 0.95)

**New helpers module — `frontend/src/components/DashboardView/runtimeBadgeHelpers.ts`**
- Pure functions, no React, no API calls. Exports:
  - `hasAssociatedLogEvidence(candidate, runtimeEvidenceContext): boolean` — true iff supported candidate type AND a non-zero entry exists in the context (per-candidate map for endpoints, or any of the three rollup maps for the indirection types).
  - `getRuntimeBadgeFor(candidate, runtimeEvidenceContext): { label: string, variant: 'success' | 'warning' | 'caution' | 'danger' | 'neutral' } | null` — null when no badge should render.
  - `getEvidenceSourceLabel(candidate, runtimeEvidenceContext): string` — informational helper used by tests / future callers; the visual surface is the RuntimeBadge sibling per resolved decision 2.
- Unsupported candidate types ALWAYS return `null` from `getRuntimeBadgeFor`. Type gate matches Spec 6 (`endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities`).

**RuntimeBadge label rules (pinned)**
- `endpoints`: read `runtimeEvidenceContext.byCandidateId.get(candidate.id)`. When matched evidence with `observedUsageCount > 0`:
  - If `status5xxCount >= ELEVATED_5XX_COUNT_THRESHOLD` OR `status5xxCount / totalLogRequests >= ELEVATED_5XX_RATE_THRESHOLD` → label `"Elevated errors"`, variant `warning` (precedence over usage labels).
  - Else if `observedUsageCount >= HIGH_USAGE_ENDPOINT_THRESHOLD` → label `"High usage"`, variant `success`.
  - Else → label `"Observed {compact}"` (e.g. `Observed 1.8k`, `Observed 42`), variant `success`.
  - Has `noUsageObserved` OR no entry in `byCandidateId` → null.
- `interfaces`: read `interfaceRollupByCandidateId.get(candidate.id)`. When `totalObservedCalls > 0`:
  - If `totalObservedCalls >= INTERFACE_HIGH_USAGE_THRESHOLD` → label `"High usage"`, variant `success`.
  - Else → label `"Observed {compact}"`, variant `success`.
  - Otherwise → null.
- `logical_data_entities`: read `logicalDataEntityRollupByCandidateId.get(candidate.id)`. Same rule shape as interfaces, comparing `totalObservedCalls` against `INTERFACE_HIGH_USAGE_THRESHOLD`.
- `interface_logical_entities`: read `interfaceLogicalEntityRollupByCandidateId.get(candidate.id)`. Same rule shape, comparing `totalObservedContractUsage` against `INTERFACE_HIGH_USAGE_THRESHOLD`.
- Unsupported candidate types → ALWAYS null (no badge).
- All counts formatted via `Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })` — `1842` → `1.8k`, `12430` → `12k`, `1234567` → `1.2M`.

**New display-confidence module — `frontend/src/components/DashboardView/displayConfidence.ts`**
- Pure module, no React. Exports `getDisplayConfidence(candidate, runtimeEvidenceContext)` returning `{ baseConfidence: number | null, displayConfidence: number | null, uplift: number, baseLabel: string, baseReason: string, upliftLabel: string, upliftReason: string }`.
- Inputs in percentage points internally; output `baseConfidence` / `displayConfidence` retain the persisted decimal range (0..1) so the existing `Math.round(value * 100)` rendering remains unchanged.
- When `candidate.confidence` is null → `baseConfidence = null`, `displayConfidence = null`, `uplift = 0`, all label/reason fields empty strings.
- When candidate type is unsupported → `displayConfidence = baseConfidence`, `uplift = 0`, all label/reason fields empty.
- Per-type uplift rules apply only when a non-zero contribution from runtime evidence exists; otherwise `uplift = 0`.
- Cap rule: `displayConfidence = min(baseConfidence + uplift, cap)` where `cap = MAX_LLM_LOG_ONLY_CONFIDENCE` (0.95) when source is LLM-only with no code evidence; otherwise `cap = MAX_LOG_CORROBORATED_CONFIDENCE` (0.99).
- Persisted base confidence is never mutated.

**Confidence-uplift rules (pinned, percentage-point values)**
- `endpoints`:
  - Adapter source (`_addedBy` ends with `-adapter`):
    - `observedUsageCount >= 1000` → `+5`
    - else `observedUsageCount >= 100` → `+4`
    - else `observedUsageCount >= 1` → `+3`
    - else → `0` (no uplift if `noUsageObserved`, 4xx/5xx-only, pure-404 (already excluded by Spec 5 from `observedUsageCount`), or no entry)
    - Cap at `MAX_LOG_CORROBORATED_CONFIDENCE` (99 pp).
  - LLM source (`_addedBy` starts with `llm-`):
    - `observedUsageCount >= 1` → `+5`
    - else → `0`
    - Cap at `MAX_LLM_LOG_ONLY_CONFIDENCE` (95 pp).
- `interfaces` — derive from `InterfaceRuntimeRollup`. Take the highest applicable:
  - `(observedEndpointCount / totalEndpointCount) >= 0.75 AND totalObservedCalls >= INTERFACE_HIGH_USAGE_THRESHOLD` → `+4`
  - else `(observedEndpointCount / totalEndpointCount) >= 0.5` → `+3`
  - else `observedEndpointCount >= 1` → `+2`
  - else → `0`
  - Cap at 99 pp.
- `logical_data_entities`: `LogicalDataEntityRuntimeRollup.totalObservedCalls > 0` → `+1`; else `0`. Cap at 99 pp.
- `interface_logical_entities`: read `InterfaceLogicalEntityRuntimeRollup`:
  - `(requestBodyUsageCount + responseBodyUsageCount) > 0` (role known on at least one related endpoint) → `+2`
  - else `unknownRoleUsageCount > 0` (role unknown but related endpoint usage observed) → `+1`
  - else → `0`
  - Cap at 99 pp.
- All uplift inputs are ZERO when no entry exists in context, when `noUsageObserved`, or when the candidate type is unsupported.

**Modified table cell — `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`**
- Tier `<td>` body changes from `<TierBadge addedBy={addedBy} data-testid="candidate-tier-badge" />` to an inline cluster:
  - `<TierBadge addedBy={addedBy} data-testid="candidate-tier-badge" />`
  - followed by `<RuntimeBadge label={...} variant={...} data-testid="candidate-runtime-badge" />` when `getRuntimeBadgeFor(...)` returns non-null.
- Confidence `<td>` reads from `getDisplayConfidence(candidate, runtimeEvidenceContext).displayConfidence` instead of `candidate.confidence`. Rendered as `{Math.round(displayConfidence * 100)}%` (preserves existing rounding) or `"—"` for null.
- When `uplift > 0`, append a small adjacent `<span data-testid="candidate-confidence-uplift">+N</span>` immediately after the percentage value (CSS sizes it down; no superscript markup needed).
- The single `useMemo(() => buildRuntimeEvidenceContext(filteredCandidates), [filteredCandidates])` already established by Spec 6 in this file is REUSED — no second context build.

**New presentational component — `frontend/src/components/DashboardView/RuntimeBadge.tsx`**
- Props: `{ label: string; variant: 'success' | 'warning' | 'caution' | 'danger' | 'neutral'; ['data-testid']?: string }`.
- Mirrors TierBadge's render shape (small pill `<span>` with variant-token CSS class).
- Reuses TierBadge's existing CSS module variant classes (success/warning/caution/danger/neutral). NO new CSS module file is added in this spec.
- Knows nothing about candidates or runtime context — pure presentational.

**Modified evidence builder — `frontend/src/components/DashboardView/codeDetectionEvidenceBuilder.ts`**
- Extended (NOT duplicated) to populate `confidenceImpactLabel` / `confidenceImpactReason` on the returned `CandidateEvidenceSection`.
- Population gate: only when `displayConfidence > baseConfidence` for the same candidate (i.e. there is an actual log delta to explain). When `displayConfidence === baseConfidence`, leave both fields unset.
- When populated:
  - `confidenceImpactLabel: "Base confidence"`
  - `confidenceImpactReason: "Deterministic code adapter evidence."` when `_addedBy` ends with `-adapter`; `"Initial LLM-derived confidence."` when `_addedBy` starts with `llm-`.
- The builder receives `runtimeEvidenceContext` through the same threading already established by Spec 6 (or via a small additive parameter; threading detail mirrors `buildLogScansEvidenceSection`'s Spec 6 signature change).

**Modified evidence builder — `frontend/src/components/DashboardView/logScansEvidenceBuilder.ts`**
- Extended (NOT duplicated) to populate `confidenceImpactLabel` / `confidenceImpactReason` on the returned `CandidateEvidenceSection`.
- Population gate: only when `displayConfidence > baseConfidence` for this candidate.
- When populated:
  - `confidenceImpactLabel: "Confidence increased"`
  - `confidenceImpactReason` for `endpoints`: `"Runtime logs observed N successful/redirect calls matching this candidate."` (with N = `observedUsageCount`, formatted with `Intl.NumberFormat(undefined).format(n)` thousand separators).
  - `confidenceImpactReason` for `interfaces` / `logical_data_entities` / `interface_logical_entities`: `"Related endpoint runtime usage observed."`.
- The Spec 3 generic renderer `CandidateEvidenceSectionCard` already conditionally renders the impact block from these fields — UNCHANGED in Spec 7.

**What does NOT change**
- `TierBadge.tsx` and its CSS — UNCHANGED.
- `CandidateEvidenceSectionCard.tsx` (Spec 3 generic renderer) — UNCHANGED.
- `candidateDetailsSupport.ts` allowlist — UNCHANGED.
- `runtimeEvidenceContextBuilder.ts` (Spec 6) — UNCHANGED. Spec 7 reuses its output from the same memo.
- All non-frontend code (discovery-service, gateway, AMS, persistence) — UNCHANGED.
- Persisted `candidate.confidence` value — UNCHANGED. Spec 7 is display-only.
- The 7-column table header (`Name | Tier | Type | Confidence | Review Status | Synthesized At | Actions`) — UNCHANGED.
- All testid contracts established in Specs 1-6 (`candidate-details-panel-{id}`, `candidate-details-row-{id}`, `code-detection-*`, `log-scans-*`, `llm-review-*`, `candidate-tier-badge`, `candidate-confidence-cell`, `log-scans-field-{slug}`).
- Show Details / Close Details / Approve / Reject / Defer behaviour, table filtering, sorting, paging, single-row-expansion semantics.
- Candidate Details Panel does not repeat row-level summary fields.

**Display formatting (pinned)**
- Compact numerics in RuntimeBadge labels: `Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })`.
- Confidence column value: `{Math.round(displayConfidence * 100)}%` for non-null, `"—"` otherwise.
- Uplift indicator: `<span data-testid="candidate-confidence-uplift"> +{N}</span>` adjacent to the percentage value (CSS sizes it down).
- Numbers inside `confidenceImpactReason` strings: `Intl.NumberFormat(undefined).format(n)` thousand-separator format (matches Spec 6's `"1,842"` convention).

## Visual Design

The `planning/visuals/` folder is empty for this spec. Visual reference is the existing Spec 6 candidate review table layout combined with Spec 1's three-column expansion panel — both preserved byte-identical by this spec for everything except: (a) the Tier `<td>` body now contains an optional sibling RuntimeBadge, (b) the Confidence `<td>` reads `displayConfidence` and shows an optional adjacent `+N` indicator, and (c) the Code Detection / Log Scans evidence cards now render their existing impact-block slot when `displayConfidence > baseConfidence`.

## Existing Code to Leverage

**`frontend/src/components/DashboardView/TierBadge.tsx` and its CSS module**
- TierBadge component remains UNCHANGED (no edits to file or labels). Its CSS variant tokens (`success`, `warning`, `caution`, `danger`, `neutral`) are reused by the new RuntimeBadge — no new CSS module is added.

**`frontend/src/components/DashboardView/runtimeEvidenceContextBuilder.ts` (Spec 6)**
- The single memoized `RuntimeEvidenceContext` already produced in `DiscoveryCandidateTable` via `useMemo(() => buildRuntimeEvidenceContext(filteredCandidates), [filteredCandidates])` is the input to BOTH the new RuntimeBadge helpers AND the new `getDisplayConfidence` helper. ONE memo, no second pass over candidates, no recomputation per row.

**`frontend/src/components/DashboardView/candidateEvidenceTypes.ts` (Spec 3 + 6)**
- `CandidateEvidenceSection` already declares optional `confidenceImpactLabel` and `confidenceImpactReason`. Spec 7 finally populates them; no contract change required. The four rollup interfaces (`InterfaceRuntimeRollup`, `LogicalDataEntityRuntimeRollup`, `InterfaceLogicalEntityRuntimeRollup`) and the `RuntimeEvidenceContext` are consumed unchanged.

**`frontend/src/components/DashboardView/CandidateEvidenceSectionCard.tsx` (Spec 3)**
- Generic renderer's existing conditional-render rule for the impact block (`Impact: {confidenceImpactLabel}` + optional reason) is consumed unchanged. Spec 7 does not touch the renderer.

**`frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx` (Specs 1 + 6)**
- The Tier `<td>` and Confidence `<td>` are the only modified surfaces. The existing `useMemo` for the runtime evidence context, the existing call site for `<CandidateDetailsPanel runtimeEvidenceContext={ctx} />`, and the 7-column header are reused.

## Out of Scope
- Backend, gateway, discovery-service, or AMS code or schema changes. Spec 5 already persists everything needed; Spec 6 already exposes the rollups.
- Mutating persisted `candidate.confidence`. Display-only computation; no PUT/PATCH back to AMS.
- Adding a new "Runtime" table column or any new column. The 7-column header is preserved.
- Editing `TierBadge.tsx`, its labels, or its CSS module.
- Editing `CandidateEvidenceSectionCard.tsx` (the Spec 3 generic renderer).
- A separate "+LOGS" pill. The RuntimeBadge's presence conveys the "+ LOGS" semantic.
- Row-level "No log evidence" badge. Omitted at row level; the expanded Log Scans column already shows Spec 6's `"Log scan evidence was not found for this run."` fallback.
- User-configurable threshold UI. Thresholds are compile-time constants in `runtimeBadgeThresholds.ts`.
- Reducing confidence based on missing log evidence, 404-only evidence, or 4xx/5xx-only evidence (zero-uplift only; never negative).
- Promoting unmatched log-only observations to candidates or any new "log-only routes" UI surface.
- Decommissioning or "unused"/"dead code" wording. Use `"Observed N"`, `"High usage"`, `"Elevated errors"`.
- Raw log file fetching, viewing, or parsing in the frontend.
- LLM Review section content. Remains the existing Spec 3 placeholder.

## Test Plan

**New file — `frontend/src/components/DashboardView/__tests__/runtimeBadgeHelpers.test.ts`** (pure unit tests, ~10 tests)
- `getRuntimeBadgeFor` returns null for unsupported candidate types regardless of context contents.
- Endpoints with `observedUsageCount = 42` → `{ label: "Observed 42", variant: "success" }`.
- Endpoints with `observedUsageCount = 1842` → `{ label: "Observed 1.8k", variant: "success" }`.
- Endpoints with `observedUsageCount = 1500` → `{ label: "High usage", variant: "success" }` (≥ HIGH_USAGE).
- Endpoints with `status5xxCount = 25` → `{ label: "Elevated errors", variant: "warning" }` even when `observedUsageCount` is high (precedence rule).
- Endpoints with `status5xxCount = 5` but `status5xxCount / totalLogRequests >= 0.01` → `"Elevated errors"`.
- Endpoints with `noUsageObserved` → null.
- Interfaces with rollup `totalObservedCalls > 0` and `< INTERFACE_HIGH_USAGE_THRESHOLD` → `"Observed {compact}"`.
- Interfaces with rollup `totalObservedCalls >= INTERFACE_HIGH_USAGE_THRESHOLD` → `"High usage"`.
- `logical_data_entities` and `interface_logical_entities` rollups produce badges via the same shape rules.
- `hasAssociatedLogEvidence` returns false when type is supported but no entry exists in any context map.

**New file — `frontend/src/components/DashboardView/__tests__/displayConfidence.test.ts`** (pure unit tests, ~14 tests)
- Null `candidate.confidence` → `displayConfidence: null`, `uplift: 0`, all labels empty.
- Unsupported candidate type → `displayConfidence === baseConfidence`, `uplift: 0`.
- Adapter endpoints: `observedUsageCount = 1` → `+3`; `= 100` → `+4`; `= 1000` → `+5`.
- Adapter endpoints: `noUsageObserved` → `+0`.
- Adapter endpoints: `observedUsageCount = 0`, `status5xxCount = 50` → `+0` (4xx/5xx-only does not uplift).
- Adapter endpoints: `baseConfidence = 0.97`, `+5` → capped at `0.99`.
- LLM endpoints: `observedUsageCount = 1` → `+5`; capped at `0.95`.
- Interfaces: only rollup with `observedEndpointCount = 1, totalEndpointCount = 4` → `+2`.
- Interfaces: rollup with `observedEndpointCount / totalEndpointCount = 0.5` → `+3`.
- Interfaces: rollup with 75%+ coverage AND `totalObservedCalls >= 1000` → `+4`.
- `logical_data_entities` with `totalObservedCalls > 0` → `+1`; without → `+0`.
- `interface_logical_entities` with `(requestBodyUsageCount + responseBodyUsageCount) > 0` → `+2`.
- `interface_logical_entities` with only `unknownRoleUsageCount > 0` → `+1`.
- Defensive: pure-404 evidence (`observedUsageCount = 0` per Spec 5 exclusion) → `+0`.

**New file — `frontend/src/components/DashboardView/__tests__/RuntimeBadge.test.tsx`** (renderer tests, ~4 tests)
- Renders pill with provided label.
- Each variant (`success`, `warning`, `caution`, `danger`, `neutral`) applies the matching CSS class.
- Forwards `data-testid` to the rendered element.
- Renders no badge when label is empty (defensive guard, not a runtime path).

**Extended file — `frontend/src/components/DashboardView/__tests__/candidateEvidenceBuilder.test.ts`** (additions covering the impact-field population)
- Code Detection: when `displayConfidence === baseConfidence`, neither `confidenceImpactLabel` nor `confidenceImpactReason` is set on the returned section.
- Code Detection: when `displayConfidence > baseConfidence` and `_addedBy` ends with `-adapter`, the section sets `confidenceImpactLabel: "Base confidence"` and `confidenceImpactReason: "Deterministic code adapter evidence."`.
- Code Detection: same delta condition with `_addedBy = "llm-gap-fill"` → `confidenceImpactReason: "Initial LLM-derived confidence."`.
- Log Scans: when `displayConfidence === baseConfidence`, impact fields remain unset.
- Log Scans: endpoints uplift case → `confidenceImpactLabel: "Confidence increased"`, `confidenceImpactReason: "Runtime logs observed 1,842 successful/redirect calls matching this candidate."` (thousand-separator formatting).
- Log Scans: indirection-type uplift case → `confidenceImpactReason: "Related endpoint runtime usage observed."`.

**Extended file — `frontend/src/components/DashboardView/__tests__/candidateDetailsPanel.test.tsx`** (additions)
- Panel rendered with a populated `runtimeEvidenceContext` for an `endpoints` candidate whose `displayConfidence > baseConfidence` emits both the Code Detection `Impact: Base confidence` block AND the Log Scans `Impact: Confidence increased` block.
- Panel rendered for a candidate where `displayConfidence === baseConfidence` does NOT emit any impact block in either section (existing Spec 3 conditional-render behaviour).

**New / extended file — `frontend/src/components/DashboardView/__tests__/discoveryCandidateTableRuntime.test.tsx`** (integration, ~6 tests)
- Tier `<td>` for an adapter endpoint with `observedUsageCount = 1842` renders `<TierBadge addedBy="spring-boot-adapter">` AND a sibling `<RuntimeBadge label="Observed 1.8k" />`.
- Tier `<td>` for an adapter endpoint with no associated log evidence renders ONLY the existing `<TierBadge>` (no RuntimeBadge sibling).
- Confidence `<td>` for an adapter endpoint with `baseConfidence = 0.80` and `+5` uplift renders `85%` followed by `+5` in the uplift indicator.
- Confidence `<td>` capping: `baseConfidence = 0.97`, eligible `+5` → renders `99%` and `+2` in the uplift indicator.
- Unsupported candidate type renders no RuntimeBadge sibling AND `displayConfidence === baseConfidence` (no uplift indicator).
- LLM-only endpoint with `observedUsageCount > 0` renders `TierBadge('llm-solo')` + sibling `RuntimeBadge` and capped uplift up to `95%`.

**Non-regression backstops (must continue to pass with NO assertion changes)**
- `candidateDetailsExpansion.test.tsx` (Spec 1) — three-column structure and testid contract preserved.
- `candidateEvidenceSectionCard.test.tsx` (Spec 3) — generic renderer untouched.
- `runtimeEvidenceContextBuilder.test.ts` (Spec 6) — context builder untouched.
- `candidateReviewWorkflow.test.tsx` — review actions, table filtering, sorting, paging, expansion semantics untouched.
- `codeDetectionMappers.test.ts` (Spec 2) — mapper untouched.
- The 7-column header assertion (gated by `CANDIDATE_TABLE_COLUMN_COUNT = 7`) — unchanged.
- All preserved testids: `candidate-tier-badge`, `candidate-confidence-cell`, `candidate-details-panel-{id}`, `candidate-details-row-{id}`, `code-detection-*`, `log-scans-*`, `llm-review-*`, `log-scans-field-{slug}`.

## Acceptance Criteria
1. Supported candidate types with associated log evidence render a sibling RuntimeBadge in the Tier `<td>` at the row level.
2. Endpoint candidates with observed usage render compact runtime count, e.g. `Observed 1.8k`, `Observed 42`.
3. Interface candidates with derived related-endpoint usage render compact runtime evidence via the rollup.
4. `logical_data_entities` candidates with derived related-endpoint usage render compact runtime evidence via the rollup.
5. `interface_logical_entities` candidates with derived contract usage render compact runtime evidence via the rollup.
6. Candidates with associated log evidence display the runtime sibling pill (the "+ LOGS" semantic is conveyed by RuntimeBadge presence; no separate "+LOGS" pill is needed).
7. Candidates without associated log evidence render the existing Tier cell unchanged (no RuntimeBadge sibling, no `+ LOGS`).
8. Unsupported candidate types receive no RuntimeBadge and no log-based confidence change.
9. Log evidence increases displayed confidence according to centralized rules in `runtimeBadgeThresholds.ts` and `displayConfidence.ts`.
10. Displayed confidence is capped at 99% (or 95% for LLM-only with no code evidence).
11. No log evidence does not reduce confidence (uplift is zero or positive only).
12. 404-only or 4xx/5xx-only evidence does not increase confidence.
13. 5xx evidence renders an `Elevated errors` warning badge without reducing confidence.
14. The expanded details panel renders Code Detection `Impact: Base confidence` AND Log Scans `Impact: Confidence increased` blocks when (and only when) `displayConfidence > baseConfidence`.
15. Persisted `candidate.confidence` is never mutated by Spec 7.
16. Approve / Reject / Defer behaviour unchanged.
17. Show Details / Close Details behaviour unchanged.
18. Existing Log Scans detail content from Spec 6 remains visible and unchanged.
19. No unmatched log-only observations appear in the candidate review UI.
20. No raw log files are fetched or parsed by the frontend.
21. Tests added/updated for tier sibling badge, runtime badge variants, confidence display, uplift caps, and impact-block population.

## Roadmap Context
Spec 7 of 7 — final spec — in the discovery candidate evidence explainability roadmap: (1) Candidate Details Expansion UI, (2) Code Detection Detail Mappers, (3) Candidate Evidence Data Contract, (4) Runtime Log Input at Discovery Run Start, (5) Web Access Log Runtime Endpoint Evidence, (6) Log Evidence in Candidate Details UI, (7) Confidence, Tier, and Runtime Badges [this spec]. Closes the roadmap by surfacing the runtime evidence produced in Specs 4-5 and displayed in Spec 6 at the candidate-table scan level, and finally populating the `confidenceImpactLabel` / `confidenceImpactReason` slots defined-but-not-populated in Spec 3.
