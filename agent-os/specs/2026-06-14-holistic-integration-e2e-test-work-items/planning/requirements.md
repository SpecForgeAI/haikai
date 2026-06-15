# Spec Requirements: Holistic Integration/E2E TEST Work Items (Spec 2 of 4)

## Initial Description

(From `planning/raw-idea.md` — most major product decisions are already LOCKED.)

After a feature's (or epic's) children have implementation-ready specs (Spec 1), run a
holistic Test-Engineer review across the children's specs to define a SMALL number of
cross-cutting INTEGRATION and E2E tests, and create them as first-class `TEST`-type work
items placed as SIBLINGS (children of the feature alongside its stories; or children of the
epic alongside its features). Each TEST item gets its OWN implementation-ready spec (the test
plan) so it is IMPLEMENTED via the Migrate loop (Spec 3) — Claude Code writes the actual
integration/E2E test CODE, which joins the test suite and is executed in Verification (Spec 4).
TEST items are NOT mere verification-time definitions — their deliverable is real automated
test code.

**LOCKED (do not re-litigate):** small number suffices (the prompt naturally returns
few/empty — no fabrication); generated at SPEC time (reviewable before Migrate); executed in
Verification (Spec 4); TEST items ARE implemented (test code built) through the Migrate loop,
exactly like stories; siblings (parentId = feature → sibling to stories; parentId = epic →
sibling to features); runs at FEATURE level (review stories) OR EPIC level (review features);
reuse `holisticTestPlanningPrompt.ts`.

**OUT OF SCOPE:** per-story unit/functional tests (Spec 1); the Migrate button + Driver +
auto-answerer that IMPLEMENTS these TEST items (Spec 3); Verification execution (Spec 4);
sequencing of TEST items after their covered children (Spec 3 owns the Migrate-loop ordering —
the sequencing handler has no TEST awareness today and is not changed here).

## Requirements Discussion

### Code-Tracing Findings (established by CODE READING; no app run)

Haikai services only (`gateway/`, `frontend/`, `architecture-model-service/`); repo-root
`src/` ignored per instruction.

#### 1. The harvest source — `gateway/src/services/holisticTestPlanningPrompt.ts`

- Exposes `StorySpecSummary { storyTitle, featureUnderstanding?, scopeIn?, scopeOut?,
  acceptanceCriteria?, implementationPlan?, testPlan? }` and
  `buildHolisticTestPlanningPrompt(context: ChatContext, storySpecs: StorySpecSummary[],
  testStrategy: string | null)`.
- The system prompt (`IMPLEMENT_HOLISTIC_TEST_PLANNING_PROMPT_TEMPLATE`) hard-codes
  **feature-level framing**: header "performing a holistic review of a feature and all its
  stories", `## FEATURE CONTEXT` (`{featureTitle}` / `{featureDescription}`), `## ALL STORY
  SPECS`, the task ("review each story individually… now review ALL stories together at the
  feature level"), references to "stories" throughout, and `formatStorySpec` prints
  `### Story N: {title}`.
- Output contract: VALID JSON ONLY — `{ schemaVersion: "1.0", message, testPlan:
  [{title, description, type}], openQuestions: [] }`, where `type` MUST be `"integration"` or
  `"e2e"` (rule 4 forbids `unit`/`functional`); `testPlan` MAY be empty when no cross-cutting
  tests are warranted (rule 9). This already satisfies the LOCKED "small number / no
  fabrication".
- **Generalization to feature|epic is small and purely textual** (no structural change to the
  function signature): the prompt's feature/story nouns need to become level-relative
  ("a {feature|epic} and all its {stories|features}") and `formatStorySpec`'s
  `### Story N` heading needs to become `### {Story|Feature} N`. The input assembly
  (`StorySpecSummary[]`) is unchanged in shape — for an EPIC level the array elements are the
  EPIC's FEATURES' specs instead of a FEATURE's STORIES' specs. So "review the immediate
  children's specs" is the one true generalization.

#### 2. Where the holistic prompt runs TODAY (interactive only — NOT persisted as work items)

- **Gateway**: `chat.ts` injects `TEST-STRATEGY.MD` for `phase === 'test_planning_holistic'`
  (lines 227, 732–741) reading `{projectParentFolder}/agent-os/product/TEST-STRATEGY.MD`. The
  prompt itself is built in `promptBuilder.ts` for that phase. This is the live-chat
  `implement_feature` path.
- **Frontend**: `useFeatureRefinementOrchestration.ts` cycles PM→TE per story, then sets
  `phase='holistic_review'` and exposes `holisticReviewData` (also a standalone
  `'holistic_only'` mode entered directly). `ImplementationAssistantPanel.triggerHolisticReview`
  (lines 2884–2981) maps `holisticReviewData.storyResults` → `storySpecs[]`, POSTs
  `test_planning_holistic` to `/api/chat`, and renders `response.testPlannerResponse.testPlan`
  into the in-panel Test Pack. The standalone entry point is `BacklogTab`
  `onDefineIntegrationTests(itemId)` → navigate `../implement/{itemId}` with
  `state.refinementMode='holistic_only'`; `FeatureHeader` shows the breadcrumb
  "Tests (Integration/E2E)".
- **CRITICAL: today's holistic output is consumed IN-MEMORY only** — it populates the panel's
  Test Pack (`latestTestPlannerResponse` / `hasTestPlan`) and the localStorage orchestration
  state. It is NOT written to AMS, NOT turned into `TEST` work items, and NOT given
  implementation-ready specs. Spec 2 must ADD that persistence + work-item creation. This
  matches the raw idea's intent to build a **headless, batch-style handler like Spec 1's
  generator** rather than reuse the interactive chat phase.

#### 3. The WorkItem model — `WorkItemEntity` / `WorkItemController` / `WorkItemService`

- `WorkItemEntity`: `type` is free-text `TEXT NOT NULL` (Javadoc audit confirms no enum / no
  check constraint); `parentId` (bare UUID FK, self-referential cascade delete); `sortOrder`
  (`Integer NOT NULL DEFAULT 0`); `status` (`NOT NULL DEFAULT "PLANNED"`); `description`;
  `priority`; `targetWindow`; `tagsJson` (jsonb); `implementation_*` git-outcome columns
  (changeset 180). `@PrePersist`/`@PreUpdate` manage timestamps.
- **`TEST` is ALREADY an allowed type.** `WorkItemService.ALLOWED_TYPES` (lines 47–49) =
  `{INITIATIVE, EPIC, FEATURE, STORY, TASK, BUG, TEST}`; `ALLOWED_STATUSES` =
  `{PLANNED, IN_PROGRESS, DEV_COMPLETE, COMPLETED, CANCELLED}`. The class Javadoc even states
  the conventional hierarchy `… STORY > (TASK | BUG | TEST)`. **No schema/enum change is
  needed to create a `TEST` work item.**
- **Parent-type relationships are NOT enforced.** `validateParentRelationship` (lines 372–389)
  is deliberately loose — it only checks the parent EXISTS and is in the SAME project. So a
  `TEST` item with `parentId` = a FEATURE row (sibling to stories) OR `parentId` = an EPIC row
  (sibling to features) is fully permitted. (Note the convention legacy `TEST` is uppercase.)
- **Create is single-item only.** `WorkItemController` exposes `POST .../work-items` →
  `WorkItemService.createWorkItem` (one DTO → one row). **There is NO batch-create endpoint**
  on this controller. The only batch-style WorkItem creation in the codebase is the
  save-to-backlog flow (next finding), which loops `persistOne` per draft item.
- WorkItem CRUD base path is `/api/model/projects/{projectId}/work-items` (note `/model/`),
  distinct from the migration endpoints under `/api/projects/{projectId}/…`.

#### 4. The plan/backlog tree is built from `book_of_work_json`, NOT the WorkItem table

- `MigrationDeliveryHierarchyNodeDto` Javadoc (lines 11–12): *"The hierarchy is built strictly
  from `generated_migration_books_of_work.book_of_work_json` … the service never derives
  structure from the WorkItem table."* Each node carries `id`, `parentId`, `type`, `title`,
  `workstream`, `sequenceOrder`, `workItemId` (the saved WorkItem UUID written back into the
  blob), plus seven badge fields (`backlogStatus`, `specGenerationStatus`,
  `specGenerationConfidence`, `implementationStatus`, `evidenceStatus`, `needsAttentionCount`,
  `missingInputsCount`) and `staleReason` / `qualityGrade` / `manuallyEdited`.
- The save-to-backlog flow (`GeneratedMigrationBookOfWorkService`, lines ~360–560) is the
  template for "create a WorkItem that surfaces in the tree":
  - It iterates `book_of_work_json.items[]` in depth+sequenceOrder order, calls
    `itemSaver.persistOne(...)` per admitted item (`REQUIRES_NEW`), and — **inside the same
    transaction** — STAMPS `workItemId` + `saveState="saved"` back onto the blob item, then
    persists the mutated `book_of_work_json`. The dashboard join is exclusively by stored
    `workItemId`; title-matching is forbidden.
  - `persistOne` (lines 1115–1166): builds the `WorkItemEntity` with
    `type = normaliseType(item.type)` (UPPERCASE), `parentId = resolvedParentId`,
    `sortOrder = sequenceOrderOf(draftItem)` (falls back to 0), `status = request
    .statusForCreatedItems() ?? DEFAULT_WORK_ITEM_STATUS`, `description = buildDescription(...)`,
    `tagsJson = buildTagsJson(...)`.
- **Implication for Spec 2 (the central placement decision):** for a `TEST` item to appear in
  the delivery-dashboard tree as a sibling, it must exist as an entry in
  `book_of_work_json.items[]` (with `type:"TEST"`, `parentId` = the feature/epic blob item id,
  a `sequenceOrder` after the spanned children, and — once created — a stamped `workItemId`),
  AND (for implementation) as a `work_item` row. The simple backlog/plan list (`BacklogTab` /
  `ProductBacklogPage`) reads the flat `work-items` table directly via
  `fetchProjectFolder`-style listing, so a `TEST` work_item row also surfaces there. Whether
  Spec 2 writes BOTH representations (blob item + work_item) or only the work_item row is an
  OPEN question (Q3/Q5 below) — it determines whether TEST items show in the delivery-dashboard
  tree vs. only the flat backlog.

#### 5. Spec 1's generator path — `migrationShapeSpecGenerationHandler.ts` + `migration_story_spec_generations`

- The generator is a headless batch over a **Book of Work**: `runShapeSpecGenerationBatch` →
  `selectEligibleStories` filters `item.type === 'story'` with a non-empty `workItemId`, then
  per-story fetches focused MIGRATION SPEC CONTEXT (`fetchMigrationSpecContext`, six context
  types: mappings/contracts/baselines/etc.), applies a token-budget cascade, detects
  insufficient-context, calls the LLM with the `product-manager.migration-shape-spec-generation`
  prompt, validates (`assertSpecGenerationResponse`), and persists rows via the AMS
  `/spec-generations/batch` endpoint.
- **The generator is STORY-shaped and migration-context-shaped.** It will NOT pick up a `TEST`
  item as-is: `selectEligibleStories` excludes non-`story` types, and a TEST item has NO
  migration discovery context (no mappings/baselines/contracts — its "input" is the holistic
  review output + the sibling specs + `TEST-STRATEGY.MD`). So a TEST item's implementation-ready
  spec is NOT a natural fit for the existing per-story context-fetch + LLM call without
  modification. This is the crux of Q6 (reuse Spec 1's exact generator vs. a lighter
  holistic-specific spec assembler).
- `MigrationStorySpecGenerationEntity`: `work_item_id` is **NOT NULL** (indexed) but
  `book_of_work_id` and `book_item_id` are **nullable** (confirmed). There is NO uniqueness
  constraint on `work_item_id` — a TEST WorkItem with its own UUID can own a
  `migration_story_spec_generations` row. The row holds `generated_spec_text` (literal prefix
  `/agent-os:shape-spec`, validator-enforced), `status`, `confidence`, the sibling JSONB
  arrays, manual-edit overwrite-protection columns, quality scoring, etc. Spec 1 (D6) is ALSO
  adding a new structured-`tests` JSONB column AFTER changeset 180 — **Spec 2 must coordinate
  changeset numbering with Spec 1.**
- Spec 1 (D1/D2) also WRITES the gateway `implement-state.json` per generated story so the
  implement screen hydrates as PM+TE-complete. For a TEST item, the equivalent "implement
  screen" hydration is an OPEN consideration (a TEST item's screen would show the test-plan
  spec; whether it also writes a populated `implement-state.json` like a story is a sub-point
  of Q6).

#### 6. The delivery-dashboard gateway route is a THIN proxy

- `gateway/src/routes/migrationDeliveryDashboard.ts` exposes only a GET (dashboard fetch) and a
  POST (`…/items/{bookItemId}/repair-orphan`) — both verbatim proxies to AMS. There is **no
  per-feature / per-epic "Define Integration Tests" action endpoint** here today. The existing
  batch-spec-generation trigger (`startBatchGeneration`, Spec 1's "Generate All") lives on the
  separate spec-generation API and is **book-of-work-scoped**, not feature/epic-scoped. So
  Spec 2's user-triggered holistic action needs a NEW trigger surface (gateway handler/route +
  a frontend control on a feature/epic node) — this is Q1.

### Existing Code to Reference (for the spec-writer to reuse, not re-derive)

**Harvest / generalize:**
- `gateway/src/services/holisticTestPlanningPrompt.ts` — generalize prompt nouns to
  feature|epic; reuse `StorySpecSummary` + `buildHolisticTestPlanningPrompt` verbatim in shape.
- `gateway/src/routes/chat.ts` (TEST-STRATEGY.MD injection, lines 732–741) +
  `gateway/src/services/promptBuilder.ts` — the existing test_planning_holistic wiring, as a
  reference for how the prompt is fed today.
- `frontend/src/hooks/useFeatureRefinementOrchestration.ts` +
  `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
  (`triggerHolisticReview`, 2884–2981) — the existing interactive consumer; the storySpecs
  mapping is reusable for the headless assembler's input.

**Generator path (Spec 1):**
- `gateway/src/services/migrationShapeSpecGenerationHandler.ts` — `runShapeSpecGenerationBatch`,
  `selectEligibleStories`, the per-row result + persistence shape; the dependency-injection
  seam pattern.
- `gateway/src/services/specGenerationResponseValidator.ts` — `assertSpecGenerationResponse`,
  `SPEC_TEXT_REQUIRED_PREFIX` (`/agent-os:shape-spec`).
- `architecture-model-service/.../MigrationStorySpecGenerationEntity.java` (+ its batch
  persist controller/service) — the spec-row store (work_item_id NOT NULL; book_of_work_id /
  book_item_id nullable).
- `agent-os/specs/2026-06-14-implementation-ready-migration-spec-generation/planning/requirements.md`
  — Spec 1's D1–D8 (esp. D6 new JSONB changeset AFTER 180 → coordinate numbering; D3 canonical
  `/agent-os:shape-spec` body; D1/D2 implement-state.json hydration).

**WorkItem creation + tree:**
- `architecture-model-service/.../WorkItemEntity.java`, `WorkItemController.java`,
  `WorkItemService.java` (single POST create; `TEST` allowed; loose parent validation).
- `architecture-model-service/.../GeneratedMigrationBookOfWorkService.java` (save-to-backlog
  loop + `persistOne` lines 1115–1166 + the `workItemId` write-back into `book_of_work_json` —
  the model for "create a sibling that surfaces in the dashboard tree").
- `architecture-model-service/.../MigrationDeliveryHierarchyNodeDto.java` +
  `MigrationDeliveryDashboardService.java` — the tree is built from `book_of_work_json`, not the
  WorkItem table; node `type` is free-text.
- `frontend/src/components/ProductManager/MigrationDeliveryDashboard/MigrationDeliveryHierarchyTree.tsx`
  + `MigrationDeliveryDashboard.tsx` (+ `MigrationDeliveryGenerateAllDialog.tsx`,
  `MigrationDeliveryStoryDrawer.tsx`) — the delivery-dashboard tree + the existing Generate-All
  trigger to model a per-feature/epic action on.
- `frontend/src/components/ProductView/BacklogTab.tsx` + `ProductBacklogPage.tsx` — the flat
  backlog list (reads the work-items table) + the existing `onDefineIntegrationTests`
  standalone entry point.
- `gateway/src/routes/migrationDeliveryDashboard.ts` — thin-proxy pattern for where a new
  per-feature/epic action route could mount.

### Follow-up Questions
(none yet — first round)

## Visual Assets

### Files Provided
No visual assets provided (bash check of `planning/visuals/` returned no image/pdf files at
first round).

### Visual Insights
N/A

## Requirements Summary

### Functional Requirements
- Generalize `holisticTestPlanningPrompt.ts` so the same review can run on a FEATURE (review
  its stories' specs) OR an EPIC (review its features' specs) — a small, textual prompt change
  ("review the immediate children's specs"); the `StorySpecSummary[]` input shape is unchanged.
- A user-triggered action (per feature/epic) that runs the holistic review headlessly once the
  level's children are spec-complete, producing a SMALL set of `{title, description,
  type: integration|e2e}` test definitions (may be empty — no fabrication).
- Create `TEST`-type work items as SIBLINGS (`parentId` = feature → sibling to stories;
  `parentId` = epic → sibling to features); status `PLANNED`; `sortOrder` AFTER the spanned
  children. (`TEST` is already an allowed type; parent validation is loose; create is
  single-POST today — a per-item loop, or a new batch endpoint, is needed.)
- Give each TEST item an implementation-ready spec (a `migration_story_spec_generations` row,
  `book_of_work_id` nullable) whose body instructs Claude Code to WRITE the integration/E2E test
  code aligned to `TEST-STRATEGY.MD` — so TEST items are first-class IMPLEMENTABLE work items.
- Surface TEST items in the plan/backlog tree as siblings, visibly distinguishable as `TEST`
  type. (The delivery-dashboard tree is built from `book_of_work_json`; the flat backlog reads
  the work-items table — see Q3/Q5 on which representation to write.)

### Reusability Opportunities
- `holisticTestPlanningPrompt.ts` (generalize nouns to feature|epic; reuse `StorySpecSummary`
  + `buildHolisticTestPlanningPrompt`).
- The headless batch-handler PATTERN from `migrationShapeSpecGenerationHandler.ts` (DI seams,
  per-item failure isolation, structured `[diag-gateway]` logs, AMS persistence client).
- `WorkItemEntity`/`WorkItemController` create + the save-to-backlog `persistOne` + the
  `workItemId` write-back-into-`book_of_work_json` pattern.
- Spec 1's generator + validator + `/agent-os:shape-spec` body for the per-TEST-item spec
  (subject to Q6 — exact generator vs. lighter holistic assembler).
- The delivery-dashboard tree + the Generate-All trigger as the model for the per-feature/epic
  action surface.

### Scope Boundaries
**In Scope:** prompt generalization (feature|epic); the headless holistic-review action +
trigger; `TEST` work-item creation as siblings with correct `sortOrder`; each TEST item's
implementation-ready spec row; tree/backlog display + TEST distinction.
**Out of Scope:** per-story unit/functional tests (Spec 1); the Migrate button/Driver/external
shape-spec auto-answerer that IMPLEMENTS the TEST items (Spec 3); Verification execution
(Spec 4); Migrate-loop sequencing of TEST items after their children (Spec 3).

### Technical Considerations
- Tree-from-`book_of_work_json`: a TEST item only shows in the DELIVERY-DASHBOARD tree if it is
  written into `book_of_work_json.items[]` (with `parentId` + `sequenceOrder` + stamped
  `workItemId`); a bare work_item row shows only in the FLAT backlog list. (Q3/Q5.)
- `migration_story_spec_generations.work_item_id` is NOT NULL (so the TEST WorkItem must exist
  before its spec row); `book_of_work_id` / `book_item_id` nullable; no uniqueness on
  `work_item_id`.
- Spec 1 also adds a NEW Liquibase changeset AFTER 180 (its structured-`tests` JSONB column) —
  **coordinate changeset numbering** so Spec 1 and Spec 2 do not collide. Spec 2 may need NO
  new column at all if it reuses the existing entity (the TEST item's row uses the same columns
  as a story's row).
- AMS conventions: new Liquibase changesets ONLY; snake_case wire (default); boxed
  PATCH-mutable types; `@CamelCaseWire` only where a camelCase consumer exists.
- The generator is story+migration-context shaped; a TEST item has no migration discovery
  context — so the per-TEST-item spec likely needs a holistic-specific assembler (or a
  context-bypass branch in the existing generator). (Q6.)
- Gating: the holistic action presupposes the level's children are spec-complete; behaviour
  when some children are `insufficient_context` / not-yet-generated is undefined today. (Q5.)

## Confirmed Decisions

All seven clarifying questions (Q1–Q7) were CONFIRMED by the user exactly as recommended on
2026-06-14. Each decision below is checked against the Code-Tracing Findings above; no decision
materially conflicts with the research — several RESOLVE questions the research left open
(Q3/Q5 representation, Q5 gating, Q6 assembler vs. generator, Q7 changeset).

### D1 — Trigger surface: NEW headless batch-style handler + NEW per-node action (resolves Q1)

- The holistic review runs via a **NEW headless gateway handler**, modelled on
  `runShapeSpecGenerationBatch` (`migrationShapeSpecGenerationHandler.ts`): dependency-injection
  seams, per-item failure isolation, structured `[diag-gateway]` logs. It is **NOT** the
  interactive `test_planning_holistic` chat phase (finding #2's in-memory-only consumer is a
  reference for the storySpecs mapping, not the execution path).
- It is invoked by a **NEW per-node "Define Integration/E2E Tests" action** on a **feature or
  epic** in the **Migration Delivery Dashboard hierarchy tree**, placed NEXT TO the existing
  Generate-All control (model the surface on `MigrationDeliveryGenerateAllDialog` /
  `MigrationDeliveryHierarchyTree`). A new gateway handler/route is required (finding #6: the
  delivery-dashboard route is a thin GET/repair-orphan proxy today with no per-feature/epic
  action; Generate-All is book-of-work-scoped, not node-scoped).
- **Re-point** the existing `BacklogTab` `onDefineIntegrationTests` entry point to this NEW
  headless flow (replacing today's navigate-to-`holistic_only`-interactive-chat behaviour from
  finding #2).

### D2 — One TEST work item per generated test (resolves Q2)

- Emit **ONE `TEST` work item per generated test** (not one bundle item). Each TEST item has its
  OWN title, its OWN implementation-ready spec, and is independently implementable (Spec 3) and
  verifiable (Spec 4). Consistent with the LOCKED "small number" and finding #3.

### D3 — Write BOTH representations: blob item AND work_item row (resolves Q3/Q5-representation)

- For every TEST item, write **BOTH**, mirroring the save-to-backlog write-back (finding #4):
  1. a `book_of_work_json.items[]` **blob item** — `type:"TEST"`, `parentId` = the feature/epic
     blob item id, a `sequenceOrder` (see D4), and — once the row is created — a **stamped
     `workItemId`** written back into the blob inside the same transaction; AND
  2. a **`work_item` row** (via the `persistOne`-style create, finding #4 lines 1115–1166).
- Writing both is what makes the TEST sibling appear in the **delivery-dashboard tree** (built
  strictly from `book_of_work_json`, joined by stored `workItemId` — title-matching forbidden)
  exactly like saved stories, AND in the **flat backlog** (reads the work-items table). This is
  the richer of the two options the research flagged as OPEN in finding #4 / Q3.

### D4 — sortOrder/sequenceOrder placement: right after the last spanned child (resolves Q4)

- Place each TEST item **right after the last spanned child**:
  `sortOrder` (and blob `sequenceOrder`) = `max(child sequenceOrder / sortOrder among the
  feature's/epic's existing children) + 1`, with an **incrementing offset** for multiple TEST
  items (… + 1, + 2, …). Uses finding #4's `sortOrder` / `sequenceOrder` mechanics directly.
- NOTE (no conflict, restates OUT OF SCOPE): this sets the SIBLING display order only. The
  Migrate-loop *execution* sequencing of TEST items after their covered children remains Spec 3
  (the sequencing handler has no TEST awareness and is not changed here).

### D5 — TEST type literal + chip/filter; ALLOW-WITH-WARNING gating (resolves Q5)

- **(a) Type:** the WorkItem `type` is the literal uppercase **`TEST`** — already in
  `WorkItemService.ALLOWED_TYPES` (finding #3); **no new sub-type column, no enum/schema
  change.** The tree and flat backlog render a **distinct TEST chip/badge** plus a **show/hide
  filter** for TEST items.
- **(b)(c) Gating = ALLOW-WITH-WARNING (NOT a hard block):** run the holistic review on the
  children that ARE spec-complete (`generated` / `generated_with_warnings`), and **prominently
  warn + list** any children still `insufficient_context` / not-yet-generated. The user may
  **proceed** (review the spec-complete children only) or **close the gaps first and re-run.**
  This resolves the "behaviour undefined today" note in finding #5 / Q5.

### D6 — Dedicated lighter holistic→spec assembler + implement-state.json hydration (resolves Q6)

- A **DEDICATED, lighter holistic→spec assembler** (NOT Spec 1's per-story generator) produces
  each TEST item's implementation-ready spec body — a canonical `/agent-os:shape-spec`
  **test-plan body** that instructs Claude Code to **WRITE the integration/E2E test code aligned
  to `TEST-STRATEGY.MD`**.
- **REUSE from Spec 1:** the `migration_story_spec_generations` **row schema** (incl. Spec 1's
  new structured-`tests` column), the **validator** (`assertSpecGenerationResponse` +
  `SPEC_TEXT_REQUIRED_PREFIX` = `/agent-os:shape-spec`), and the **AMS persistence client**
  (`/spec-generations/batch`). Persist a row **keyed on the TEST item's `work_item_id`**
  (`work_item_id` NOT NULL; `book_of_work_id` / `book_item_id` nullable; no uniqueness
  constraint — finding #5).
- **DO NOT REUSE** Spec 1's per-story **migration-context fetch** (`fetchMigrationSpecContext` /
  the six mappings/baselines/contracts context types) — a TEST item has no migration discovery
  context; its inputs are the holistic review output + the sibling specs + `TEST-STRATEGY.MD`
  (finding #5: the generator is story- and migration-context-shaped and excludes non-`story`
  types). This resolves the Q6 crux directly.
- **ALSO populate the gateway `implement-state.json`** for the TEST item (mirroring Spec 1
  D1/D2): scope = "write these integration/E2E tests"; Test Pack = the test definitions;
  `plannerReadyForSpec` and `hasTestPlan` set — so the TEST item's Implement screen hydrates
  uniformly, exactly like a story's.

### D7 — No new Liquibase changeset for Spec 2 (resolves Q7)

- Spec 2 adds **NO new Liquibase changeset.** It reuses the existing **WorkItem create** path
  and the existing **`migration_story_spec_generations` schema** (including the new
  structured-tests column that **Spec 1** introduces after changeset 180). This lands on the
  "may need NO new column at all" branch the research flagged in finding #5 / Technical
  Considerations.
- **Coordinate the changeset number with Spec 1 ONLY if one proves necessary** during build
  (e.g., if a TEST-specific column turns out to be unavoidable). Default expectation: none.

### Conflict check vs. research

No material conflict. Every confirmed decision is consistent with the Code-Tracing Findings;
D3, D5(b)(c), D6, and D7 specifically RESOLVE points the research explicitly recorded as OPEN
(Q3/Q5 representation, Q5 gating, Q6 generator-vs-assembler, Q7 changeset). Scope boundaries are
unchanged — Spec 3 (Migrate/Driver + execution sequencing) and Spec 4 (Verification execution)
remain out of scope.
