# Raw Idea — Spec 5: Target-State Conversation — Save, Resume, and Plan Sourcing Decoupled from "Active"

> Spec 5 of an extended target-state initiative. Follows the three completed/committed
> 2026-06-26 specs. Most scope was agreed in prior discussion and is marked **LOCKED**;
> shaping should confirm those quickly and focus on the **RESIDUAL QUESTIONS**.

## Problem

The target-state architect conversation produces the captured decisions + rendered
tech-stack that the Migration Delivery Plan depends on. Today:

- There is **no explicit "save"** of a conversation and **no way to return to one**. The
  transcript is a per-target-arch `thread.json` on disk with no status/timestamp;
  "closed" is *derived* from a CloseTurn existing. Clicking the Target State conversation
  sub-tab lands on whichever draft is selected (active-first default), and a closed thread
  only offers "Start new conversation" — so it feels like it relaunches rather than
  returning to your saved work.
- The plan reads target-state decisions + tech-stack for the **ACTIVE** target
  (`contextResolvers.ts` `fetchActiveTargetArchitectureId` at `:820` and `:1100`), while
  the conversation is authored against the **selected** target. Promotion (active) is a
  *separate* act from saving a conversation — so a conversation saved on an un-promoted
  draft is invisible to the plan. This is the root cause behind the plan's spurious
  "missing inputs" (db.engine / db.migrations / rendered tech-stack).
- There is **no pre-flight signal**: incomplete target-state work surfaces only
  post-generation as LLM "missing inputs."

## Goal

Make a target-state conversation a **saveable, resumable, listable** object, and source
the Migration Delivery Plan from the **most-recent-saved conversation** — decoupled from
"active". Add a **pre-flight readiness** check so incomplete target-state work is flagged
before generation, not after.

## LOCKED design (confirmed in prior discussion — D1/D2/D3 + delta-check)

- **Save marker = a column on the `architecture` row** (D1): add
  `conversation_saved_at TIMESTAMP NULL` (+ optional `conversation_status`) — chosen
  because a conversation is strictly 1:1 with a target architecture, so **no new
  conversation entity** is needed. This is **net-new** (delta-confirmed: nothing
  pre-existing to build on; today's "Save Conversation" is just the existing close
  button's label).
- **Save action**: the existing architect-conversation **close** becomes **"Save
  Conversation"** — it stamps `conversation_saved_at` (via a new AMS endpoint) in addition
  to its current behaviour (append CloseTurn + write `target-tech-stack-<id>.md`).
- **Most-recent-saved query**: `architecture WHERE project_id=? AND kind='target' AND
  archived=false AND conversation_saved_at IS NOT NULL ORDER BY conversation_saved_at
  DESC` (LIMIT 1 = most recent; no LIMIT = the saved-conversations list). The natural
  sibling of the existing active-target finder.
- **Plan sourcing decoupled from active**: swap `fetchActiveTargetArchitectureId` at
  **both** `contextResolvers.ts:820` and `:1100` to resolve the plan's target (default
  most-recent-saved), AND redirect the `target-tech-stack-<id>.md` filename id
  accordingly. **Unify** decisions + tech-stack + mappings on one target (D2 — bind the
  plan's target to the chosen saved conversation), which also fixes the separate
  mappings-vs-active mismatch.
- **Saved-conversations list + resume**: a surface listing saved conversations (the query
  above); opening one shows its transcript + decisions/tech-stack with a way to
  reopen/continue; the conversation sub-tab lands on the saved conversation instead of a
  fresh-start.
- **Pre-flight readiness (the systemic fix)**: the plan wizard's "Inputs & context" stage
  inspects the saved conversation's completeness (saved date, decisions answered vs
  unanswered, foundational DB decisions present, tech-stack written) and warns before
  generation.
- **Save gate (D3)**: allow Save with an incomplete decision set, showing a completeness
  summary + warning (don't hard-block).

## Delta refinements (re-check against the just-shipped specs)

- The captured-decision `answerValue` is now **non-uniform** (5 shapes: versioned
  `{value:{framework,version}}`, bare string, wrapped `{value:<string>}` from
  decisions-import, `string[]`, plus `not_applicable`/`deferred` sentinels). Pre-flight
  readiness must prefer `answerSummary` for the label, JSON-parse-or-fall-back-to-bare-string
  for the value, and treat `not_applicable` as **auto-skipped** (neither a gap nor a user
  answer). Reuse the tolerant reader `resolveCapturedAnswerLabel`.
- If the plan re-invokes `buildTargetStateDecisionsPromptText`, pass the new `tier2Facts`
  arg (Spec 2 added it as an additive param).
- The existing close gate (`service.language` + `api.protocol` + `db.engine`) still
  applies to enabling close/save; `db.migrations` is NOT in it.

## RESIDUAL QUESTIONS (the focus of shaping)

1. **Resume semantics** — opening a saved conversation = view-only transcript + decisions
   with a "Reopen / continue" that resumes the question walk (recommended), or always
   directly editable?
2. **Saved-conversations list placement** — a new section in the Target State area, or
   extend the existing target-architectures list with a "saved conversation"
   indicator/filter (since saved conversations ARE saved target archs)?
3. **Plan-target binding (confirm D2)** — the wizard's target selector becomes "pick a
   saved conversation" (default most-recent-saved), driving decisions + tech-stack +
   mappings together; vs keep a separate target picker with a mismatch warning?
4. **Pre-flight readiness surface** — where in the wizard's Inputs & context stage, and
   exactly what it shows (saved date, X/51 answered, foundational DB decisions present,
   tech-stack written, named gaps)?
5. **Multiple saved conversations** — default to most-recent-saved but allow choosing
   another from the list?
6. **Save enablement** — keep the existing close gate (service.language + api.protocol +
   db.engine) as the minimum to enable Save, but allow Save with the rest incomplete
   (warning)? Or adjust the gate?

## Existing code to reference

- `gateway/src/services/contextResolvers.ts` (`TargetStateDecisionsContextResolver.resolve`
  `:820`; `TargetTechStackContextResolver.resolve` `:1100`;
  `buildTargetStateDecisionsPromptText` `:937` now has additive `tier2Facts`;
  `renderDecisionBody` `:1049`).
- `gateway/src/routes/architectConversation.ts` (close handler `:836-904`:
  `appendTurn(CloseTurn)` + `writeTargetTechStackMarkdown`; session derive `:639-655`).
- `gateway/src/services/targetStateConversationStore.ts` (thread.json, 1:1 by
  `targetArchitectureId`; envelope `{schemaVersion,threadId,turns}` — no status/timestamp).
- `gateway/src/services/targetStateCapturedDecisionsClient.ts`
  (`fetchActiveTargetArchitectureId`; `fetchLatestCapturedDecisions`;
  `TargetStateCapturedDecision` wire `:44-60`).
- AMS `ArchitectureEntity.java` (add `conversation_saved_at`, mirror nullable
  boxed-`Instant` like `last_marked_stale_at:131`); `ActiveTargetArchitectureController.java:74-80`
  (active finder to clone for most-recent-saved); `TargetArchitecturePromoteService:309-363`
  (`listTargets`).
- Frontend: `ArchitectConversationTab.tsx` (sub-tab landing + "Start new conversation"
  `:1175-1206`; mounts `DecisionsFileUploadPanel` + `ManifestUploadPanel`);
  `DecisionsFileUploadPanel.tsx:20` ("Save Conversation" label); `CloseConversationFlow.tsx`
  (close gate `CLOSE_GATE_CODES`); `TargetArchitectureWorkspace.tsx` (`selectedDraftId`,
  `getElementsInventory`); `MigrationDeliveryPlanWizard.tsx` (Inputs & context readiness +
  target selection).
- Decision envelope shapes / tolerant reader: `frameworkVersionShape.ts:173` (versioned);
  `decisionsFileImport.ts:114-118` (wrapped string); `decisionCaptureOrchestrator.ts:451-457`
  (bare string); `architectConversationApi.ts:160+` (`resolveCapturedAnswerLabel`).

## Out of scope

- Auto-answering db.engine/db.migrations (the shipped manifest auto-answer + decisions-file
  import already cover this).
- Multiple distinct saved conversations PER target architecture (a dedicated conversation
  table) — not needed; one saved marker per target arch suffices.
- Changing the conversation transcript storage (stays the per-target-arch `thread.json`).
- The book-of-work scaffold story / manifest→Service FK (other specs).
