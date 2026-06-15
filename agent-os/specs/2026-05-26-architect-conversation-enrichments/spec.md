# Specification: Architect Conversation Enrichments (Batched #11 + #12)

## Goal

Ship two deferred Spec 3 UX enrichments to the Architect Conversation tab in one commit: per-question static context lead-ins (51 hand-authored framing strings rendered above each prompt) and a Markdown transcript export button. Frontend-heavy with a small additive gateway library/payload change; no new endpoints; ~250-350 LOC across 5-6 files plus tests.

## User Stories

- As an architect answering target-state questions, I want a short framing paragraph above each prompt that names the decision subject and lists common modern picks so that I can orient quickly without bringing all the context to every answer.
- As an architect closing out a session, I want to download the full conversation as a Markdown file so that I can share rationale with the team, attach it to a decision record, or paste it into a Confluence page.

## Specific Requirements

**`QuestionLibraryEntry` schema extension (gateway)**
- File: `gateway/src/config/architect-conversation/questionLibrary.ts`.
- Add optional field `staticContextLeadIn?: string` to `QuestionLibraryEntry`.
- Javadoc: "Curated framing paragraph rendered above the prompt in the UI to help the architect orient before answering. Hand-authored per question; never LLM-paraphrased. Distinct from `discoveryContextLead` which is reserved for runtime-derived discovery context (currently unused; v2 candidate)."
- Apply the 51-row lead-in copy table from `planning/requirements.md` verbatim — one `staticContextLeadIn` string per existing entry across groups A-J.
- The existing unused `discoveryContextLead?: string` field stays untouched.

**Gateway `QuestionTurn` payload extension**
- File: `gateway/src/services/architectConversation/turnShape.ts`.
- Add optional field `staticContextLeadIn?: string` on the `QuestionTurn` interface.
- Additive / backward-compatible with prior persisted question turns that have no field.

**Coordinator pass-through**
- File: `gateway/src/services/architectConversation/architectConversationCoordinator.ts` (around line 204 where `QuestionTurn` is constructed).
- One-line addition: copy `args.entry.staticContextLeadIn` onto the emitted turn payload.
- Identical identifier `staticContextLeadIn` end-to-end (library entry, turn payload, frontend mirror).

**Frontend type mirror**
- File: `frontend/src/api/architectConversationApi.ts` (lines 96-101 of the `QuestionTurn` type).
- Extend with the same optional `staticContextLeadIn?: string` field.

**Lead-in render in `ConversationMainPane.tsx`**
- File: `frontend/src/components/targetState/architectConversation/ConversationMainPane.tsx`, `case 'question'` block (lines 276-287).
- When rendering a question turn, render `<small className={styles.contextLeadIn}>{turn.staticContextLeadIn}</small>` above the prompt text and below the existing `turnLabel` div.
- Guard with `turn.staticContextLeadIn != null && turn.staticContextLeadIn.length > 0` — silent no-render when null/empty (backward-compat for older persisted question turns; no banner, no placeholder).

**`exportTranscript.ts` utility (new)**
- File: `frontend/src/components/targetState/architectConversation/exportTranscript.ts` (~100-150 LOC).
- Function signature: `exportTranscript({ turns, architectureName, architectureId, projectId, exportedAt }): string` returning Markdown.
- Emit the top-of-file header template from `planning/requirements.md` (project id, architecture name + id, export ISO timestamp, turn count).
- Apply the Markdown emit-shape table from `planning/requirements.md` verbatim for each of the 14 turn kinds (`open`, `close`, `tech-stack-prefill-summary`, `question`, `answer`, `cascade-summary`, `cascade-accepted`, `cascade-overridden`, `decision-captured`, `mapping-mutation-summary`, `exception-pinned`, `edit-superseded`, `system-skip`, `error`).
- Question heading level: `### Q · {decisionCode} · round {n}`.
- For `unknown`-typed values (cascade `proposedValue`, captured `answerValue`): coerce via `String(v)` — matches existing `ConversationMainPane` rendering at line 320.
- Fragments joined with `\n\n` so they visually separate in any previewer.
- Inline slug helper (lowercase + replace non-`[a-z0-9-]` with `-`, collapse repeats, trim leading/trailing `-`) used for the download filename.

**Export-transcript toolbar in `ArchitectConversationTab.tsx`**
- File: `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx`.
- Insert a new right-aligned toolbar `<div className={styles.tabToolbar}>` at the top of the tab content, above the `styles.layout` grid and above the existing `TechStackPrefillBanner` / `DownstreamCodesBanner` slots.
- Single button: label "Export transcript", lucide-react `Download` icon, `.secondaryButton` styling (mirrors "Retire current and start new").
- Disabled when `turns.length === 0`.
- On click: call `exportTranscript`, build a `Blob` (MIME `text/markdown`), use `URL.createObjectURL` + a temporary `<a download>` element to trigger the download, and revoke the object URL afterwards.
- Filename: `architect-conversation-{slug(architectureName)}-{ISO-date}.md` where ISO-date is `new Date().toISOString().slice(0, 10)`.

**Architecture-name prop wiring**
- File: `frontend/src/components/Architecture/TargetArchitectureWorkspace.tsx` (around line 938).
- Add new optional `architectureName?: string` prop on `ArchitectConversationTab`; pass `activeTarget?.name` down.
- Falls back to `selectedTargetArchitectureId` when null so the filename and header always have a non-empty value.

**CSS additions**
- File: matching `*.module.css` for `ConversationMainPane.tsx` and `ArchitectConversationTab.tsx` (the existing `ArchitectConversation.module.css`).
- `.contextLeadIn` — muted color `#57606a` (mirrors `.turnLabel`); `font-size: 0.8rem`; `font-style: italic`; `margin-bottom: 0.25rem`; `white-space: pre-wrap` (future-proofs multi-line lead-ins).
- `.tabToolbar` — `display: flex; justify-content: flex-end;` with small bottom margin above the layout grid.

**Tests (5 frontend Vitest, 0 new gateway)**
- `ConversationMainPane` — lead-in renders inside a `<small>` block with the `contextLeadIn` class when `staticContextLeadIn` is non-empty.
- `ConversationMainPane` — no muted block renders when the field is null/empty (no banner, no placeholder).
- `exportTranscript` utility — given a fixture covering one turn of each of the 14 kinds, the returned Markdown string contains the expected content per kind (`expect(md).toContain(...)` per kind).
- `ArchitectConversationTab` export button — click triggers download (mock `URL.createObjectURL`; spy on `<a>.click`; assert filename slug pattern).
- `ArchitectConversationTab` export button — disabled when `turns.length === 0`.
- No new gateway test: existing `questionLibrary.test.ts` catches library-schema drift.

**Verification anchors**
- Open the Architect Conversation on a draft target architecture.
- Confirm each question shows a muted-color lead-in paragraph above the prompt in a `<small>` block.
- Confirm older question turns (without the field) render silently — no banner, no placeholder.
- Click "Export transcript" → file downloads with filename `architect-conversation-{slug}-{ISO-date}.md`.
- Open the downloaded file → Markdown renders correctly in any previewer; all 14 turn types appear with their per-table formatting; header carries project id, architecture name + id, exported timestamp, turn count.
- No regression to the existing conversation flow (question-asking, answering, cascading, exception-pinning, supersession, close-out).

## Existing Code to Leverage

**`gateway/src/config/architect-conversation/questionLibrary.ts` — 51 existing entries**
- Existing `QuestionLibraryEntry` rows across groups A-J (6+6+6+4+5+5+5+5+5+4 = 51) receive the new `staticContextLeadIn` strings additively.
- The existing unused `discoveryContextLead?: string` field stays untouched and reserved for v2 runtime-derived context.

**`gateway/src/services/architectConversation/turnShape.ts` + frontend mirror `architectConversationApi.ts`**
- Existing `QuestionTurn` shape is the carrier; this spec adds one optional field to both sides with the identical identifier, keeping the wire shape additive and the coordinator pass-through a one-liner.

**`ConversationMainPane.tsx` `case 'question'` block (lines 276-287)**
- Existing rendering pattern (turnLabel + promptText) is extended by inserting the lead-in `<small>` between them. No structural rewrite.
- The `String(unknown)` precedent at line 320 (cascade `proposedValue`) is mirrored by `exportTranscript` for value-coercion consistency between on-screen and exported output.

**`ArchitectConversationTab.tsx` banner-zone precedent (lines 650-661)**
- Existing `TechStackPrefillBanner` and `DownstreamCodesBanner` demonstrate the slim-element-above-layout pattern. The new toolbar `<div>` mirrors that placement, but right-aligned via the new `.tabToolbar` flex class.

**`.secondaryButton` class + lucide-react `Download` icon**
- Existing `.secondaryButton` styling (used by "Retire current and start new" in `CloseConversationFlow.tsx`) is reused verbatim for the Export button.
- `lucide-react` is already a dependency and provides `Download` (used in Spec #7); no new external dep.

**`buildCloseSummaryMarkdown` output**
- The `close` turn already carries a well-formed Markdown summary fragment built by the existing close-summary helper; the export utility emits that string verbatim inside the close-turn template per the requirements emit-shape table.

## Out of Scope

- LLM-generated lead-in copy (v1 is hand-authored).
- Runtime-derived lead-ins via the existing `discoveryContextLead` field (stays unused; v2 candidate).
- Non-Markdown export formats (plain text, HTML, PDF).
- Selective / partial export ("export only completed questions" or "export only after turn N").
- Server-side export endpoint.
- In-flight / draft turn export.
- Re-import / restore from transcript.
- Markdown rendering of the lead-in copy in the UI (plain text only).
- Localisation / i18n of lead-in copy.
- Clipboard-fallback alternative to download (v2 candidate).
- Email / Slack sharing of the transcript.
- Changes to `discoveryContextLead` (stays as-is).
- Changes to other turn kinds' UI rendering or to the conversation flow itself.
- New visual design or layout beyond the `.contextLeadIn` muted-text block and the `.tabToolbar` right-aligned flex container.
