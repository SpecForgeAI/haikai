# Clarifying Questions: Cross-Story Context Injection

The 8 working assumptions in `requirements.md` are treated as decided and are NOT
re-litigated here. These questions cover only the genuinely open product
questions the assumptions do not answer.

---

1. **Epic-decisions panel placement.** Where should the epic-level "captured
   decisions" panel live? My assumption is a dedicated panel on the epic detail
   page (primary edit surface) plus a read-only collapsed summary on the
   dashboard / batch-results view so users see decisions without leaving the
   generate flow. Is that right, or do you want only one of those locations
   (e.g. epic detail only, or a new dedicated "decisions workspace")?

2. **How epic captured decisions get populated initially.** Two options:
   (a) auto-seed from pass-1 specs - the LLM extracts candidate decisions during
   pass 1 and writes them to the epic artifact, user curates afterwards;
   (b) only created via explicit user curation / explicit "promote to epic
   decision" action on a sibling story decision. My assumption is (a)
   auto-seed with a clear "source: auto-extracted from spec X, unedited" flag
   so the user can confirm or edit. Confirm or pick (b)?

3. **Pass-1 vs pass-2 diff presentation.** How should the user see what
   cross-story context actually changed in pass 2? My assumption is an inline
   diff view (red/green highlights inside the spec text) plus a short
   auto-generated "what changed and why" summary at the top citing the sibling
   spec / epic decision that caused each change. Alternative: side-by-side
   two-column view, or just a summary with no per-line diff. Which do you
   prefer?

4. **Sibling-spec decisions/interfaces/assumptions extraction.** The shape-spec
   output today is a single markdown blob. How should we extract the
   decisions/interfaces/assumptions sections for sibling context injection?
   Options: (a) regex / heading parser at write time, stored as structured
   fields alongside the spec text; (b) LLM extraction at read time (every time
   pass 2 runs); (c) require the shape-spec generator to emit structured JSON
   alongside the markdown. My assumption is (a) parse at write time into
   structured fields - cheap, deterministic, and the shape-spec template
   already uses stable headings. OK?

5. **Auto-run config flag exposure.** The assumption fixes that pass-2 auto-runs
   by default with a config flag to disable. How is that flag exposed? My
   assumption is two surfaces: (a) per-project setting in project config
   (persisted), and (b) a per-batch toggle in the "Generate all" dialog that
   defaults to the project setting but can be overridden for this run. No env
   var. Confirm, or do you also want an env-var fallback for ops?

6. **Pass-2 lowers confidence due to sibling contradiction - what does the UI
   do?** Options: (a) flag the story for review with a "contradicts sibling X"
   warning and leave the pass-2 output in place; (b) auto-rollback to pass-1
   output and surface the conflict; (c) keep pass-2 but show both pass-1 and
   pass-2 side-by-side and let the user pick. My assumption is (a) flag for
   review, keep pass-2, never auto-rollback - user always sees the latest
   reasoning, warning is loud. Confirm?

7. **Workstream-level dedupe visibility.** When API baselines and architecture
   refs get hoisted to workstream level, how does the user discover that
   placement? My assumption is a "Workstream context" expandable section at
   the top of the batch results view that lists the deduped items and which
   stories would otherwise have referenced them. Is a banner / expandable
   section enough, or do you want each story drawer to also show "see
   workstream context" backlinks?

8. **Concurrency / re-entry.** If a user clicks "Generate all" while a previous
   batch (pass 1 or pass 2) is still in flight for the same workstream, what
   should happen? My assumption is: disable the button while a batch is
   active and show "Batch in progress" status; if the user really needs to
   re-trigger they cancel the active batch first. Alternative: queue the
   new batch, or fail-fast with an error. Which?

9. **Pass-2 cost preview.** Pass 2 roughly doubles LLM token usage for a batch.
   Should the "Generate all" dialog show an estimated cost / token usage /
   wall-clock before kicking off, or just run silently and report actuals
   afterwards? My assumption is show an estimate up front (tokens + rough
   time) AND show actuals in the post-batch summary, since this is the user's
   first opportunity to disable auto-run for a heavy batch.

10. **Pass-2 "no meaningful change" signal.** When pass 2 reruns but produces
    essentially the same spec (no contradictions, no new sibling info that
    matters), what's the user signal? My assumption is a "Pass 2: no
    meaningful change" badge on the story row (so the user knows pass 2 ran
    and was a no-op) plus the confidence delta. Alternative: hide it
    entirely and only show pass-2 badge when something actually moved.
    Which?

---

**Visual Assets Request:**

Do you have any design mockups, wireframes, or screenshots that could help
guide the development? In particular:

- Current "Generate all" batch flow / dashboard so I can see where pass-2
  indicators, auto-run toggle, and context-budget warnings should sit.
- Current epic detail page (if any) so I can see where the captured-decisions
  panel should attach.
- Any sketches of the diff view or epic-decisions edit surface.

If yes, please place them in:
`agent-os/specs/2026-05-20-cross-story-context-injection/planning/visuals/`

Use descriptive filenames like:
- generate-all-current-flow.png
- epic-detail-current.png
- pass2-diff-sketch.png
- epic-decisions-panel-wireframe.png
- batch-results-with-budget-warning.png

Please answer the questions above and let me know if you've added any visual
files.
