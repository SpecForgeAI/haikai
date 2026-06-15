# Clarifying Answers: Spec Quality Scoring

All 10 recommended defaults from `clarifying-questions.md` were confirmed by the
user verbatim. Recorded below in the same order for direct consumption by the
spec-writer.

---

## 1. Dimension weights for v1

**Confirmed:**
- COMPLETENESS = 30
- ACCEPTANCE-CRITERIA MEASURABILITY = 25
- IMPLEMENTATION CONCRETENESS = 20
- EVIDENCE DENSITY = 15
- SIBLING / PARENT ALIGNMENT = 10

Composite = weighted average of the five sub-dimension scores (each capped
0-100) using the weights above. COMPLETENESS and AC MEASURABILITY are the
strongest "is this spec actually usable?" signals; ALIGNMENT acts as a
tie-breaker rather than a primary driver.

## 2. Grade thresholds

**Confirmed:** Use the bands exactly as stated.
- A >= 85
- B 70-84
- C 55-69
- D 40-54
- F < 40

## 3. Color palette for grade chips

**Confirmed:** Five-step ramp matching the existing confidence pill ramp so
users read both chips the same way.
- A = green (success)
- B = teal / light-green
- C = amber
- D = orange
- F = red

## 4. Reason-string format per dimension

**Confirmed:** Terse, templated, human-readable phrase generated from the same
rule that produced the score. Not free-form prose, not a structured object.

Examples:
- `"4/7 expected sections present; missing: tests, files affected"`
- `"2 evidence refs across 850 words; below density floor"`

One reason string per dimension, stored inside `quality_dimensions_json` as
`{dimension, score, reason}`.

## 5. Bulk recompute endpoint scope

**Confirmed:** Project-wide ONLY for v1.

- One button, one endpoint.
- Recomputes every persisted spec in the project.
- No filtering by grade, status, or workstream.
- Filterable bulk recompute can come later if there is real demand.

## 6. "Recompute quality score" button placement in the drawer

**Confirmed:** Small icon button in the "Quality breakdown" section header,
right-aligned, next to the section title, with a tooltip
`"Recompute quality score"`.

Discoverable but does not compete with the primary "Regenerate spec" action.

## 7. Filter UI shape on the dashboard

**Confirmed:** Multi-select chip group (A / B / C / D / F).

Matches how the existing status filter already works. Users can express
"show me C and D" in one click.

## 8. Delta chip threshold

**Confirmed:** Letter-change-only.

- Show the delta chip in the drawer only when the grade letter changes.
- Numeric moves within the same letter (e.g. 72 -> 74, both B) are
  considered noise and intentionally suppressed.

## 9. Confidence-vs-score disagreement indicator

**Confirmed:** Small `"!"` badge on the grade chip when there is a meaningful
disagreement between LLM confidence and rules-based grade.

Meaningful disagreement is defined as:
- LLM says HIGH but grade is C / D / F, OR
- LLM says LOW but grade is A / B.

The drawer breakdown spells out which direction the disagreement runs.

## 10. Score on `insufficient_context` / `failed` rows

**Confirmed:** Skip scoring entirely.

- `quality_score = null`
- `quality_grade = null`
- Render an `"N/A"` chip on the hierarchy node.
- Do NOT compute zero. Falsely lumping these in with F-graded specs that do
  have content would be misleading; `"N/A"` is the correct visible state.

---

## Visual assets

No visual assets were provided in
`agent-os/specs/2026-05-20-spec-quality-scoring/planning/visuals/` at the time
these answers were confirmed.
