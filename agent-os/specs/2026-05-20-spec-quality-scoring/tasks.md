# Task Breakdown: Spec Quality Scoring

## Overview
Total Task Groups: 9

This breakdown follows the dependency chain: persistence foundation -> deterministic scorer -> persist-time hook -> AMS endpoints -> hierarchy DTO surface -> gateway proxy -> frontend chip & drawer & filter & bulk catch-up -> cross-layer integration tests.

## Task List

### Database Layer

#### Task Group 1: Liquibase Changeset and Entity Columns
**Dependencies:** None

- [x] 1.0 Complete the persistence foundation for quality scoring
  - [x] 1.1 Write 2-8 focused tests for the new entity columns and changeset
    - One Liquibase smoke test that the new changeset applies cleanly on top of changeset 152 and is idempotent on second run
    - One JPA persistence test that boxed types `Integer qualityScore`, `String qualityGrade`, `List<Map<String,Object>> qualityDimensions`, `Integer previousQualityScore` round-trip through `save`/`findById` including null values
    - One DB-level CHECK constraint test: persisting `quality_score = 150` or `quality_grade = "Z"` is rejected
    - Skip exhaustive coverage of every boxed-vs-primitive scenario; the boxed-type rule is enforced by code review per `project_primitive_double_dto_overwrite.md`
  - [x] 1.2 Add a new Liquibase changeset file (changeset id 153+) under `architecture-model-service/src/main/resources/db/changelog/`
    - Add columns to `migration_story_spec_generations`:
      - `quality_score` SMALLINT NULL with CHECK between 0 and 100
      - `quality_grade` VARCHAR(1) NULL with CHECK IN ('A','B','C','D','F')
      - `quality_dimensions_json` JSONB NULL
      - `previous_quality_score` SMALLINT NULL with CHECK between 0 and 100
    - Register the new file in `db.changelog-master.yaml` AFTER the most recent existing entry (never edit an applied changeset per `feedback_liquibase_immutable_changesets.md`)
  - [x] 1.3 Add the four new fields to `MigrationStorySpecGenerationEntity`
    - Use boxed types only: `Integer qualityScore`, `String qualityGrade`, `List<Map<String,Object>> qualityDimensions` (mapped via `@JdbcTypeCode(SqlTypes.JSON)` matching `decisions_json` pattern), `Integer previousQualityScore`
    - Match the existing JSON column mapping pattern already used for `decisions_json` / `interfaces_json` / `assumptions_json` / `warnings_json`
    - Getters/setters; no business logic
  - [x] 1.4 Ensure database layer tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Verify Liquibase migration applies clean against an empty schema and against a schema already at changeset 152
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- Changeset applies and is idempotent
- Entity round-trips all four new fields including nulls
- DB CHECK constraints reject out-of-range scores and invalid grade letters

---

### AMS Scoring Logic

#### Task Group 2: `SpecQualityScorer` Deterministic Component
**Dependencies:** Task Group 1

- [x] 2.0 Build the deterministic five-dimension scorer
  - [x] 2.1 Write 2-8 focused tests for the scorer (one per dimension plus composite + grade-band)
    - Test 1: COMPLETENESS — spec with 4 of 7 sections detected returns score `round(4/7*100) = 57` and reason `"4/7 expected sections present; missing: tests, files affected, evidence refs"`
    - Test 2: AC MEASURABILITY — 3 ACs of which 2 contain numeric + status-keyword + named-entity returns mean across detected ACs, reason includes weakest AC snippet (max 60 chars)
    - Test 3: IMPLEMENTATION CONCRETENESS — spec with 7 concrete refs (files / FQNs / operations) returns score `min(100, 7*10) = 70`
    - Test 4: EVIDENCE DENSITY — 4 evidence refs in 100-word spec yields `density = 4.0`, score `min(100, round(4.0*25)) = 100`
    - Test 5: SIBLING/PARENT ALIGNMENT — warnings with 1 `contradicts_sibling` + 2 `aligned_with_epic_decision` returns `50 - 20 + 30 = 60`
    - Test 6: composite weighted score — pinned-input fixture verifies `0.30*C + 0.25*AC + 0.20*IC + 0.15*ED + 0.10*SA` exactly
    - Test 7: grade-band mapping — boundary values 85, 84, 70, 69, 55, 54, 40, 39 map to A, B, B, C, C, D, D, F
    - Test 8: malformed input — empty spec text + null lists returns a valid low score, no exception thrown
  - [x] 2.2 Extend `ShapeSpecHeadingParser` (or add a sibling util) to detect the four additional COMPLETENESS sections
    - Add heading patterns for: acceptance criteria, tests, evidence refs, files affected
    - Keep the parser policy-free — it only reports section presence; scoring lives in `SpecQualityScorer`
    - Reuse the existing heading-pattern regex approach already used for decisions / interfaces / assumptions
  - [x] 2.3 Create the `SpecQualityScorer` Spring `@Component` under the appropriate AMS service package
    - Input record `SpecQualityScorerInput { String specText, List<...> decisions, List<...> interfaces, List<...> assumptions, List<Map<String,Object>> warnings, String storyTitle }`
    - Output record `SpecQualityScorerOutput { int score, String grade, List<Map<String,Object>> dimensions }`
    - Pin v1 weights as `private static final` ints: `WEIGHT_COMPLETENESS = 30`, `WEIGHT_AC_MEASURABILITY = 25`, `WEIGHT_IMPLEMENTATION_CONCRETENESS = 20`, `WEIGHT_EVIDENCE_DENSITY = 15`, `WEIGHT_SIBLING_PARENT_ALIGNMENT = 10`
    - Pin grade thresholds as `private static final` ints: `GRADE_A_MIN = 85`, `GRADE_B_MIN = 70`, `GRADE_C_MIN = 55`, `GRADE_D_MIN = 40`
  - [x] 2.4 Implement each of the five dimension scorers exactly per spec.md rules
    - `scoreCompleteness(...)`: sections_present / 7 * 100, templated reason
    - `scoreAcMeasurability(...)`: per-AC up-to-100 from four +25 signals (numeric token, expected-status keyword, named-entity reference, measurable verb), mean across ACs; reason names the weakest AC snippet (<= 60 chars)
    - `scoreImplementationConcreteness(...)`: regex count of file paths / FQNs / operation identifiers / story-title entity refs, capped 100 via `min(100, count*10)`
    - `scoreEvidenceDensity(...)`: count of `Evidence:` lines + `[finding-...]` / `[baseline-...]` tokens, divided by `max(1, spec_word_count/100)`, score `min(100, round(density*25))`
    - `scoreSiblingParentAlignment(...)`: walk `warningsJson` for kinds `contradicts_sibling` (-20) and `aligned_with_epic_decision` (+15), baseline 50, clamp 0-100
    - Every dimension returns a templated reason string matching the spec.md template verbatim
  - [x] 2.5 Implement composite scoring and grade mapping
    - Weighted average of five sub-scores using the pinned weights (note: weights sum to 100, so divide by 100 not by sum-of-weights)
    - Map composite to grade via the pinned thresholds
    - Assemble the `dimensions` list of `{name, score, reason}` maps for JSON persistence
  - [x] 2.6 Ensure AMS scoring logic tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Each of the five dimensions implements its rules exactly per spec.md
- Composite weights and grade thresholds match the pinned constants
- No exceptions on malformed input; zero-content cases return low but valid scores
- Parser remains policy-free; all scoring policy lives in `SpecQualityScorer`

---

#### Task Group 3: Persist-Time Hook in `MigrationStorySpecGenerationService.persistOne`
**Dependencies:** Task Group 2

- [x] 3.0 Wire the scorer into the canonical persist path
  - [x] 3.1 Write 2-8 focused tests for the persist-time hook
    - Test: `persistOne` on a fresh row with `status = generated` writes non-null `quality_score`, `quality_grade`, `quality_dimensions_json` and leaves `previous_quality_score = null`
    - Test: `persistOne` overwriting an existing scored row captures the prior `quality_score` into `previous_quality_score` BEFORE recomputing
    - Test: `persistOne` on a row with `status = insufficient_context` writes `quality_score = null`, `quality_grade = null`, `quality_dimensions_json = null` (skip scoring)
    - Test: `persistOne` on a row with `status = failed` same null behaviour as `insufficient_context`
    - Test: a thrown scorer exception is swallowed — row still persists, all four quality columns nullified, and a `quality_scoring_error` entry is appended to `warnings_json`
  - [x] 3.2 Modify `MigrationStorySpecGenerationService.persistOne` to call the scorer
    - Inject `SpecQualityScorer` via constructor (match existing dependency-injection pattern in the service)
    - Call AFTER `applyShapeSpecParserOutput(...)` and `populateMissingInputKeys(...)`, BEFORE `repository.save(...)`
    - If the entity has an existing persisted `quality_score` (loaded row, overwrite case), copy it into `previous_quality_score` first
    - Set `qualityScore`, `qualityGrade`, `qualityDimensions` from the scorer output
  - [x] 3.3 Implement the skip-and-null-out branch for `insufficient_context` / `failed` rows
    - Explicit `if (status == INSUFFICIENT_CONTEXT || status == FAILED) { qualityScore = null; qualityGrade = null; qualityDimensions = null; }` before invoking the scorer
    - Still capture `previous_quality_score` if overwriting a previously scored row (so the prior good score is preserved as the historical anchor)
  - [x] 3.4 Wrap the scorer call in try/catch — never block persistence
    - On any thrown exception: log at WARN with the spec id, nullify all four quality fields, append a `{ kind: "quality_scoring_error", message: ex.getMessage() }` entry to `warnings_json`
    - Existing happy-path tests in `MigrationStorySpecGenerationServiceTest` (and friends) must keep passing without modification — confirm the scorer is additive only
  - [x] 3.5 Ensure persist-time hook tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Spot-check one or two existing `persistOne` tests still pass (no edits needed to them)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Pre-existing `persistOne` tests still pass with zero edits (scorer is additive)
- `previous_quality_score` is captured before overwrite; never re-derived from history
- `insufficient_context` / `failed` rows store nulls, never zero-graded F entries
- Scorer exceptions never block persistence

---

### AMS Surface

#### Task Group 4: Recompute Endpoints and Hierarchy DTO
**Dependencies:** Task Group 3

- [x] 4.0 Expose recompute endpoints and surface `qualityGrade` on the hierarchy DTO
  - [x] 4.1 Write 2-8 focused tests for the endpoints and DTO surface
    - Test: `POST /api/projects/{projectId}/spec-generations/{specId}/recompute-quality` recomputes and returns `{ qualityScore, qualityGrade, qualityDimensions, previousQualityScore }`
    - Test: single-row recompute on an `insufficient_context` row returns a response with all four nullable fields null (no scoring happened)
    - Test: project-ownership validation — calling recompute with a `specId` that belongs to another project returns 404 (or 403, matching existing controller pattern)
    - Test: `POST /api/projects/{projectId}/spec-generations/recompute-quality-bulk` returns `{ totalScored, totalSkipped, gradeBreakdown: { A, B, C, D, F, na } }` with counts matching the underlying data
    - Test: bulk recompute increments `na` (not `F`) for `insufficient_context` and `failed` rows
    - Test: `MigrationDeliveryHierarchyNodeDto` exposes nullable `qualityGrade` JSON-property `quality_grade`; the back-compat constructor (prior-arg-count delegate) compiles and yields `qualityGrade == null`
  - [x] 4.2 Add single-row recompute endpoint
    - Controller method in the migration-story spec-generation controller
    - Path: `POST /api/projects/{projectId}/spec-generations/{specId}/recompute-quality`
    - Validate project ownership of the spec id (match the existing controller's ownership-check helper)
    - Load the entity, call the scorer (via the same path as `persistOne` — extract a shared helper if needed so behaviour stays identical), persist, return the four quality fields as a response DTO
  - [x] 4.3 Add project-wide bulk recompute endpoint
    - Path: `POST /api/projects/{projectId}/spec-generations/recompute-quality-bulk`
    - Synchronous within request scope (per Out of Scope: no async job in v1)
    - Iterate active spec generations for the project; for each: skip if `insufficient_context` / `failed` (count toward `totalSkipped` and `gradeBreakdown.na`), otherwise score and persist (count toward `totalScored` and increment the appropriate `gradeBreakdown[A|B|C|D|F]`)
    - Return `{ totalScored, totalSkipped, gradeBreakdown: { A, B, C, D, F, na } }`
  - [x] 4.4 Extend `MigrationDeliveryHierarchyNodeDto` with `qualityGrade`
    - Add nullable `String qualityGrade` field with JSON-property `quality_grade`
    - Add the back-compat record constructor that delegates from the prior arg-count to the new canonical one with `qualityGrade = null` (per the recent target-arch + missing-input specs' pattern)
    - Update the dashboard hierarchy builder to populate `qualityGrade` from the latest spec row's `quality_grade` column (null when no spec row or `insufficient_context` / `failed`)
  - [x] 4.5 Ensure AMS surface tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Confirm existing hierarchy DTO tests still pass without edits (back-compat constructor protects them)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- Both endpoints honour project ownership
- Bulk endpoint summary shape matches `{ totalScored, totalSkipped, gradeBreakdown: { A, B, C, D, F, na } }` exactly
- `qualityGrade` is exposed on hierarchy DTOs; existing call sites compile unchanged
- Existing tests in the controller and hierarchy-DTO test files require no modification

---

### Gateway Layer

#### Task Group 5: Gateway Proxy Routes
**Dependencies:** Task Group 4

- [x] 5.0 Add the two thin proxy routes for the new AMS endpoints
  - [x] 5.1 Write 2-8 focused tests (Jest) for the gateway proxy routes
    - Test: single-row proxy forwards the call to AMS with the correct path including `:projectId` and `:specId` and returns the AMS response body verbatim
    - Test: bulk proxy forwards to AMS and returns the `{ totalScored, totalSkipped, gradeBreakdown }` summary body verbatim
    - Test: AMS 4xx response is passed through with status and body intact (no transformation)
    - Test: AMS 5xx response is passed through with status and body intact
  - [x] 5.2 Add `POST /api/v1/projects/:projectId/spec-generations/:specId/recompute-quality`
    - Thin pass-through; preserve request id header; no body transformation
    - Match the existing AMS-proxy pattern already used for other spec-generation routes
  - [x] 5.3 Add `POST /api/v1/projects/:projectId/spec-generations/recompute-quality-bulk`
    - Thin pass-through; preserve request id header; no body transformation
    - Neither route contacts the LLM
  - [x] 5.4 Ensure gateway tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Include the `beforeEach` thread-cleanup pattern only if any new test happens to touch threads (these proxy tests should not)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Both routes are pure pass-through (status, body, request id preserved)
- No LLM invocation from either route

---

### Frontend

#### Task Group 6: Grade Chip and Hierarchy Integration
**Dependencies:** Task Group 5

- [x] 6.0 Build the per-story grade chip on the hierarchy
  - [x] 6.1 Write 2-8 focused tests (Vitest) for the chip
    - Test: chip renders with class for grade `A` -> green ramp class; smoke-test each of A/B/C/D/F maps to its colour class
    - Test: chip renders muted `"—"` (`N/A` state) when `qualityGrade` is null
    - Test: hover tooltip exposes the numeric `quality_score` and per-dimension breakdown text
    - Test: disagreement `"!"` badge renders when LLM confidence = `high` AND grade in {C, D, F}
    - Test: disagreement `"!"` badge renders when LLM confidence = `low` AND grade in {A, B}
    - Test: disagreement badge does NOT render when confidence and grade agree
  - [x] 6.2 Create `QualityGradeChip.tsx`
    - Props: `qualityGrade: 'A'|'B'|'C'|'D'|'F'|null`, `qualityScore: number|null`, `qualityDimensions: Array<{name, score, reason}>|null`, `llmConfidence: 'high'|'medium'|'low'|null`
    - Render the colour-coded chip mapping to the existing confidence-pill module.css ramp (clone the helper `confidenceBadgeClass(...)` pattern into a new `qualityGradeBadgeClass(...)` per spec.md "Existing Code to Leverage")
    - Hover tooltip: numeric score + brief per-dimension breakdown (dimension name + score)
    - Disagreement badge: small superscript `"!"` per the rule; tooltip names the direction (e.g. `"LLM reports high confidence but rules grade is D"`)
  - [x] 6.3 Integrate the chip into `MigrationDeliveryHierarchyTree.tsx`
    - Render `QualityGradeChip` next to the existing confidence chip on each story row
    - Wire props from the hierarchy node DTO (the new `qualityGrade`/`quality_grade` field plus the existing confidence + latest spec row's `quality_score`/`quality_dimensions`)
  - [x] 6.4 Ensure grade-chip tests pass
    - Run ONLY the 2-8 tests written in 6.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- Chip colours match the confidence-pill ramp parallel
- N/A muted state renders for null grade
- Disagreement badge fires only on the two named direction rules

---

#### Task Group 7: Drawer "Quality Breakdown" Section
**Dependencies:** Task Group 6

- [x] 7.0 Build the drawer breakdown section with per-dimension rows, recompute button, and delta chip
  - [x] 7.1 Write 2-8 focused tests (Vitest) for the drawer section
    - Test: section renders five rows (one per dimension) with name + sub-score + reason from `quality_dimensions_json`
    - Test: section is NOT rendered (absent, not empty) when `qualityGrade` is null
    - Test: clicking the "Recompute quality score" icon button calls the gateway single-row endpoint and refreshes drawer state
    - Test: delta chip renders when grade letter changed from `previous_quality_score`-derived letter to current (e.g. previous 60 -> C, current 88 -> A)
    - Test: delta chip does NOT render when previous and current map to the same letter (e.g. 72 -> 74, both B)
    - Test: delta chip does NOT render when `previousQualityScore` is null (first-time scoring)
  - [x] 7.2 Add the "Quality breakdown" collapsible section to `MigrationDeliveryStoryDrawer.tsx`
    - Match existing drawer section heading + collapsible body pattern
    - Section header: title `"Quality breakdown"` on the left, small right-aligned icon button `"Recompute quality score"` (tooltip same)
    - Section body: composite numeric score on the first line (with optional delta chip inline), five dimension rows beneath
    - Per-row layout: dimension name (left) + numeric sub-score (centre) + terse reason (right)
  - [x] 7.3 Wire the "Recompute quality score" icon button
    - Calls `POST /api/v1/projects/:projectId/spec-generations/:specId/recompute-quality`
    - On 2xx: update drawer state with the returned `{ qualityScore, qualityGrade, qualityDimensions, previousQualityScore }` and re-render the section + the parent hierarchy chip
    - On error: show a non-blocking error toast; do not crash the drawer
  - [x] 7.4 Implement the delta chip
    - Compute `previousGradeLetter` from `previousQualityScore` using the same grade-band logic (kept in a shared frontend util)
    - Render only when `previousGradeLetter !== qualityGrade` AND both are non-null
    - Visual: small chip showing `"B -> A"` or similar; no numeric delta
  - [x] 7.5 Ensure drawer tests pass
    - Run ONLY the 2-8 tests written in 7.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass
- Section renders five dimension rows from JSON
- Section is absent when grade is null
- Recompute button refreshes drawer and parent chip
- Delta chip honours letter-change-only rule strictly

---

#### Task Group 8: Dashboard Grade Filter and Bulk Recompute Entry Point
**Dependencies:** Task Group 6 (chip in place); independent of Task Group 7

- [x] 8.0 Add the dashboard grade filter chip group and the bulk recompute button
  - [x] 8.1 Write 2-8 focused tests (Vitest) for filter and bulk recompute
    - Test: filter chip group renders six options (A / B / C / D / F / N/A); default state all-selected
    - Test: selecting only `C` and `D` prunes the hierarchy to story nodes whose `qualityGrade` is in {C, D}
    - Test: grade filter combines with the existing status filter via intersection (story node must match BOTH filters)
    - Test: `"Recompute all quality scores"` button calls the gateway bulk endpoint and on 2xx displays the summary toast `"Scored N specs, skipped M (insufficient context / failed)"`
    - Test: on bulk-recompute success, the hierarchy is refreshed so chips reflect the new grades
  - [x] 8.2 Add the multi-select grade chip filter to the dashboard filter strip
    - Six chips: A / B / C / D / F / N/A
    - State pattern matches the existing status filter chip group exactly (same module.css classes, same click behaviour)
    - Default: all selected (equivalent to no filter applied)
  - [x] 8.3 Wire the filter into the hierarchy pruning logic
    - Combine with the existing status filter via intersection
    - `N/A` chip filters in stories where `qualityGrade` is null
  - [x] 8.4 Add the `"Recompute all quality scores"` button
    - Place it in the dashboard action area, sibling to the existing "Generate-All" control
    - Calls `POST /api/v1/projects/:projectId/spec-generations/recompute-quality-bulk`
    - On 2xx: show a toast `"Scored N specs, skipped M (insufficient context / failed)"` using `totalScored` and `totalSkipped` from the response; then re-fetch the hierarchy
    - On error: error toast; do not crash the dashboard
  - [x] 8.5 Ensure dashboard filter and bulk tests pass
    - Run ONLY the 2-8 tests written in 8.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 8.1 pass
- Grade filter is intersection-combined with the status filter
- N/A chip correctly filters stories with null grade
- Bulk recompute button shows the summary toast and refreshes the hierarchy

---

### Testing

#### Task Group 9: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-8

- [x] 9.0 Review existing tests and fill critical gaps only
  - [x] 9.1 Review tests written across Task Groups 1-8
    - DB layer (1.1): 2-8 tests
    - Scorer (2.1): up to 8 tests across five dimensions + composite + grade-band + malformed input
    - Persist-time hook (3.1): up to 8 tests
    - AMS endpoints + DTO (4.1): up to 8 tests
    - Gateway proxy (5.1): up to 8 tests
    - Grade chip (6.1): up to 8 tests
    - Drawer breakdown (7.1): up to 8 tests
    - Dashboard filter + bulk (8.1): up to 8 tests
    - Expected total: approximately 30-60 tests across all layers
  - [x] 9.2 Analyse test coverage gaps for THIS feature only
    - Identify any critical end-to-end workflows not yet covered (e.g. fresh-deploy catch-up via bulk recompute -> hierarchy chips populate; legacy `insufficient_context` row stays N/A after bulk recompute)
    - Identify any cross-layer flow gaps (e.g. persist a new spec -> chip appears in hierarchy with correct grade -> drawer breakdown matches scorer output)
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
  - [x] 9.3 Write up to 10 additional strategic tests maximum
    - Suggested high-value gap candidates (pick up to 10):
      - Cross-layer: persist with `status = generated` -> hierarchy DTO surfaces non-null `qualityGrade`
      - Cross-layer: persist with `status = insufficient_context` -> hierarchy DTO surfaces null `qualityGrade` and frontend chip renders `"—"`
      - End-to-end bulk catch-up: bulk endpoint on a project with mixed-status rows returns correct breakdown counts and updates each row's `quality_grade`
      - Confidence-vs-grade disagreement integration: persist a high-confidence LLM output that scores to D -> chip shows the `"!"` badge
      - Recompute round-trip: drawer recompute button click -> new grade letter (with delta) -> hierarchy chip updates without a full page refresh
      - Skip edge cases, performance tests, and accessibility tests unless business-critical
    - Add a maximum of 10 new tests total
  - [x] 9.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, and 9.3)
    - Expected total: approximately 40-70 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass end-to-end

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 40-70 tests total)
- Critical user workflows for this feature are covered (per-story chip, drawer breakdown, dashboard filter, bulk catch-up, disagreement badge)
- No more than 10 additional tests added when filling testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:
1. **Task Group 1** — Liquibase changeset + entity columns (foundation; nothing else compiles without these)
2. **Task Group 2** — `SpecQualityScorer` deterministic component (pure logic, no DB writes)
3. **Task Group 3** — Persist-time hook in `MigrationStorySpecGenerationService.persistOne` (connects scorer to the canonical persist path)
4. **Task Group 4** — Recompute endpoints + `MigrationDeliveryHierarchyNodeDto` `qualityGrade` field (AMS surface)
5. **Task Group 5** — Gateway proxy routes (depends on AMS endpoints existing)
6. **Task Group 6** — `QualityGradeChip.tsx` + hierarchy integration (frontend foundation; chip is reused by drawer and filter)
7. **Task Group 7** — Drawer "Quality breakdown" section (depends on chip + gateway single-row endpoint)
8. **Task Group 8** — Dashboard grade filter + bulk recompute button (depends on chip + gateway bulk endpoint; independent of Group 7)
9. **Task Group 9** — Test review + gap analysis across all layers

Parallelisation opportunities:
- Groups 7 and 8 can run in parallel once Group 6 lands.
- Group 5 (gateway) is small and can run in parallel with the start of Group 6 if frontend work begins against a stubbed gateway client first.
