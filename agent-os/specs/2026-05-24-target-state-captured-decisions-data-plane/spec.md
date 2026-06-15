# Specification: Target State Captured Decisions — Data Plane

## Goal

Build the foundational backend data plane — a durable Architecture Model Service table, REST surface, gateway resolver, aggregation-DTO extension, conversation-thread persistence helper, and mapping-notes decoration utility — that the future architect-persona conversation (Spec 3) will write to and the downstream Product Manager Book of Work and Shape-Spec generation tasks (Spec 4) will read from. This spec ships the rails only; no UI, no LLM, no conversation logic, and the table is empty in every environment until Spec 3 starts writing.

## User Stories

- As a migration architect (future, via Spec 3), I want every answered concern question persisted as a first-class, scope-aware, supersedable row so that my reasoning chain survives session restarts, project re-opens, and revisions without losing audit history.
- As a downstream Product Manager prompt (future, via Spec 4), I want the captured architect decisions delivered as a bounded, grouped-by-scope summary alongside the existing Migration Discovery Context so that Book of Work and Shape-Spec generation can treat them as facts without re-asking the architect.
- As a backend developer building Spec 3, I want a stable thread-persistence helper, a registered context-resolver key, and an additive aggregation-DTO block already in place so that Spec 3 only writes the conversation orchestration, not the storage substrate.
- As an operator inspecting an existing project today, I want the new resolver to return a distinct "no target architecture defined yet" copy versus a "no decisions captured yet" copy so that downstream prompts can distinguish "nothing to ask about" from "asked but no answers yet".

## Specific Requirements

### Architecture Model Service — schema (one new Liquibase changeset)

- New changeset file using the next free number after the current tail in the existing Liquibase changelog directory. Never edit an applied changeset.
- New table `target_state_captured_decisions` with columns: `id` UUID PK, `project_id` UUID NOT NULL, `target_architecture_id` UUID NOT NULL, `decision_code` VARCHAR NOT NULL, `scope_kind` VARCHAR NOT NULL, `scope_ref_type` VARCHAR NULL, `scope_ref_id` VARCHAR NULL, `answer_value` TEXT NOT NULL, `answer_summary` VARCHAR NULL, `standards_lookup_ref` VARCHAR NULL, `conversation_thread_id` VARCHAR NULL, `conversation_turn_ref` VARCHAR NULL, `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW(), `created_by_task` VARCHAR NOT NULL (no DB default), `superseded_by_id` UUID NULL (self-FK).
- CHECK constraint enforcing the invariant: `scope_ref_type IS NOT NULL` if and only if `scope_kind = 'element'`. `scope_kind` is one of `architecture` / `service` / `interface` / `element`.
- Indexes: `(project_id, target_architecture_id)`; composite `(project_id, target_architecture_id, decision_code, scope_kind, scope_ref_id)` for the "latest decision per scope" read path; `decision_code` for cross-architecture analytics.
- No CHECK on `decision_code` values — open-ended by design so Spec 3 can grow the question library without DDL.
- No FK from this table to `architecture_element_mappings` — reverse-discovery happens via the notes-decoration tag.

### Architecture Model Service — Java entity, repository, DTOs

- New `TargetStateCapturedDecisionEntity` mapped to the new table; UUID-typed fields where the DDL is UUID; `Instant` for `created_at`; nullable wrapper types throughout.
- New `TargetStateCapturedDecisionDto` (response) and `CreateTargetStateCapturedDecisionRequest` (write). Both annotated with `@JsonNaming(LowerCamelCaseStrategy.class)` matching the selective-copy DTO pattern.
- All numeric and boolean fields on the new DTOs use boxed types (`Long`, `Integer`, `Boolean`) per the project's primitive-overwrite memory; this spec uses POST-only writes but stays consistent with project convention.
- New `TargetStateCapturedDecisionRepository extends JpaRepository<TargetStateCapturedDecisionEntity, UUID>`. Custom queries: latest non-superseded row per `(decision_code, scope_kind, scope_ref_id)` tuple for a given `(project_id, target_architecture_id)`; all rows (including superseded) for audit; rows for a given `decision_code` across all scopes.

### Architecture Model Service — service and controller

- New `TargetStateCapturedDecisionService` exposing `createDecision(...)`, `listLatestDecisions(projectId, targetArchitectureId)`, `listAllDecisions(projectId, targetArchitectureId)`, `findById(...)`, `findByDecisionCode(projectId, targetArchitectureId, decisionCode)`.
- `createDecision` is `@Transactional`: insert the new row, then if a prior non-superseded row exists for the same `(project_id, target_architecture_id, decision_code, scope_kind, scope_ref_id)` tuple, set its `superseded_by_id` to the new row's id in the same transaction. Never leave two non-superseded rows for the same tuple.
- Cross-project leak protection: every single-row lookup verifies the loaded row's `project_id` and `target_architecture_id` match the values from the request path; on mismatch return HTTP 404 (never 403 — avoid leaking existence). Applies to GET-single and POST-supersede paths.
- New controller mounted at `/api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions`. Endpoints: `POST /` (create), `GET /` (list latest by default; `?includeSuperseded=true` returns full audit), `GET /{decisionId}` (single row), `GET /by-code/{decisionCode}` (latest rows for that code across all scopes). No PUT / PATCH / DELETE — insert-only at the data plane.
- If `GET /api/projects/{projectId}/active-target-architecture-id` does not already exist on the Architecture Model Service, add it as part of this spec so the gateway resolver can look up the active target draft for a project.

### Gateway — proxy routes

- Add gateway proxy routes that forward each new captured-decisions endpoint to the Architecture Model Service, mirroring the existing target-architectures proxy shape.
- Add a gateway proxy route for the active-target-architecture-id lookup endpoint (if it was added on the Architecture Model Service side as part of this spec).

### Gateway — `target-state-decisions-context` resolver

- New `TargetStateDecisionsContextResolver` registered under key `target-state-decisions-context` in the gateway context-resolvers registry alongside the existing `migration-discovery-context` resolver.
- Add `target-state-decisions-context` to the `KNOWN_CONTEXT_KEYS` array in `gateway/src/services/contextResolvers.ts`. Code edit only — no database changeset.
- Resolution flow: resolve active project; call the new `GET /api/projects/{projectId}/active-target-architecture-id`; if no active target architecture exists return the distinct copy "no target architecture defined yet"; otherwise call `GET .../captured-decisions` (latest only); if zero rows return the distinct copy "no decisions captured yet"; otherwise render prompt-ready text grouped by scope (architecture-wide block first, then per-service / per-interface / per-element overrides), each line carrying `decision_code`, `answer_summary`, and the optional `standards_lookup_ref`.
- No transcript content in resolver output (transcript stays queryable separately, owned by Spec 3). No size cap in this spec — trust the Spec 3 question library to stay bounded.

### Architecture Model Service — `MigrationDiscoveryContextDto` extension

- Add a new top-level field `targetStateDecisionsSummary` of type `TargetStateDecisionsSummaryDto` to `MigrationDiscoveryContextDto`. Existing fields unchanged.
- New nested `TargetStateDecisionsSummaryDto` carrying `architectureWideDecisions: List<CapturedDecisionRefDto>`, `scopedOverrides: List<CapturedDecisionRefDto>`, `totalDecisionCount: Integer`, `lastDecisionAt: Instant` (nullable). Boxed types throughout.
- New `CapturedDecisionRefDto` carrying `decisionId`, `decisionCode`, `scopeKind`, `scopeRefId`, `answerSummary`, `standardsLookupRef`. All DTOs in this block annotated with `@JsonNaming(LowerCamelCaseStrategy.class)`.
- Aggregation service populates this block alongside the existing context blocks. Empty default (empty lists, count = 0, `lastDecisionAt` null) when no decisions exist so existing consumers see a consistent shape pre-Spec-3.
- Add `includeTargetStateDecisions` flag to the existing aggregation request body DTO, default `true`. Body field, not query param — matches the existing include-flag pattern on the aggregation request.

### Gateway — `targetStateConversationStore.ts` thread persistence helper

- New file sibling to the existing `gateway/src/services/threadStore.ts`. Do not extend `threadStore.ts` itself; new file mirrors its load-and-write shape and atomic-write pattern.
- File path convention: `{projectParentFolder}/threads/target-state-conversation/{targetArchitectureId}/thread.json`. Use `fetchProjectFolder(projectId)` to resolve `{projectParentFolder}` consistent with the existing thread storage pattern documented in project memory.
- Exported helpers: `loadTargetStateConversation(projectId, targetArchitectureId)` returning the file contents or the default envelope `{ schemaVersion: 1, threadId, turns: [] }` if the file does not exist; `appendTurn(projectId, targetArchitectureId, turn)` appending to `turns[]` and creating parent directories via `fs.mkdir({ recursive: true })`.
- Minimal envelope only: `{ schemaVersion: 1, threadId, turns: any[] }`. The helper does not inspect turn contents — Spec 3 defines turn shape.

### Architecture Model Service — mapping-notes decoration helper

- New small stateless utility class (suggested name `ArchitectureElementMappingNotesDecorator`) co-located with the existing `ArchitectureElementMappingService`.
- Single public method `decorateWithDecision(currentNotes, decisionCode)` returning a notes string with `[decision:<code>]` appended idempotently — if the exact tag for that decision code is already present in the input string, return the input unchanged.
- Stateless — no database access. Callers are responsible for persisting the returned string. This spec does not call the helper from any existing write path; Spec 3 and possibly Spec 4 will wire it in.
- This spec does NOT automate `mapping_type` rewrites (`equivalent` to `replaced_by` / `renamed` / `split` / `merged`) — that work belongs to Spec 3.

### Tests (backend only — 6 groups, 2 to 4 tests per group)

- **Architecture Model Service service tests** (2-4): create-then-supersede sets `superseded_by_id` atomically in one transaction; list-latest excludes superseded rows; list-all includes superseded rows; find-by-code returns latest rows across all scopes.
- **Architecture Model Service controller tests** (2-4): each endpoint happy path; 404 on cross-project access where the row's `project_id` or `target_architecture_id` does not match the path; JSON-naming round-trip verifying `@JsonNaming(LowerCamelCaseStrategy.class)` produces the lowerCamelCase keys.
- **Resolver tests** (2-4): no active target architecture returns the distinct "no target architecture defined yet" copy; populated target returns the bounded grouped-by-scope summary; target with zero decisions returns "no decisions captured yet"; `KNOWN_CONTEXT_KEYS` lookup resolves the new key to the new resolver.
- **Aggregation DTO extension tests** (2-4): aggregation endpoint returns the new `targetStateDecisionsSummary` block with the correct empty default shape; populated shape when decisions exist; existing fields unchanged so existing consumers do not break; `includeTargetStateDecisions=false` omits or zeroes the block per the implementation choice.
- **Thread persistence helper tests** (2-4): load-empty returns the default envelope; append-then-load round-trips the appended turn; parent directory auto-creates when missing.
- **Mapping-notes decoration helper tests** (2-4): empty input plus decision code produces a tagged string; pre-tagged input plus the same code is idempotent (no duplicate tag); pre-tagged input plus a different code appends the second tag.

## Out of Scope

- Architect-persona conversation orchestration, question library, standards-registry mechanics, per-element exception pinning — Spec 3.
- Conversation UI inside the Target State sub-tab — Spec 3.
- Updates to `product-manager--migration-delivery-plan` or `product-manager--migration-shape-spec-generation` prompts to consume the new context — Spec 4.
- Any frontend changes whatsoever in this spec.
- Any LLM call from this spec — pure backend infrastructure.
- Backfill of historical decisions (none exist).
- Decision-code enum validation on the Architecture Model Service side (open-ended by design; typo cost is "downstream sees no decisions found and the architect re-answers").
- Automated `mapping_type` rewrites driven by decisions — Spec 3.
- Revisability via PATCH / PUT / DELETE on captured decisions — insert-only at the data plane; revision is "write a new row".
- Conversation transcript exposed as its own resolver — Spec 3 owns transcript exposure if needed.
- Resolver size cap or truncation — Spec 3's question library is bounded.

## Existing Code to Leverage

### `gateway/src/services/threadStore.ts`

- Existing thread file input/output for the unified conversation engine. Uses `fetchProjectFolder(projectId)` to resolve the per-project base path, atomic-writes via `.tmp` rename, `fs.mkdir({ recursive: true })` for directory creation, ENOENT graceful degradation returning a default envelope.
- The new `targetStateConversationStore.ts` is a sibling file that mirrors the same path convention (`{projectParentFolder}/threads/...`), the same atomic-write pattern, and the same load-returns-default-on-missing behaviour. Not extended — kept untouched.

### `gateway/src/services/contextResolvers.ts` + `KNOWN_CONTEXT_KEYS` registry

- Existing registry of resolver keys including `migration-discovery-context`. The new `target-state-decisions-context` key is added to the `KNOWN_CONTEXT_KEYS` array and bound to the new `TargetStateDecisionsContextResolver` in the same registration block. Code edit only — no Liquibase changeset.
- The existing `MigrationDiscoveryContextResolver` sets the template for the new resolver's shape: resolve active project + active architecture, call an Architecture Model Service endpoint, render bounded prompt-ready text with citations, fall back to a distinct copy string when prerequisites are missing.

### `MigrationDiscoveryContextDto` (Architecture Model Service)

- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/migration/MigrationDiscoveryContextDto.java` and its aggregation service. This spec extends it additively with the new top-level `targetStateDecisionsSummary` field and the new include flag on the aggregation request body. Existing nested DTOs and existing fields are not modified.

### Selective-copy DTOs with `@JsonNaming(LowerCamelCaseStrategy.class)`

- Established the lowerCamelCase JSON serialization pattern used across recent Architecture Model Service DTOs. Every new DTO in this spec (`TargetStateCapturedDecisionDto`, `CreateTargetStateCapturedDecisionRequest`, `TargetStateDecisionsSummaryDto`, `CapturedDecisionRefDto`) carries the same annotation.

### `architecture_element_mappings` table and `ArchitectureElementMappingService`

- Existing mapping table and service. The new mapping-notes decoration helper lives co-located with this service and operates on the `notes` field shape that this table already uses. No schema change to the mappings table — the `[decision:code]` tag is appended to the existing free-form `notes` string.

## Implementation Notes

- **Liquibase immutability** (per `feedback_liquibase_immutable_changesets.md`): the new table goes in a brand new changeset file with the next free number after the current tail. Never edit an applied changeset, even for comment-only changes — Liquibase checksum validation will break startup.
- **Boxed types on DTOs** (per `project_primitive_double_dto_overwrite.md`): every numeric and boolean field on the new DTOs uses `Long` / `Integer` / `Boolean` rather than primitives. This spec's writes are all POST inserts (no PATCH), but staying consistent with the project pattern keeps the door open for future evolution without silent zero-overwrites.
- **Plain-English naming** (per `feedback_no_invented_acronyms.md`): write "Architecture Model Service" in error messages, log lines, and doc comments rather than introducing an acronym like "AMS". Internal Java class names follow existing conventions.
- **Atomic supersession**: the `createDecision` insert and the `superseded_by_id` update on the prior matching-tuple row must share one `@Transactional` boundary. Use Spring's default propagation; do not introduce `REQUIRES_NEW`. The composite index `(project_id, target_architecture_id, decision_code, scope_kind, scope_ref_id)` exists explicitly to make the "find prior row to supersede" lookup cheap.
- **Cross-project leak protection returns 404 not 403**: when the loaded row's `project_id` or `target_architecture_id` does not match the request path, return 404 to avoid leaking row existence to an attacker who guesses a sibling project's UUID.
- **Trace before coding** (per `feedback_trace_before_coding.md`): before adding the `GET /api/projects/{projectId}/active-target-architecture-id` endpoint to the Architecture Model Service, grep the existing controllers to confirm it is not already provided under a different name; only add if absent.
- **Pre-existing test failures** (per project memory): the listed pre-existing failures are unrelated to this work and must not be touched. The new tests in this spec are additive.
- **No edits to the discovery-service source tree during in-flight runs** (per `feedback_no_src_edits_during_run.md`): this spec does not touch `discovery-service/src/**`, so the constraint does not apply directly — but if any incidental work surfaces there during implementation, defer it until no discovery run is active.

## Commit Boundary

One commit covering:
- New Liquibase changeset creating `target_state_captured_decisions` with its CHECK constraint and the three indexes.
- New Architecture Model Service entity, repository, service, controller, request/response DTOs (all with `@JsonNaming`), plus the `active-target-architecture-id` lookup endpoint if not already present.
- New nested `TargetStateDecisionsSummaryDto` and `CapturedDecisionRefDto`, the `targetStateDecisionsSummary` field on `MigrationDiscoveryContextDto`, the new `includeTargetStateDecisions` flag on the aggregation request body, and the aggregation service wiring that populates the block (empty default when no decisions exist).
- New gateway proxy routes for the captured-decisions endpoints and for the active-target-architecture-id lookup (if added).
- New `gateway/src/services/targetStateConversationStore.ts` sibling helper file.
- New `TargetStateDecisionsContextResolver` plus the `target-state-decisions-context` entry in `KNOWN_CONTEXT_KEYS`.
- New `ArchitectureElementMappingNotesDecorator` (or similarly named) stateless utility.
- All six test groups listed under Tests, 2 to 4 tests per group.
- No frontend changes. No edits to applied Liquibase changesets.

## Definition of Done

- The new Liquibase changeset applies cleanly on a fresh database and on an upgraded database; the table, CHECK constraint, and three indexes are present.
- All four captured-decisions endpoints respond correctly: `POST` creates a row and supersedes any prior matching-tuple row in the same transaction; `GET /` returns latest-only by default and full audit with `?includeSuperseded=true`; `GET /{decisionId}` returns 404 on cross-project access; `GET /by-code/{decisionCode}` returns latest rows across all scopes.
- The Architecture Model Service exposes `GET /api/projects/{projectId}/active-target-architecture-id` (added if it did not already exist).
- The gateway resolver registered at `target-state-decisions-context` returns the distinct "no target architecture defined yet" copy when no active target exists, the distinct "no decisions captured yet" copy when a target exists but no decisions are captured, and a bounded grouped-by-scope summary when decisions are present. `KNOWN_CONTEXT_KEYS` lookup resolves the new key.
- `MigrationDiscoveryContextDto` aggregation responses include the new `targetStateDecisionsSummary` block with the correct empty default shape when no decisions exist; the include-flag on the request body suppresses or zeroes the block when set false; existing fields are byte-identical to pre-spec responses on a project with no decisions.
- The `targetStateConversationStore.ts` helper round-trips a JSON thread file under the expected `{projectParentFolder}/threads/target-state-conversation/{targetArchitectureId}/thread.json` path and creates parent directories when missing.
- The mapping-notes decoration helper produces tagged strings idempotently and never duplicates a tag for the same decision code.
- All new backend tests pass; all existing tests still pass (the aggregation DTO extension is additive and the pre-existing failures listed in project memory are untouched).
- The table is empty in every environment post-deploy (nothing writes to it in this spec). The resolver returns one of the two distinct fallback copies for every project until Spec 3 starts writing.
