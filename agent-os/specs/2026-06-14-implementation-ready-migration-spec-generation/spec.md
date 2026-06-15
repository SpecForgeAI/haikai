# Specification: Implementation-Ready Migration Spec Generation (Spec 1 of 4)

## Goal
Enrich the existing migration shape-spec generator so each saved Story comes out implementation-ready: it writes the full `implement-state.json` so the Implement screen renders exactly as a completed manual Product-Manager -> Test-Engineer session, and it assembles one canonical `/agent-os:shape-spec` combined spec body with the structured unit/functional test pack inline.

## User Stories
- As a migration lead, I want to run "Generate All" over a saved Book of Work and have each Story land with populated scope/AC and a unit/functional test pack so the Implement screen is ready to implement with no manual PM/TE conversation.
- As a reviewer, I want each generated Story's Implement/Specs surface to show scope, acceptance criteria, the test pack, and confidence / insufficient-context flags so I can judge readiness before implementing, and edit the combined spec text if needed.

## Specific Requirements

**Generator writes `implement-state.json` per generated story (D1, D2, D8)**
- After a story persists to AMS, the generator (`migrationShapeSpecGenerationHandler.ts`) PUTs a serialized `PersistedImplementationState` to the existing `PUT /api/implement-state` route (`gateway/src/routes/implementState.ts`).
- Build the body via the same shape `serializeImplementState` produces (`schemaVersion: 1`); the panel hydrates `latestPlannerResponse` + `latestTestPlannerResponse` + `hasTestPlan` natively (no panel re-plumbing).
- Resolve each story's `projectParentFolder` via `fetchProjectFolder(projectId)` (module-cached) and its `featureTitle` (= story title) + `featureId` (= story `workItemId`); the route derives the on-disk folder from those.
- Do NOT touch the orphaned AMS `work_item_implement_workspace` JSONB; `usePersistWorkspace` / `workspaceStateMapper` / `implementWorkspaceApi` stay untouched.
- The AMS `migration_story_spec_generations` row remains the canonical generated artifact + combined spec text.

**Map generator output -> PlannerResponse + TestPlannerResponse (D1, D4)**
- PlannerResponse: `featureUnderstanding`, `scope.in[]`/`scope.out[]`, `assumptions[]`, `acceptanceCriteria[]`, `openQuestions: []` (empty), `plannerReadyForSpec: true`, `schemaVersion: '1.1'`, `implementationPlan: null`.
- TestPlannerResponse: `testPlan: TestDefinition[]` from the structured tests, `hasTestPlan: true`, `openQuestions: []`, `schemaVersion: '1.0'`.
- Source PM fields from the enriched LLM response (scope/AC/assumptions); source the test pack from the new structured `tests` array.
- The generator does NOT call the PM or TE conversation prompts at runtime; generation is steered up front by the single enriched prompt (replaces auto-answering conversations).

**"Ready to implement" gate = PlannerResponse + Test Pack; no new flag (D4)**
- Ready means: `plannerReadyForSpec=true` + empty `openQuestions` + populated `testPlan` + `hasTestPlan=true`. Do NOT introduce a new "ready" flag; the panel's existing gate is exactly these fields.
- `insufficient_context` stories MUST NOT be written as fake-ready: leave the screen reflecting the real gap (do not synthesize a PlannerResponse/Test Pack for them).

**Enriched structured `tests` field (D6)**
- Widen the Generated-variant `tests` from `string[]` to `{ title: string, description: string, type: 'unit' | 'functional' }[]`; `type` constrained to `unit`/`functional` only (integration/E2E excluded - Spec 2).
- Extend `validateGeneratedBranch` in `specGenerationResponseValidator.ts`: each entry an object with non-empty `title`/`description` and `type` in the allowed set; keep the existing actionability heuristic (non-empty tests still satisfies it).
- The structured array maps 1:1 to `TestDefinition` so it populates `latestTestPlannerResponse.testPlan` and renders inline into `generated_spec_text`.

**Canonical combined spec body = enriched `generated_spec_text` (D3)**
- The enriched `generated_spec_text` is the single "view spec" body; the test pack is rendered INLINE into it (human-viewable unit/functional tests) in addition to structural persistence.
- Prefix stays the literal `/agent-os:shape-spec` (validator enforces it; this is the contract Spec 3 sends onward).
- "See Spec" / `SpecViewerModal` for a migration story reads THIS row, not the interactive `composeSpecIntent` `/shape-spec ` body.

**Enrich the generator prompt with harvested PM + TE discipline**
- In `product-manager.migration-shape-spec-generation.task.md`, instruct the model to emit testable acceptance criteria + scope-in/out discipline harvested from `product-manager.implement-support.task.md`.
- Harvest the unit/functional test-pack discipline from `testPlanningPrompt.ts`: one+ tests, each `{title, description, type}`, every AC mapped to >=1 test, granular over broad, `type` exactly `unit`/`functional`, NO integration/E2E.
- Keep all existing hard constraints (no fabrication -> `insufficient_context`, like-for-like, captured-decision citation, single-story scope, confidence self-rating).
- Update the task config `product-manager--migration-shape-spec-generation.json` Generated-variant schema doc to reflect the structured `tests` shape + new `coveredEndpointIds`.

**`coveredEndpointIds` forward-only groundwork (D9)**
- Add `coveredEndpointIds: string[]` to the Generated variant: model EndpointEntity UUIDs the story migrates, best-effort grounded in the already-resolved migration context (no new context resolution).
- EMPTY array for non-endpoint stories (DB schema, data migration, other-service, infra); do NOT fabricate ids (preserves no-fabrication).
- Validate as an array of strings (may be empty) in `specGenerationResponseValidator.ts`; add a prompt instruction to populate it (empty when no endpoint in scope).
- Persist it (see AMS), but it is NOT consumed by any v1 feature - groundwork only so a future break-cause feature needs no backfill.

**AMS persistence: changeset 181 - two new columns (D6, D9)**
- New Liquibase changeset `181-...` (latest applied = 180): adds a structured-tests JSONB column (e.g. `structured_tests_json`) AND `covered_endpoint_ids` JSONB column on `migration_story_spec_generations`.
- Add matching nullable, boxed reference-type fields on `MigrationStorySpecGenerationEntity` (`List<Map<String,Object>>` for tests, `List<String>` for endpoint ids) with `@Type(JsonType.class)`, mirroring the existing `decisions_json` / `interfaces_json` / `warnings_json` idiom.
- Add the fields to `MigrationStorySpecGenerationDto` (snake_case `@JsonProperty`) + the mapper's null-guarded update path; extend the back-compat constructor so existing positional call sites compile.
- Gateway `MigrationStorySpecGenerationDto` (handler), `normaliseAmsRow`, and `toAmsWireShape` carry the two new fields snake_case<->camelCase.

**Manually-added work items use the same generator path (D7)**
- A manually-added work item gets an implementation-ready spec through the same generator path: a spec row with nullable `book_of_work_id` (entity already allows this); same review/edit affordances.
- Hand-authoring is served by the existing `manualEditSpec` combined-text edit (reuse verbatim incl. `manually_edited` overwrite protection); NO separate empty-template editor.

**Trigger + review/edit surface (D5)**
- Reuse the existing book-of-work batch trigger (`startBatchGeneration` from `SpecGenerationWorkspace` + the "Generate All" dialog); a relabel to signal "implementation-ready" is acceptable; NO new control/route.
- Extend the review surface (`StoryResultDrawer` and the Implement-tab/Specs surface) to render scope-in/out + acceptance criteria + Test Pack alongside the existing status/confidence/warnings/missing-inputs/evidence/spec-text; surface confidence + `insufficient_context` flags.
- Editing remains combined-spec-text-only; the structured tiles stay read-only and MAY drift from the edited text (accepted v1).

## Visual Design
No visual assets provided (`planning/visuals/` is empty). Follow the existing `MigrationShapeSpecGeneration.module.css` and `StoryResultDrawer` section conventions for any new review tiles.

## Existing Code to Leverage

**`gateway/src/services/migrationShapeSpecGenerationHandler.ts`**
- The two-pass, serial-batch, per-story-failure-isolated generator to enrich; already maps the LLM response to the AMS row and POSTs the batch.
- Add the implement-state PUT + PlannerResponse/TestPlannerResponse assembly into the per-story success path; reuse `fetchProjectFolder` and the existing `MigrationStorySpecContext` already resolved per story.

**`gateway/src/services/specGenerationResponseValidator.ts` (`validateGeneratedBranch`)**
- The hand-rolled three-variant validator; extend the Generated branch for structured `tests` and `coveredEndpointIds`. Keep the prefix + actionability rules and the captured-decision citation extensions intact.

**`gateway/src/routes/implementState.ts` + `frontend/src/utils/implementStateSerializer.ts`**
- The PUT contract (requires `projectId`/`featureId`/`projectParentFolder`/`featureTitle`/`state` with `schemaVersion`) and the canonical `PersistedImplementationState` shape (`serializeImplementState`) the generator must emit; the panel deserializes the same fields on mount.

**`gateway/src/config/prompts/product-manager.implement-support.task.md` + `gateway/src/services/testPlanningPrompt.ts`**
- Harvest the PM scope-in/out + testable-AC schema and the TE unit/functional `testPlan[]` `{title, description, type}` discipline into the migration generator prompt.

**`architecture-model-service/.../MigrationStorySpecGenerationEntity.java` + `MigrationStorySpecGenerationDto.java`**
- The boxed-reference-type, sibling-JSONB pattern (`decisions_json` etc.) and the nullable `book_of_work_id` to copy for the two new columns; changeset `180-implementation-init-and-repo-map.sql` is the NEW-changeset template for 181.

## Out of Scope
- Spec 2: holistic integration / E2E test items at the feature level.
- Spec 3: the Migrate button + Driver + external shape-spec auto-answerer (the body Spec 3 sends onward is produced here, not sent here).
- Spec 4: deploy / reconcile / bug loop.
- Reviving or writing the orphaned AMS `work_item_implement_workspace` JSONB store.
- Editing the structured screen tiles (v1 = combined-spec-text edit only; tiles read-only, may drift).
- Auto-splitting a story into multiple increments (v1 = one spec per story).
- Consuming `coveredEndpointIds` (forward-only groundwork); the baseline-side `model_endpoint_id`, break->story join, and cause classification are deferred.
- Any new "ready" flag or `implementation_mode` gate on the panel.
- Changing the `/agent-os:shape-spec` prefix or introducing a second canonical spec body.
