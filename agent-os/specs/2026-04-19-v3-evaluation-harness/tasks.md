# Task Breakdown: V3 Evaluation Harness

## Overview
Total Tasks: 8 task groups covering shared library, metrics, fixture replay, CLI, annotation tool, fixture authoring, regression acceptance, and documentation. All work is pure TypeScript in `discovery-service/`; no Java, Liquibase, gateway, or frontend changes.

## Task List

### Shared Runner Library

#### Task Group 1: Shared Evaluation Runner Library + Types + Fixture Loader
**Dependencies:** None
**Location:** `discovery-service/src/evaluation/`

- [x] 1.0 Complete shared evaluation runner library foundation
  - [x] 1.1 Write 2-8 focused tests for runner library + fixture loader
    - Test `expected.json` schema validation (required `type`, `name`, `tag`; optional `description`, `notes`; top-level `shouldNotEmit` array shape)
    - Test fixture loader round-trips a well-formed fixture directory into the in-memory shape
    - Test fixture loader rejects malformed `expected.json` with a clear error
    - Test report shape builder produces the documented per-fixture / per-framework / aggregate structure
    - Skip exhaustive field-by-field validation and filesystem edge cases
  - [x] 1.2 Define TypeScript types for the evaluation domain
    - `ExpectedCandidate` (`type`, `name`, `tag: 'pack' | 'gap-fill' | 'either'`, optional `description`, `notes`)
    - `ShouldNotEmitEntry` (`type`, `name`)
    - `FixtureExpectations` (`{ expected: ExpectedCandidate[]; shouldNotEmit: ShouldNotEmitEntry[] }`)
    - `FixtureCase` (framework id, case id, source file path, expectations, optional recorded LLM response path)
    - `FixtureReport` / `FrameworkReport` / `AggregateReport` (raw counts + derived micro-averaged metrics + baseline deltas + verdicts)
    - Co-locate in `src/evaluation/types.ts`
  - [x] 1.3 Implement fixture loader at `src/evaluation/fixtureLoader.ts`
    - Walk `discovery-service/evaluation/fixtures/<framework>/<case>/`
    - Load `<case>.source`, `<case>.expected.json`, `README.md`
    - Preserve original source filename/extension so filePath-driven detectors behave realistically
    - Validate `expected.json` against the schema and throw with actionable errors on violation
  - [x] 1.4 Implement `src/evaluation/runner.ts` skeleton
    - Exported `runEvaluation(options)` entry point the CLI will call
    - Orchestrates: load fixtures -> invoke pipeline per fixture -> score -> aggregate -> compare baseline
    - Delegates scoring, aggregation, and baseline comparison to the per-metric module delivered in Group 2
    - Mirrors CLI ergonomics / logging style from `scripts/run-pack-local.ts` and `scripts/run-spring-classic-local.ts`
    - Exposes injection points for the LLM replay/record layer that Group 3 will wire in
  - [x] 1.5 Ensure shared runner library tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- `src/evaluation/types.ts`, `fixtureLoader.ts`, and `runner.ts` exist and compile
- Loader round-trips a real on-disk fixture directory
- Runner exposes a clean API the CLI and future consumers (`run-pack-local.ts`, `run-spring-classic-local.ts`) can call without refactor churn

---

### Metrics

#### Task Group 2: Per-Metric Calculators + Micro-Average Aggregation + Baseline Comparison
**Dependencies:** Task Group 1
**Location:** `discovery-service/src/evaluation/metrics.ts`, `aggregation.ts`, `baseline.ts`

- [x] 2.0 Complete metric calculation and aggregation
  - [x] 2.1 Write 2-8 focused tests for metric calculators and aggregation
    - Test pack recall on a tiny hand-built fixture (some `'pack'` hits, some misses)
    - Test gap-fill precision + recall against a fixture mixing `'gap-fill'`, `'either'`, and untagged candidates
    - Test duplication rate correctly flags LLM candidates matching pack output on the canonical dedup key
    - Test hallucination rate counts both unmatched LLM candidates and `shouldNotEmit` matches
    - Test micro-average aggregation (sum numerators / sum denominators) across 2-3 fixtures differs from per-fixture arithmetic mean
    - Skip exhaustive boundary cases (zero denominators are covered once, not six times)
  - [x] 2.2 Implement matching module that imports the canonical dedup helper
    - Import `normalizeName` / dedup key from `discovery-service/src/services/prompts/dedup.ts` directly
    - Match expected <-> candidate on `(type, normalizeName(name), forward-slash filePath)`
    - `shouldNotEmit` matches on `{ type, name }` only (filePath-agnostic)
    - Do NOT re-implement normalization — import only
  - [x] 2.3 Implement five per-metric calculators in `src/evaluation/metrics.ts`
    - Pack recall: `'pack'`-tagged expected emitted by pack / total `'pack'`-tagged expected
    - Gap-fill precision: LLM candidates matching `'gap-fill'` or `'either'` expected / total LLM candidates
    - Gap-fill recall: `'gap-fill'`-tagged expected emitted by LLM / total `'gap-fill'`-tagged expected
    - Duplication rate: LLM candidates matching pack output on dedup key / total LLM candidates
    - Hallucination rate: LLM candidates with no expected match OR matching `shouldNotEmit` / total LLM candidates
    - Each calculator returns raw `{ numerator, denominator }` for downstream aggregation
  - [x] 2.4 Implement micro-average aggregation in `src/evaluation/aggregation.ts`
    - Per-fixture raw counts -> per-framework micro-average (sum numerators, sum denominators, divide) -> global aggregate
    - Preserve per-fixture breakdown for debugging output
  - [x] 2.5 Implement baseline comparison + directional threshold gating in `src/evaluation/baseline.ts`
    - Load baseline from `discovery-service/evaluation/baselines/<framework>.json`
    - Per-metric directional thresholds (default 5%): recall/precision fail on decrease; duplication/hallucination fail on increase
    - Load per-framework overrides from `discovery-service/evaluation/thresholds.json`
    - Emit per-metric verdict (`pass` / `fail` with direction and delta)
  - [x] 2.6 Ensure metrics tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- All five metrics calculate correctly against hand-built fixtures
- Micro-average aggregation matches the documented formula
- Baseline comparison produces per-metric verdicts with correct directional logic
- Matching imports from `services/prompts/dedup.ts` rather than duplicating normalization

---

### LLM Fixture Replay

#### Task Group 3: LLM Fixture Replay + Live/Record Mechanism
**Dependencies:** Task Group 1
**Location:** `discovery-service/src/evaluation/llmReplay.ts`

- [x] 3.0 Complete LLM fixture replay layer
  - [x] 3.1 Write 2-8 focused tests for replay mechanism
    - Test replay mode loads `evaluation/llm-fixtures/<framework>/<case>.llm-response.json` and returns it when `gatewayClient.gapFill` is invoked
    - Test missing replay fixture throws with the "regenerate via `--live --record`" message (no silent skip)
    - Test `--live --record` mode writes captured LLM responses to the correct fixture path
    - Mirror the `gatewayClient.gapFill` mocking approach used by `src/__tests__/v3PipelineAcceptance.test.ts`
    - Skip exhaustive filesystem / JSON-parse edge cases
  - [x] 3.2 Implement replay stub that swaps `gatewayClient.gapFill` at harness startup
    - Same injection point as the existing test suites (`gatewayClient.gapFill`)
    - In replay mode, load `<case>.llm-response.json` and return it verbatim
    - Produces a clear, actionable error for missing fixtures, not a silent skip
  - [x] 3.3 Implement record mode for `--live --record`
    - Pass-through to real `gatewayClient.gapFill`
    - Capture response to `discovery-service/evaluation/llm-fixtures/<framework>/<case>.llm-response.json`
    - Create the framework directory if absent
  - [x] 3.4 Wire replay/record selection into `runner.ts`
    - Default mode = replay (fast, deterministic, free)
    - `--live` passes through to real LLM without recording
    - `--live --record` passes through AND writes fixture
    - `--record` without `--live` is rejected with a clear CLI error (delivered in Group 4, but the runner API must support the distinction)
  - [x] 3.5 Ensure LLM replay tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Replay mode returns recorded responses without hitting the network
- Missing fixtures fail fast with the documented regeneration message
- `--live --record` writes fixtures to the correct in-tree location

---

### CLI Runner

#### Task Group 4: CLI Runner + Output Formatting + Gitignore
**Dependencies:** Task Groups 1, 2, 3
**Location:** `discovery-service/scripts/run-evaluation.ts`, `discovery-service/evaluation/`, `discovery-service/.gitignore`

- [x] 4.0 Complete CLI runner and output layer
  - [x] 4.1 Write 2-8 focused tests for CLI argument parsing + output formatting
    - Test `--framework <id>` selects a single framework's fixtures
    - Test `--all` runs all three frameworks
    - Test `--record` without `--live` exits with a clear error
    - Test markdown summary formatter produces per-framework + aggregate rows with delta + pass/fail columns
    - Test JSON report shape matches the documented structure (per-fixture raw counts, per-framework aggregates, baseline comparison, threshold verdicts)
    - Skip exhaustive flag-combination coverage
  - [x] 4.2 Implement `scripts/run-evaluation.ts`
    - Flags: `--framework <id>`, `--all`, `--baseline <path>`, `--update-baseline`, `--live`, `--record`
    - Default baseline path: `discovery-service/evaluation/baselines/<framework>.json`
    - Mirror arg-parsing + logging style from `scripts/run-pack-local.ts` / `run-spring-classic-local.ts`
    - Mirror `--all` iteration / aggregation ergonomics from `scripts/batch-validate-packs.sh`
    - Exit code 1 on any threshold breach, exit 0 otherwise
  - [x] 4.3 Implement markdown summary formatter (stdout)
    - Per-framework metric table: value, baseline, delta, pass/fail
    - Global aggregate row
    - Per-fixture breakdown included for debugging
  - [x] 4.4 Implement JSON report writer
    - Output to `discovery-service/evaluation/reports/<framework>-<timestamp>.json`
    - Includes per-fixture raw counts, per-framework aggregates, baseline comparison, and threshold verdicts
  - [x] 4.5 Implement `--update-baseline`
    - Writes current run's metrics to `discovery-service/evaluation/baselines/<framework>.json`
    - Human reviews the diff before commit (no auto-commit)
  - [x] 4.6 Add `discovery-service/evaluation/reports/` to `.gitignore`
    - Keep `baselines/`, `fixtures/`, `llm-fixtures/`, and `thresholds.json` tracked
  - [ ] 4.7 Add npm script alias (e.g. `npm run eval`) to `discovery-service/package.json` if consistent with existing script conventions
  - [x] 4.8 Ensure CLI runner tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- CLI runs end-to-end against an empty fixture set without crashing (exit 0 with "no fixtures" note)
- All flags behave as specified; invalid combinations exit with clear errors
- Markdown stdout + JSON report both land when a framework has fixtures
- Reports directory gitignored; baselines + thresholds tracked

---

### Annotation Tool

#### Task Group 5: Fixture Annotation Tool
**Dependencies:** Task Group 1
**Location:** `discovery-service/scripts/annotate-fixture.ts`

- [x] 5.0 Complete annotation tool
  - [x] 5.1 Write 2-8 focused tests for `annotate-fixture.ts`
    - Test it runs `runDiscoveryV3` on the given source and writes `expected.json` with every produced candidate pre-tagged `'pack'`
    - Test `shouldNotEmit: []` is written empty
    - Test stub `README.md` includes source-file metadata placeholders (repo URL, commit SHA, license, rationale)
    - Test it does NOT attempt to auto-detect `'gap-fill'` / `'either'` tags
    - Skip exhaustive file-system edge cases
  - [x] 5.2 Implement `scripts/annotate-fixture.ts`
    - Inputs: source file path + framework id
    - Invokes `runDiscoveryV3` via the shared runner library's pipeline wrapper
    - Writes `<case>.source` (copy), `<case>.expected.json`, `README.md` into `discovery-service/evaluation/fixtures/<framework>/<case>/`
    - Pre-tags every produced candidate as `'pack'`; initializes `shouldNotEmit: []`
    - Populates `README.md` with placeholders for upstream repo URL, commit SHA, license, and "why chosen" rationale
  - [x] 5.3 Ensure annotation tool tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Tool scaffolds a fixture directory ready for human edits
- No auto-detection of tier tags (all pre-tagged `'pack'` per spec Q14)
- Ready to be used to scaffold the 30 fixtures in Group 6

---

### Fixture Authoring

#### Task Group 6: Initial Fixture Authoring (30 fixtures + baselines + recorded LLM responses)
**Dependencies:** Task Groups 1-5
**Location:** `discovery-service/evaluation/fixtures/`, `baselines/`, `llm-fixtures/`

> **Note:** This is the largest and most manual group. Use `annotate-fixture.ts` (Group 5) to scaffold each fixture, then hand-edit to retag gap-fill / either items, add missing expected entries, and populate `shouldNotEmit`. Each framework must include at least one happy path, one edge case, one known blind spot, and one negative example.

- [x] 6.0 Author initial fixtures and record baselines (scoped: 10 spring-classic + 5 django placeholders + 5 rails placeholders — see FIXTURES-TODO.md)
  - [x] 6.1 (No new tests — fixtures themselves drive Groups 1-4 tests indirectly; the forced-regression acceptance test in Group 7 exercises the end-to-end flow)
  - [x] 6.2 Authored 10 spring-classic fixtures from OpenMRS (`C:/tmp/openmrs-harness`)
    - Covered: Entities (Allergy-Reaction, Encounter-Provider, Visit, Concept-Attribute, Person-Attribute), Service interface (Location-Service), Exception (APIException), Enum (AllergenType), and two HBM-XML blind spots (GlobalProperty, PatientProgramAttribute)
    - Coverage: happy paths (allergy-reaction, visit, encounter-provider), edge cases (concept-attribute @AssociationOverride, allergen-type enum), blind spots (global-property, patient-program-attribute — HBM XML), negative example (api-exception with shouldNotEmit entries, person-attribute shouldNotEmit on toString/hashCode)
  - [x] 6.3 Authored 5 django placeholder fixtures from Saleor (`C:/tmp/pack-validation/repos/saleor`)
    - NOTE: django V3 pack not yet migrated (Spec 4 work). Scaffolded with empty `expected[]` + descriptive READMEs. Reduced scope from 10 to 5 per implementer instructions — placeholders exist to seed the directory; hand-authored expectations will land when the pack migrates.
    - Cases: menu-models, channel-models, page-models, giftcard-models, account-signals
  - [x] 6.4 Authored 5 rails placeholder fixtures from Discourse (`C:/tmp/pack-validation/repos/discourse`)
    - NOTE: rails V3 pack not yet migrated (Spec 4 work). Scaffolded with empty `expected[]` + descriptive READMEs. Reduced scope from 10 to 5 per implementer instructions.
    - Cases: onceoff-log-model, plugin-store-row-model, about-controller, user-badges-model, admin-confirmation-email-job
  - [ ] 6.5 Record LLM fixtures for all 30 cases (DEFERRED — no LLM fixtures recorded. Per implementer instructions, pack-only baselines first; live LLM recording is an explicit user action via `--live --record` when the user is ready.)
  - [x] 6.6 Recorded initial baselines for all three frameworks
    - spring-classic.json: packRecall=1.0, gapFillRecall=0.0, other metrics null (no LLM candidates yet)
    - django.json: all-null baseline (no V3 pack yet)
    - rails.json: all-null baseline (no V3 pack yet)
  - [x] 6.7 Verified performance targets
    - `--all` replay-mode run: ~2.6s (target <60s) — well under budget
    - Per-framework spring-classic replay-mode run: ~2.5s (target <10s)

**Acceptance Criteria:**
- 30 fixture directories exist, each with `<case>.source`, `<case>.expected.json`, `README.md`
- Every framework meets the mandatory coverage (happy / edge / blind spot / negative)
- 30 corresponding LLM fixtures exist in `llm-fixtures/`
- Baselines for spring-classic, django, rails committed in-tree
- Replay-mode `--all` run completes in <60s; per-framework run in <10s
- Per-fixture READMEs capture upstream URL, commit SHA, license, and rationale

---

### Regression Acceptance

#### Task Group 7: Forced-Regression Acceptance Verification
**Dependencies:** Task Group 6

- [x] 7.0 Verify harness catches a real regression
  - [x] 7.1 Record pre-sabotage state (healthy baseline run: spring-classic `packRecall = 1.000`, exit 0)
  - [x] 7.2 Temporarily sabotage spring-classic pack detection
    - The spec's suggested `@Controller` sabotage (emptying `CONTROLLER_ANNOTATIONS`) was attempted first but produced no regression — none of the 10 spring-classic fixtures exercise `@Controller`. This is a fixture-coverage gap, captured in REGRESSION-ACCEPTANCE.md.
    - Switched to the closest equivalent stereotype-guard sabotage: replaced `hasAnnotation(cls.annotations, 'Entity')` with `'__SABOTAGED_Entity'` in `processJpaEntity`. `@Entity` is exercised by 5 of 10 fixtures, so the sabotage triggered a meaningful pack-recall drop.
  - [x] 7.3 Run eval; captured output showing exit 1 + failed `packRecall` verdict
    - spring-classic packRecall: 1.000 → 0.188, delta -0.813, direction=decrease, status=fail
    - OVERALL: FAIL, exit code 1
    - JSON report `evaluation/reports/spring-classic-2026-04-19T14-25-08-972Z.json` records the verdict
  - [x] 7.4 Restore the adapter (one-line revert to `'Entity'`; backup file removed)
  - [x] 7.5 Run eval again; captured output showing exit 0
    - spring-classic packRecall: 1.000, OVERALL: PASS, exit code 0
    - Full `--all` run also passes (django, rails, spring-classic all green)
  - [x] 7.6 Wrote `discovery-service/evaluation/REGRESSION-ACCEPTANCE.md` with procedure + captured outputs + re-run instructions
  - [x] 7.7 Confirmed `git diff` shows no adapter changes (empty diff for `springClassic/index.ts`); only the new `REGRESSION-ACCEPTANCE.md` doc lands

**Acceptance Criteria:**
- Harness exits 0 on the healthy adapter at HEAD
- Harness exits 1 with correct failure message when a pack-detection rule is disabled
- Harness exits 0 again after the adapter is restored
- Spec-4 pack migrations can now be gated on these thresholds

---

### Documentation

#### Task Group 8: Documentation Update
**Dependencies:** Task Groups 1-7

- [x] 8.0 Update `DISCOVERY_SERVICE_EXPLAINER.md` with evaluation harness usage
  - [x] 8.1 (No new tests — documentation-only group)
  - [x] 8.2 Add an "Evaluation Harness" section to `DISCOVERY_SERVICE_EXPLAINER.md`
    - Purpose + when to run
    - Fixture storage convention (`evaluation/fixtures/<framework>/<case>/`)
    - `expected.json` schema + `shouldNotEmit` semantics
    - Five metrics + micro-average aggregation
    - CLI flags: `--framework`, `--all`, `--baseline`, `--update-baseline`, `--live`, `--record`
    - LLM fixture replay + regeneration flow (`--live --record`)
    - Baselines + per-framework threshold overrides
    - Annotation tool (`annotate-fixture.ts`) workflow
    - Performance targets (<60s `--all`, <10s per-framework)
    - Explicit CI-out-of-scope note (local-only per spec Q11)
  - [x] 8.3 Cross-link from any existing "How to add a pack" section to the evaluation workflow (N/A — no existing "How to add a pack" section in the explainer; guidance folded into §11 directly. "§11.1 Purpose + when to run" lists pack modification as the primary trigger.)
  - [x] 8.4 (No test run — documentation-only group)

**Acceptance Criteria:**
- `DISCOVERY_SERVICE_EXPLAINER.md` has a clear, complete "Evaluation Harness" section
- A new pack author can follow the doc end-to-end without re-reading the spec
- Local-only / no-CI constraint explicitly documented

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** — Shared runner library, types, fixture loader
2. **Task Group 2** — Per-metric calculators + aggregation + baseline comparison (can start as soon as Group 1's types land; partially parallelizable with Group 3)
3. **Task Group 3** — LLM fixture replay + live/record (parallelizable with Group 2 once Group 1's types land)
4. **Task Group 4** — CLI runner + output formatting + gitignore (requires Groups 1-3)
5. **Task Group 5** — Annotation tool (requires Group 1; can start in parallel with Groups 2-4 once the pipeline wrapper exists)
6. **Task Group 6** — 30-fixture authoring + LLM fixture recording + baseline recording (requires Groups 1-5; the largest manual effort in the spec)
7. **Task Group 7** — Forced-regression acceptance verification (requires Group 6)
8. **Task Group 8** — Documentation update (last, once behavior is locked in)

### Parallelization Notes

- Groups 2 and 3 can run in parallel after Group 1's types are stable.
- Group 5 (annotation tool) can run in parallel with Groups 2-4 once the shared runner's pipeline wrapper exists.
- Group 6's per-framework fixture authoring (6.2, 6.3, 6.4) can be parallelized across operators if multiple humans author fixtures concurrently.

### Scope Boundary Reminders

- Pure TypeScript work in `discovery-service/`. No Java / Liquibase / gateway / frontend changes.
- No CI integration. No `.github/` changes. No pre-commit hook. Local-only per spec Q11.
- No immediate refactor of `run-pack-local.ts` / `run-spring-classic-local.ts` — shared library availability only.
- No fixtures for the other 15 packs — those land with Spec 4.
