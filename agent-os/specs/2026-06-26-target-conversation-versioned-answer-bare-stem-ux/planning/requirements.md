# Spec Requirements: Target-state Conversation — Versioned-Answer Bare-Stem UX

## Initial Description

Complete the FR5 framework/version decoupling for the target-state conversation. The prior spec (`2026-06-24-target-conversation-tech-stack-constraints`, FR5/FR6/FR8) shipped a decoupled framework+version control but with version-LADEN chips, leaving it half-done: chips read like `Spring Boot 3.4` and, once a version is added, produce contradictory labels like `Spring Boot 3.4 4.0`; `build.tool` double-encodes to `Maven 3.9 Maven 3.9`; only 7 codes carry a version axis; the "Decisions captured" panel and several transcript/export sites dump raw JSON instead of resolved labels; and the dormant versioned cascades never fire.

This is **Spec 1 of a 3-spec initiative** and a **PREREQUISITE** to Spec 2 (manifest auto-answer) and Spec 3 (decisions-file import), because it defines the canonical resolved-label answer/template FORMAT both downstream specs consume. This spec only makes the answer FORMAT correct.

## Requirements Discussion

### First Round Questions

**Q1: What is the exact versioned code set (the codes that render the bare-stem chip + version axis), and how are mixed/version-less stems handled?**
**Answer:** The final versioned set is the 7 existing codes plus 17 new codes = **24 codes** total.

- Existing 7: `service.language`, `service.framework`, `service.runtime`, `db.engine`, `db.driver`, `ui.framework`, `build.tool`.
- New 17: `db.migrations`, `db.connectionPool`, `validation.framework`, `domain.mappingStrategy`, `logging.framework`, `metrics.framework`, `tracing.framework`, `ui.buildTool`, `ui.stateManagement`, `ui.designSystem`, `ui.testing`, `testing.unit`, `testing.integration`, `testing.e2e`, `testing.contractTesting`, `testing.mocking`, `interservice.asyncBus`.

Rule for MIXED codes: a stem that is genuinely version-less — `none` / `manual` / `in-house`-style choices — carries **NO version field and NO curated default**. Examples: `db.migrations` → `none-managed-by-app`; `domain.mappingStrategy` → `manual mapper classes` / `none-direct-entity-exposure`; `validation.framework` → `manual`; `metrics.framework` / `tracing.framework` → `none`; `ui.stateManagement` → `none-local-state-only`; `ui.designSystem` → `in-house`. `domain.mappingStrategy` STAYS versioned (MapStruct / ModelMapper are real libraries) with only its manual/none stems version-less.

**Q2: How should defaults be handled — re-key, and which defaults change?**
**Answer:** Re-key `RECOMMENDED_VERSION_BY_FRAMEWORK` to **bare stems**. Set Spring Boot's default to `'4.0'`. Leave every OTHER curated default exactly as-is (just re-keyed to its stem). Do NOT globally change the granularity philosophy.

**Q3: How should the auto-select toggle persist, and where does it live?**
**Answer:** Persistence = browser **localStorage** (defaults ON the first time, sticky on the machine, no backend). Placement = **conversation header, right-aligned**, label **"Auto-select recommended version"**.

**Q4: Should the cascade engine be fixed as part of this spec?**
**Answer:** Yes, confirmed important. Required engine work:
- Teach `computeCascadeProposals` (`decisionCaptureOrchestrator.ts:271-291`) to derive the cascade trigger key from `value.framework` (the BARE STEM) when the answer value is a `{framework, version}` object (today it only handles string values, so versioned cascades never fire).
- Re-key every cascade `valueByTriggerValue` TRIGGER map in `questionLibrary.ts` from laden strings to bare stems (e.g. `'Java 21'` → `'Java'`, `'Spring Boot 3.4'` → `'Spring Boot'`).
- Re-key the downstream SEED VALUES that target (now-)versioned codes to bare stems too (e.g. `service.language` → `service.runtime` seed `'Eclipse Temurin 21'` → `'Eclipse Temurin'`; → `testing.unit` `'JUnit 5'` → `'JUnit'`; → `build.tool` `'Gradle 8'` → `'Gradle'`), so a cascaded value matches a bare-stem chip and pre-selects that stem's curated default version.
- This (a) PREVENTS regressing the currently-working cascades of `logging.framework` + `interservice.asyncBus` when those flip to versioned, and (b) ACTIVATES the dormant versioned cascades (pick Java → seeds runtime/testing/build/dto as EDITABLE PROPOSALS via the existing cascade-summary / accept / override UX — NEVER silent commits).

**Q5: What chip text renders for a versioned code whose chosen stem is genuinely version-less?**
**Answer:** Stem only (e.g. `db.migrations: none-managed-by-app`). Reserve the `(version unknown)` parenthetical for the genuine version-unknown case only.

### Existing Code to Reference

**Similar Features Identified (all in this repo, to be modified or modelled after):**

Frontend (Vitest):
- `frontend/src/.../VersionedAnswerControl.tsx` — framework single-select chips + separate version control (free-text + datalist typeahead, recommended default pre-selected, non-blocking enrichment seam, Spec-4 nudge slot); emits `{framework, version}`; renders one resolved chip; today a two-step "Save version" flow. **This is the control made compact + auto-select.**
- `frontend/src/.../versionControlConfig.ts` — `VERSIONED_DECISION_CODES`, `RECOMMENDED_VERSION_BY_FRAMEWORK` (keyed by laden choice strings today), `isVersionedCode`, `buildFrameworkVersionCaptureValue`. **Re-key to stems; expand set to 24; Spring Boot default → `'4.0'`.**
- `frontend/src/.../ConversationMainPane.tsx` — versioned codes render `<VersionedAnswerControl frameworkChoices={choices} />`; `ConversationMainPane.tsx:342` passes `frameworkChoices={choices}` verbatim (bare-stem DEDUP must happen between the question's choices and the chip set); the decision-captured turn renders `String(turn.answerValue)` (line 839); cascade-accepted (808), cascade-overridden (822), exception-pinned (860) render raw JSON too.
- `frontend/src/.../SummaryPanel.tsx` — `SummaryRow` (~lines 180-195) only JSON-unwraps for `createdByTask === 'tech-stack-md-prefill'`; all other rows fall through to `String(row.answerValue)` (raw JSON).
- `frontend/src/.../exportTranscript.ts` — mirrors `String(turn.answerValue)` at lines 203, 211, 226, 244.
- `frontend/src/api/architectConversationApi.ts` — `CapturedDecisionRow.answerSummary` already exists (line 569); `DecisionCapturedTurn` (lines 280-285) carries `answerValue` but NOT `answerSummary`.

Gateway (Jest):
- `gateway .../frameworkVersionShape.ts` — `{framework, version}` shape, `resolveFrameworkVersionChip` (`${framework} ${version}`), `buildFrameworkVersionEnvelope`; capture rides the existing envelope `answerValue = JSON.stringify({value, sourceQuote, sourceFile})`, `answerSummary` = resolved chip.
- `gateway .../questionLibrary.ts` — 51 questions; each has `choices`, `versioned`, `cascades[].valueByTriggerValue` (keyed by laden strings today), `foundationalInputs`, `dependencyClass`. **Set 24 codes `versioned`; re-key cascade triggers + seed values to stems.**
- `gateway .../decisionCaptureOrchestrator.ts` — `computeCascadeProposals` (lines 271-291). **Teach it to derive the trigger key from `value.framework` for object values.**

### Follow-up Questions

No follow-up questions were required. All five shaping questions were answered and the gating cascade-engine verification was completed during research (see Visual / research findings below).

## Visual Assets

### Files Provided:

No visual assets were present in `planning/visuals/` at the time of writing (the mandatory `ls` check of `.../planning/visuals/` returned no image/PDF files).

**UX reference note:** The user may add mockups to `planning/visuals/` showing (a) the compact horizontal layout with the auto-select toggle and (b) the current raw-JSON decisions panel. When provided, **the compact-layout + auto-select mockup is the authoritative UX reference** for the layout described in Functional Requirements §3.

## Requirements Summary

### Functional Requirements

#### 1. Bare-stem framework chips (24 versioned codes)

- The framework axis renders **bare stems** (`[Spring Boot]`, `[Java]`) instead of version-laden chips (`[Spring Boot 3.4]`).
- Where a question's `choices` split a single stem across versions (e.g. `Java 21` + `Java 17`), **DEDUP** them into one `[Java]` chip plus a version field. The dedup happens between the question's `choices` and the chip set rendered by `VersionedAnswerControl` (because `ConversationMainPane.tsx:342` passes `frameworkChoices={choices}` verbatim today).
- Apply the versioned (stem + version axis) treatment to the **24 codes** listed in Q1.
- Mixed-code rule: a version-less stem (`none` / `manual` / `in-house`-style) carries **no version field and no curated default**. Its chip text is the **stem only** (Q5), e.g. `db.migrations: none-managed-by-app`. `domain.mappingStrategy` remains versioned with only its manual/none stems version-less.

#### 2. Curated default version per stem

- Re-key `RECOMMENDED_VERSION_BY_FRAMEWORK` from laden choice strings to **bare stems**.
- Set **Spring Boot's default to `'4.0'`** (was `3.4.1`).
- Leave all other curated defaults exactly as they are (re-keyed to their stem). Do not change granularity globally.
- Version-less stems have no entry.

#### 3. Compact horizontal layout + auto-select toggle

- Replace the tall vertical version box with a **compact horizontal layout**: framework chips on the left; the version on the right as a confirmed chip + an **"Edit version"** button.
- **Drop the italic static context lead-in** that repeats the question.
- **Auto-select toggle** in the conversation **header, right-aligned**, labelled **"Auto-select recommended version"**, **default ON**, persisted in **browser localStorage** (sticky per machine, no backend):
  - Toggle **ON**: clicking a framework chip **immediately commits** the stem + its default version in **one action**. Change stem via another chip; change version via "Edit version" → small text field + "Save version".
  - Toggle **OFF**: editable version field + "Save version" from the start (today's two-step behaviour).
- The compact-layout + auto-select mockup (when supplied in `planning/visuals/`) is the UX reference.

#### 4. Render resolved labels, not raw JSON

Every captured decision is stored as the `{value, sourceQuote, sourceFile}` envelope (`value` = `{framework, version}` for versioned codes, plain string for single-choice). Replace raw-JSON rendering with the resolved chip (e.g. `service.framework: Spring Boot 4.0`) at every site:

- **`SummaryPanel.tsx` `SummaryRow` (~180-195):** prefer `row.answerSummary` (already on `CapturedDecisionRow`) instead of falling through to `String(row.answerValue)`. This covers the **"Decisions captured"** panel and the **"Preview prompt-ready output"**.
- **`ConversationMainPane.tsx`:** fix the decision-captured turn (line 839), cascade-accepted (808), cascade-overridden (822), and exception-pinned (860) turns. **Implementation fork (implementation detail, not a user question):** `DecisionCapturedTurn` carries `answerValue` but NOT `answerSummary`, so this site must either resolve the chip client-side from the envelope `value` (use `resolveFrameworkVersionChip` for object values, the plain string for single-choice) OR extend the turn shape to carry `answerSummary`.
- **`exportTranscript.ts`:** apply the same resolved-label fix at lines 203, 211, 226, 244.

This canonical resolved-label text is the FORMAT Spec 3 round-trips.

#### 5. Fix the doubled `build.tool` envelope

- `build.tool` currently captures `{framework:'Maven 3.9', version:'Maven 3.9'}` → chip `Maven 3.9 Maven 3.9`. Bare-stem `build.tool` so it captures `{framework:'Maven', version:'3.9'}` (and `'Gradle'` + `'8'`, etc.) → chip `Maven 3.9`.

#### 6. Cascade-engine fix (gating)

- Teach `computeCascadeProposals` (`decisionCaptureOrchestrator.ts:271-291`) to derive the cascade trigger key from `value.framework` (the bare stem) when the answer value is a `{framework, version}` object.
- Re-key every cascade `valueByTriggerValue` trigger map in `questionLibrary.ts` from laden strings to bare stems.
- Re-key downstream SEED VALUES targeting (now-)versioned codes to bare stems (e.g. `Eclipse Temurin 21` → `Eclipse Temurin`, `JUnit 5` → `JUnit`, `Gradle 8` → `Gradle`).
- Result: prevents regressing the working `logging.framework` + `interservice.asyncBus` cascades when they flip to versioned, and activates the dormant versioned cascades — seeding runtime/testing/build/dto as **editable proposals** via the existing cascade-summary / accept / override UX, **never silent commits**.

### Reusability Opportunities

- **`resolveFrameworkVersionChip`** (gateway `frameworkVersionShape.ts`) and **`answerSummary`** (`CapturedDecisionRow`, `architectConversationApi.ts:569`) already produce/carry the resolved label — reuse rather than rebuild.
- **`VersionedAnswerControl.tsx`** already owns framework chips + version control with default pre-select — restyle to compact + add auto-select rather than introduce a new control.
- The existing **cascade-summary / accept / override UX** already exists — versioned cascades plug into it once the engine + keys are fixed.
- `buildFrameworkVersionCaptureValue` / `buildFrameworkVersionEnvelope` already build the envelope — keep the existing capture envelope and POST `/capture` path unchanged.

### Established Research Findings (verified facts)

- **CASCADE VERDICT (the gating risk, now resolved):** `computeCascadeProposals` (`decisionCaptureOrchestrator.ts:271-291`) keys cascades only off a STRING answer value. A versioned `{framework, version}` answer is an object, fails the `typeof === 'string'` guard, and returns `[]` — so **versioned-code cascades are DEAD today**. Re-keying triggers/seeds to stems is therefore safe, AND the Q4 engine fix (derive the key from `value.framework`) is required to make versioned cascades fire and to avoid regressing the two flipped cascade-source codes (`logging.framework`, `interservice.asyncBus`).
- **Resolved-label (not raw-JSON) render sites** are exactly the four listed in FR §4: `SummaryPanel.tsx SummaryRow` (only unwraps for `tech-stack-md-prefill`), `ConversationMainPane.tsx` (4 turn types), and `exportTranscript.ts` (4 lines).
- **`build.tool` doubled envelope** is confirmed (`Maven 3.9 Maven 3.9`) and is fixed by bare-stemming `build.tool`.
- **Frontend wiring:** `RECOMMENDED_VERSION_BY_FRAMEWORK` is keyed by laden strings (re-key to stems, Spring Boot → `'4.0'`); `ConversationMainPane.tsx:342` passes `frameworkChoices={choices}` verbatim, so the bare-stem dedup must sit between the question's choices and the chip set; `VersionedAnswerControl.tsx` is the two-step "Save version" control to make compact + auto-select.

### Scope Boundaries

**In Scope:**
- Bare-stem chips + dedup for the 24 versioned codes.
- Re-keyed curated-default map (stems); Spring Boot default `'4.0'`.
- Compact horizontal layout; drop the repeated italic lead-in.
- Auto-select toggle (header, right-aligned, default ON, localStorage).
- Resolved-label rendering at all four sites (panel, preview, transcript turns, export).
- `build.tool` doubled-envelope fix.
- Cascade-engine fix + trigger/seed re-key to stems.
- Guard-rail contract test (see Technical Considerations).
- Verification of this feature **in isolation** (targeted Vitest / gateway Jest), not a whole-repo build.

**Out of Scope (separate specs):**
- **Spec 2 (manifest auto-answer):** the manifest witness-registry, property/plugin extractors, driver→engine & language→runtime inference, the one LLM gap-fill, and Tier-2 facts.
- **Spec 3 (decisions-file import / template-completion):** the decisions-file import that round-trips this spec's resolved-label text, and its mutual-exclusivity with the manifest upload box.
- Any new AMS DTO or change to the capture envelope / POST `/capture` path.
- Global change to the version-granularity philosophy (only Spring Boot's default value changes).

### Technical Considerations

- **No new AMS DTO.** Keep the existing capture envelope (`answerValue = JSON.stringify({value, sourceQuote, sourceFile})`, `answerSummary` = resolved chip) and the POST `/capture` path unchanged. This is a **frontend-led change plus a gateway config/cascade re-key**.
- **Test runners:** frontend uses **Vitest**; gateway uses **Jest**.
- **Baseline is red:** the frontend whole-repo tsc/lint baseline is **pre-existingly RED** — verify this feature in **isolation** with targeted Vitest, not a whole-repo build.
- **Guard-rail contract test (hard requirement):** a test asserting (1) **every single-choice value the system emits is a real member of that code's `questionLibrary.choices`**, and (2) **every versioned stem has a curated default version** — so any chip / choice / default drift goes **RED in CI**. (Version-less mixed stems are the explicit exception to (2) and must be allowed.)
- **Cascade contract:** cascaded values must continue to surface as **editable proposals** through the existing cascade-summary / accept / override UX — never silent commits.
- This spec **defines the canonical resolved-label answer/template FORMAT** consumed by Spec 2 and Spec 3; correctness of that format is the primary deliverable.
