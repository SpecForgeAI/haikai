# Raw Idea: Architect Conversation Enrichments (Batched #11 + #12)

## Why this spec exists

Two deferred UX enrichments to the Architect Conversation tab (built in `2026-05-24-target-state-architect-conversation`) — both small, both on the same surface, both Spec 3 follow-ups. Batching them into one combined spec gets them off the priority list with a single review pass.

The two items:

1. **#11 — Per-question context lead-ins.** The conversation walks the architect through 51 questions about the target architecture (`db.engine`, `api.protocol`, `service.framework`, etc.). Today each question is asked cold — no framing, no "why we're asking this", no quick reference to modern alternatives. The architect has to bring all the context to every answer.

2. **#12 — Conversation transcript export.** A long Architect Conversation (10-30 questions) has no export path today. Useful for sharing rationale with the team, attaching to an architecture decision record, or pasting into a Confluence page. Pure read-side feature.

Combined surface: `gateway/src/config/architect-conversation/questionLibrary.ts` (question copy), `frontend/src/components/targetState/architectConversation/ConversationMainPane.tsx` + `ArchitectConversationTab.tsx` (UI changes for both lead-in rendering and the export button). Same review pass; same commit boundary.

## What this spec is (and isn't)

**This spec is:**

- A **curated static lead-in** added per question in the gateway question library — short framing paragraph (~30-80 chars) helping the architect orient before answering.
- A **rendering change** in `ConversationMainPane.tsx` showing the lead-in as a small `<small>` / muted block above the question prompt when a turn of kind `question` is rendered.
- A **transcript export button** on the Architect Conversation tab. Click → downloads a Markdown file containing all turns (questions + answers + cascade summaries + captured decisions + exception pins) in chronological order.
- A **filename convention** for the download: `architect-conversation-{architectureName}-{ISO-date}.md` (sanitized for filesystem safety).

**This spec is not:**

- A change to the question count, ordering, or behaviour. 51 questions stay 51 questions. The LLM still asks them in the same sequence with the same parsing rules.
- A change to the answer-capture pipeline or supersession semantics.
- A rich-text editor for lead-ins. Plain-text per-question copy.
- LLM-generated lead-ins. v1 is **curated static copy**, hand-authored per question. The original Spec 3 design left a `discoveryContextLead?: string` field on the library entry that was reserved for runtime-derived discovery context — that field stays available for a future v2 enrichment if discovery-derived context surfaces are wanted; v1 adds a separate static field.
- A change to the existing turn rendering or conversation flow.
- Server-side export (PDF generation, email-the-transcript). Client-side download only.
- Multiple export formats. **Markdown only for v1.** Plain text / HTML / PDF deferred to v2.
- Selective export ("export only completed questions" or "export only after turn N"). Whole transcript only.
- An export of in-flight / unsaved turn drafts. Only persisted turns.
- A re-import / restore-from-transcript path.

## Decisions already made (don't re-litigate in shape-spec)

These were settled while drafting this raw idea:

1. **Batch both items in one commit.** Same surface, same review pass.
2. **Static curated copy for lead-ins (not runtime-derived).** The existing `discoveryContextLead?: string` field stays untouched in case a future spec wants runtime discovery-context injection. v1 adds a new static field — e.g. `staticContextLeadIn?: string` (final name TBD by shape-spec) — for curated framing copy.
3. **Lead-in copy is hand-authored** per question; not LLM-generated. Implementer + user collaboration during the shape-spec / implementation phase to settle the 51 strings. Shape-spec is the natural place to surface a draft set + collect user feedback.
4. **Markdown-only export for v1.** Other formats deferred.
5. **Client-side download.** No new gateway endpoint.
6. **Whole-transcript export only.** No filters / partial export.
7. **Persisted turns only.** No in-flight draft inclusion.
8. **One commit, frontend + gateway-config** (gateway library file change is data-only — no logic).
9. **Test cap: ~4-5 frontend tests** (1-2 for lead-in render, 2-3 for export button + transcript content).

## Specific requirements (rough — let shape-spec refine)

### #11 — Per-question lead-ins

**Library schema change** (`gateway/src/config/architect-conversation/questionLibrary.ts`):

Add a new optional field to `QuestionLibraryEntry`:
```ts
/**
 * Optional curated framing paragraph rendered above the prompt in the UI.
 * Helps the architect orient before answering — "why we're asking this",
 * a quick reference to modern alternatives, etc. Hand-authored per
 * question; never LLM-paraphrased. Distinct from `discoveryContextLead`
 * which is reserved for runtime-derived discovery context (currently
 * unused; v2 candidate).
 */
staticContextLeadIn?: string;
```

Populate the field for all 51 entries with concise framing copy. Examples (shape-spec to refine):

| code | example lead-in |
| --- | --- |
| `service.runtime` | *"The JVM or runtime that hosts each service. Common modern picks: Java/JVM, Node.js, Python, .NET, Go."* |
| `db.engine` | *"The primary relational store for transactional workloads. Common modern picks: PostgreSQL, MySQL, SQL Server, Aurora, managed cloud-native options."* |
| `api.protocol` | *"How services expose interfaces to consumers. Common modern picks: REST/OpenAPI, gRPC, GraphQL, async messaging."* |
| `auth.protocol` | *"How users + services authenticate. Common modern picks: OAuth2, OIDC, mTLS for service-to-service."* |
| ... | (full table populated in shape-spec) |

Style guide for the copy:
- 30-120 characters each (rough — not enforced).
- Lead with **what is this decision about** (subject), then **modern picks**.
- Plain text — no Markdown rendering in v1; the field is rendered as a `<small>` block.
- Neutral, not opinionated. Don't recommend a specific choice; list alternatives.

**Wire shape**: the library is read from the gateway; existing turn-payload shape already passes `decisionCode` to the frontend. The frontend needs the lead-in copy too. Two paths:
- (a) Frontend fetches the library statically (one request on conversation mount) and looks up by `decisionCode` per turn.
- (b) Gateway includes `staticContextLeadIn` on the turn payload when emitting a `question` turn.

My instinct: (b) — keeps the existing turn-payload pattern (the frontend already gets `promptText`; this is one more field), avoids a new fetch.

**Rendering** in `ConversationMainPane.tsx`:
- When rendering a turn of kind `question`, render the lead-in (if present) above the prompt text using a muted-color `<small>` block (or equivalent CSS class matching existing conversation-pane styles).
- Skip rendering when the field is absent or empty.

### #12 — Transcript export

**Export button** on the Architect Conversation tab:
- Placement: header / toolbar area alongside any existing actions (e.g. the "Close conversation" button). Look at `ArchitectConversationTab.tsx` for the existing header structure.
- Label: "Export transcript" (verb-first).
- Icon (optional): lucide-react `Download` icon (already a dep — confirmed via Spec #7's reuse).
- Disabled when zero turns exist (e.g. before the conversation has opened).

**Export logic** in a new utility file (e.g. `frontend/src/components/targetState/architectConversation/exportTranscript.ts`):
- Takes `{ turns: ConversationTurn[]; architectureName: string }` as input.
- Returns a Markdown string.
- For each turn type, render a specific Markdown shape:
  - `question` (kind=question) → `### Question N — {decisionCode}\n\n> {promptText}\n\n*{staticContextLeadIn}*\n`
  - `answer` → `**Architect:** {answerSummary}\n\n*Raw value:* `{answerValue}`\n`
  - `cascade-summary` / `cascade-accepted` / `cascade-overridden` → `> Standards cascade: {summary}\n`
  - `decision-captured` → `✅ **Captured:** `{decisionCode}: {answerValue}` *(scope: {scopeKind})*\n`
  - `exception-pinned` → `📌 **Exception:** ...\n`
  - `tech-stack-prefill-summary` → render the banner text
  - `open` → `# Architect Conversation: {architectureName}\n\nStarted: {timestamp}\n\n---\n`
  - `close` → `---\n\nClosed: {timestamp}\n`
  - Other turn kinds (`edit-superseded`, `system-skip`, `error`, etc.) → render in plain prose with a small bullet.
- Final wording table for each turn kind to be settled in shape-spec.

**Download trigger** in the export button handler:
- Build a `Blob` from the Markdown string with MIME `text/markdown`.
- Use `URL.createObjectURL` + a temporary `<a download>` element to trigger the download.
- Filename: `architect-conversation-{slugifiedArchitectureName}-{ISO-date}.md` — e.g. `architect-conversation-target-2026-05-26.md`. Sanitize the architecture name to filesystem-safe characters (strip `/`, `\`, `:`, etc.).
- Clean up the object URL after download.

**No persistence**, no server-side state. Pure client-side download.

### Tests

Frontend Vitest (~4-5):

1. `ConversationMainPane` — when a `question` turn carries a `staticContextLeadIn`, the lead-in is rendered above the prompt as a muted block.
2. `ConversationMainPane` — when a `question` turn has no `staticContextLeadIn`, no muted block renders (no empty-state noise).
3. `exportTranscript` utility — given a mix of turn kinds, returns a Markdown string containing each turn's expected content (assertion via `expect(md).toContain(...)` per turn kind).
4. `ArchitectConversationTab` export button — click triggers download (mock `URL.createObjectURL` + spy on `<a>.click`).
5. `ArchitectConversationTab` export button — disabled when zero turns exist.

### Verification

- Open the Architect Conversation on a draft target architecture.
- Confirm each question shows a muted-color lead-in paragraph above the prompt.
- Click "Export transcript" → file downloads with the expected filename.
- Open the downloaded file → Markdown renders correctly in any standard previewer; all turn types appear with their expected formatting.
- No regression to the existing conversation flow (question-asking, answering, cascading, exception-pinning, supersession).

## Out of Scope

- LLM-generated lead-in copy (v1 is hand-authored).
- Runtime-derived lead-ins populated from discovery context (the existing `discoveryContextLead` field stays unused and reserved for that v2 use case).
- Multiple export formats (plain text, HTML, PDF).
- Selective / partial export.
- Server-side export endpoint.
- In-flight / draft turn export.
- Re-import / restore from transcript.
- Markdown rendering of the lead-in copy in the UI (plain text only).
- A rich-text editor for editing lead-ins via the UI.
- Localisation / i18n of lead-in copy.
- A "copy to clipboard" alternative to download (could be a v2 addition).
- Sharing the transcript via email / Slack / equivalent (out of scope; download is the integration surface).
- Linking the transcript to a captured decision record artefact.
- Changes to `discoveryContextLead` (stays as-is).
- Changes to any other turn kind's rendering.

## Dependencies

- `2026-05-24-target-state-architect-conversation` (shipped) — the conversation flow, turn types, and UI surface this spec enriches.
- `2026-05-25-tech-stack-prefill-and-target-write` (shipped) — introduced `tech-stack-prefill-summary` turn kind which #12's transcript export must handle.
- `2026-05-25-four-spec-hardening-pass` (shipped) — Item 4 introduced the runtime `questionLibraryScopes` fetch endpoint; this spec extends the library entry shape additively so the existing endpoint contract stays backward-compatible.

No new external dependencies (`lucide-react` already provides `Download`).

## Open questions for shape-spec to clarify

1. **Field name for the new static lead-in slot.** `staticContextLeadIn`, `framingLeadIn`, `decisionContext`, `questionContext`? My instinct: **`staticContextLeadIn`** — explicit "static" disambiguates from `discoveryContextLead` (the unused runtime sibling).

2. **Wire-shape path for the lead-in copy.** (a) Frontend fetches the library statically on conversation mount and looks up by `decisionCode`. (b) Gateway includes the lead-in on the `question` turn payload when emitting. My instinct: **(b)** — extends an existing payload by one field, no new fetch, no new endpoint.

3. **Lead-in copy authoring.** Shape-spec produces a draft 51-row table for user review. Implementer applies whatever revisions the user requests. My instinct: **yes** — copy is a real product call.

4. **Lead-in style guide.** 30-120 chars, neutral, lead with subject then modern picks. My instinct: **as proposed**. Tighter cap (max 100 chars) probably better; over-long lead-ins crowd the conversation pane.

5. **Markdown emit shape per turn kind.** Shape-spec produces a final wording table for each of the ~12 turn kinds. My instinct: **yes, pin in spec**. Implementer follows verbatim.

6. **Filename format.** `architect-conversation-{slug}-{date}.md`. ISO date or human-readable date? My instinct: **ISO (`2026-05-26`)** — sorts lexicographically; unambiguous.

7. **Sanitization for the architecture-name slug.** Lowercase + replace non-`[a-z0-9-]` with `-`? My instinct: **yes, that pattern**.

8. **Markdown rendering inside the UI?** Should the lead-in copy support `**bold**` / `_italic_` for emphasis? My instinct: **no, plain text only for v1.** Adds rendering complexity for marginal value; keep the framing copy simple.

9. **Should the export button be visible during an in-flight conversation, or only after `close`?** My instinct: **always visible (and enabled)** as long as there's at least one turn — users may want to export mid-conversation to share a draft snapshot with a colleague. Disabled when zero turns.

10. **Should the transcript include the conversation's `architectureId` and `projectId` as metadata in the Markdown header?** My instinct: **yes** — a small frontmatter block (or just plain text) at the top: `**Project:** {projectId}\n**Architecture:** {architectureName} ({architectureId})\n**Exported:** {ISO timestamp}\n`. Helps re-identify a stale exported file.

11. **Commit boundary.** One commit for both items? My instinct: **yes** — same surface, same review pass.

12. **Test cap.** 4-5 frontend tests. My instinct: **yes**.

## Verification

After this spec:
- All 51 questions render with a curated muted-color lead-in above the prompt in `ConversationMainPane`.
- The Architect Conversation tab has an "Export transcript" button that downloads a Markdown file with all turns chronologically rendered per the wording table.
- Filename follows the `architect-conversation-{slug}-{ISO-date}.md` convention.
- No regressions to the existing conversation flow.

## Commit boundary

One commit covering both items. Implementer may split per-item if escalation, but the default expectation is a single commit. Library entry change + frontend rendering change + export utility + button + tests.
