# Task Breakdown: In-Product Spec Editor + Confirm-Overwrite

## Overview
Total Task Groups: 10

This feature spans three services (AMS / Gateway / Frontend) and gates three pre-existing regeneration paths. Task Groups 1-4 are AMS-side and largely sequential (database -> entity/DTO -> service -> endpoints). Task Group 5 is the hierarchy DTO extension and can run in parallel with Groups 3-4. Task Groups 6-9 are frontend layered (editor wrapper -> drawer integration -> chip -> confirm modals). Task Group 10 fills test-coverage gaps end-to-end.

## Task List

### AMS Persistence Layer

#### Task Group 1: Manual-edit columns, entity, DTO, mapper
**Dependencies:** None

- [x] 1.0 Complete AMS persistence-layer foundation for manual-edit
  - [x] 1.1 Write 2-8 focused tests for the entity + DTO + mapper changes
    - JPA entity hydrates the four new fields from a row populated by Liquibase defaults (`manuallyEdited=false`, others null) on existing records
    - `MigrationStorySpecGenerationMapper` round-trips all four new fields entity <-> DTO
    - Skip exhaustive coverage of every field combination; the defaults + round-trip are sufficient
  - [x] 1.2 Create Liquibase changeset `154-migration-story-spec-generations-manual-edit.sql`
    - Add column `manually_edited BOOLEAN NOT NULL DEFAULT false`
    - Add column `last_manually_edited_at TIMESTAMPTZ` (nullable)
    - Add column `last_manually_edited_by VARCHAR(255)` (nullable)
    - Add column `previous_spec_text TEXT` (nullable)
    - Register the new changeset file in `db.changelog-master.yaml` in slot 154 (next free after 153)
    - Use a NEW changeset file; never edit an applied one (per `feedback_liquibase_immutable_changesets`)
  - [x] 1.3 Extend `MigrationStorySpecGenerationEntity`
    - Add boxed `Boolean manuallyEdited`, `Instant lastManuallyEditedAt`, `String lastManuallyEditedBy`, `String previousSpecText`
    - Use boxed types only (per `project_primitive_double_dto_overwrite` lesson)
    - Mirror the column names + nullability from the changeset
  - [x] 1.4 Extend `MigrationStorySpecGenerationDto` + `MigrationStorySpecGenerationMapper`
    - Add the four corresponding fields to the DTO (boxed types, default null / false)
    - Update mapper toDto / fromDto to carry them through
    - Preserve back-compat constructors (existing call sites compile)
  - [x] 1.5 Ensure persistence-layer tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Verify Liquibase changeset applies cleanly against a fresh schema
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- Liquibase changeset 154 applies cleanly; existing rows pick up `manually_edited=false` via the default
- Entity + DTO + mapper round-trip the new fields
- All four DTO fields are boxed types

### AMS Service Layer

#### Task Group 2: `applyManualEdit` service method
**Dependencies:** Task Group 1

- [x] 2.0 Add `applyManualEdit` to `MigrationStorySpecGenerationService`
  - [x] 2.1 Write 2-8 focused tests for `applyManualEdit`
    - Persists `specText` + audit fields + copies prior `generated_spec_text` into `previous_spec_text`
    - Re-runs `ShapeSpecHeadingParser` and refreshes decisions / interfaces / assumptions JSON
    - Re-runs `SpecQualityScorer` and refreshes score / grade / dimensions, capturing prior score into `previous_quality_score`
    - Skips the scorer when status is `insufficient_context` or `failed` (text + parser + audit still saved)
    - Skip exhaustive scoring assertions; one happy-path + one skip-scorer case is sufficient
  - [x] 2.2 Implement `applyManualEdit(projectId, specId, specText, editedBy)`
    - Load row by `projectId` + `specId`; throw 404-style exception if not found / not in project
    - Capture current `generated_spec_text` into `previous_spec_text` BEFORE overwrite (single-slot history)
    - Set `generated_spec_text = specText`, `manually_edited = true`, `last_manually_edited_at = Instant.now()`, `last_manually_edited_by = editedBy`
    - Mirror the post-write pipeline from `persistOne`: parser refresh, scorer refresh, prior-score capture
    - Reuse the existing scorer-skip guard for `insufficient_context` / `failed` statuses
    - Return the refreshed DTO
  - [x] 2.3 Ensure service-layer tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- `previous_spec_text` always captures the pre-edit text
- Parser + scorer refresh on save for normal rows; scorer skipped for `insufficient_context` / `failed`
- `editedBy` is the value passed in (not from body)

### AMS API Layer

#### Task Group 3: Manual-edit endpoint + overwrite flag on regeneration + pre-flight listing
**Dependencies:** Task Group 2

- [x] 3.0 Wire AMS endpoints: manual-edit, overwrite flag, pre-flight listing
  - [x] 3.1 Write 2-8 focused tests for the new + extended endpoints
    - `POST /api/projects/{projectId}/spec-generations/{specId}/manual-edit` persists, refreshes parser + scorer, returns updated DTO; reads `editedBy` from `X-User-Id` header
    - 404 when the spec row does not belong to the project
    - Single-story regenerate with `overwriteManuallyEdited=false` skips a manually-edited row; with `true` regenerates AND clears `manually_edited=false`
    - Batch Generate-all returns `skippedManuallyEditedCount` + `skippedManuallyEditedWorkItemIds` when flag is false
    - `GET .../migration-books-of-work/{bookId}/spec-generations/manually-edited-in-scope` returns the expected list shape
    - Skip exhaustive endpoint coverage; one critical case per behaviour
  - [x] 3.2 Add `POST /api/projects/{projectId}/spec-generations/{specId}/manual-edit`
    - Body `{ specText: string }`, header `X-User-Id`
    - Delegates to `applyManualEdit`; returns the updated DTO
    - 404 for unknown / cross-project specId
  - [x] 3.3 Extend single-story regenerate, batch Generate-all, retry-batch with `overwriteManuallyEdited`
    - Pick the convention already used (query param or body field) by the existing regenerate endpoint - match it
    - Default `false`
    - When false: skip rows where `manually_edited=true`
    - When true on a regenerate: after successful regenerate, set `manually_edited=false` (row is LLM-generated again); `previous_spec_text` is overwritten with the most recent LLM text
    - Batch response carries `skippedManuallyEditedCount: int` + `skippedManuallyEditedWorkItemIds: string[]`
  - [x] 3.4 Add `GET .../migration-books-of-work/{bookId}/spec-generations/manually-edited-in-scope`
    - Returns `[{ workItemId, workItemTitle, lastManuallyEditedAt, lastManuallyEditedBy }]` for stories under the book whose `manually_edited=true` and that would be touched by a Generate-all run
    - Same shape callable for the retry-batch flow by passing the candidate work-item-id set and filtering server-side
  - [x] 3.5 Ensure API-layer tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Manual-edit endpoint resolves `editedBy` from `X-User-Id` (not body)
- 404 returned for unknown / cross-project specId
- All three regeneration paths honour `overwriteManuallyEdited`
- Manually-edited-in-scope endpoint returns expected shape

### AMS Hierarchy DTO

#### Task Group 4: `manuallyEdited` on `MigrationDeliveryHierarchyNodeDto`
**Dependencies:** Task Group 1 (may run in parallel with Groups 2-3)

- [x] 4.0 Surface `manuallyEdited` on the hierarchy node DTO
  - [x] 4.1 Write 2-8 focused tests for the DTO + projection
    - Hierarchy projection populates `manuallyEdited` from the latest spec row
    - Back-compat constructor defaults to `false`
    - Skip exhaustive coverage of every projection branch
  - [x] 4.2 Extend `MigrationDeliveryHierarchyNodeDto`
    - Add `Boolean manuallyEdited`
    - Add the back-compat constructor overload (existing call sites compile, default `false`)
    - Follow the recent `qualityGrade` / `qualityScore` extension pattern
  - [x] 4.3 Update the JPQL projection / hierarchy builder
    - Pass `manuallyEdited` from the latest spec row into the new constructor argument
    - No N+1 - reuse the existing latest-spec join
  - [x] 4.4 Ensure hierarchy DTO tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- DTO carries `manuallyEdited` through to the frontend on the existing hierarchy fetch (no new endpoint)
- Back-compat constructors compile

### Gateway Layer

#### Task Group 5: Proxy routes + flag pass-through
**Dependencies:** Task Group 3

- [x] 5.0 Gateway proxies for the new endpoints and flag pass-through
  - [x] 5.1 Write 2-8 focused tests in `gateway/src/__tests__/`
    - Manual-edit route forwards `X-User-Id` header + body to AMS and relays status + body
    - Pre-flight `manually-edited-in-scope` route forwards path params + auth
    - Existing batch + retry-batch routes accept + forward `overwriteManuallyEdited` (and the optional `manuallyEditedWorkItemIdsToOverwrite` list)
    - Skip exhaustive auth / edge cases; happy path + one passthrough fidelity check is sufficient
    - Each test file MUST include `beforeEach` cleanup per the test-pattern memory rule
  - [x] 5.2 Add `POST /api/projects/:projectId/spec-generations/:specId/manual-edit`
    - Thin pass-through; forward `X-User-Id` header, `{ specText }` body
    - Relay AMS status + body verbatim
    - No new LLM calls
  - [x] 5.3 Add `GET /api/projects/:projectId/migration-books-of-work/:bookId/spec-generations/manually-edited-in-scope`
    - Thin pass-through proxy
  - [x] 5.4 Extend existing batch route + retry-batch route
    - Accept `overwriteManuallyEdited?: boolean` and optional `manuallyEditedWorkItemIdsToOverwrite?: string[]`
    - Forward both to AMS unchanged
    - Update `migrationShapeSpecGenerationHandler.ts` to support the new fields end-to-end
  - [x] 5.5 Ensure gateway-layer tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- All three proxies relay verbatim
- No new LLM / token-counting logic introduced
- Existing batch + retry routes still pass through other params unchanged

### Frontend Editor Component

#### Task Group 6: `SpecMarkdownEditor` wrapper component
**Dependencies:** None (can run in parallel with backend groups)

- [x] 6.0 Build the reusable Markdown editor wrapper
  - [x] 6.1 Write 2-8 focused Vitest tests for `SpecMarkdownEditor`
    - Renders with given `value` and reflects edits via `onChange`
    - Cmd/Ctrl+S keymap calls `onSave` and `preventDefault`s the browser dialog
    - `readOnly` disables editing
    - Skip exhaustive keymap coverage; one shortcut + one read-only check is sufficient
  - [x] 6.2 Add CodeMirror dependencies to `frontend/package.json`
    - `@uiw/react-codemirror`
    - `@codemirror/lang-markdown`
    - Pin to the versions already used elsewhere in the repo if any, otherwise pick the latest stable
  - [x] 6.3 Build `SpecMarkdownEditor.tsx`
    - Props: `value`, `onChange`, `onSave`, `readOnly`, `dirty`
    - Markdown highlighting, monospace font, auto-resize to container width
    - Cmd/Ctrl+S keymap with `preventDefault` calls `onSave`; active only while editor has focus
    - Controlled value so the parent owns dirty state + save lifecycle
    - No internal save / dirty logic - that lives in the drawer
  - [x] 6.4 Add a small line-diff utility (or reuse existing pass-1/pass-2 renderer)
    - If the cross-story-context spec already exposes a generic line-diff component, reuse it
    - Otherwise add `frontend/src/utils/lineDiff.ts` with a lightweight LCS-backed line-diff function
    - Stay lightweight (`diff` npm package or equivalent ~3KB module is acceptable; do NOT pull in a heavy lib)
  - [x] 6.5 Ensure editor-component tests pass
    - Run ONLY the 2-8 tests written in 6.1
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- Editor renders Markdown with highlighting
- Cmd/Ctrl+S calls onSave and suppresses browser default
- Component is purely controlled; no internal dirty / save logic

### Frontend Drawer Integration

#### Task Group 7: View/Edit toggle, Save/Discard, diff toggle, prefix warning
**Dependencies:** Task Groups 3, 5, 6

- [x] 7.0 Wire the editor into `MigrationDeliveryStoryDrawer.tsx`
  - [x] 7.1 Write 2-8 focused Vitest tests for drawer integration
    - View/Edit toggle swaps between read-only render and editor
    - Save calls gateway manual-edit endpoint, refreshes drawer from response (grade chip + quality panel + decisions tab)
    - Discard while dirty shows confirm dialog before reverting
    - Save with text NOT starting with `/agent-os:shape-spec` shows warning toast but still persists
    - Diff toggle renders when `previous_spec_text` is non-null
    - Save endpoint failure keeps editor open with text intact + error banner / toast
    - Skip exhaustive coverage of every keystroke; one critical assertion per behaviour
  - [x] 7.2 Add View / Edit toggle to drawer header
    - Default View (today's read-only Markdown render)
    - Toggle position: next to existing Regenerate button
  - [x] 7.3 Add Edit mode: editor + Save / Discard
    - Embed `SpecMarkdownEditor` for the generated-spec body
    - Save / Discard buttons in drawer footer
    - Dirty-state indicator cycles "Save" -> "Saving..." -> "Saved"
    - Cmd/Ctrl+S triggers save when editor focused
  - [x] 7.4 Save flow
    - POST gateway `/api/projects/:projectId/spec-generations/:specId/manual-edit`
    - On 2xx: replace in-memory spec row with the returned DTO; refresh quality-breakdown panel, decisions / interfaces / assumptions tabs, grade chip; dispatch any cache invalidation needed (`feedback_appshell_model_cache` style)
    - On failure: keep editor open, text intact, show error toast, do not discard buffered edits
    - If `specText` does not start with `/agent-os:shape-spec` show non-blocking warning toast and still persist
  - [x] 7.5 Discard flow
    - When dirty: confirm dialog "You have unsaved changes. Discard them?"
    - On confirm: revert to last-saved text, return to View mode
    - When clean: silently return to View mode
  - [x] 7.6 Diff toggle
    - When `previous_spec_text` is non-null show "View previous version" toggle in the spec-text section
    - Toggled on: render inline unified line-by-line diff (additions green, deletions red, interleaved)
    - Diff is read-only; user exits diff view to re-enter edit mode
  - [x] 7.7 Drawer-header "Edited" indicator
    - Subtle indicator when `manuallyEdited=true`
    - Tooltip: "Last edited by {lastManuallyEditedBy} on {lastManuallyEditedAt}"
  - [x] 7.8 Ensure drawer-integration tests pass
    - Run ONLY the 2-8 tests written in 7.1
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass
- View / Edit toggle works; Save / Discard / dirty-state behave per spec
- Save refreshes grade chip + quality panel + decisions tab from the DTO response (no manual reload)
- Prefix warning toast surfaces but does not block save
- Diff toggle renders when prior version exists
- Drawer-header Edited indicator shows audit details on hover

### Frontend Hierarchy Chip

#### Task Group 8: "Edited" chip on hierarchy tree
**Dependencies:** Task Group 4 (DTO field) + UI design idle wait until drawer ships (no functional dependency on Group 7)

- [x] 8.0 Render the "Edited" chip on the hierarchy tree
  - [x] 8.1 Write 2-8 focused Vitest tests for the hierarchy tree change
    - Story node with `manuallyEdited=true` renders the "Edited" pill alongside the quality-grade chip
    - Story node with `manuallyEdited=false` does NOT render the pill
    - Clicking the chip opens the drawer (same as clicking the row)
    - Skip exhaustive coverage; three assertions is sufficient
  - [x] 8.2 Extend `MigrationDeliveryHierarchyTree.tsx`
    - Read `manuallyEdited` off the hierarchy node DTO
    - Render small "Edited" pill on every story node where the flag is true
    - Position alongside the existing quality-grade chip
    - Subtle styling - match the stale / generated-status chip vocabulary; not alarming
    - Click on chip opens the drawer (same handler as row-click)
  - [x] 8.3 Ensure hierarchy-chip tests pass
    - Run ONLY the 2-8 tests written in 8.1
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 8.1 pass
- Chip only renders for manually-edited stories
- Chip click opens the drawer
- Styling matches existing chip vocabulary

### Frontend Confirm-Overwrite Modals

#### Task Group 9: Single-story modal + bulk picker (Generate-all + Retry-batch)
**Dependencies:** Task Groups 5, 7

- [x] 9.0 Build confirm-overwrite modals for single-story and bulk paths
  - [x] 9.1 Write 2-8 focused Vitest tests for the two modals
    - `ManualEditOverwriteConfirmModal`: opens only when `manuallyEdited === true`; Cancel closes; Continue calls regenerate with `overwriteManuallyEdited=true`
    - Single-story Regenerate on a non-edited row proceeds without the modal (existing behaviour preserved)
    - `ManualEditOverwriteBulkModal`: per-row checkboxes default to UNCHECKED (skip); "Overwrite all" / "Skip all" toggles work; Confirm posts the `manuallyEditedWorkItemIdsToOverwrite` array
    - Generate-all: cost-preview step still shown first; bulk picker shown as step 2 ONLY if pre-flight returns a non-empty list
    - Skip exhaustive coverage; the four behaviours above are sufficient
  - [x] 9.2 Build `ManualEditOverwriteConfirmModal.tsx`
    - Trigger: drawer Regenerate button when `manuallyEdited === true`
    - Copy: "This spec was edited by {user} on {date}. Regenerate will replace those edits with a fresh LLM output. Continue?"
    - Buttons: Cancel (close) / Continue (regenerate with `overwriteManuallyEdited=true`)
  - [x] 9.3 Build `ManualEditOverwriteBulkModal.tsx` (or extend Generate-all dialog with step 2)
    - Generate-all flow: existing cost-preview step FIRST; on Continue, call gateway `manually-edited-in-scope` pre-flight; if empty proceed to regenerate; otherwise show this picker as step 2
    - Retry-batch flow: pre-flight against the candidate work-item-id set; if any are manually-edited show the picker before running the batch
    - Picker UI: per-row checkbox labelled with title + `lastManuallyEditedBy` + `lastManuallyEditedAt`; default UNCHECKED (skip); "Overwrite all" / "Skip all" header toggle
    - On Confirm: submit the batch request to gateway with `manuallyEditedWorkItemIdsToOverwrite` array + `overwriteManuallyEdited: true` if non-empty
    - Skipped rows excluded from the regenerate batch and reported in the result summary
  - [x] 9.4 Wire the modals into existing flows
    - Drawer Regenerate handler: branch on `manuallyEdited`
    - Generate-all handler in `migrationShapeSpecGenerationHandler.ts` (frontend side) / its caller: pre-flight then optional step 2
    - Retry-batch handler in the missing-input resolver flow: same pre-flight
  - [x] 9.5 Ensure modal tests pass
    - Run ONLY the 2-8 tests written in 9.1
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 9.1 pass
- Single-story regenerate on a manually-edited row blocks on the confirm modal; non-edited path is unchanged
- Generate-all shows cost-preview first, then bulk picker only when the pre-flight list is non-empty
- Per-row checkboxes default UNCHECKED (skip)
- Skipped rows excluded from regenerate batch and reported in the result summary

### Testing

#### Task Group 10: Test review and gap analysis
**Dependencies:** Task Groups 1-9

- [x] 10.0 Review existing tests and fill critical gaps only
  - [x] 10.1 Review tests from Task Groups 1-9
    - AMS: Groups 1, 2, 3, 4 (approx 8-32 tests)
    - Gateway: Group 5 (approx 2-8 tests)
    - Frontend: Groups 6, 7, 8, 9 (approx 8-32 tests)
    - Total existing tests: approximately 18-72 tests across all layers
  - [x] 10.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack coverage (e.g., full save -> hierarchy chip refresh -> Edited indicator round-trip)
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit-test gaps
  - [x] 10.3 Write up to 10 additional strategic tests maximum
    - Suggested high-value targets:
      - End-to-end: manual edit -> save -> hierarchy chip appears -> Generate-all skips that row by default
      - End-to-end: bulk picker check + confirm -> overwrite executes -> chip disappears
      - End-to-end: diff toggle round-trips after save
      - Edge: 404 on cross-project specId from gateway end
    - Add maximum of 10 new tests to fill identified critical gaps
    - Focus on integration points and end-to-end workflows
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 10.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, and 10.3)
    - Expected total: approximately 28-82 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 28-82 tests total)
- Critical user workflows for this feature are covered end-to-end
- No more than 10 additional tests added when filling testing gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** — AMS persistence (changeset 154, entity, DTO, mapper). Strictly first; everything else depends on the columns existing.
2. **Task Groups 2 and 4 in parallel** — `applyManualEdit` service method (Group 2) and `manuallyEdited` on hierarchy DTO (Group 4). Both depend only on Group 1.
3. **Task Group 3** — AMS endpoints (manual-edit, overwrite flag, pre-flight listing). Depends on Group 2.
4. **Task Group 6 can run in parallel with all AMS work** — `SpecMarkdownEditor` wrapper is self-contained.
5. **Task Group 5** — Gateway proxies + flag pass-through. Depends on Group 3.
6. **Task Group 7** — Drawer integration. Depends on Groups 3, 5, 6.
7. **Task Group 8 can run in parallel with Group 7** — Hierarchy "Edited" chip. Depends only on Group 4.
8. **Task Group 9** — Confirm-overwrite modals (single + bulk). Depends on Groups 5 and 7.
9. **Task Group 10** — Test review + gap analysis. Depends on all prior groups.

Parallelization summary:
- After Group 1 ships: Groups 2, 4, 6 can run concurrently.
- After Group 5 ships: Group 7 starts; Group 8 can start in parallel as soon as Group 4 lands.
- Group 9 is the final gating group before test review.
