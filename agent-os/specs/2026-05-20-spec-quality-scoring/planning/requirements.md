Today's spec generation classifies output with two coarse hard-rule signals: status (`generated` / `generated_with_warnings` / `insufficient_context` / `failed` / `skipped_blocked`) and confidence (`high` / `medium` / `low`). Both hide too much — "medium confidence" could be a strong spec with one missing baseline or a weak spec with three assumptions and one acceptance criterion.

This feature layers a richer, deterministic, rules-based quality score on top: 0-100 internal value mapped to an A-F letter grade for display. Score is composed from 5 sub-dimensions, each capped 0-100, weighted into the final number. The score is the system's independent assessment of the spec — distinct from the LLM's self-reported confidence. They coexist; disagreement is itself useful signal.

This is the highest-leverage quality-visibility feature in Wave 2: it gives users a single glanceable answer to "how good is this spec?" without requiring them to open the drawer.

Working assumptions (already agreed with user, treat as decided unless a real product question arises):

1. Score representation: 0-100 internal score mapped to letter grade A-F (A ≥ 85, B 70-84, C 55-69, D 40-54, F < 40).
2. Score composition: weighted average of sub-dimension scores. Each capped 0-100.
3. Dimensions in v1 (exactly five):
   (a) COMPLETENESS — expected sections present (decisions, interfaces, assumptions, ACs, tests, evidence refs, files affected). Detected via existing ShapeSpecHeadingParser.
   (b) EVIDENCE DENSITY — evidence-ref count vs spec length.
   (c) IMPLEMENTATION CONCRETENESS — references to specific files/modules/classes/operation identifiers vs vague placeholders.
   (d) ACCEPTANCE-CRITERIA MEASURABILITY — observable outcomes (numbers, named states, concrete responses) vs vague "works correctly".
   (e) SIBLING / PARENT ALIGNMENT — penalty for contradicts_sibling warnings; bonus for aligned_with_epic_decision warnings.
4. Where scoring runs: AMS at persist time. Score is a stable column on migration_story_spec_generations.
5. Algorithm: DETERMINISTIC rules-based in v1 (regex + count + section parsing). No LLM.
6. Relationship to existing confidence: COEXIST. Confidence stays the LLM's self-reported h/m/l. Score is the system's independent assessment. Disagreement is itself signal.
7. Surfacing: per-story grade chip on dashboard hierarchy node; story drawer expanded breakdown (per-dimension score + one-sentence reason); dashboard grade-range filter.
8. Recomputation: at persist time (every generation) plus on-demand button. No LLM. Project-wide bulk recompute is a separate manual endpoint.
9. History / trend: store previous_quality_score on row when overwriting. Show delta chip in drawer when grade letter changes. No separate history table.
10. Threshold-based actions: NONE in v1. Signal-only.

Out of scope:
- LLM-graded scoring
- Score-based blocking
- Required-review gates
- Full history table
- Per-project configurable weights
- Custom dimension definitions
- Separate quality dashboard page

Services touched:
- architecture-model-service: new persistence columns (quality_score, quality_grade, quality_dimensions_json, previous_quality_score); new SpecQualityScorer service; persist-time hook in MigrationStorySpecGenerationService.persistOne; new endpoints for single-story and project-wide bulk recompute; extend MigrationDeliveryHierarchyNodeDto with qualityGrade.
- gateway: thin proxy routes. No LLM.
- frontend: per-story grade chip on hierarchy node; drawer "Quality breakdown" section with five dimensions; "Recompute quality score" button; dashboard grade-range filter.

Inputs: generated_spec_text; structured decisions/interfaces/assumptions arrays from ShapeSpecHeadingParser; warnings_json (contradicts_sibling, aligned_with_epic_decision); story title.

Outputs: quality_score (Integer 0-100); quality_grade (String A-F); quality_dimensions_json (list of {dimension, score, reason}); previous_quality_score (Integer nullable).

## Confirmed product decisions (from clarifying answers)

All 10 recommended defaults in `planning/clarifying-questions.md` were confirmed by the user verbatim on 2026-05-20. These are additive to (not replacing) the 10 working assumptions above. Full details and templated examples live in `planning/clarifying-answers.md`.

1. **Dimension weights:** COMPLETENESS 30, ACCEPTANCE-CRITERIA MEASURABILITY 25, IMPLEMENTATION CONCRETENESS 20, EVIDENCE DENSITY 15, SIBLING / PARENT ALIGNMENT 10. Composite = weighted average of the five sub-dimension scores (each capped 0-100).
2. **Grade thresholds:** Use the exact bands already pinned — A >= 85, B 70-84, C 55-69, D 40-54, F < 40.
3. **Grade chip colors:** Five-step ramp matching the existing confidence pill ramp — A green, B teal/light-green, C amber, D orange, F red.
4. **Reason-string format:** Terse, templated, human-readable phrase per dimension, generated from the same rule that produced the score (e.g. `"4/7 expected sections present; missing: tests, files affected"`). Not free-form prose, not a structured rulesFailed/rulesPassed object. Stored inside `quality_dimensions_json` as `{dimension, score, reason}`.
5. **Bulk recompute scope:** Project-wide ONLY for v1 — one button, one endpoint, recomputes every persisted spec in the project. No filtering by grade, status, or workstream.
6. **Drawer recompute button placement:** Small icon button in the "Quality breakdown" section header, right-aligned next to the section title, tooltip `"Recompute quality score"`. Does not compete with the primary "Regenerate spec" action.
7. **Dashboard filter UI:** Multi-select chip group across A / B / C / D / F, matching the existing status filter pattern. Users can express "show me C and D" in one click.
8. **Delta chip threshold:** Letter-change-only. Numeric moves within the same letter (e.g. 72 -> 74, both B) are intentionally suppressed as noise. Show the delta chip in the drawer only when the grade letter changes.
9. **Confidence-vs-score disagreement:** Small `"!"` badge on the grade chip when LLM confidence and rules-based grade meaningfully disagree — specifically LLM HIGH with grade C/D/F, or LLM LOW with grade A/B. The drawer breakdown spells out which direction the disagreement runs.
10. **`insufficient_context` / `failed` rows:** Skip scoring entirely — `quality_score = null`, `quality_grade = null`, render an `"N/A"` chip on the hierarchy node. Do NOT compute zero; that would falsely lump these in with F-graded specs that do have content.

## Visual assets

No visual assets were provided in `agent-os/specs/2026-05-20-spec-quality-scoring/planning/visuals/` at the time clarifying answers were confirmed (folder absent or empty per bash check on 2026-05-20). Visual decisions in this spec are therefore driven by:
- the existing confidence pill ramp (for grade chip colors),
- the existing status filter chip group (for the dashboard filter pattern),
- the existing story drawer section layout (for the "Quality breakdown" section and its recompute icon button).
