# Specification: Target-State Decisions-File Import / Template-Completion

## Goal
Let a user upload a text file of final target-state decisions (the prompt-ready export, or a hand-authored template) to pre-complete the architect conversation in one shot instead of walking all 51 questions by hand. Spec 3 of 3: it round-trips Spec 1's prompt-ready output and reuses Spec 2's apply-answers write/badge patterns.

## User Stories
- As an architect who already ran a target-state conversation elsewhere, I want to upload my final decisions file so the conversation is summarised and closeable immediately.
- As an architect, I want a hand-edited file's bad lines flagged with line number + reason (not silently dropped) so I can fix and reload.
- As an architect, I want my uploaded file to win over every prior automated and manual answer, with the summary showing what it overrode.

## Specific Requirements

**FR1 — One tolerant deterministic round-trip parser**
- Parse the grouped markdown emitted by `buildTargetStateDecisionsPromptText` / `renderDecisionBody` (`contextResolvers.ts:886-990`).
- Canonical line shape under `### Architecture-wide`: `` - `<code>` = <resolvedLabel> ``.
- One grammar, forgiving of hand-edits: optional leading `- `, optional backticks around the code, `=` OR `:` separator.
- Ignore `##` / `###` header lines and blank lines; drop a trailing ` (standards: <ref>)` suffix.
- v1 applies ONLY the 51 architecture-wide answers; Tier-2 free-facts are parsed-if-present and optional (absence is not an error).
- Per-service / per-interface / per-element scope-exception and adhoc/note rows are seen but ignored-with-a-note (reported as skipped, not applied).
- LLM fallback for loose/free-form files is DEFERRED to v2 (clean seam) — deterministic-only.

**FR2 — Per-line validation + partial-accept reporting**
- Validate every parsed line against `questionLibrary`: code must be known AND value must be in `questionLibrary.choices` (single-choice) or a valid `{framework, version}` (versioned).
- PARTIAL-ACCEPT: pre-fill all valid lines; collect and report ALL bad lines together, each with line number + reason.
- Reasons: unknown code, value-not-in-`choices`, malformed `{framework, version}`, duplicate code.
- NO silent drop; mirror the manifest's `droppedManifests[]` reporting shape; bad lines highlighted for fix-and-reload.

**FR3 — Apply-answers write path with import provenance**
- For each valid code, write a captured-decision row via existing `postCapturedDecision` (`targetStateCapturedDecisionsWriter.ts:107`).
- Use NEW `createdByTask = 'decisions-file-import'` for provenance/discriminability.
- Envelope: versioned `{framework, version}` for versioned questions, plain string for single-choice. NO new AMS DTO; keep the existing envelope + POST `/capture`.
- Reuse Spec 2's apply-answer-set engine (validate-against-`questionLibrary` → write → summarise → ask-remainder).

**FR4 — Import-wins precedence + override summary**
- The imported file supersedes EVERYTHING already captured per code: automated rows (manifest / tech-stack-prefill / inferred / LLM) AND prior manual answers.
- Implemented via the EXISTING append-only supersession (POST a new winning row per code; no destructive overwrite).
- The post-import summary SHOWS overrides (e.g. "service.framework: X → Y; 3 prior answers superseded").

**FR5 — Cross-project tier-mismatch ignore-with-note**
- When a line answers a code tier-auto-skipped for this project (existing `not_applicable` + `system-skip` row from `maybeAutoSkip`, `decisionCaptureOrchestrator.ts:774-828`), do NOT write that code.
- Report these in the summary (e.g. "skipped N lines for tiers not in this project: ui.framework, …").

**FR6 — New upload box + mutual exclusivity**
- Add a "Manually Answer Target State" upload box modelled on `ManifestUploadPanel.tsx` (file input, `canSubmit` gating), mounted in `ArchitectConversationTab.tsx` JUST ABOVE `ManifestUploadPanel`.
- NET-NEW mutual exclusivity on BOTH boxes via parent-held "which bulk input is active" state: uploading to one disables the other box's submit with a hover tooltip explaining why; clearing the file re-enables it.
- Reuse the `onUploaded → captureTargetDeps + recomputeReduction + refreshEnvelope + refreshNextQuestion` callback chain.

**FR7 — Net-new summary turn + close/continue branch**
- Render a net-new lightweight summary turn of the pre-filled rows, reusing SummaryPanel row presentation plus a NEW `from imported file` provenance badge (consistent with Spec 2's `from manifest` / `inferred` / `LLM-suggested`).
- FULL case (all 51 answered, no errors) → offer the EXISTING "Save Conversation" close (`POST .../architect-conversation/close` → `writeTargetTechStackMarkdown`, `architectConversation.ts:830-897`), reused as-is.
- SUBSET case → drop the user into the normal question walk for the remaining unanswered codes.

**FR8 — Re-import**
- Support re-import; it re-supersedes via the same append-only supersession mechanism. Required by the fix-and-reload flow (FR2).

## Visual Design
No visual assets provided (`planning/visuals/` is empty). The new upload box reuses `ManifestUploadPanel.tsx`'s layout; the summary turn reuses SummaryPanel row presentation with the new `from imported file` badge.

## Existing Code to Leverage

**`buildTargetStateDecisionsPromptText` / `renderDecisionBody` (`contextResolvers.ts:886-990`)**
- Emits the grouped markdown the parser round-trips; `renderDecisionBody` is the exact per-line source: `` `<code>` = <summary>(standards: <ref>) ``.
- The parser must mirror this shape and tolerate the documented hand-edit variants.

**`postCapturedDecision` (`targetStateCapturedDecisionsWriter.ts:107`)**
- The captured-decision write path + envelope; reused unchanged with new `createdByTask = 'decisions-file-import'`. The `createdByTask` discriminator pattern is already established here.

**`ManifestUploadPanel.tsx` + `onUploaded` chain**
- Model for the new upload box (file input, `canSubmit` gating) and the post-upload refresh chain; mounted in `ArchitectConversationTab.tsx:1357` (order SummaryPanel → VulnerabilityReductionPanel → ManifestUploadPanel → CloseConversationFlow).

**`SummaryPanel.tsx` row presentation + badge pattern (`SummaryRow`, ~`:180-200`)**
- Reuse row rendering; add the `from imported file` badge following the existing `createdByTask`-driven prefill-badge pattern (`isPrefill` at `:183`).

**`maybeAutoSkip` (`decisionCaptureOrchestrator.ts:774-828`) + close path (`architectConversation.ts:830-897`)**
- `maybeAutoSkip`'s `not_applicable` + `system-skip` rows are the FR5 tier-collision signal to detect and skip; the close route is reused as-is for the FR7 full branch.

## Out of Scope
- The manifest auto-answer feature itself (Spec 2).
- The version-decoupling / bare-stem answer UX (Spec 1).
- LLM fallback for loose/free-form files (deferred to v2 — clean seam).
- Applying per-service / per-interface / per-element scope-exception rows and adhoc/note rows (v1 ignores-with-a-note).
- Any new AMS DTO (keep the existing captured-decision envelope + POST `/capture`).
- Destructive overwrite of prior rows (precedence is append-only supersession only).
- A standalone "summarise all 51" surface beyond the net-new summary turn that reuses SummaryPanel.
- Round-tripping from `target-tech-stack-<id>.md` (the prompt-ready output is the source of truth, not the close-written `.md`).
