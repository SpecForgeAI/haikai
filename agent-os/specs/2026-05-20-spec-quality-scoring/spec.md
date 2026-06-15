# Specification: Spec Quality Scoring

## Goal
Layer a deterministic, rules-based 0-100 quality score (mapped to an A-F grade) on top of every persisted migration-story spec generation so users get a single glanceable answer to "how good is this spec?" alongside the existing status / confidence chips.

## User Stories
- As a Product Manager scanning the Migration Delivery Dashboard hierarchy, I want a per-story grade chip so I can spot weak specs without opening each drawer.
- As a Product Manager reviewing a single story, I want a five-dimension quality breakdown in the drawer so I can see exactly which aspect (completeness, AC measurability, concreteness, evidence, alignment) dragged the grade down.
- As a Product Manager catching up an existing project, I want a one-click project-wide recompute so legacy spec rows get backfilled with grades after deploy.

## Specific Requirements

**Persistence: new columns on migration_story_spec_generations (Liquibase changeset 153+)**
- `quality_score` SMALLINT NULL, CHECK between 0 and 100
- `quality_grade` VARCHAR(1) NULL, CHECK IN ('A','B','C','D','F')
- `quality_dimensions_json` JSONB NULL, holding a list of `{dimension, score, reason}`
- `previous_quality_score` SMALLINT NULL, CHECK between 0 and 100 — single immediately-previous value only, no history table
- Entity fields are boxed types (`Integer`, `String`, `List<Map<String,Object>>`) so PATCH semantics preserve null per `project_primitive_double_dto_overwrite.md`
- All four columns are nullable so existing rows pre-deploy and `insufficient_context` / `failed` rows after deploy can carry NULL legitimately

**SpecQualityScorer Spring component (AMS)**
- New `SpecQualityScorer` component, deterministic, pure-Java, no LLM calls
- Input record: `{ specText, decisionsList, interfacesList, assumptionsList, warningsList, storyTitle }`
- Output record: `{ score (0-100), grade (A-F), dimensions: List<{name, score, reason}> }`
- Composite score = weighted average of five sub-dimensions, each capped 0-100, with v1 weights pinned in code constants: COMPLETENESS 30, AC MEASURABILITY 25, IMPLEMENTATION CONCRETENESS 20, EVIDENCE DENSITY 15, SIBLING/PARENT ALIGNMENT 10
- Grade thresholds fixed as code constants: A >= 85, B 70-84, C 55-69, D 40-54, F < 40
- Each dimension's named-threshold rules MUST be implemented exactly as defined under "Dimension rules" below — reviewers audit by line-mapping rules to the relevant requirement bullets here
- No exceptions thrown for malformed inputs (empty spec text, null lists): scorer treats them as zero-content for that dimension and returns a low but valid score

**Dimension rules: COMPLETENESS (weight 30)**
- Expected sections (7 total): decisions, interfaces, assumptions, acceptance criteria, tests, evidence refs, files affected
- Detect using existing `ShapeSpecHeadingParser` heading-pattern logic, extended to cover the four additional sections
- Score = round((sections_present / 7) * 100)
- Reason template: `"N/7 expected sections present; missing: X, Y, Z"` (omit "missing:" clause if N == 7)

**Dimension rules: AC MEASURABILITY (weight 25)**
- Parse the acceptance criteria block from the heading parser
- Per AC line, award up to 100 from four +25 signals: contains numeric token; contains expected-status keyword (`returns`/`should`/`given`/`when`/`then`); contains a named-entity reference (capitalised identifier or quoted name); contains a measurable verb (`validates`/`asserts`/`equals`/`contains`)
- Final dimension score = arithmetic mean across detected AC lines, capped 0-100; if no ACs detected score is 0
- Reason template: `"M of N ACs include measurable signals; weakest: <first-non-measurable-AC-snippet, max 60 chars>"`

**Dimension rules: IMPLEMENTATION CONCRETENESS (weight 20)**
- Count concrete references in spec text via regex:
  - File paths: contains `/` and matches `.java|.ts|.tsx|.py|.go|.sql|.md|.yml|.yaml|.json`
  - FQNs: 2+ dot-separated Java/TS identifiers
  - Operation identifiers: matches `(GET|POST|PUT|DELETE|PATCH) /` or `<operation name>` style tokens
  - Specific entity names lifted from the story title (case-insensitive substring match)
- Score = min(100, concrete_ref_count * 10)
- Reason template: `"N concrete references found (files, classes, operations)"`

**Dimension rules: EVIDENCE DENSITY (weight 15)**
- From `specText` + `warningsList` + decisions/interfaces/assumptions arrays
- Count: explicit `Evidence:` lines, evidence-ref tokens matching `\[finding-[^\]]+\]` or `\[baseline-[^\]]+\]`
- spec_word_count = whitespace-split token count of `specText`
- density = evidence_refs / max(1, spec_word_count / 100)
- Score = min(100, round(density * 25)) — calibrated so density 4.0 evidence refs per 100 words = 100
- Reason template: `"N evidence refs across ~M words; density = X.X"`

**Dimension rules: SIBLING/PARENT ALIGNMENT (weight 10)**
- Walk `warningsJson` (existing column on the entity) and count kinds `contradicts_sibling` and `aligned_with_epic_decision`
- Start at baseline 50; subtract 20 per `contradicts_sibling`, add 15 per `aligned_with_epic_decision`; clamp 0-100
- Reason template: `"N contradictions, M alignments; from baseline 50"`

**Persist-time hook in MigrationStorySpecGenerationService.persistOne**
- After parser-output application but BEFORE `repository.save(...)`, invoke `SpecQualityScorer.score(...)` on the assembled entity
- If overwriting an existing row, capture the row's current `quality_score` into `previous_quality_score` first
- Set new `quality_score`, `quality_grade`, `quality_dimensions_json` from the scorer output
- For rows whose `status` is `insufficient_context` or `failed`, SKIP scoring entirely: store `quality_score = null`, `quality_grade = null`, `quality_dimensions_json = null` (no zero-score F-grade falsehood)
- Scoring failures NEVER block persistence — wrapped in try/catch, fall back to nulls and append a `quality_scoring_error` warning to `warnings_json`

**AMS recompute endpoints**
- `POST /api/projects/{projectId}/spec-generations/{specId}/recompute-quality` — single-row recompute; reuses scorer; returns `{ qualityScore, qualityGrade, qualityDimensions, previousQualityScore }` from the updated row
- `POST /api/projects/{projectId}/spec-generations/recompute-quality-bulk` — iterates active spec generations for the project, scores each (skipping insufficient_context/failed), returns summary `{ totalScored, totalSkipped, gradeBreakdown: { A, B, C, D, F, na } }`
- Both endpoints validate project ownership; bulk endpoint runs synchronously within request scope (no async job yet)

**Hierarchy DTO surface**
- Extend `MigrationDeliveryHierarchyNodeDto` with one new field: `qualityGrade` (`String`, nullable, JSON-property `quality_grade`)
- Dashboard hierarchy builder populates `qualityGrade` from the latest spec row's `quality_grade` column; null for stories with no spec row or with `insufficient_context` / `failed` rows
- Backward-compatible record constructor added matching the project's pattern (prior signature with `null` for the new field)

**Gateway proxy routes (no LLM)**
- `POST /api/v1/projects/:projectId/spec-generations/:specId/recompute-quality` — thin pass-through to AMS, preserves request id and 4xx/5xx body
- `POST /api/v1/projects/:projectId/spec-generations/recompute-quality-bulk` — thin pass-through to AMS bulk endpoint
- Neither route contacts the LLM or transforms the response body

**Frontend grade chip on hierarchy node**
- New `QualityGradeChip.tsx` component renders the chip next to the existing confidence chip on the hierarchy story row
- Colour ramp matches existing confidence pill ramp: A green, B teal/light-green, C amber, D orange, F red, N/A muted `"—"`
- Hover tooltip shows numeric `quality_score` and a brief per-dimension breakdown (dimension name + score)
- Disagreement badge: small superscript `"!"` on the chip when (LLM confidence = `high` AND grade in {C, D, F}) OR (LLM confidence = `low` AND grade in {A, B}); tooltip names the direction

**Frontend story drawer "Quality breakdown" section**
- New collapsible section in `MigrationDeliveryStoryDrawer.tsx` titled "Quality breakdown"
- Section header has right-aligned small icon button "Recompute quality score" (tooltip same) that calls the gateway single-row endpoint and refreshes the drawer
- Section body renders five rows from `quality_dimensions_json`, one per dimension: dimension name (left), numeric sub-score (centre), terse reason string (right)
- Delta chip rendered inline next to the composite numeric score, visible only when the grade letter derived from `previous_quality_score` differs from the current `quality_grade`; same-letter numeric moves render no delta chip
- Section absent entirely (not rendered as empty) when `quality_grade` is null

**Frontend dashboard grade filter**
- Add a multi-select chip group (A / B / C / D / F / N/A) to the dashboard filter strip, matching the existing status filter chip pattern
- When one or more grades selected, prune the hierarchy to story nodes whose `qualityGrade` is in the selected set; default state is all-selected (no filtering)
- Filter state co-exists with the existing status filter (intersection semantics, not replacement)

**Bulk recompute UI entry point**
- A single "Recompute all quality scores" button in the dashboard's existing action area (sibling to the Generate-All control), wired to the bulk gateway endpoint
- On success, displays a toast `"Scored N specs, skipped M (insufficient context / failed)"` and refreshes the hierarchy so chips reflect the new grades
- Button is the deploy-day catch-up affordance for existing rows that pre-date the new columns

## Visual Design

No visuals provided. Visual decisions are anchored to:
- The existing confidence pill ramp in `MigrationDeliveryDashboard.module.css` (classes `.badgeConfidenceHigh` / `.badgeConfidenceMedium` / `.badgeConfidenceLow`) — the grade chip ramp parallels this
- The existing status filter chip group on the dashboard — the new grade filter mirrors that pattern
- The existing story drawer section layout — the "Quality breakdown" section adopts the same heading + collapsible body pattern with a right-aligned icon button slot

## Existing Code to Leverage

**`ShapeSpecHeadingParser` (AMS util)**
- Already extracts decisions / interfaces / assumptions via regex-based heading detection at persist time
- Reuse / extend the same heading-pattern approach to detect the four additional COMPLETENESS sections (acceptance criteria, tests, evidence refs, files affected)
- Keep parser policy-free: scoring lives in `SpecQualityScorer`, parser only reports section presence

**`MigrationStorySpecGenerationEntity` (AMS entity)**
- Already carries `decisions_json` / `interfaces_json` / `assumptions_json` / `warnings_json` (with kinds `contradicts_sibling`, `aligned_with_epic_decision`) — direct inputs to the scorer
- Boxed-type pattern (`Integer generationPass`, `Boolean noMeaningfulChange`) — new quality fields follow the same boxed-type convention to preserve PATCH semantics

**`MigrationStorySpecGenerationService.persistOne` (AMS service)**
- Existing single canonical persist path that already invokes `applyShapeSpecParserOutput` and `populateMissingInputKeys` before save
- New scorer call slots in alongside these — same pattern, same try/catch posture (never block persistence)

**`MigrationDeliveryHierarchyNodeDto` (AMS DTO)**
- Already has the back-compat record-constructor pattern (15-arg delegate → canonical 16-arg) — repeat the trick for the new `qualityGrade` field so existing test call sites keep compiling

**`MigrationDeliveryHierarchyTree.tsx` confidence badge helper**
- `confidenceBadgeClass(...)` already maps a status enum to a CSS class — clone the pattern as `qualityGradeBadgeClass(...)` for the grade chip, with the same module.css ramp of style classes

## Out of Scope

- LLM-graded scoring (any dimension calling an LLM)
- Score-based blocking of downstream actions (publish, sync, etc.)
- Required-review gates triggered by low scores
- Full history table for quality scores (only single `previous_quality_score` kept)
- Per-project configurable dimension weights (v1 weights are code constants)
- User-defined custom dimension definitions
- Separate quality dashboard page (the existing Migration Delivery Dashboard is the single surface)
- Async / background job for the bulk recompute endpoint (synchronous within request scope)
- Numeric-delta chip for same-letter score moves (letter-change-only by design)
- Filtering / segmentation knobs on the bulk recompute endpoint (project-wide all-rows only)
