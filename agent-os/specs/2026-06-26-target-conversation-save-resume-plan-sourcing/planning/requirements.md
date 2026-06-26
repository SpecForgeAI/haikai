# Spec Requirements: Target-State Conversation — Save, Resume, and Plan Sourcing Decoupled from "Active"

## Initial Description

Make a target-state architect conversation a **saveable, resumable, listable** object, and source the Migration Delivery Plan from the **most-recent-saved conversation** — decoupled from the "active" target architecture. Add a **pre-flight readiness** check so incomplete target-state work is flagged in the plan wizard before generation, not surfaced post-generation as spurious LLM "missing inputs." Full agreed context in `planning/raw-idea.md` (LOCKED design + Delta refinements + residual questions).

This directly fixes the root cause of the plan's spurious "missing inputs" (db.engine / db.migrations / rendered tech-stack): the plan reads the **active** target while conversations are authored against the **selected** target, and a conversation saved on an un-promoted draft is invisible to the plan.

## Requirements Discussion

### First Round Questions

**Q1 (confirm — save marker):** Add `conversation_saved_at TIMESTAMP NULL` directly to the `architecture` row (mirroring nullable boxed-`Instant` `last_marked_stale_at`), with no new conversation entity (conversation is 1:1 with target arch)? Include `conversation_status` now or defer?
**Answer:** Correct. **Defer `conversation_status`** (timestamp-only drives every query; add later only if a UI needs it).

**Q2 (confirm — resolver swap):** Replace `fetchActiveTargetArchitectureId` at **both** `contextResolvers.ts:820` and `:1100` with a most-recent-saved resolver, and redirect the `target-tech-stack-<id>.md` filename id to that same target, so decisions + tech-stack + mappings bind to one target?
**Answer:** Correct.

**Q3 (confirm — save action):** The existing architect-conversation close button is relabeled **"Save Conversation"**, keeping its behaviour (append CloseTurn + write `target-tech-stack-<id>.md`) and **adding** a call to a new AMS endpoint that stamps `conversation_saved_at` — relabel-and-augment, not a new parallel button?
**Answer:** Correct.

**Q4 (residual — resume semantics):** Opening a saved conversation shows a **view-only** transcript + decisions/tech-stack with an explicit **"Reopen / continue"** that resumes the question walk (not straight-to-editable)?
**Answer:** Agree.

**Q5 (residual — list placement):** Extend the existing **target-architectures list** with a "saved conversation" indicator/filter (`conversation_saved_at IS NOT NULL`), rather than a new parallel section?
**Answer:** Agree (saved conversations ARE saved target archs).

**Q6 (residual — plan-target binding / D2):** The wizard's target selector becomes "pick a saved conversation" (default = most-recent-saved), and that single choice drives decisions + tech-stack + mappings together?
**Answer:** Confirmed (D2).

**Q7 (residual — pre-flight readiness):** An inline, non-blocking readiness panel in "Inputs & context" showing saved date · decisions answered/total · foundational DB decisions (db.engine/db.migrations) present · tech-stack written · named gaps; and exclude `not_applicable`/`deferred` from the answered/total denominator (auto-skipped, not gaps)?
**Answer:** Correct — right content/placement, and exclude `not_applicable`/`deferred` from the denominator.

**Q8 (residual — multiple saved conversations):** Default to most-recent-saved but let the user pick another saved conversation from the list, in both the plan wizard and the resume surface?
**Answer:** Correct.

**Q9 (residual — save enablement):** Keep the existing close gate (`service.language` + `api.protocol` + `db.engine`) as the **minimum** to enable Save, but allow Save with the rest incomplete (completeness summary + warning, per D3); `db.migrations` stays out of the gate?
**Answer:** Correct.

**Q10 (exclusions):** Anything else to keep out beyond the four already listed?
**Answer:** No — the listed out-of-scope items are complete.

### Existing Code to Reference

User confirmed the reference set in `planning/raw-idea.md`. Notable factual answer to the shaper's sub-question: **there is no existing most-recent-saved finder** — the active-target finder (`ActiveTargetArchitectureController` → `findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc`) is the **closest sibling to clone**; ours orders by `conversation_saved_at DESC` and is net-new.

- **AMS:** `ArchitectureEntity.java` (new `conversation_saved_at` column, mirror `last_marked_stale_at:131`); `ActiveTargetArchitectureController.java:74-80` (sibling finder); `TargetArchitecturePromoteService:309-363` (`listTargets`); new Liquibase changeset + a new stamp endpoint.
- **Gateway:** `contextResolvers.ts` (`:820`, `:1100`; `buildTargetStateDecisionsPromptText:937` w/ additive `tier2Facts`; `renderDecisionBody:1049`); `architectConversation.ts` (close handler `:836-904`; session derive `:639-655`); `targetStateConversationStore.ts`; `targetStateCapturedDecisionsClient.ts` (`fetchActiveTargetArchitectureId`, `fetchLatestCapturedDecisions`).
- **Frontend:** `ArchitectConversationTab.tsx:1175-1206`; `DecisionsFileUploadPanel.tsx:20` ("Save Conversation" label); `CloseConversationFlow.tsx` (`CLOSE_GATE_CODES`); `TargetArchitectureWorkspace.tsx` (`selectedDraftId`, `getElementsInventory`); `MigrationDeliveryPlanWizard.tsx` (Inputs & context readiness + target selection).
- **Tolerant decision reader / envelope shapes:** `resolveCapturedAnswerLabel` (`architectConversationApi.ts:160+`); `frameworkVersionShape.ts:173`; `decisionsFileImport.ts:114-118`; `decisionCaptureOrchestrator.ts:451-457`.

### Follow-up Questions

None — all questions answered/confirmed.

## Visual Assets

### Files Provided:
No visual assets provided (mandatory `planning/visuals/` check returned no files). The missing-inputs inspector and conversation sub-tab states are documented by file:line in the references.

## Requirements Summary

### Functional Requirements

- **FR1 — Save marker (AMS).** Add nullable `conversation_saved_at TIMESTAMP` to `architecture` via a new Liquibase changeset; mirror as a nullable boxed-`Instant` on `ArchitectureEntity`. Defer `conversation_status`.
- **FR2 — Save endpoint + finders (AMS).** New endpoint to stamp `conversation_saved_at = now()` for a given target architecture. Add repository finders: **most-recent-saved** (`…conversation_saved_at IS NOT NULL ORDER BY conversation_saved_at DESC LIMIT 1`) and **list-saved** (same, no limit), modelled on the active-target finder.
- **FR3 — Save action (gateway + frontend).** The architect-conversation close handler additionally calls the stamp endpoint; the close button is relabeled **"Save Conversation"**. Keep the existing close gate (`service.language` + `api.protocol` + `db.engine`) as the minimum to enable Save; allow Save with the rest incomplete, showing a completeness summary + non-blocking warning.
- **FR4 — Plan sourcing decoupled from active (gateway).** Swap `fetchActiveTargetArchitectureId` at `contextResolvers.ts:820` and `:1100` to resolve the plan's target (default most-recent-saved); redirect the `target-tech-stack-<id>.md` filename id to that target; pass the additive `tier2Facts` arg if reusing `buildTargetStateDecisionsPromptText`. Unify decisions + tech-stack + mappings on one target.
- **FR5 — Plan-target binding (frontend wizard).** The wizard's target selector becomes "pick a saved conversation" (default most-recent-saved); the single choice drives decisions + tech-stack + mappings together. Allow choosing another saved conversation from the list.
- **FR6 — Saved-conversations list + resume (frontend).** Extend the existing target-architectures list with a saved-conversation indicator/filter (`conversation_saved_at IS NOT NULL`). Opening a saved conversation shows a view-only transcript + decisions/tech-stack with an explicit "Reopen / continue" that resumes the walk; the conversation sub-tab lands on the saved conversation instead of a fresh-start.
- **FR7 — Pre-flight readiness (frontend wizard).** An inline, non-blocking readiness panel in "Inputs & context" showing: saved date · decisions answered/total (excluding `not_applicable`/`deferred`) · foundational DB decisions (db.engine / db.migrations) present · tech-stack written (y/n) · named gaps. Use the tolerant reader (`resolveCapturedAnswerLabel`) for the non-uniform `answerValue` envelope; prefer `answerSummary` for labels.

### Reusability Opportunities

- The active-target finder is the sibling to clone for the most-recent-saved + list-saved finders.
- `resolveCapturedAnswerLabel` already tolerates all 5 `answerValue` shapes — reuse it for readiness counting (do not write a new parser).
- The existing close handler + tech-stack write are kept as-is and merely augmented with the stamp call.
- The existing target-architectures list/UI is extended (indicator/filter) rather than duplicated.

### Scope Boundaries

**In Scope:**
- `conversation_saved_at` marker + stamp endpoint + most-recent-saved / list-saved finders.
- Relabel close → "Save Conversation" + stamp; incomplete-Save-with-warning (gate unchanged).
- Resolver decouple from active (both sites + tech-stack filename) and unify decisions/tech-stack/mappings on one target.
- Wizard "pick a saved conversation" selector (default most-recent-saved) + pre-flight readiness panel.
- Saved-conversations list (extend target list) + view-only resume with "Reopen / continue" + sub-tab landing fix.

**Out of Scope:**
- Auto-answering db.engine/db.migrations (covered by shipped manifest auto-answer + decisions-file import).
- Multiple *distinct* saved conversations per target architecture (a dedicated conversation table).
- Changing the `thread.json` transcript storage.
- The book-of-work scaffold story / manifest→Service FK (other specs).
- `conversation_status` column (deferred).

### Technical Considerations

- **Net-new state:** `conversation_saved_at` has nothing pre-existing to build on (delta-confirmed). Follow the repo's nullable-boxed-`Instant` / null-safe-PATCH convention.
- **Non-uniform decision envelope:** readiness must tolerate versioned `{value:{framework,version}}`, bare string, wrapped `{value:<string>}`, `string[]`, and `not_applicable`/`deferred` sentinels — treat `not_applicable` as auto-skipped.
- **Two resolver call sites + filename:** the decouple must change `:820`, `:1100`, AND the `target-tech-stack-<id>.md` filename id together, or decisions/tech-stack will diverge.
- **Coexistence:** the shipped decisions-file-import already reuses the close path; this spec augments that same close path with the marker stamp — keep the import flow working.
- **Multi-surface spec** (AMS column + endpoint + finders; gateway resolvers + close handler; frontend target-state UI + plan wizard) — natural task grouping is (a) AMS marker/endpoint/finders, (b) gateway resolver decouple + save stamp, (c) frontend save/resume/list, (d) frontend wizard binding + pre-flight readiness.
- **Verification:** whole-repo frontend baseline is red — verify in isolation. Gateway = Jest, frontend = Vitest, AMS = JUnit + changeset test.
