# Specification: Target-state Conversation — Versioned-Answer Bare-Stem UX

## Goal
Complete the FR5 framework/version decoupling so the target-state conversation captures versioned answers as bare-stem `{framework, version}` values, renders resolved labels everywhere, and fires the currently-dead versioned cascades — establishing the canonical resolved-label answer format that Spec 2 (manifest auto-answer) and Spec 3 (decisions-file import) consume.

## User Stories
- As an architect capturing a target-state decision, I want framework chips to read as bare stems (`Spring Boot`) with the version on a separate compact control, so the captured label is `Spring Boot 4.0` instead of a contradictory `Spring Boot 3.4 4.0`.
- As an architect, I want clicking a framework chip to commit the stem plus its recommended version in one action (with an "Edit version" escape hatch), so I am not forced through a two-step save for the common case.
- As an architect reviewing captured decisions, I want the panel, preview, transcript, and export to show resolved labels rather than raw JSON, so the record is human-readable and round-trippable.

## Specific Requirements

**Bare-stem framework chips with version-split dedup**
- Apply the versioned (stem + version axis) treatment to all 24 codes listed in the next requirement; today only 7 are versioned.
- The framework axis renders bare stems (`[Spring Boot]`, `[Java]`), never version-laden chips.
- Where a question's `choices` split one stem across versions (e.g. `Java 21` + `Java 17`), DEDUP into a single `[Java]` chip plus a version field.
- The dedup must sit between the question's `choices` and the chip set rendered by `VersionedAnswerControl`, because `ConversationMainPane.tsx` passes `frameworkChoices={choices}` verbatim (~line 342).
- A version-less stem (`none` / `manual` / `in-house`-style choices) carries NO version field and NO curated default; its chip text is the stem only (e.g. `db.migrations: none-managed-by-app`).
- `domain.mappingStrategy` stays versioned (MapStruct / ModelMapper are real libraries); only its `manual mapper classes` / `none-direct-entity-exposure` stems are version-less.
- Reserve the `(version unknown)` parenthetical for the genuine version-unknown case only, not for version-less stems.

**The 24 versioned codes**
- Existing 7: `service.language`, `service.framework`, `service.runtime`, `db.engine`, `db.driver`, `ui.framework`, `build.tool`.
- New 17: `db.migrations`, `db.connectionPool`, `validation.framework`, `domain.mappingStrategy`, `logging.framework`, `metrics.framework`, `tracing.framework`, `ui.buildTool`, `ui.stateManagement`, `ui.designSystem`, `ui.testing`, `testing.unit`, `testing.integration`, `testing.e2e`, `testing.contractTesting`, `testing.mocking`, `interservice.asyncBus`.
- Set `versioned: true` on these 24 entries in gateway `questionLibrary.ts`.
- Mirror the same closed set into the frontend `VERSIONED_DECISION_CODES` constant in `versionControlConfig.ts`.

**Curated default version per stem**
- Re-key `RECOMMENDED_VERSION_BY_FRAMEWORK` (`versionControlConfig.ts`) from laden choice strings to bare stems (e.g. `'Java 21'` / `'Java 17'` collapse to a single `'Java'` entry).
- Set Spring Boot's default to `'4.0'` (currently `'3.4.1'` under key `'Spring Boot 3.4'`).
- Leave every other curated default exactly as-is, just re-keyed to its stem. Do NOT change the version-granularity philosophy globally.
- Version-less stems (`none` / `manual` / `in-house`) have no entry in the map.

**Compact horizontal layout + drop the lead-in**
- Replace the tall vertical version box in `VersionedAnswerControl.tsx` with a compact horizontal layout: framework chips on the left; the version on the right as a confirmed chip plus an "Edit version" button.
- Drop the italic static context lead-in that repeats the question text.
- "Edit version" reveals the existing version field plus a "Save version" button (this revealed state equals the toggle-OFF default view).
- When a mockup is supplied in `planning/visuals/`, the compact-layout + auto-select mockup is the authoritative UX reference.

**Auto-select recommended version toggle**
- Render a toggle in the conversation header, right-aligned, labelled "Auto-select recommended version", default ON, persisted in browser localStorage (sticky per machine, no backend).
- Toggle ON: clicking a framework chip immediately commits the stem plus its curated default version in ONE action; change stem via another chip; change version via "Edit version" → field + "Save version".
- Toggle OFF: the editable version field + "Save version" is shown from the start (today's two-step behaviour).
- A version-less stem commits with no version regardless of toggle state.

**Render resolved labels, not raw JSON**
- Captured decisions are stored as the `{value, sourceQuote, sourceFile}` envelope (`value` = `{framework, version}` for versioned codes, plain string for single-choice). Replace raw-JSON rendering with the resolved chip at every site below.
- `SummaryPanel.tsx` `SummaryRow` (~lines 180-195): prefer `row.answerSummary` (already on `CapturedDecisionRow`) instead of falling through to `String(row.answerValue)`; this covers the "Decisions captured" panel and the prompt-ready "Preview" output.
- `ConversationMainPane.tsx`: fix the decision-captured turn (line 839), cascade-accepted (808), cascade-overridden (822), and exception-pinned (860) turns.
- `DecisionCapturedTurn` (`architectConversationApi.ts:280-285`) carries `answerValue` but NOT `answerSummary`; resolve the chip client-side from the envelope `value` (object → `resolveFrameworkVersionChip`, plain string → the string) OR extend the turn shape to carry `answerSummary` — pick one consistently.
- `exportTranscript.ts`: apply the same resolved-label fix at lines 203, 211, 226, 244.
- This canonical resolved-label text is the FORMAT Spec 3 round-trips; correctness of the format is the primary deliverable.

**Fix the doubled `build.tool` envelope**
- `build.tool` currently captures `{framework:'Maven 3.9', version:'Maven 3.9'}` → chip `Maven 3.9 Maven 3.9`.
- Bare-stem it so it captures `{framework:'Maven', version:'3.9'}` → chip `Maven 3.9` (and `'Gradle'` + `'8'`, etc.).

**Cascade-engine fix (gating)**
- `computeCascadeProposals` (`decisionCaptureOrchestrator.ts:271-291`) keys cascades only off a STRING value (the `typeof === 'string'` guard at line 277 returns `[]` for objects), so versioned-code cascades are DEAD today.
- Teach it to derive the trigger key from `value.framework` (the bare stem) when the answer value is a `{framework, version}` object.
- Re-key every cascade `valueByTriggerValue` trigger map in `questionLibrary.ts` from laden strings to bare stems (e.g. `'Java 21'` → `'Java'`, `'Spring Boot 3.4'` → `'Spring Boot'`).
- Re-key the downstream SEED VALUES that target now-versioned codes to bare stems too (e.g. `'Eclipse Temurin 21'` → `'Eclipse Temurin'`, `'JUnit 5'` → `'JUnit'`, `'Gradle 8'` → `'Gradle'`), so a cascaded value matches a bare-stem chip and pre-selects that stem's curated default.
- Result: prevents regressing the working `logging.framework` + `interservice.asyncBus` cascades when they flip to versioned, and activates the dormant versioned cascades as EDITABLE PROPOSALS via the existing cascade-summary / accept / override UX — NEVER silent commits.

**Guard-rail contract test (hard requirement)**
- Add a contract test asserting (1) every single-choice value the system emits is a real member of that code's `questionLibrary.choices`, and (2) every versioned stem has a curated default version.
- Version-less mixed stems (`none` / `manual` / `in-house`) are the explicit exception to (2) and must be allowed.
- Goal: any chip / choice / default / cascade-seed drift goes RED in CI.

**Verification in isolation (no whole-repo build)**
- Keep the EXISTING captured-decision envelope and the POST `/capture` path unchanged; no new AMS DTO. This is a frontend-led change plus a gateway config/cascade re-key.
- The frontend whole-repo tsc/lint baseline is pre-existingly RED; verify with targeted Vitest for the frontend files and the specific Jest suites for the gateway files, NOT a whole-repo build.

## Existing Code to Leverage

**`VersionedAnswerControl.tsx` (frontend, Vitest)**
- Already owns framework single-select chips plus a separate version control (free-text + datalist typeahead, recommended default pre-select, non-blocking enrichment seam, Spec-4 nudge slot) and emits `{framework, version}`.
- Restyle to the compact horizontal layout and add the auto-select behaviour rather than introducing a new control; reuse its existing resolved-chip render.

**`versionControlConfig.ts` (frontend)**
- Holds `VERSIONED_DECISION_CODES`, `RECOMMENDED_VERSION_BY_FRAMEWORK`, `isVersionedCode`, `recommendedVersionFor`, `buildFrameworkVersionCaptureValue`.
- Re-key the default map to stems, expand the code set to 24, set Spring Boot default `'4.0'`; keep `buildFrameworkVersionCaptureValue` and the envelope shape unchanged.

**`frameworkVersionShape.ts` (gateway, Jest)**
- `resolveFrameworkVersionChip` already produces `${framework} ${version}` and `buildFrameworkVersionEnvelope` already builds the `{value, sourceQuote, sourceFile}` envelope.
- Reuse `resolveFrameworkVersionChip` for client-side label resolution and keep the envelope contract intact.

**`CapturedDecisionRow.answerSummary` (`architectConversationApi.ts:569`)**
- The resolved label is already carried on the captured-decision row; `SummaryPanel` rows should prefer it instead of re-deriving from `answerValue`.

**Existing cascade-summary / accept / override UX**
- The editable-proposal UI for cascades already exists; versioned cascades plug into it once `computeCascadeProposals` handles object values and the trigger/seed maps are re-keyed to stems.

## Out of Scope
- Spec 2 (manifest auto-answer): the manifest witness-registry, property/plugin extractors, driver→engine and language→runtime inference, the one LLM gap-fill, and Tier-2 facts.
- Spec 3 (decisions-file import / template-completion): the decisions-file import that round-trips this spec's resolved-label text, and its mutual-exclusivity with the manifest upload box.
- Any new AMS DTO, or any change to the capture envelope or the POST `/capture` path.
- Global change to the version-granularity philosophy — only Spring Boot's default value changes.
- Backend persistence of the auto-select toggle — it is localStorage only, no backend.
- Whole-repo tsc/lint green-up — the baseline is pre-existingly RED and is not this spec's concern.
