# Spec K — Scenario Coverage Floor

**Program:** Code-Tier Oracle (see `agent-os/planning/2026-07-06-code-tier-oracle-gap-analysis.md`)
**Closes:** Gap P7 — capture coverage is advisory ("≥1 accepted item, override allowed")
and the scenario rubric misses contract-derivable dimensions.

## Goal

Every endpoint's baseline must cover a MINIMUM scenario matrix derived from its committed
contracts, the score is persisted and queryable, and the floor is enforced at the Spec I
gate with explicit waivers instead of a blanket override.

## Evidence / current behaviour

- A real rubric already exists (`api-migration-validation-service/src/services/captureSessionOrchestrator.ts:639–870`):
  generated scenarios carry `expectedStatus` intents, canonical-capture selection decides
  "achieved", auth contributes a dedicated dimension, scoring reuses `selectCanonicalCapture`
  verbatim. This spec EXTENDS it; it does not replace it.
- Start-gate is "zero unaccounted endpoints OR `coverageOverrideJustification`" (409) at
  `captureSessionActions.ts:1356–1400` — endpoint-level presence, not scenario depth, and
  the override is blanket.
- Missing dimensions: pagination, content-type variants, request-validation-error
  scenarios — all derivable from committed `request_contract`/`response_contract`.
- Runtime evidence contributes usage counts only (no bodies in access logs; no HAR
  ingestion anywhere in the repo) — usable for PRIORITIZATION only.

## Scope

### 1. Rubric dimension extensions (scenario generation + scoring)

Derived deterministically from committed contracts at scenario-generation time:

- **Declared error statuses:** one dimension per distinct status in
  `response_contract.error_responses[]` (existing behaviour verified/kept; fill gaps).
- **Validation errors:** for each `request_contract.request_validation[]` constraint
  class (NotNull/Size/Pattern/Min/Max/...), one dimension "violate this constraint →
  expected 4xx" (grouped per field-constraint class, capped
  `COVERAGE_VALIDATION_DIMENSIONS_MAX` default 8 per endpoint, overflow visible in score
  detail — nothing silent).
- **Content-type variants:** when `consumes[]`/produces indicate >1 media type, one
  dimension per media type.
- **Pagination:** when the endpoint is list-shaped (page/size/offset params in
  `request_contract.param_formats[]` or list envelope in `serialization`), dimensions:
  first page, non-first page, and past-the-end page.
- **Auth:** existing dimension kept (401/403 variants when method security present).
- Runtime-evidence usage counts order scenario EXECUTION priority (busiest endpoints
  first); they never gate.

### 2. Persisted per-endpoint coverage score

- Persist the rubric outcome per (baseline, operation): dimensions total/achieved/missed
  (with reasons: `value_not_reachable`, `not_attempted`, `mutating_skipped`), score, and
  rubric version. AMS storage (NEW changeset), snake_case DTO, read endpoint for the
  gateway (joins into readiness / migration-discovery-context summaries).

### 3. Floor policy + enforcement

- Floor definition (config, defaults): happy path + every declared-error-status dimension +
  auth dimensions when secured + ≥1 validation dimension when constraints exist.
  Pagination/content-type dimensions are REPORTED but below-floor by default (tunable).
- Enforcement point: Spec I's pre-dispatch gate emits `code_coverage_floor_unmet` listing
  endpoint + missed dimensions. Capture-session start keeps its current 409 semantics.
- Waivers: per (endpoint, dimension) with reason — same waiver table as Specs I/J
  (dimension scope added). Blanket `coverageOverrideJustification` remains only for
  capture-session start, and is recorded INTO the score detail so the gate still sees the
  true per-dimension state.

## Non-goals

- HAR/traffic ingestion (future). Changing capture-loop mechanics. Field-level coverage.

## Acceptance criteria

1. **DIMENSION PIN:** endpoint with 2 declared error statuses, 3 validation constraint
   classes, secured, single media type, list-shaped → rubric = happy + 2 error + 3
   validation + auth + 3 pagination dimensions; deterministic across runs.
2. **SCORE PIN:** rubric outcome persisted and readable per (baseline, operation) with
   missed-dimension reasons.
3. **FLOOR PIN:** missed declared-error dimension → gate lists
   `code_coverage_floor_unmet` with endpoint + dimension; achieving it clears the code.
4. **WAIVER PIN:** waived dimension → floor passes with waiver id in the gate detail.
5. **PRIORITY PIN:** scenario execution order follows runtime usage counts when present;
   absence of runtime evidence changes nothing else.
6. Existing rubric behaviours (canonical selection, auth dimension) regression-pinned.

## Test plan

Rubric-extension unit tests over contract fixtures (pin 1,6); AMS persistence + read tests
(pin 2); gate integration tests with Spec I's suite (pins 3–4); orchestrator ordering test
(pin 5). Baseline discipline as per program.

## Dependencies & sizing

Depends on: committed contracts (present today; L enriches later). Feeds: Spec I gate.
Size: **S**. Build alongside I.

---

## Amendment 2026-07-06 — capture-scan review (gap analysis §9)

- **Optional lifecycle dimension (§1):** where a resource exposes a create+read (and
  optionally update/delete) endpoint family on the same interface, add a REPORTED-only
  `resource_lifecycle` dimension (create→read→[update→read]→[delete→read] chain) that
  reuses the EXISTING sequence machinery (`pin_sequence` / sequence replay with cross-step
  reference volatility — already round-trip tested). Below-floor by default; mutating
  steps still require `mutating_calls_confirmed`. No new sequencing engine.
- **Floor ↔ plan linkage:** the persisted per-interface floor state (§2 scores aggregated
  by interface) is the input Spec G's amendment uses to emit "Baseline capture & coverage"
  stories — the score read endpoint must therefore support interface-level aggregation
  (endpoint ids in, per-dimension state out).
- **Additional acceptance criterion:** **LIFECYCLE PIN** — an interface with POST+GET on
  the same resource reports the lifecycle dimension (achieved iff the pinned sequence's
  canonical captures exist); its absence never blocks the floor by default.
