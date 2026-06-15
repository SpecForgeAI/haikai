# Specification: Capture Coverage Gates (Spec 5 — HAIKAI discovery-richness capstone)

## Goal
Make migration coverage VISIBLE and advisorily GATED across the pipeline — capture coverage (harness), discovery specification coverage, and discovery↔harness inventory reconciliation — so the north-star auto-loop ("all endpoints produce the same response for current and target state") has NO silent gaps. All three dimensions ship in v1, computed-on-read with no schema change, surfaced through the existing readiness mechanism + Findings, and never blocking.

## User Stories
- As a migration analyst, I want to see how many of a baseline's included operations were actually captured→replayed→diffed (and WHICH are missing) so that "10 of 50 executed, run silently completed" can never hide.
- As a reviewer, I want each under-specified discovered endpoint to surface as a Findings-tab evidence gap and a counted readiness metric so that I know exactly which endpoints are not yet migration-ready.
- As a migration lead, I want discovery's endpoint set reconciled against the harness's captured-operation set (both directions) so that an endpoint discovered-but-never-captured, or captured-but-never-discovered, is flagged rather than silently passed.

## Specific Requirements

**Cross-cutting: advisory, computed-on-read, no new persistence (gating constraints)**
- All three dimensions are a PURE READ inside `MigrationDiscoveryContextService.assessReadiness(...)` — exactly like the existing readiness rules; the run/baseline still completes and NOTHING is ever hard-blocked.
- NO new persistence: no new entity, no new table, NO Liquibase changeset, no new meta-model entity TYPE, no `*_points` wrapper. Coverage is migration-process REALITY, not architecture (per the meta-model reference).
- Derive every signal at query time from data that already exists: (A) the `api_behaviour_*` tables AMS already owns; (B) the persisted architecture model (discovery entity repositories); (C) a read-time compare of the two independently-built inventories.
- New READ-ONLY repository finder methods are permitted if a needed join lacks one — but verification shows the existing finders already cover all three dimensions (see "Existing Code to Leverage"); prefer reusing them and add a finder only where genuinely absent.
- Each dimension downgrades the relevant readiness stream to `partial`/`insufficient` and emits a DISTINCT gap code; dimension B additionally emits per-endpoint Findings.

**Build layering (strict order)**
- Layer 1 — AMS: compute all three metrics + emit the new `MigrationGapCodes` inside `assessReadiness`; thread new aggregates through the `ReadinessContext` record and `build(...)`; extend `ReadinessAssessmentDto` with camelCase `@JsonProperty` metric fields only if values must be carried on the wire.
- Layer 2 — discovery-service: dimension-B per-endpoint completeness rollup on the run aggregate + per-under-specified-endpoint evidence-gap Findings, wired in `discoveryV3Pipeline.ts`. NO `discovery-service/src/**` edits while a run is in flight (tsx watch reload kills runs).
- Layer 3 — gateway: confirm `migrationContext.ts` proxies the readiness response byte-for-byte — expected NO change.
- Layer 4 — frontend: render the new gap codes + metrics in the EXISTING readiness surface; add the new camelCase fields to the `MigrationReadinessAssessment` type. No bespoke widget.

**Dimension (A) — CAPTURE coverage (harness side, computed in AMS)**
- For each baseline reached via `buildBaselineSummary`, use `ApiBehaviourBaselineEntity.getSessionId()` to scope the `api_behaviour_*` joins (baselines link to operations/captures by `session_id`, NOT a baseline FK).
- Denominator = `api_behaviour_operations` for that session filtered to `included = true` (the M operations); read via the existing `findBySessionIdOrderByCreatedAtAsc`.
- "Captured/executed" = an `api_behaviour_captures` row exists for that `operation_id` in the session (carries `accepted` / `response_status` / `error_type`); "replayed-eligible" = an `api_behaviour_baseline_items` row exists for the baseline (carries `operation_id` / `method` / `path`); "diffed" = a diff item exists (baseline → `ApiBehaviourDiffRepository` as source → `api_behaviour_diff_items`). Scope the exact captured-vs-replayed-vs-diffed definition against these tables; a missing diff for a current-only baseline (never replayed against a target) is the unexecuted-coverage signal, not an error.
- Compute a counted metric (e.g. `capturedCount / includedCount`) AND surface WHICH operations are missing (by `operation_id` / `{method, path}`), not just a count.
- Emit a distinct gap code (suggested `INCOMPLETE_CAPTURE_COVERAGE`) on `baselineReadiness` / `apiReadiness` when coverage is below full; downgrade the stream to `partial` accordingly.
- Confirm AMS can compute (A) end-to-end from the tables it owns — no new harness endpoint (treat a harness change as out-of-scope unless a required signal is provably unreachable from AMS; verification shows it is reachable).

**Dimension (B) — DISCOVERY specification coverage (computed in AMS + discovery Findings)**
- Resolve the architecture's `model_file_id` the same way `MetaModelSummaryService` does (via `ModelFileRepository`), then read the discovery entities by that id; `MetaModelSummaryDto` is counts-only and CANNOT supply effects/bindings, so read the entity repositories directly.
- "Fully specified" is PER-PROTOCOL: REST endpoint = has a resolved `endpoint_data_effects` edge (`EndpointDataEffectRepository.findByEndpointId` non-empty / Spec 1); SOAP operation = its parent interface has bound request/response message entities (`InterfaceLogicalEntityRepository.findByInterfaceId` / Spec 4 `interface_logical_entities` + `logical_data_entities`).
- Captured behaviour (Spec 2 `business_logics.behavior` JSONB) is a BONUS signal ONLY — never required (Spec 2 is best-effort/confidence-scored; requiring it would unfairly fail endpoints whose behaviour was not confidently captured).
- Detect SOAP vs REST from `EndpointEntity` (`protocol` / `endpoint_type`); apply the matching bar per protocol so no endpoint is unfairly penalised.
- Compute a counted metric (fully-specified / total discovered endpoints) and emit a distinct gap code (suggested `UNDER_SPECIFIED_ENDPOINTS`) on `discoveryReadiness`.
- For each under-specified endpoint, emit an `evidence_gap` Finding via the discovery `FindingEmitter` (new builder in `emissionSources.ts` + new `EvidenceGapType` sentinel(s), e.g. `endpoint_missing_data_effect` / `soap_operation_missing_message_binding`), and reflect the per-endpoint "fully specified?" rollup on the run aggregate.

**Dimension (C) — INVENTORY reconciliation (computed in AMS)**
- Compare the discovery endpoint inventory (model-file-scoped `EndpointEntity` rows) against the harness `api_behaviour_operations` set for the baseline's session.
- Use a PROTOCOL-AWARE reconciliation key: REST = `{operationVerb, pathOrAddress}` ↔ harness `{method, path}`; SOAP = `soap_action` / `request_root_element` (read from `EndpointEntity.protocolMetadataJson` on the model side) — because every SOAP op emits as `{operation_verb:'POST', path_or_address: servletPath}` with `path` often null, so `{method, path}` collapses N SOAP ops to one.
- Flag BOTH directions: discovered-but-not-captured AND captured-but-not-discovered.
- Emit a distinct gap code (suggested `DISCOVERY_HARNESS_INVENTORY_MISMATCH`) on `apiReadiness` / `baselineReadiness`.
- Compute at read time inside `assessReadiness` (which already sees both the model and the baselines) — NO discovery→harness operation manifest, no new handoff payload.

**AMS gap-code vocabulary + readiness wiring (`MigrationGapCodes` / `assessReadiness` / `ReadinessContext`)**
- Add the three new constants to `MigrationGapCodes` alongside the existing eight (String constants, NOT a Java enum — matches the existing convention).
- Fold the new codes into the EXISTING readiness streams (dedupe is already applied at the end of `assessReadiness`); keep the existing per-stream `sufficient`/`partial`/`insufficient` semantics and the existing overall rollup rules.
- Extend the `ReadinessContext` record (the read-only bundle) + thread the new aggregates from `build(...)`; prefer AMS-side computation so the harness needs no change.

**`ReadinessAssessmentDto` wire-format extension (camelCase per-field — correction)**
- `ReadinessAssessmentDto` / `MigrationDiscoveryContextDto` are ALREADY camelCase via explicit per-field `@JsonProperty("camelCase")` (verified: `overallStatus`, `apiReadiness`, `baselineReadiness`, …) — NOT `@CamelCaseWire`, NOT the global snake_case default.
- Any NEW field carrying metric values (e.g. `captureCoverage`, `specificationCoverage`, `inventoryReconciliation`) MUST use the same per-field camelCase `@JsonProperty` to avoid a mixed-casing payload.
- Keep the DTO a byte-stable shape: new gap codes ride the existing `gaps` list for free; add metric fields only if values must be exposed beyond the codes.

**Discovery Findings emission (reuse `FindingEmitter` / `emissionSources.ts` / `discoveryV3Pipeline.ts`)**
- Add ONE new builder in `emissionSources.ts` returning a `FindingEmitInput` of `findingType: 'evidence_gap'`, `category: 'evidence_gap'`, severity `'medium'` (matching every existing evidence-gap builder), linking the endpoint's discovery candidate via `supports`.
- Register the new sentinel(s) in the `EvidenceGapType` union (the single source of truth for `detail_json.gapType`).
- Wire emission at a dimension-B completeness rollup site in `discoveryV3Pipeline.ts` following the existing `buildLowConfidenceCandidateFinding` emit pattern (construct via `runContext`, emit via `findingEmitter`); reuse the built-in dedupe + soft-fail (never throws) and the `getRunAggregate` rollup as-is.

**Gateway proxy (confirm only — expected NO change)**
- `POST /api/v1/projects/:projectId/migration-discovery-context` already forwards the body verbatim and re-emits the AMS response (status + body) byte-for-byte; the new gap codes + camelCase metric fields round-trip with no gateway-side transformation. CONFIRM during build; do not modify.

**Frontend rendering (reuse the existing readiness surface — no bespoke widget)**
- Add the new camelCase metric fields to the `MigrationReadinessAssessment` type in `migrationDiscoveryContextApi.ts`; the new gap codes already flow through `gaps?: string[]`.
- Render the new codes/metrics where readiness already renders — the `MigrationDeliveryPlanWizard` readiness card (it shows `overallStatus`, the per-stream rows, and a `Gaps:` row). (NOTE: the verified render target is `MigrationDeliveryPlanWizard`, not `MigrationDeliveryDashboard` as the requirements pointer suggested — the dashboard folder does not consume `readinessAssessment` directly.)
- Per-endpoint dimension-B evidence-gap Findings appear on the existing Findings tab for free (standard `evidence_gap` findings); build NO new widget.

## Existing Code to Leverage

**AMS `service/migration/MigrationDiscoveryContextService.java` — `assessReadiness` / `buildBaselineSummary` / `build` / `ReadinessContext`**
- `assessReadiness(ReadinessContext)` (~line 967) is the home for all three coverage computations + the new gap codes; it already emits per-stream statuses and dedupes the `gaps` list at the end.
- `buildBaselineSummary(...)` (~line 861) loads `ApiBehaviourBaselineEntity` rows for the `(project, currentArchitecture)` tuple and exposes `getSessionId()` — the join key into operations/captures for (A) and (C).
- `build(...)` (~line 196) composes the `ReadinessContext` (~line 953) and calls `assessReadiness`; thread the new aggregates here. Resolve the model file via `ModelFileRepository` (the pattern `MetaModelSummaryService` uses) for the dimension-B reads.

**AMS `model/dto/migration/MigrationGapCodes.java` + `ReadinessAssessmentDto.java`**
- `MigrationGapCodes` holds the existing eight String-constant gap codes (`NO_API_BEHAVIOUR_BASELINE`, `HIGH_SEVERITY_UNREVIEWED_FINDINGS`, …) and the `STATUS_*` constants — add the three new codes here.
- `ReadinessAssessmentDto` is a record with explicit per-field `@JsonProperty("camelCase")` — extend HERE with any new camelCase metric fields, keeping the byte-stable shape.

**AMS `api_behaviour_*` entities + repositories (read-only — dimension A + C)**
- `ApiBehaviourOperationEntity` (`api_behaviour_operations`, keyed by `session_id`; carries `included` / `safe_to_execute` / `operation_id` / `method` / `path`) — the (A) denominator and one side of (C); finder `findBySessionIdOrderByCreatedAtAsc` already exists.
- `ApiBehaviourCaptureEntity` (`api_behaviour_captures`, by `session_id` + `operation_id`; carries `accepted` / `response_status` / `error_type`) — the "captured/executed" signal; finder `findBySessionIdOrderByCapturedAtAsc` exists.
- `ApiBehaviourBaselineItemEntity` (`api_behaviour_baseline_items`, by `baseline_id`; carries `operation_id` / `method` / `path`) = replayed-eligible; `ApiBehaviourDiffRepository.findBySourceBaselineId` → `ApiBehaviourDiffItemEntity` (`findByDiffIdOrderByMethodAscPathAsc`) = diffed. All finders exist — add a read-only finder ONLY if a specific join is missing.

**AMS dimension-B model reads (Specs 1 / 2 / 4)**
- `EndpointEntity` (`findByModelFileId` / `findByInterfaceId`; carries `protocol` / `endpoint_type` / `operation_verb` / `path_or_address` + SOAP `protocol_metadata_json` with `soap_action` / `request_root_element`) — the endpoint inventory + the SOAP-aware (C) key.
- `EndpointDataEffectRepository` (`findByEndpointId` / `findByModelFileId`) = Spec 1 REST bar; `InterfaceLogicalEntityRepository` (`findByInterfaceId` / `findByModelFileId`) = Spec 4 SOAP bar; `BusinessLogicEntity.behavior` JSONB via `BusinessLogicRepository` = Spec 2 BONUS only.

**Discovery `findings/FindingEmitter.ts` + `findings/emissionSources.ts` + `discoveryV3Pipeline.ts`**
- `FindingEmitter.emitFinding/emitFindings` (normalize + dedupe + soft-fail) and `getRunAggregate(runId)` → `{ totalEmitted, totalPersisted, totalDeduped }` (already surfaced into the run's `steps_payload`) — reuse for the dimension-B Findings + the per-endpoint rollup.
- `emissionSources.ts` holds the evidence-gap builder pattern + the `EvidenceGapType` union — add the new builder + sentinel(s) here; `discoveryV3Pipeline.ts` shows the `runContext`-based emit wiring to follow.

**Gateway `routes/migrationContext.ts` + frontend `migrationDiscoveryContextApi.ts` / `MigrationDeliveryPlanWizard.tsx`**
- The gateway proxy round-trips AMS byte-for-byte (no change). `MigrationReadinessAssessment` already carries `gaps?: string[]` + the per-stream fields (new codes free; new metric fields need adding). `MigrationDeliveryPlanWizard` is the existing readiness render surface (readiness card with `Gaps:` row).

**Harness `api-migration-validation-service` (read-only reference — prefer NO change)**
- `services/oasParser.ts` confirms operations enter `api_behaviour_operations` keyed by `{method, path}` (+ synthesized/real `operationId`) with no SOAP-action concept — the technical reason (C) needs a SOAP-aware key. `captureSessionOrchestrator.ts` / `diffRunner.ts` are read-only context for the (A) computation.

## Out of Scope
- Auto-remediation (re-running capture for missing operations) — surface only.
- A bespoke dashboard / coverage widget — reuse the existing readiness surface.
- Non-Spring-Classic protocols for dimension B (only REST + SOAP bars are defined).
- Any BLOCKING gate — strictly advisory; readiness downgrades only.
- Any new persistence — no new entity, no new table, NO Liquibase changeset (supersedes the raw-idea's "changeset ≥168" note).
- Any new meta-model entity TYPE, and never the auto-managed `*_points` wrappers.
- A discovery→harness operation manifest / new handoff exchange — reconciliation is a read-time compare of two independently-built inventories.
- A new harness endpoint — (A) is computed AMS-side from the `api_behaviour_*` tables AMS already owns.
- LLM use for the coverage logic — all three dimensions are deterministic compute.
- Requiring Spec 2 behaviour for "fully specified" — it is a bonus signal only.
