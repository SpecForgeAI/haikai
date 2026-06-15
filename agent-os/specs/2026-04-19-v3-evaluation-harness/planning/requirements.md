# Spec Requirements: V3 Evaluation Harness

## Initial Description

Build the evaluation harness that measures pack recall, gap-fill precision/recall, and hallucination rate on ground-truth-annotated source files. This is the regression-safety mechanism for all subsequent pack migrations (Spec 4) and prompt iteration.

With the V3 pipeline producing two stages of output (deterministic packs + LLM gap-fill), we need a way to measure whether prompt or pack changes improve or regress quality. Without automated metrics, every change requires subjective spot-checking — unsustainable at 18 packs.

The raw idea called for: fixture format at `discovery-service/evaluation/fixtures/<framework>/<case>/` (source file + `expected.json` tagged by producer + README); five metrics (pack recall, gap-fill precision, gap-fill recall, duplication rate, hallucination rate); a `scripts/run-evaluation.ts` runner with `--framework`, `--all`, `--baseline` flags; CI integration gating on 5% regression; initial fixtures for spring-classic (OpenMRS), django (Saleor), rails (Discourse); and a `scripts/annotate-fixture.ts` scaffolding tool.

## Requirements Discussion

### First Round Questions

**Q1:** How should fixture source files be stored — commit full source files in-tree, or reference by repo + commit SHA?
**Answer:** Commit full source files in-tree. Each fixture has a per-fixture `README.md` recording source repo URL, commit SHA, and license.

**Q2:** How many fixtures per framework for the initial pass — lean (5), middle (10), or thorough (15-20)?
**Answer:** 10 fixtures per framework = 30 total initially. Middle ground — enough to give meaningful recall numbers but small enough for this spec to ship tractably. More can be added incrementally during Spec 4.

**Q3:** What fields should `expected.json` contain per candidate?
**Answer:** Required: `type`, `name`, `tag` (`'pack' | 'gap-fill' | 'either'`). Optional: `description`, `notes`. Omit `filePath` (redundant with the case's source filename) and `confidence` (producer output, not ground-truth).

**Q4:** How should negative examples (things the pipeline should NOT emit) be represented?
**Answer:** Separate `shouldNotEmit: []` array on `expected.json`. Each entry matches on `{type, name}`. Any actual candidate matching a `shouldNotEmit` entry counts as a hallucination regardless of the main expected array.

**Q5:** What matching semantics should be used to compare produced candidates against expected entries?
**Answer:** Same dedup key as `services/prompts/dedup.ts` — `(type, normalizeName(name), forward-slash filePath)`.

**Q6:** Should the LLM gap-fill stage be run live against the real LLM on every eval run, or use recorded fixtures?
**Answer:** Default mode = recorded LLM fixtures (gateway responses captured once, replayed — fast, deterministic, free for local runs). Explicit `--live` flag re-runs against real LLM. Baselines are recorded against fixture-replay mode.

**Q7:** What is the regeneration flow when prompts change and recorded LLM fixtures become stale?
**Answer:** `--live --record` regenerates recorded fixtures. Developer commits fixtures + re-records baseline in the same PR.

**Q8:** Where should baselines live and how should they be updated?
**Answer:** `discovery-service/evaluation/baselines/<framework>.json` in-tree. Update via `scripts/run-evaluation.ts --framework <id> --update-baseline`. Human reviews the diff.

**Q9:** What is the regression threshold and per-metric gating logic?
**Answer:** Per-metric gating with directional logic:
- Pack recall: fail on decrease >5%
- Gap-fill precision: fail on decrease >5%
- Gap-fill recall: fail on decrease >5%
- Duplication rate: fail on INCREASE >5%
- Hallucination rate: fail on INCREASE >5%

Per-framework overrides via `evaluation/thresholds.json`.

**Q10:** How should metrics be aggregated across fixtures for baseline comparison?
**Answer:** Micro-average for baseline comparison (sum numerators/denominators across fixtures, then divide). Per-fixture breakdown shown in summary table for debugging.

**Q11:** How should CI integration be structured (GitHub Actions workflow, triggers, required checks)?
**Answer:** User explicitly declined: "Not sure why we are talking about CI and PR, so defer." REMOVE CI integration from this spec entirely. No GitHub Actions workflow. No `.github/` changes. The harness runs locally via `npm run eval` or direct `npx tsx scripts/run-evaluation.ts` invocation. CI integration is deferred to a future spec when team workflow is established. This is a significant scope cut — the raw idea's "CI integration" section becomes OUT OF SCOPE.

**Q12:** What output shape should the runner produce?
**Answer:** Human summary as markdown table to stdout + full JSON report at `discovery-service/evaluation/reports/<framework>-<timestamp>.json`. Reports dir is gitignored. Baseline comparison shows per-metric deltas inline.

**Q13:** Should evaluation code be shared with the existing `run-pack-local.ts` / `run-spring-classic-local.ts` harnesses?
**Answer:** Extract shared library at `discovery-service/src/evaluation/runner.ts` used by the new `scripts/run-evaluation.ts` AND made available for existing harnesses (`run-pack-local.ts`, `run-spring-classic-local.ts`) to optionally consume. Existing harnesses don't need immediate refactoring — just ensure the shared library exists.

**Q14:** How should the annotation tool (`scripts/annotate-fixture.ts`) behave?
**Answer:** Run pipeline on a source file, write `expected.json` pre-tagged with `'pack'` for every produced candidate, stub README with source metadata. Human edits to retag gap-fill / add missing expected items / add shouldNotEmit entries. Do NOT auto-detect tier-tags — pre-tag everything as `'pack'` for safer human review.

**Q15:** What are the performance targets?
**Answer:** <60 seconds total for `--all` run, <10 seconds per-framework for iteration.

**Q16:** Anything to add to the out-of-scope list?
**Answer:** Existing out-of-scope items stand (fixtures for other 15 packs, automated prompt tuning). Additionally add: CI integration (per Q11), metric dashboards, historical trending, auto-fixture-discovery, external metric reporting.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Existing pack-local harness — Path: `discovery-service/scripts/run-pack-local.ts`
- Feature: Spring-classic local harness — Path: `discovery-service/scripts/run-spring-classic-local.ts`
- Feature: Batch pack validation script — Path: `discovery-service/scripts/batch-validate-packs.sh`
- Feature: V3 pipeline acceptance test (12-candidate identity spot-check) — Path: `discovery-service/src/__tests__/v3PipelineAcceptance.test.ts` — foundation for fixture-matching approach
- Canonical dedup key — Path: `discovery-service/src/services/prompts/dedup.ts` — reuse for matching semantics (Q5)
- Function under test — Path: `discovery-service/src/services/discoveryV3Pipeline.ts`
- Gap-fill step (needed for fixture-replay integration) — Path: `discovery-service/src/services/llmGapFillStep.ts`
- Mock point for LLM fixture replay (`gapFill` method) — Path: `discovery-service/src/services/gatewayClient.ts`

### Follow-up Questions

No follow-up questions were needed — the 16 first-round questions produced sufficiently decisive answers.

## Visual Assets

### Files Provided:

No visual assets provided. The `planning/visuals/` directory exists but is empty.

### Visual Insights:

N/A — no visuals to analyze.

## Requirements Summary

### Functional Requirements

- Fixture storage at `discovery-service/evaluation/fixtures/<framework>/<case>/` with three files per case: full source file in-tree, `expected.json`, and per-fixture `README.md` (source repo URL, commit SHA, license).
- `expected.json` schema: required fields `type`, `name`, `tag` (`'pack' | 'gap-fill' | 'either'`); optional fields `description`, `notes`; plus a top-level `shouldNotEmit: []` array with `{type, name}` entries for negative examples.
- Five metrics computed per framework and aggregated via micro-average:
  - Pack recall — % of `'pack'`-tagged expected candidates the pack emitted
  - Gap-fill precision — % of LLM-produced candidates matching an expected `'gap-fill'` or `'either'` item
  - Gap-fill recall — % of `'gap-fill'`-tagged expected candidates the LLM emitted
  - Duplication rate — LLM candidates duplicating pack output on the dedup key
  - Hallucination rate — LLM candidates with no match in expected set (plus any candidate matching `shouldNotEmit`)
- Matching uses the canonical dedup key from `services/prompts/dedup.ts`: `(type, normalizeName(name), forward-slash filePath)`.
- Runner `scripts/run-evaluation.ts` supports:
  - `--framework <id>` — run one framework
  - `--all` — run all frameworks with initial fixtures
  - `--baseline <path>` — compare results to recorded baseline
  - `--update-baseline` — write current results as the new baseline (with human diff review)
  - `--live` — run the real LLM instead of replaying recorded fixtures
  - `--record` — (with `--live`) regenerate recorded LLM fixtures
- Default LLM mode is recorded-fixture replay; baselines recorded against fixture-replay mode.
- Output: markdown summary table to stdout + full JSON report at `discovery-service/evaluation/reports/<framework>-<timestamp>.json` (reports dir gitignored); baseline comparison shows per-metric deltas inline.
- Per-metric directional regression gating (>5% default threshold, decrease for recall/precision, increase for duplication/hallucination); per-framework overrides via `evaluation/thresholds.json`.
- Baselines stored at `discovery-service/evaluation/baselines/<framework>.json` in-tree.
- Annotation tool `scripts/annotate-fixture.ts`: runs pipeline on a source file, writes `expected.json` pre-tagged with `'pack'` for every produced candidate, stubs README with source metadata. No auto-detection of tier tags — all pre-tagged `'pack'` for human review.
- Initial fixtures: 10 per framework = 30 total (spring-classic from OpenMRS, django from Saleor, rails from Discourse).
- Shared evaluation library at `discovery-service/src/evaluation/runner.ts` consumed by the new runner and optionally available to existing harnesses.

### Reusability Opportunities

- Reuse dedup key logic from `discovery-service/src/services/prompts/dedup.ts` verbatim for candidate matching.
- Model the fixture-matching pattern after `discovery-service/src/__tests__/v3PipelineAcceptance.test.ts` (12-candidate identity spot-check).
- Extract shared evaluation runner so existing `run-pack-local.ts` and `run-spring-classic-local.ts` harnesses can eventually consume it without immediate refactor.
- LLM fixture replay mocks at `gatewayClient.gapFill` — same injection point the existing test suites already use.

### Scope Boundaries

**In Scope:**
- Fixture format, storage convention, and initial 30 fixtures (10 each × spring-classic, django, rails).
- Five metrics computed, aggregated, and reported.
- Runner script with flags enumerated above.
- Baselines in-tree + per-metric directional regression gating + per-framework threshold overrides.
- LLM fixture replay (default) and `--live`/`--record` regeneration flow.
- Annotation tool that pre-tags everything as `'pack'` for human review.
- Shared evaluation library extracted to `src/evaluation/runner.ts`.
- Local-only execution via `npm run eval` or direct `npx tsx` invocation.
- Reports directory added to `.gitignore`.

**Out of Scope:**
- CI integration — explicitly cut per Q11 (no GitHub Actions, no `.github/` changes, deferred to a future spec).
- Fixtures for the other 15 packs (come with Spec 4).
- Automated prompt tuning.
- Metric dashboards, historical trending, external metric reporting.
- Auto-fixture-discovery.
- Immediate refactor of existing `run-pack-local.ts` / `run-spring-classic-local.ts` to use the shared library (the library is made available; migration is optional/future).

### Technical Considerations

- Evaluation must run entirely locally. Pack-recall metrics need no LLM. LLM metrics use recorded fixtures by default; `--live` requires an API key.
- Performance targets: `<60s` total for `--all`, `<10s` per-framework for iteration — informs choice of fixture-replay as default and sets an upper bound on fixture count / pipeline-per-fixture overhead.
- Micro-average aggregation for baseline comparison, with per-fixture breakdown in the summary table for debugging.
- `shouldNotEmit` matches on `{type, name}` only (not filePath), so hallucination detection is robust to filePath normalization differences.
- Baseline updates go through a human-reviewed diff (not automated).
- Source files committed in-tree — requires the fixture README to capture upstream license to keep attribution clean.
- Follow existing script patterns from `scripts/run-pack-local.ts` and `scripts/run-spring-classic-local.ts` for CLI ergonomics and logging style.
- Pipeline under test is `discovery-service/src/services/discoveryV3Pipeline.ts`; gap-fill hook is `services/llmGapFillStep.ts`; LLM replay mock point is `gatewayClient.gapFill`.
