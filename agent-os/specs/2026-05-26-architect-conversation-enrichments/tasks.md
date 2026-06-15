# Task Breakdown: Architect Conversation Enrichments (Batched #11 + #12)

## Overview
Total Tasks: 5 task groups, ~30 sub-tasks
Commit Boundary: One commit covering Task Groups 1-4 (the manual smoke in Task Group 5 happens before the commit but is not itself a code change). Small-Medium spec, ~250-350 LOC across 5-6 files plus tests.

## Critical Pitfalls (read before starting any task group)

1. **#11 copy table — apply VERBATIM.** The 51-row lead-in copy table in `planning/requirements.md` (groups A-J, 6+6+6+4+5+5+5+5+5+4 = 51 rows) is the product content. Copy each `staticContextLeadIn` string into `questionLibrary.ts` verbatim. NO re-drafting. NO paraphrasing. NO "improvements" without explicit user sign-off. The user already accepted the draft as-is (Q1 in the Accepted Answers section).
2. **#12 Markdown emit shape — apply VERBATIM.** The 14-turn-kind Markdown emit-shape table in `planning/requirements.md` IS the spec for the export format. Implementer applies every fragment template verbatim: question heading is `### Q · {decisionCode} · round {n}`; lifecycle events (`open`, `close`) use `## H2`; tech-stack-prefill uses `### H3`; all other kinds use bold-label paragraphs with no heading. Fragments joined with `\n\n`.
3. **Field name `staticContextLeadIn` end-to-end.** Identical identifier in `QuestionLibraryEntry` (gateway library), `QuestionTurn` payload (gateway `turnShape.ts`), and the frontend type mirror (`architectConversationApi.ts`). This keeps the coordinator pass-through a literal one-liner `staticContextLeadIn: args.entry.staticContextLeadIn`. Do NOT introduce a different name on any layer.
4. **Silent no-render when `staticContextLeadIn` is null/empty.** Older question turns persisted before this spec ships will not carry the field. They must render with NO muted block, NO placeholder, NO banner. Guard with `turn.staticContextLeadIn != null && turn.staticContextLeadIn.length > 0`. Backward compat is load-bearing.
5. **Plain text only, no Markdown rendering in UI.** The lead-in field is a `string`, rendered into a `<small>` block. Do NOT use `dangerouslySetInnerHTML`. Do NOT add a Markdown library. The accepted answer (Q7) is plain text for v1.
6. **Architecture name from `TargetArchitectureWorkspace.tsx:938`.** Pass `activeTarget?.name` as a new optional `architectureName?: string` prop on `ArchitectConversationTab`. Falls back to `selectedTargetArchitectureId` if null so the filename and header always have a non-empty value. Do NOT introduce a new fetch.
7. **`String(v)` coercion in export — NOT `JSON.stringify(v)`.** For `unknown`-typed values (cascade `proposedValue`, captured `answerValue`), the export utility uses `String(v)` to match the existing `ConversationMainPane.tsx` line 320 rendering. This keeps on-screen and exported content visually consistent.
8. **No new gateway tests.** Existing `questionLibrary.test.ts` already asserts entries are well-formed and will catch any library schema drift via the loader. Do NOT duplicate. Per the accepted Q11 cap, the test budget is exactly 5 frontend Vitest tests across Task Groups 2-4.

## Task List

### Gateway Layer

#### Task Group 1: Library + turn-payload + coordinator pass-through
**Dependencies:** None

- [x] 1.0 Extend `QuestionLibraryEntry`, populate 51 lead-ins, plumb the field through the gateway
  - [x] 1.1 No gateway tests in this task group
    - Per Pitfall 8 and accepted Q11: existing `gateway/src/__tests__/questionLibrary.test.ts` already asserts library entries are well-formed; it will catch any schema drift on the new optional `staticContextLeadIn` field.
    - Do NOT add a new gateway test for the field. The 5-test cap is consumed entirely by the frontend Vitest tests in Task Groups 2, 3, and 4.
  - [x] 1.2 Add the optional `staticContextLeadIn` field to `QuestionLibraryEntry`
    - File: `gateway/src/config/architect-conversation/questionLibrary.ts`.
    - Add `staticContextLeadIn?: string;` to the `QuestionLibraryEntry` TypeScript interface.
    - Javadoc on the field: `"Curated framing paragraph rendered above the prompt in the UI to help the architect orient before answering. Hand-authored per question; never LLM-paraphrased. Distinct from \`discoveryContextLead\` which is reserved for runtime-derived discovery context (currently unused; v2 candidate)."`.
    - Do NOT touch the existing unused `discoveryContextLead?: string` field — it stays as-is per Out of Scope.
  - [x] 1.3 Populate all 51 entries with `staticContextLeadIn` strings VERBATIM from `planning/requirements.md`
    - File: same `questionLibrary.ts`.
    - Source: the "#11 — Per-Question Lead-In Copy Draft Table" in `planning/requirements.md`, groups A through J.
    - Row distribution: A=6, B=6, C=6, D=4, E=5, F=5, G=5, H=5, I=5, J=4 (total 51).
    - CRITICAL (Pitfall 1): copy the `staticContextLeadIn` cell text VERBATIM. No re-drafting, no paraphrasing, no shortening, no spelling "modernisation". The user has already accepted the draft (Q1 in Accepted Answers).
    - Match each library entry by its `code` field (e.g. `service.language`, `service.framework`, `db.engine`, ...). All 51 codes in the table correspond to existing entries in the library — confirmed by the planning investigation. No new entries are added; only the new field is populated on existing entries.
  - [x] 1.4 Add the optional `staticContextLeadIn` field to `QuestionTurn`
    - File: `gateway/src/services/architectConversation/turnShape.ts`.
    - Add `staticContextLeadIn?: string;` to the `QuestionTurn` interface (additive, backward-compatible with any prior persisted turns that have no field).
    - CRITICAL (Pitfall 3): use the IDENTICAL identifier `staticContextLeadIn`. Do NOT rename or alias on this layer.
  - [x] 1.5 One-line coordinator pass-through
    - File: `gateway/src/services/architectConversation/architectConversationCoordinator.ts`.
    - Locate the `QuestionTurn` construction around line 204 (the existing site where `promptText`, `decisionCode`, `roundIndex`, etc. are assigned).
    - Add a single line: `staticContextLeadIn: args.entry.staticContextLeadIn,` (or equivalent in the object-literal form already used at that site).
    - Do NOT prepend the lead-in into `promptText` or otherwise modify the prompt. The lead-in lives on its own payload field so the frontend can style it separately (per the investigation note in `planning/requirements.md` surprise #4).
    - Do NOT introduce a fallback to `discoveryContextLead` — the two fields are separate concerns.
  - [x] 1.6 No test run required for this task group
    - The existing `questionLibrary.test.ts` runs as part of the wider gateway suite; it will run automatically in any CI sweep but is not invoked specifically here.

**Acceptance Criteria:**
- `QuestionLibraryEntry` exposes the new optional `staticContextLeadIn?: string` field with the required Javadoc.
- All 51 library entries carry a `staticContextLeadIn` string copied VERBATIM from the planning table (Pitfall 1).
- `QuestionTurn` exposes the same optional `staticContextLeadIn?: string` field with the IDENTICAL identifier (Pitfall 3).
- The coordinator copies `args.entry.staticContextLeadIn` onto the emitted turn payload in a single line.
- The existing `discoveryContextLead` field is untouched.
- No new gateway test file added (Pitfall 8).

### Frontend Type Mirror + Lead-In Render

#### Task Group 2: Frontend `QuestionTurn` mirror + `ConversationMainPane` lead-in render + CSS
**Dependencies:** Task Group 1

- [x] 2.0 Mirror the gateway field on the frontend type, render the lead-in above the prompt, add CSS
  - [x] 2.1 Write 2 focused Vitest tests for the lead-in render path
    - File: `frontend/src/components/targetState/architectConversation/__tests__/ConversationMainPane.contextLeadIn.test.tsx` (or extend an existing sibling test file if the team's convention is consolidation — confirm during implementation).
    - Test 1 (lead-in renders when non-empty): render `ConversationMainPane` with a single `question` turn whose `staticContextLeadIn` is `"The language and version each service runs on. Common modern picks: Java 21, Kotlin 2, Node 20, Python 3.12, Go 1.22, C# 12."`. Assert a `<small>` element is rendered with the class matching `styles.contextLeadIn` (use the project's existing CSS-Modules test convention — typically `expect(el).toHaveClass(expect.stringContaining('contextLeadIn'))` or a `data-testid` if added during implementation). Assert the lead-in text appears above the prompt text in the DOM order.
    - Test 2 (no muted block when null/empty): render `ConversationMainPane` with a single `question` turn whose `staticContextLeadIn` is `undefined` (and a second case with empty string `""`). Assert NO `<small>` element with the `contextLeadIn` class is rendered. Assert no banner, no placeholder, no muted block (Pitfall 4 — backward compat for older persisted turns).
    - Skip exhaustive coverage of all 51 lead-ins — the verbatim copy is verified by the planning table itself; the rendering pathway only needs the present/absent assertion pair.
  - [x] 2.2 Mirror the field on the frontend `QuestionTurn` type
    - File: `frontend/src/api/architectConversationApi.ts`, around lines 96-101 of the existing `QuestionTurn` type.
    - Add `staticContextLeadIn?: string;` to the type.
    - CRITICAL (Pitfall 3): IDENTICAL identifier to the gateway side.
  - [x] 2.3 Render the lead-in in `ConversationMainPane.tsx`'s `case 'question'` block
    - File: `frontend/src/components/targetState/architectConversation/ConversationMainPane.tsx`.
    - Locate the `case 'question'` block (lines 276-287 per the planning investigation).
    - After the existing `turnLabel` div and BEFORE the existing `{turn.promptText}` rendering, insert a guarded `<small>` block:
      ```tsx
      {turn.staticContextLeadIn != null && turn.staticContextLeadIn.length > 0 && (
        <small className={styles.contextLeadIn}>{turn.staticContextLeadIn}</small>
      )}
      ```
    - CRITICAL (Pitfall 4): the guard MUST be silent when the field is null/empty. No banner, no placeholder, no muted block.
    - CRITICAL (Pitfall 5): plain text only. NO `dangerouslySetInnerHTML`. NO Markdown library. The field is a `string`, rendered as a text node inside the `<small>`.
  - [x] 2.4 Add the `.contextLeadIn` CSS class
    - File: `frontend/src/components/targetState/architectConversation/ArchitectConversation.module.css` (the existing module CSS file used by both `ConversationMainPane.tsx` and `ArchitectConversationTab.tsx`).
    - Class properties:
      - `color: #57606a;` (matches the existing `.turnLabel` muted color)
      - `font-size: 0.8rem;`
      - `font-style: italic;`
      - `margin-bottom: 0.25rem;`
      - `white-space: pre-wrap;` (future-proofs against multi-line lead-ins; user accepted Q8)
      - `display: block;` (so the `<small>` sits on its own line above the prompt — optional if the existing layout already block-flows; confirm during implementation)
  - [x] 2.5 Ensure the 2 lead-in tests pass
    - Run ONLY the 2 tests written in 2.1. Command: `npm test -- ConversationMainPane.contextLeadIn.test.tsx` (or project equivalent).
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 2 lead-in tests in 2.1 pass.
- The frontend `QuestionTurn` type mirrors the gateway field with the IDENTICAL identifier (Pitfall 3).
- The lead-in renders as a `<small className={styles.contextLeadIn}>` block above the prompt text when present.
- The lead-in renders SILENTLY (no fallback markup) when the field is null/empty (Pitfall 4).
- No `dangerouslySetInnerHTML` or Markdown rendering on the UI side (Pitfall 5).
- The `.contextLeadIn` CSS class uses the established `#57606a` muted color and `white-space: pre-wrap` for multi-line future-proofing.

### Frontend Export Utility

#### Task Group 3: `exportTranscript.ts` utility (Markdown emit per 14 turn kinds)
**Dependencies:** Task Group 2 (uses the same frontend `QuestionTurn` type mirrored in 2.2)

- [x] 3.0 Build the Markdown export utility for all 14 turn kinds
  - [x] 3.1 Write 1 focused Vitest test for the export utility
    - File: `frontend/src/components/targetState/architectConversation/__tests__/exportTranscript.test.ts`.
    - Test 1 (covers all 14 turn kinds in a single fixture): build a fixture array containing ONE turn of each of the 14 kinds (`open`, `close`, `tech-stack-prefill-summary`, `question`, `answer`, `cascade-summary`, `cascade-accepted`, `cascade-overridden`, `decision-captured`, `mapping-mutation-summary`, `exception-pinned`, `edit-superseded`, `system-skip`, `error`). Call `exportTranscript({ turns: fixture, architectureName: 'Target Payments v2', architectureId: 'arch-abc-123', projectId: 'proj-xyz', exportedAt: new Date('2026-05-26T12:00:00Z') })`. Assert the returned Markdown string:
      - Starts with the header template from `planning/requirements.md` (contains `# Architect Conversation Transcript`, `**Project**: proj-xyz`, `**Architecture**: Target Payments v2 (`arch-abc-123`)`, `**Exported**: 2026-05-26T12:00:00.000Z`, `**Turn count**: 14`).
      - Contains the expected Markdown fragment for each of the 14 turn kinds — use `expect(md).toContain(...)` per kind, mirroring the per-row template from the planning table. For example:
        - `open` → contains `## Session opened`
        - `close` → contains `## Session closed`
        - `tech-stack-prefill-summary` → contains `### Tech-stack pre-fill`
        - `question` → contains `### Q · ` (specifically `### Q · service.language · round 1` for the fixture's chosen code)
        - `answer` → contains `**Architect:** `
        - `cascade-summary` → contains `**Cascade summary**`
        - `cascade-accepted` → contains `**Cascades accepted:**`
        - `cascade-overridden` → contains `**Cascades overridden:**`
        - `decision-captured` → contains `**Captured:**`
        - `mapping-mutation-summary` → contains `**Mapping mutations:**`
        - `exception-pinned` → contains `**Exception pinned:**`
        - `edit-superseded` → contains `**Revision:**`
        - `system-skip` → contains `**Skipped:**`
        - `error` → contains `**Error**`
      - Assert each fragment is separated by `\n\n` (search for the join boundary between two adjacent fragments).
      - Assert the question turn's lead-in, if present in the fixture, appears as an italicised second line `_{staticContextLeadIn}_` per the planning table.
    - Skip exhaustive coverage of each fragment's internal field rendering — the planning table is the source of truth; a smoke-check via `toContain` per kind is sufficient for the v1 cap.
  - [x] 3.2 Create the utility file
    - File: `frontend/src/components/targetState/architectConversation/exportTranscript.ts` (~100-150 LOC per the spec sizing).
    - Function signature:
      ```ts
      export function exportTranscript(args: {
        turns: ConversationTurn[];
        architectureName: string;
        architectureId: string;
        projectId: string;
        exportedAt: Date;
      }): string
      ```
    - At the top, emit the file header template VERBATIM from `planning/requirements.md`:
      ```
      # Architect Conversation Transcript

      - **Project**: {projectId}
      - **Architecture**: {architectureName} (`{architectureId}`)
      - **Exported**: {exportedAt.toISOString()}
      - **Turn count**: {turns.length}

      ---
      ```
    - Then iterate `turns` chronologically and emit one fragment per turn per the planning table. Each turn kind maps to its specific Markdown template (see Pitfall 2 — the 14-row table in `planning/requirements.md` is the spec; copy each template verbatim).
    - Join all fragments (header + per-turn) with `\n\n` so they visually separate in any previewer.
    - CRITICAL (Pitfall 7): for `unknown`-typed values (cascade `proposedValue`, captured `answerValue`), use `String(v)` for coercion. NOT `JSON.stringify(v)`. This matches the existing `ConversationMainPane.tsx` line 320 behaviour.
    - For the `close` turn, the `summaryMarkdown` field is already a well-formed Markdown fragment produced by `buildCloseSummaryMarkdown` — emit it verbatim inside the close-turn template.
    - For the `question` turn: emit `### Q · {decisionCode} · round {roundIndex}\n\n> {promptText}`, and if `staticContextLeadIn` is non-empty, append `\n\n_{staticContextLeadIn}_` as an italicised second line.
    - Inline slug helper (used by the toolbar in Task Group 4 — keep the helper exported from this file so Task Group 4 can import it): lowercase input + `replace(/[^a-z0-9-]+/g, '-')` + collapse repeated `-` via `replace(/-+/g, '-')` + trim leading/trailing `-` via `replace(/^-+|-+$/g, '')`. Export as `export function slugifyForFilename(input: string): string`.
  - [x] 3.3 Ensure the export utility test passes
    - Run ONLY the test written in 3.1. Command: `npm test -- exportTranscript.test.ts` (or project equivalent).
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 1 export-utility test in 3.1 passes.
- `exportTranscript.ts` exists at the required path and exports `exportTranscript` and `slugifyForFilename`.
- The returned Markdown string starts with the verbatim header template (project id, architecture name + id, ISO export timestamp, turn count) per `planning/requirements.md`.
- All 14 turn kinds are emitted with their per-row template VERBATIM from the planning table (Pitfall 2).
- `String(v)` coercion is used for `unknown`-typed values (Pitfall 7).
- Fragments are joined with `\n\n`.
- Question turns emit `### H3` headings (`### Q · {decisionCode} · round {n}`).
- The `slugifyForFilename` helper is exported for reuse by Task Group 4.

### Frontend Toolbar + Export Button

#### Task Group 4: Export-transcript toolbar in `ArchitectConversationTab.tsx` + arch-name prop wiring
**Dependencies:** Task Group 3 (consumes `exportTranscript` and `slugifyForFilename`)

- [x] 4.0 Add the right-aligned toolbar with the Export-transcript button + thread `architectureName` from the workspace
  - [x] 4.1 Write 2 focused Vitest tests for the export button
    - File: `frontend/src/components/targetState/architectConversation/__tests__/ArchitectConversationTab.exportButton.test.tsx`.
    - Test 1 (button click triggers download): render `ArchitectConversationTab` with a non-empty `turns` array (any 1-2 turns are fine for this assertion) and `architectureName="Target Payments v2"`. Mock `URL.createObjectURL` to return a stable stub URL (e.g. `'blob:stub-url'`). Spy on `HTMLAnchorElement.prototype.click` (or attach a spy to the dynamically-created `<a>` element via a setup helper). Click the "Export transcript" button. Assert:
      - `URL.createObjectURL` was called once with a `Blob` whose MIME type is `text/markdown` (read the Blob via `blob.type === 'text/markdown'`).
      - The temporary `<a>` element's `click()` method was invoked.
      - The temporary `<a>` element's `download` attribute matches the pattern `architect-conversation-target-payments-v2-{ISO-date}.md` (the ISO date portion may be asserted as a regex `/^\d{4}-\d{2}-\d{2}$/` since `new Date()` is non-deterministic — use a fixed-date mock if the test infra supports it, otherwise assert via the regex shape).
      - `URL.revokeObjectURL` was called once after the download (cleanup).
    - Test 2 (button disabled when zero turns): render `ArchitectConversationTab` with `turns={[]}`. Find the "Export transcript" button. Assert it is `disabled` (e.g. `expect(button).toBeDisabled()` or `expect(button).toHaveAttribute('disabled')`). Skip exhaustive coverage of other tab states.
  - [x] 4.2 Add the `architectureName?: string` prop to `ArchitectConversationTab`
    - File: `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx`.
    - Extend the existing props interface (typically `ArchitectConversationTabProps` or similar) with `architectureName?: string;`.
    - Destructure the new prop in the component signature.
    - Compute a single `effectiveArchitectureName` constant near the top of the component: `const effectiveArchitectureName = architectureName ?? selectedTargetArchitectureId ?? 'untitled';` (Pitfall 6 — falls back to the id if the name is null; final string "untitled" prevents an empty slug).
  - [x] 4.3 Wire the prop from the workspace
    - File: `frontend/src/components/Architecture/TargetArchitectureWorkspace.tsx`.
    - Locate the `<ArchitectConversationTab .../>` invocation around line 938 (per the planning investigation).
    - Add `architectureName={activeTarget?.name}` to the JSX props.
    - CRITICAL (Pitfall 6): do NOT introduce a new fetch. `activeTarget` is already in scope at that site.
  - [x] 4.4 Insert the new toolbar `<div>` at the top of the tab content
    - File: `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx`.
    - Position: a new `<div className={styles.tabToolbar}>` at the top of the tab body, ABOVE the existing `TechStackPrefillBanner` and `DownstreamCodesBanner` slots (lines 650-661 per the planning investigation) and above the `styles.layout` grid.
    - The toolbar contains a single right-aligned button:
      ```tsx
      <button
        type="button"
        className={styles.secondaryButton}
        onClick={handleExportTranscript}
        disabled={turns.length === 0}
      >
        <Download size={14} />
        Export transcript
      </button>
      ```
    - Import `Download` from `lucide-react` (already a dep per the planning investigation — used in Spec #7).
    - The `.secondaryButton` class is reused verbatim from the existing "Retire current and start new" button precedent.
  - [x] 4.5 Implement the `handleExportTranscript` click handler
    - In the same `ArchitectConversationTab.tsx`, define:
      ```ts
      const handleExportTranscript = useCallback(() => {
        const md = exportTranscript({
          turns,
          architectureName: effectiveArchitectureName,
          architectureId: selectedTargetArchitectureId ?? '',
          projectId,
          exportedAt: new Date(),
        });
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `architect-conversation-${slugifyForFilename(effectiveArchitectureName)}-${new Date().toISOString().slice(0, 10)}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, [turns, effectiveArchitectureName, selectedTargetArchitectureId, projectId]);
      ```
    - Import `exportTranscript` and `slugifyForFilename` from `./exportTranscript`.
    - `projectId` is assumed to already be in scope on this tab — confirm during implementation; if not, thread it down similarly to `architectureName` (the planning investigation should have flagged this; revisit if absent).
  - [x] 4.6 Add the `.tabToolbar` CSS class
    - File: `frontend/src/components/targetState/architectConversation/ArchitectConversation.module.css`.
    - Class properties:
      - `display: flex;`
      - `justify-content: flex-end;`
      - `margin-bottom: 0.5rem;` (separates the toolbar from the banner zone below it)
      - Optionally `padding: 0.25rem 0;` for breathing room — confirm during implementation if the layout needs it.
    - The `.secondaryButton` class already exists in this file (line ~158 per the planning investigation) — DO NOT duplicate or re-style it; the toolbar's button reuses it verbatim.
  - [x] 4.7 Ensure the 2 export-button tests pass
    - Run ONLY the 2 tests written in 4.1. Command: `npm test -- ArchitectConversationTab.exportButton.test.tsx` (or project equivalent).
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 2 export-button tests in 4.1 pass.
- `ArchitectConversationTab` accepts a new optional `architectureName?: string` prop with a fallback to `selectedTargetArchitectureId` (Pitfall 6).
- `TargetArchitectureWorkspace.tsx` passes `activeTarget?.name` down via the new prop without introducing a new fetch.
- A new right-aligned toolbar `<div>` sits at the top of the tab content, above the banner zone and the layout grid.
- The "Export transcript" button uses the lucide-react `Download` icon and the existing `.secondaryButton` styling.
- The button is disabled when `turns.length === 0`.
- Click triggers a Blob download with MIME `text/markdown`, filename `architect-conversation-{slug}-{ISO-date}.md`, and revokes the object URL afterwards.

### Verification

#### Task Group 5: End-to-end manual smoke (pre-commit gate, no code changes)
**Dependencies:** Task Groups 1-4

- [ ] 5.0 Manual smoke covering the 5 verification anchors from `spec.md`
  - [ ] 5.1 Run all 5 frontend tests written in Task Groups 2-4
    - Command (example): `npm test -- ConversationMainPane.contextLeadIn.test.tsx exportTranscript.test.ts ArchitectConversationTab.exportButton.test.tsx`.
    - Expected: all 5 pass.
  - [ ] 5.2 Run the wider frontend test suite for regression check
    - Command: `npm test` in `frontend/` (or project equivalent).
    - All previously-passing tests continue to pass. Pre-existing unrelated failures listed in CLAUDE.md may stay red — do NOT touch them.
  - [ ] 5.3 Manual smoke: lead-in renders above every question
    - Open the Architect Conversation tab on a draft target architecture (any project + target combo with the conversation flow available).
    - Walk through 3-5 questions across different groups (e.g. one from Group A, one from Group C, one from Group F, one from Group J).
    - Confirm each question shows a muted-color lead-in paragraph in a `<small>` block ABOVE the prompt text. The text content matches the verbatim copy from the planning table.
    - Confirm the lead-in's styling: `#57606a` color, italic, ~0.8rem font size.
  - [ ] 5.4 Manual smoke: older question turns render silently when the field is absent
    - If the project has any persisted conversation history from before this spec ships (or seed a turn with `staticContextLeadIn` omitted/null/empty), open it.
    - Confirm those question turns render with NO muted block, NO placeholder, NO banner (Pitfall 4).
    - Confirm the prompt and turnLabel still render normally (no other visual regression).
  - [ ] 5.5 Manual smoke: Export-transcript button download
    - Click the "Export transcript" button in the toolbar.
    - Confirm a file downloads with the filename pattern `architect-conversation-{slug}-{ISO-date}.md` (e.g. `architect-conversation-target-payments-v2-2026-05-26.md`).
    - Confirm the file's MIME type is `text/markdown` (browser may show it as `.md` directly).
  - [ ] 5.6 Manual smoke: Exported file renders correctly in a Markdown previewer
    - Open the downloaded `.md` file in any Markdown previewer (VS Code preview, GitHub Gist, Obsidian, etc.).
    - Confirm the header block renders with the project id, architecture name + id, exported ISO timestamp, and turn count.
    - Confirm question turns appear as `### Q · {decisionCode} · round {n}` headings with the prompt body and (if present) the italicised lead-in below.
    - Confirm at least one of each turn kind that appeared in the conversation renders with the expected fragment shape per the planning table.
    - Confirm session lifecycle events (`open`, `close`) use `## H2` headings; question turns and `tech-stack-prefill-summary` use `### H3`; other kinds use bold-label paragraphs.
  - [ ] 5.7 Manual smoke: Export button disabled when zero turns
    - Open a target architecture where no Architect Conversation has been started yet (or where `turns` is empty for other reasons).
    - Confirm the "Export transcript" button is disabled (greyed out, not clickable).
  - [ ] 5.8 Manual smoke: No regression to the existing conversation flow
    - Walk through a full short conversation: ask a question, answer it, observe cascades, accept/override a cascade, capture a decision, pin an exception, supersede a prior answer via edit, close the conversation.
    - Confirm all existing flows behave identically to before this spec.
    - Confirm the lead-in render does not interfere with the prompt text wrapping, the input field placement, or the cascade-banner layout.
  - [ ] 5.9 Final grep sweep
    - `frontend/src/` for any introduced `dangerouslySetInnerHTML` in the changed files — confirm none (Pitfall 5).
    - `frontend/src/` for `JSON.stringify` in `exportTranscript.ts` — confirm absent for the `proposedValue` / `answerValue` rendering (Pitfall 7); only `String(v)` should appear at those sites.
    - `gateway/` for any new test file introduced for the library schema change — confirm none (Pitfall 8).
    - Confirm the field name `staticContextLeadIn` is identical across `questionLibrary.ts`, `turnShape.ts`, and `architectConversationApi.ts` (Pitfall 3) — grep all three files and visually compare.
    - Confirm all 51 lead-in strings match the planning table VERBATIM (Pitfall 1) — diff `questionLibrary.ts`'s new `staticContextLeadIn` values against the planning table row-by-row.

**Acceptance Criteria:**
- All 5 frontend tests pass.
- The wider frontend test suite is green (modulo pre-existing unrelated failures in CLAUDE.md).
- All 5 verification anchors from `spec.md` are observed manually:
  1. Lead-in appears above each question in a `<small>` muted block.
  2. Older question turns without the field render silently.
  3. Export button downloads a file with the expected filename pattern.
  4. The downloaded Markdown file renders correctly in any previewer with all 14 turn kinds' per-table formatting.
  5. No regression to the existing conversation flow.
- All pitfalls are confirmed non-violated by the grep sweep in 5.9.
- Single commit covers Task Groups 1-4 per the spec's Commit Boundary.

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** — Gateway library + turn-payload + coordinator pass-through (foundation; the 51-row verbatim apply is the largest single chunk of work).
2. **Task Group 2** — Frontend type mirror + `ConversationMainPane` lead-in render + `.contextLeadIn` CSS (consumes the gateway field).
3. **Task Group 3** — `exportTranscript.ts` utility (independent of Group 2's render but consumes the same `QuestionTurn` type mirrored in 2.2).
4. **Task Group 4** — Toolbar + Export button + `architectureName` prop wiring (consumes Group 3's utility and slug helper).
5. **Task Group 5** — Manual smoke + regression sweep (final gate before commit).

Task Groups 1-4 land in a single commit per the spec's Commit Boundary. Task Group 5 is the pre-commit verification gate and does not itself add code.
