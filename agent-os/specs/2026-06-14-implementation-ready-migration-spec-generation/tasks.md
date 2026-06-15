# Task Breakdown: Implementation-Ready Migration Spec Generation (Spec 1 of 4)

## Overview
Total Tasks: 5 task groups

This feature spans three stacks. The dependency chain is strictly linear and the groups MUST be built in order:

1. **AMS persistence (foundation)** — changeset 181 + entity/DTO/mapper fields. Everything downstream persists the two new fields, so this lands first.
2. **Gateway generator enrichment** — structured `tests` + `coveredEndpointIds` in the validator, prompt, and task config; inline test-pack assembly into `generated_spec_text`; persist the two new fields to AMS.
3. **Gateway implement-state write** — map the enriched output to `PlannerResponse` + `TestPlannerResponse` and PUT `implement-state.json` per story.
4. **Frontend review surface** — scope/AC/Test Pack/confidence/insufficient tiles on `StoryResultDrawer` + the Implement-tab Specs surface (read-only tiles).
5. **Test review & gap analysis** — up to 10 strategic tests over the end-to-end behaviour.

Reuse the existing per-story success path in `migrationShapeSpecGenerationHandler.ts` and the existing `PUT /api/implement-state` route — no new generator, no new route, no new AMS endpoint.

## Task List

### Database Layer (AMS)

#### Task Group 1: Changeset 181 + Entity/DTO/Mapper Fields
**Dependencies:** None

Adds two new nullable JSONB columns to `migration_story_spec_generations` — the structured-tests array and the forward-only `covered_endpoint_ids` — following the entity's established sibling-JSONB idiom (`decisions_json` / `interfaces_json` / `assumptions_json` / `warnings_json`: `@Type(JsonType.class)`, boxed reference types, null-guarded PATCH). The read/write endpoints must round-trip both fields.

- [x] 1.0 Complete AMS persistence layer for the two new columns
  - [x] 1.1 Write 2-8 focused tests for the new columns
    - Add an entity/DTO round-trip test (extend or sibling the existing `MigrationStorySpecGenerationControllerManualEditTest` / `...Test` style under `architecture-model-service/src/test/...`): POST/PUT a row carrying `structured_tests_json` (array of `{title, description, type}`) + `covered_endpoint_ids` (array of strings), GET it back, assert both survive verbatim.
    - Add a null-guard test: PATCH a row that OMITS both new fields and assert the previously-persisted values are NOT wiped (the canonical `project_primitive_double_dto_overwrite.md` pitfall).
    - Add an empty-array test for `covered_endpoint_ids` (non-endpoint story) — empty array persists and reads back as empty (not null-collapsed in a way that breaks the round-trip).
    - Limit to 2-8 tests; do NOT exhaustively cover every existing column.
  - [x] 1.2 Create Liquibase changeset `181-implementation-ready-spec-fields.sql`
    - NEW changeset only (latest applied = `180-implementation-init-and-repo-map.sql`); never edit an applied changeset (`feedback_liquibase_immutable_changesets.md`).
    - `ALTER TABLE migration_story_spec_generations ADD COLUMN structured_tests_json jsonb NULL;`
    - `ALTER TABLE migration_story_spec_generations ADD COLUMN covered_endpoint_ids jsonb NULL;`
    - Add `COMMENT ON COLUMN` blocks documenting each (structured unit/functional test pack; forward-only model-endpoint UUIDs the story migrates — empty for non-endpoint stories, NOT consumed in v1).
    - Register the changeset file in `db/changelog/db.changelog-master.yaml` after 180.
  - [x] 1.3 Add the two fields to `MigrationStorySpecGenerationEntity.java`
    - `@Type(JsonType.class) @Column(name = "structured_tests_json", columnDefinition = "jsonb") private List<Map<String, Object>> structuredTestsJson;` (mirrors `warningsJson` / `qualityDimensionsJson`).
    - `@Type(JsonType.class) @Column(name = "covered_endpoint_ids", columnDefinition = "jsonb") private List<String> coveredEndpointIds;` (mirrors `decisionsJson` / `evidenceRefsJson`).
    - Both nullable, boxed reference types; no `@PrePersist` defaulting needed (null is the valid empty state).
  - [x] 1.4 Add the two fields to `MigrationStorySpecGenerationDto.java`
    - `@JsonProperty("structured_tests_json") List<Map<String, Object>> structuredTestsJson` and `@JsonProperty("covered_endpoint_ids") List<String> coveredEndpointIds` as new record components (snake_case wire per the AMS global default + the existing belt-and-braces explicit `@JsonProperty` style on this DTO).
    - Append them to the canonical constructor; extend the back-compat constructor (currently 19-arg delegating to 23-arg) so it defaults BOTH new fields to `null` and existing positional call sites keep compiling. Update the Javadoc `@param` block + the constructor count note.
  - [x] 1.5 Wire the two fields through `MigrationStorySpecGenerationMapper.java`
    - `toDto`: pass `entity.getStructuredTestsJson()` + `entity.getCoveredEndpointIds()` through.
    - `toNewEntity`: set both from the DTO (JSONB blobs pass by reference, mapper stays policy-free).
    - `updateEntityFromDto`: add null-guarded setters (`if (dto.structuredTestsJson() != null) entity.setStructuredTestsJson(...)`; same for `coveredEndpointIds`) so an omitted field never wipes the column.
  - [x] 1.6 Verify (FOREGROUND only) the AMS targeted tests pass
    - Run ONLY the tests written in 1.1, e.g. `mvn test -q "-Dtest=MigrationStorySpecGenerationController*Test"` (FOREGROUND — never background a Maven run).
    - Confirm Liquibase applies 181 cleanly against H2 on context startup (the targeted slice boots the schema).
    - Do NOT run the full AMS suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- Changeset 181 applies after 180 with no checksum/startup error.
- Both new columns round-trip snake_case over the wire (POST/PUT in, GET out, verbatim).
- An omitted-field PATCH preserves both columns (null-guard holds).
- Empty `covered_endpoint_ids` arrays survive the round-trip.

### Gateway — Generator Enrichment

#### Task Group 2: Structured Tests + coveredEndpointIds + Inline Test Pack + Persist
**Dependencies:** Task Group 1

Widens the Generated-variant `tests` from `string[]` to a structured `{title, description, type: 'unit'|'functional'}[]`, adds `coveredEndpointIds: string[]`, enriches the prompt with harvested PM + TE discipline, assembles the test pack INLINE into `generated_spec_text` (prefix unchanged), and persists both new fields to AMS through the existing batch path.

- [x] 2.0 Complete the generator enrichment
  - [x] 2.1 Write 2-8 focused tests for the validator + persistence plumbing
    - Validator (`specGenerationResponseValidator.ts`): a Generated payload with a well-formed structured `tests` array + non-empty `coveredEndpointIds` passes; a `tests` entry missing `title`/`description` or with `type` outside `unit|functional` fails; an EMPTY `coveredEndpointIds` array passes (non-endpoint story); a non-string `coveredEndpointIds` member fails.
    - Persistence: assert `toAmsWireShape` emits `structured_tests_json` + `covered_endpoint_ids` (snake_case) and `normaliseAmsRow` reads both back (snake_case AND camelCase tolerance, matching the existing `get(snake, camel)` pattern).
    - Use existing LLM-output fixtures; mock the LLM via the handler `callLlm` dep — do NOT hit a live model (the `llmGuard.setup.ts` guard is active). Reuse `architectureModelClientMock.ts` for any AMS client calls.
    - Limit to 2-8 tests.
  - [x] 2.2 Widen the Generated variant in `specGenerationResponseValidator.ts`
    - Change `GeneratedShapeSpecResponseA.tests` from `string[]` to `StructuredTest[]` where `StructuredTest = { title: string; description: string; type: 'unit' | 'functional' }`; export the new type + the allowed-`type` const array.
    - In `validateGeneratedBranch`: replace the `isStringArray(obj.tests)` check with object-array validation — each entry must be a plain object with non-empty string `title` + `description` and `type` in `{unit, functional}`. Keep the existing actionability heuristic working (non-empty `tests` still satisfies the `hasTests` branch of the length proxy).
    - Add `coveredEndpointIds`: validate as an array of strings, MAY be empty. Add it to `GeneratedShapeSpecResponseA`.
    - Leave the `insufficient_context` / `failed` branches and all captured-decision extension functions untouched.
  - [x] 2.3 Enrich the generator prompt `product-manager.migration-shape-spec-generation.task.md`
    - Harvest from `product-manager.implement-support.task.md`: instruct the model to emit testable acceptance criteria + explicit scope-in / scope-out discipline (the PlannerResponse-shaped fields the Implement screen consumes).
    - Harvest from `testPlanningPrompt.ts`: the unit/functional test-pack discipline — one+ tests, each `{title, description, type}`, every acceptance criterion mapped to >= 1 test, granular over broad, `type` EXACTLY `unit` or `functional`, NO integration/E2E (those are Spec 2).
    - Add the `coveredEndpointIds` instruction: populate the model `EndpointEntity` UUIDs in scope for the story, grounded ONLY in the already-resolved migration context; emit an EMPTY array for non-endpoint stories (DB schema / data migration / other-service / infra); never fabricate ids.
    - Keep ALL existing hard constraints verbatim: no-fabrication -> `insufficient_context`, like-for-like, captured-decision citation, single-story scope, confidence self-rating, the literal `/agent-os:shape-spec` prefix.
  - [x] 2.4 Update the task config `product-manager--migration-shape-spec-generation.json`
    - Update the Generated-variant schema doc/examples to show the structured `tests` shape + the new `coveredEndpointIds` field, so the runtime task contract self-documents.
  - [x] 2.5 Assemble the test pack INLINE into `generated_spec_text`
    - In `migrationShapeSpecGenerationHandler.ts` per-story success path, after the LLM response validates, render the structured `tests` as a human-viewable unit/functional Test Pack section appended into `generatedSpecText` (in addition to structural persistence in 2.6).
    - Keep the literal `/agent-os:shape-spec` prefix at the head of `generatedSpecText` (validator enforces it; it is the contract Spec 3 sends onward). Do NOT introduce a second canonical spec body and do NOT switch to `composeSpecIntent`.
  - [x] 2.6 Persist `structured_tests_json` + `coveredEndpointIds` to AMS
    - Add `structuredTestsJson` + `coveredEndpointIds` to the inline gateway `MigrationStorySpecGenerationDto` interface in `migrationShapeSpecGenerationHandler.ts`.
    - Populate them on the per-story result row from the validated response (`tests` -> `structuredTestsJson`; `coveredEndpointIds` -> `coveredEndpointIds`).
    - Extend `toAmsWireShape` (emit `structured_tests_json` + `covered_endpoint_ids`) and `normaliseAmsRow` (read both, snake_case + camelCase tolerant) so the batch POST round-trips them.
  - [x] 2.7 Verify the gateway targeted suite passes
    - `npx tsc --noEmit` in `gateway/` (clean — no new type errors).
    - Run ONLY the tests written in 2.1, e.g. targeted jest on `specGenerationResponseValidator` + `migrationShapeSpecGenerationHandler` (`npx jest specGenerationResponseValidator migrationShapeSpecGenerationHandler`).
    - Do NOT run the entire gateway suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass; `tsc --noEmit` is clean.
- Structured `tests` validate as `{title, description, type: unit|functional}`; malformed entries and out-of-set `type` are rejected.
- `coveredEndpointIds` validates as `string[]` and accepts an empty array.
- `generated_spec_text` carries the inline Test Pack and still starts with `/agent-os:shape-spec`.
- Both new fields are POSTed to AMS (snake_case) and read back on the batch response.

### Gateway — Implement-State Write

#### Task Group 3: Map Output to PlannerResponse + TestPlannerResponse and PUT implement-state.json
**Dependencies:** Task Group 2

For each successfully generated story, the generator builds the gateway-filesystem `implement-state.json` so the Implement screen hydrates exactly as a completed manual PM -> TE session. Note: `serializeImplementState` lives in the frontend and depends on in-memory React Maps/Dates — it is NOT importable into the gateway. The gateway therefore constructs the equivalent `PersistedImplementationState` JSON literal directly (schemaVersion 1) and PUTs it via the existing route.

- [x] 3.0 Complete the implement-state write per generated story
  - [x] 3.1 Write 2-8 focused tests for the mapping + PUT
    - Given a validated Generated story, assert the assembled `PlannerResponse` has `plannerReadyForSpec=true`, EMPTY `openQuestions`, `schemaVersion='1.1'`, `implementationPlan=null`, and `scope.in/out` + `acceptanceCriteria` + `assumptions` sourced from the response.
    - Assert the assembled `TestPlannerResponse` has `testPlan` mapped 1:1 from the structured `tests` (each `{title, description, type}`), `hasTestPlan=true`, EMPTY `openQuestions`.
    - Assert the PUT body matches the route contract (`projectId` / `featureId` = story `workItemId` / `projectParentFolder` (from `fetchProjectFolder`) / `featureTitle` = story title / `state.schemaVersion=1`) and is sent to `PUT /api/implement-state`.
    - Assert an `insufficient_context` story does NOT trigger a ready-state PUT (no synthesized PlannerResponse/Test Pack).
    - Mock `fetchProjectFolder` + the PUT via deps/`architectureModelClientMock.ts`; LLM mocked (guard active). Limit to 2-8 tests.
  - [x] 3.2 Build the `PlannerResponse` from the enriched response
    - Map `featureUnderstanding`, `scope.in[]` / `scope.out[]`, `assumptions[]`, `acceptanceCriteria[]` from the validated Generated response; set `openQuestions: []`, `plannerReadyForSpec: true`, `schemaVersion: '1.1'`, `implementationPlan: null`, and a `message` string (the panel's PlannerResponse requires `message`; use a short generated summary, NOT a chat turn).
    - Do NOT call the PM conversation prompt at runtime — the single enriched prompt already steered these fields (Task Group 2 replaces auto-answering conversations).
  - [x] 3.3 Build the `TestPlannerResponse` from the structured tests
    - `testPlan: TestDefinition[]` mapped 1:1 from `structuredTestsJson` (`{title, description, type}`; `type` is already constrained to `unit|functional`); `hasTestPlan: true`; `openQuestions: []`; `schemaVersion` per the panel's contract; `message` a short summary.
  - [x] 3.4 Construct the `PersistedImplementationState` JSON literal (schemaVersion 1)
    - Emit the same field shape `serializeImplementState` produces: `latestPlannerResponse`, `latestTestPlannerResponse`, `hasTestPlan: true`, and benign defaults for the remaining fields (empty `answers` / `questionStatuses` / `teAnswers` / `teQuestionStatuses` / `specIntentTexts` / `messages`, etc.) so the panel deserializer hydrates cleanly. Keep it a plain JSON object (no Maps) since the gateway is not the React serializer.
    - "Ready to implement" is exactly `plannerReadyForSpec=true` + empty `openQuestions` + populated `testPlan` + `hasTestPlan=true` — do NOT add any new ready flag or `implementation_mode` gate.
  - [x] 3.5 Resolve per-story routing inputs and PUT
    - Resolve `projectParentFolder` via `fetchProjectFolder(projectId)` (module-cached); resolve `featureTitle` (= story title) + `featureId` (= story `workItemId`). The route derives the on-disk `{projectParentFolder}/threads/{kind}/implementation-state.json` path from these.
    - PUT the body to `PUT /api/implement-state` in the per-story SUCCESS path only (`generated` / `generated_with_warnings`). Treat the PUT as best-effort: a failure logs + is isolated (R-12 posture) and never aborts the batch or the AMS persistence.
    - `insufficient_context` / `failed` stories are NOT synthesized or marked ready — leave the screen reflecting the real gap.
    - Do NOT touch the orphaned AMS `work_item_implement_workspace` JSONB; `usePersistWorkspace` / `workspaceStateMapper` / `implementWorkspaceApi` stay untouched. The AMS `migration_story_spec_generations` row remains the canonical generated artifact + combined spec text.
  - [x] 3.6 Verify the gateway targeted suite passes
    - `npx tsc --noEmit` in `gateway/` (clean).
    - Run ONLY the tests written in 3.1 (targeted jest on the handler's implement-state mapping).
    - Do NOT run the entire gateway suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass; `tsc --noEmit` is clean.
- A generated story PUTs an `implement-state.json` that hydrates the panel as ready-to-implement (PlannerResponse + Test Pack, zero open questions).
- `insufficient_context` stories leave the screen showing the gap (no fake-ready write).
- No new ready flag introduced; the orphaned AMS workspace JSONB is untouched.

### Frontend — Review Surface

#### Task Group 4: Scope/AC/Test Pack Tiles on the Review + Implement Surfaces
**Dependencies:** Task Group 3

Extends the migration-story review surface (`StoryResultDrawer` and the Implement-tab Specs surface) to render scope-in/out + acceptance criteria + the Test Pack alongside the existing status / confidence / warnings / missing-inputs / evidence / spec-text, and surfaces the confidence + `insufficient_context` flags. Tiles are READ-ONLY and may drift from the edited combined text (accepted v1); editing remains combined-spec-text-only via the existing `manualEditSpec`.

- [x] 4.0 Complete the read-only review tiles
  - [x] 4.1 Write 2-8 focused tests for the new tiles
    - Use `renderWithProviders`. Render `StoryResultDrawer` for a generated row carrying structured tests + scope/AC and assert the scope-in/out, acceptance-criteria, and Test Pack tiles render their content.
    - Assert an `insufficient_context` row shows the gap/flag and does NOT render a populated Test Pack tile.
    - Assert the confidence indicator renders; assert the combined-spec-text edit affordance still routes through `manualEditSpec` (no inline tile editing).
    - If `StoryResultDrawer` reads structured fields from a fetched model, add the matching mock to the API mock factory (mirror the `getReviewModel` on-mount caveat from `MEMORY.md` if applicable). Limit to 2-8 tests.
  - [x] 4.2 Surface the structured fields on the row/model type
    - Extend `SpecGenerationRow` (in `specGenerationApi.ts`) and any normalisation so `structuredTestsJson` (or its camelCase surface) + `coveredEndpointIds` + the PM scope/AC fields are available to the drawer. Scope/AC for the tiles come from the generated spec artifact / structured fields already persisted; do NOT add a new fetch.
  - [x] 4.3 Render the tiles in `StoryResultDrawer`
    - Add read-only tiles for: scope-in, scope-out, acceptance criteria, and the Test Pack (unit/functional tests as `{title, description, type}`), placed alongside the existing status / confidence / warnings / missing-inputs / evidence sections.
    - Surface the confidence value and the `insufficient_context` flag prominently so a reviewer can judge readiness.
    - Follow `MigrationShapeSpecGeneration.module.css` + the existing drawer section conventions; no new design system.
  - [x] 4.4 Mirror the tiles on the Implement-tab Specs surface
    - Extend `ImplementTabShapeSpecCard` (the read-only generated-spec card above the panel on `ProductImplementPage`) to show the same scope/AC/Test Pack/confidence tiles for a migration story, so the reviewer sees readiness on the Implement tab too. Keep it read-only.
  - [x] 4.5 Keep editing combined-spec-text-only
    - Editing stays via the existing `manualEditSpec` combined-text edit (reuse verbatim, including `manually_edited` overwrite protection). Tiles stay read-only and MAY drift from the edited text (accepted v1). Do NOT build a structured-tile editor and do NOT build a separate empty-template editor for manually-added items.
  - [x] 4.6 Verify the frontend targeted suite passes
    - Run ONLY the tests written in 4.1 (targeted vitest on `StoryResultDrawer` + the Implement-tab card).
    - `npx tsc --noEmit` in `frontend/` — stay within the established tsc baseline (no new errors above baseline).
    - Do NOT run the entire frontend suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass; frontend tsc stays at/under baseline.
- The drawer and the Implement-tab card render scope-in/out + acceptance criteria + Test Pack + confidence for a generated story.
- `insufficient_context` rows show the gap and no populated Test Pack tile.
- Editing remains combined-spec-text-only via `manualEditSpec`; tiles are read-only.

### Testing

#### Task Group 5: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Reviewed the AMS tests (1.1: `MigrationStorySpecGenerationImplementationReadyFieldsTest` 3 + `MigrationStorySpecGenerationDtoImplementationReadyFieldsTest` 2), the validator tests (2.1: `specGenerationResponseValidatorStructuredTests` 8), the implement-state + persistence tests (2.1/3.1: `migrationShapeSpecImplementationReady` 10), and the tile tests (4.1: `StoryResultDrawerTiles` 5). Total pre-Group-5 feature tests: ~28.
  - [x] 5.2 Analyze coverage gaps for THIS feature only
    - Each group's unit seams were well covered in isolation. Genuine UNCOVERED end-to-end seams identified: (1) the frontend wire read-back — the Group 4 tile tests build `SpecGenerationRow` directly in camelCase, so the snake_case AMS wire -> `mapRowDtoToRow` -> camelCase path (`structured_tests_json`/`covered_endpoint_ids`) was never exercised; (2) gateway snake_case wire-agreement ROUND-TRIP — `toAmsWireShape` and `normaliseAmsRow` were tested separately but not as a paired symmetric round-trip for the two new fields; (3) the manual-add path (nullable `book_of_work_id`, D7) carrying both new fields through the same wire shape + read-back (the AMS entity tests always set a `bookOfWorkId`); (4) ONE batch run driving BOTH outputs (AMS-persisted snake_case row + ready implement-state PUT) for the SAME generated story.
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Added 7 strategic tests (within the 10 cap), all LLM-mocked (guard active), reusing `architectureModelClientMock.ts` (gateway):
      - Gateway (3, appended to `gateway/src/__tests__/migrationShapeSpecImplementationReady.test.ts`, "Group 5 end-to-end seams"): snake_case `toAmsWireShape` -> `normaliseAmsRow` round-trip symmetry (across a JSON boundary) for both new fields; the manual-add nullable `book_of_work_id` path carrying both fields through the wire shape + read-back; one batch run capturing the AMS snake_case wire body AND the ready implement-state PUT for the same story (matched on `featureId`, same 2 structured tests).
      - Frontend (4, new file `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/__tests__/implementationReadyWireReadBack.test.tsx`): `mapRowDtoToRow` (via the public `fetchSpecGenerationsForWorkItem`, `globalThis.fetch` mocked) reads the snake_case wire into camelCase for both fields; EMPTY `covered_endpoint_ids` reads back empty; the manual-add nullable `book_of_work_id` row surfaces both fields; the read-back -> UI seam renders the Test Pack tile in `StoryResultDrawer` from a row produced by the REAL wire mapper.
  - [x] 5.4 Run feature-specific tests only
    - Gateway: `npx tsc --noEmit` clean (0); `npx jest migrationShapeSpec specGeneration` 110/110 across 13 suites (incl. the 13 in the impl-ready file); full `npx jest --maxWorkers=4` 2296/2296 across 307 suites (confidence pass — no regressions).
    - Frontend: MigrationShapeSpecGeneration + ProductView vitest folders 160/160 across 16 files; `npx tsc --noEmit` at the 515 baseline (net zero — a transient `global` -> `globalThis` fix kept it at baseline).
    - AMS (FOREGROUND): `mvn test -Dtest=MigrationStorySpecGenerationImplementationReadyFieldsTest,MigrationStorySpecGenerationDtoImplementationReadyFieldsTest,MigrationStorySpecGenerationEntityPersistenceTest` 10/10, BUILD SUCCESS; changeset 181 applies cleanly (entity tests SELECT `structured_tests_json`).
    - The four critical workflows (generate -> both fields persisted; implement-state ready; insufficient_context leaves the gap; manual-add nullable `book_of_work_id` through the same path) all pass.

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-42 total).
- The four critical workflows are covered end-to-end.
- No more than 10 additional tests added in 5.3.
- Testing focused exclusively on this spec's requirements.

## Execution Order

Recommended implementation sequence (strictly linear — each group depends on the prior):
1. Database Layer / AMS (Task Group 1) — changeset 181 + entity/DTO/mapper round-trip.
2. Gateway Generator Enrichment (Task Group 2) — structured tests + `coveredEndpointIds` + inline test pack + persist.
3. Gateway Implement-State Write (Task Group 3) — PlannerResponse + TestPlannerResponse -> `implement-state.json`.
4. Frontend Review Surface (Task Group 4) — read-only scope/AC/Test Pack/confidence tiles.
5. Test Review & Gap Analysis (Task Group 5) — up to 10 strategic end-to-end tests.

## Verification Conventions (all groups)

- **AMS:** targeted `mvn test -q "-Dtest=..."` FOREGROUND only (never background a Maven run). Liquibase changeset 181 is a NEW file; never edit applied changesets (<= 180).
- **Gateway:** `npx tsc --noEmit` + targeted jest on the touched modules only. LLM stays mocked via the handler `callLlm` dep — the `llmGuard.setup.ts` live-LLM guard is active; reuse `architectureModelClientMock.ts` for AMS client calls.
- **Frontend:** targeted vitest + `npx tsc --noEmit` at/under the established baseline; reuse `renderWithProviders`.
- Run ONLY the newly written tests per group during development; the single full-suite-adjacent pass is the targeted feature run in 5.4. Do NOT run whole service suites at any group boundary.
