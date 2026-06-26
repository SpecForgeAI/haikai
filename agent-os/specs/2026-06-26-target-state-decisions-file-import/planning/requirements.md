# Spec Requirements: Target-State Decisions-File Import / Template-Completion

## Initial Description

Feature: Decisions-file import / template-completion — upload a text file of the user's FINAL target-state decisions to pre-complete the architect conversation. Spec 3 of a 3-spec initiative.

A user may have run target-state conversations before (this project or another) and have a text file of all the final decisions. They want to edit choices for an existing project, or hand-author/modify a text template in Notepad and upload it to complete the conversation immediately — instead of walking all 51 questions by hand.

**The flow:**
1. Upload the decisions text file (a small upload box labelled "Manually Answer Target State", placed just ABOVE the "Target Dependencies Manifest" upload box).
2. The service parses all the choices in the file.
3. If NO parse errors AND all 51 answered (plus any extra Tier-2 details) → the conversation IMMEDIATELY summarises all the choices and offers "Save Conversation" (the existing conversation CLOSE that writes `target-tech-stack-<id>.md`).
4. If a PARSE ERROR → highlight the offending line(s) + reason (NO silent drop); the user fixes and reloads.
5. If the file answers only a SUBSET → summarise the answered subset and proceed to ask the remaining questions in the normal conversation flow.

**Scope framing:** Spec 3 of 3. DEPENDS ON Spec 1 (`2026-06-26-target-conversation-versioned-answer-bare-stem-ux` — the resolved-label answer/template FORMAT + bare-stem `{framework, version}` answers + the "Preview prompt-ready output" as canonical export) and SHARES the apply-answers engine with Spec 2 (`2026-06-26-target-dependency-manifest-auto-answer-comprehensive` — the apply-answers engine + captured-decision write path + the provenance-badge pattern).

## Requirements Discussion

The seven open shaping questions from `raw-idea.md` were resolved with the user (the user confirmed all). They are recorded below as the authoritative decisions, followed by the round-trip / write-path / UI facts established during research.

### Resolved Shaping Decisions

**Q1 — Round-trip grammar (template/line syntax):** ONE tolerant, deterministic parser of the ACTUAL "Preview prompt-ready output" format.
**Decision:** The import grammar's target is the grouped markdown produced by `buildTargetStateDecisionsPromptText(decisions)` (`contextResolvers.ts:886-976`). The canonical per-line shape is `` - `<decisionCode>` = <answerSummary> `` under the `### Architecture-wide` group; after Spec 1, `<answerSummary>` is the resolved chip (e.g. `Spring Boot 4.0`). A SINGLE grammar both reads this literal export AND tolerates hand-simplified edits — it is FORGIVING of:
- an optional leading `- ` bullet,
- optional backticks around the decision code,
- `=` OR `:` as the code/value separator,
- `##` / `###` header lines and blank lines (ignored),
- a trailing ` (standards: <ref>)` suffix (dropped).
There is exactly one grammar — not a strict grammar plus a loose grammar.

**Q2 — Template content / scope (v1):** Import ONLY the 51 architecture-wide answers.
**Decision:** Tier-2 free-facts are parsed-if-present and OPTIONAL (no error if absent). Per-service / per-interface / per-element scope-exception rows and adhoc/note rows are IGNORED-WITH-A-NOTE for v1: the export emits them, but v1 does not apply them (the summary notes that they were seen and skipped).

**Q3 — Parse strategy:** Deterministic-only for v1.
**Decision:** The optional LLM fallback for loose / free-form files is DEFERRED as a clean v2 seam, mirroring the manifest's fail-open LLM gap-fill gap.

**Q4 — Precedence:** The imported file WINS OVER EVERYTHING already captured.
**Decision:** The imported file supersedes BOTH automated rows (manifest / tech-stack-prefill / inferred / LLM) AND prior MANUAL in-conversation answers, because the user authored the file (an explicit, authoritative action). The post-import summary SHOWS what was overridden (e.g. "service.framework: X → Y; 3 prior answers superseded"). This is implemented via the EXISTING append-only supersession (POST a new winning row per code) — no destructive overwrite.

**Q5 — Cross-project tier mismatch:** Ignore-with-a-note.
**Decision:** When the file answers a code that is tier-auto-skipped for THIS project (i.e. an existing `not_applicable` + `system-skip` row is present, written by `maybeAutoSkip`, `decisionCaptureOrchestrator.ts:774-828`), the import does NOT write that code and instead reports it in the summary (e.g. "skipped N lines for tiers not in this project: ui.framework, ...").

**Q6 — Validation UX:** PARTIAL-ACCEPT (not all-or-nothing).
**Decision:** Pre-fill all VALID lines and report ALL bad lines at once, each with line number + reason (unknown code / value not in `questionLibrary.choices` / malformed `{framework, version}` / duplicate code), highlighted for fix-and-reload. NO silent drop — mirror the manifest's `droppedManifests[]` reporting shape.

**Q7 — Summary surface + close/continue branch:** Net-new lightweight summary turn/panel.
**Decision:** There is NO existing "summarise all 51" surface (only the SummaryPanel "Decisions captured" list and the prompt-ready text). Render the pre-filled rows by REUSING the SummaryPanel row presentation plus a NEW provenance badge `from imported file` (consistent with Spec 2's `from manifest` / `inferred` / `LLM-suggested` badges).
- FULL case (all 51 answered) → offer the EXISTING "Save Conversation" close (`POST .../architect-conversation/close` → `writeTargetTechStackMarkdown`, `architectConversation.ts:830-897`).
- SUBSET case → drop the user into the normal question walk for the remaining unanswered codes.

**Q8 — Re-import:** Supported (re-supersede).
**Decision:** Re-import is allowed and uses the same append-only supersession mechanism. The fix-and-reload flow (Q6) requires it.

### Existing Code to Reference

**Round-trip source (the import grammar's target):**
- "Preview prompt-ready output" is served by `GET .../architect-conversation/prompt-ready-output` (`architectConversation.ts:600-612`) → `buildTargetStateDecisionsPromptText(decisions)` (`contextResolvers.ts:886-976`); per-line rendering is `renderDecisionBody` (`contextResolvers.ts:982-990`). This grouped-markdown text IS what the parser consumes.

**Conversation close path (reused as-is for the full-import branch):**
- `POST .../architect-conversation/close` (`architectConversation.ts:830-897`) appends a CloseTurn then calls `writeTargetTechStackMarkdown` (`writeTargetTechStackMarkdown.ts:107`), which writes `target-tech-stack-<id>.md` (fail-soft). NOTE: that `.md` is NOT the round-trip source — the prompt-ready output is the round-trip source.

**Captured-decision write path (reused; no new AMS DTO):**
- `postCapturedDecision` (`targetStateCapturedDecisionsWriter.ts:107`) is the write path. The import uses a NEW `createdByTask = 'decisions-file-import'` for discriminability + provenance. The value envelope is the existing versioned `{framework, version}` shape for versioned questions and a plain string for single-choice. NO new AMS DTO; the existing envelope + POST `/capture` path are kept.

**Upload box + mutual exclusivity:**
- `ManifestUploadPanel.tsx` is the model for the upload box (file input at `:249`; submit gated by `canSubmit` at `:195` / `:319`). It is mounted in `ArchitectConversationTab.tsx:1357` in the order SummaryPanel → VulnerabilityReductionPanel → ManifestUploadPanel → CloseConversationFlow.
- The NEW "Manually Answer Target State" box sits JUST ABOVE `ManifestUploadPanel`.
- Mutual-exclusivity disable + hover tooltip is NET-NEW on BOTH boxes, wired via parent-held "which bulk input is active" state; clearing the file re-enables the other.
- Reuse the `onUploaded → captureTargetDeps + recomputeReduction + refreshEnvelope + refreshNextQuestion` callback chain.

**Tier-gating (the Q5 collision source):**
- `relevanceCondition` predicates (`questionLibrary.ts:293-297`) plus `maybeAutoSkip` (`decisionCaptureOrchestrator.ts:774-828`) writing `not_applicable` + `system-skip` rows.

**Summary surface:**
- No existing "summarise the 51" surface → Q7's panel is net-new, reusing the SummaryPanel row presentation.

### Follow-up Questions

None. All seven shaping questions were confirmed by the user; no further questions were required.

## Visual Assets

No visual assets provided. (`planning/visuals/` checked via bash — no image files found.)

## Requirements Summary

### Functional Requirements

**FR1 — Tolerant round-trip parser + grammar (Q1, Q2, Q3)**
- Implement ONE deterministic parser whose target is the actual "Preview prompt-ready output" grouped markdown from `buildTargetStateDecisionsPromptText` (`contextResolvers.ts:886-976`).
- Canonical line shape: `` - `<decisionCode>` = <answerSummary> `` under `### Architecture-wide`.
- The parser is forgiving of hand-edits: optional leading `- ` bullet; optional backticks around the code; `=` OR `:` separator; ignore `##` / `###` headers and blank lines; drop a trailing ` (standards: <ref>)` suffix.
- v1 imports ONLY the 51 architecture-wide answers. Tier-2 free-facts are parsed-if-present and optional (absence is not an error).
- Per-service / per-interface / per-element scope-exception rows and adhoc/note rows are ignored-with-a-note (seen, reported as skipped, not applied).
- Deterministic-only; the LLM fallback for loose/free-form files is explicitly deferred to v2 (clean seam).

**FR2 — Per-line validation + partial-accept reporting (Q6)**
- Validate every parsed line against `questionLibrary`: the line must resolve to a valid decision code AND a valid choice value (in `questionLibrary.choices` for single-choice) or a valid `{framework, version}` (for versioned).
- PARTIAL-ACCEPT: pre-fill all valid lines; collect and report ALL bad lines together, each with line number + reason. Reasons include: unknown code, value-not-in-`questionLibrary.choices`, malformed `{framework, version}`, duplicate code.
- NO silent drop; reporting shape mirrors the manifest's `droppedManifests[]`. Bad lines are highlighted for fix-and-reload.

**FR3 — Apply-answers write path with import provenance (Q4 write mechanism)**
- For each valid answered code, write a captured-decision row via the existing `postCapturedDecision` path (`targetStateCapturedDecisionsWriter.ts:107`) using `createdByTask = 'decisions-file-import'`.
- Envelope: versioned `{framework, version}` for versioned questions; plain string for single-choice. No new AMS DTO; keep the existing envelope + POST `/capture` path.
- Reuse Spec 2's apply-answer-set engine (validate-against-`questionLibrary` → write → summarise → ask-remainder).

**FR4 — Import-wins precedence with override summary (Q4)**
- The imported file supersedes EVERYTHING already captured for a given code — automated rows (manifest / tech-stack-prefill / inferred / LLM) AND prior manual in-conversation answers.
- Implemented via existing append-only supersession (POST a new winning row per code; no destructive overwrite).
- The post-import summary SHOWS what was overridden (e.g. "service.framework: X → Y; 3 prior answers superseded").

**FR5 — Cross-project tier-mismatch ignore-with-note (Q5)**
- When a file line answers a code that is tier-auto-skipped for this project (existing `not_applicable` + `system-skip` row from `maybeAutoSkip`, `decisionCaptureOrchestrator.ts:774-828`), do NOT write that code.
- Report these in the summary (e.g. "skipped N lines for tiers not in this project: ui.framework, ...").

**FR6 — New upload box + mutual-exclusivity wiring (UI)**
- Add a "Manually Answer Target State" upload box modelled on `ManifestUploadPanel.tsx` (file input, `canSubmit` gating), mounted in `ArchitectConversationTab.tsx` JUST ABOVE `ManifestUploadPanel`.
- Implement NET-NEW mutual exclusivity on BOTH boxes: parent-held "which bulk input is active" state disables the other box's submit with a hover tooltip explaining why; clearing the uploaded file re-enables the other box.
- Reuse the `onUploaded → captureTargetDeps + recomputeReduction + refreshEnvelope + refreshNextQuestion` callback chain.

**FR7 — Net-new summary turn + full-close / subset-continue branch (Q7)**
- Render a net-new lightweight summary turn/panel of the pre-filled rows, reusing the SummaryPanel row presentation plus a NEW `from imported file` provenance badge (consistent with `from manifest` / `inferred` / `LLM-suggested`).
- FULL case (all 51 answered, no errors) → offer the existing "Save Conversation" close (`POST .../architect-conversation/close` → `writeTargetTechStackMarkdown`, `architectConversation.ts:830-897`), reused as-is.
- SUBSET case → drop the user into the normal question walk for the remaining unanswered codes.

**FR8 — Re-import (Q8)**
- Support re-import; it re-supersedes via the same append-only supersession mechanism. Required by the fix-and-reload flow.

### Reusability Opportunities

- Spec 2's apply-answer-set engine (validate → write → summarise → ask-remainder) — shared by manifest auto-answer and this import.
- `postCapturedDecision` write path + existing captured-decision envelope (`targetStateCapturedDecisionsWriter.ts:107`).
- `ManifestUploadPanel.tsx` as the upload-box model + its `onUploaded` callback chain.
- SummaryPanel row presentation + Spec 2's provenance-badge pattern (new `from imported file` badge).
- Existing append-only supersession for precedence (Q4) and re-import (Q8).
- Existing close path (`POST .../architect-conversation/close` → `writeTargetTechStackMarkdown`) for the full branch.
- The manifest's `droppedManifests[]` no-silent-drop reporting shape, as the model for per-line error reporting.

### Scope Boundaries

**In Scope:**
- Tolerant deterministic round-trip parser of the prompt-ready output grammar (FR1).
- Per-line validation against `questionLibrary` with partial-accept, all-errors-at-once reporting (FR2).
- Apply-answers write via existing path with `decisions-file-import` provenance (FR3).
- Import-wins-over-everything precedence with override summary (FR4).
- Cross-project tier-mismatch ignore-with-note (FR5).
- New "Manually Answer Target State" upload box + net-new mutual-exclusivity on both boxes (FR6).
- Net-new summary turn + full-close / subset-continue branch (FR7).
- Re-import / fix-and-reload (FR8).
- v1 import of the 51 architecture-wide answers; Tier-2 free-facts parsed-if-present (optional).

**Out of Scope:**
- The manifest auto-answer itself (Spec 2).
- The version-decoupling UX (Spec 1).
- LLM fallback for loose / free-form files (deferred to v2 — clean seam).
- Applying per-service / per-interface / per-element scope-exception rows and adhoc/note rows (v1 ignores-with-a-note).
- Any new AMS DTO (the existing envelope + POST `/capture` path are kept).

### Technical Considerations

- **Dependencies:** Depends on Spec 1 (resolved-label format + bare-stem `{framework, version}` answers + prompt-ready export) and Spec 2 (apply-answers engine + captured-decision write path + provenance-badge pattern).
- **Round-trip source of truth:** the prompt-ready output (`GET .../architect-conversation/prompt-ready-output` → `buildTargetStateDecisionsPromptText`), NOT `target-tech-stack-<id>.md`.
- **No new AMS DTO:** keep the existing captured-decision envelope + POST `/capture` path. New discriminator `createdByTask = 'decisions-file-import'`.
- **Precedence + re-import mechanism:** existing append-only supersession (POST a new winning row per code).
- **Tier collision:** `relevanceCondition` predicates (`questionLibrary.ts:293-297`) + `maybeAutoSkip` `not_applicable` + `system-skip` rows (`decisionCaptureOrchestrator.ts:774-828`) are the Q5 collision source.
- **Guard-rail:** validate every imported value against `questionLibrary.choices`, in the spirit of the Spec-1 contract test.
- **Testing / verification:** Gateway tests use Jest; frontend uses Vitest. The frontend whole-repo baseline is RED → verify this feature in ISOLATION.
