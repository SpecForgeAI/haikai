# Spec Requirements: Implementation-Ready Migration Spec Generation (Spec 1 of 4)

## Initial Description

(From `planning/raw-idea.md` — most major product decisions are already locked.)

Enrich the existing migration shape-spec generation so each Story in a saved migration Book of Work comes out as a genuinely IMPLEMENTATION-READY spec that does TWO things: (1) populates the FULL implement-workspace screen state so a user opening the work item sees the Implementation screen EXACTLY as if they had manually completed the Product Manager + Test Engineer conversations; and (2) assembles into a single combined "view spec" body which is what later gets sent to the external shape-spec endpoint (Spec 3). This REPLACES auto-answering PM/TE conversations — generation is steered up front. Harvest PM scope-in/out + testable-AC discipline from `product-manager.implement-support.task.md` and the TE structured unit/functional test pack from `testPlanningPrompt.ts`. Upgrade today's flat `tests:string[]` to a structured test pack. Generation is an EXPLICIT user-triggered step over a plan/epic producing reviewable specs. Review/edit surface: edit the COMBINED SPEC TEXT ONLY (reuse `manualEditSpec` + `manually_edited` overwrite protection); structured screen tiles stay read-only and MAY drift from the edited text (acceptable v1). User can also ADD work items manually that also need an implementation-ready spec.

LOCKED (do not re-litigate): v1 = ONE spec per story (no auto-split into increments); no-fabrication preserved (`insufficient_context` instead of guessing); confidence scoring kept; big-bang migration (THIS spec only PRODUCES specs — the Migrate loop is Spec 3); the harvest plan; explicit-trigger generation.

OUT OF SCOPE (later specs): holistic integration/E2E TEST items (Spec 2); the Migrate button + Driver + external shape-spec auto-answerer (Spec 3); deploy/reconcile/bug loop (Spec 4).

## Requirements Discussion

### Code-Tracing Findings (the linchpin — established by CODE READING, no app run)

This section records what the code actually does today, because the central design decisions in this spec hinge on it. **Haikai services only** (`gateway/`, `frontend/`, `architecture-model-service/`); the repo-root `src/` external Python service was ignored per instruction.

**There are TWO unrelated persistence backends for the implement screen, and they are deliberately separate:**

1. **Gateway-filesystem `implement-state.json` + `implement-conversations`** — THIS is what the `ImplementationAssistantPanel` actually hydrates from and renders.
   - Route: `gateway/src/routes/implementState.ts` (GET/PUT `/api/implement-state`), file written to `{projectParentFolder}/threads/{kind}/implementation-state.json` (atomic temp+rename). Conversation sibling: `implement-conversations` route → `conversation.json`.
   - Shape: `PersistedImplementationState` in `frontend/src/api/chatApi.ts`, (de)serialized by `frontend/src/utils/implementStateSerializer.ts`.
   - **Render-driving fields:** `latestPlannerResponse` (PlannerResponse: `featureUnderstanding` / `scope.in[]` / `scope.out[]` / `assumptions[]` / `acceptanceCriteria[]` / `openQuestions[]` / `plannerReadyForSpec` / `implementationPlan`), `latestTestPlannerResponse` (TestPlannerResponse: `testPlan: TestDefinition[]` of `{title, description, type: 'unit'|'functional'|...}`), `hasTestPlan`, `answers`, `questionStatuses`, `teAnswers`, `teQuestionStatuses`, `specIntentTexts` (per-increment "See Spec" body), `messages` (chat), `incrementStatuses`, `activeIncrementId`.

2. **AMS `work_item_implement_workspace` JSONB** (`PersistedWorkspaceState` in `frontend/src/api/implementWorkspaceApi.ts`; entity `WorkItemImplementWorkspaceEntity` single `workspace_state` jsonb column; controller `WorkItemImplementWorkspaceController`).
   - **CRITICAL: this store is effectively ORPHANED for the panel.** A repo-wide search shows `usePersistWorkspace` / `fetchImplementWorkspace` / `mapPersistedToState` / `mapStateToPersisted` are referenced ONLY by their own files and tests (`frontend/src/hooks/usePersistWorkspace.ts`, `frontend/src/utils/workspaceStateMapper.ts`) — NOT by `ImplementationAssistantPanel`, `ProductImplementPage`, or `ImplementTab`. The panel never calls `fetchImplementWorkspace`. So the AMS workspace JSONB does NOT feed the screen today.
   - Its mapper (`workspaceStateMapper.ts`) carries `plannerPayload` + merged PM/SD `questions[]` + `executionArtifactsByIncrement` + `teamChatTranscript`, but NOTABLY does **not** carry `latestTestPlannerResponse` / `hasTestPlan` (no Test Pack) and has no PlannerResponse for AC beyond `plannerPayload`.

3. **AMS `migration_story_spec_generations` row** (`MigrationStorySpecGenerationEntity`, latest-applied Liquibase changeset 180; this entity's own columns came in via changesets 139–154). Holds `generated_spec_text` (the literal `/agent-os:shape-spec` body), `status`, `confidence`, `warnings_json`, `missing_inputs_json`, `evidence_refs_json`, `decisions_json` / `interfaces_json` / `assumptions_json` (parser output), `quality_*`, `manually_edited` + `last_manually_edited_*` + `previous_spec_text` (manual-edit + overwrite protection), `stale` / `stale_reason`. **The entity Javadoc (lines 23–28) explicitly says it is a peer of the Book-of-Work entity, NOT an extension of the `WorkItemImplementWorkspace` JSONB, which "serves a different concern (Implement-tab UI rehydration)."** This row is currently surfaced ONLY by the read-only `ImplementTabShapeSpecCard` (a chip + `<pre>` block ABOVE the panel) — it does NOT hydrate the panel's PM/TE tiles.

**Where the migration spec row is shown on the implement screen today:** `ProductImplementPage.tsx` renders `<ImplementTabShapeSpecCard>` (read-only generated-spec chip + spec text + "Open in spec workspace" drill-back) immediately above `<ImplementationAssistantPanel>`. The two coexist but are NOT integrated — the panel itself shows an empty PM/TE conversation for a migration story unless `implement-state.json` was populated by a real PM→TE session.

**The screen's "completed PM+TE" rendering gate:** purely `latestPlannerResponse` (LHS FeatureDefinitionPanel — scope/AC/assumptions/questions) + `latestTestPlannerResponse?.testPlan` & `hasTestPlan` (Test Pack section + enables the "Implement" button). There is NO `implementation_mode` gate on the panel. (`implementation_mode` exists in two UNRELATED places: a project-level flag on the `Project` entity from the impl-init spec, and a default-`false` `implementationMode` boolean inside the orphaned workspace JSONB DTO. Neither gates the panel.)

**Combined "view spec" assembly today:** `frontend/src/utils/specIntentComposer.ts` → `composeSpecIntent(plannerResponse, siblingStories)` renders a markdown body prefixed with `/shape-spec ` (NOTE: `/shape-spec`, not `/agent-os:shape-spec`) from `featureUnderstanding` + scope in/out + assumptions + AC + sibling items. It does **NOT** include the Test Pack. This is the per-increment text stored in `specIntentTexts` and shown by `SpecViewerModal` ("See Spec"). So today there are effectively TWO divergent spec bodies: (a) the interactive `composeSpecIntent` `/shape-spec ` body for the manual flow's "See Spec"; (b) the batch generator's `specText` literal `/agent-os:shape-spec` body persisted to `generated_spec_text`. The raw idea asks which becomes canonical.

**The generator to enrich:** `gateway/src/services/migrationShapeSpecGenerationHandler.ts` (two-pass, confidence downgrade R-7, no-fab, serial batch, per-story failure isolation). Response validated by `gateway/src/services/specGenerationResponseValidator.ts` against three variants (Generated / InsufficientContext / Failed). Generated variant already carries `confidence` / `specText` (must start `/agent-os:shape-spec`) / `warnings[]` / `evidenceRefs[]` / `assumptions[]` / `tests: string[]` / `affectedAreas[]`. Prompt: `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md`; task config: `gateway/src/config/tasks/product-manager--migration-shape-spec-generation.json`. **`tests` is a flat `string[]` and must become a structured unit/functional test pack** (target shape aligns to `TestDefinition{title, description, type}` so it can populate `latestTestPlannerResponse.testPlan`).

**Harvest sources confirmed:**
- `gateway/src/config/prompts/product-manager.implement-support.task.md` — PM JSON schema with `scope.in/out`, `assumptions`, `acceptanceCriteria` (testable), `openQuestions`, `plannerReadyForSpec`. This is the exact PlannerResponse shape the screen consumes.
- `gateway/src/services/testPlanningPrompt.ts` — TE prompt producing `testPlan[]` of `{title, description, type:'unit'|'functional'}` per AC, aligned to `TEST-STRATEGY.MD`; explicitly excludes integration/E2E (those are Spec 2).

### Existing Code to Reference

**Similar Features Identified (for the spec-writer to reuse, not re-derive):**
- Generator + validator + prompt + task config: `gateway/src/services/migrationShapeSpecGenerationHandler.ts`, `gateway/src/services/specGenerationResponseValidator.ts`, `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md`, `gateway/src/config/tasks/product-manager--migration-shape-spec-generation.json`.
- Harvest prompts: `gateway/src/config/prompts/product-manager.implement-support.task.md`, `gateway/src/services/testPlanningPrompt.ts`.
- Screen state shapes + (de)serialization: `frontend/src/api/chatApi.ts` (PlannerResponse, TestPlannerResponse, TestDefinition, PersistedImplementationState), `frontend/src/utils/implementStateSerializer.ts`.
- Implement-state persistence route: `gateway/src/routes/implementState.ts`.
- Screen render: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`, `FeatureDefinitionPanel.tsx`, `ProductImplementPage.tsx`.
- Combined-spec assemblers: `frontend/src/utils/specIntentComposer.ts` (`composeSpecIntent`, `composeFullFeatureContext`), `SpecViewerModal.tsx`.
- Migration spec review surfaces: `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/SpecGenerationWorkspace.tsx` (+ `BatchResultsTable`, `StoryResultDrawer`), `frontend/src/components/ProductView/ImplementTabShapeSpecCard.tsx`.
- Manual-edit API: `frontend/src/api/specGenerationApi.ts` (`manualEditSpec`, `startBatchGeneration`, `regenerateSingleStory`).
- AMS persistence: `architecture-model-service/.../MigrationStorySpecGenerationEntity.java`, `WorkItemImplementWorkspaceEntity.java`, `WorkItemImplementWorkspaceController.java`; latest applied Liquibase changeset = **180** (`db/changelog/db.changelog-master.yaml`).
- Orphaned (today) but candidate for revival/repurposing: `frontend/src/hooks/usePersistWorkspace.ts`, `frontend/src/utils/workspaceStateMapper.ts`, `frontend/src/api/implementWorkspaceApi.ts`.

### Follow-up Questions
(none yet — first round)

## Visual Assets

### Files Provided
No visual assets provided (bash check of `planning/visuals/` returned no image/pdf files at first round).

### Visual Insights
N/A

## Requirements Summary

### Functional Requirements
- Enrich the migration shape-spec generator so each saved story produces an implementation-ready spec: PM scope-in/out + testable acceptance criteria + a STRUCTURED unit/functional test pack (per-AC), preserving no-fabrication (`insufficient_context`) and confidence scoring.
- Make the implement screen for a generated story render as if PM→TE completed: populated feature definition (scope/AC/assumptions, zero open questions, `plannerReadyForSpec`-equivalent) AND a populated Test Pack with `hasTestPlan`-equivalent true, so the screen is "ready to implement."
- Assemble one combined "view spec" body per story (the eventual /agent-os:shape-spec body Spec 3 sends to the external shape-spec endpoint), openable/viewable by the user.
- Generation is an explicit user-triggered batch step over a plan/epic producing reviewable specs (NOT a silent save-to-backlog side effect).
- Review/edit surface: show scope/AC/Test Pack + confidence/insufficient_context flags; allow editing the COMBINED SPEC TEXT ONLY (reuse `manualEditSpec` + `manually_edited` overwrite protection); structured tiles stay read-only and may drift (accepted v1).
- Manually-added work items also need an implementation-ready spec (generate or author).

### Reusability Opportunities
- Extend the existing generator/validator/prompt rather than writing a new one; widen the `tests` field from `string[]` to a structured `TestDefinition`-compatible pack.
- Reuse `implement-state.json` (PlannerResponse + TestPlannerResponse + `hasTestPlan`) as the panel's hydration contract (subject to Q1 below).
- Reuse `composeSpecIntent` / SpecViewer for the combined body (subject to Q3 canonicalisation).
- Reuse `startBatchGeneration` + `SpecGenerationWorkspace` review surface (subject to Q5).
- Reuse `manualEditSpec` overwrite protection verbatim.

### Scope Boundaries
**In Scope:** generator enrichment (PM+TE harvest, structured test pack); writing the full screen state so it hydrates as complete; combined spec-text assembly; explicit trigger; review/edit/add surface.
**Out of Scope:** Spec 2 (holistic integration/E2E test items), Spec 3 (Migrate button + Driver + external shape-spec auto-answerer), Spec 4 (deploy/reconcile/bug loop). Editing structured tiles (v1 = combined-text edit only). Auto-split into increments.

### Technical Considerations
- Two separate persistence backends (gateway-filesystem implement-state vs AMS migration spec row vs orphaned AMS workspace JSONB) — the source-of-truth-for-screen-state decision is the central open question (Q1/Q2).
- The screen render gate is `latestPlannerResponse` + `hasTestPlan`/`testPlan`, NOT any `implementation_mode` flag (Q4).
- Combined-spec divergence: interactive `composeSpecIntent` `/shape-spec ` body vs batch `/agent-os:shape-spec` `specText` (Q3).
- AMS: new Liquibase changesets only (next after 180); boxed Java types for PATCH-mutable fields; snake_case wire default, `@CamelCaseWire` only where camelCase consumers exist.
- Frontend: vitest + `renderWithProviders` helper; tsc baseline discipline.

## Confirmed Decisions

All eight clarifying questions were answered by the user, confirming the recommended option in each case. These decisions are now binding for the spec-writer; they resolve the open questions (Q1–Q5) flagged in the research above. None materially conflict with the code-tracing findings — each was re-verified against the code where the decision touches a concrete claim (see "Verification notes" at the end of this section). A later addition (D9) records forward-only groundwork that does NOT change any v1 user-facing behaviour.

### D1 — Screen hydration source of truth: the generator WRITES `implement-state.json`
The generator WRITES the gateway `implement-state.json` store (`PlannerResponse` + `TestPlannerResponse` + `hasTestPlan`) so the implement screen hydrates natively with NO panel re-plumbing. The AMS `migration_story_spec_generations` row stays the canonical generated artifact + combined spec text. The AMS `work_item_implement_workspace` JSONB is ORPHANED and stays UNTOUCHED.
- Resolves Q1. Confirms the research finding that the panel hydrates from gateway-filesystem `implement-state.json` and that the AMS workspace JSONB does not feed the screen.

### D2 — Reuse the existing implement-state route + serializer; no new AMS surface for screen state
Reuse the existing `PUT /api/implement-state` route + `serializeImplementState` shape (`schemaVersion` 1), written PER GENERATED STORY, resolving each story's `projectParentFolder` + `title`. NO new AMS columns or endpoints for the screen state.
- Resolves Q2. Generator-side work: for each generated story, resolve its `projectParentFolder` (the thread base path) and `title`, then PUT a serialized `PersistedImplementationState` to `/api/implement-state`.
- Route/serializer: `gateway/src/routes/implementState.ts`, `frontend/src/utils/implementStateSerializer.ts` (matching `serializeImplementState`/`PersistedImplementationState` shape, `schemaVersion` 1).

### D3 — Single canonical "view spec" body = the enriched batch `generated_spec_text`
The enriched batch `generated_spec_text` becomes the single canonical "view spec" body (test pack inline). "See Spec" / `SpecViewerModal` for a migration story reads THAT row (not `composeSpecIntent`). The literal prefix stays `/agent-os:shape-spec` (the contract Spec 3 sends onward).
- Resolves Q3. Ends the two-body divergence in favour of the batch `generated_spec_text` row. The interactive `composeSpecIntent` `/shape-spec ` body is NOT canonical for migration stories.
- The test pack is rendered INLINE into `generated_spec_text` (so the human-viewable spec body includes the unit/functional tests), in addition to being persisted structurally per D6.
- Prefix is unchanged: `/agent-os:shape-spec`.

### D4 — "Ready to implement" = populated PlannerResponse + populated Test Pack; no new flag
"Complete PM+TE / ready-to-implement" = write `PlannerResponse` with `plannerReadyForSpec=true` + EMPTY `openQuestions`, PLUS `latestTestPlannerResponse.testPlan` populated + `hasTestPlan=true`. NO new "ready" flag is introduced. `insufficient_context` stories are NOT marked ready — leave the screen showing the gap, NOT a fake-ready state.
- Resolves Q4. Confirms the research finding that the render gate is purely `latestPlannerResponse` (+ empty `openQuestions` + `plannerReadyForSpec`) and `latestTestPlannerResponse.testPlan`/`hasTestPlan`; no `implementation_mode` gate.
- `insufficient_context` path: do NOT synthesize a ready state. The implement screen should reflect the real gap for those stories.

### D5 — Reuse the existing book-of-work-level batch trigger; no new control
Reuse the existing book-of-work-level batch trigger (`startBatchGeneration` from `SpecGenerationWorkspace` + the Migration Delivery Dashboard "Generate All" dialog). The enrichment rides the SAME path (likely relabelled to signal "implementation-ready"). NO new separate control.
- Resolves Q5. Trigger surfaces unchanged: `startBatchGeneration` (`frontend/src/api/specGenerationApi.ts`), invoked from `SpecGenerationWorkspace.tsx`, `MigrationDeliveryDashboard.tsx` / `MigrationDeliveryGenerateAllDialog.tsx`, etc. A label change to communicate "implementation-ready" is acceptable; no new button/route.

### D6 — `tests` becomes a structured array, validated and persisted as a NEW JSONB column
The enriched `tests` field becomes a structured array `{ title, description, type: 'unit' | 'functional' }` (integration/E2E EXCLUDED — that is Spec 2), validated in `specGenerationResponseValidator.ts`, persisted as a NEW JSONB column on `migration_story_spec_generations`.
- New Liquibase changeset 181 (AFTER the latest applied = 180, confirmed). This is the SAME new changeset that carries the D9 `covered_endpoint_ids` column — changeset 181 adds BOTH the structured-tests JSONB column AND `covered_endpoint_ids` (see D9). snake_case column names. Boxed Java types for any PATCH-mutable field (per `project_primitive_double_dto_overwrite.md`), following the existing `decisions_json` / `interfaces_json` / `assumptions_json` / `warnings_json` JSONB idiom on this entity.
- The structured array aligns to `TestDefinition { title, description, type }` so it can populate `latestTestPlannerResponse.testPlan` (D1/D4) AND render inline into `generated_spec_text` (D3). `type` is constrained to `'unit' | 'functional'` only.
- Validator: extend the Generated variant in `gateway/src/services/specGenerationResponseValidator.ts` (today `tests: string[]`) to the structured array.

### D7 — Manually-added work items: SAME generator path, nullable `book_of_work_id`; no separate template editor
Manually-added work items get an implementation-ready spec through the SAME generator path — a spec row with nullable `book_of_work_id` (the entity already allows this) — with the SAME review/edit affordances. The existing combined-text manual edit covers hand-authoring; NO separate empty-template editor in v1.
- Confirms the entity already permits this: `MigrationStorySpecGenerationEntity.bookOfWorkId` is nullable (Javadoc: "Nullable so legacy / ad-hoc single-story regen flows remain representable").
- Hand-authoring is served by the existing `manualEditSpec` combined-text edit (reuse verbatim, including `manually_edited` overwrite protection). No new editor surface.

### D8 — "implement-workspace screen state" means the gateway `implement-state.json`
"implement-workspace screen state" = the gateway `implement-state.json` that renders the screen. Do NOT revive the orphaned AMS workspace JSONB.
- Reinforces D1/D2 alignment and the research finding that `usePersistWorkspace` / `fetchImplementWorkspace` / `workspaceStateMapper` / `implementWorkspaceApi` are orphaned for the panel. They remain untouched in v1.

### D9 — `coveredEndpointIds` groundwork (forward-only; NOT consumed in v1)
The enriched migration spec generator emits a NEW structured field `coveredEndpointIds: string[]` per story — the model `EndpointEntity` UUIDs this story migrates — captured now as forward-only GROUNDWORK. It is NOT consumed by any feature in v1; it is persisted so a future deferred feature needs NO story-side backfill.
- **Field + grounding:** `coveredEndpointIds: string[]` is best-effort grounded in the story's focused migration context — the architecture mappings / endpoints already resolved by `MigrationSpecContextResolver`. It does NOT introduce new context resolution; it reflects the model-endpoint ids already in scope for the story.
- **Empty for non-endpoint stories (IMPORTANT):** many migration stories are NOT about an HTTP endpoint (DB schema build, DB data migration, other-service code, infra). For those, emit an EMPTY array. Do NOT fabricate endpoint ids — this preserves the no-fabrication discipline.
- **Validator:** add `coveredEndpointIds` to the SpecGenerationResponse "Generated" variant in `gateway/src/services/specGenerationResponseValidator.ts` as an array of strings (MAY be empty).
- **Prompt:** add an instruction to `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md` to populate the model-endpoint ids in scope (empty array when the story has no endpoint in scope).
- **Persistence:** NEW column `covered_endpoint_ids` on `migration_story_spec_generations` (List<String> / JSONB), riding Spec 1's already-planned new Liquibase changeset **181** (alongside the D6 structured-tests column — see D6). snake_case wire; follows the entity's established JSONB idiom (`@Type(JsonType.class)`, boxed reference types).
- **PURPOSE (groundwork only):** a future "break-cause classification + filter" feature (DEFERRED) will use `coveredEndpointIds` to attribute reconciliation breaks to the owning story — `deferred` → "not implemented"; `manually_edited` → "deliberately changed"; else → "genuine bug". Capturing it at generation time NOW means that future feature needs NO story-side backfill.
- **EXPLICITLY OUT OF SCOPE (deferred to the future feature, do NOT build now):** the baseline-side `model_endpoint_id` on `api_behaviour_baseline_items` (+ its backfill); the break→story join; the cause classification; the rec-report cause filter. Spec 1 persists ONLY the story-side `coveredEndpointIds`.

### Verification notes (re-checked against code at finalization)
- `MigrationStorySpecGenerationEntity.bookOfWorkId` IS nullable (`@Column(name = "book_of_work_id")`, no `nullable=false`; Javadoc confirms) — supports D7.
- `generated_spec_text` Javadoc confirms the literal prefix is `/agent-os:shape-spec` and the gateway validator (A-4) enforces it — supports D3 (prefix unchanged) and D6 (validator is the enforcement point).
- Latest applied Liquibase changeset = 180 — the new structured-tests JSONB column (D6) AND the new `covered_endpoint_ids` JSONB column (D9) both land in the SAME new changeset after 180 (changeset 181).
- No structural conflict for D6/D9: the new JSONB columns follow the entity's established sibling-JSONB pattern (`decisions_json` / `interfaces_json` / `assumptions_json` / `warnings_json`, all `@Type(JsonType.class)` + boxed reference types).
- D9 is forward-only groundwork — it does NOT change any v1 user-facing behaviour and is NOT consumed by any v1 feature.
- Visuals folder re-checked at finalization: still empty (no image/pdf assets).
