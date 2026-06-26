# Task Breakdown: Target-state Conversation — Versioned-Answer Bare-Stem UX

## Overview
Total Tasks: 7 task groups

This is a **gateway-config + frontend** change. There is **no new AMS DTO** and **no change to the captured-decision envelope or the POST `/capture` path** — those stay exactly as they are today (`answerValue = JSON.stringify({value, sourceQuote, sourceFile})`, `answerSummary` = resolved chip). The work is a gateway question-library/cascade re-key plus a frontend re-key, layout restyle, and resolved-label render fix.

### Implementer note (READ BEFORE TOUCHING ANY FILE)
- **Every file in this spec already EXISTS.** Implementer subagents tend to `Write` whole files, which clobbers unrelated code. For every existing file, make **surgical / anchored edits** (locate the exact existing block, change only that block) and **preserve all unrelated code, imports, comments, and exports**. Do NOT regenerate a file from scratch.
- After editing any file, run a **post-edit scan for mojibake and NUL bytes** (e.g. stray `Ã`/`Â`/`â€`/replacement-character sequences, `\0`). These files contain prose comments and chip strings — corruption here is silent and ships to UI.
- Re-keying is **string-substitution-sensitive**: when you collapse `'Java 21'` + `'Java 17'` to `'Java'`, make sure you don't accidentally merge two map entries into one with a lost value, or leave a dangling laden key.

### Verification policy (applies to EVERY task group)
- **Verification is ISOLATION-ONLY.** The frontend whole-repo `tsc`/lint/build baseline is **pre-existingly RED** — do NOT run a whole-repo build, whole-repo `tsc`, or whole-repo lint to verify this feature, and do NOT treat pre-existing red as this spec's failure.
- **Frontend = Vitest**, run only the **specific `.test.tsx` / `.test.ts` files** for the touched modules.
- **Gateway = Jest**, run only the **specific suites** for the touched modules.
- Several EXISTING tests encode the OLD (version-laden / raw-JSON / dead-cascade) behaviour and **WILL need updating** to the new behaviour — that update is part of the owning task group, not a regression.

## Task List

### Gateway Layer — Question Library

#### Task Group 1: Bare-stem question library + cascade trigger/seed re-key
**Dependencies:** None

Files:
- `gateway/src/config/architect-conversation/questionLibrary.ts` (edit — existing)
- `gateway/src/config/architect-conversation/__tests__/questionLibrary.test.ts` (edit — existing)

- [x] 1.0 Expand the versioned set to 24 and re-key all cascade trigger maps + downstream seed values to bare stems
  - [x] 1.1 Write/update 2-8 focused Jest tests for the question-library re-key
    - Assert `versioned: true` is set on the full closed set of **24 codes**: existing 7 (`service.language`, `service.framework`, `service.runtime`, `db.engine`, `db.driver`, `ui.framework`, `build.tool`) + new 17 (`db.migrations`, `db.connectionPool`, `validation.framework`, `domain.mappingStrategy`, `logging.framework`, `metrics.framework`, `tracing.framework`, `ui.buildTool`, `ui.stateManagement`, `ui.designSystem`, `ui.testing`, `testing.unit`, `testing.integration`, `testing.e2e`, `testing.contractTesting`, `testing.mocking`, `interservice.asyncBus`)
    - Assert a representative cascade `valueByTriggerValue` is now keyed by a **bare stem** (e.g. `'Java'`, `'Spring Boot'`), not a laden string (`'Java 21'`, `'Spring Boot 3.4'`)
    - Assert at least one re-keyed downstream **seed value** is a bare stem (`'Eclipse Temurin'`, `'JUnit'`, `'Gradle'`)
    - Limit to 2-8 highly focused tests; do not exhaustively assert all 51 questions
  - [x] 1.2 Set `versioned: true` on the 17 new codes (the 7 existing already carry it)
    - Surgical edit per entry; do not reorder or rewrite untouched entries
  - [x] 1.3 Re-key every cascade `valueByTriggerValue` TRIGGER map from laden strings to bare stems
    - `'Java 21'` -> `'Java'`, `'Spring Boot 3.4'` -> `'Spring Boot'`, etc. across all `cascades[].valueByTriggerValue` keys
  - [x] 1.4 Re-key downstream SEED VALUES that target now-versioned codes to bare stems
    - e.g. `service.language` -> `service.runtime` seed `'Eclipse Temurin 21'` -> `'Eclipse Temurin'`; -> `testing.unit` `'JUnit 5'` -> `'JUnit'`; -> `build.tool` `'Gradle 8'` -> `'Gradle'`
    - A cascaded value must match a bare-stem chip so it pre-selects that stem's curated default version downstream
  - [x] 1.5 Bare-stem the `build.tool` choices/seed data so it stops double-encoding
    - Source of the `{framework:'Maven 3.9', version:'Maven 3.9'}` doubling; ensure the data feeding `build.tool` yields stem `'Maven'` + version `'3.9'` (and `'Gradle'` + `'8'`)
  - [x] 1.6 Confirm version-less stems carry no curated-default expectation
    - `none` / `manual` / `in-house`-style choices (e.g. `db.migrations: none-managed-by-app`, `domain.mappingStrategy: manual mapper classes` / `none-direct-entity-exposure`) remain choices but are NOT treated as having a default; `domain.mappingStrategy` STAYS versioned for MapStruct / ModelMapper
  - [x] 1.7 Run ONLY the gateway question-library Jest suite
    - `gateway/src/config/architect-conversation/__tests__/questionLibrary.test.ts`
    - Update any existing assertions in that suite that encoded laden trigger/seed strings
    - Do NOT run the whole gateway test suite or any build

**Acceptance Criteria:**
- The 2-8 tests in 1.1 pass; the existing `questionLibrary.test.ts` is updated and green in isolation
- All 24 codes carry `versioned: true`
- Every cascade trigger key and every downstream seed targeting a versioned code is a bare stem
- `build.tool` data no longer doubles the stem
- No unrelated question entries were rewritten; no mojibake/NUL introduced

### Gateway Layer — Cascade Engine

#### Task Group 2: Cascade-engine object-value fix
**Dependencies:** Task Group 1

Files:
- `gateway/src/services/architectConversation/decisionCaptureOrchestrator.ts` (edit — existing, `computeCascadeProposals` ~lines 271-291)
- `gateway/src/services/architectConversation/__tests__/decisionCaptureOrchestrator.test.ts` (edit — existing)

- [x] 2.0 Teach `computeCascadeProposals` to derive the trigger key from `value.framework` for `{framework, version}` objects
  - [x] 2.1 Write/update 2-8 focused Jest tests for the engine fix
    - Assert that an object trigger value `{framework:'Java', version:'21.0.5'}` now yields the cascade proposals keyed under `'Java'` (today it returns `[]` because of the `typeof === 'string'` guard)
    - Assert a plain-string trigger value still resolves exactly as before (no regression to single-choice cascades)
    - Assert the two currently-working source cascades (`logging.framework`, `interservice.asyncBus`) still fire after flipping to versioned object values
    - Assert results remain **proposals** (no silent commit) — the return shape is unchanged `PendingCascadeProposal[]`
    - Limit to 2-8 focused tests
  - [x] 2.2 Derive `triggerKey` from `value.framework` when the answer value is a `{framework, version}` object
    - Replace the current `typeof triggerAnswerValue === 'string' ? triggerAnswerValue : null` derivation so an object with a string `framework` field resolves its `framework` (the bare stem) as the key; keep the string path intact; keep the `null` short-circuit for genuinely unkeyable values
    - Surgical edit of the key-derivation lines only; do NOT alter the proposal-building loop, the partial-function skip behaviour, or the function signature
  - [x] 2.3 Run ONLY the gateway cascade-engine Jest suite
    - `gateway/src/services/architectConversation/__tests__/decisionCaptureOrchestrator.test.ts`
    - Update any existing test that asserted object values return `[]` (the dead-cascade behaviour) to the new fire-from-stem behaviour
    - Do NOT run the whole gateway suite or any build

**Acceptance Criteria:**
- The 2-8 tests in 2.1 pass; the existing orchestrator suite is updated and green in isolation
- Object `{framework, version}` answers fire cascades keyed off the bare stem
- String answers and the two flipped source cascades (`logging.framework`, `interservice.asyncBus`) are not regressed
- Cascades remain editable proposals, never silent commits
- Function signature and proposal shape unchanged; no mojibake/NUL introduced

### Frontend Layer — Versioned Config + Guard-rail

#### Task Group 3: Re-key `versionControlConfig.ts` to bare stems + guard-rail contract test
**Dependencies:** Task Group 1 (mirrors the gateway closed set and choices)

Files:
- `frontend/src/components/targetState/architectConversation/versionControlConfig.ts` (edit — existing)
- bare-stem dedup helper (add to `versionControlConfig.ts` or a sibling module it imports)
- guard-rail contract test (new `*.test.ts` under `frontend/src/components/targetState/architectConversation/__tests__/`)

- [x] 3.0 Re-key the recommended-default map to stems, expand the code set to 24, add the dedup helper, and add the guard-rail contract test
  - [x] 3.1 Write the GUARD-RAIL contract test (its own deliverable — hard requirement)
    - Assert (1) **every single-choice value the system emits is a real member of that code's `questionLibrary.choices`**
    - Assert (2) **every versioned stem has a curated default version** in `RECOMMENDED_VERSION_BY_FRAMEWORK`
    - Allow the explicit exception: **version-less mixed stems** (`none` / `manual` / `in-house`-style) have NO curated default and must pass
    - Goal: any chip / choice / default / cascade-seed drift goes RED in CI
    - This is the primary test for this group; keep the remaining group tests to a small focused set (stay within 2-8 total beyond this contract test)
  - [x] 3.2 Re-key `RECOMMENDED_VERSION_BY_FRAMEWORK` from laden choice strings to bare stems
    - `'Java 21'` + `'Java 17'` collapse to a single `'Java'` entry; all other entries re-keyed to their stem with their existing value preserved
    - Set **Spring Boot default to `'4.0'`** (currently `'3.4.1'` under key `'Spring Boot 3.4'`)
    - Do NOT change any other default value or the granularity philosophy; version-less stems get NO entry
    - Watch the merge hazard called out in the implementer note when collapsing two laden keys into one stem
  - [x] 3.3 Expand `VERSIONED_DECISION_CODES` to the same closed 24-code set as the gateway
    - Mirror Task 1.2 exactly; keep `isVersionedCode` / `recommendedVersionFor` / `buildFrameworkVersionCaptureValue` and the envelope shape UNCHANGED
  - [x] 3.4 Add the bare-stem DEDUP helper
    - Collapses a question's `choices` that split one stem across versions (e.g. `Java 21` + `Java 17`) into a single `[Java]` chip set
    - Must sit BETWEEN the question's `choices` and the chip set, because `ConversationMainPane.tsx` (~line 342) passes `frameworkChoices={choices}` verbatim
    - A version-less stem is emitted as its stem-only chip with no version field and no default
  - [x] 3.5 Run ONLY the targeted Vitest files for this group
    - The new guard-rail contract test plus any existing `versionControlConfig` test
    - Do NOT run a whole-repo build / tsc / lint

**Acceptance Criteria:**
- The guard-rail contract test (3.1) passes and would go RED on choice/default/seed drift
- `RECOMMENDED_VERSION_BY_FRAMEWORK` is stem-keyed, Spring Boot = `'4.0'`, all other defaults unchanged
- `VERSIONED_DECISION_CODES` matches the gateway 24-code set
- The dedup helper collapses version-split stems into one chip and is the seam consumed by the control
- `buildFrameworkVersionCaptureValue` / envelope shape unchanged; no mojibake/NUL introduced

### Frontend Layer — Versioned Answer Control

#### Task Group 4: Compact horizontal layout + auto-select toggle + commit-on-chip
**Dependencies:** Task Group 3

Files:
- `frontend/src/components/targetState/architectConversation/VersionedAnswerControl.tsx` (edit — existing)
- `frontend/src/components/targetState/architectConversation/VersionedAnswerControl.module.css` (edit — existing)
- `frontend/src/components/targetState/architectConversation/ConversationMainPane.tsx` (edit — existing; header toggle, dedup wiring, drop lead-in)
- `frontend/src/components/targetState/architectConversation/__tests__/VersionedAnswerControl.test.tsx` (edit — existing)
- `frontend/src/components/targetState/architectConversation/__tests__/ConversationMainPane.answerControls.test.tsx` (edit — existing)
- `frontend/src/components/targetState/architectConversation/__tests__/ConversationMainPane.contextLeadIn.test.tsx` (edit — existing; the lead-in is being DROPPED)

- [x] 4.0 Restyle to compact horizontal layout, add the localStorage auto-select toggle, and wire commit-on-chip + Edit/Save version
  - [x] 4.1 Write/update 2-8 focused Vitest tests for the control + header behaviour
    - Toggle ON (default): clicking a framework chip commits stem + curated default version in ONE action
    - Toggle OFF: editable version field + "Save version" shown from the start (today's two-step)
    - A version-less stem commits with NO version regardless of toggle state
    - "Edit version" reveals the version field + "Save version" (equals the toggle-OFF view)
    - Toggle state persists in localStorage and defaults ON on first load
    - The italic static context lead-in is GONE (update/repurpose `ConversationMainPane.contextLeadIn.test.tsx`)
    - Limit to 2-8 focused tests across the control + pane
  - [x] 4.2 Replace the tall vertical version box with a compact horizontal layout
    - Framework chips on the LEFT; version on the RIGHT as a confirmed chip + an "Edit version" button
    - Update `VersionedAnswerControl.module.css` for the horizontal arrangement; reuse the existing resolved-chip render
    - If a mockup later lands in `planning/visuals/`, the compact-layout + auto-select mockup is the authoritative UX reference (visuals folder is empty at authoring time)
  - [x] 4.3 Drop the italic static context lead-in that repeats the question text
    - Remove it in `ConversationMainPane.tsx` (the site that renders it); update the lead-in test accordingly
  - [x] 4.4 Render the auto-select toggle in the conversation header
    - Right-aligned, labelled "Auto-select recommended version", default ON, persisted in browser localStorage (sticky per machine, no backend); pass its state down to the control
  - [x] 4.5 Implement commit-on-chip (toggle ON) and the Edit/Save version escape hatch
    - ON: chip click immediately commits stem + curated default; change stem via another chip; change version via "Edit version" -> field + "Save version"
    - OFF: editable field + "Save version" from the start
    - Version-less stem commits with no version in both modes
    - Keep emitting the existing `{framework, version}` value via `buildFrameworkVersionCaptureValue`; do NOT change the envelope or capture path
  - [x] 4.6 Wire the bare-stem dedup helper (from 3.4) into the chip set
    - Apply the helper between `choices` and the chips so `frameworkChoices` passed at ~line 342 yields bare-stem chips
  - [x] 4.7 Run ONLY the targeted Vitest files for this group
    - `VersionedAnswerControl.test.tsx`, `ConversationMainPane.answerControls.test.tsx`, `ConversationMainPane.contextLeadIn.test.tsx`
    - Do NOT run a whole-repo build / tsc / lint

**Acceptance Criteria:**
- The 2-8 tests in 4.1 pass; the three existing suites are updated and green in isolation
- Layout is compact + horizontal; the repeated italic lead-in is removed
- Toggle lives right-aligned in the header, defaults ON, persists in localStorage
- ON commits stem+default on chip click; OFF keeps the two-step; version-less commits with no version
- Existing `{framework, version}` envelope + POST `/capture` path unchanged; no mojibake/NUL introduced

### Frontend Layer — Resolved-Label Rendering

#### Task Group 5: Render resolved labels (not raw JSON) at all four sites
**Dependencies:** Task Group 3 (stem keys / resolved-chip helper)

Files:
- `frontend/src/components/targetState/architectConversation/SummaryPanel.tsx` (edit — existing, `SummaryRow` ~lines 180-195)
- `frontend/src/components/targetState/architectConversation/ConversationMainPane.tsx` (edit — existing; turns at lines 808, 822, 839, 860)
- `frontend/src/components/targetState/architectConversation/exportTranscript.ts` (edit — existing; lines 203, 211, 226, 244)
- `frontend/src/api/architectConversationApi.ts` (edit — existing; the `DecisionCapturedTurn` fork)
- `frontend/src/components/targetState/architectConversation/__tests__/exportTranscript.test.ts` (edit — existing)
- a Vitest test for `SummaryPanel` resolved-label rendering (add/extend under `__tests__/`)

- [x] 5.0 Replace raw-JSON rendering with the resolved chip at the panel, preview, transcript turns, and export
  - [x] 5.1 Write/update 2-8 focused Vitest tests for resolved-label rendering
    - `SummaryPanel` row for a versioned code renders `service.framework: Spring Boot 4.0` (resolved chip), not raw JSON; same path covers the prompt-ready "Preview" output
    - A single-choice (plain-string) row still renders its string
    - `exportTranscript` emits the resolved label at the four fixed lines (203, 211, 226, 244)
    - A decision-captured turn renders the resolved chip (covers the `answerSummary`-not-on-`DecisionCapturedTurn` fork)
    - Limit to 2-8 focused tests across panel + export + turns
  - [x] 5.2 Fix `SummaryPanel.tsx` `SummaryRow` to prefer `row.answerSummary`
    - Prefer `row.answerSummary` (already on `CapturedDecisionRow`, `architectConversationApi.ts:569`) instead of falling through to `String(row.answerValue)`; today it only JSON-unwraps for `createdByTask === 'tech-stack-md-prefill'`
    - This single fix covers BOTH the "Decisions captured" panel and the prompt-ready "Preview" output
  - [x] 5.3 Resolve the `DecisionCapturedTurn` fork ONE way, consistently
    - `DecisionCapturedTurn` (`architectConversationApi.ts:280-285`) carries `answerValue` but NOT `answerSummary`
    - EITHER resolve the chip client-side from the envelope `value` (object -> `resolveFrameworkVersionChip`, plain string -> the string) OR extend the turn shape to carry `answerSummary` — pick one and apply it consistently across the four turns
  - [x] 5.4 Fix the four `ConversationMainPane.tsx` turn renders
    - decision-captured (line 839), cascade-accepted (808), cascade-overridden (822), exception-pinned (860) — each renders the resolved chip instead of `String(turn.answerValue)` / raw JSON, using the fork chosen in 5.3
  - [x] 5.5 Fix `exportTranscript.ts` at lines 203, 211, 226, 244
    - Apply the same resolved-label fix so the export matches the on-screen labels; this canonical resolved-label text is the FORMAT Spec 3 round-trips — correctness here is the primary deliverable
  - [x] 5.6 Run ONLY the targeted Vitest files for this group
    - The SummaryPanel resolved-label test and `exportTranscript.test.ts` (plus any turn-render test touched)
    - Do NOT run a whole-repo build / tsc / lint

**Acceptance Criteria:**
- The 2-8 tests in 5.1 pass; `exportTranscript.test.ts` is updated and green in isolation
- All four sites (panel, preview, four transcript turns, four export lines) render resolved chips, not raw JSON
- The `DecisionCapturedTurn` fork is resolved one consistent way
- The resolved-label text is identical across panel, preview, transcript, and export (the canonical format)
- No mojibake/NUL introduced

### Frontend Layer — Build-tool Render Verification

#### Task Group 6: Confirm the `build.tool` doubled-envelope fix end-to-end
**Dependencies:** Task Groups 1, 3, 4, 5

The data fix is made in the gateway (Task 1.5) and the stem/default in the config (Task Group 3). This group is a thin verification that the doubled envelope is gone all the way through the resolved-label render path.

- [x] 6.0 Verify `build.tool` captures and renders as a bare-stem chip
  - [x] 6.1 Write/update 1-3 focused tests asserting the fix
    - `build.tool` captures `{framework:'Maven', version:'3.9'}` and renders chip `Maven 3.9` (not `Maven 3.9 Maven 3.9`); `'Gradle'` + `'8'` renders `Gradle 8`
    - Place in whichever owning suite is most natural (control or summary/export); keep it tiny (counts within the relevant group's budget)
  - [x] 6.2 Confirm no remaining `build.tool` double-encoding
    - Check the chip, the panel/preview, the transcript turn, and the export line all show the single-stem label
  - [x] 6.3 Run ONLY the touched Vitest file(s)
    - Do NOT run a whole-repo build / tsc / lint

**Acceptance Criteria:**
- `build.tool` captures `{framework:'Maven', version:'3.9'}` and renders `Maven 3.9` everywhere
- No `Maven 3.9 Maven 3.9` / doubled label remains at any render site
- No mojibake/NUL introduced

### Testing

#### Task Group 7: Test review & gap analysis (isolation-only)
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review the tests written in Groups 1-6 and fill only critical gaps for THIS feature
  - [x] 7.1 Review the tests from each group
    - Gateway Jest: questionLibrary re-key (1.1) + cascade-engine object-value (2.1)
    - Frontend Vitest: guard-rail contract test (3.1), control + toggle (4.1), resolved-label rendering (5.1), build.tool (6.1)
  - [x] 7.2 Analyze coverage gaps for this spec's feature only
    - Focus on end-to-end seams: chip click -> commit -> envelope -> resolved chip in panel/preview/transcript/export; and pick-Java -> versioned cascade fires as an editable proposal (never silent)
    - Do NOT assess whole-application coverage
  - [x] 7.3 Write up to 10 additional strategic tests MAXIMUM, only if needed
    - Prioritize the cross-layer workflow and the cascade-proposal (editable, never-commit) contract
    - Skip edge cases, performance, and accessibility unless business-critical
  - [x] 7.4 Run ONLY the feature-specific suites, in isolation
    - The targeted gateway Jest suites (`questionLibrary.test.ts`, `decisionCaptureOrchestrator.test.ts`) and the targeted frontend Vitest files (guard-rail contract, `VersionedAnswerControl.test.tsx`, `ConversationMainPane.answerControls.test.tsx`, `ConversationMainPane.contextLeadIn.test.tsx`, `SummaryPanel` resolved-label test, `exportTranscript.test.ts`)
    - Do NOT run the whole gateway suite, the whole frontend suite, or any whole-repo build / tsc / lint — the frontend whole-repo baseline is pre-existingly RED

**Acceptance Criteria:**
- All feature-specific suites pass in isolation
- The chip->commit->resolved-label workflow and the editable-cascade-proposal contract are covered
- No more than 10 additional tests added to fill gaps
- Testing is exclusively scoped to this spec; no whole-repo build was run

## Execution Order

Recommended implementation sequence (dependency-ordered):
1. Gateway question library: 24-code versioned set + cascade trigger/seed re-key to bare stems + `build.tool` data fix (Task Group 1)
2. Gateway cascade-engine object-value fix (Task Group 2)
3. Frontend `versionControlConfig.ts` re-key to stems + dedup helper + guard-rail contract test (Task Group 3)
4. Frontend `VersionedAnswerControl.tsx` compact layout + auto-select toggle + commit-on-chip (Task Group 4)
5. Frontend resolved-label rendering at all four sites (Task Group 5)
6. `build.tool` doubled-envelope end-to-end verification (Task Group 6)
7. Test review & gap analysis, isolation-only (Task Group 7)
