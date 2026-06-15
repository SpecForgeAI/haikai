# Spec Requirements: AMS DTO `@JsonNaming` Audit Sweep

## Initial Description

The Architecture Model Service has a global Jackson `SNAKE_CASE` property-naming
strategy. 19 DTOs already carry a per-class `@JsonNaming(LowerCamelCaseStrategy)`
override that was added one bug at a time. The raw-idea proposes **flipping the
global default to `LOWER_CAMEL_CASE`** and removing the 19 overrides, on the
premise that all consumers actually speak camelCase. A pre-flight consumer
audit is mandated: if any consumer depends on snake_case, the spec stops and
reshapes.

The full raw-idea is in `planning/raw-idea.md`.

## Investigation Summary -- CRITICAL FINDING

The pre-flight consumer audit (Step 1 of the raw-idea) **does not support the
raw-idea's recommendation**. Multiple AMS consumers explicitly expect snake_case
wire format, with their TypeScript DTOs declared in snake_case and self-documenting
comments saying "matches AMS Jackson SNAKE_CASE". Flipping the global default
to camelCase would silently break them.

The raw-idea was based on incomplete information. Two of its quantitative
claims are wrong:

1. The "5 known `@JsonProperty("snake_case")` workarounds" claim is off by
   roughly two orders of magnitude. The codebase has **1,188 `@JsonProperty`
   annotations with snake_case values across 164 files**. These are not all
   "workarounds for the global default" -- they're explicit declarations of
   snake_case wire format. Many of them coincide with what the consumers
   already read.

2. The "discovery-service Python client" claim is wrong about language.
   `discovery-service` is **TypeScript, not Python**. Its AMS client
   (`discovery-service/src/services/archModelClient.ts`, 2,270 lines) speaks
   snake_case to AMS deliberately, with explicit mapper functions like
   `mapFindingCreateToBackend` whose docstring is *"Maps a camelCase create
   payload to the snake_case body the AMS DTO expects."*

The 19 `@JsonNaming` overrides are not evidence of a global-default trap.
They are evidence of a **deliberate per-endpoint exception pattern**: most
of AMS speaks snake_case at the wire, and a small number of newer endpoints
(Selective Copy, captured-decisions data plane, target-state architectures,
Discovery candidate/mapping) speak camelCase because their callers were built
that way.

## Requirements Discussion

### First Round Questions — Accepted Answers (2026-05-25)

User accepted all defaults. Decisions to encode in the spec:

- **Q1 Reshape confirmed.** Option D (single-commit global flip) is off the
  table per Decision 2 of the raw-idea — the pre-flight audit found
  snake_case-dependent consumers, so the "stop and reshape" trigger fires.
- **Q2 Direction: Option (B) — No-op + custom marker.** Leave the global at
  SNAKE_CASE. Leave the 19 camelCase exception DTOs as camelCase. Extract
  a custom marker annotation `@CamelCaseWire` wrapping
  `@JsonNaming(LowerCamelCaseStrategy)`, apply to those 19 files, document
  the pattern centrally. Goal: make the existing exception island legible
  to future contributors without touching wire format anywhere.
- **Q3 Annotation name: `@CamelCaseWire`.** Lives at
  `architecture-model-service/src/main/java/com/example/architecturemodel/jackson/CamelCaseWire.java`
  (or matching package). Reads naturally on a DTO declaration; avoids "Json"
  prefix collision with Jackson's own annotations.
- **Q4 Documentation location: Javadoc on the annotation itself + a
  paragraph in repo-root `CLAUDE.md`** under an "AMS wire format" heading.
  Skip an AMS-level README to avoid drift.
- **Q5 Per-class Javadoc rewrite: collapse to one sentence per file.**
  Example: "Marked `@CamelCaseWire` because the Selective Copy frontend
  speaks camelCase." Delete the longer "the global Jackson SNAKE_CASE
  strategy means…" paragraphs since the annotation Javadoc carries that
  knowledge centrally.
- **Q6 Drop raw-idea Step 4 (`@JsonProperty` cleanup).** Count was off by
  two orders of magnitude (1,188 vs 5), and the annotations are mostly
  working as intended (belt-and-braces snake_case declarations against
  consumer-side expectations). Removing them is not a no-behaviour-change
  operation.
- **Q7 Drop raw-idea Step 5 (test fixture updates).** No wire-format change
  → no test fixtures need touching.
- **Q8 Future dual-tolerance hardening: name in Out of Scope, do not
  build.** Pointer: `workItemSearchService.ts`, discovery client and others
  could adopt the `coerce(snake, camel)` pattern from
  `frontend/src/api/epicCapturedDecisionsApi.ts` so a future flip wouldn't
  break them. Worth naming so the next contributor knows the option exists.
  Not part of this spec.
- **Q9 `architecture-read-service` deferred.** The investigation didn't
  grep it; if it calls AMS the implementer should add it to the consumer
  audit table before claiming completeness, but the spec direction doesn't
  hinge on the answer.
- **Q10 Commit boundary: ~21 files.** 1 new `CamelCaseWire.java` annotation
  + 19 DTO/controller/mapper files swapping `@JsonNaming(...)` for
  `@CamelCaseWire` (with import cleanup and per-file Javadoc trim) + 1
  `CLAUDE.md` edit. YAML untouched. Tests untouched.

**Net effect on the codebase:** No wire-format change anywhere. No runtime
behaviour change. Existing 19 `@JsonNaming` overrides become `@CamelCaseWire`
which is runtime-identical (a meta-annotation that resolves to the same
`@JsonNaming(LowerCamelCaseStrategy)`). The exception island is now named.

## Visual Assets

No visual assets provided. The user explicitly instructed not to ask for any --
this is a configuration + annotation-removal spec with no UI surface.

## Authoritative Counts and File Lists (Step 1 of raw-idea, deliverable)

### `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)` -- 19 files

Confirmed via `git grep -l "@JsonNaming" architecture-model-service/src/main/java/`.
Matches the raw-idea's list exactly.

Controllers (3):
- `controller/ActiveTargetArchitectureController.java`
- `controller/CapturedDecisionsApplyMappingMutationsController.java`
- `controller/TargetStateCapturedDecisionsController.java`

Mappers (1):
- `mapper/TargetStateCapturedDecisionMapper.java`

DTOs (15):
- `model/dto/ArchitectureElementMappingDto.java`
- `model/dto/CreateArchitectureElementMappingRequest.java`
- `model/dto/SelectiveCopyCommitRequest.java`
- `model/dto/SelectiveCopyCommitResponse.java`
- `model/dto/SelectiveCopyPreflightRequest.java`
- `model/dto/SelectiveCopyPreflightResponse.java`
- `model/dto/SuggestFromCurrentRequest.java`
- `model/dto/SuggestFromCurrentResponse.java`
- `model/dto/UpdateArchitectureElementMappingRequest.java`
- `model/dto/targetstate/ApplyMappingMutationsRequest.java`
- `model/dto/targetstate/ApplyMappingMutationsResponse.java`
- `model/dto/targetstate/CapturedDecisionRefDto.java`
- `model/dto/targetstate/CreateTargetStateCapturedDecisionRequest.java`
- `model/dto/targetstate/TargetStateCapturedDecisionDto.java`
- `model/dto/targetstate/TargetStateDecisionsSummaryDto.java`

These mark the **camelCase exception island** in an otherwise snake_case wire
surface. They were added because their callers (gateway Selective Copy proxy,
target-state UI surfaces, captured-decisions data plane) speak camelCase.

### `@JsonProperty` annotations -- 1,188 occurrences across 164+ files

Not 5 as the raw-idea claimed. A sample of the snake_case-valued ones:
- `WorkItemDto.java` -- 16 snake_case `@JsonProperty` rows. Class-level Javadoc
  literally says *"Uses Java record with @JsonProperty annotations for
  snake_case JSON serialization."* These are intentional.
- `DiscoveryRunController.java` -- 7 snake_case `@JsonProperty` rows on inline
  records (`service_id`, `confirm_llm_solo`, `service_identity_snapshot`,
  `discovery_kind`, `current_step`, `steps_payload`, `error_message`).
- `DiscoveryCandidateDto.java` -- 10 snake_case `@JsonProperty` rows.
- `DiscoveryConfigDto.java` -- 4 snake_case rows.
- ...and ~160 other files.

Most of these explicit `@JsonProperty` annotations are not "defeats of the
global default" -- they're belt-and-braces declarations that the wire is
snake_case. Removing them would still leave the wire snake_case (because the
global is SNAKE_CASE). So the raw-idea's Step 4 ("remove the 5 known
workarounds") is based on a count that doesn't match reality.

### DTO package breakdown

- Total DTO files under `model/dto/`: **266**
- DTOs with `@JsonNaming` (camelCase exception): **15** (plus 4 non-DTO files
  carrying it -- controllers / mapper)
- DTOs with `@JsonProperty` but no `@JsonNaming`: **185** (~70% of all DTOs)
- DTOs with neither annotation: **66** (~25% of all DTOs -- these are the
  ones that rely on the global default)

The 66 "neither" DTOs are the only ones whose wire format would change if
the global default were flipped. The other 200 stay snake_case via their
explicit `@JsonProperty` annotations.

### YAML configuration -- 2 locations

Both confirmed:
- `architecture-model-service/src/main/resources/application.yml:35` --
  `property-naming-strategy: SNAKE_CASE`
- `architecture-model-service/src/test/resources/application.yml:28` --
  `property-naming-strategy: SNAKE_CASE`

### AMS test fixtures with raw-JSON request bodies -- 5 files

Files using `.content("{...}")` pattern (Step 5 surface from raw-idea):
- `controller/DiscoveryRunControllerArchitectureScopingTest.java`
- `controller/DiscoveryRunControllerKindTest.java`
- `controller/DiscoveryRunControllerTest.java`
- `controller/MigrationStorySpecGenerationControllerManualEditTest.java`
- `controller/OrganisationControllerTextIdTest.java`

Plus 77 test files using `jsonPath(...)` assertions; many use snake_case keys.
A sample of 173 distinct snake_case `jsonPath` keys was extracted -- enough
to confirm the assertion surface is significant if the wire ever flips.

## Consumer Audit Table (Step 1 deliverable)

This is the most important output of the research phase. Each row was confirmed
by reading the consumer's source code.

| Consumer | AMS endpoint family | Wire format expected | Source-code evidence |
| --- | --- | --- | --- |
| `gateway/src/services/architectureModelClient.ts` -- `WorkItemStatsResponse` | `GET /api/model/projects/{projectId}/work-items/stats` | **snake_case** | Interface declares `type_counts`, `stories_with_ac_count`. Comment: *"Uses snake_case field names to match the Java backend's JSON output (consistent with how all other client interfaces in this file use the backend's casing directly)."* |
| `gateway/src/services/workItemSearchService.ts` -- `WorkItemDto` | `GET /api/model/projects/{projectId}/work-items/search` | **snake_case** | Comment: *"Raw DTO matching architecture-model-service response (snake_case)"*. Fields: `project_id`, `parent_id`, `sort_order`, `target_window`, `external_system`, `external_key`, `created_at`, `updated_at`. Matches `WorkItemDto.java`'s explicit `@JsonProperty("snake_case")` annotations. |
| `gateway/src/services/epicCapturedDecisionsClient.ts` -- `EpicCapturedDecisionDto` | `GET/POST/PATCH/DELETE /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions` | **snake_case + camelCase tolerated** | Comment: *"Captured-decision row shape on the wire (snake_case + camelCase tolerated)"*. Interface uses camelCase fields but the wire receives snake_case (matches AMS `EpicCapturedDecisionDto.java` which has neither `@JsonNaming` nor `@JsonProperty` -- uses global SNAKE_CASE). |
| `gateway/src/services/jiraImportService.ts` | (jira-service, not AMS -- but same pattern) | snake_case | Self-comment: *"Uses snake_case field names to match the JSON serialization."* Not in scope for this spec. |
| `gateway/src/services/jiraSyncService.ts` | (jira-service, not AMS) | snake_case | Multiple comments referencing jira-service's own global Jackson SNAKE_CASE. Not in scope for this spec. |
| `gateway/src/services/migrationShapeSpecGenerationHandler.ts` -- `MigrationStorySpecGenerationDto` | `GET/POST .../migration-story-spec-generations/...` | **snake_case** | Comment: *"`MigrationStorySpecGenerationDto` on the AMS side (snake_case JSON via global)."* The handler re-serialises camelCase intermediate state back to snake_case for the AMS wire. |
| `gateway/src/services/migrationDiscoveryContextClient.ts` | `POST /api/projects/{projectId}/migration-discovery-context` | snake_case (via global) plus `@JsonProperty` overrides | AMS `MigrationDiscoveryContextDto.java` and `MigrationDiscoveryContextRequestDto.java` carry explicit snake_case `@JsonProperty` rows. |
| `gateway/src/services/migrationSpecContextClient.ts` | similar | snake_case | Mirrors above. |
| `discovery-service/src/services/archModelClient.ts` (entire file) | Multiple POST/PATCH/GET to `/api/model/projects/.../discovery/...` | **snake_case on both send and receive** | 21 in-file references to snake_case. TypeScript interfaces use snake_case (`run_id`, `project_id`, `architecture_id`, `service_id`, `cluster_type`, etc.). Send-side mappers like `mapFindingCreateToBackend` explicitly translate camelCase → snake_case before POSTing. Receive-side mappers like `mapFindingFromBackend` accept both shapes (`raw.run_id ?? raw.runId`) for forward-compatibility. |
| `api-migration-validation-service/src/services/archModelClient.ts` | `GET /api/model/projects/...`, `POST/PATCH .../capture-sessions/...` | **snake_case** | Top-of-file comment: *"Wire DTOs -- snake_case to match AMS Jackson naming strategy."* All interfaces use snake_case fields. |
| `frontend/src/api/apiBehaviourClient.ts` | proxied via gateway to AMS | **snake_case** | Comment: *"DTOs (snake_case -- matches AMS Jackson SNAKE_CASE)"*. Fields: `project_id`, `architecture_id`, `auth_type`, `auth_config_redacted_json`, etc. |
| `frontend/src/api/bookOfWorkApi.ts` | proxied via gateway | snake_case → mapped to camelCase | Multiple comments: *"Work item DTO from API (snake_case)"*, *"Maps a work item DTO from snake_case (API) to camelCase (frontend)"*. |
| `frontend/src/api/discoveryApi.ts` | proxied via gateway | snake_case | Comment: *"Field names use snake_case to match the JSON serialization"* and *"(snake_case JSON keys because AMS persists the Map<String,Object> ...)"*. |
| `frontend/src/api/findingsApi.ts` | proxied via gateway | snake_case | Comment: *"The TypeScript DTO shapes mirror the AMS DTOs verbatim using snake_case to ..."* and *"Mirrors the AMS DiscoveryFindingDto record (snake_case via the global ...)"*. |
| `frontend/src/api/implementContextApi.ts` | proxied via gateway | snake_case → mapped to camelCase | Comment: *"Backend response/request DTO for implement context (snake_case)"*. |
| `frontend/src/api/epicCapturedDecisionsApi.ts` | via gateway | snake_case + camelCase tolerated | Already future-proofed: *"Private wire shape -- accepts BOTH snake_case and camelCase keys so we stay resilient to a Jackson naming-strategy flip."* |
| `frontend/src/api/<other AMS surfaces>` -- Selective Copy, target-architecture | proxied via gateway | **camelCase** | These are the surfaces the 19 `@JsonNaming`'d DTOs serve. Frontend types are camelCase to match. |
| `jira-service` | does not call AMS | n/a | grep confirmed no AMS HTTP client in `jira-service/src/`. |
| AMS internal HTTP tests (`mockMvc`) | self-tests | mostly snake_case in `jsonPath` and raw bodies | 173 distinct snake_case `jsonPath` keys in 77 test files; 5 test files use `.content("{...}")` pattern. |

**Verdict:** the consumer audit decisively contradicts the raw-idea's instinct
that "no consumer relies on snake_case from AMS". The opposite is true: the
**majority** of AMS endpoints' callers depend on snake_case. The 19 `@JsonNaming`
overrides are a minority island (Selective Copy, target-state architectures,
captured-decisions data plane). Frontend/gateway/discovery/api-migration code
explicitly self-documents the dependency on snake_case.

Per raw-idea Decision 2 ("Pre-flight check is mandatory ... if any do, they're
documented and either updated atomically or the spec stops and reshapes"),
this finding **forces a reshape**. Option D (flip the global) is no longer
viable as a single-commit change. The realistic options now are:

- **Option C (revised):** Annotate the 19 currently-overridden DTOs as
  `@JsonNaming(LowerCamelCaseStrategy)` (they already are -- no change),
  leave the global at `SNAKE_CASE`, and stop. The trap remains but is no
  worse than today. This is essentially a no-op.
- **Option E (newly proposed):** Make the per-DTO override pattern more
  discoverable -- e.g. extract a custom marker annotation `@CamelCaseWire`
  that wraps `@JsonNaming(LowerCamelCaseStrategy)` plus a Javadoc constant
  with an explanation, so contributors see a one-line idiom instead of a
  cryptic Jackson annotation. Still per-DTO, still safe, still doesn't
  surprise consumers. Documents the invariant explicitly without flipping it.
- **Option F (multi-spec migration):** Plan a sequenced multi-commit migration
  that (a) adds dual tolerance on every consumer first (like
  `epicCapturedDecisionsApi.ts` already has), (b) then flips the global, (c)
  then removes the now-dead snake_case branches from consumers. This is real
  product work, not a config sweep. Probably out of scope for the current
  exercise.

## Other Constraints the Implementer Needs to Know

These are not in the raw-idea but emerged from the investigation:

1. **`@JsonProperty` annotations are mostly meaningful, not "workarounds".**
   The raw-idea's Step 4 ("remove the 5 known workarounds") cannot be done as
   described. Even after enumerating the 1,188 snake_case `@JsonProperty`
   rows, deciding which are "redundant" vs "intentional" requires per-row
   judgement that depends on whether the consumer side is camelCase or
   snake_case. Today the consumer side is overwhelmingly snake_case, so
   **all** explicit snake_case `@JsonProperty` rows are actually working as
   intended -- they're a belt-and-braces guard against accidental flips of
   the global default. Removing them is not safe.

2. **Some `@JsonProperty` annotations on inline records inside controllers
   (e.g. `DiscoveryRunController.java`) carry meaning beyond naming.** They
   pin the API contract for inline request bodies that are not declared as
   separate DTO classes. Removing them silently would change the wire shape.

3. **The frontend's `epicCapturedDecisionsApi.ts` and similar dual-tolerance
   clients reveal a pattern the codebase has converged on for risky surfaces.**
   When a flip happens, that's the model: make the client accept both first,
   then change the server. Doing it the other way around silently breaks
   the integration.

4. **The 5 known `.content("{...}")` test files are likely small-surface.**
   If a per-DTO `@JsonNaming` flip is ever made (e.g. adding the override to
   a new DTO), these tests need to be checked individually. Listing them
   here for future reference:
   - `DiscoveryRunControllerArchitectureScopingTest.java`
   - `DiscoveryRunControllerKindTest.java`
   - `DiscoveryRunControllerTest.java`
   - `MigrationStorySpecGenerationControllerManualEditTest.java`
   - `OrganisationControllerTextIdTest.java`

5. **The test application.yml mirrors prod (`SNAKE_CASE`).** Any flip needs
   both. The raw-idea got this right.

6. **AMS tests use `jsonPath("$.snake_case_key")` heavily.** 173 distinct
   snake_case keys observed across 77 files. The implementer would need to
   audit ~all of these if the global is flipped. The raw-idea's instinct
   ("expect single digits") was off by an order of magnitude.

## Requirements Summary

### Functional Requirements

There is **no functional change** to AMS endpoint behaviour in any branch of
this spec. The decision is purely about:

- Whether to leave the wire format as-is (global SNAKE_CASE + per-DTO camelCase
  exception islands).
- Whether to invest in making the exception pattern more visible (custom
  marker annotation, README note).
- Whether to plan a future migration toward camelCase everywhere (multi-commit,
  consumer-first).

### Reusability Opportunities

- The dual-tolerance pattern in `frontend/src/api/epicCapturedDecisionsApi.ts`
  is the reference shape if any future endpoint needs to migrate.

### Scope Boundaries

**In Scope (whatever direction the user picks):**

- Documenting the consumer-audit finding (this file).
- A short decision in the spec body about which option to pursue.
- Whatever minimal config / annotation / doc change supports that decision.

**Out of Scope:**

- The original raw-idea direction (flip the global to LOWER_CAMEL_CASE in
  one commit). The audit blocks this.
- Removing the 19 `@JsonNaming` overrides. They are doing real work.
- Removing the ~190 snake_case `@JsonProperty` annotations. They are mostly
  intentional.
- Any consumer-side change (gateway, discovery, api-migration-validation,
  frontend). Even if we wanted to plan a multi-spec migration, the consumer
  updates would be separate specs.

### Technical Considerations

- The test suite has hundreds of snake_case `jsonPath` assertions and 5
  raw-JSON-body test files; any wire-format change has a large test-fixture
  surface, not the "single digits" the raw-idea expected.
- `architecture-read-service` exists at the repo root but wasn't called out
  in the raw-idea or audit; if it also calls AMS it would need adding to the
  consumer audit.
- The frontend types follow the gateway types follow the AMS wire format
  layer by layer; flipping any single endpoint's wire format means touching
  three layers in the same change.
