Build the evaluation harness that measures pack recall, gap-fill precision/recall, and hallucination rate on ground-truth-annotated source files. This is the regression-safety mechanism for all subsequent pack migrations (Spec 4) and prompt iteration.

## Context

With the V3 pipeline producing two stages of output (deterministic packs + LLM gap-fill), we need a way to measure whether prompt or pack changes improve or regress quality. Without automated metrics, every change requires subjective spot-checking — unsustainable at 18 packs.

## In scope

1. Fixture format: `discovery-service/evaluation/fixtures/<framework>/<case>/`
   - `<case>.source` — original source file (e.g. `PatientController.java`)
   - `<case>.expected.json` — ground-truth candidates the file SHOULD produce, each tagged by which producer should emit it (`'pack' | 'gap-fill' | 'either'`)
   - `README.md` — describes why this file is a fixture (edge case, happy path, known blind spot)

2. Metrics, computed per framework and aggregated:
   - **Pack recall** — % of `'pack'`-tagged expected candidates the pack actually emitted
   - **Gap-fill precision** — % of LLM-produced candidates that match an expected `'gap-fill'` or `'either'` item
   - **Gap-fill recall** — % of `'gap-fill'`-tagged expected candidates the LLM emitted
   - **Duplication rate** — LLM candidates that duplicate pack output on (type, name, filePath)
   - **Hallucination rate** — LLM candidates with no match in expected set

3. Runner: `scripts/run-evaluation.ts`
   - `--framework <id>` runs one framework
   - `--all` runs all frameworks with initial fixtures
   - `--baseline <path>` compares results to a previously-recorded baseline
   - Outputs summary table + full JSON report

4. CI integration: GitHub Action (or local pre-commit hook) that runs evaluation on every PR that touches `services/extensionPacks/**`, `services/prompts/**`, or `services/discoveryV3Pipeline.ts`. Failure threshold: any metric regresses by >5% relative from baseline.

5. Initial fixtures — 3 frameworks, ~15-20 annotated files each:
   - **spring-classic**: curated from OpenMRS (already cloned at `C:/tmp/openmrs-harness`) — pick representative Controllers, Services, Entities, POJOs-without-@Entity
   - **django**: curated from Saleor (already cloned at `C:/tmp/pack-validation/repos/saleor`) — models, views, serializers, signal handlers
   - **rails**: curated from Discourse (already cloned) — ActiveRecord models, controllers, concerns, jobs

6. Fixture annotation tooling: small CLI `scripts/annotate-fixture.ts` to scaffold `expected.json` from a file's initial run output, so humans can edit instead of starting blank.

## Out of scope

- Fixtures for other 15 packs (they come with those packs in Spec 4).
- Automated prompt tuning (future work — this spec builds the measurement, not the tuning loop).

## Key constraints

- Evaluation must run entirely locally for pack metrics (no LLM required for pack-recall); LLM stages of evaluation require API key.
- Metric thresholds configurable per-framework — different adapters have different ceilings (wxWidgets vs spring-classic aren't directly comparable).

## Done when

- `scripts/run-evaluation.ts --framework spring-classic` produces a JSON report with all 5 metrics.
- Baseline recorded for the 3 initial frameworks.
- CI fails on a forced regression (test: regress the spring-classic adapter by removing one detection, confirm CI catches it).
- Spec-4 pack migrations can be gated on passing eval thresholds.
