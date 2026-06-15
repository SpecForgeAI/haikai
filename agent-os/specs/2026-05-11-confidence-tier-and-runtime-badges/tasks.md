# Task Breakdown: Confidence, Tier, and Runtime Badges (Spec 7 of 7)

## Overview
Total Task Groups: 5

Spec 7 is the FRONTEND-ONLY display layer that closes the discovery candidate evidence explainability roadmap. It consumes data already produced by Specs 5 + 6 read-only and renders:
1. A sibling `RuntimeBadge` next to the existing `TierBadge` in the candidate table's Tier `<td>`.
2. A `displayConfidence` value (with optional `+N` indicator) in the Confidence `<td>`.
3. The previously-defined-but-unpopulated `confidenceImpactLabel` / `confidenceImpactReason` slots on the Code Detection and Log Scans evidence cards (Spec 3 generic renderer is unchanged — it already conditionally renders the block).

**Critical scope constraints (apply to ALL task groups):**
- NO backend, gateway, discovery-service, or AMS code or schema changes.
- Persisted `candidate.confidence` is NOT mutated. `displayConfidence` is computed in the frontend and rendered in place.
- 7-column header preserved verbatim (`CANDIDATE_TABLE_COLUMN_COUNT` unchanged).
- `TierBadge.tsx` and `TierBadge.module.css` byte-identical (verify via `git diff`).
- `CandidateEvidenceSectionCard.tsx` byte-identical (verify via `git diff`).
- `candidateDetailsSupport.ts` allowlist unchanged.
- `runtimeEvidenceContextBuilder.ts` (Spec 6) unchanged — Spec 7 reuses its output from the existing memo.
- The `useMemo(() => buildRuntimeEvidenceContext(filteredCandidates), [filteredCandidates])` already established in `DiscoveryCandidateTable.tsx` by Spec 6 is REUSED — no second memo, no second pass over candidates. Both badge and confidence helpers are called per-row from the precomputed context (cheap O(1) Map lookups).
- All Spec 1-6 testid contracts preserved.
- NO new CSS module file — `RuntimeBadge` reuses TierBadge's variant tokens (`success` / `warning` / `caution` / `danger` / `neutral`).

## Task List

### Foundation Layer

#### Task Group 1: Thresholds, RuntimeBadge component, and runtime-badge presentation helpers
**Dependencies:** None

- [x] 1.0 Complete the foundation layer (constants, presentational badge, badge-helper module)
  - [x] 1.1 Write 2-8 focused tests for `RuntimeBadge` and `runtimeBadgeHelpers`
    - File: `frontend/src/components/DashboardView/__tests__/RuntimeBadge.test.tsx` (~3 tests)
      - Renders pill with the provided label text
      - Each variant token (`success` / `warning` / `caution` / `danger` / `neutral`) applies the matching TierBadge variant CSS class
      - Forwards `data-testid` to the rendered element
    - File: `frontend/src/components/DashboardView/__tests__/runtimeBadgeHelpers.test.ts` (~5 tests, pure unit, NO mocks)
      - `getRuntimeBadgeFor` returns null for unsupported candidate types regardless of context contents
      - Endpoint `observedUsageCount = 1842` → `{ label: "Observed 1.8k", variant: "success" }`
      - Endpoint `observedUsageCount = 1500` → `{ label: "High usage", variant: "success" }`
      - Endpoint `status5xxCount = 25` with high `observedUsageCount` → `{ label: "Elevated errors", variant: "warning" }` (precedence over usage labels)
      - Interface rollup `totalObservedCalls >= INTERFACE_HIGH_USAGE_THRESHOLD` → `{ label: "High usage", variant: "success" }`
    - Use Vitest with the standard CSS-module Proxy mock for the component test; pure-module test needs no mocks
    - Limit to 2-8 highly focused tests maximum; skip exhaustive variant/edge coverage
  - [x] 1.2 Create `frontend/src/components/DashboardView/runtimeBadgeThresholds.ts`
    - Compile-time constants only; no runtime tuning surface
    - Exports:
      - `HIGH_USAGE_ENDPOINT_THRESHOLD = 1000`
      - `MEDIUM_USAGE_ENDPOINT_THRESHOLD = 100`
      - `LOW_USAGE_ENDPOINT_THRESHOLD = 1`
      - `ELEVATED_5XX_COUNT_THRESHOLD = 10`
      - `ELEVATED_5XX_RATE_THRESHOLD = 0.01`
      - `INTERFACE_HIGH_USAGE_THRESHOLD = 1000` (used both for badge "High usage" rule and for the `+4` interface uplift rule in Group 2)
      - `MAX_LOG_CORROBORATED_CONFIDENCE = 99` (decimal `0.99`)
      - `MAX_LLM_LOG_ONLY_CONFIDENCE = 95` (decimal `0.95`)
  - [x] 1.3 Create `frontend/src/components/DashboardView/RuntimeBadge.tsx`
    - Pure presentational component; knows nothing about candidates or runtime context
    - Props: `{ label: string; variant: 'success' | 'warning' | 'caution' | 'danger' | 'neutral'; ['data-testid']?: string }`
    - Mirrors TierBadge's render shape (small pill `<span>` with variant-token CSS class)
    - Imports the EXISTING `TierBadge.module.css` to reuse its variant classes — DO NOT create a new CSS module file
    - When `label` is empty/whitespace, render nothing (defensive guard; not a runtime path)
  - [x] 1.4 Create `frontend/src/components/DashboardView/runtimeBadgeHelpers.ts`
    - Pure functions, no React, no API calls
    - Exports:
      - `hasAssociatedLogEvidence(candidate, runtimeEvidenceContext): boolean` — true iff supported candidate type AND a non-zero entry exists in the relevant context map (`byCandidateId` for endpoints, `interfaceRollupByCandidateId` for interfaces, `logicalDataEntityRollupByCandidateId` for `logical_data_entities`, `interfaceLogicalEntityRollupByCandidateId` for `interface_logical_entities`)
      - `getRuntimeBadgeFor(candidate, runtimeEvidenceContext): { label: string, variant: VariantToken } | null` — null when no badge should render
      - `getEvidenceSourceLabel(candidate, runtimeEvidenceContext): string` — informational helper for tests / future callers
    - Type gate: unsupported candidate types ALWAYS return `null` from `getRuntimeBadgeFor` (matches Spec 6: `endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities`)
    - Endpoint label rules (per spec):
      - `status5xxCount >= ELEVATED_5XX_COUNT_THRESHOLD` OR `status5xxCount / totalLogRequests >= ELEVATED_5XX_RATE_THRESHOLD` → `"Elevated errors"`, variant `warning` (PRECEDENCE over usage labels)
      - Else if `observedUsageCount >= HIGH_USAGE_ENDPOINT_THRESHOLD` → `"High usage"`, variant `success`
      - Else if `observedUsageCount > 0` → `"Observed {compact}"`, variant `success`
      - Else (or `noUsageObserved`, or no entry) → `null`
    - Interface / `logical_data_entities` / `interface_logical_entities` label rules:
      - `>= INTERFACE_HIGH_USAGE_THRESHOLD` → `"High usage"`, `success`
      - Else if observed count > 0 → `"Observed {compact}"`, `success`
      - Else → `null`
    - Compact-numeric formatting via `Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })` — `1842` → `"1.8k"`, `12430` → `"12k"`, `1234567` → `"1.2M"`
  - [x] 1.5 Ensure the foundation layer tests pass
    - Run ONLY the tests written in 1.1 (RuntimeBadge.test.tsx + runtimeBadgeHelpers.test.ts)
    - Verify constants are exported correctly, helpers return expected shapes, badge variants apply matching CSS classes
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- `runtimeBadgeThresholds.ts` exports all 8 constants with the exact values pinned in the spec
- `RuntimeBadge.tsx` is purely presentational, reuses `TierBadge.module.css` variants, NO new CSS module file added
- `runtimeBadgeHelpers.ts` exports `hasAssociatedLogEvidence`, `getRuntimeBadgeFor`, `getEvidenceSourceLabel`; all are pure functions
- Unsupported candidate types always return `null` from `getRuntimeBadgeFor`
- "Elevated errors" takes precedence over "High usage" / "Observed N" when 5xx threshold met
- Compact-numeric formatting matches `Intl.NumberFormat({ notation: 'compact', maximumFractionDigits: 1 })`
- `TierBadge.tsx` and `TierBadge.module.css` are byte-identical (verify via `git diff` — should show NO changes to those two files)

---

### Confidence Derivation Layer

#### Task Group 2: `displayConfidence.ts` pure module
**Dependencies:** Task Group 1 (consumes the threshold constants)

- [x] 2.0 Complete the display-confidence pure module
  - [x] 2.1 Write 2-8 focused tests for `displayConfidence`
    - File: `frontend/src/components/DashboardView/__tests__/displayConfidence.test.ts` (pure unit, NO mocks)
    - Limit to 2-8 highly focused tests maximum; cover ONLY critical uplift rules and the cap behaviour:
      - Null `candidate.confidence` → `displayConfidence: null`, `uplift: 0`, all label/reason fields are empty strings
      - Unsupported candidate type → `displayConfidence === baseConfidence`, `uplift: 0`
      - Adapter endpoint `observedUsageCount = 100` → `+4` uplift in percentage points
      - Adapter endpoint `observedUsageCount = 1000` capping: `baseConfidence = 0.97` → `displayConfidence = 0.99` (capped at `MAX_LOG_CORROBORATED_CONFIDENCE`)
      - LLM endpoint `observedUsageCount = 1` → `+5` uplift, capped at `MAX_LLM_LOG_ONLY_CONFIDENCE` (0.95)
      - Adapter endpoint `observedUsageCount = 0`, `status5xxCount = 50` → `+0` (4xx/5xx-only does NOT uplift)
      - Interface rollup `observedEndpointCount = 1, totalEndpointCount = 4` → `+2`
      - `interface_logical_entities` rollup with `(requestBodyUsageCount + responseBodyUsageCount) > 0` → `+2`
    - Skip exhaustive coverage of every rule branch; focus on the critical guardrails
  - [x] 2.2 Create `frontend/src/components/DashboardView/displayConfidence.ts`
    - Pure module, no React
    - Export: `getDisplayConfidence(candidate, runtimeEvidenceContext): { baseConfidence: number | null, displayConfidence: number | null, uplift: number, baseLabel: string, baseReason: string, upliftLabel: string, upliftReason: string }`
    - Inputs are computed in percentage points internally; output `baseConfidence` and `displayConfidence` retain the persisted decimal range (0..1) so the existing `Math.round(value * 100)` rendering in `DiscoveryCandidateTable.tsx` remains unchanged
    - Null-handling: when `candidate.confidence == null` → `baseConfidence = null`, `displayConfidence = null`, `uplift = 0`, all four label/reason fields are empty strings
    - Unsupported-type handling: `displayConfidence = baseConfidence`, `uplift = 0`, all label/reason fields empty
    - Per-type uplift rules (percentage points):
      - `endpoints` adapter (`_addedBy` ends with `-adapter`):
        - `observedUsageCount >= 1000` → `+5`
        - else `>= 100` → `+4`
        - else `>= 1` → `+3`
        - else → `0`
      - `endpoints` LLM (`_addedBy` starts with `llm-`):
        - `observedUsageCount >= 1` → `+5`
        - else → `0`
      - `interfaces` (highest applicable wins):
        - `(observedEndpointCount / totalEndpointCount) >= 0.75 AND totalObservedCalls >= INTERFACE_HIGH_USAGE_THRESHOLD` → `+4`
        - else `(observedEndpointCount / totalEndpointCount) >= 0.5` → `+3`
        - else `observedEndpointCount >= 1` → `+2`
        - else → `0`
      - `logical_data_entities`: `totalObservedCalls > 0` → `+1`; else `0`
      - `interface_logical_entities`:
        - `(requestBodyUsageCount + responseBodyUsageCount) > 0` → `+2`
        - else `unknownRoleUsageCount > 0` → `+1`
        - else → `0`
    - Cap rule: `displayConfidence = min(baseConfidence + uplift, cap)` where:
      - `cap = MAX_LLM_LOG_ONLY_CONFIDENCE` (0.95) when `_addedBy` starts with `llm-` AND no code evidence exists
      - else `cap = MAX_LOG_CORROBORATED_CONFIDENCE` (0.99)
    - Defensive guards (already-zero inputs from Spec 5):
      - `noUsageObserved` → uplift contribution is `0`
      - 4xx/5xx-only or pure-404 → `observedUsageCount` is already `0` per Spec 5's exclusion rule, so uplift is naturally `0` (defensive verification)
    - Persisted `candidate.confidence` is NEVER mutated; this module is pure-derivation only
    - Populate `baseLabel` / `baseReason` / `upliftLabel` / `upliftReason` strings for downstream Group 3 builders to consume; these are the source-of-truth wording for the per-section impact-block populations
  - [x] 2.3 Ensure the display-confidence tests pass
    - Run ONLY the tests written in 2.1
    - Verify uplift rules, caps, and zero-uplift defensive cases
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- `getDisplayConfidence` returns the exact return-shape pinned in the spec
- Caps applied correctly: 99% for log-corroborated; 95% for LLM-only with logs but no code evidence
- 4xx/5xx-only and pure-404 evidence produce ZERO uplift
- Persisted `candidate.confidence` is never mutated (input-only contract)
- Module is pure (no React, no side effects, no I/O)

---

### Builder Extension Layer

#### Task Group 3: Populate `confidenceImpactLabel` / `confidenceImpactReason` in code-detection and log-scans builders
**Dependencies:** Task Group 2 (consumes `getDisplayConfidence`)

- [x] 3.0 Extend the two existing evidence-section builders to populate the impact block ONLY when there is an actual log delta to explain
  - [x] 3.1 Write 2-8 focused tests for the builder extensions
    - Extend `frontend/src/components/DashboardView/__tests__/candidateEvidenceBuilder.test.ts` (or create co-located tests if cleaner) with ~6 additions; pure-module tests, NO mocks:
      - Code Detection: `displayConfidence === baseConfidence` → neither `confidenceImpactLabel` nor `confidenceImpactReason` is set on the returned section
      - Code Detection: `displayConfidence > baseConfidence` AND `_addedBy` ends with `-adapter` → `confidenceImpactLabel: "Base confidence"`, `confidenceImpactReason: "Deterministic code adapter evidence."`
      - Code Detection: same delta condition with `_addedBy = "llm-gap-fill"` → `confidenceImpactReason: "Initial LLM-derived confidence."`
      - Log Scans: `displayConfidence === baseConfidence` → impact fields remain unset
      - Log Scans: `endpoints` uplift case → `confidenceImpactLabel: "Confidence increased"`, `confidenceImpactReason: "Runtime logs observed 1,842 successful/redirect calls matching this candidate."` (verify thousand-separator formatting via `Intl.NumberFormat(undefined).format(n)`)
      - Log Scans: indirection-type uplift case (`interfaces` / `logical_data_entities` / `interface_logical_entities`) → `confidenceImpactReason: "Related endpoint runtime usage observed."`
    - Limit to 2-8 highly focused tests maximum
  - [x] 3.2 Extend `frontend/src/components/DashboardView/codeDetectionEvidenceBuilder.ts`
    - Population gate: ONLY when `displayConfidence > baseConfidence` (per resolved decision 4). When equal, leave both impact fields UNSET (existing renderer hides the block automatically)
    - When populated:
      - `confidenceImpactLabel: "Base confidence"`
      - `confidenceImpactReason: "Deterministic code adapter evidence."` when `_addedBy` ends with `-adapter`
      - `confidenceImpactReason: "Initial LLM-derived confidence."` when `_addedBy` starts with `llm-`
    - The builder needs access to `runtimeEvidenceContext` to invoke `getDisplayConfidence`; thread it through the same way Spec 6 already threads context (or re-derive `displayConfidence` inside this builder — pick the cleaner path, see 3.4)
  - [x] 3.3 Extend `frontend/src/components/DashboardView/logScansEvidenceBuilder.ts`
    - Population gate: ONLY when `displayConfidence > baseConfidence` for this candidate
    - When populated:
      - `confidenceImpactLabel: "Confidence increased"`
      - For `endpoints`: `confidenceImpactReason: "Runtime logs observed N successful/redirect calls matching this candidate."` where `N = observedUsageCount` formatted via `Intl.NumberFormat(undefined).format(n)` (matches Spec 6's `"1,842"` thousand-separator convention)
      - For `interfaces` / `logical_data_entities` / `interface_logical_entities`: `confidenceImpactReason: "Related endpoint runtime usage observed."`
    - Existing Spec 6 Log Scans rendering and the `"Log scan evidence was not found for this run."` fallback string are PRESERVED unchanged
  - [x] 3.4 Update `frontend/src/components/DashboardView/candidateEvidenceBuilder.ts` (Spec 3 orchestrator) to thread the derived `displayConfidence` info
    - Pick the cleaner path:
      - (a) Compute `displayConfidence` once in the orchestrator and pass a small derived field (e.g. `{ baseConfidence, displayConfidence, uplift }`) into each per-section builder, OR
      - (b) Re-derive `displayConfidence` inside each section builder by calling `getDisplayConfidence(candidate, runtimeEvidenceContext)` directly
    - Either approach is acceptable; document the choice in a code comment for future maintainers
    - The existing builder signature already accepts `runtimeEvidenceContext` (Spec 6) — this is the input both paths rely on
  - [x] 3.5 Verify `CandidateEvidenceSectionCard.tsx` is BYTE-IDENTICAL
    - Run `git diff frontend/src/components/DashboardView/CandidateEvidenceSectionCard.tsx` — must show NO changes
    - The generic renderer already conditionally renders the impact block when `confidenceImpactLabel` is populated; Spec 7 only fills in the data
  - [x] 3.6 Ensure the builder-extension tests pass
    - Run ONLY the tests written in 3.1
    - Verify both gating (no impact block when no delta) AND population (correct labels and reasons when delta exists)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Both `codeDetectionEvidenceBuilder` and `logScansEvidenceBuilder` populate `confidenceImpactLabel` / `confidenceImpactReason` ONLY when `displayConfidence > baseConfidence` (per resolved decision 4)
- When `displayConfidence === baseConfidence`, NEITHER builder sets the impact fields (existing renderer hides the block)
- Code Detection wording matches: `"Base confidence"` + `"Deterministic code adapter evidence."` (adapter) or `"Initial LLM-derived confidence."` (LLM)
- Log Scans wording matches: `"Confidence increased"` + `"Runtime logs observed N successful/redirect calls matching this candidate."` (endpoints, with thousand-separator) or `"Related endpoint runtime usage observed."` (indirection types)
- `CandidateEvidenceSectionCard.tsx` byte-identical (verify via `git diff` — NO changes)
- `runtimeEvidenceContextBuilder.ts` byte-identical (verify via `git diff` — NO changes)

---

### Wire-up Layer

#### Task Group 4: `DiscoveryCandidateTable.tsx` Tier and Confidence cell modifications
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Wire the new badge and confidence helpers into the candidate table's two affected cells
  - [x] 4.1 Write 2-8 focused tests for the table wire-up
    - File: `frontend/src/components/DashboardView/__tests__/discoveryCandidateTableRuntime.test.tsx` (~6 tests)
    - Use standard `ArchitectureContext` mock + Vitest CSS-module Proxy mock pattern
    - Tests:
      - Tier `<td>` for an adapter endpoint with `observedUsageCount = 1842` renders `<TierBadge>` AND a sibling `<RuntimeBadge label="Observed 1.8k" />` (both visible by `data-testid`)
      - Tier `<td>` for an adapter endpoint with no associated log evidence renders ONLY the existing `<TierBadge>` (no RuntimeBadge sibling); the row is byte-identical to the pre-Spec-7 Tier cell
      - Confidence `<td>`: `baseConfidence = 0.80` and `+5` uplift renders `85%` followed by a `<span data-testid="candidate-confidence-uplift">` containing `+5`
      - Confidence `<td>` capping: `baseConfidence = 0.97`, eligible `+5` → renders `99%` and `+2` in the uplift indicator (cap applied)
      - Unsupported candidate type: NO RuntimeBadge sibling AND `displayConfidence === baseConfidence` (no `+N` indicator rendered)
      - LLM-only endpoint with `observedUsageCount > 0`: `TierBadge('llm-solo')` + sibling `RuntimeBadge`; capped uplift up to `95%`
    - Limit to 2-8 highly focused tests maximum
  - [x] 4.2 Modify the Tier `<td>` body in `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`
    - Change from:
      - `<TierBadge addedBy={addedBy} data-testid="candidate-tier-badge" />`
    - To an inline cluster:
      - `<TierBadge addedBy={addedBy} data-testid="candidate-tier-badge" />`
      - followed by `<RuntimeBadge label={badge.label} variant={badge.variant} data-testid="candidate-runtime-badge" />` ONLY when `getRuntimeBadgeFor(candidate, runtimeEvidenceContext)` returns non-null
    - REUSE the existing `useMemo(() => buildRuntimeEvidenceContext(filteredCandidates), [filteredCandidates])` from Spec 6 — DO NOT add a second memo. Both badge and confidence helpers are called per-row from the precomputed context (cheap O(1) Map lookups)
  - [x] 4.3 Modify the Confidence `<td>` body in `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`
    - Read from `getDisplayConfidence(candidate, runtimeEvidenceContext).displayConfidence` instead of `candidate.confidence`
    - Render as `{Math.round(displayConfidence * 100)}%` for non-null, `"—"` for null (preserves existing rounding contract)
    - When `uplift > 0`, append a small adjacent `<span data-testid="candidate-confidence-uplift"> +{N}</span>` immediately after the percentage value (CSS sizes it down; no superscript markup)
    - PRESERVE the existing `data-testid="candidate-confidence-cell"` on the `<td>`
  - [x] 4.4 Verify the 7-column header is preserved verbatim
    - `CANDIDATE_TABLE_COLUMN_COUNT` constant unchanged (still 7)
    - `<thead>` order unchanged: `Name | Tier | Type | Confidence | Review Status | Synthesized At | Actions`
    - No new column added
  - [x] 4.5 Verify `TierBadge.tsx` is byte-identical
    - Run `git diff frontend/src/components/DashboardView/TierBadge.tsx` — must show NO changes
    - Run `git diff frontend/src/components/DashboardView/TierBadge.module.css` — must show NO changes
  - [x] 4.6 Ensure the wire-up tests pass
    - Run ONLY the tests written in 4.1
    - Verify both Tier `<td>` and Confidence `<td>` modifications render correctly across the six scenarios
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- Tier `<td>` renders `<TierBadge>` + optional `<RuntimeBadge>` sibling (the "+ LOGS" semantic is conveyed by the badge's PRESENCE per resolved decision 2; no separate "+LOGS" pill)
- Confidence `<td>` reads `displayConfidence` and shows the optional `+N` indicator when `uplift > 0`
- The existing Spec 6 `useMemo` is REUSED, not duplicated
- 7-column header preserved verbatim (no new column)
- `TierBadge.tsx` and `TierBadge.module.css` byte-identical (verify via `git diff`)
- All Spec 1-6 testids preserved (`candidate-tier-badge`, `candidate-confidence-cell`, `candidate-details-panel-{id}`, `candidate-details-row-{id}`, `code-detection-*`, `log-scans-*`, `llm-review-*`, `log-scans-field-{slug}`)

---

### Verification Layer

#### Task Group 5: End-to-end verification + non-regression sweep
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests, fill critical gaps only, and verify non-regression backstops
  - [x] 5.1 Review tests written in Task Groups 1-4
    - Group 1: ~3 RuntimeBadge component tests + ~5 runtimeBadgeHelpers tests
    - Group 2: ~6-8 displayConfidence tests
    - Group 3: ~6 builder-extension tests (impact block population gating)
    - Group 4: ~6 table wire-up integration tests
    - Total existing tests for Spec 7: approximately 26-28 tests
  - [x] 5.2 Analyze test-coverage gaps for THIS feature only
    - Identify any critical user-visible workflows NOT covered by Groups 1-4 tests
    - Focus ONLY on gaps related to Spec 7's display-layer behaviour
    - Do NOT assess entire application test coverage
    - Candidate gaps to consider (only add if genuinely needed):
      - Extension to `frontend/src/components/DashboardView/__tests__/candidateDetailsPanel.test.tsx`: panel with populated `runtimeEvidenceContext` for an `endpoints` candidate where `displayConfidence > baseConfidence` emits BOTH the Code Detection `Impact: Base confidence` block AND the Log Scans `Impact: Confidence increased` block
      - Same panel test where `displayConfidence === baseConfidence` does NOT emit any impact block (existing Spec 3 conditional-render behaviour)
      - End-to-end verification that the "Elevated errors" badge takes precedence over "High usage" / "Observed N" when 5xx threshold met (acceptance criterion 13)
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Add a maximum of 10 new tests to fill identified critical gaps
    - Focus on integration points (panel impact-block population) and end-to-end workflows
    - Do NOT write comprehensive coverage for all scenarios; skip edge cases, performance tests, and accessibility tests unless business-critical
    - If Group 1-4 coverage is sufficient, add ZERO additional tests (no padding)
  - [x] 5.4 Verify non-regression backstops continue to pass with NO assertion changes
    - `frontend/src/components/DashboardView/__tests__/candidateDetailsExpansion.test.tsx` (Spec 1) — three-column structure and testid contract preserved
    - `frontend/src/components/DashboardView/__tests__/candidateEvidenceSectionCard.test.tsx` (Spec 3) — generic renderer untouched
    - `frontend/src/components/DashboardView/__tests__/runtimeEvidenceContextBuilder.test.ts` (Spec 6) — context builder untouched
    - `frontend/src/components/DashboardView/__tests__/candidateReviewWorkflow.test.tsx` — review actions, table filtering, sorting, paging, expansion semantics untouched
    - `frontend/src/components/DashboardView/__tests__/codeDetectionMappers.test.ts` (Spec 2) — mapper untouched
    - The 7-column header assertion (gated by `CANDIDATE_TABLE_COLUMN_COUNT = 7`) unchanged
  - [x] 5.5 Run feature-specific tests only
    - Run ONLY tests related to Spec 7 (Groups 1-4 tests + any added in 5.3) PLUS the non-regression backstops listed in 5.4
    - Expected total: approximately 26-38 tests for the feature, plus the 5-6 backstop suites
    - Do NOT run the entire frontend test suite
    - Verify all critical workflows pass
  - [x] 5.6 Acceptance-criteria sweep
    - Walk the 21 acceptance criteria from `spec.md` and confirm each one is satisfied by the implementation:
      - 1-5: Supported types render compact RuntimeBadge labels with the right rollup source
      - 6: RuntimeBadge presence conveys "+ LOGS" semantic (no separate pill)
      - 7: Candidates without log evidence render the existing Tier cell unchanged
      - 8: Unsupported types receive no RuntimeBadge and no log-based confidence change
      - 9-10: Confidence uplift rules and 99%/95% caps applied correctly
      - 11-12: No log evidence and 404-only / 4xx/5xx-only do not reduce confidence
      - 13: 5xx evidence renders `Elevated errors` warning badge without reducing confidence
      - 14: Expanded panel renders BOTH impact blocks when (and only when) `displayConfidence > baseConfidence`
      - 15: Persisted `candidate.confidence` never mutated by Spec 7
      - 16-18: Approve / Reject / Defer, Show / Close Details, and existing Spec 6 Log Scans content unchanged
      - 19-20: No unmatched log-only observations in UI; no raw log files fetched/parsed by frontend
      - 21: Tests added/updated for sibling badge, runtime variants, confidence display, uplift caps, and impact-block population
  - [x] 5.7 Final byte-identical verification (`git diff` sweep)
    - `frontend/src/components/DashboardView/TierBadge.tsx` — NO changes
    - `frontend/src/components/DashboardView/TierBadge.module.css` — NO changes
    - `frontend/src/components/DashboardView/CandidateEvidenceSectionCard.tsx` — NO changes
    - `frontend/src/components/DashboardView/candidateDetailsSupport.ts` — NO changes
    - `frontend/src/components/DashboardView/runtimeEvidenceContextBuilder.ts` — NO changes
    - `discovery-service/`, `gateway/`, `architecture-model-service/` — NO changes (verify with `git status`)

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 26-38 tests total for Spec 7)
- All non-regression backstops listed in 5.4 pass with NO assertion changes
- All 21 acceptance criteria from `spec.md` verified
- No more than 10 additional tests added in 5.3 when filling testing gaps
- Testing focused exclusively on Spec 7's display-layer requirements
- All "byte-identical" files in 5.7 confirmed unchanged via `git diff`
- No backend, gateway, discovery-service, or AMS files modified (verify via `git status`)
- Persisted `candidate.confidence` is never mutated by Spec 7's code path

---

## Execution Order

Recommended implementation sequence (strict dependency order):

1. **Foundation Layer** (Task Group 1) — thresholds, RuntimeBadge component, runtime-badge presentation helpers. Self-contained; depends on nothing.
2. **Confidence Derivation Layer** (Task Group 2) — `displayConfidence.ts` pure module. Depends on Group 1's threshold constants only.
3. **Builder Extension Layer** (Task Group 3) — populate `confidenceImpactLabel` / `confidenceImpactReason` in code-detection and log-scans builders. Depends on Group 2's `getDisplayConfidence`.
4. **Wire-up Layer** (Task Group 4) — `DiscoveryCandidateTable.tsx` Tier and Confidence cell modifications. Depends on Groups 1, 2, 3 (uses the badge helpers, the display-confidence helper, and indirectly the builder-populated impact blocks via the existing panel renderer).
5. **Verification Layer** (Task Group 5) — end-to-end verification, gap-filling tests (max 10), non-regression sweep, acceptance-criteria walk, byte-identical `git diff` verification.
