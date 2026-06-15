# Shaping Notes — Spec 6: Log Evidence in Candidate Details UI

Date: 2026-05-11
Spec: `agent-os/specs/2026-05-11-log-evidence-in-candidate-details-ui/`

This spec is FRONTEND-ONLY. Spec 5 already persists per-candidate runtime
evidence at `DiscoveryCandidate.logEnrichment.runtime` (additive on the
existing Increment-14 keys) and run-level summary at
`steps_payload.v3.runtimeEvidence`. This spec wires that into the existing
3-column Candidate Details Panel (Specs 1-3).

---

## 1. Current state of the frontend evidence system

| Module | Path | Role in Spec 6 |
|---|---|---|
| `candidateEvidenceTypes.ts` | `frontend/src/components/DashboardView/` | Contract — `CandidateEvidenceSection` shape Spec 6 must produce. Already supports `status: 'partial'` per Spec 3 §7 (forward-compatible — Spec 6 will populate it). |
| `candidateEvidenceBuilder.ts` | same | Holds `buildLogScansEvidenceSection(_candidate)` placeholder. Spec 6 will rewrite. Currently returns `{ title: 'Log Scans', status: 'not_available', summary: 'Log scan evidence is not available for this run.', fields: [] }`. |
| `codeDetectionEvidenceBuilder.ts` | same | Pattern to mirror — thin adapter producing a `CandidateEvidenceSection`. |
| `CandidateEvidenceSectionCard.tsx` | same | Renderer. UNCHANGED in Spec 6. Reuses Spec 3 layout (`reason`, `summary`, `fields`, `notes`). |
| `CandidateDetailsPanel.tsx` | same | Orchestrator. Currently signature: `({ candidate })`. Calls `buildCandidateEvidenceDetails(candidate)`. Spec 6 needs to thread runtime-evidence context here OR keep panel internal. |
| `DiscoveryCandidateTable.tsx` | same | Owns `<CandidateDetailsPanel candidate={candidate} />` render at line 473. Has `candidates` state already (used for cross-candidate filters / parent-name lookup). |
| `DiscoveryRunDetailView.tsx` | same | Owns the run + candidate fetches. Already calls `getDiscoveryRun()` and `getDiscoveryCandidates()`. Run's `steps_payload` already lands here (used for the phase list). |
| `candidateDetailsSupport.ts` | same | Allowlist gate `supportsDetails(type)` for the 4 supported types. Spec 6 does NOT need to change this — LLM-created `endpoints` candidates already pass the gate (the gate is type-based, not source-based). |

**Key observation on Spec 3's "panel-builds internally" decision:** Spec 3
deliberately gave `<CandidateDetailsPanel>` a `candidate`-only signature
because, at the time, ALL evidence came from per-candidate `data.*` fields.
Spec 6 changes the calculus for interfaces / logical_data_entities /
interface_logical_entities — those derivations need to look at OTHER
candidates' runtime evidence, which the panel cannot do without either
(a) being passed the candidate list, (b) being passed a precomputed
`Map<candidateId, RuntimeEvidenceForCandidate>`, or (c) walking the full
`candidates` list itself (which it doesn't have).

---

## 2. Wire-format check — does the data actually arrive at the frontend today?

### `logEnrichment` per candidate
- AMS DTO `DiscoveryCandidateDto.java` line 89: `@JsonProperty("log_enrichment") Map<String, Object> logEnrichment` — **YES, exposed**.
- Gateway proxy at `gateway/src/routes/discovery.ts:733-821` for `/runs/:runId/candidates`: verbatim pass-through (`responseBody = await response.json(); return res.status(...).json(responseBody)`). No field stripping.
- Frontend `DiscoveryCandidateDto` interface at `discoveryApi.ts:115-130`: **does NOT enumerate `log_enrichment`**. The field arrives in the JSON payload but isn't typed.
- Spec 6 must add `log_enrichment?: Record<string, unknown>` (or a stricter typed shape mirroring Spec 5's `LogEnrichmentRuntimeBlock`) to the frontend DTO.

### `steps_payload.v3.runtimeEvidence` per run
- AMS DTO `DiscoveryRunDto.java` line 72: `@JsonProperty("steps_payload") Map<String, Object> stepsPayload` — **YES, exposed**.
- Gateway proxy: same verbatim pattern.
- Frontend `DiscoveryRunDto` interface at `discoveryApi.ts:81-96`: already has `steps_payload: Record<string, unknown> | null` — **typed and arrives**. The phase list at `DiscoveryRunDetailView.tsx:449-462` already iterates over it.
- Spec 6 can read `selectedRun.steps_payload?.v3?.runtimeEvidence` directly. No API change needed.

### Casing
- AMS uses snake_case JSON via `@JsonProperty` (`log_enrichment`, `steps_payload`, `source_cluster_ids`) — frontend DTOs already match this convention.
- INSIDE `data` and inside `logEnrichment.runtime`, Spec 5 uses camelCase (matching its TypeScript interface exactly: `observedUsageCount`, `status2xxCount`, `firstSeen`, `topStatusCodes`, `matchConfidence`, etc.). The JSONB column passes these through verbatim, so the frontend will see camelCase inside the runtime block — convenient because Spec 6 can re-declare the Spec 5 types directly without renaming.

---

## 3. Derivation feasibility per candidate type

### endpoints — direct attachment
- `candidate.log_enrichment.runtime.matched: MatchedRuntimeEvidence` OR `{ noUsageObserved: true, ... }`.
- All required fields available: `observedUsageCount`, `status2xx/3xx/4xx/5xxCount`, `firstSeen`, `lastSeen`, `sourceLogFileCount`, `matchConfidence`, `matchReason`, `totalLogRequests`.
- **Feasible: 100%.** Trivial mapping.

### interfaces — derive from related endpoints
- Cross-ref field: endpoints carry `data.controllerClassName`; interfaces carry `data.className`. Spring Boot adapter at line 600 confirms this.
- For an interface candidate `i`, find endpoints `e` where `e.data.controllerClassName === i.data.className` (also fall back to `e.data.interfaceClassName === i.data.className` if some adapters use that name).
- Aggregate: sum `observedUsageCount` across matched endpoints, count endpoints with/without runtime evidence, top endpoints, status code totals, min(firstSeen) / max(lastSeen).
- **Feasible: high.** Needs a memoized lookup `Map<className, EndpointAggregateRuntime>` built once per candidate list.
- **Caveat:** non-Spring adapters (Angular, React, etc.) may use different field names for "owning interface". Out of scope for this spec — if the field isn't present, the interface simply has no derivable runtime, which renders the fallback string. No regression.

### logical_data_entities — derive via interface_logical_entities relationships
- Cross-ref: walk the `interface_logical_entities` candidate list; find entries where `data.logicalEntityName === entity.data.className`. Each entry's `data.interfaceClassName` points at an interface; recursively use the interface→endpoints map from above.
- Or shorter: pre-build `Map<logicalEntityName, EndpointAggregateRuntime>` by walking interface_logical_entities once.
- Read-like vs write-like split: HTTP methods come from each contributing endpoint's `data.httpMethod`. GET/HEAD/OPTIONS = read-like; POST/PUT/PATCH/DELETE = write-like. The matched `MatchedRuntimeEvidence` doesn't break observed counts down by method, but `data.httpMethod` is on the candidate. So per endpoint we know "this endpoint is a read or a write" and can attribute its `observedUsageCount` to the correct bucket. **Feasible.**
- **Feasible: high** for the totals + method-class split.

### interface_logical_entities — derive from supporting endpoints
- Cross-ref: find endpoints `e` where `e.data.controllerClassName === ile.data.interfaceClassName` AND (`e.data.requestBodyType === ile.data.logicalEntityName` OR `e.data.responseType === ile.data.logicalEntityName`).
- Role split:
  - **Request body usage** = sum `observedUsageCount` over endpoints where `e.data.requestBodyType === logicalEntityName`.
  - **Response body usage** = sum `observedUsageCount` over endpoints where `e.data.responseType === logicalEntityName`.
  - **Unknown role** = endpoints where the relationship exists but neither request nor response body matches (defensive — should be rare given the adapter emits the relationship from those exact two fields).
- The Spring Boot adapter at line 1075-1094 emits one `interface_logical_entities` row per `(controller, dto)` pair, where the dto is in `controllerToDtos` (which is populated from BOTH `requestBodyType` and `responseType` at lines 659-667). So every emitted relationship CAN be traced back to a request and/or response role on the endpoint side — **role is derivable on the frontend** even though it's not stored on the relationship candidate itself.
- **Feasible: high** — but this is a non-trivial derivation and is the part of Spec 6 with the most implementation surface area.
- **Caveat:** non-Spring adapters may not populate `data.requestBodyType` or `data.responseType` on endpoint candidates. In that case, all matching endpoints fall into "Unknown role". Acceptable degradation.

---

## 4. Decisions made autonomously (low-stakes)

These are implementation calls that don't need user input:

1. **Re-declare Spec 5 types on the frontend** (don't try to import from `discovery-service`). Cross-service TypeScript imports aren't set up in this monorepo (the discovery-service is a separate `tsconfig`/build target). Re-declaring `MatchedRuntimeEvidence` / `NoUsageRuntimeEvidence` / `LogEnrichmentRuntimeBlock` / `RuntimeEvidenceRunSummary` in `frontend/src/components/DashboardView/runtimeEvidenceTypes.ts` (or co-located with `candidateEvidenceTypes.ts`) is the conventional approach, matching how the existing Spec 4 `LogFileMeta` is re-declared in `discoveryApi.ts:588-596`.
2. **Add `log_enrichment?: Record<string, unknown>` to `DiscoveryCandidateDto`** in `discoveryApi.ts`. Wide type for the outer envelope (preserves the existing Increment-14 `enriched/logAtomCount/signalSummary` keys without re-declaring them). Inside the builder, narrow to a strict `LogEnrichmentRuntimeBlock` for `runtime`.
3. **Builder shape:** follow `codeDetectionEvidenceBuilder.ts` — pure module, one dispatch function `buildLogScansEvidenceSection(candidate, ctx)` plus four per-type builders. Place all under `frontend/src/components/DashboardView/`.
4. **Memoize the derivation context** at the table level via `useMemo(() => buildRuntimeEvidenceContext(candidates), [candidates])`. The context is a small struct holding the four pre-indexed maps (interface→endpoints, logicalEntity→endpoints, etc.).
5. **Number formatting:** `Intl.NumberFormat(undefined).format(n)` for thousand-separators (matches no existing project convention since the existing code uses `.toFixed(0)` / `.toLocaleString()` ad-hoc).
6. **Date formatting:** `new Date(iso).toLocaleDateString()` for first-seen / last-seen (matches `formatDate` at `DiscoveryRunDetailView.tsx:140-146`, which uses `toLocaleString()` — for dates-only the spec wants `2026-04-01` style, so `toLocaleDateString()` is the closer fit).
7. **Status-code formatting:** Single line `Status codes: 2xx: N · 3xx: N · 4xx: N · 5xx: N` — drop classes whose count is `0` per the spec's "only include status classes that are available" rule.
8. **Update the Spec 3 placeholder string:** the spec explicitly changes "Log scan evidence is not available for this run." → "Log scan evidence was not found for this run." This is a user-confirmation candidate (Q4 below) — flagged because Spec 3 has a test asserting the exact old string.
9. **`partial` vs `available` status:** use `available` when at least one populated field landed; use `not_available` when no runtime block exists or the no-usage block applies; reserve `partial` for the rollup cases where SOME related endpoints have evidence and SOME don't (interfaces / logical_data_entities). This matches Spec 3's forward-compat note in `candidateEvidenceTypes.ts:36-37`.

---

## 5. Open product/architecture questions for the user

See the report-back. These are the genuine product calls:

- **Q1 (panel signature):** does `<CandidateDetailsPanel>` receive a precomputed `runtimeEvidenceContext` prop, or does it accept the full candidate list and derive internally?
- **Q2 (interface derivation source):** frontend rollups vs. Spec 5 add-on for backend-precomputed rollups?
- **Q3 (role data degradation):** since `interface_logical_entities` can derive role data from the linked endpoint's `requestBodyType` / `responseType` on Spring Boot, is that acceptable as the primary path with "unknown role" as fallback for non-Spring adapters? Or is that too cute?
- **Q4 (placeholder wording change):** confirm the wording change and that the existing Spec 3 test will be updated.
- **Q5 (LLM-created candidates):** confirm the brief's intent that an LLM-only `endpoints` candidate (no Code Detection, but has `logEnrichment.runtime.matched`) IS expandable today via the existing allowlist gate, and Spec 6 should populate Log Scans even when the Code Detection card is empty.

---

## 6. Visual assets

`ls planning/visuals/` returned no files. No visual assets provided.

---

## Resolved decisions (user-confirmed 2026-05-11)

The five clarifying questions raised during shaping have been resolved by the user. All five match the shaper's recommended defaults.

1. **Panel data-flow seam → precomputed `runtimeEvidenceContext` prop, built once at the `DiscoveryCandidateTable` level with `useMemo`.**
   - The context object includes a `Map<candidateId, RuntimeEvidenceForCandidate>` (per-candidate matched/no-usage view) PLUS derived interface/entity/relationship rollup maps (per-interface aggregated runtime totals, per-logical-data-entity rollups via the interface-logical-entity chain, and per-interface-logical-entity contract usage with role derivation).
   - `<CandidateDetailsPanel>` gains a new `runtimeEvidenceContext: RuntimeEvidenceContext` prop. The orchestrator passes the candidate's slice into the per-section builders.
   - `DiscoveryCandidateTable` is the only consumer responsible for building and memoizing this context. It will not be rebuilt per-row, only when the candidate list changes.
   - Spec 3's "panel-builds internally" decision is superseded specifically for Log Scans cross-candidate rollups; per-candidate-only build for Code Detection (Spec 2/3 wiring) is preserved.

2. **Interface / logical-entity / relationship rollups → frontend-only for Spec 6.**
   - All four candidate types' Log Scans evidence is computed on the frontend from the candidate list it already has (via the `runtimeEvidenceContext` precomputed in #1).
   - NO Spec 5 amendment, NO new backend endpoint, NO new persistence shape.
   - Typical run is tens to low-hundreds of candidates — well within frontend reach. If performance becomes an issue at high candidate counts, a future spec can move rollups to the backend; the frontend interface stays the same so that change won't be user-visible.

3. **`interface_logical_entities` role derivation → frontend-derived from the linked endpoint's `requestBodyType` and `responseType`.**
   - For each `interface_logical_entities` candidate, derive related endpoints via `interfaceClassName` ↔ `controllerClassName` (the same chain Spring Boot adapter uses).
   - For each related endpoint, classify the candidate's `logicalEntityName` against the endpoint's `data.requestBodyType` (→ "Request body usage") and `data.responseType` / `data.unwrappedReturnType` / `data.returnType` (→ "Response body usage").
   - When BOTH the endpoint and the body type fields are present and the type matches, count toward the corresponding role bucket.
   - When the linked endpoint exists but neither body type field is populated (e.g. non-Spring adapters that don't emit request/response types), count toward the "Unknown role usage" tail bucket.
   - Same endpoint may contribute to BOTH request and response buckets if it uses the entity in both positions.
   - Display order in the panel: Request body usage → Response body usage → Unknown role usage → Total observed contract usage. Hide a row if its count is zero (avoid empty fields per Spec 1-3 display rules).

4. **Placeholder wording → change "Log scan evidence is not available for this run." → "Log scan evidence was not found for this run."** in the same commit.
   - Owner of the string: `buildLogScansEvidenceSection(...)` in `frontend/src/components/DashboardView/candidateEvidenceBuilder.ts`.
   - The Spec 3 test that asserts the old string (`frontend/src/components/DashboardView/__tests__/candidateEvidenceBuilder.test.ts`, AND likely `candidateDetailsPanel.test.tsx` and `candidateDetailsExpansion.test.tsx`) MUST be updated to assert the new string in the same commit. Use Grep across `frontend/src/**/__tests__/` to find every assertion of the exact old string.
   - The new fallback applies whenever the run has no associated log evidence for that row, regardless of whether (a) no logs were supplied, (b) logs were supplied but no evidence matched this row, or (c) evidence exists for other rows but not this row. Single fallback string for all three cases (per spec brief).

5. **LLM-created candidates with logs → render Log Scans whenever `logEnrichment.runtime` exists, independent of Code Detection.**
   - The allowlist gate in `candidateDetailsSupport.ts` is type-based and unchanged. Any candidate of a supported type (`endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities`) is expandable.
   - When an LLM-only candidate has `logEnrichment.runtime.matched` populated, the Log Scans section renders the matched evidence and the Code Detection section renders its existing empty-state line ("Type-specific details: not available.") via the renderer's `isMostlyEmpty` rule from Spec 2/3.
   - No code change to `candidateDetailsSupport.ts` or `CodeDetectionEvidenceBuilder.ts`. Spec 6 ONLY changes the Log Scans evidence builder + adds the precomputed context.

---
