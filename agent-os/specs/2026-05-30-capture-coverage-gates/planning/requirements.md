# Spec Requirements: Capture Coverage Gates (Spec 5 — HAIKAI discovery-richness capstone)

## Initial Description

(From `planning/raw-idea.md`.) HAIKAI is a like-for-like API/DB migration tool. The
north star is an auto-loop where "all endpoints produce the same response for both
current and target state." That only holds if EVERY discovered endpoint is (a) richly
specified by discovery (Specs 1-4) AND (b) captured -> replayed -> diffed by the runtime
harness (`api-migration-validation-service`). This is the program's **completeness critic**
capstone — the LAST spec of the program (Issue 1 + Specs 1-4 + Issue 2 are already built).

**Problem:** Today there are SILENT coverage gaps (e.g. "10 of 50 operations executed,
run silently completed"). The goal is to make migration coverage **VISIBLE** and
**(advisorily) GATED** across the whole pipeline, with **no silent gaps**, across three
coverage dimensions — **all three in v1** (the full capstone).

This requirements document supersedes the raw-idea on two points where the orchestrator
made a later, more-accurate determination (both flagged inline below):
- **Persistence:** the raw-idea left "add a Liquibase changeset only if persistence is
  added" open; the FINAL decision is **computed-on-read, NO new persistence at all**.
- **Wire format:** the raw-idea's "AMS snake_case (no @CamelCaseWire)" note is WRONG for the
  specific DTO tree this spec extends. `ReadinessAssessmentDto` is already **per-field
  camelCase** via explicit `@JsonProperty("camelCase")` (verified). New fields MUST follow
  that existing camelCase convention.

---

## Requirements Discussion

### First Round Questions

> NOTE: All shaping for this spec was completed by the user/orchestrator before this
> research step; the items below record the FINAL user-approved decisions and the
> orchestrator-settled resolutions, restated in Q/A form for the spec-writer. No new
> questions were posed.

**Q1: Which coverage dimensions are in v1 — one, two, or all three?**
**Answer:** **All three, in v1** (the user chose the full capstone). The three dimensions are:
- **(A) CAPTURE coverage (harness side):** of the M `included` operations in a baseline,
  how many were actually captured -> replayed -> diffed. Surface WHICH operations are
  missing — not just a count. (Today `ApiBehaviourBaselineEntity` carries only
  `operationCount` + `acceptedCaptureCount` COUNTS; there is **no per-operation
  captured/replayed/diffed status**.)
- **(B) DISCOVERY specification coverage:** of discovered endpoints, how many are
  "fully specified."
- **(C) INVENTORY reconciliation:** compare discovery's endpoint set against the harness's
  `api_behaviour_operations` set — flag **discovered-but-not-captured** AND
  **captured-but-not-discovered**.

**Q2: Should the gate BLOCK the run/baseline, or be advisory?**
**Answer:** **ADVISORY + VISIBLE — never blocking.** The output is a counted coverage
metric + distinct readiness gap codes + per-endpoint Findings; the run/baseline still
completes; nothing is ever hard-blocked. This is consistent with every existing
`MigrationGapCodes` entry (they downgrade readiness to `partial`/`insufficient`, never
block) and with the program's no-silent-drops / surface-as-evidence ethos.

**Q3: How is "fully specified" (dimension B) defined — one uniform bar, or per-protocol?**
**Answer:** **PER-PROTOCOL, with captured behaviour as a BONUS (not a hard requirement).**
Different pipelines have different bars so no endpoint is unfairly penalised:
- **REST endpoint** = "fully specified" when it has a **resolved `endpoint_data_effects`
  edge** (Spec 1).
- **SOAP operation** = "fully specified" when it has **bound request/response message
  entities** (Spec 4: `logical_data_entities` bound via `interface_logical_entities`).
- **Captured behaviour** (Spec 2: `business_logics.behavior` JSONB) is a **BONUS** signal,
  NOT a hard requirement — Spec 2 is best-effort / confidence-scored, so requiring it would
  unfairly fail endpoints whose behaviour the LLM could not confidently capture.

**Q4: Where does persistence live for the three coverage results?**
**Answer (orchestrator-settled — resolved):** **COMPUTED-ON-READ. NO new persistence, NO
Liquibase changeset, NO new entity/table, NO new meta-model entity type.** All three
dimensions are **derived at query time** from data that already exists:
- (A) join `api_behaviour_operations` (`included = true`) against the capture / baseline-item
  / diff-item rows (`api_behaviour_captures` / `api_behaviour_baseline_items` /
  `api_behaviour_diff_items`).
- (B) read the persisted architecture model (`endpoint_data_effects`, SOAP
  `interface_logical_entities` + message entities, `business_logics.behavior`).
- (C) compare the model's endpoint inventory against `api_behaviour_operations`.

The gate is a **pure READ**, exactly like `assessReadiness()` itself. This also conforms to
the meta-model rule (see "Meta-Model Grounding" below): coverage/readiness is
migration-process REALITY, NOT architecture, so there is no new meta-model entity TYPE; and
because it is computed-on-read there is no new migration-process table either.
**This supersedes the raw-idea's "next changeset >= 168" note — no changeset is created.**

**Q5: Does discovery hand the harness an explicit operation manifest for reconciliation (C)?**
**Answer (orchestrator-settled — resolved):** **No new exchange. COMPUTE only.** Do NOT
introduce a discovery -> harness operation manifest. Reconciliation (C) compares the two
**independently-built** inventories **at read time** inside the AMS readiness aggregator
(`MigrationDiscoveryContextService.assessReadiness()`), which already sees BOTH the
architecture model and the baselines. No new handoff payload, no manifest table.

**Q6: How is the result surfaced to the user?**
**Answer (orchestrator-settled — resolved):** **The EXISTING readiness mechanism +
Findings.** Specifically:
- Add **DISTINCT gap codes per dimension** to `MigrationGapCodes` — one per dimension
  (illustrative names; final naming is the writer's discretion):
  - (A) `INCOMPLETE_CAPTURE_COVERAGE`
  - (B) `UNDER_SPECIFIED_ENDPOINTS`
  - (C) `DISCOVERY_HARNESS_INVENTORY_MISMATCH`
- Fold those codes into the **EXISTING readiness streams** — (A)/(C) belong on
  `baselineReadiness` / `apiReadiness`; (B) on `discoveryReadiness` (writer's discretion on
  exact stream placement, consistent with current stream semantics). Compute the coverage
  metrics inside `assessReadiness()`.
- Dimension B ALSO emits **per-under-specified-endpoint evidence-gap Findings** via the
  discovery `FindingEmitter` (so they appear on the Findings tab) + the run aggregate.
- **REUSE the existing readiness frontend surface — NO bespoke dashboard widget in v1.**
  Render the new gap codes / coverage metrics where readiness already renders
  (`MigrationDeliveryDashboard` via `migrationDiscoveryContextApi`).

**Q7: Wire format for any new DTO fields (important correction).**
**Answer (orchestrator correction — resolved):** `ReadinessAssessmentDto` and the wider
`MigrationDiscoveryContextDto` tree are **ALREADY camelCase-wired via explicit per-field
`@JsonProperty("camelCase")`** — NOT the `@CamelCaseWire` meta-annotation, and NOT the
global snake_case default. Any **NEW field** added to that DTO tree (e.g. coverage metric
values) **MUST follow the existing per-field camelCase `@JsonProperty` convention** to avoid
a mixed-casing payload. (There is no new `api_behaviour_*` persistence in v1, so the
snake_case-persistence convention does not bite here.)

**Q8: SOAP reconciliation key (technical necessity).**
**Answer (orchestrator — resolved, verified in code):** SOAP operations all emit as
`{operation_verb:'POST', path_or_address: servletPath}` with `path_or_address` **often
null** — so `{method, path}` is **NOT a unique key for SOAP** and would collapse N operations
to one. Dimension (C) MUST use a **SOAP-aware reconciliation key** (`soap_action` /
`request_root_element`) for SOAP operations, while REST uses `{method, path}`.

**Q9: Does the harness (`api-migration-validation-service`) need a new read-only endpoint to
expose per-operation capture status for (A)?**
**Answer:** **Prefer AMS-side computation — confirm during spec-writing that no harness
change is needed.** AMS already owns the `api_behaviour_*` tables, so (A) should be computed
directly from those tables inside AMS (join `api_behaviour_operations` -> captures / baseline
items / diff items). The spec-writer must CONFIRM AMS can compute (A) end-to-end from the
tables it owns; only if a genuinely required signal is unreachable from AMS would a
read-only harness endpoint be considered (treat as out-of-scope unless proven necessary).

**Q10: What is explicitly OUT of scope for v1?**
**Answer:** See "Scope Boundaries — Out of Scope" below (auto-remediation; bespoke dashboard
widget; non-Spring-Classic protocols for dimension B; any blocking gate; any new persistence
/ changeset / meta-model entity; any discovery -> harness manifest exchange).

---

### Existing Code to Reference

**Similar Features Identified (REUSE — do NOT fork):**

- **AMS readiness aggregator** — `architecture-model-service/src/main/java/com/example/architecturemodel/service/migration/MigrationDiscoveryContextService.java`
  - `assessReadiness(ReadinessContext)` (static, ~line 967): the per-stream
    `sufficient`/`partial`/`insufficient` rules + gap-code emission. **The three coverage
    metrics + new gap codes are computed HERE.**
  - `buildBaselineSummary(...)` (~line 861): loads `ApiBehaviourBaselineEntity` rows for the
    `(project, currentArchitecture)` tuple; baselines link to operations/captures via
    `b.getSessionId()` (NOT a baselineId FK). This is the entry point for dimension (A) +
    (C) baseline data.
  - `FindingsSummary` / `buildFindingsSummary(...)` (~line 762): the existing findings
    aggregation pattern to mirror.
  - `build(...)` (~line 196): the orchestration method that composes `ReadinessContext` and
    calls `assessReadiness`; the new aggregates must be threaded into `ReadinessContext`
    (the read-only record at ~line 953) and computed before/inside `assessReadiness`.
- **Gap-code vocabulary** — `architecture-model-service/.../model/dto/migration/MigrationGapCodes.java`
  - Add the new per-dimension constants alongside the existing 8 codes
    (`NO_API_BEHAVIOUR_BASELINE`, `HIGH_SEVERITY_UNREVIEWED_FINDINGS`, etc.). String
    constants, not a Java enum (matches the existing convention).
- **Readiness DTO** — `architecture-model-service/.../model/dto/migration/ReadinessAssessmentDto.java`
  - Record with explicit per-field `@JsonProperty("camelCase")`. Extend HERE with any new
    camelCase metric fields (e.g. `captureCoverage`, `specificationCoverage`,
    `inventoryReconciliation`). **Must remain a byte-stable shape** (existing consumers read
    it via the gateway byte-for-byte proxy).
- **API-behaviour data plane (read-only)** — `architecture-model-service/.../model/entity/apibehaviour/`
  + `.../repository/apibehaviour/`:
  - `ApiBehaviourOperationEntity` (table `api_behaviour_operations`): keyed by `session_id`;
    one row per `{method, path}`; carries `included` (Boolean) + `safe_to_execute` (Boolean)
    + `operation_id` (OAS operationId, nullable). **This is the denominator for (A) and one
    side of the (C) comparison.**
  - `ApiBehaviourCaptureEntity` (table `api_behaviour_captures`): per-attempt row keyed by
    `session_id` + `scenario_id` + `operation_id` (FK to operation); carries `accepted`
    (Boolean), `response_status`, `error_type`. **The "was it captured/executed" signal.**
  - `ApiBehaviourBaselineItemEntity` (`api_behaviour_baseline_items`) — accepted captures
    promoted to baseline (the "replayed/diffed-eligible" set).
  - `ApiBehaviourDiffItemEntity` / `ApiBehaviourDiffEntity` — the diff results (the "diffed"
    signal).
  - `ApiBehaviourBaselineRepository.findByProjectIdAndArchitectureIdOrderByCreatedAtDesc`
    already used by `buildBaselineSummary`.
  - **NOTE (gap to fill):** `ApiBehaviourOperationRepository` currently exposes only
    `findBySessionIdOrderByCreatedAtAsc`; `ApiBehaviourCaptureRepository` has no
    by-session/by-operation finder used here. The spec-writer will likely need **new
    read-only repository finder method(s)** (e.g. operations-by-session,
    captures-by-session/by-operationIds) — read-only queries, NO schema change.
- **Dimension-B model reads (Specs 1/2/4)** — AMS:
  - Spec 1 REST data effect: `EndpointDataEffectEntity` + `EndpointDataEffectRepository`
    (`.../model/entity/discovery/`, `.../repository/discovery/`); also surfaced on the
    meta-model relationships (`endpoint_data_effects`).
  - Spec 2 behaviour BONUS: `BusinessLogicEntity` `behavior` JSONB field
    (`.../model/entity/BusinessLogicEntity.java`, `BusinessLogicDto`).
  - Spec 4 SOAP message binding: `interface_logical_entities` relationship +
    `logical_data_entities` message entities (read from the persisted model /
    `MetaModelSummaryService`, the same source `buildArchitectureSummary` already uses).
- **Discovery FindingEmitter** — `discovery-service/src/services/findings/FindingEmitter.ts`
  - `emitFinding(runContext, input)` / `emitFindings(runContext, inputs[])`;
    `FindingEmitInput` shape = `{ findingType, category, severity, title, summary?,
    detailJson?, confidence?, source?, createdByStage?, status?, links? }`. **Dimension B's
    per-under-specified-endpoint evidence-gap Findings are emitted via this.**
  - `getRunAggregate(runId)` -> `{ totalEmitted, totalPersisted, totalDeduped }`; the run
    aggregate already surfaced into the run's `steps_payload` by `runManager`. **The
    dimension-B per-endpoint "fully specified?" rollup hangs off the run aggregate.**
  - Built-in dedupe (D2 dedupe key) + soft-fail (never throws) — reuse as-is.
- **Discovery emission sources** — `discovery-service/src/services/findings/emissionSources.ts`
  - Existing builder pattern (`buildLowConfidenceCandidateFinding`,
    `buildUnresolvedDecisionTaskFinding`, `buildCandidateConflictFinding`) returning a
    `FindingEmitInput`. **Add a new builder for the under-specified-endpoint evidence-gap
    Finding here.**
- **Discovery pipeline** — `discovery-service/src/services/discoveryV3Pipeline.ts`
  - Where the dimension-B per-endpoint completeness rollup + Finding emission is wired into
    the run (the existing emit sites are the model to follow). **No `discovery-service/src/**`
    edits while a run is in flight** (tsx watch reload kills runs).
- **SOAP operation emission (reconciliation key source)** —
  `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/`
  (`soapEndpointEmitter.ts`, `index.ts`, `jaxWsScanner.ts`, `messageEntityEmitter.ts`):
  emits `operation_verb='POST'`, `path_or_address` (servlet URL, often null), plus
  `soap_action` + `request_root_element` (the distinguishing per-operation signals). **This
  is the source of the SOAP-aware reconciliation key for dimension (C).**
- **Gateway proxy** — `gateway/src/routes/migrationContext.ts`
  - `POST /api/v1/projects/:projectId/migration-discovery-context` forwards the body
    verbatim and re-emits the AMS response (status + body) **byte-for-byte**. **No change
    expected — confirm during spec-writing.**
- **Frontend readiness surface (REUSE — no bespoke widget)**:
  - `frontend/src/api/migrationDiscoveryContextApi.ts` — `MigrationReadinessAssessment` type
    (has `gaps?: string[]` + the per-stream fields). New gap codes flow through `gaps[]` for
    free; new camelCase metric fields need adding to this type.
  - `frontend/src/components/ProductManager/MigrationDeliveryDashboard/MigrationDeliveryDashboard.tsx`
    (+ `.module.css`, `MigrationDeliveryDashboardRoute.tsx`) — the existing readiness render
    target.
  - `frontend/src/api/apiBehaviourClient.ts` — existing API-behaviour client (reference).
- **Harness (read-only reference ONLY — prefer NO change)** —
  `api-migration-validation-service/src/services/captureSessionOrchestrator.ts` and
  `.../diffRunner.ts`: how operations are enumerated/executed and how diffs are produced.
  Read-only reference for understanding the (A) computation; the spec PREFERS AMS-side
  computation with no harness change.

---

### Follow-up Questions

None. All shaping decisions were FINAL before this research step; no follow-ups were
required.

---

## Visual Assets

### Files Provided:
No visual assets provided. `planning/visuals/` was checked (twice) and is empty. v1 reuses
the existing readiness surface, so no mockups are needed.

### Visual Insights:
Not applicable.

---

## Requirements Summary

### Functional Requirements

**Goal:** Make migration coverage VISIBLE and advisorily GATED across the whole pipeline so
the north-star auto-loop ("all endpoints produce the same response for current and target
state") has NO silent gaps. Three coverage dimensions, ALL in v1.

**Dimension (A) — CAPTURE coverage (harness side), computed in AMS:**
- Of the `M` `included = true` operations in a baseline's session, determine how many were
  actually captured -> replayed -> diffed.
- Compute a **counted coverage metric** (e.g. `capturedCount / includedCount`).
- Identify and surface WHICH operations are MISSING (not just a count).
- Emit gap code (e.g. `INCOMPLETE_CAPTURE_COVERAGE`) on `baselineReadiness` / `apiReadiness`
  when coverage is below full.
- Computation joins `api_behaviour_operations` (`included = true`, keyed by `session_id`)
  against `api_behaviour_captures` (by `operation_id`) and the baseline-item / diff-item
  rows. The spec-writer scopes the exact "captured vs replayed vs diffed" definition against
  these tables (captures = executed/accepted; baseline_items = replayed-eligible;
  diff_items = diffed).

**Dimension (B) — DISCOVERY specification coverage, computed in AMS + surfaced via discovery
Findings:**
- Of discovered endpoints, determine how many are "fully specified" PER PROTOCOL:
  - REST: has a resolved `endpoint_data_effects` edge (Spec 1).
  - SOAP: has bound request/response message entities (Spec 4
    `interface_logical_entities` + `logical_data_entities`).
  - Spec 2 `business_logics.behavior` is a BONUS signal, NOT a hard requirement.
- Compute a **counted coverage metric** (fully-specified / total discovered endpoints).
- Emit gap code (e.g. `UNDER_SPECIFIED_ENDPOINTS`) on `discoveryReadiness`.
- Emit a **per-under-specified-endpoint evidence-gap Finding** via the discovery
  `FindingEmitter` (Findings tab) + reflect it in the discovery run aggregate (per-endpoint
  "fully specified?" rollup).

**Dimension (C) — INVENTORY reconciliation, computed in AMS:**
- Compare the discovery endpoint inventory (from the persisted architecture model) against
  the harness `api_behaviour_operations` set.
- Flag BOTH directions: **discovered-but-not-captured** AND **captured-but-not-discovered**.
- Use a **protocol-aware reconciliation key**: REST = `{method, path}`; SOAP =
  `soap_action` / `request_root_element` (because SOAP collapses to
  `{POST, servletPath|null}`).
- Emit gap code (e.g. `DISCOVERY_HARNESS_INVENTORY_MISMATCH`) on `apiReadiness` /
  `baselineReadiness`.
- Computed at read time inside `assessReadiness()` (which already sees both the model and
  the baselines) — no manifest, no new exchange.

**Cross-cutting:**
- All three are **ADVISORY**: they downgrade readiness to `partial`/`insufficient` and emit
  Findings/metrics; the run/baseline still completes. **Nothing is ever hard-blocked.**
- All three are **computed-on-read** from existing data — no new persistence.

### Reusability Opportunities

- `assessReadiness()` + `ReadinessContext` + `MigrationGapCodes` + `ReadinessAssessmentDto`
  (extend, don't fork) — the home for all metric computation + gap codes + new camelCase
  fields.
- `buildBaselineSummary` already loads the baselines and exposes `sessionId` (the join key
  into operations/captures).
- The `api_behaviour_*` entities/repositories already model every signal (A)/(C) needs
  (operations, captures, baseline items, diff items) — likely needs only NEW read-only
  finder methods, no schema change.
- `EndpointDataEffectRepository` (Spec 1) + `BusinessLogicEntity.behavior` (Spec 2) +
  `interface_logical_entities`/message entities (Spec 4) + `MetaModelSummaryService` supply
  dimension (B) inputs from the persisted model.
- `FindingEmitter.emitFindings` + `emissionSources.ts` builder pattern + `getRunAggregate`
  for dimension (B) Findings + rollup.
- `MigrationReadinessAssessment` (frontend type) + `MigrationDeliveryDashboard` render
  surface — new `gaps[]` codes render for free; new metric fields need a type + render
  extension only.
- Gateway proxy already round-trips AMS byte-for-byte — no work expected.

### Scope Boundaries

**In Scope (v1):**
- All THREE coverage dimensions (A capture, B specification, C reconciliation).
- Advisory readiness gap codes (distinct per dimension) folded into the existing readiness
  streams, computed in `assessReadiness()`.
- Counted coverage metrics exposed on `ReadinessAssessmentDto` (new per-field camelCase
  `@JsonProperty` fields).
- Dimension B per-under-specified-endpoint evidence-gap Findings via the discovery
  `FindingEmitter` + run-aggregate rollup.
- Reuse of the existing readiness frontend surface to render the new codes + metrics.
- All computed-on-read; read-only repository finder additions in AMS are permitted (no
  schema change).

**Out of Scope (v1):**
- **Auto-remediation** (re-running capture for missing operations) — surface only.
- **A bespoke dashboard widget** — reuse the existing readiness surface.
- **Non-Spring-Classic protocols** for dimension B (only REST + SOAP bars are defined).
- **Any BLOCKING gate** — strictly advisory.
- **Any new persistence** — no new entity, no new table, no Liquibase changeset
  (supersedes the raw-idea's ">= 168 changeset" note).
- **Any new meta-model entity TYPE** — coverage is migration-process reality, not
  architecture; never create `*_points` wrappers.
- **A discovery -> harness operation manifest / new handoff exchange** — reconciliation is a
  read-time compare of two independently-built inventories.
- **A new harness endpoint** — prefer AMS-side computation of (A) from the `api_behaviour_*`
  tables AMS already owns; only revisit if a required signal is provably unreachable from
  AMS (treat as out-of-scope unless proven necessary).

### Technical Considerations

**Build layering (strict order):**
1. **AMS** — `MigrationDiscoveryContextService.assessReadiness()` computes the three
   coverage metrics + emits the new `MigrationGapCodes`; thread new aggregates through
   `ReadinessContext` + `build(...)`; extend `ReadinessAssessmentDto` with new **camelCase
   `@JsonProperty`** fields if metric values must be exposed; add read-only repository
   finder method(s) on the `api_behaviour_*` repositories as needed. Compute (A) from
   `api_behaviour_*`; (B) from the persisted model (`endpoint_data_effects` / SOAP message
   bindings / `business_logics.behavior` bonus); (C) by protocol-aware inventory compare.
2. **discovery-service** — dimension B per-endpoint completeness rollup in the run aggregate
   + per-under-specified-endpoint evidence-gap Findings via `FindingEmitter` /
   `emissionSources.ts`, wired in `discoveryV3Pipeline.ts`. (No `discovery-service/src/**`
   edits during an in-flight run.)
3. **gateway** — no change expected; `migrationContext.ts` proxies the readiness response
   byte-for-byte. CONFIRM only.
4. **frontend** — render the new gap codes + coverage metrics in the EXISTING readiness
   surface (`MigrationReadinessAssessment` type + `MigrationDeliveryDashboard`); add new
   camelCase metric fields to the API type. No bespoke widget.

**Wire format (verified):** `ReadinessAssessmentDto` / `MigrationDiscoveryContextDto` are
ALREADY camelCase via explicit per-field `@JsonProperty("camelCase")` (confirmed in
`ReadinessAssessmentDto.java` — `overallStatus`, `apiReadiness`, `baselineReadiness`, etc.).
New fields MUST use the same per-field camelCase `@JsonProperty` to avoid mixed casing. (The
global AMS default is snake_case, but it does NOT apply to this annotated tree; and there is
no new `api_behaviour_*` persistence in v1, so the snake_case-persistence convention is not
engaged.)

**SOAP reconciliation key (verified):** SOAP endpoint candidates emit `operation_verb='POST'`
with `path_or_address` = servlet URL (often null) and the per-operation signal on
`soap_action` / `request_root_element` (confirmed in
`springClassicSoap/soapEndpointEmitter.ts` + `index.ts`). Dimension (C) MUST key SOAP
operations on `soap_action` / `request_root_element`, not `{method, path}`.

**Dimension (A) join shape (verified):** baselines link to operations/captures via
`session_id` (NOT a `baseline_id` FK) — `ApiBehaviourBaselineEntity.getSessionId()`;
`api_behaviour_operations` and `api_behaviour_captures` are both `session_id`-scoped;
captures reference operations via `operation_id`. Captures carry `accepted` +
`response_status` + `error_type` but NOT an explicit replayed/diffed flag — replayed/diffed
status lives in `api_behaviour_baseline_items` / `api_behaviour_diff_items`. The spec-writer
must scope the exact "captured vs replayed vs diffed" definition against these tables.

**Meta-Model Grounding (verified against
`gateway/src/config/prompts/shared/architecture-context-explainer.md`):** Coverage/readiness
is migration-process REALITY, NOT architecture. Spec 5 adds NO new meta-model entity TYPE.
Discovery-side coverage = Findings + run aggregates; harness-side coverage = the EXISTING
`api_behaviour_*` migration-process data plane (already separate from the architecture
meta-model). The polymorphic `*_points` wrappers (`application_points`, `data_entity_points`,
`business_points`, `app_business_points`) are backend auto-managed and must NEVER be created.
Dimension (B) READS existing relationships (`endpoint_data_effects`,
`interface_logical_entities`) — it does not mint new ones.

**Constraints:**
- No new Liquibase changeset (computed-on-read).
- `ReadinessAssessmentDto` extensions follow its existing camelCase `@JsonProperty`.
- No `discovery-service/src/**` edits during an in-flight run (tsx watch reload kills runs).
- LLM via the gateway relay only — but this spec is **deterministic compute** (no LLM is
  needed for the coverage logic).
- The user starts services and owns all git operations; the spec stops at code +
  verification.
