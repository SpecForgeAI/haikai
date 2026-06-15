TITLE: Capture coverage gates (Spec 5 — FINAL spec of the HAIKAI discovery-richness program)

CONTEXT: HAIKAI is a like-for-like API/DB migration tool. The north star is an auto-loop where "all endpoints produce the same response for both current and target state." That only holds if EVERY discovered endpoint is (a) richly specified by discovery (Specs 1-4) AND (b) captured→replayed→diffed by the runtime harness (`api-migration-validation-service`). This is the program's "completeness critic" capstone. Program status: Issue 1 + Specs 1-4 + Issue 2 are built; this is the last spec.

PROBLEM/GOAL: Today there are SILENT coverage gaps. Make coverage VISIBLE and GATED — "no silent gaps."

THREE COVERAGE DIMENSIONS (scope is which are in v1):
- (A) CAPTURE coverage (harness): of the M operations in a baseline, how many were actually captured→replayed→diffed? (the "10 of 50 executed, silently completed" gap).
- (B) DISCOVERY specification coverage: of the discovered endpoints, how many are "fully specified" (have a resolved data-effect / behaviour / message shape from Specs 1/2/4)?
- (C) INVENTORY reconciliation: does discovery's endpoint set MATCH the harness's OAS operation set? (an endpoint discovered but absent from the OAS the harness captures = a silent gap; and vice versa).

CURRENT STATE (factual, just mapped): The harness enumerates operations from OAS/WSDL into `api_behaviour_operations` (per `{method,path}`, with `included`/`safe_to_execute`); baselines carry `operationCount` + `acceptedCaptureCount` COUNTS but NO per-operation captured/replayed/diffed status (no manifest). AMS `MigrationDiscoveryContextService.assessReadiness()` already produces `ReadinessAssessmentDto` + gap codes (`MigrationGapCodes`) but NO capture-coverage code; exposed via `POST /api/v1/projects/{projectId}/migration-discovery-context` (gateway `migrationContext.ts`). Discovery has `FindingEmitter` + a run aggregate + evidence-gap Findings but no per-endpoint "fully specified?" rollup and no "discovered-but-not-in-capture-manifest" signal. Frontend `MigrationDeliveryDashboard` has no coverage widget. No per-operation coverage persistence; the discovery→harness handoff carries findings/context but NOT an explicit operation manifest.

META-MODEL GROUNDING (must conform to `gateway/src/config/prompts/shared/architecture-context-explainer.md`): coverage/readiness is migration-process REALITY, NOT architecture — Spec 5 must NOT add new meta-model entity TYPES. Discovery-side coverage = Findings + run aggregates; harness-side coverage = the EXISTING `api_behaviour_*` migration-process data plane (already separate from the architecture meta-model). Never create the auto-managed `*_points` wrappers.

CONSTRAINTS: AMS snake_case (no @CamelCaseWire); NEW Liquibase changeset files only if persistence is added (next ≥168; 167 is Spec 4's); no discovery-service/src edits during an in-flight run; LLM via the gateway relay. REUSE (don't fork): `assessReadiness()` + `MigrationGapCodes` + `ReadinessAssessmentDto`, the `FindingEmitter` run aggregate, the `api_behaviour_*` tables + `captureSessionOrchestrator`/`diffRunner`, the existing readiness frontend.
