# Spec Requirements: Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write

## Initial Description

The architect conversation captured-decisions flow (Specs 1-4 + hardening pass) shipped with a v1 shortcut: hardcoded `standardsLookupResult` literal seed maps in `gateway/src/config/architect-conversation/questionLibrary.ts`. The original premise of the deferred follow-up ("Spec 5 — Standards Registry Read API") was wrong. The project already has an authoritative tech standards artefact: `tech-stack.md` files held in the agent-os product folders. The architect conversation should READ those files directly, and the user should not have to specify target tech standards twice.

This spec:
- Replaces the hardcoded seed map with a runtime LLM-driven extraction of `tech-stack.md` content at conversation open.
- ALWAYS writes a migration-scoped `target-tech-stack-<targetArchitectureId>.md` on conversation close containing only the migration-relevant slice.
- Adds a new gateway context resolver `target-tech-stack-context` consumed by PM tasks (Book of Work + Shape-Spec).
- Implementing-service consumption of the new file is **deferred to a follow-up spec** (per Q8 + audit finding 2 below).

## Requirements Discussion

### Decisions already settled in the raw idea (load-bearing — do not re-litigate)

1. **No "Standard Combinations" section enforced.** Tech-stack.md stays free-form markdown. An LLM (not a deterministic parser) decides what's relevant.
2. **Gateway loads tech-stack.md from existing paths** (see audit finding 1 + follow-up answers A, D, E, F below for full two-file path resolution).
3. **LLM judges question-to-tech-stack matching subjectively.** "Strong connection" rule encoded in the prompt; bias toward "unmatched" when in doubt; user can override via Spec 3's existing revise-prior-answer flow.
4. **If tech-stack.md is missing**: gracefully fall through to manual answers; surface a single-line "no tech standards found" note in the same UI slot that would otherwise show "N of X pre-filled". No defaults applied.
5. **Tech-stack.md loaded once at conversation open.** Not re-read mid-conversation. Next conversation's `open` turn re-reads fresh.
6. **`target-tech-stack-<targetArchitectureId>.md` ALWAYS written** on conversation close — no delta-detection short-circuit. Contains ONLY migration-relevant details.
7. **One commit boundary** for the whole spec.

### First Round Questions (22)

**Q1:** LLM client adapter shape — reuse `ArchitectLlmClient.callLlmToolLoop` (multi-turn tool-call shape) or add a new sibling for single-shot synchronous calls?
**Answer:** New sibling `ArchitectLlmClient.callSingleShot(prompt, responseSchema)` method, no tool-calls, system+user prompt pair returning JSON string the gateway parses + validates.

**Q2:** `target-tech-stack-<id>.md` content shape — single condensed table, structured sections mirroring source, or free-form prose?
**Answer:** (a) LLM-decided section grouping at close time, free-form, mirrors source style.

**Q3:** Source quote storage in pre-fill captured-decision rows — stuffed into `answer_value` as JSON, or in the `notes` column?
**Answer:** Stuffed into `answer_value` as structured JSON: `{"value": "Java 21", "sourceQuote": "..."}`.

**Q4:** Per-element exception interaction with pre-fill — confirm coexistence semantics.
**Answer:** Pre-fill writes architecture-scoped row; later per-element exception coexists (Spec 2's narrower-scope-wins semantic). Pre-fill is NEVER auto-superseded by an exception.

**Q5:** Oversized `tech-stack.md` handling — hard cap, server-side strip, or no cap?
**Answer:** Hard cap at **50K chars per file**; truncate with a validation-failure-style banner variant.

**Q6:** Frontend banner click-through UX — side panel, modal, or sub-tab?
**Answer:** Reuse existing `<SummaryPanel />` in `ArchitectConversationTab.tsx:628`; only new affordance is source-quote display.

**Q7:** Cascade defaults during the conversation — library-only, tech-stack.md-preferred-with-library-fallback, or per-cascade LLM call?
**Answer:** (a) **Library only** — pre-fill already extracted what tech-stack.md offered; library cascade map fires for pre-fill-uncovered codes.

**Q8:** Implementing service touchpoint — confirm where to update.
**Answer:** **Defer to follow-up spec.** The implementing service reads via `.claude/skills/global-tech-stack/SKILL.md` pointing at the global standards template (NOT the product `tech-stack.md`). PM prompts already pick up the new file via `target-tech-stack-context` resolver — gives indirect loop closure for v1. See audit finding 2.

**Q9:** Gateway write permission to `{projectParentFolder}/agent-os/product/`.
**Answer:** Proceed on the assumption gateway can write to that folder (it already writes to `{projectParentFolder}/threads/...`); clean error + degraded close-turn payload if write fails.

**Q10:** `created_by_task` for an override of a pre-filled decision.
**Answer:** `'architect-persona-conversation'` for user override; prior pre-fill row stays in the supersession chain (no special `'tech-stack-md-prefill-overridden'` audit value).

**Q11:** Pre-fill partial failure (some rows write, some POSTs fail).
**Answer:** (a) Abort remaining writes, surface partial-success banner, failed codes join the unmatched list. User can revise via existing flow.

**Q12:** Banner denominator — static library entry count or dynamic.
**Answer:** Static library entry count (51).

**Q13:** Pre-fill vs auto-skip ordering.
**Answer:** **Auto-skip runs first**; pre-fill only attempts codes auto-skip declared relevant.

**Q14:** Filename casing for `target-tech-stack-<uuid>.md`.
**Answer:** Raw UUID, defensive `.toLowerCase()` before file write: `target-tech-stack-<uuid-lowercase>.md`.

**Q15:** Close-turn write — deterministic gateway render or LLM-generated.
**Answer:** (a) **Deterministic gateway-side render** — walks captured-decision rows, groups by some scheme, writes markdown table. No LLM call on close.

**Q16:** Mid-conversation write of the target file.
**Answer:** File only written on `close` turn, NOT on `open`. Reopen → new pre-fill → next close re-writes the file.

**Q17:** Resolver multi-architecture awareness.
**Answer:** New `target-tech-stack-context` resolver uses `fetchActiveTargetArchitectureId` (mirrors Spec 2's resolver pattern).

**Q18:** Single LLM call covering all 51 questions, or chunked.
**Answer:** Single shot covering all 51 questions; no chunking.

**Q19:** LLM call failure behaviour.
**Answer:** Treated identically to validation failure: no rows written, "tech standards loaded but pre-fill could not run" banner variant. No retry button in v1.

**Q20:** `standardsLookupRef` field on pre-fill rows.
**Answer:** `null` — `createdByTask='tech-stack-md-prefill'` is the single audit signal.

**Q21:** Cascades from pre-fill matches — fire downstream library cascades or independently scan tech-stack.md?
**Answer:** (b) Pre-fill writes the primary code + independently checks tech-stack.md for downstream codes; library cascade map NOT auto-fired from pre-fill matches.

**Q22:** Source-quote test coverage.
**Answer:** Add separate test verifying source-quote text is NOT exposed in the main transcript pane — only in the SummaryPanel review surface.

### Follow-up Questions on the Q8 Audit Finding (6)

The audit during shape-shaping surfaced that TWO tech-stack.md files exist in the product layout, not one. The follow-up answers settle path resolution and precedence.

**Follow-up A:** How does the spec resolve `{project_folder}` when there's no `project_folder` column on the AMS Project entity?
**Answer:** Use `project.name` attribute verbatim from the AMS Project DTO. No slugify, no separate column. Implementer adds defensive guards: reject names containing `..`, `/`, `\` to prevent path-traversal escapes from the org folder.

**Follow-up B:** Precedence when both org-level and project-level tech-stack.md files cover the same decision row.
**Answer:** **Project-level wins over org-level** for any specific row (project overrides org). BOTH files are passed to the pre-fill LLM call as labelled context (`## ORGANISATION STANDARDS` and `## PROJECT STANDARDS`); LLM is instructed to prefer the project-level entry when both name the same standard.

**Follow-up C:** Banner copy variants when two files may be present.
**Answer:** Three variants:
- Both files found → `"X of N questions pre-filled from your tech standards (organisation: A, project: B)"`
- Only one found → `"X of N pre-filled from your <organisation/project> tech standards"`
- Neither found → `"No tech standards found — all questions will be asked manually"`

**Follow-up D:** Write location for the `target-tech-stack-<id>.md` output file.
**Answer:** **Project-level**: `{project_parent_folder}/{project.name}/agent-os/product/target-tech-stack-<targetArchitectureId>.md` (with defensively-sanitised `project.name`).

**Follow-up E:** Does the new pre-fill loader touch the existing `TechStackContextResolver`?
**Answer:** **Don't touch.** Existing resolver reads only the org-level file at `{project_parent_folder}/agent-os/product/tech-stack.md` and is used by `chatV2.ts` and other existing flows. The new pre-fill loader reads both files independently.

**Follow-up F:** Behaviour of the new `target-tech-stack-context` resolver.
**Answer:** Project-folder-aware: reads `{project_parent_folder}/{project.name}/agent-os/product/target-tech-stack-<id>.md` (with the same defensive sanitisation). Still uses `fetchActiveTargetArchitectureId` per Q17.

### Existing Code to Reference

**Similar features identified (from raw idea + answers):**
- `gateway/src/config/architect-conversation/questionLibrary.ts` — hardcoded `standardsLookupResult` literal seed maps stay in place as fallback (no deletion in this spec).
- `gateway/src/services/architectConversation/` — folder where new `techStackLoader.ts` and `prefillFromTechStack.ts` will live.
- `gateway/src/config/contextResolvers/TechStackContextResolver` (existing) — reads org-level file at `{project_parent_folder}/agent-os/product/tech-stack.md` for `chatV2.ts`. **NOT modified by this spec.**
- `chatV2.ts` and `projectSignals.ts` — existing case-tolerance precedent for reading `tech-stack.md` (lowercase + uppercase variants).
- `KNOWN_CONTEXT_KEYS` — new `target-tech-stack-context` registered here.
- Spec 2's `targetStateCapturedDecisionsClient.ts.postCapturedDecision` — pre-fill rows POST through this unchanged.
- Spec 2's resolver pattern using `fetchActiveTargetArchitectureId` — mirrored for the new resolver.
- Spec 3's `ArchitectLlmClient` adapter — new sibling `callSingleShot(prompt, responseSchema)` method added.
- Spec 3's `ArchitectConversationTab.tsx:628` `<SummaryPanel />` — reused for the pre-fill review surface.
- Spec 3's revise-prior-answer flow — used unchanged for user overrides of pre-fills.
- Spec 3's `targetStateConversationStore.ts` — turn appending unchanged.
- Spec 4's `migrationDeliverySequencingResponseValidator.ts` — pattern for the hand-rolled validator of the pre-fill LLM response.
- PM task config + prompt files:
  - `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md`
  - `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md`
  - The matching `*.json` task config files (both get `target-tech-stack-context` added to `contextNeeds`).
- `fetchProjectFolder(projectId)` helper from `architectureModelClient.ts` — resolves the org root (called `project_parent_folder` in the AMS DTO).
- `fetchActiveTargetArchitectureId` — used by the new resolver to scope the file read.

## Visual Assets

No visual assets provided. No `planning/visuals/` folder exists in the spec directory.

## Audit Findings (critical context for spec-writer)

These were surfaced during shape-shaping and MUST land in the spec.md so the implementer has the full picture:

1. **The AMS Project DTO field `project_parent_folder` IS the organisation root, not the project's own folder.** The naming is misleading because it predates the org/project hierarchy. The org root = the folder ABOVE the project's own folder. Concretely:
   - Org-level tech-stack.md: `{project_parent_folder}/agent-os/product/tech-stack.md`
   - Project-level tech-stack.md: `{project_parent_folder}/{project.name}/agent-os/product/tech-stack.md`
   - Target-tech-stack output: `{project_parent_folder}/{project.name}/agent-os/product/target-tech-stack-<id>.md`

2. **The implementing service does NOT currently read `agent-os/product/tech-stack.md` directly.** It reads via `.claude/skills/global-tech-stack/SKILL.md` which points at `agent-os/standards/global/tech-stack.md` (the global standards template, NOT the product file). "Loop closure via implementing service" therefore needs a separate follow-up spec to update that Skill. **This is deferred per Q8.** PM prompts provide the indirect loop closure for v1 by consuming the new `target-tech-stack-context` resolver.

3. **There is NO `project_folder` column on the AMS Project entity today.** Per Follow-up A, the implementation uses `project.name` verbatim with path-traversal sanitisation (reject `..`, `/`, `\`). **No schema change in this spec.**

4. **Gateway already reads `tech-stack.md` at `{project_parent_folder}/agent-os/product/tech-stack.md`** via the existing `TechStackContextResolver`. The new pre-fill loader extends this with the additional project-level path but **does NOT modify the existing resolver** (per Follow-up E).

## Requirements Summary

### Functional Requirements

**Gateway-side tech-stack loader (new helper, two-file aware)**
- New helper, suggested location `gateway/src/services/architectConversation/techStackLoader.ts`.
- Signature: `loadTechStackMarkdown(projectId): Promise<{ orgMarkdown: string | null, projectMarkdown: string | null }>`.
- Reads BOTH paths:
  - Org-level: `{project_parent_folder}/agent-os/product/tech-stack.md`
  - Project-level: `{project_parent_folder}/{project.name}/agent-os/product/tech-stack.md`
- Tolerates both case variants for the filename per existing precedent.
- Returns `null` for whichever file is absent.
- Uses `fetchProjectFolder(projectId)` for the org root and `project.name` (from AMS Project DTO) for the project sub-folder.
- **Defensive sanitisation**: reject `project.name` values containing `..`, `/`, `\` — clean error from loader if encountered.
- **50K-char hard cap per file**: if either file exceeds the cap, truncate that file and signal a validation-failure-style banner variant.
- No parsing. Raw markdown strings returned.

**Pre-fill LLM call (single-shot)**
- New function, suggested location `gateway/src/services/architectConversation/prefillFromTechStack.ts`.
- Uses **new sibling adapter method** `ArchitectLlmClient.callSingleShot(prompt, responseSchema)` — no tool-calls, system + user prompt pair returning a JSON string the gateway parses + validates.
- Same mock seam as the existing tool-loop adapter.
- **Prompt input**:
  - Both org and project markdown (when present) as **labelled sections**: `## ORGANISATION STANDARDS` and `## PROJECT STANDARDS`. LLM is instructed to prefer project-level when both name the same standard.
  - The question library (51 decision codes + their prompts + `expectedAnswerShape`), filtered by **auto-skip running first** (pre-fill only attempts codes auto-skip declared relevant).
  - Brief project context: project name, currentArchitectureId, targetArchitectureId.
- **Prompt rules**:
  - "Strong connection" matching — file explicitly names the technology / version / pattern.
  - Bias toward unmatched when in doubt.
  - Never hallucinate.
  - Extract value verbatim from the file; cite the source row.
- **Response shape**:
  ```json
  {
    "preFilledAnswers": [
      { "decisionCode": "service.language", "value": "Java 21", "sourceQuote": "| Java | 21 (LTS) | ... |" }
    ],
    "unmatchedCodes": ["api.protocol", ...],
    "summary": "Matched 18 of 51 questions to entries in your tech-stack.md."
  }
  ```
- **Single shot covering all 51 questions** (no chunking).
- **Hand-rolled validator** (mirroring `migrationDeliverySequencingResponseValidator.ts`):
  - Every `decisionCode` in `preFilledAnswers` exists in the library and is NOT also in `unmatchedCodes`.
  - `value` is a non-empty string.
  - `sourceQuote` is a non-empty string and exists in the source markdown (loose contains-check after whitespace-normalising). Source lookup checks BOTH org and project markdown.
  - No duplicate `decisionCode` entries.
- Validation failure OR LLM call failure → no pre-fill rows written; banner shows the failure variant.

**Captured-decision row writes**
- Per-pre-fill row POSTed via Spec 2's existing endpoint.
- `created_by_task='tech-stack-md-prefill'` (single audit signal).
- `standardsLookupRef = null`.
- `scope_kind='architecture'` (always — pre-fills are architecture-wide by definition).
- `answer_value` carries structured JSON: `{"value": "Java 21", "sourceQuote": "..."}`.
- **Cascades from pre-fill matches**: pre-fill independently checks tech-stack.md for downstream codes; library cascade map is NOT auto-fired from pre-fill matches.
- **Partial failure**: abort remaining writes, surface partial-success banner, failed codes join the unmatched list.
- **Pre-fill auto-supersession**: never. Per-element exceptions coexist via Spec 2's narrower-scope-wins.

**Conversation orchestrator integration (at `open` turn)**
1. Append `open` turn (existing Spec 3 behaviour).
2. Load tech-stack.md via the new two-file loader.
3. Run auto-skip first — restrict pre-fill candidate codes to those auto-skip declared relevant.
4. If both files missing → append synthetic skip/system turn carrying "no tech standards found"; banner = no-standards variant; return.
5. If at least one file found → invoke the pre-fill LLM call.
6. For each `preFilledAnswer`: POST a captured-decision row via Spec 2's endpoint.
7. Append a single cascade-summary-shaped turn (or new dedicated turn kind — implementer's call) surfacing the pre-fill batch as a reviewable group.
- Pre-filled questions are NOT re-asked during the conversation.
- Unmatched codes are walked through normally.

**Frontend UI banner (three variants)**
- Architect Conversation tab gets a new banner at the top of the transcript pane or inline as the first turn after `open`.
- **Matched case**:
  - Both files found: `"X of 51 questions pre-filled from your tech standards (organisation: <orgFile>, project: <projFile>)"`
  - Only one found: `"X of 51 pre-filled from your <organisation/project> tech standards"`
- **No-standards case**: `"No tech standards found — all questions will be asked manually."`
- **Validation-failure / LLM-failure / oversized-truncation case**: `"Tech standards loaded but pre-fill could not run — all questions will be asked manually."` (no retry button in v1).
- Denominator is the **static library entry count (51)**.
- "Review" affordance opens the existing `<SummaryPanel />` from `ArchitectConversationTab.tsx:628`. Only new affordance is **source-quote display**.
- Source-quote text MUST NOT appear in the main transcript pane — only in the SummaryPanel review surface.
- User overrides via the existing revise-prior-answer flow. Override row gets `created_by_task='architect-persona-conversation'`; pre-fill row stays in the supersession chain.

**Conversation-close write of `target-tech-stack-<id>.md`**
- Written on `close` turn only (NOT on `open`).
- Path: `{project_parent_folder}/{project.name}/agent-os/product/target-tech-stack-<targetArchitectureId-lowercased>.md` (defensive sanitisation of `project.name`).
- **ALWAYS written** (no delta-detection short-circuit).
- **Deterministic gateway-side render** — no LLM call on close. Walks captured-decision rows, groups by some scheme (implementer's choice — keep human-readable), writes markdown tables.
- Content style: LLM-decided section grouping at close time, free-form, mirrors source style. (Note: "LLM-decided" here refers to the design choice of free-form mirroring; the actual render is deterministic per Q15. Implementer reconciles: deterministic render produces free-form structured markdown without invoking an LLM.)
- Per-element exceptions get their own row(s) with element id + exception value (per Spec 3's exception sub-dialog model).
- Each row optionally cites its source decision code as a markdown comment or footnote.
- Reopen → new pre-fill → next close re-writes the file.
- **Write-failure handling**: clean error + degraded close-turn payload (file path + size omitted; error surfaced).
- Close turn payload gains a new field indicating the target file was written (path + size).

**New gateway context resolver `target-tech-stack-context`**
- Registered in `KNOWN_CONTEXT_KEYS` under key `target-tech-stack-context`.
- **Project-folder-aware**: reads `{project_parent_folder}/{project.name}/agent-os/product/target-tech-stack-<id>.md`.
- Uses `fetchActiveTargetArchitectureId` (Spec 2 pattern).
- Same defensive `project.name` sanitisation as the loader.
- Returns raw markdown as prompt-ready text.
- If file missing: returns a distinct "no migration target tech stack written yet" message (distinguishes from empty / fetch-failed).
- Cached at the resolver level for a single LLM task invocation.

**PM task prompt + config updates**
- `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md` — add `target-tech-stack-context` to the consumed-context list. Existing prompt rules unchanged.
- `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md` — same addition. Prompt rules unchanged.
- Both `*.json` task config files get `target-tech-stack-context` added to their `contextNeeds` array.
- Complements Spec 2's existing `target-state-decisions-context` consumption.

**Cascades during conversation (post-pre-fill)**
- Library-only. Pre-fill already extracted what tech-stack.md offered; library cascade map fires for pre-fill-uncovered codes. No second LLM call for cascades.

**Backward compatibility**
- Hardcoded `standardsLookupResult` literal seed maps in `questionLibrary.ts` STAY in place as fallback for codes not covered by tech-stack.md.
- Pre-fill captured-decision rows use the new `created_by_task='tech-stack-md-prefill'` value but otherwise look identical to user-answered rows.

### Reusability Opportunities

- `ArchitectLlmClient` adapter: add new sibling method `callSingleShot(prompt, responseSchema)` next to existing tool-loop method. Same mock seam.
- `migrationDeliverySequencingResponseValidator.ts` pattern: copy for the pre-fill response validator.
- `<SummaryPanel />` in `ArchitectConversationTab.tsx:628`: reuse for the pre-fill review surface; only new affordance is source-quote display.
- Spec 2's revise-prior-answer flow: reuse unchanged for user overrides of pre-fills.
- Spec 2's resolver pattern using `fetchActiveTargetArchitectureId`: mirror for the new `target-tech-stack-context` resolver.
- Existing `TechStackContextResolver` is **not** touched but its path-reading conventions (case tolerance) are mirrored.
- `fetchProjectFolder(projectId)` used as today for the org root.

### Scope Boundaries

**In Scope:**
- Two-file `tech-stack.md` loader helper (org + project).
- Single-shot pre-fill LLM call with labelled-section prompting + validator.
- 50K-char per-file hard cap with banner variant on truncation.
- Auto-skip-first ordering before pre-fill.
- Pre-fill captured-decision row writes via Spec 2's POST endpoint.
- Three-variant pre-fill banner UI.
- Source-quote display in the reused `<SummaryPanel />`.
- Source-quote suppression in the main transcript pane (test covers this).
- Deterministic close-turn write of `target-tech-stack-<targetArchitectureId-lowercased>.md` at the project-level path.
- Defensive `project.name` sanitisation (reject `..`, `/`, `\`).
- New `target-tech-stack-context` resolver, project-folder-aware, registered in `KNOWN_CONTEXT_KEYS`.
- PM Book-of-Work + Shape-Spec prompt + config updates to consume the new resolver.
- Backend tests (4–8) and frontend tests (4–6) — all LLM mocked at `ArchitectLlmClient` boundary.

**Out of Scope:**
- New tech-stack.md schema or validation.
- A parser library for tech-stack.md.
- "Standard Combinations" section convention.
- Real-LLM regression testing.
- Mid-conversation reload of tech-stack.md.
- Delta-detection short-circuit for the target write (always written).
- Backfill of existing target architectures with target-tech-stack files (only new conversations get the file).
- Re-running the pre-fill on a manual re-open (each `open` turn runs its own; Spec 2's supersession-via-insert handles duplicates cleanly).
- Deletion or restructuring of `questionLibrary.ts` hardcoded seed maps (stay as fallback).
- Changes to the existing PM-task orchestration patterns (only prompt + config additions).
- A new `scope_kind` for "tech-stack" — pre-fills use `'architecture'` per Decision 5 of the raw idea.
- Validation that target-tech-stack.md is well-formed after the close write.
- **Implementing service touchpoint update** — deferred to a follow-up spec (per Q8 + audit finding 2). The follow-up updates `.claude/skills/global-tech-stack/SKILL.md` to layer in `target-tech-stack-<id>.md` when present. v1 closes the loop indirectly via the PM prompts.
- Modifications to the existing `TechStackContextResolver` (per Follow-up E).
- New `project_folder` column or any AMS schema change (per Follow-up A + audit finding 3).
- LLM-driven render at close time (close-turn render is deterministic per Q15).
- Retry button on pre-fill LLM failure (per Q19).
- Cross-request resolver cache (per-invocation only).
- Auto-firing the library cascade map from pre-fill matches (per Q21).

### Technical Considerations

- **Two-file path resolution** (audit findings 1, 3 + Follow-ups A, D, E, F):
  - `project_parent_folder` IS the organisation root (legacy naming).
  - Org file: `{project_parent_folder}/agent-os/product/tech-stack.md`
  - Project file: `{project_parent_folder}/{project.name}/agent-os/product/tech-stack.md`
  - Target file output: `{project_parent_folder}/{project.name}/agent-os/product/target-tech-stack-<lowercased-uuid>.md`
  - `project.name` MUST be sanitised before path concatenation (reject `..`, `/`, `\`).
- **Precedence** (Follow-up B): project-level wins over org-level row-by-row. Implemented by passing both to the LLM as labelled sections (`## ORGANISATION STANDARDS` / `## PROJECT STANDARDS`) with explicit ordering instructions.
- **Existing `TechStackContextResolver` is NOT modified** (Follow-up E). It continues to read only the org-level file for `chatV2.ts` and other existing flows.
- **Implementing-service loop closure is deferred** (Q8 + audit finding 2). The implementing service today reads via `.claude/skills/global-tech-stack/SKILL.md` → `agent-os/standards/global/tech-stack.md` (the global template). A follow-up spec updates that Skill. v1's loop closure is indirect via PM prompts that consume `target-tech-stack-context`.
- **Deterministic close-turn render** (Q15, Q16): no LLM call on close. Gateway walks captured-decision rows and renders markdown. Render output style mirrors the source `tech-stack.md` format but is generated by deterministic code, not an LLM. Reconcile with Q2's "LLM-decided section grouping at close time" by interpreting Q2 as a design choice for the output STYLE (free-form, source-mirroring), not a runtime LLM invocation — the implementer encodes the section grouping deterministically.
- **Filename**: `target-tech-stack-<uuid-lowercased>.md`. Apply `.toLowerCase()` defensively at write time.
- **LLM call**: single shot (`callSingleShot` adapter method) covering all 51 questions. No chunking. No retry button in v1.
- **Source-quote storage**: `answer_value` carries `{"value": "...", "sourceQuote": "..."}` JSON. No schema change to captured-decisions table.
- **Audit signals**: `created_by_task='tech-stack-md-prefill'` is the single signal (no `standardsLookupRef`, no separate override audit task value).
- **Banner denominator**: static library count of 51.
- **Partial-failure semantics**: abort remaining writes, banner shows partial-success, failed codes join unmatched list.
- **Auto-skip-first**: pre-fill only attempts codes auto-skip declared relevant (per Q13).
- **Cascades**: library-only post-pre-fill (per Q7); pre-fill itself independently checks tech-stack.md for downstream codes (per Q21).
- **Resolver caching**: per-invocation only (no cross-request cache).
- **All LLM mocked** at the `ArchitectLlmClient` boundary in tests.

### Verification

After this spec:
- Architect Conversation tab loads BOTH tech-stack.md files (org + project) once at conversation `open`; if at least one present, surfaces a pre-fill banner with the correct variant text and matched count.
- Auto-skip-relevant pre-filled questions are NOT re-asked during the conversation.
- The user can review pre-fills in the reused `<SummaryPanel />` with source quotes; source quotes do NOT leak into the main transcript pane.
- User overrides via Spec 3's revise-prior-answer flow; override row `created_by_task='architect-persona-conversation'`; pre-fill row remains in the supersession chain.
- On conversation close, `{project_parent_folder}/{project.name}/agent-os/product/target-tech-stack-<targetArchitectureId-lowercased>.md` is ALWAYS written, deterministically rendered, human-readable.
- PM Book of Work + Shape-Spec tasks pick up the new `target-tech-stack-context` resolver alongside Spec 2's `target-state-decisions-context`.
- The existing library `defaultsWhenUnchanged` + `cascades.standardsLookupResult` fallback still works when both tech-stack.md files are absent.
- Existing `TechStackContextResolver` and `chatV2.ts` behaviour is unchanged.
- Implementing-service direct-read of the new file is deferred to a follow-up spec; v1 loop closure flows through PM prompts.

### Commit Boundary

One commit covering:
- Two-file `techStackLoader.ts` helper.
- `prefillFromTechStack.ts` LLM-call + validator.
- New `ArchitectLlmClient.callSingleShot` sibling adapter method.
- Orchestrator integration at the `open` turn path (auto-skip-first, then pre-fill).
- Conversation-close write of `target-tech-stack-<id>.md` at the project-level path with `project.name` sanitisation.
- New `target-tech-stack-context` resolver registration in `KNOWN_CONTEXT_KEYS`.
- PM prompt + JSON config additions.
- Frontend banner (three variants) + reuse of `<SummaryPanel />` for source-quote display.
- Backend tests (4–8) and frontend tests (4–6).

The implementing-service `.claude/skills/global-tech-stack/SKILL.md` update is a separate follow-up spec (per Q8) and is NOT part of this commit.

### Dependencies

- Specs 1–4 + the hardening pass — all shipped + committed.
- `2026-05-22-architecture-scope-via-parent-not-leaf` — already shipped (parent-chain semantics for captured-decision scoping).
- Existing `tech-stack.md` consumption pattern in `chatV2.ts` / `projectSignals.ts` / `contextResolvers.ts` — provides file-path + case-tolerance precedent.
- Existing `targetStateCapturedDecisionsClient.ts.postCapturedDecision` — pre-fills POST through this.
- Existing `targetStateConversationStore.ts` — turn appending unchanged.
- Existing `ArchitectLlmClient` adapter from Spec 3 — extended with new `callSingleShot` sibling method.
- Existing `<SummaryPanel />` in `ArchitectConversationTab.tsx:628` — reused for the review surface.
- AMS Project DTO providing `project.name` and `project_parent_folder` (the latter being the org root, per audit finding 1).
