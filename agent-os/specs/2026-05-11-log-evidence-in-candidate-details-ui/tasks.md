# Task Breakdown: Log Evidence in Candidate Details UI

## Overview
Total Tasks: 5 task groups
Spec scope: **FRONTEND-ONLY**. NO backend, NO gateway, NO discovery-service code or schema changes. Spec 5's persistence (`logEnrichment.runtime` per candidate + `steps_payload.v3.runtimeEvidence` per run) is consumed read-only via existing AMS-passthrough payload paths.

## Task List

### Foundation Layer

#### Task Group 1: Types, DTO Field, and Placeholder String Update
**Dependencies:** None

- [x] 1.0 Complete foundation: type additions, DTO field, and placeholder string change
  - [x] 1.1 Write 2-8 focused tests for type/string foundation
    - Limit to 2-8 highly focused tests maximum
    - Test that `buildLogScansEvidenceSection` placeholder path now emits the new string `"Log scan evidence was not found for this run."` (replace any existing assertion of the old string in `candidateEvidenceBuilder.test.ts`)
    - Use Grep across `frontend/src/**/__tests__/` to find every assertion of the exact old string `"Log scan evidence is not available for this run."` and update each to the new string in the same commit
    - Skip exhaustive type-shape tests — TS compiler covers structural typing
  - [x] 1.2 Add `logEnrichment?: Record<string, unknown>` field to `DiscoveryCandidateDto` in `frontend/src/api/discoveryApi.ts`
    - Wide outer envelope (preserves existing Increment-14 keys without re-declaring)
    - Wire-format check confirmed: AMS exposes `@JsonProperty("log_enrichment")` and gateway proxies verbatim — field arrives but is not currently typed
    - Match existing convention: see how Spec 4 `LogFileMeta` is re-declared at `discoveryApi.ts:588-596`
    - DO NOT modify `DiscoveryRunDto.steps_payload` — already typed and arrives end-to-end
  - [x] 1.3 Add new evidence types to `frontend/src/components/DashboardView/candidateEvidenceTypes.ts`
    - `MatchedRuntimeEvidence` — re-declare Spec 5's shape verbatim (camelCase passes through JSONB unchanged)
    - `NoUsageRuntimeEvidence` — re-declare Spec 5's shape
    - `LogEnrichmentRuntimeBlock` — union of `{ matched: MatchedRuntimeEvidence }` or `NoUsageRuntimeEvidence`
    - `RuntimeEvidenceForCandidate` — wrapper carrying candidate-type-specific evidence the per-section builder needs
    - `InterfaceRuntimeRollup { totalObservedCalls, observedEndpointCount, totalEndpointCount, topEndpoints: Array<{method, pathTemplate, observedUsageCount}>, statusBreakdown, firstSeen?, lastSeen? }`
    - `LogicalDataEntityRuntimeRollup { totalObservedCalls, relatedEndpointCount, readLikeCount, writeLikeCount, firstSeen?, lastSeen? }`
    - `InterfaceLogicalEntityRuntimeRollup { supportingEndpointCount, requestBodyUsageCount, responseBodyUsageCount, unknownRoleUsageCount, totalObservedContractUsage, statusBreakdown?, firstSeen?, lastSeen? }`
    - `RuntimeEvidenceContext { byCandidateId: Map<string, RuntimeEvidenceForCandidate>; interfaceRollupByCandidateId: Map<string, InterfaceRuntimeRollup>; logicalDataEntityRollupByCandidateId: Map<string, LogicalDataEntityRuntimeRollup>; interfaceLogicalEntityRollupByCandidateId: Map<string, InterfaceLogicalEntityRuntimeRollup> }`
    - All additions must be additive — do NOT remove or reshape existing exports
  - [x] 1.4 Update placeholder string in `frontend/src/components/DashboardView/candidateEvidenceBuilder.ts`
    - Change `"Log scan evidence is not available for this run."` → `"Log scan evidence was not found for this run."`
    - Single fallback string for ALL no-evidence cases (no logs supplied, logs supplied but no row match, logs with other-row match)
    - Leave the placeholder builder body otherwise intact in this group — full rewrite happens in Group 4
  - [x] 1.5 Ensure foundation tests pass
    - Run ONLY the 2-8 tests written/updated in 1.1
    - Verify TypeScript compiles cleanly (`npm run build` or `tsc --noEmit` scoped to frontend)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- `DiscoveryCandidateDto` exposes `logEnrichment` field
- All seven new types/interfaces exported from `candidateEvidenceTypes.ts`
- Placeholder string updated everywhere (source + tests) in this commit
- TypeScript compiles cleanly with no new errors

---

### Cross-Candidate Aggregation Layer

#### Task Group 2: `runtimeEvidenceContextBuilder.ts` Pure Module
**Dependencies:** Task Group 1

- [x] 2.0 Build the cross-candidate aggregator
  - [x] 2.1 Write 2-8 focused tests for `runtimeEvidenceContextBuilder.ts`
    - Place in `frontend/src/components/DashboardView/__tests__/runtimeEvidenceContextBuilder.test.ts`
    - Vitest, NO mocks needed (pure module, no React, no API)
    - Limit to 2-8 highly focused tests maximum:
      - Empty candidate list returns empty maps for all four context fields
      - Per-candidate map populates from `endpoints` candidates with `logEnrichment.runtime.matched` AND with `noUsageObserved`
      - Interface rollup aggregates related endpoints by `controllerClassName ↔ className` (totals, observedEndpointCount vs totalEndpointCount, topEndpoint top-1 selection, status breakdown)
      - Logical-data-entity rollup walks the `interface_logical_entities` chain; read-like vs write-like split by HTTP method
      - Interface-logical-entity rollup classifies `logicalEntityName` against endpoint `requestBodyType` / `responseType` / `unwrappedReturnType` / `returnType`; same endpoint contributes to BOTH request and response buckets when applicable
    - Skip exhaustive edge cases — Group 4 wire-up tests will cover integration
  - [x] 2.2 Create `frontend/src/components/DashboardView/runtimeEvidenceContextBuilder.ts`
    - Export `buildRuntimeEvidenceContext(candidates: DiscoveryCandidateDto[]): RuntimeEvidenceContext`
    - Single pass through the candidate list builds the per-candidate Map plus all three rollup maps
    - Pure module — no React, no API, no side effects
  - [x] 2.3 Implement per-candidate map population
    - For each `endpoints` candidate with `logEnrichment.runtime`, set `byCandidateId[candidate.id] = { matched } | { noUsageObserved }`
    - Narrow the `Record<string, unknown>` envelope to the strict `LogEnrichmentRuntimeBlock` inside the builder
  - [x] 2.4 Implement interface rollup logic
    - For each `interfaces` candidate, collect `endpoints` candidates where `endpoint.data.controllerClassName === interface.data.className`
    - Sum `observedUsageCount` across matched evidence → `totalObservedCalls`
    - `observedEndpointCount` = related endpoints with matched evidence and `observedUsageCount > 0`
    - `totalEndpointCount` = total related regardless of evidence
    - `topEndpoints` = single endpoint with highest `observedUsageCount` (top 1 only)
    - Aggregate `statusBreakdown` (sum of 2xx/3xx/4xx/5xx counts)
    - `firstSeen` / `lastSeen` = min/max across related endpoints
  - [x] 2.5 Implement logical-data-entity rollup logic
    - For each `logical_data_entities` candidate, walk `interface_logical_entities` candidates where `data.logicalEntityName === entity.data.className`
    - For each such relationship, derive related endpoints via `interfaceClassName ↔ controllerClassName`
    - Aggregate matched evidence
    - `readLikeCount` = sum of `observedUsageCount` where endpoint method ∈ {GET, HEAD, OPTIONS}
    - `writeLikeCount` = sum where endpoint method ∈ {POST, PUT, PATCH, DELETE}
    - Track first/last seen across related endpoints
  - [x] 2.6 Implement interface-logical-entity rollup logic
    - For each `interface_logical_entities` candidate, derive related endpoints via `interfaceClassName ↔ controllerClassName`
    - For each related endpoint with matched evidence, classify the candidate's `logicalEntityName` against:
      - Endpoint `data.requestBodyType` → `requestBodyUsageCount += observedUsageCount`
      - Endpoint `data.responseType ?? data.unwrappedReturnType ?? data.returnType` → `responseBodyUsageCount += observedUsageCount`
    - When matched evidence present but neither matches → `unknownRoleUsageCount += observedUsageCount`
    - Same endpoint MAY contribute to BOTH request and response buckets
    - `supportingEndpointCount` = count of related endpoints where matched evidence is present
    - `totalObservedContractUsage` = sum across all three role buckets
  - [x] 2.7 Defensive handling for missing fields
    - Missing `controllerClassName`, `requestBodyType`, `responseType` → graceful degradation (fall into Unknown role bucket; rollup still emits with zero counts where applicable)
    - Non-Spring adapter case: all matching endpoints fall into "Unknown role" — acceptable degradation
  - [x] 2.8 Ensure aggregator tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- `buildRuntimeEvidenceContext` exported as pure function with no React/API dependencies
- All four cross-candidate maps computed in ONE pass through the candidate list
- Cross-reference logic matches Spring Boot adapter chain (`controllerClassName ↔ className ↔ interfaceClassName ↔ logicalEntityName`)
- Defensive degradation when adapter fields are missing

---

### Per-Section Builder Layer

#### Task Group 3: `logScansEvidenceBuilder.ts` Per-Type Builders
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Build the per-type Log Scans evidence builders
  - [x] 3.1 Write 2-8 focused tests for the per-type builders
    - Extend `frontend/src/components/DashboardView/__tests__/candidateEvidenceBuilder.test.ts`
    - Vitest, NO mocks needed (pure module)
    - Limit to 2-8 highly focused tests maximum:
      - `buildEndpointLogEvidenceSection` matched happy path: summary `"Observed {N} successful/redirect calls in supplied logs."`, Status codes line `"2xx: N · 3xx: N · 4xx: N · 5xx: N"` (only non-zero classes), First seen / Last seen as `YYYY-MM-DD`
      - `buildEndpointLogEvidenceSection` no-usage path: status `available`, summary `"No matching log observations in processed log window."`, no fields
      - `buildEndpointLogEvidenceSection` no context entry: status `not_available`, summary `"Log scan evidence was not found for this run."`, `fields: []`
      - `buildInterfaceLogEvidenceSection` happy path: summary `"Related endpoints observed N successful/redirect calls."`, Observed endpoints field `"M of N related endpoints."`, Top endpoint field `"METHOD /path — N calls"`; partial-rollup case sets `status: 'partial'`
      - `buildLogicalDataEntityLogEvidenceSection` happy path: summary wording, read-like / write-like fields hidden when zero
      - `buildInterfaceLogicalEntityLogEvidenceSection` happy path: summary, four fields in correct display order (Request body usage → Response body usage → Unknown role usage → Total observed contract usage), zero-count rows hidden, Total always shown when supportingEndpointCount > 0
    - Skip exhaustive variant coverage
  - [x] 3.2 Create `frontend/src/components/DashboardView/logScansEvidenceBuilder.ts`
    - Export top-level `buildLogScansEvidenceSection(candidate, runtimeEvidenceContext?)` that dispatches by `candidate.candidate_type`
    - Export four per-type builders: `buildEndpointLogEvidenceSection`, `buildInterfaceLogEvidenceSection`, `buildLogicalDataEntityLogEvidenceSection`, `buildInterfaceLogicalEntityLogEvidenceSection`
    - Each builder returns `CandidateEvidenceSection`
    - Pure module — mirror the shape of `codeDetectionEvidenceBuilder.ts`
  - [x] 3.3 Implement `buildEndpointLogEvidenceSection`
    - Read directly from `candidate.logEnrichment.runtime` (narrow envelope to `LogEnrichmentRuntimeBlock`)
    - **Matched, observedUsageCount > 0**: status `available`, summary `"Observed {N} successful/redirect calls in supplied logs."`, fields `Status codes` (compact line, only non-zero classes), `First seen` (YYYY-MM-DD), `Last seen` (YYYY-MM-DD)
    - **noUsageObserved**: status `available`, summary `"No matching log observations in processed log window."`, no fields
    - **No runtime block**: status `not_available`, summary `"Log scan evidence was not found for this run."`, `fields: []`
  - [x] 3.4 Implement `buildInterfaceLogEvidenceSection`
    - Read `runtimeEvidenceContext?.interfaceRollupByCandidateId.get(candidate.id)`
    - When rollup populated: summary `"Related endpoints observed {N} successful/redirect calls."`, fields `Observed endpoints` value `"M of N related endpoints."`, `Top endpoint` value `"GET /owners/{ownerId} — {N} calls"` (top 1), `Status codes` aggregate breakdown (compact format), `First seen` / `Last seen`
    - When `observedEndpointCount < totalEndpointCount` AND `observedEndpointCount > 0`: status `partial`
    - When `observedEndpointCount === totalEndpointCount` AND > 0: status `available`
    - When no rollup entry: status `not_available`, summary `"Log scan evidence was not found for this run."`, `fields: []`
  - [x] 3.5 Implement `buildLogicalDataEntityLogEvidenceSection`
    - Read `runtimeEvidenceContext?.logicalDataEntityRollupByCandidateId.get(candidate.id)`
    - When rollup populated: summary `"Related endpoints observed {N} successful/redirect calls."`, field `Read-like traffic` value `"{N}"` (only if > 0), field `Write/change-like traffic` value `"{N}"` (only if > 0), `First seen` / `Last seen`
    - Hide zero-count rows
    - Status mapping per same partial/available rules as interface
    - When no rollup entry: status `not_available`, summary `"Log scan evidence was not found for this run."`, `fields: []`
  - [x] 3.6 Implement `buildInterfaceLogicalEntityLogEvidenceSection`
    - Read `runtimeEvidenceContext?.interfaceLogicalEntityRollupByCandidateId.get(candidate.id)`
    - When rollup populated: summary `"This interface/data relationship is supported by {N} observed endpoints."`
    - Fields in display order: `Request body usage` `"{N} calls"` (only if > 0), `Response body usage` `"{N} calls"` (only if > 0), `Unknown role usage` `"{N} calls"` (only if > 0), `Total observed contract usage` `"{N} successful/redirect calls"` (always shown when `supportingEndpointCount > 0`)
    - When no rollup entry: status `not_available`, summary `"Log scan evidence was not found for this run."`, `fields: []`
  - [x] 3.7 Number and date formatting helpers
    - Numbers: `Intl.NumberFormat(undefined).format(n)` for thousand-separators (matches brief's `"1,842"` / `"12,430"` examples)
    - Dates: `YYYY-MM-DD` format. Grep project for an existing utility (`formatDate` exists at `DiscoveryRunDetailView.tsx:140-146` using `toLocaleString`); for date-only output use `toLocaleDateString()` or slice ISO timestamp (`iso.slice(0, 10)`) if no date-only utility exists
    - Read-like methods: GET, HEAD, OPTIONS. Write/change-like methods: POST, PUT, PATCH, DELETE
  - [x] 3.8 Verify renderer contract preservation
    - Per-field testids `log-scans-field-{slug}` emitted via existing `slugifyLabel` helper unchanged
    - Examples to verify: `Status codes` → `log-scans-field-status-codes`; `Top endpoint` → `log-scans-field-top-endpoint`; `Read-like traffic` → `log-scans-field-read-like-traffic`
    - Wrapper testid `log-scans-panel` preserved verbatim
    - The `-empty` testid still gates on the renderer's existing rule (no fields, no sourceFiles, no reason, no summary). Since Log Scans always carries a `summary`, the `-empty` testid will never fire for Log Scans (matches existing behaviour from Spec 3)
    - DO NOT change `CandidateEvidenceSectionCard.tsx` — generic renderer is unchanged
  - [x] 3.9 Ensure per-type builder tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- All four per-type builders return correctly-shaped `CandidateEvidenceSection`
- Exact summary/field wording matches spec brief
- Status mapping respects available / partial / not_available rules
- Zero-count rows hidden per display rules
- `CandidateEvidenceSectionCard.tsx` UNCHANGED

---

### Wire-Up Layer

#### Task Group 4: Orchestrator and Table Wire-Up
**Dependencies:** Task Groups 1, 2, and 3

- [x] 4.0 Wire the new builders into the orchestrator and table
  - [x] 4.1 Write 2-8 focused tests for orchestrator wire-up
    - Extend `frontend/src/components/DashboardView/__tests__/candidateDetailsPanel.test.tsx`
    - Vitest with existing `ArchitectureContext` mock pattern; CSS-module Proxy mock as standard
    - Limit to 2-8 highly focused tests maximum:
      - Panel rendered with a populated `runtimeEvidenceContext` for an `endpoints` candidate emits expected `log-scans-field-status-codes`, `log-scans-field-first-seen`, `log-scans-field-last-seen` testids and exact summary text
      - Panel rendered for an LLM-only candidate (no Code Detection details, with `logEnrichment.runtime.matched`) renders Log Scans evidence AND Code Detection empty-state line
      - Orchestrator still renders three cards with `code-detection-panel`, `log-scans-panel`, `llm-review-panel` testids unchanged
    - Skip exhaustive coverage of all candidate types — Group 3 builder tests cover those
  - [x] 4.2 Modify `frontend/src/components/DashboardView/candidateEvidenceBuilder.ts`
    - Update `buildCandidateEvidenceDetails(candidate, runtimeEvidenceContext?: RuntimeEvidenceContext)` signature — add optional second arg
    - Thread the context into `buildLogScansEvidenceSection(candidate, runtimeEvidenceContext)`
    - Remove the old inline `buildLogScansEvidenceSection` (placeholder version); import the new one from `logScansEvidenceBuilder.ts`
    - Code Detection and LLM Review builder calls UNCHANGED
    - Existing call sites that omit the second arg continue to compile and produce the fallback Log Scans section
  - [x] 4.3 Modify `frontend/src/components/DashboardView/CandidateDetailsPanel.tsx`
    - Add new optional prop: `runtimeEvidenceContext?: RuntimeEvidenceContext`
    - Thread through to `buildCandidateEvidenceDetails(candidate, runtimeEvidenceContext)`
    - DO NOT change the three-card layout or any existing prop wiring
  - [x] 4.4 Modify `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`
    - Add `useMemo(() => buildRuntimeEvidenceContext(filteredCandidates), [filteredCandidates])` near where `candidates` / `filteredCandidates` is in scope
    - Pass to `<CandidateDetailsPanel>` via the new `runtimeEvidenceContext` prop
    - Single `useMemo` only — context rebuilt only when candidate list reference changes, never per-row
    - Per-render reads from the precomputed context — NO per-row aggregation
  - [x] 4.5 Verify allowlist gate is unchanged
    - DO NOT modify `frontend/src/components/DashboardView/candidateDetailsSupport.ts`
    - LLM-only candidates of supported types remain expandable today via the type-based gate
  - [x] 4.6 Ensure wire-up tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- `<CandidateDetailsPanel>` accepts and threads `runtimeEvidenceContext` prop
- `DiscoveryCandidateTable` builds context exactly once via `useMemo`
- Three-card orchestrator layout unchanged
- All preserved testids (`code-detection-*`, `log-scans-*`, `llm-review-*`, `candidate-details-panel-{id}`, `candidate-details-row-{id}`) remain verbatim
- `candidateDetailsSupport.ts` allowlist UNCHANGED
- `CandidateEvidenceSectionCard.tsx` UNCHANGED

---

### End-to-End Verification

#### Task Group 5: Test Review, Gap Analysis, and Non-Regression
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests, fill critical gaps, verify non-regression
  - [x] 5.1 Review tests written in Task Groups 1-4
    - Review the 2-8 tests written in Group 1 (foundation/string update)
    - Review the 2-8 tests written in Group 2 (`runtimeEvidenceContextBuilder`)
    - Review the 2-8 tests written in Group 3 (per-type builders)
    - Review the 2-8 tests written in Group 4 (panel/orchestrator wire-up)
    - Total existing Spec 6 tests: approximately 8-32 tests
  - [x] 5.2 Analyze test coverage gaps for Spec 6 only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to Spec 6's feature requirements
    - Prioritize end-to-end workflows over unit test gaps
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 10 additional strategic tests maximum (only if needed)
    - Add maximum of 10 new tests to fill identified critical gaps
    - Likely candidates:
      - Defensive: same endpoint contributing to BOTH request and response buckets in `interface_logical_entities` rollup
      - Defensive: missing `controllerClassName` / missing `requestBodyType` / `responseType` graceful degradation (Unknown role bucket)
      - Defensive: mixed candidate types in one list still produces correct rollups
      - Integration: `DiscoveryCandidateTable` produces context exactly once per candidate-list reference change
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 5.4 Update remaining placeholder string assertions if Group 1 missed any
    - Re-run Grep across `frontend/src/**/__tests__/` for the exact old string `"Log scan evidence is not available for this run."`
    - Update `candidateDetailsExpansion.test.tsx` and `candidateDetailsPanel.test.tsx` if they assert the string and were not fully handled in Group 1
  - [x] 5.5 Run Spec 6 feature-specific tests
    - Run ONLY tests related to Spec 6 (`runtimeEvidenceContextBuilder.test.ts`, `candidateEvidenceBuilder.test.ts`, `candidateDetailsPanel.test.tsx`, `candidateDetailsExpansion.test.tsx`, plus any Group 5.3 additions)
    - Expected total: approximately 16-42 tests
    - Verify critical workflows pass
  - [x] 5.6 Run Spec 1-3 non-regression backstops
    - `codeDetectionMappers.test.ts` (Spec 2 pure unit tests) — must pass unchanged
    - `candidateEvidenceSectionCard.test.tsx` (Spec 3 renderer tests) — must pass unchanged
    - `candidateReviewWorkflow.test.tsx` and any tests importing `DiscoveryCandidateTable` / `DiscoveryRunDetailView` — must continue to pass; minor mock additions allowed if new prop wiring requires it
    - All Spec 1-2 testid contracts (`code-detection-*`, `log-scans-*`, `llm-review-*`) preserved
  - [x] 5.7 Verify acceptance criteria 1-22 from spec
    - Walk the 22 acceptance criteria from `spec.md`
    - Confirm each is met by the completed implementation

**Acceptance Criteria:**
- All Spec 6 feature-specific tests pass (approximately 16-42 tests total)
- Critical user workflows for Spec 6 are covered
- No more than 10 additional tests added when filling gaps
- Spec 1-3 non-regression backstops pass with zero changes to their assertions (other than the placeholder string update)
- All 22 spec acceptance criteria verified
- NO backend, gateway, or discovery-service code modified
- `CandidateEvidenceSectionCard.tsx` UNCHANGED
- `candidateDetailsSupport.ts` UNCHANGED
- `codeDetectionMappers.ts` (Spec 2) UNCHANGED
- `codeDetectionEvidenceBuilder.ts` (Spec 3) UNCHANGED

---

## Critical Constraints (apply across all task groups)

- **NO backend, NO gateway, NO discovery-service code or schema changes.** Spec 5's persistence is consumed read-only.
- Per-candidate `logEnrichment.runtime` is read-only — no writes from the frontend.
- `CandidateEvidenceSectionCard.tsx` is the generic renderer — NO changes.
- `candidateDetailsSupport.ts` allowlist UNCHANGED — LLM-only candidates of supported types are already expandable today.
- The `log-scans-panel` testid + the renderer's per-field-slug pattern are preserved verbatim.
- The `-empty` testid still gates on the renderer's existing rule (no fields, no sourceFiles, no reason, no summary). Since Log Scans always carries a `summary`, the `-empty` testid will never fire for Log Scans (matches existing behaviour from Spec 3).
- Numeric formatting via `Intl.NumberFormat(undefined).format(n)`. Date formatting via `YYYY-MM-DD` (slice-to-date or `toLocaleDateString()` — grep for existing utility before deciding).
- Single-string fallback `"Log scan evidence was not found for this run."` used for ALL no-evidence cases (no logs, logs but no row match, logs with other-row match).
- All four candidate-type rollups computed in ONE pass through the candidate list inside `runtimeEvidenceContextBuilder.ts` — single `useMemo` in `DiscoveryCandidateTable`.
- Per-render reads from the precomputed context — NO per-row aggregation.
- Status mapping: `available` when matched evidence present with observed > 0; `available` when noUsageObserved (zero IS evidence); `partial` when rollup data is incomplete (e.g. interface observed only some related endpoints); `not_available` only when the precomputed context has no entry for this candidate.
- Cross-reference logic for derivation:
  - **interfaces ← endpoints:** match interface `data.className` to endpoint `data.controllerClassName`
  - **interface_logical_entities ← endpoints:** chain via `interfaceClassName ↔ controllerClassName`; role derived from endpoint `data.requestBodyType` and `data.responseType ?? data.unwrappedReturnType ?? data.returnType`
  - **logical_data_entities ← interface_logical_entities ← endpoints:** chain via `logicalEntityName ↔ interfaceClassName ↔ controller class ↔ endpoints`
- Read-like methods: GET, HEAD, OPTIONS. Write/change-like methods: POST, PUT, PATCH, DELETE.

## Files Explicitly UNCHANGED

- `frontend/src/components/DashboardView/CandidateEvidenceSectionCard.tsx`
- `frontend/src/components/DashboardView/candidateDetailsSupport.ts`
- `frontend/src/components/DashboardView/codeDetectionMappers.ts`
- `frontend/src/components/DashboardView/codeDetectionEvidenceBuilder.ts`
- All Spec 1-2 testid contracts (`code-detection-*`, `log-scans-*`, `llm-review-*`)
- The orchestrator's three-card layout
- All non-frontend code (`discovery-service/`, `gateway/`, `architecture-model-service/`)

## Execution Order

Recommended implementation sequence:
1. Task Group 1 — Foundation: types + DTO field + placeholder string update
2. Task Group 2 — `runtimeEvidenceContextBuilder.ts` cross-candidate aggregator + pure unit tests
3. Task Group 3 — `logScansEvidenceBuilder.ts` per-type builders + pure unit tests
4. Task Group 4 — Wire-up: `candidateEvidenceBuilder.ts`, `CandidateDetailsPanel.tsx`, `DiscoveryCandidateTable.tsx`
5. Task Group 5 — End-to-end verification + non-regression backstops
