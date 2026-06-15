# Raw Idea: Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write

## Why this spec exists

Specs 1-4 plus the hardening pass built the migration-workflow rework end-to-end. The architect conversation captures decisions; the PM tasks consume them. But the architect conversation in Spec 3 was shipped with a v1 shortcut: hardcoded `standardsLookupResult` literal seed maps inside `gateway/src/config/architect-conversation/questionLibrary.ts`. The shortcut was always deferred to a future spec ("Spec 5 — Standards Registry Read API").

The original premise of that future spec was wrong. The project already has an authoritative tech standards artefact: `{projectParentFolder}/agent-os/product/tech-stack.md`. It's the file the implementing service reads to know what target-state code to generate. The architect conversation should READ that file too — and the user should not have to specify target tech standards twice.

This spec replaces the hardcoded seed map with a runtime LLM-driven extraction of `tech-stack.md`, ALWAYS writes a migration-scoped `target-tech-stack-<targetArchitectureId>.md` on conversation close (containing only the migration-relevant slice), and updates the PM tasks + implementing-service flow to consume the new file when present.

## What this spec is (and isn't)

**This spec is:**
- A gateway-side helper that loads `tech-stack.md` once at architect-conversation open.
- A single-shot **pre-fill LLM call** that reads the raw markdown + the question library and subjectively decides which questions are answered by the file ("strong connection" rule, bias toward unmatched when in doubt).
- Per-pre-fill captured-decision row writes via Spec 2's POST endpoint, marked `created_by_task='tech-stack-md-prefill'`, with the source quote retained for audit.
- A UI banner in the Architect Conversation tab announcing "N of X questions answered from your tech standards" or "no tech standards found — all questions asked anew".
- A conversation-close handler that **always** writes `{projectParentFolder}/agent-os/product/target-tech-stack-<targetArchitectureId>.md` containing only the migration-relevant tech details, with per-element exceptions surfaced.
- A new gateway context resolver `target-tech-stack-context` that surfaces the written file to downstream LLM tasks.
- PM Book of Work + Shape-Spec prompt updates so they optionally consume `target-tech-stack-context` alongside Spec 2's `target-state-decisions-context`.

**This spec is not:**
- A parser for tech-stack.md. Raw markdown goes straight into the LLM context; the LLM extracts what's useful.
- A schema or validation rule for tech-stack.md. The file stays human-curated and format-flexible.
- A "Standard Combinations" section convention. The user explicitly chose NOT to enforce a new section format — the LLM reads the whole file and reasons about relevance.
- A re-architecture of how `tech-stack.md` is consumed by the implementing service today. Current consumers keep working unchanged; this spec only ADDS the migration-scoped target file.
- A change to Spec 2's data plane. All captured-decision writes still go through Spec 2's existing POST endpoint.
- A mid-conversation reload of tech-stack.md. Loaded once at open; pinned for the session.
- The deletion of the hardcoded library seed map. Hardcoded values stay as the fallback when tech-stack.md is absent or doesn't cover a cascade.

## Decisions already made (don't re-litigate in shape-spec)

These were settled in the conversation that produced this raw idea:

1. **No "Standard Combinations" section enforced.** Tech-stack.md stays free-form markdown. An LLM (not a deterministic parser) decides what's relevant.
2. **Gateway loads tech-stack.md from the existing path**: `{projectParentFolder}/agent-os/product/tech-stack.md` (lowercase + uppercase variant tolerated per existing precedent in `chatV2.ts` + `projectSignals.ts`). Confirmed during raw-idea discussion that the gateway already has filesystem access at this path.
3. **LLM judges question-to-tech-stack matching subjectively.** "Strong connection" rule encoded in the prompt; bias toward "unmatched" when in doubt; the user can always override via Spec 3's existing revise-prior-answer flow.
4. **If tech-stack.md is missing**: gracefully fall through to manual answers; surface a single-line "no tech standards found" note in the same UI slot that would otherwise show "N of X pre-filled". No defaults applied.
5. **Tech-stack.md loaded once at conversation open.** Not re-read mid-conversation. If the user edits the file between conversations, the next conversation re-reads it (fresh load each `open` turn).
6. **target-tech-stack-<targetArchitectureId>.md ALWAYS written** on conversation close — even when the migration's captured decisions almost match the project default. Contains ONLY migration-relevant details (e.g. if standards lists 5 database options and this migration's `db.engine='Postgres 18'`, the target file just has the Postgres 18 detail).
7. **One commit boundary**.

## Specific requirements (rough — let shape-spec refine)

### Gateway-side tech-stack loader

- New helper, suggested location `gateway/src/services/architectConversation/techStackLoader.ts`.
- Single function: `loadTechStackMarkdown(projectId): Promise<string | null>` — reads the file from `{projectParentFolder}/agent-os/product/tech-stack.md`, tolerates both case variants, returns the raw markdown string or `null` if missing.
- Use the existing `fetchProjectFolder(projectId)` helper to resolve the base path (already used by `threadStore.ts`, the captured-decisions client, etc).
- No parsing. No schema. Just file read + raw string return.

### Pre-fill LLM call

- New function in `gateway/src/services/architectConversation/`, suggested name `prefillFromTechStack.ts`.
- Single-shot synchronous LLM call. NOT the multi-turn loop runner from Spec 3 — different shape: one prompt in, structured JSON out.
- Uses the same `ArchitectLlmClient` adapter introduced in Spec 3 (or a sibling adapter — shape-spec to decide whether to reuse or fork).
- Mock seam at the same boundary for tests.
- **Prompt input**:
  - The raw `tech-stack.md` markdown.
  - The question library (the list of 51 decision codes + their prompts + their `expectedAnswerShape`).
  - Brief project context (project name, currentArchitectureId, targetArchitectureId).
- **Prompt rules** (the strong-connection rule):
  - For each question in the library, decide whether the supplied `tech-stack.md` answers it with a strong connection.
  - "Strong" = the file explicitly names the technology / version / pattern the question is asking about.
  - If yes: extract the value verbatim from the file; cite the source row (a quoted line or table fragment).
  - If no or ambiguous: mark as unmatched.
  - Bias toward unmatched when in doubt — the user will be asked explicitly.
  - NEVER hallucinate values not present in the markdown.
- **Response shape**:
  ```json
  {
    "preFilledAnswers": [
      { "decisionCode": "service.language", "value": "Java 21", "sourceQuote": "| Java | 21 (LTS) | ... |" },
      ...
    ],
    "unmatchedCodes": ["api.protocol", "db.migration.tool", ...],
    "summary": "Matched 18 of 51 questions to entries in your tech-stack.md."
  }
  ```
- Hand-rolled validator (mirroring `migrationDeliverySequencingResponseValidator.ts` from Spec 4):
  - Every `decisionCode` in `preFilledAnswers` exists in the library and is NOT also in `unmatchedCodes`.
  - `value` is a non-empty string.
  - `sourceQuote` is a non-empty string and exists in the source markdown (loose contains-check after whitespace-normalising).
  - No duplicate `decisionCode` entries.
  - Validation failure → no pre-fill rows written; conversation falls through to "no tech standards matched — all questions asked anew" with a small inline warning.

### Conversation orchestrator integration

- Called from the gateway endpoint that handles the conversation `open` (per Spec 3 — turn kind `'open'` is appended).
- Sequence at conversation open:
  1. Append `open` turn (existing Spec 3 behaviour).
  2. Load tech-stack.md via the new helper.
  3. If missing → append a synthetic `system-skip` turn or similar carrying the "no tech standards found" reason; return.
  4. If found → invoke the pre-fill LLM call.
  5. For each `preFilledAnswer`: POST a captured-decision row via Spec 2's existing endpoint, with `created_by_task='tech-stack-md-prefill'`, `scope_kind='architecture'` (always — pre-fills are architecture-wide by definition; per-element pinning still requires the user's explicit exception sub-dialog action), `answer_value` carrying both the value and the source quote in a structured JSON.
  6. Append a single `cascade-summary`-shaped turn (or a new dedicated turn kind — shape-spec to pick) that surfaces the pre-fill batch to the user as a reviewable group.
- The unmatched codes are what the conversation walks the user through. The matched codes don't appear as questions unless the user clicks "review pre-fills" to inspect them.

### Frontend UI banner

- Architect Conversation tab gets a new banner at the top of the transcript pane (or inline as the first turn after `open`):
  - **Matched case**: *"8 of 51 questions answered from your tech standards. [Review →]"* (number matches `preFilledAnswers.length`).
  - **No-standards case**: *"No tech standards found — all questions will be asked manually."*
  - **Validation-failure case**: *"Tech standards loaded but pre-fill validation failed — all questions will be asked manually."*
- "Review" opens a side panel listing the pre-filled decisions with source quotes; user can override any individual pre-fill via the existing revise-prior-answer flow.

### Conversation close — write `target-tech-stack-<id>.md`

- New file written on conversation close: `{projectParentFolder}/agent-os/product/target-tech-stack-<targetArchitectureId>.md`.
- ALWAYS written, even if the captured decisions all match the project's tech-stack.md (no delta-detection short-circuit).
- **Contents**: only the migration-relevant tech details. The orchestrator walks the captured-decision set, transforms it into markdown tables matching the format of the source `tech-stack.md`, and writes only the cells that are decision-touched.
- Per-element exceptions get their own row(s) in the file with the element id and the exception value (per Spec 3's exception sub-dialog model).
- Each row optionally cites its source decision code as a markdown comment or footnote.
- File is human-readable and reviewable in git (the project is presumably tracked).
- File location is the same folder as the source `tech-stack.md` — gateway already has write access to that folder (uses fs writes for threads in `{projectParentFolder}/threads/...`).
- The close turn (per Spec 3) gets a new field in its payload indicating the target file was written, with file path + size.

### New gateway context resolver

- New `TargetTechStackContextResolver` registered in `KNOWN_CONTEXT_KEYS` under key `target-tech-stack-context`.
- Reads `{projectParentFolder}/agent-os/product/target-tech-stack-<targetArchitectureId>.md` for the active target architecture.
- Returns the raw markdown as prompt-ready text (no parsing — the downstream LLM tasks just inline it).
- If the file doesn't exist: returns a distinct "no migration target tech stack written yet" message (distinguishes from "file empty" or "fetch failed").
- Cached at the resolver level for the lifetime of a single LLM task invocation (no need for cross-request caching — the file is small and the read is cheap).

### PM Book of Work + Shape-Spec prompt updates

- `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md` — add `target-tech-stack-context` to the list of consumed context keys. Existing prompt rules unchanged.
- `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md` — same addition. Prompt rules unchanged.
- Both `*.json` task config files get `target-tech-stack-context` added to their `contextNeeds` array.
- The PM prompts already consume Spec 2's `target-state-decisions-context` (per Spec 4). This adds a complementary view — the same data expressed in the tech-stack.md format the LLM is already trained to read.

### Implementing service path

- The implementing service (the `/implement-tasks` flow that runs in agent-os) currently reads `tech-stack.md`.
- Update its read-path to ALSO check for `target-tech-stack-<targetArchitectureId>.md` in the same folder and layer it on top of the base file when present.
- This is the loop closure: architect conversation writes the migration delta → implementing service reads the delta → generated code matches the migration's specific target choices.
- Confirm before spec-writer authoring: which exact file/code in the implementing service does the reading? Likely a CLAUDE.md / agent-os configuration touchpoint rather than gateway/AMS code. Shape-spec to verify.

### Backward compatibility

- The hardcoded `standardsLookupResult` literal seed maps in `questionLibrary.ts` STAY in place as a fallback. The pre-fill LLM call runs first; for codes the LLM couldn't match, the existing library `defaultsWhenUnchanged` + `cascades.standardsLookupResult` kicks in as before. No breaking change to Spec 3.
- The pre-fill captured-decision rows use a new `created_by_task` value but otherwise look identical to user-answered rows — the resolver, the aggregation, the PM prompts all see them seamlessly.

### Tests

- **Backend (gateway)**: 4-8 tests:
  - Pre-fill happy path (representative tech-stack.md → expected matched/unmatched split).
  - No-tech-stack-found path (UI gets the no-standards-found signal; conversation proceeds with all questions).
  - Pre-fill validator rejects (hallucinated `decisionCode`, missing `sourceQuote`, duplicates) → no rows written.
  - Conversation-close write of `target-tech-stack-<id>.md` with representative captured-decision set.
  - New resolver returns the file contents (and the distinct-no-file message when missing).
- **Frontend**: 4-6 tests:
  - Banner renders matched-count text correctly.
  - Banner renders no-standards-found text correctly.
  - Review-pre-fills panel opens and lists pre-filled decisions with source quotes.
  - Pre-fill validation-failure banner renders.
- All LLM mocked at the `ArchitectLlmClient` boundary.
- No real-LLM tests.

### Out of Scope

- New tech-stack.md schema or validation.
- A parser library for tech-stack.md.
- The "Standard Combinations" section convention.
- Real-LLM regression testing.
- Mid-conversation reload of tech-stack.md.
- Delta-detection short-circuit for the target write (always write per Decision 6).
- Backfill of existing target architectures with target-tech-stack.md files (only new conversations get the file).
- Re-running the pre-fill if the user manually re-opens a closed conversation (each `open` turn runs its own pre-fill — but supersession-via-insert from Spec 2 handles duplicate decision-code writes cleanly).
- The deletion or restructuring of the existing `questionLibrary.ts` hardcoded seed maps (they stay as fallback).
- Changes to the existing PM-task orchestration patterns (only prompt + config updates).
- A new captured-decision `scope_kind` for "tech-stack" — pre-fills use `'architecture'` per Decision 5.
- Validation that target-tech-stack.md is well-formed after the close write (the write is "best-effort with prose; not a parser-verified artefact").

## Dependencies

- Specs 1-4 and the hardening pass all shipped + committed.
- `2026-05-22-architecture-scope-via-parent-not-leaf` — already shipped (parent-chain semantics for captured-decision scoping).
- The existing `tech-stack.md` consumption pattern in `chatV2.ts` / `projectSignals.ts` / `contextResolvers.ts` — provides the file-path convention and the case-tolerance pattern.
- The existing `targetStateCapturedDecisionsClient.ts`'s `postCapturedDecision` writer — pre-fills POST through this.
- The existing `targetStateConversationStore.ts` thread helper — turn appending uses this unchanged.
- The existing `ArchitectLlmClient` adapter from Spec 3 — the pre-fill call uses the same boundary.

## Open questions for shape-spec to clarify

1. **Pre-fill LLM call shape — same `ArchitectLlmClient.callLlmToolLoop` adapter, or a new sibling for single-shot synchronous calls?** The conversation loop runner is built around multi-turn tool-call shape. The pre-fill is fundamentally one-shot: prompt in, JSON out, validate, done. Reusing the loop adapter for a 1-round call works but feels heavy. My instinct: **add a sibling `ArchitectLlmClient.callSingleShot(prompt, responseSchema)` method** alongside the existing tool-loop method. Same boundary, two shapes.

2. **target-tech-stack.md content shape.** The file should be a markdown document mirroring the source format (tables, sections), containing only migration-relevant slices. Concretely, three approaches:
   - (a) A single condensed table with `decision_code | value | source` columns.
   - (b) Markdown sections mirroring the source file's section structure (Frontend / Backend / Database / etc), with only the migration-relevant rows inside each.
   - (c) Free-form prose generated by an LLM at close time.
   - My instinct: **(b) — structured sections matching the source format** — most familiar to humans reviewing and to the implementing service.

3. **Source quote storage in pre-fill captured-decision rows.** The pre-fill LLM returns a `sourceQuote` per match. Where does it live? Two options:
   - (a) Stuffed into `answer_value` as JSON alongside the value: `{"value": "Java 21", "sourceQuote": "| Java | 21 (LTS) | ... |"}`.
   - (b) Stuffed into the existing `notes` column (currently free-text) as a tagged line: `[tech-stack-source] | Java | 21 (LTS) | ...`.
   - My instinct: **(a) inside `answer_value` as structured JSON** — keeps the source pinned to the value, no schema change to the captured-decisions table, and `answer_value` is already strings/JSON per Spec 2.

4. **Per-element exception interaction with pre-fill.** A pre-fill writes an `architecture`-scoped row. If the user later adds a per-element exception for the same decision code, the existing supersession-via-narrower-scope works (per Spec 2). Confirm: the pre-fill is NEVER auto-superseded by an exception — they coexist (architecture default + per-element override) per Spec 2's existing semantic.

5. **What if tech-stack.md is enormous?** Token-budget concern. Most tech-stack.md files are short (the project's example is ~150 lines), but in principle a project could have a multi-thousand-line standards file. Three options:
   - (a) Hard cap (e.g. 50K chars) and truncate with a warning if exceeded.
   - (b) Pre-process server-side to strip headings/whitespace/non-table content.
   - (c) No cap; let the LLM client handle context window limits (most LLMs degrade gracefully with truncation).
   - My instinct: **(a) hard cap with truncation warning** — defensive, predictable, surfaces the edge case as a maintenance issue rather than a silent corruption.

6. **Frontend banner click-through UX.** "Review →" opens what exactly? Three options:
   - (a) A new side panel listing the pre-filled decisions with quote-each + a single "Override" button per row that opens the existing revise-prior-answer flow.
   - (b) A modal listing the same.
   - (c) A new "Pre-fills" sub-tab inside the Architect Conversation tab.
   - My instinct: **(a) side panel** — fits the existing chat-style layout pattern, doesn't interrupt the main transcript flow.

7. **Cascade defaults during the conversation — also LLM-extracted from tech-stack.md, or library-only?** Per Decision 5 the file is loaded once at open. The pre-fill LLM call runs against the questions, but cascades fire DURING the conversation when the user answers an unmatched question. Three options:
   - (a) Cascade defaults come EXCLUSIVELY from the library's existing `cascades.standardsLookupResult` literal map.
   - (b) Cascade defaults come from BOTH the loaded tech-stack.md AND the library, with tech-stack.md preferred when it covers the cascade.
   - (c) Cascade defaults fire a per-cascade LLM call against the loaded tech-stack.md.
   - My instinct: **(b) — tech-stack.md preferred, library as fallback**, implemented as a small in-process lookup against the already-loaded markdown string. No second LLM call needed for cascades; the orchestrator can scan the markdown text for keyword matches synchronously.

8. **Implementing service touchpoint.** Where exactly does the implementing service read `tech-stack.md` today? Look for the CLAUDE.md instruction or agent-os configuration that loads it. Shape-spec / implementer needs to confirm this before specifying the layered-read behaviour for `target-tech-stack-<id>.md`. My instinct: **defer the implementing-service patch to a follow-up if the touchpoint is non-trivial** — the gateway side of the spec is the priority; the implementing-service side can land in a small follow-on if it requires more than a one-line glob update.

9. **Folder write permissions for the target file.** The gateway writes to `{projectParentFolder}/agent-os/product/`. Confirm the gateway process has write permission to this folder in production deployments (it writes to `{projectParentFolder}/threads/` today so this is presumably fine, but worth flagging).

10. **What does a "review pre-fill" look like if the user revises a pre-filled decision?** The revise-prior-answer flow from Spec 3 writes a superseding decision row. For pre-fills: does the new row get `created_by_task='architect-persona-conversation'` (user-driven), or `created_by_task='tech-stack-md-prefill-overridden'` (more specific audit value)? My instinct: **`'architect-persona-conversation'`** — the user took the override action; the captured-decision-row's `created_by_task` reflects the latest writer. The prior pre-fill row stays in the audit chain via supersession.

## Verification

After this spec:
- The Architect Conversation tab loads tech-stack.md once at open; if present, surfaces a pre-fill banner with the matched count.
- Pre-filled questions are NOT re-asked during the conversation.
- The user can review and override any pre-fill via the existing revise flow.
- On conversation close, `{projectParentFolder}/agent-os/product/target-tech-stack-<targetArchitectureId>.md` exists, contains the migration-relevant slice of decisions, and is human-readable.
- PM Book of Work + Shape-Spec generation now have BOTH the captured-decisions context (Spec 2 resolver) AND the target-tech-stack-context (this spec) available to their LLM tasks.
- The implementing service reads the new file when generating code for stories scoped to that target architecture (assuming Q8's touchpoint update is in scope).
- The existing library `defaultsWhenUnchanged` + `cascades.standardsLookupResult` fallback still works when tech-stack.md is absent.

## Commit boundary

One commit covering: tech-stack loader helper, pre-fill LLM call + validator, orchestrator integration at the `open` turn path, conversation-close target-tech-stack.md write, new resolver registration in `KNOWN_CONTEXT_KEYS`, PM prompt + config additions, frontend banner + review side panel, backend tests, frontend tests.

If the implementing-service touchpoint update turns out to be non-trivial (per Q8), the implementer can drop that piece from this commit and surface as a small follow-up commit — but the gateway + frontend + PM-prompt portions all ship together.
