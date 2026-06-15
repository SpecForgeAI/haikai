# Specification: Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write

## Goal

Replace the hardcoded `standardsLookupResult` literal seed maps in `questionLibrary.ts` with a runtime two-file `tech-stack.md` loader and single-shot pre-fill LLM call at architect-conversation `open`, and always write a deterministic migration-scoped `target-tech-stack-<targetArchitectureId-lowercased>.md` at conversation `close`, exposed to PM tasks via a new `target-tech-stack-context` resolver. This is the fifth and final spec in the migration-workflow rework.

## User Stories

- As a migration architect opening an architect conversation on a project that has organisation-level and project-level `tech-stack.md` files, I want the conversation to pre-fill the captured decisions it can extract verbatim from those files and skip those questions, so I only answer the ones my standards do not already settle.
- As an architect reviewing pre-fills, I want a banner showing how many of the 51 questions were pre-filled and a click-through into the existing `<SummaryPanel />` that displays each pre-fill with the source quote, so I can audit and override anything the LLM matched, without the source quotes leaking into the main transcript.
- As an architect closing an architect conversation, I want a `target-tech-stack-<id>.md` file written deterministically to my project folder containing only the migration-relevant slice of decisions in a free-form source-mirroring layout, so the migration target is captured as a human-reviewable artefact in the same shape as the source standards.
- As a Product Manager running the Book of Work or Shape-Spec tasks after the architect conversation, I want the prompt to receive the new `target-tech-stack-context` block alongside the existing `target-state-decisions-context`, so the LLM has the migration target in the same markdown shape it already understands from `tech-stack.md`.
- As an architect on a project with no tech standards files, I want a clear "No tech standards found" banner and to be walked through every question manually, so the absence of standards is explicit rather than silently defaulted.

## Specific Requirements

### Two-file `tech-stack.md` loader

- New helper at `gateway/src/services/architectConversation/techStackLoader.ts`, signature `loadTechStackMarkdown(projectId): Promise<{ orgMarkdown: string | null, projectMarkdown: string | null, orgTruncated: boolean, projectTruncated: boolean, orgPath: string | null, projectPath: string | null }>`.
- Resolves the organisation root via `fetchProjectFolder(projectId)` from `architectureModelClient.ts` — the AMS DTO field `project_parent_folder` IS the organisation root per audit finding 1 even though the naming is misleading.
- Reads both paths, tolerating lowercase and uppercase filename variants per existing `chatV2.ts` / `projectSignals.ts` precedent:
  - Org-level: `{project_parent_folder}/agent-os/product/tech-stack.md`.
  - Project-level: `{project_parent_folder}/{project.name}/agent-os/product/tech-stack.md`.
- Defensively sanitises `project.name` before path concatenation: reject any value containing `..`, `/`, or `\` with a clean loader error to prevent path-traversal escapes from the organisation folder.
- Enforces a 50K-char hard cap per file: if either file exceeds the cap, truncate that file's content and set the corresponding `*Truncated` flag so the orchestrator can route to the validation-failure-style banner.
- No parsing, no schema interpretation — raw markdown strings returned for whichever files were found.

### Pre-fill LLM call + validator

- New function at `gateway/src/services/architectConversation/prefillFromTechStack.ts` invoked from the orchestrator after auto-skip has selected the candidate decision codes.
- Uses a new sibling adapter method `ArchitectLlmClient.callSingleShot(prompt, responseSchema)` — no tool-call loop, system + user prompt pair returning a JSON string the gateway parses and validates, same mock seam as the existing tool-loop adapter.
- Prompt structure: both files passed as labelled sections `## ORGANISATION STANDARDS` and `## PROJECT STANDARDS` (omit a section if its file is absent), with explicit instruction that project-level overrides organisation-level when both name the same standard; question library filtered to the auto-skip-relevant codes only; brief project context (name, currentArchitectureId, targetArchitectureId).
- Prompt rules: strong-connection matching only (the file explicitly names the technology / version / pattern), bias toward unmatched when in doubt, never hallucinate, extract value verbatim from the file, cite the source quote.
- Response shape: `{ preFilledAnswers: [{ decisionCode, value, sourceQuote }], unmatchedCodes: string[], summary: string }`. Single shot covering all 51 questions, no chunking.
- New hand-rolled validator at `gateway/src/services/architectConversation/techStackPrefillResponseValidator.ts`, mirroring `migrationDeliverySequencingResponseValidator.ts`: every `decisionCode` exists in the library and is not also in `unmatchedCodes`; `value` is a non-empty string; `sourceQuote` is non-empty and present in either the organisation or project markdown after whitespace-normalising contains-check; no duplicate decision codes.
- Validation failure or LLM call failure routes to the failure banner variant with zero rows written; no retry button in v1.

### Orchestrator integration at conversation `open`

- Existing Spec 3 open-turn handler is extended with the following sequence after the `open` turn is appended:
  1. Run auto-skip first (existing behaviour) to determine the candidate code set.
  2. Invoke the two-file loader.
  3. If both files are absent: append a synthetic system turn carrying the "no tech standards found" payload, route the banner to the no-standards variant, and return without calling the LLM.
  4. If at least one file is present and not truncated past the cap: invoke `prefillFromTechStack` against the auto-skip-relevant code set.
  5. If oversized-truncation or LLM call / validation failure: route the banner to the failure variant, append a synthetic system turn carrying the failure reason, write zero rows.
  6. On success: POST each pre-fill row via Spec 2's existing endpoint, then append a single cascade-summary-shaped turn (or a new dedicated turn kind — implementer's call) surfacing the batch as a reviewable group.
- Pre-filled codes are NOT re-asked during the conversation; unmatched codes are walked through normally.
- Auto-skip strictly precedes pre-fill — pre-fill cannot revive an auto-skip-irrelevant code.

### Pre-fill row writes via Spec 2

- Each pre-fill row POSTs through Spec 2's `targetStateCapturedDecisionsClient.ts.postCapturedDecision` unchanged — no new endpoint, no new client method.
- Write attributes: `created_by_task = 'tech-stack-md-prefill'` (the single audit signal); `standardsLookupRef = null`; `scope_kind = 'architecture'` always (pre-fills are architecture-wide by definition); `answer_value` carries structured JSON `{"value": "<extracted value>", "sourceQuote": "<verbatim quote>"}`.
- Pre-fill independently checks both files for downstream cascade codes (per Q21); the library cascade map is NOT auto-fired from pre-fill matches.
- Partial-failure semantics: on the first POST failure abort remaining writes, surface the partial-success banner variant, and add the failed codes to the unmatched list so the user is walked through them via the standard flow.
- Pre-fill is never auto-superseded — a later per-element exception coexists via Spec 2's narrower-scope-wins semantic; a user revise-prior-answer override is the only way to supersede a pre-fill row.

### Frontend banner + SummaryPanel review

- New banner at the top of the transcript pane (or inline as the first turn after `open`) in `ArchitectConversationTab.tsx`, with three variants per Follow-up C and one failure variant:
  - Both files found and pre-fill succeeded: `"X of 51 questions pre-filled from your tech standards (organisation: <orgFile>, project: <projFile>)"`.
  - Only one file found: `"X of 51 pre-filled from your <organisation/project> tech standards"`.
  - Neither file found: `"No tech standards found — all questions will be asked manually."`.
  - Validation failure / LLM failure / oversized-truncation: `"Tech standards loaded but pre-fill could not run — all questions will be asked manually."` (no retry button in v1).
- Denominator is the static library entry count of 51 (per Q12).
- The "Review" affordance opens the existing `<SummaryPanel />` at `ArchitectConversationTab.tsx:628` — the only new affordance is per-row source-quote display.
- Source-quote text MUST NOT appear in the main transcript pane; only the `<SummaryPanel />` review surface renders it. Dedicated test covers this isolation.
- User override goes through Spec 3's existing revise-prior-answer flow; the override row gets `created_by_task = 'architect-persona-conversation'` and the prior pre-fill row stays in the supersession chain.

### Conversation-close `target-tech-stack-<id>.md` write

- On the existing Spec 3 `close` turn, after captured decisions are finalised, gateway always writes `{project_parent_folder}/{project.name}/agent-os/product/target-tech-stack-<targetArchitectureId-lowercased>.md` — no delta-detection short-circuit.
- `project.name` defensively sanitised with the same `..` / `/` / `\` rejection as the loader; `targetArchitectureId.toLowerCase()` applied at write time for the filename.
- Deterministic gateway-side render — no LLM call on close (per Q15). The renderer walks captured-decision rows, groups them by section using a hardcoded `decision_code → section heading` mapping (Frontend / Backend / Database / Observability / etc), and emits free-form structured markdown that mirrors the source `tech-stack.md` shape (the Q2/Q15 reconciliation: "LLM-decided section grouping at close time" is interpreted as the output STYLE — flexible-section, source-mirroring — while the section assignment itself is deterministic in code).
- Per-element exceptions emit their own row(s) per section, including the element id and the exception value (per Spec 3's exception sub-dialog model).
- Each row optionally cites its source decision code as a markdown comment or footnote so a reader can trace back to the captured-decision row.
- Write failure (filesystem error) surfaces a clean error on the close-turn payload with file path and size omitted; the rest of the close turn proceeds.
- Close-turn payload gains a new field indicating the target file was written (path + size on success; error reason on failure).
- File only written on close, not on open (per Q16); reopen → new pre-fill → next close re-writes the file.

### New `target-tech-stack-context` resolver

- New resolver registered in `KNOWN_CONTEXT_KEYS` under key `target-tech-stack-context`, mirroring Spec 2's resolver pattern.
- Project-folder-aware (per Follow-up F): reads `{project_parent_folder}/{project.name}/agent-os/product/target-tech-stack-<id>.md` with the same `project.name` defensive sanitisation as the loader.
- Uses `fetchActiveTargetArchitectureId(projectId)` (per Q17) to pick which migration file to read; UUID lowercased for the filename lookup to match the writer.
- Returns the raw markdown as prompt-ready text on hit; returns a distinct "no migration target tech stack written yet" message on miss (distinguishable from empty file and from fetch-failed).
- Cached at the resolver level for a single LLM task invocation only; no cross-request cache.
- The existing `TechStackContextResolver` is NOT modified (per Follow-up E) — it stays as-is for `chatV2.ts` and other existing consumers, reading only the organisation-level file.

### PM prompt + task config updates

- `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md` gains a "## Target Tech Stack Context" section explaining the new resolver feeds the migration-specific target-state in `tech-stack.md` shape; existing prompt rules unchanged.
- `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md` gains the same section; existing rules unchanged.
- Both `*.json` task config files (`product-manager--migration-delivery-plan.json` and `product-manager--migration-shape-spec-generation.json`) gain `target-tech-stack-context` in their `contextNeeds` arrays — additive only, no other config changes.
- This complements Spec 2's existing `target-state-decisions-context` consumption: the PM prompts receive both the structured decision rows and the tech-stack-shaped target file. This is the indirect loop closure for v1 in lieu of the deferred implementing-service Skill update.

### Tests (backend + frontend — capped per surface, all LLM mocked)

- **Loader tests (4-8)**: both files present returns both markdowns; only org present returns org with project null; only project present returns project with org null; neither present returns both null; `project.name` with `..` / `/` / `\` rejected; oversized file truncated with flag set; case-variant filename resolution works.
- **Pre-fill LLM call + validator tests (4-8)**: happy path with representative two-file context produces expected matched/unmatched split; project-level wins over org-level when both name the same standard; validator rejects hallucinated `decisionCode` not in library; validator rejects missing or non-contained `sourceQuote`; validator rejects duplicate decision codes; LLM-call failure surfaces failure-variant banner signal and writes zero rows.
- **Orchestrator integration tests (4-8)**: auto-skip runs before pre-fill (pre-fill only sees auto-skip-relevant codes); pre-fill rows POST with `created_by_task = 'tech-stack-md-prefill'`, `scope_kind = 'architecture'`, structured `answer_value` JSON; pre-fill-matched codes are not re-asked; no-standards path appends synthetic system turn and routes banner correctly; partial-failure aborts and merges failed codes into unmatched list.
- **Source-quote isolation test (1, per Q22)**: source-quote text appears in the `<SummaryPanel />` props but is NOT present in the main transcript-pane render output.
- **Close-turn write tests (4-8)**: file written deterministically at the project-level path with lowercased UUID; per-element exceptions appear as their own rows under the right section; write-failure surfaces clean error in close payload; reopen-then-close re-writes the file; `project.name` sanitisation rejects malicious names at write time.
- **Resolver tests (4-8)**: returns raw markdown when the file exists; returns the distinct no-file message when the file is absent; uses `fetchActiveTargetArchitectureId` to scope the read; per-invocation cache hits do not re-read; existing `TechStackContextResolver` behaviour unchanged.
- **PM config + prompt structural tests (4-8)**: both updated `*.task.md` files contain the new section heading; both updated `*.json` files contain `target-tech-stack-context` in `contextNeeds`; existing rules and existing `contextNeeds` entries unchanged.
- **Frontend banner tests (4-6)**: matched-both-files variant renders the file names and count; matched-one-file variant renders only the present source; no-standards variant renders the manual-questions text; failure variant renders the no-retry copy; `<SummaryPanel />` review surface lists pre-fills with their source quotes.

## Out of Scope

- New `tech-stack.md` schema or validation.
- A parser library for `tech-stack.md` — raw markdown goes straight into the LLM context.
- "Standard Combinations" section convention or any other source-file structural constraint.
- Real-LLM regression testing — all LLM-call boundaries mocked at the `ArchitectLlmClient` seam.
- Mid-conversation reload of `tech-stack.md` — loaded once at `open`; next `open` re-reads fresh.
- Delta-detection short-circuit for the target-file write — always written on `close`.
- Backfill of existing target architectures with target-tech-stack files — only new architect conversations produce the file.
- Re-running the pre-fill if the user manually re-opens a closed conversation — each `open` runs its own pre-fill; Spec 2's supersession-via-insert handles duplicates.
- Deletion or restructuring of `questionLibrary.ts` hardcoded `standardsLookupResult` seed maps — they stay as fallback for codes not covered by `tech-stack.md`.
- Changes to the existing PM-task orchestration patterns beyond the prompt section + `contextNeeds` additions.
- A new `scope_kind` for "tech-stack" — pre-fills use `'architecture'` per Decision 5 of the raw idea.
- Validation that `target-tech-stack-<id>.md` is well-formed after the close write.
- **Implementing-service touchpoint update** — deferred to a separate follow-up spec (per Q8 + audit finding 2). The follow-up updates `.claude/skills/global-tech-stack/SKILL.md` to layer in `target-tech-stack-<id>.md`. v1's loop closure is indirect via the PM prompts consuming the new `target-tech-stack-context` resolver.
- Modifications to the existing `TechStackContextResolver` (per Follow-up E).
- Any AMS schema change — no new `project_folder` column (per Follow-up A + audit finding 3); `project.name` used verbatim with sanitisation.
- LLM-driven render at close time — close-turn render is deterministic per Q15.
- Retry button on pre-fill LLM failure (per Q19).
- Cross-request resolver cache — per-invocation only.
- Auto-firing the library cascade map from pre-fill matches (per Q21).
- Frontend changes beyond the banner + `<SummaryPanel />` source-quote affordance — no new tab, no new modal, no new navigation.

## Existing Code to Leverage

### `gateway/src/config/contextResolvers/TechStackContextResolver`

- Existing resolver that reads only the organisation-level file at `{project_parent_folder}/agent-os/product/tech-stack.md` for `chatV2.ts` and other current consumers. Establishes the path-reading conventions (case-tolerant lowercase / uppercase filename lookup, `fetchProjectFolder` for org root) the new two-file loader mirrors.
- This spec does NOT modify the resolver (per Follow-up E). The new pre-fill loader is an independent helper that extends the path set with the project-level file without touching this resolver's contract.

### Spec 2 resolver pattern using `fetchActiveTargetArchitectureId`

- Spec 2's resolver pattern — single context key registered in `KNOWN_CONTEXT_KEYS`, scoped to the active target architecture via `fetchActiveTargetArchitectureId(projectId)`, prompt-ready markdown returned — is mirrored verbatim by the new `target-tech-stack-context` resolver. Only the file-path resolution differs (project-folder-aware per Follow-up F).
- Spec 2's `targetStateCapturedDecisionsClient.ts.postCapturedDecision` is reused unchanged by the pre-fill writes — `created_by_task` discriminates the audit signal at the data plane.

### Spec 3 orchestrator + `ArchitectLlmClient` adapter

- Spec 3's open-turn orchestrator path is the integration point — auto-skip runs already, the new pre-fill step slots in between auto-skip and the user-walked question stream.
- Spec 3's `ArchitectLlmClient` adapter gets a new sibling method `callSingleShot(prompt, responseSchema)` for the synchronous prompt-in / JSON-out shape. Same mock seam as the existing tool-loop method.
- Spec 3's `targetStateConversationStore.ts` turn-appending is reused unchanged; the new cascade-summary-shaped turn (or implementer-chosen dedicated turn kind) goes through the same path.
- Spec 3's revise-prior-answer flow is reused unchanged for user overrides of pre-filled decisions.

### Spec 4's `migrationDeliverySequencingResponseValidator.ts`

- Spec 4's hand-rolled validator pattern (no JSON-schema library; explicit per-rule checks; structured warning / error return shape) is the template for the new `techStackPrefillResponseValidator.ts`. Same exported entry-point convention and same error / warning return shape.

### `<SummaryPanel />` at `ArchitectConversationTab.tsx:628`

- Existing summary side panel reused as the pre-fill review surface — only new affordance is per-row source-quote display. No new modal, no new tab, no new navigation.

### `fetchProjectFolder(projectId)` on `architectureModelClient.ts`

- Resolves the organisation root from the AMS Project DTO. Used today by `threadStore.ts`, the captured-decisions client, and the existing `TechStackContextResolver`. The new two-file loader and the new resolver call it the same way — the only new wrinkle is layering `project.name` on top for the project-level path.

## Implementation Notes

- **Audit finding 1 (legacy DTO naming)**: the AMS Project DTO field `project_parent_folder` IS the organisation root, not the project's own folder — the name predates the org / project hierarchy. The full path triplet is: org file at `{project_parent_folder}/agent-os/product/tech-stack.md`; project file at `{project_parent_folder}/{project.name}/agent-os/product/tech-stack.md`; target output at `{project_parent_folder}/{project.name}/agent-os/product/target-tech-stack-<lowercased-uuid>.md`. Code comments should spell this out so future readers do not misread the field name.
- **Audit finding 2 (deferred implementing-service touchpoint)**: the implementing service does NOT currently read `agent-os/product/tech-stack.md` directly — it reads via `.claude/skills/global-tech-stack/SKILL.md` which points at `agent-os/standards/global/tech-stack.md` (the global template, not the product file). Updating that Skill to layer in `target-tech-stack-<id>.md` is a separate follow-up spec per Q8. v1's loop closure flows through the PM prompts consuming `target-tech-stack-context`.
- **Audit finding 3 (no schema change)**: there is no `project_folder` column on the AMS Project entity today and this spec does NOT add one. `project.name` is used verbatim with defensive sanitisation per Follow-up A.
- **Audit finding 4 (existing resolver untouched)**: the existing `TechStackContextResolver` continues to read only the org-level file for `chatV2.ts` and others; the new pre-fill loader is independent and reads both files via its own helper.
- **Q2 / Q15 reconciliation (Resolution X)**: Q2 said "LLM-decided section grouping at close time, free-form, mirrors source style"; Q15 said "deterministic gateway-side render — no LLM call on close". The reconciled interpretation is that the OUTPUT STYLE mirrors the source file's flexible-section feel (sections like Frontend / Backend / Database / Observability), but the section assignment is deterministic — the gateway hardcodes a `decision_code → section heading` mapping. No close-time LLM call.
- **`project.name` sanitisation**: every path concatenation that uses `project.name` (loader read, target-file write, new resolver read) MUST apply the same `..` / `/` / `\` rejection. Centralise the sanitisation in a small shared helper so the loader, writer, and resolver all share one implementation.
- **Pre-fill vs auto-skip ordering (Q13)**: auto-skip runs first and produces the candidate code set; pre-fill only attempts codes auto-skip declared relevant. Pre-fill cannot revive an auto-skipped code.
- **Single commit boundary**: per the raw idea Decision 7, the whole spec — loader, pre-fill LLM call, validator, orchestrator integration, close-turn write, new resolver, PM prompt + config additions, frontend banner, all tests — ships in one commit. The implementing-service Skill update is a separate follow-up commit.
- **Project memory constraints**: hand-rolled validator pattern (per project pattern established May-19) — no JSON-schema library introduced; plain-English naming in error messages and log lines (per `feedback_no_invented_acronyms.md`) — write "Architecture Model Service" and "organisation tech standards" rather than acronyms; trace-before-coding (per `feedback_trace_before_coding.md`) — confirm the actual signature of `fetchProjectFolder`, `postCapturedDecision`, `fetchActiveTargetArchitectureId`, and the `<SummaryPanel />` props before wiring; no `src` edits while a discovery run is active (not applicable here since the touched paths are gateway + frontend, not `discovery-service/src/**`); pre-existing test failures listed in project memory must remain unmodified.
- **No frontend cache invariants affected**: per project memory's AppShell per-(project, architecture) cache rule, no model-state mutations happen on this path — pre-fill writes go through Spec 2 which already dispatches the cache invalidation. The new banner + `<SummaryPanel />` reuse render only.
- **AMS reads only**: this spec reads `project.name` via the existing AMS Project DTO fetch — no new AMS endpoints, no new client methods, no Liquibase changesets.

## Commit Boundary

One commit covering:
- Two-file `techStackLoader.ts` helper with case-tolerant filename lookup, 50K-char per-file cap, and shared `project.name` sanitisation helper.
- `prefillFromTechStack.ts` LLM-call orchestration + the new `techStackPrefillResponseValidator.ts` hand-rolled validator.
- New `ArchitectLlmClient.callSingleShot(prompt, responseSchema)` sibling adapter method with the same mock seam as the existing tool-loop method.
- Orchestrator integration at the `open` turn (auto-skip first, then pre-fill, then row writes, then cascade-summary-shaped turn appending; partial-failure abort-and-merge handling).
- Conversation-close deterministic write of `target-tech-stack-<id>.md` at the project-level path with lowercased UUID and `project.name` sanitisation; close-turn payload gains the file-written field.
- New `target-tech-stack-context` resolver registration in `KNOWN_CONTEXT_KEYS`, project-folder-aware with `fetchActiveTargetArchitectureId` scoping.
- PM prompt updates to `product-manager.migration-delivery-plan.task.md` and `product-manager.migration-shape-spec-generation.task.md` (new section only).
- PM `*.json` config `contextNeeds` additions of `target-tech-stack-context` to both files.
- Frontend banner with all four variants (both-files, one-file, no-standards, failure) and `<SummaryPanel />` source-quote affordance.
- Backend tests across loader / pre-fill LLM call + validator / orchestrator integration / source-quote isolation / close-turn write / resolver / PM config + prompt structural surfaces, 4-8 per surface.
- Frontend tests across the four banner variants and the `<SummaryPanel />` source-quote rendering surface, 4-6 per surface.
- No AMS endpoints, no AMS schema changes, no Liquibase changesets, no new gateway client methods on `targetStateCapturedDecisionsClient.ts`, no modifications to the existing `TechStackContextResolver`, no deletions from `questionLibrary.ts` hardcoded seed maps, no implementing-service Skill update (deferred).

## Definition of Done

- Architect conversation `open` on a project with at least one `tech-stack.md` file present loads both candidate files via the two-file loader, runs auto-skip first, then invokes the pre-fill LLM call against only the auto-skip-relevant codes, POSTs successful pre-fills via Spec 2's endpoint with `created_by_task = 'tech-stack-md-prefill'` / `scope_kind = 'architecture'` / structured `answer_value` JSON, and appends a single cascade-summary-shaped review turn — verified by orchestrator integration tests.
- The frontend banner renders the correct variant for each of the four cases (both files / one file / no standards / failure), with `<SummaryPanel />` review listing pre-fills and source quotes, and source-quote text confirmed absent from the main transcript pane — verified by frontend banner tests and the dedicated source-quote isolation test (per Q22).
- Pre-filled decision codes are not re-asked during the conversation; unmatched codes (including partial-failure-promoted codes) are walked through via the existing question stream.
- User overrides of pre-fills via Spec 3's revise-prior-answer flow write a superseding row with `created_by_task = 'architect-persona-conversation'`; the prior pre-fill row stays in the supersession chain — verified by orchestrator integration tests.
- Conversation `close` always writes `{project_parent_folder}/{project.name}/agent-os/product/target-tech-stack-<targetArchitectureId-lowercased>.md` deterministically — sections assigned by hardcoded `decision_code → heading` mapping, free-form structured markdown mirroring source style, per-element exceptions emitted as their own rows, source decision codes optionally cited as markdown comments / footnotes, lowercase UUID applied at write time, `project.name` sanitisation applied — verified by close-turn write tests. Write failure surfaces a clean error in the close payload without aborting the rest of the close turn.
- The new `target-tech-stack-context` resolver is registered in `KNOWN_CONTEXT_KEYS`, scoped to the active target architecture via `fetchActiveTargetArchitectureId`, project-folder-aware, returns the distinct "no migration target tech stack written yet" message when the file is absent — verified by resolver tests.
- The two PM task prompts (`product-manager.migration-delivery-plan.task.md` and `product-manager.migration-shape-spec-generation.task.md`) gain the new "## Target Tech Stack Context" section; both `*.json` configs include `target-tech-stack-context` in `contextNeeds`; existing rules and existing context-needs entries unchanged — verified by PM config + prompt structural tests.
- The existing `TechStackContextResolver` and `chatV2.ts` behaviour is unchanged — verified by absence of edits and existing tests still passing.
- `project.name` values containing `..`, `/`, or `\` are rejected by the loader, the writer, and the new resolver via a shared sanitisation helper — verified by loader and close-turn write tests.
- The 50K-char per-file cap truncates either file when exceeded and routes the banner to the failure variant; no pre-fill rows are written on the failure path — verified by loader and orchestrator tests.
- All new backend and frontend tests pass; all existing architect-conversation, Spec 2, Spec 3, Spec 4, and PM-task tests still pass (additive surfaces — no behavioural regression for projects with zero tech-stack files).
- No AMS endpoints, no AMS schema changes, no Liquibase changesets, no new gateway client methods, no modifications to the existing `TechStackContextResolver`, no deletions from `questionLibrary.ts` — verified by file-presence assertions and absence-of-changes checks. The implementing-service `.claude/skills/global-tech-stack/SKILL.md` update is NOT part of this commit (deferred per Q8 + audit finding 2).
