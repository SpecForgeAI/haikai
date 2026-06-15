# Clarifying Questions: Spec Quality Scoring

The 10 working assumptions in `requirements.md` are treated as decided and are
NOT re-litigated here. These questions cover only the genuinely open product
questions the assumptions do not answer.

---

1. **Dimension weights for v1.** The five dimensions are fixed, but how should
   they weight into the 0-100 composite? My assumption is COMPLETENESS 30,
   ACCEPTANCE-CRITERIA MEASURABILITY 25, IMPLEMENTATION CONCRETENESS 20,
   EVIDENCE DENSITY 15, SIBLING/PARENT ALIGNMENT 10 - completeness and AC
   measurability are the strongest "is this spec actually usable?" signals,
   alignment is a tie-breaker rather than a primary driver. Confirm, or do
   you want a different mix (e.g. equal 20/20/20/20/20)?

2. **Grade thresholds.** Working assumption already pins A >= 85, B 70-84,
   C 55-69, D 40-54, F < 40. My recommendation is to keep these exactly as
   stated - they map cleanly to "ship it / minor gaps / needs work / weak /
   broken". Confirm we use the exact bands above, or do you want one nudge
   (e.g. A >= 90 to make A scarcer)?

3. **Color palette for grade chips.** My assumption is a five-step ramp:
   A = green (success), B = teal/light-green, C = amber, D = orange,
   F = red - matches the existing confidence pill ramp so users read both
   chips the same way. Confirm, or do you want a more conservative two-tone
   (green for A/B, amber for C, red for D/F)?

4. **Reason-string format per dimension.** Each dimension stores one reason
   string in `quality_dimensions_json`. My assumption is a terse, templated
   phrase like `"4/7 expected sections present; missing: tests, files
   affected"` or `"2 evidence refs across 850 words; below density floor"` -
   human-readable but generated from the same rule that produced the score,
   not free-form prose. Confirm, or do you want a structured object
   (`{rulesFailed: [...], rulesPassed: [...]}`) for programmatic
   consumption later?

5. **Bulk recompute endpoint scope.** Project-wide bulk recompute is already
   agreed. My assumption is v1 ships ONLY project-wide (one button, one
   endpoint, recomputes every persisted spec in the project) - no filtering
   by grade, status, or workstream. Filterable bulk recompute can come later
   if users actually need it. Confirm project-wide-only for v1, or do you
   want grade-range filtering on day one?

6. **"Recompute quality score" button placement in the drawer.** My
   assumption is a small icon button in the "Quality breakdown" section
   header (right-aligned, next to the section title), with a tooltip
   "Recompute quality score" - keeps it discoverable but doesn't compete
   with the primary "Regenerate spec" action. Confirm, or do you want it
   adjacent to the existing regenerate button instead?

7. **Filter UI shape on the dashboard.** My assumption is a multi-select
   chip group (A / B / C / D / F) so users can express "show me C and D" in
   one click - matches how the existing status filter already works.
   Alternative: single-select dropdown with ranges ("A only", "B and above",
   "C and below"). Which?

8. **Delta chip threshold.** Working assumption #9 says "show delta chip
   when grade letter changes". My recommendation is to stick with
   letter-change-only - any numeric move (e.g. 72 -> 74, both B) is noise
   and would flicker on every regenerate. Confirm grade-letter-change only,
   or do you also want a subtler indicator when the numeric score moves
   by, say, 10+ points within the same letter?

9. **Confidence-vs-score disagreement indicator.** Score and LLM confidence
   coexist; disagreement is signal. My assumption is a small "!" badge on
   the grade chip when there's a meaningful disagreement (LLM says HIGH but
   grade is C/D/F, or LLM says LOW but grade is A/B), with the drawer
   spelling out which way it disagrees. Confirm, or do you prefer the
   disagreement to surface only inside the drawer breakdown (no chip-level
   badge)?

10. **Score on `insufficient_context` / `failed` rows.** These rows have no
    usable spec text. My assumption is we SKIP scoring entirely - store
    `quality_score = null`, `quality_grade = null`, render an "N/A" chip
    on the hierarchy node. Computing zero would falsely lump them in with
    F-graded specs that do have content. Confirm skip + N/A, or do you
    want them computed as zero so the F-or-below filter catches them too?

---

**Visual Assets Request:**

Do you have any design mockups, wireframes, or screenshots that could help
guide the development? In particular:

- Current dashboard hierarchy node so I can see where the grade chip sits
  relative to the existing status / confidence chips.
- Current story drawer layout so I can place the "Quality breakdown"
  section and the recompute button correctly.
- Any sketch of how the per-dimension breakdown should read (table?
  vertical list with per-row score + reason?).

If yes, please place them in:
`agent-os/specs/2026-05-20-spec-quality-scoring/planning/visuals/`

Use descriptive filenames like:
- hierarchy-node-current.png
- story-drawer-current.png
- quality-breakdown-sketch.png
- grade-chip-placement.png

Please answer the questions above and let me know if you've added any visual
files.
