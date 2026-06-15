# Clarifying Answers: Cross-Story Context Injection

All 10 recommended defaults from `clarifying-questions.md` were confirmed by the
user without modification. This file records each confirmed answer verbatim so
the spec-writer can use it directly as the source of truth.

---

## 1. Epic-decisions panel placement

**Decision:** A dedicated panel on the epic detail page (primary edit surface)
PLUS a read-only collapsed summary on the dashboard / batch-results view so
users see decisions without leaving the generate flow.

---

## 2. How epic captured decisions get populated initially

**Decision:** Option (a) - auto-seed from pass-1 specs. The LLM extracts
candidate decisions during pass 1 and writes them to the epic artifact. Each
auto-seeded entry carries a clear `source: auto-extracted from spec X, unedited`
flag so the user can confirm or edit. User curation happens afterwards.

---

## 3. Pass-1 vs pass-2 diff presentation

**Decision:** Inline diff view (red/green highlights inside the spec text) PLUS
a short auto-generated "what changed and why" summary at the top citing the
sibling spec / epic decision that caused each change.

---

## 4. Sibling-spec decisions/interfaces/assumptions extraction

**Decision:** Option (a) - parse at write time using a regex / heading parser
against the shape-spec template's stable headings. Extracted decisions,
interfaces, and assumptions are stored as structured fields alongside the spec
text. Cheap, deterministic, no re-extraction per pass-2 run.

---

## 5. Auto-run config flag exposure

**Decision:** Two surfaces, no env var:
- (a) Per-project setting in project config (persisted).
- (b) Per-batch toggle in the "Generate all" dialog. Defaults to the project
  setting; can be overridden for this run.

---

## 6. Pass-2 lowers confidence due to sibling contradiction

**Decision:** Option (a) - flag the story for review with a "contradicts sibling
X" warning and leave the pass-2 output in place. Never auto-rollback. User
always sees the latest reasoning; the warning is loud.

---

## 7. Workstream-level dedupe visibility

**Decision:** A "Workstream context" expandable section at the top of the batch
results view that lists the deduped items (API baselines, architecture refs)
and which stories would otherwise have referenced them. No per-story drawer
backlinks required for this iteration.

---

## 8. Concurrency / re-entry

**Decision:** Disable the "Generate all" button while a batch (pass 1 or pass 2)
is active for the same workstream, and show "Batch in progress" status. To
re-trigger, the user must cancel the active batch first. No queueing, no
fail-fast error.

---

## 9. Pass-2 cost preview

**Decision:** Show an estimate up front in the "Generate all" dialog (tokens +
rough wall-clock time) AND show actuals in the post-batch summary. This is the
user's first chance to disable auto-run for a heavy batch.

---

## 10. Pass-2 "no meaningful change" signal

**Decision:** Show a "Pass 2: no meaningful change" badge on the story row so
the user knows pass 2 ran and was a no-op, plus the confidence delta. Do NOT
hide pass-2 entirely when nothing moved - users need to see that the pass
executed.

---

## Visual assets

No visual assets were provided by the user for this spec. Spec-writer should
design without reference mockups.
