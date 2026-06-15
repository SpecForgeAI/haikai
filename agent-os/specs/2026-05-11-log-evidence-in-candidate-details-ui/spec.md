# Specification: Log Evidence in Candidate Details UI

## Goal
Wire Spec 5's persisted runtime log evidence (per-candidate `logEnrichment.runtime` and run-level `steps_payload.v3.runtimeEvidence`) into the existing three-column Candidate Details Panel so the Log Scans column renders structured runtime evidence for the four supported candidate types (`endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities`). This is Spec 6 of a 7-spec roadmap and is frontend-only — no backend, gateway, or discovery-service changes.

## User Stories
- As a discovery reviewer, I want the Log Scans column to show real runtime evidence for endpoint candidates so that I can see which endpoints were actually exercised by uploaded logs and how they responded.
- As a discovery reviewer, I want interface and logical-data-entity rows to display rolled-up runtime relevance derived from related endpoints so that I can judge usage without manually correlating individual endpoint rows.
- As a frontend developer, I want all cross-candidate aggregation precomputed once at the table level so that per-row expansion remains responsive and per-section builders stay pure.

## Specific Requirements

**Scope summary**
- Frontend ONLY. NO backend, NO gateway, NO discovery-service code or schema changes.
- Spec 5's per-candidate `logEnrichment.runtime` and run-level `steps_payload.v3.runtimeEvidence` are consumed read-only via the existing AMS-passthrough payload paths.
- All cross-candidate rollups (interfaces, logical-data-entities, interface-logical-entities) are computed in the frontend from the candidate list it already has.
- No new backend endpoint, no Spec 5 amendment, no new persistence shape.

**Frontend DTO addition**
- Add `logEnrichment?: Record<string, unknown>` (wide outer envelope) to `DiscoveryCandidateDto` in `frontend/src/api/discoveryApi.ts`. Inside the per-section builders, the `runtime` sub-key is narrowed to a strict `LogEnrichmentRuntimeBlock`.
- `DiscoveryRunDto.steps_payload` already typed and arrives end-to-end; no change needed for the run-level summary.
- AMS uses snake_case JSON via `@JsonProperty`, but the JSONB blob inside `logEnrichment.runtime` is camelCase and passes through verbatim — frontend re-declares Spec 5's TS types directly without renaming.

**New evidence types (`candidateEvidenceTypes.ts` — additive)**
- Re-declare Spec 5's runtime types locally (no cross-service import): `MatchedRuntimeEvidence`, `NoUsageRuntimeEvidence`, `LogEnrichmentRuntimeBlock` (union of `{ matched: MatchedRuntimeEvidence }` or `NoUsageRuntimeEvidence`).
- New wrapper `RuntimeEvidenceForCandidate` carrying the candidate-type-specific evidence the per-section builder needs (varies by candidate type).
- New `RuntimeEvidenceContext`: `{ byCandidateId: Map<string, RuntimeEvidenceForCandidate>; interfaceRollupByCandidateId: Map<string, InterfaceRuntimeRollup>; logicalDataEntityRollupByCandidateId: Map<string, LogicalDataEntityRuntimeRollup>; interfaceLogicalEntityRollupByCandidateId: Map<string, InterfaceLogicalEntityRuntimeRollup> }`.
- Pin rollup interfaces: `InterfaceRuntimeRollup { totalObservedCalls, observedEndpointCount, totalEndpointCount, topEndpoints: Array<{method, pathTemplate, observedUsageCount}>, statusBreakdown, firstSeen?, lastSeen? }`; `LogicalDataEntityRuntimeRollup { totalObservedCalls, relatedEndpointCount, readLikeCount, writeLikeCount, firstSeen?, lastSeen? }`; `InterfaceLogicalEntityRuntimeRollup { supportingEndpointCount, requestBodyUsageCount, responseBodyUsageCount, unknownRoleUsageCount, totalObservedContractUsage, statusBreakdown?, firstSeen?, lastSeen? }`.

**New cross-candidate aggregator (`runtimeEvidenceContextBuilder.ts`)**
- Pure module under `frontend/src/components/DashboardView/` exporting `buildRuntimeEvidenceContext(candidates: DiscoveryCandidateDto[]): RuntimeEvidenceContext`.
- Single pass through the candidate list builds the per-candidate Map plus all three rollup maps.
- Interface rollup: collect `endpoints` candidates where `data.controllerClassName === thisInterface.data.className`; sum `observedUsageCount` across matched evidence; `observedEndpointCount` = related endpoints with matched evidence and `observedUsageCount > 0`; `totalEndpointCount` = total related regardless of evidence; `topEndpoints` = single endpoint with highest `observedUsageCount` (top 1).
- Logical-data-entity rollup: walk `interface_logical_entities` candidates where `data.logicalEntityName === thisEntity.data.className`; for each, derive related endpoints via `interfaceClassName ↔ controllerClassName`; aggregate matched evidence; read-like = sum of `observedUsageCount` where method ∈ {GET, HEAD, OPTIONS}; write-like = sum where method ∈ {POST, PUT, PATCH, DELETE}.
- Interface-logical-entity rollup: derive related endpoints via `interfaceClassName ↔ controllerClassName`; for each related endpoint with matched evidence, classify the candidate's `logicalEntityName` against `data.requestBodyType` (→ requestBodyUsageCount += observedUsageCount) and against `data.responseType ?? data.unwrappedReturnType ?? data.returnType` (→ responseBodyUsageCount += observedUsageCount). When matched evidence present but neither matches → unknownRoleUsageCount += observedUsageCount. Same endpoint may contribute to BOTH request and response buckets. supportingEndpointCount = count of related endpoints where matched evidence is present.

**Per-section builders (`candidateEvidenceBuilder.ts` — co-located)**
- Rewrite `buildLogScansEvidenceSection(candidate, runtimeEvidenceContext?)` to dispatch by `candidate.candidate_type` to four per-type builders:
  - `buildEndpointLogEvidenceSection` — direct attachment from `candidate.logEnrichment.runtime`.
  - `buildInterfaceLogEvidenceSection` — reads `interfaceRollupByCandidateId.get(candidate.id)`.
  - `buildLogicalDataEntityLogEvidenceSection` — reads `logicalDataEntityRollupByCandidateId.get(candidate.id)`.
  - `buildInterfaceLogicalEntityLogEvidenceSection` — reads `interfaceLogicalEntityRollupByCandidateId.get(candidate.id)`.
- Update `buildCandidateEvidenceDetails(candidate, runtimeEvidenceContext?: RuntimeEvidenceContext)` signature to thread the optional context through to the Log Scans builder. Code Detection and LLM Review builder calls unchanged.
- Single fallback string for all empty cases: `"Log scan evidence was not found for this run."` (replaces Spec 3's `"Log scan evidence is not available for this run."`).

**Per-section builder output wording (exact strings)**
- **endpoints (matched, observedUsageCount > 0)**: summary `"Observed {N} successful/redirect calls in supplied logs."`; field `Status codes` value `"2xx: N · 3xx: N · 4xx: N · 5xx: N"` (only classes with > 0 included); field `First seen` value `"YYYY-MM-DD"`; field `Last seen` value `"YYYY-MM-DD"`. Numbers formatted with `Intl.NumberFormat(undefined).format(n)`.
- **endpoints (noUsageObserved)**: summary `"No matching log observations in processed log window."`; status `available`.
- **interfaces (rollup populated)**: summary `"Related endpoints observed {N} successful/redirect calls."`; field `Observed endpoints` value `"M of N related endpoints."`; field `Top endpoint` value `"GET /owners/{ownerId} — {N} calls"` (top 1 only); field `Status codes` aggregate breakdown using same compact format; field `First seen` / `Last seen` across related endpoints.
- **logical_data_entities (rollup populated)**: summary `"Related endpoints observed {N} successful/redirect calls."`; field `Read-like traffic` value `"{N}"` (only if > 0); field `Write/change-like traffic` value `"{N}"` (only if > 0); field `First seen` / `Last seen` across related endpoints.
- **interface_logical_entities (rollup populated)**: summary `"This interface/data relationship is supported by {N} observed endpoints."`; fields in display order — `Request body usage` value `"{N} calls"` (only if > 0), `Response body usage` value `"{N} calls"` (only if > 0), `Unknown role usage` value `"{N} calls"` (only if > 0), `Total observed contract usage` value `"{N} successful/redirect calls"`. Hide a row if its count is zero.

**Status mapping**
- `logEnrichment.runtime.matched` present and `observedUsageCount > 0` → `status: 'available'`.
- `logEnrichment.runtime.noUsageObserved === true` → `status: 'available'` with summary `"No matching log observations in processed log window."` (zero observation IS evidence).
- Rollup has data but is incomplete (e.g. interface observed only 4 of 6 related endpoints) → `status: 'partial'` (using Spec 3's forward-compat status value).
- Supported candidate type but precomputed context has no entry → `status: 'not_available'`, summary `"Log scan evidence was not found for this run."`, `fields: []`.

**Panel data-flow seam**
- `<CandidateDetailsPanel>` gains a new `runtimeEvidenceContext: RuntimeEvidenceContext | undefined` prop (additive, optional). Internally passes the context into `buildCandidateEvidenceDetails(candidate, runtimeEvidenceContext)`.
- `DiscoveryCandidateTable` is the sole consumer responsible for building and memoizing the context: `useMemo(() => buildRuntimeEvidenceContext(candidates), [candidates])`. The context is rebuilt only when the candidate list reference changes, never per-row.
- Per-row render reads from the precomputed context; no per-row aggregation.
- Spec 3's "panel-builds internally" decision is superseded specifically for Log Scans cross-candidate rollups; per-candidate-only build for Code Detection (Spec 2/3 wiring) is preserved.

**LLM-created candidates with logs**
- The allowlist gate in `candidateDetailsSupport.ts` is type-based and unchanged. LLM-only `endpoints` candidates already pass.
- When an LLM-only candidate has `logEnrichment.runtime.matched` populated, the Log Scans section renders the matched evidence and the Code Detection section renders its existing empty-state line (`"Type-specific details: not available."`) via the renderer's `isMostlyEmpty` rule. No change required to `candidateDetailsSupport.ts` or `codeDetectionMappers.ts` / `codeDetectionEvidenceBuilder.ts`.

**Renderer contract (unchanged)**
- `CandidateEvidenceSectionCard.tsx` is generic and unchanged in this spec.
- Wrapper testid `log-scans-panel` preserved verbatim (Spec 1's expansion test asserts this).
- Per-field testids `log-scans-field-{slug}` emitted via existing `slugifyLabel` helper. Examples: `Status codes` → `log-scans-field-status-codes`; `Top endpoint` → `log-scans-field-top-endpoint`; `Read-like traffic` → `log-scans-field-read-like-traffic`.
- The renderer's `-empty` line gates on `fields.length === 0 && no sourceFiles && no reason && no summary`. Since Log Scans always carries a `summary`, the `log-scans-empty` testid will never fire (matches existing behaviour).

**Number and date formatting**
- Numbers: `Intl.NumberFormat(undefined).format(n)` for thousand-separators (matches the brief's `"1,842"` / `"12,430"` examples).
- Dates: `YYYY-MM-DD` format. Spec-writer note: grep the project for an existing date-formatting utility (e.g. `formatDate` already exists at `DiscoveryRunDetailView.tsx:140-146` using `toLocaleString`); for date-only output use `toLocaleDateString()` with the closest match, or slice the ISO timestamp (`iso.slice(0, 10)`) if no date-only utility exists.

## Visual Design

The `planning/visuals/` folder is empty for this spec. Visual reference is Spec 1's three-column expansion layout combined with Spec 3's normalized evidence card renderer — both preserved byte-identical by this spec for everything except the Log Scans column body. The Log Scans column now renders structured fields (summary line + per-field rows) instead of the static placeholder string.

## Existing Code to Leverage

**`frontend/src/components/DashboardView/codeDetectionEvidenceBuilder.ts` (Spec 3)**
- Pattern to mirror — thin pure adapter producing a `CandidateEvidenceSection` from a typed source. The four new per-type Log Scans builders follow the same shape: pure function in, `CandidateEvidenceSection` out, no React, no API calls.

**`frontend/src/components/DashboardView/candidateEvidenceBuilder.ts` (Spec 3)**
- Holds the existing `buildLogScansEvidenceSection(_candidate)` placeholder which is rewritten by this spec. Top-level `buildCandidateEvidenceDetails(candidate)` signature is extended additively to accept the optional `runtimeEvidenceContext`; existing call sites that omit it continue to compile and produce the fallback Log Scans section.

**`frontend/src/components/DashboardView/CandidateEvidenceSectionCard.tsx` (Spec 3)**
- Generic renderer consumed unchanged. Already emits `log-scans-panel` wrapper, summary body, per-field rows with `log-scans-field-{slug}` testids, and respects status styling.

**`frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx` (Spec 1)**
- Has `candidates` state available (used today for cross-candidate filters / parent-name lookup). Adds one `useMemo` to compute the runtime evidence context and threads it into the existing `<CandidateDetailsPanel candidate={candidate} runtimeEvidenceContext={ctx} />` call site.

**`frontend/src/components/DashboardView/candidateDetailsSupport.ts` (Spec 1)**
- Type-based allowlist (`endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities`) consumed unchanged. LLM-only candidates of supported types already expand today.

**Spec 5 persistence shape (`MatchedRuntimeEvidence` / `NoUsageRuntimeEvidence` / `LogEnrichmentRuntimeBlock`)**
- Re-declared verbatim in the frontend types module (the JSONB column passes camelCase through unchanged). Spec 5's per-candidate `logEnrichment.runtime` is the only data input for the endpoints builder; the three rollup builders consume it indirectly via the candidate list.

## Out of Scope

- Backend, gateway, or discovery-service code or schema changes (Spec 5 already persists everything needed).
- Confidence score recalculation, tier label changes, runtime badges (Spec 7).
- Display of unmatched log-only routes / observations not associated with a persisted candidate (intentionally suppressed; remains in run-level summary only for diagnostics).
- Raw log file fetching, viewing, or parsing in the frontend.
- LLM Review section content — remains the existing placeholder until a future spec.
- Show Details / Close Details, Approve / Reject / Defer behaviour, table filtering, sorting, paging.
- Adding or removing candidate types from the supported allowlist.
- Renaming any preserved testids (`code-detection-*`, `log-scans-*`, `llm-review-*`, `candidate-details-panel-{id}`, `candidate-details-row-{id}`).
- Code Detection section content — unchanged except for any incidental changes required to keep the evidence contract integration working.
- Promoting unmatched log routes to candidates, or any new "log-only routes" UI surface.

## Test Plan

**New file: `frontend/src/components/DashboardView/__tests__/runtimeEvidenceContextBuilder.test.ts`** (pure unit tests, 8-12 tests)
- Empty candidate list returns empty maps for all four context fields.
- Per-candidate map populates from `endpoints` candidates with `logEnrichment.runtime.matched`.
- Per-candidate map populates from `endpoints` candidates with `noUsageObserved`.
- Interface rollup aggregates related endpoints by `controllerClassName ↔ className` correctly (totals, observedEndpointCount vs totalEndpointCount, topEndpoint top-1 selection, aggregate status breakdown, first/last seen).
- Logical-data-entity rollup walks the `interface_logical_entities` chain correctly; read-like and write-like splits by HTTP method.
- Interface-logical-entity rollup derives request/response/unknown role buckets by classifying `logicalEntityName` against endpoint `requestBodyType` / `responseType` / `unwrappedReturnType` / `returnType`.
- Same endpoint contributes to BOTH request and response buckets when used in both positions.
- Defensive: missing `controllerClassName`, missing `requestBodyType`/`responseType`, mixed missing fields → graceful degradation (fall into Unknown role bucket; rollup still emits with zero counts where applicable).

**New / extended file: `frontend/src/components/DashboardView/__tests__/candidateEvidenceBuilder.test.ts`** (~8-10 new tests)
- `buildEndpointLogEvidenceSection` happy path: matched evidence with all status classes → summary + Status codes + First seen + Last seen fields with exact wording from the brief.
- `buildEndpointLogEvidenceSection` happy path: matched evidence with only some status classes → Status codes line includes only non-zero classes.
- `buildEndpointLogEvidenceSection` no-usage path: `noUsageObserved: true` → status `available`, summary `"No matching log observations in processed log window."`, no fields.
- `buildEndpointLogEvidenceSection` no context entry: `status: 'not_available'`, summary `"Log scan evidence was not found for this run."`, `fields: []`.
- `buildInterfaceLogEvidenceSection` happy path with rollup: summary `"Related endpoints observed N successful/redirect calls."`, Observed endpoints field `"M of N related endpoints."`, Top endpoint field `"METHOD /path — N calls"`, partial-rollup case sets `status: 'partial'`.
- `buildLogicalDataEntityLogEvidenceSection` happy path: summary `"Related endpoints observed N successful/redirect calls."`, read-like and write-like fields hidden when zero.
- `buildInterfaceLogicalEntityLogEvidenceSection` happy path: summary `"This interface/data relationship is supported by N observed endpoints."`, four fields in correct display order, zero-count rows hidden, Total observed contract usage always shown when supportingEndpointCount > 0.
- Update the existing test asserting the old placeholder string `"Log scan evidence is not available for this run."` to assert the new string `"Log scan evidence was not found for this run."`.

**Updated file: `frontend/src/components/DashboardView/__tests__/candidateDetailsPanel.test.tsx`**
- Update any assertion of the old placeholder string to the new string.
- Verify orchestrator still renders three cards with `code-detection-panel`, `log-scans-panel`, `llm-review-panel` testids unchanged.
- Add an integration test: panel rendered with a populated `runtimeEvidenceContext` for an `endpoints` candidate emits the expected `log-scans-field-status-codes`, `log-scans-field-first-seen`, `log-scans-field-last-seen` testids and exact summary text.
- Add an integration test: panel rendered for an LLM-only candidate (no Code Detection details, with `logEnrichment.runtime.matched`) renders Log Scans evidence AND Code Detection empty-state line.

**Updated file: `frontend/src/components/DashboardView/__tests__/candidateDetailsExpansion.test.tsx`**
- Must continue to pass with NO testid contract changes; update only if it asserts the old placeholder string.

**Non-regression backstops**
- `codeDetectionMappers.test.ts` (Spec 2 pure unit tests) — unchanged.
- `candidateEvidenceSectionCard.test.tsx` (Spec 3 renderer tests) — unchanged.
- `candidateReviewWorkflow.test.tsx` and any tests importing `DiscoveryCandidateTable` / `DiscoveryRunDetailView` — must continue to pass; minor mock additions allowed if new prop wiring requires it.
- Use Grep across `frontend/src/**/__tests__/` to find every assertion of the exact old placeholder string `"Log scan evidence is not available for this run."` — all must be updated to the new string in the same commit.

## Acceptance Criteria

1. The Log Scans column no longer always shows the old placeholder.
2. Endpoint candidates with associated runtime evidence render observed usage count.
3. Endpoint Log Scans renders compact status-code breakdown when available.
4. Endpoint Log Scans renders first seen and last seen when available.
5. Interface candidates render derived related-endpoint usage when available.
6. `logical_data_entities` candidates render `"Related endpoints observed N successful/redirect calls."` wording when available.
7. `interface_logical_entities` candidates render contract usage derived from request/response body endpoint calls.
8. Rows with no associated log evidence render exactly `"Log scan evidence was not found for this run."`.
9. Log evidence renders on a persisted LLM-created candidate when associated runtime evidence exists.
10. Unmatched log-only observations not associated with a persisted candidate are NOT shown in the candidate review UI.
11. Three section headings remain `Code Detection`, `Log Scans`, `LLM Review`.
12. Details panel still does not repeat row-level summary fields (name, tier, type, confidence, review status, synthesized timestamp).
13. Show Details / Close Details behaviour unchanged.
14. Approve / Reject / Defer behaviour unchanged.
15. Supported expandable candidate types remain `endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities`.
16. Unsupported candidate types remain non-expandable.
17. Confidence scores unchanged.
18. Tier labels unchanged.
19. Runtime badges not added.
20. LLM Review behaviour unchanged.
21. No raw log files fetched or parsed in the frontend.
22. Tests added/updated for endpoint, interface, logical_data_entity, and interface_logical_entity Log Scans rendering.

## Roadmap Context
Spec 6 of 7 in the discovery candidate evidence explainability roadmap: (1) Candidate Details Expansion UI, (2) Code Detection Detail Mappers, (3) Candidate Evidence Data Contract, (4) Runtime Log Input at Discovery Run Start, (5) Web Access Log Runtime Endpoint Evidence, (6) Log Evidence in Candidate Details UI [this spec], (7) Confidence, Tier, and Runtime Badges. Spec 7 will reuse the same `runtimeEvidenceContext` to compute confidence-impact labels.
