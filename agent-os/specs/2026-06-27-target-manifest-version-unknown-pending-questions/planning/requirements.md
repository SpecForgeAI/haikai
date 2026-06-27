# Spec Requirements: Version-unknown manifest entries become pending questions (Spec B, design A)

## Initial Description
(from `planning/raw-idea.md`)

When a target dependency manifest (pom.xml / package.json) is uploaded for the architect conversation, the gateway auto-answers framework/library/build-tool/driver decisions. Today, if a library is present but its VERSION cannot be resolved from the manifest, the gateway STILL writes a fully-captured decision row with the sentinel value `version-unknown`. That is wrong: a version-unknown answer is not a fully-captured decision, yet it shows in "Decisions Captured", counts as "answered" so the sequencer never asks for the missing version, and flows into prompt-ready output and the close gate as if complete.

Design A (chosen): version-unknown manifest results must become the FIRST questions the architect is asked, with the library/framework PRE-CHOSEN from the manifest, so the user just confirms the version. Until a version is confirmed: do NOT write a captured-decision row for that coordinate, do NOT show it in Decisions Captured, do NOT include it in prompt-ready output or the close-gate "answered" count. Only once the user confirms the exact version is the captured-decision row written (the normal capture path). Concrete-version auto-answers are unchanged. Scope: gateway + frontend; no AMS schema change if avoidable; prefer carrying pending-version-confirmations as conversation/thread state.

## Grounding (code read during shaping)

- Sentinel `VERSION_UNKNOWN = 'version-unknown'` and the `{ framework, version }` envelope/chip helpers live in `gateway/src/config/architect-conversation/frameworkVersionShape.ts` (sentinel ~57; `resolveFrameworkVersionChip` renders `<framework> (version unknown)` ~141).
- Versions degrade to the sentinel (no guessing) in `gateway/src/services/targetManifest/manifestVersionResolution.ts`; the resolution result (`ResolvedManifest[]`) is computed at upload time and is NOT itself persisted.
- The captured-decision row is written for EVERY candidate — including version-unknown — by `runManifestAutoAnswer` / `buildManifestCapturedDecisionBody` in `gateway/src/services/targetManifest/manifestAutoAnswerer.ts` (~336-470), via `postCapturedDecision`, with `createdByTask = 'target-manifest-auto-answer'`. This is the exact write to STOP for the version-unknown case.
- `dedupeCandidatesByPrecedence` already prefers a concrete version over `version-unknown` within the same provenance (~190-216) — relevant to the re-upload interaction.
- The question sequencer (`gateway/src/services/architectConversation/questionSequencer.ts:67-86`) walks a fixed group A..J order and SKIPS any code in `answeredCodes`; it never inspects the value. There is no concept of "ask this first" or "pre-chosen framework".
- `answeredCodes` is built purely from captured-decision row presence in `gateway/src/routes/architectConversation.ts:578`; prompt-ready output (~617-637) and the close gate are likewise row-presence driven.
- The captured-decision write DTO (`gateway/src/services/architectConversation/targetStateCapturedDecisionsWriter.ts`) has NO status field — confirms design A must avoid a "pending" status on the row and carry pending state elsewhere.
- Manual-wins precedence + re-upload supersede logic in `gateway/src/services/targetManifest/manifestPrecedence.ts`: a manifest may supersede a prior manifest/LLM-prefill row but NEVER a manual row; `recomputeResolvedTargetVersions` passes `version-unknown` through unchanged (Spec C hand-off source).
- Thread state is disk-persisted by `gateway/src/services/targetStateConversationStore.ts` at `{projectFolder}/threads/target-state-conversation/{targetArchitectureId}/thread.json` with an opaque envelope `{ schemaVersion, threadId, turns: unknown[] }`; `appendTurn` pushes opaque turns. This is the natural home for pending-version-confirmations WITHOUT an AMS schema change. Turn shape is a closed 20-kind union in `gateway/src/services/architectConversation/turnShape.ts`.
- Frontend: `versionControlConfig.ts` defines the 24 versioned codes and the decoupled framework-stem + version control; `VersionedAnswerControl` (via `ConversationMainPane.tsx`) already supports a pre-chosen framework stem + separate version field. The manifest panel (`ManifestUploadPanel.tsx`, `AutoAnsweredDecision` ~582-730) ALREADY renders version-unknown as an inline-editable affordance that writes a MANUAL captured-decision row — i.e. a second, competing place to set the version. `ArchitectConversationTab.tsx` wires `onUploaded -> refreshEnvelope / refreshNextQuestion`.

## Decisions already made (NOT re-asked)
- Design A: do not persist a captured row until the version is confirmed.
- Prefer carrying pending-version-confirmations as conversation/thread state rather than a new persisted captured-decision status field / AMS schema change.
- Concrete-version manifest auto-answers stay exactly as today.
- Scope is gateway + frontend only.

## Requirements Discussion

### First Round Questions

**Q1 — Where do pending-version-confirmations live so they survive reload?**
Because design A writes no row, the unresolved coordinates have no persistence today (the `ResolvedManifest[]` is ephemeral). Recommended default: at manifest upload, persist the pending set (each carrying decisionCode, pre-chosen framework stem, sourceFile, sourceQuote/evidence, tag) onto the conversation thread as a NEW turn kind (e.g. `pending-version-confirmations`) in `thread.json`, recomputed/replaced on each upload. The gateway derives "what to ask first" from this persisted set on every next-question call, so it survives page reload / session reopen with no AMS change. Confirm, or do you prefer deriving it in-memory only (re-running resolution from a stored copy of the raw manifest) — accepting that nothing pending survives a reload unless the manifest is re-uploaded?
**Answer:** CONFIRMED (recommended default). Persist the pending-version-confirmation set onto the conversation thread as a NEW turn kind in `thread.json` — each entry carrying decisionCode + pre-chosen framework + sourceFile/evidence + tag. The set is recomputed/replaced on every upload, and "ask these first" is derived from it on every next-question call. Survives reload; no AMS change.

**Q2 — How is the pre-chosen-framework question surfaced and ordered?**
Recommended default: inject the pending coordinates as the FIRST items the next-question walk returns (ahead of group A), reusing the EXISTING versioned-question DTO + `VersionedAnswerControl` with the framework stem pre-chosen and only the version field to fill — no new "confirm version" turn type or distinct UI. The existing /answer capture path then writes the normal `{ framework, version }` row. Confirm, or do you want a visually distinct "confirm detected version" affordance separate from a normal versioned question?
**Answer:** CONFIRMED (recommended default). Inject the pending coordinates as the FIRST items returned by the next-question walk (ahead of group A), reusing the EXISTING versioned-question DTO + `VersionedAnswerControl` with the framework pre-chosen and only the version to fill. The normal `/answer` path writes the `{ framework, version }` row. No distinct "confirm version" turn type.

**Q3 — What happens on opt-out / "Not applicable" / close without confirming?**
Recommended default: (a) if the user marks a pending coordinate "Not applicable", capture it via the normal not_applicable path and drop it from the pending set; (b) if the user closes the conversation without confirming, the coordinate simply stays unanswered — no captured row, it does NOT block close (consistent with the existing close gate that tolerates unanswered/deferred), and it re-appears as pending on reopen. Confirm, or should an unconfirmed pending version BLOCK close?
**Answer:** CONFIRMED (recommended default). "Not applicable" captures via the normal not_applicable path and drops the coordinate from pending. Closing without confirming leaves the coordinate unanswered (no row), does NOT block close, and the coordinate re-appears as pending on reopen.

**Q4 — Manifest re-upload interaction (pending <-> concrete)?**
Recommended defaults: (a) pending coordinate whose re-upload now resolves a CONCRETE version -> auto-answer + capture as today (the existing concrete path) and clear it from pending; (b) a coordinate ALREADY captured with a concrete version that a later upload can only resolve as version-unknown -> do NOT retract the concrete capture and do NOT create a pending entry (a degraded result never supersedes a real version — mirrors `dedupeCandidatesByPrecedence`); (c) a coordinate already MANUALLY confirmed -> manual wins, no pending entry created. Confirm these three rules.
**Answer:** CONFIRMED (all three rules). (a) pending -> re-upload resolves concrete -> auto-capture as today + clear from pending; (b) already-captured concrete -> a later version-unknown upload does NOT retract the concrete capture and creates no pending entry; (c) already manually confirmed -> manual wins, no pending entry.

**Q5 — Reconcile the manifest panel's existing inline version-unknown edit affordance.**
Today `ManifestUploadPanel.tsx` lets the user inline-edit a version-unknown row (writing a manual row) — that would compete with the new in-conversation confirm flow (two places to set the version). Recommended default: in the panel, STOP listing version-unknown coordinates as editable auto-answered decisions; instead show them as a read-only "Pending version confirmation — confirm in the conversation" pointer (count + list), and keep inline edit ONLY for concrete auto-answered rows. Confirm, or keep the panel's inline edit as a second equivalent entry point?
**Answer:** CONFIRMED (recommended default). Stop listing version-unknown coordinates as editable in `ManifestUploadPanel`; show them read-only as "Pending version confirmation — confirm in the conversation". Keep inline edit ONLY for concrete auto-answered rows.

**Q6 — Should a detected-but-pending coordinate be surfaced anywhere as a non-decision item (so it is not silently lost)?**
With Q1's persisted pending set + Q2's first-questions, a detected coordinate is never lost even if the user never confirms. Recommended default: surface the pending set as an INFORMATIONAL "Pending version confirmation (N)" list/count (e.g. in the manifest panel and/or summary), explicitly separate from "Decisions Captured", excluded from the answered count, and excluded from prompt-ready output until confirmed. No separate informational captured row is written. Confirm.
**Answer:** CONFIRMED (recommended default). Surface the pending set as an INFORMATIONAL "Pending version confirmation (N)" list/count, separate from Decisions Captured, excluded from the answered count and from prompt-ready output until confirmed. No informational captured row is written.

**Q7 — Anything explicitly OUT of scope to confirm?**
Recommended exclusions: no AMS schema/DTO change; no change to concrete-version auto-answer behaviour; no change to Spec A (right-panel UX) or Spec C (live vuln recompute / OSV / logging) beyond making confirmed versions flow through the normal capture path (which benefits C). Anything else to exclude?
**Answer:** CONFIRMED. Out of scope: no AMS schema/DTO change; concrete-version auto-answers unchanged; no overlap with Spec A or Spec C beyond confirmed versions flowing through the normal capture path.

### Existing Code to Reference
- Pending-state persistence: `gateway/src/services/targetStateConversationStore.ts` (thread envelope `{ schemaVersion, threadId, turns: unknown[] }` + `appendTurn`), `gateway/src/services/architectConversation/turnShape.ts` (closed 20-kind turn union — add the new pending turn kind here).
- Stop-the-write seam: `gateway/src/services/targetManifest/manifestAutoAnswerer.ts` (`runManifestAutoAnswer`, `buildManifestCapturedDecisionBody`, `dedupeCandidatesByPrecedence` ~190-216) — version-unknown branch must skip `postCapturedDecision` and instead emit a pending entry (~336-470).
- Resolution / sentinel: `gateway/src/services/targetManifest/manifestVersionResolution.ts` (degrades to sentinel), `gateway/src/config/architect-conversation/frameworkVersionShape.ts` (`VERSION_UNKNOWN` ~57, `resolveFrameworkVersionChip` ~141).
- Ordering / answered set: `gateway/src/services/architectConversation/questionSequencer.ts:67-86` (fixed group A..J walk, skips `answeredCodes`), `gateway/src/routes/architectConversation.ts` (~555-637: `answeredCodes` built from row presence at ~578; prompt-ready output ~617-637; close gate).
- Precedence / re-upload: `gateway/src/services/targetManifest/manifestPrecedence.ts` (manual-wins; `recomputeResolvedTargetVersions` passes `version-unknown` through — Spec C source).
- Write DTO (no status field): `gateway/src/services/architectConversation/targetStateCapturedDecisionsWriter.ts`.
- Frontend confirm UI: `frontend/src/components/targetState/architectConversation/ConversationMainPane.tsx` + `VersionedAnswerControl`, `versionControlConfig.ts` (24 versioned codes, decoupled framework-stem + version control), `ManifestUploadPanel.tsx` (`AutoAnsweredDecision` ~582-730), `ArchitectConversationTab.tsx` (`onUploaded -> refreshEnvelope / refreshNextQuestion`).

### Follow-up Questions
None. All seven first-round questions were answered with "go with your recommendations"; no discrepancies or visual triggers required follow-up.

## Visual Assets

### Files Provided:
No visual assets provided. Confirmed via filesystem check of `planning/visuals/` — directory exists and contains no image/PDF files. None expected; this is predominantly backend (gateway) behaviour with a small frontend affordance change.

### Visual Insights:
N/A — no visuals to analyse.

## Requirements Summary

### Functional Requirements
- On manifest upload, the gateway resolves dependency coordinates as today; concrete-version coordinates continue to auto-answer and write captured-decision rows unchanged.
- For coordinates whose version resolves to the `version-unknown` sentinel, the gateway must NOT write a captured-decision row. Instead it records them in a persisted pending-version-confirmation set on the conversation thread.
- The pending set is stored as a NEW turn kind in `thread.json` via the existing thread store / `appendTurn`, each entry carrying decisionCode, pre-chosen framework stem, sourceFile, sourceQuote/evidence, and tag. The set is recomputed/replaced on every upload and survives reload (no AMS change).
- The next-question walk derives "ask these first" from the persisted pending set, injecting those coordinates ahead of group A, reusing the existing versioned-question DTO + `VersionedAnswerControl` with the framework pre-chosen and only the version field to fill.
- Confirming a version routes through the existing `/answer` capture path, writing the normal `{ framework, version }` row and clearing the coordinate from pending.
- "Not applicable" on a pending coordinate captures via the normal not_applicable path and clears it from pending.
- Closing without confirming leaves the coordinate unanswered (no row), does not block close, and re-appears as pending on reopen.
- Re-upload rules: (a) pending now resolving concrete -> auto-capture + clear from pending; (b) existing concrete capture + later version-unknown -> no retraction, no pending entry; (c) existing manual capture -> manual wins, no pending entry.
- Pending coordinates are excluded from the `answeredCodes`/close-gate count and from prompt-ready output until confirmed.
- Pending coordinates are surfaced as an INFORMATIONAL "Pending version confirmation (N)" list/count, separate from Decisions Captured; no informational captured row is written.
- `ManifestUploadPanel` no longer renders version-unknown coordinates as editable; they appear read-only as "Pending version confirmation — confirm in the conversation". Inline edit remains only for concrete auto-answered rows.

### Reusability Opportunities
- Thread persistence reuses `targetStateConversationStore` + `appendTurn`; only a new turn kind is added to the closed union in `turnShape.ts`.
- Question surfacing reuses the existing versioned-question DTO and frontend `VersionedAnswerControl` / `versionControlConfig.ts` (pre-chosen framework stem + version field) — no new control or turn type.
- Confirmation reuses the existing `/answer` capture path and `targetStateCapturedDecisionsWriter` — the normal `{ framework, version }` write.
- Re-upload precedence reuses `dedupeCandidatesByPrecedence` / `manifestPrecedence` semantics (concrete beats version-unknown; manual wins).

### Scope Boundaries
**In Scope:**
- Gateway: stop-the-write for version-unknown in `runManifestAutoAnswer`; new persisted pending turn kind; sequencer/route changes to ask pending first and exclude pending from answered/prompt-ready/close-gate; re-upload reconciliation rules.
- Frontend: pre-chosen-framework version question via existing `VersionedAnswerControl`; `ManifestUploadPanel` read-only pending affordance; informational "Pending version confirmation (N)" surfacing.

**Out of Scope:**
- Any AMS schema/DTO change (no persisted "pending" status field on captured-decision rows).
- Any change to concrete-version manifest auto-answer behaviour.
- Spec A (right-panel UX) and Spec C (live vuln recompute / OSV bridge / logging), beyond confirmed versions flowing through the normal capture path (which benefits Spec C's version sourcing).

### Technical Considerations
- Stop-the-write seam is the version-unknown branch of `runManifestAutoAnswer` / `buildManifestCapturedDecisionBody` (`manifestAutoAnswerer.ts` ~336-470) — skip `postCapturedDecision`, emit a pending entry instead.
- Pending state home is the opaque-turns thread envelope in `targetStateConversationStore.ts`; the new kind extends the closed union in `turnShape.ts`. Recompute/replace on each upload (idempotent set).
- Ordering hook is `questionSequencer.ts:67-86`; `answeredCodes` / prompt-ready / close gate are row-presence driven in `architectConversation.ts` (~578, ~617-637) and must treat pending coordinates as NOT answered and exclude them from prompt-ready output.
- Re-upload logic must respect `manifestPrecedence` manual-wins and the `dedupeCandidatesByPrecedence` concrete-over-unknown rule; `recomputeResolvedTargetVersions` continues to pass version-unknown through (Spec C hand-off).
- Frontend must remove the competing manual-write inline edit for version-unknown rows in `ManifestUploadPanel.tsx` (`AutoAnsweredDecision` ~582-730) to avoid two entry points; `ArchitectConversationTab.tsx` already refreshes envelope + next-question on upload.
</content>
</invoke>
