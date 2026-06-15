# Specification: V3 Evaluation Harness

## Goal
Provide a local, ground-truth-driven harness that measures pack recall, gap-fill precision/recall, duplication rate, and hallucination rate for the V3 discovery pipeline so Spec 4 pack migrations and prompt iteration can be gated against objective regression thresholds.

## User Stories
- As a pack author, I want to run `npx tsx scripts/run-evaluation.ts --framework spring-classic` and see a per-metric markdown summary plus a JSON report so I know whether my pack change regressed quality.
- As a prompt engineer, I want to iterate on the LLM gap-fill prompt against recorded fixtures and only re-hit the real LLM when I choose `--live`, so iteration is fast, deterministic, and free.
- As a reviewer, I want baseline updates to produce a human-readable diff in-tree so metric shifts land with an explicit, auditable commit.

## Specific Requirements

**Fixture storage convention**
- Location: `discovery-service/evaluation/fixtures/<framework>/<case>/`.
- Three files per case: `<case>.source` (full source committed in-tree), `<case>.expected.json`, `README.md`.
- Per-fixture README records upstream repo URL, commit SHA, license, and why this file was chosen (happy path, edge case, blind spot, negative example).
- `<case>.source` preserves the original filename/extension so the pipeline's filePath-driven detectors behave realistically.

**`expected.json` schema**
- Top-level shape: `{ expected: [...], shouldNotEmit: [...] }`.
- Each `expected` entry requires `type`, `name`, `tag` (`'pack' | 'gap-fill' | 'either'`); optional `description`, `notes`.
- Each `shouldNotEmit` entry requires `{ type, name }` only — any candidate matching such an entry counts as a hallucination regardless of the main expected array.
- Omit `filePath` (redundant with the case source filename) and `confidence` (producer output, not ground truth).

**Matching semantics**
- Reuse the canonical dedup key from `discovery-service/src/services/prompts/dedup.ts`: `(type, normalizeName(name), forward-slash filePath)`.
- `shouldNotEmit` entries match on `{ type, name }` only to stay robust to filePath normalization differences.
- The harness MUST NOT re-implement normalization — it imports the same helper the pipeline uses.

**Metrics**
- Pack recall = `'pack'`-tagged expected items emitted by the pack / total `'pack'`-tagged expected items.
- Gap-fill precision = LLM candidates matching an expected `'gap-fill'` or `'either'` item / total LLM candidates.
- Gap-fill recall = `'gap-fill'`-tagged expected items emitted by the LLM / total `'gap-fill'`-tagged expected items.
- Duplication rate = LLM candidates that match pack output on the dedup key / total LLM candidates.
- Hallucination rate = LLM candidates with no match in the expected set (or that match a `shouldNotEmit` entry) / total LLM candidates.
- Aggregation: per-fixture raw counts, then per-framework micro-average (sum numerators and denominators, then divide), then global aggregate.

**Runner CLI (`discovery-service/scripts/run-evaluation.ts`)**
- `--framework <id>` runs one framework's fixtures; `--all` runs all three.
- `--baseline <path>` compares against a supplied baseline; default baseline is `discovery-service/evaluation/baselines/<framework>.json`.
- `--update-baseline` writes the current run's metrics as the new baseline (human reviews the diff before commit).
- `--live` calls the real LLM via `gatewayClient.gapFill` instead of replaying recorded fixtures.
- `--record` (valid only with `--live`) captures LLM responses into `discovery-service/evaluation/llm-fixtures/<framework>/<case>.llm-response.json`.
- Default mode is fixture-replay; baselines are recorded against fixture-replay mode.

**LLM fixture replay**
- Replay location: `discovery-service/evaluation/llm-fixtures/<framework>/<case>.llm-response.json`, committed in-tree.
- Replay is implemented by swapping `gatewayClient.gapFill` with a fixture-backed stub at harness startup — same injection point existing tests use.
- Missing replay fixtures fail the run with a clear "regenerate via `--live --record`" message rather than silently skipping.

**Regression gating**
- Per-metric directional thresholds, 5% default: pack recall / gap-fill precision / gap-fill recall fail on decrease >5%; duplication rate and hallucination rate fail on increase >5%.
- Per-framework overrides via `discovery-service/evaluation/thresholds.json`.
- Any threshold breach exits with code 1; otherwise exit 0.

**Outputs**
- Human summary: markdown table to stdout showing per-framework and aggregate metric values, baseline, delta, and pass/fail per metric; per-fixture breakdown included for debugging.
- Full JSON report written to `discovery-service/evaluation/reports/<framework>-<timestamp>.json` with per-fixture raw counts, per-framework aggregates, baseline comparison, and threshold verdicts.
- Reports directory is gitignored.

**Shared evaluation library**
- Extract core scoring/aggregation/baseline-comparison logic to `discovery-service/src/evaluation/runner.ts`.
- Consumed by the new `scripts/run-evaluation.ts`; made available (but NOT immediately wired in) for `run-pack-local.ts` and `run-spring-classic-local.ts` to optionally consume later.

**Annotation tool (`discovery-service/scripts/annotate-fixture.ts`)**
- Inputs: source file path + framework id.
- Runs `runDiscoveryV3` on the file and writes `expected.json` with every produced candidate pre-tagged `'pack'`, an empty `shouldNotEmit: []`, and a stub `README.md` pre-populated with source-file metadata placeholders for the human to fill in.
- Does NOT attempt to auto-detect `'gap-fill'`/`'either'` tags — the human edits afterward to retag, add missing items, and populate `shouldNotEmit`.

**Initial fixtures and acceptance**
- 10 fixtures × 3 frameworks = 30 total: spring-classic from OpenMRS (`C:/tmp/openmrs-harness`), django from Saleor (`C:/tmp/pack-validation/repos/saleor`), rails from Discourse (`C:/tmp/pack-validation/repos/discourse`).
- Each framework's 10 fixtures MUST include at least one happy path, one edge case, one known blind spot (e.g. HBM XML for spring-classic), and one negative example exercising `shouldNotEmit`.
- Performance: `<60s` total for `--all`, `<10s` per-framework (enforced by the fixture-replay default).
- Acceptance: running against spring-classic produces all five metrics in a JSON report; baselines exist for all three frameworks; a forced regression (temporarily breaking spring-classic `@Controller` detection) fails the run with exit 1; Spec-4 pack migrations can be gated on the thresholds.

## Existing Code to Leverage

**`discovery-service/src/services/prompts/dedup.ts`**
- Exports the canonical `normalizeName` and dedup-key logic used by the pipeline itself.
- Import directly into the harness's matching module so candidate-to-expected matching stays in lockstep with production dedup.
- Eliminates risk of harness drift when dedup rules change.

**`discovery-service/scripts/run-pack-local.ts` and `run-spring-classic-local.ts`**
- Existing CLI ergonomics (arg parsing, logging style, tsx invocation pattern) to mirror in `run-evaluation.ts` for operator consistency.
- Their pack-invocation patterns are reference templates for how the shared runner library should wrap `runDiscoveryV3`.
- No immediate refactor — the shared library is simply made available for future consolidation.

**`discovery-service/scripts/batch-validate-packs.sh`**
- Illustrates multi-framework batching ergonomics; inform the `--all` flag's iteration loop and aggregate output.

**`discovery-service/src/__tests__/v3PipelineAcceptance.test.ts`**
- 12-candidate identity spot-check is the structural model for fixture-based matching.
- Mirror its assertion pattern and its `gatewayClient.gapFill` mocking approach in the harness's replay mode.

**`discovery-service/src/services/discoveryV3Pipeline.ts::runDiscoveryV3` + `services/llmGapFillStep.ts` + `services/gatewayClient.ts::gapFill`**
- `runDiscoveryV3` is the function under test — invoked per fixture by the shared runner library.
- `llmGapFillStep` and `gatewayClient.gapFill` are the mock points for both fixture-replay (default) and `--live --record` capture.

## Out of Scope
- CI integration of any kind — no GitHub Actions workflow, no `.github/` changes, no pre-commit hook. Local-only harness per explicit user decision (Q11).
- Fixtures for the other 15 packs — those land with their respective packs in Spec 4.
- Automated prompt tuning or any self-optimizing loop.
- Metric dashboards, historical trending, or time-series storage.
- Auto-fixture-discovery that scans cloned repos and picks candidates.
- External metric reporting (Datadog, Prometheus, Grafana, etc.).
- Immediate refactor of `run-pack-local.ts` / `run-spring-classic-local.ts` to consume the shared library — availability only; migration deferred.
- Automated baseline updates — baseline changes always go through human-reviewed diff.
- Non-local LLM credential management beyond what `gatewayClient` already provides.
