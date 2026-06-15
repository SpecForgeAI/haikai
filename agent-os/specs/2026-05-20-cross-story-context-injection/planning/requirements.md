Today the migration shape-spec generator sees each story in isolation. This feature adds cross-story context injection so the generator can see relevant sibling stories, parent epic/feature/initiative rollup, workstream-level dedupe (API baselines, architecture refs), and an epic-level "captured decisions" artifact. The goal is meaningfully higher spec quality without context overload.

Working assumptions (already agreed with user, treat as decisions unless a real product question arises):

1. Sibling spec text: injected but SUMMARIZED (decisions + interfaces + assumptions sections only), never verbatim. Drops implementation steps to control token budget.

2. Parent rollup: bounded. Epic = title + description + captured decisions. Feature/initiative = title + 1-sentence summary only. No deeper text.

3. Workstream-level dedupe: API baselines and architecture refs are emitted ONCE at workstream level, not duplicated per story.

4. Generation order: dependency-ordered batching. Since dependency hints (Wave 2 #5) is not yet built, fallback is book-of-work sequence order (parents-before-children, declared order within feature).

5. Two-pass generation with hard cap:
   - Pass 1: generate all with parent + workstream context only (no sibling specs).
   - Pass 2: regenerate with sibling-spec context derived from pass 1 outputs.
   - NEVER a pass 3 -- this is the loop guardrail. User can manually trigger more rounds if they want.

6. Token budget: fixed envelope with tiered trimming. Per-story context capped (top-N evidence refs by relevance); cross-story has a separate budget. If budget exceeds: trim sibling specs first, then per-story evidence, never the story description itself.

7. Epic-level captured decisions: persist as a new artifact (e.g., epic_captured_decisions table or column). Editable, auditable, not re-derived from spec text each time. Stories READ from it during generation; pass-2 generation CONTRIBUTES to it.

8. Pass-2 trigger: AUTO-RUN by default immediately after pass 1 completes. Config flag exists to disable auto-run, in which case pass-2 surfaces as a manual "Regenerate with sibling context" action.

Out of scope:
- Building dependency hints (that is Wave 2 #5).
- Building missing-input resolver (Wave 2 #1).
- In-product spec editor (Wave 2 #3).
- Quality scoring beyond what exists (Wave 2 #6).
- More than 2 generation passes.

Services touched:
- gateway (new pass-2 task or extension of existing batch task)
- architecture-model-service (persistence + context resolver enrichment)
- frontend (pass-2 status, auto-run config UI, epic-decisions panel)
- mcp-server only if existing spec artifact storage needs extension

Inputs already consumed today (must continue to work):
- GeneratedMigrationBookOfWork
- Saved WorkItems
- Migration Discovery Context
- Focused migration context per story
- Current/Target architecture
- Discovery findings/evidence
- API Behaviour Baselines
- OAS / WSDL contracts
- ArchitectureElementMappings
- WorkItemImplementWorkspace where present

Additional inputs this feature adds:
- Sibling story summaries (within same parent feature OR epic)
- Parent epic captured decisions (new artifact)
- Workstream-level deduped API baselines / architecture refs

Key user-facing behaviour:
- "Generate specs for all stories" now produces a two-pass result.
- Each story shows which pass produced its current spec (pass 1 vs pass 2).
- Pass-2 spec changes are diff-able against pass 1 so user can see what cross-story context actually moved.
- Per-batch summary shows context-budget usage so user understands if trimming kicked in.
- Epic-level captured decisions panel is viewable/editable from the dashboard or epic detail.

Loop guardrails (must be enforced):
- Hard cap at 2 passes per "Generate all" invocation.
- Pass 2 reads pass 1 spec text from persistence; it must not depend on pass 2 outputs from other stories (to prevent fan-out re-trigger loops).
- If a story's pass-1 status is failed or insufficient_context, pass 2 may retry, but the pass-1 output is NOT used as sibling context for other stories.

Confidence / status reporting:
- Each generated spec now carries `generation_pass` (1 or 2).
- Confidence calculation extended to consider cross-story signal (e.g., sibling spec contradicts current decision -> lower confidence; epic decision matches -> higher confidence).
- New warnings: "context budget exceeded, trimmed N sibling specs", "no sibling specs available for pass 2".

Context resolver responsibilities (architecture-model-service):
- POST /api/projects/{projectId}/migration-spec-context already exists; extend with:
  - sibling_summaries: [{ workItemId, title, decisions[], interfaces[], assumptions[] }]
  - parent_rollup: { epic: { title, description, capturedDecisions[] }, feature: {...}, initiative: {...} }
  - workstream_context: { apiBaselines[], architectureRefs[] }  -- this is the deduped block
  - budget_meta: { used_tokens, max_tokens, trimmed: { sibling_specs_dropped: N, evidence_refs_dropped: M } }

Frontend additions:
- Pass-2 indicator badge in batch results table and story detail drawer.
- "Auto-run pass-2" toggle in batch controls (default ON).
- Epic-decisions panel (read + edit) accessible from dashboard / epic detail.
- Context-budget warning surfaced inline when trimming occurred.

---

## Visual assets

No visual assets were provided by the user for this spec. The
`planning/visuals/` folder is empty. Spec-writer should design without
reference mockups.

---

## Confirmed product decisions (from clarifying answers)

The 10 clarifying questions in `planning/clarifying-questions.md` were resolved
by the user confirming all of the recommended defaults verbatim. Full text in
`planning/clarifying-answers.md`. Summary of the resulting decisions:

1. **Epic-decisions panel placement.** Dedicated panel on the epic detail page
   (primary edit surface) AND a read-only collapsed summary on the dashboard /
   batch-results view.

2. **Epic captured decisions initial population.** Auto-seed from pass-1 specs
   via LLM extraction. Each auto-seeded entry tagged with
   `source: auto-extracted from spec X, unedited` so the user can curate.

3. **Pass-1 vs pass-2 diff presentation.** Inline diff (red/green highlights
   inside the spec text) PLUS a short auto-generated "what changed and why"
   summary at the top citing the sibling spec / epic decision that caused each
   change.

4. **Sibling-spec decisions/interfaces/assumptions extraction.** Parse at write
   time using a regex / heading parser against the shape-spec template's stable
   headings. Store as structured fields alongside the spec text. No LLM
   extraction at read time; no JSON-alongside-markdown emission requirement.

5. **Auto-run config flag exposure.** Two surfaces, no env var: (a) per-project
   persisted setting, (b) per-batch toggle in the "Generate all" dialog that
   defaults to the project setting but can be overridden for the current run.

6. **Pass-2 confidence drop due to sibling contradiction.** Flag the story for
   review with a "contradicts sibling X" warning, KEEP the pass-2 output in
   place. Never auto-rollback. Warning is loud; user always sees latest
   reasoning.

7. **Workstream-level dedupe visibility.** Expandable "Workstream context"
   section at the top of the batch-results view listing deduped items (API
   baselines, architecture refs) and which stories would otherwise have
   referenced them. No per-story drawer backlinks required.

8. **Concurrency / re-entry.** Disable "Generate all" while a batch (pass 1 or
   pass 2) is active for the same workstream; show "Batch in progress" status.
   User must cancel the active batch to re-trigger. No queueing, no fail-fast
   error.

9. **Pass-2 cost preview.** Show estimated tokens + rough wall-clock time up
   front in the "Generate all" dialog, AND show actuals in the post-batch
   summary.

10. **Pass-2 "no meaningful change" signal.** Show a "Pass 2: no meaningful
    change" badge on the story row plus the confidence delta. Do not hide
    pass-2 status when nothing moved - users need to see the pass executed.
