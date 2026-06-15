# Discovery Performance Scoring — Process

## What this folder is

`discovery-service/perf/` contains the scoring system for discovery runs.
Every discovery run can be scored by an LLM using the rubric in
`RUBRIC.md`; the per-run results are written as markdown under `runs/`,
and a one-row entry per scored run is appended to `scoresheet.md`.

Per-pack "golden runs" — the best-known scored run for each
(language, framework) combination — live under `golden-runs/`. They
serve as the historical anchor for new runs against the same pack so
scoring drifts less over time.

## When scoring fires

Scoring is **fire-and-forget after a discovery run completes**. The hook
lives in `services/runManager.ts` (both project-scoped and
service-scoped paths), invoked AFTER `bulkSaveCandidates` completes.
Failure to score never fails the run.

### Default behaviour

Auto-scoring is **on by default** via the
`DISCOVERY_PERFORMANCE_AUTO_SCORE` config flag. Override per-run via the
`doPerformanceRun` query param on the run-start endpoint:

| `DISCOVERY_PERFORMANCE_AUTO_SCORE` | `?doPerformanceRun=` query | Result |
|---|---|---|
| `true` (default) | unset | Score the run |
| `true` | `false` | Skip scoring for this run |
| `false` | unset | Skip scoring |
| `false` | `true` | Score this run only |

## How a score is computed

1. `runManager.ts` calls `performancePostRun.scoreRun({ runId, projectId })`.
2. `performancePostRun.ts` loads:
   - All candidates for the run (from `archModelClient`)
   - The discovery_run record (for pack combo, mode, tier, run duration)
   - The current golden anchor for the pack combo (from
     `golden-runs/<lang>-<framework>.md`), if any
3. `performanceHeuristics.ts` runs deterministic obvious-gap checks
   (e.g. "Spring + 0 controllers", "JPA pack + 0 entities") and produces
   a `deterministicFlags[]` list.
4. The LLM scoring prompt is composed:
   - Full `RUBRIC.md` content as the system prompt
   - Pack combo + weight set selection
   - Golden anchor block (if available; otherwise tagged `confidence: 'no-baseline'`)
   - Deterministic flags as pre-computed signals
   - Per-type counts summary (one number per type) + 10 sampled candidates per type
4. The LLM emits structured JSON matching the schema in `RUBRIC.md`.
5. `performancePostRun.ts` writes:
   - `runs/<date>-<runId>-<serviceSlug>.md` with the score breakdown
     and reasoning
   - One row appended to `scoresheet.md` (read-merge-write under a
     `.scoresheet.lock` lockfile to handle concurrent runs)
6. **Self-improving golden**: if the new run's overall score exceeds the
   current golden's score for that pack combo, the golden is promoted —
   the new run's MD becomes the new golden, the prior golden is
   demoted (its row stays in the scoresheet but is no longer marked
   `is_golden: true`).

## File layout

```
discovery-service/perf/
├── PROCESS.md                          # this file
├── RUBRIC.md                           # scoring authority
├── scoresheet.md                       # central table — every scored run
├── golden-runs/
│   └── <language>-<framework>.md       # one per pack combo, points at the best run
└── runs/
    └── <date>-<runId>-<serviceSlug>.md # one per scored run
```

## Manual invocation (Phase 1 / debugging)

To score a run that was not auto-scored (auto-scoring was off, or the
run pre-dates auto-scoring), use the CLI:

```
cd discovery-service
npx tsx scripts/score-discovery-run.ts <projectId> <runId>
```

The CLI does the same work as the auto-trigger: loads candidates, runs
heuristics, calls the LLM, writes the per-run MD, updates the
scoresheet.

## Key defaults (configurable via env vars)

| Setting | Default | Override |
|---|---|---|
| LLM model | (gateway's globally-configured `openaiModel`) | gateway env vars |
| Sample size per type | 10 | `DISCOVERY_PERFORMANCE_SAMPLE_SIZE` |
| Lockfile retry timeout | 30s | hardcoded |
| Auto-score on run completion | `true` | `DISCOVERY_PERFORMANCE_AUTO_SCORE` |

## Model selection

Performance scoring deliberately uses the **same OpenAI model** the rest
of the product uses (gap-fill, tech-hints resolution, etc.) so scoring
quality is consistent with the data being scored. The gateway's
`sendChatRequest` reads `config.openaiModel` for every call regardless
of caller-supplied hints; there is no per-route model override on the
performance scoring path. Change the global model via the gateway's
existing model-selection env var.

## Cost expectations

The actual cost per scored run depends on which model the gateway is
configured to use. Token usage per scored run:

- Input: ~15k tokens (full RUBRIC.md system prompt + golden anchor +
  per-type counts + 10 samples per type, plus formatting overhead)
- Output: ~3k tokens (structured JSON with per-type axes, reasoning,
  cross-cutting axes, anomalies)

For reference:

| Model | Per-run cost (rough) |
|---|---|
| `gpt-4o-mini` | ~$0.004 |
| `gpt-4o` | ~$0.05 |
| `gpt-5` | varies with provider pricing |

If your global model is on the more expensive end and the additional
LLM cost per discovery run is undesirable, set
`DISCOVERY_PERFORMANCE_AUTO_SCORE=false` on discovery-service and
invoke scoring manually via `scripts/score-discovery-run.ts` for the
runs you actually want scored.

## Failure modes & handling

| Failure | Behaviour |
|---|---|
| LLM API error | Log, write `runs/<date>-<runId>-FAILED.md` with the error, skip scoresheet update |
| LLM returns malformed JSON | Log, attempt one retry with stricter prompt, then fail as above |
| `scoresheet.md` lock contention | Retry with backoff up to 30s, then log + skip scoresheet update (per-run MD still written) |
| Unknown pack combo | Score with no golden anchor, tag `confidence: 'no-baseline'`, write everything as normal |
| Golden run file missing/corrupt | Treat as no golden, log warning |
| Discovery run candidates empty | Skip scoring entirely (nothing to score), log info |

## What gets git-tracked

Everything under `discovery-service/perf/` is git-tracked:

- `PROCESS.md`, `RUBRIC.md` — authoring docs
- `scoresheet.md` — versioned ledger of all scored runs
- `golden-runs/*.md` — versioned record of each pack's best run
- `runs/*.md` — versioned record of each scored run

This means scoring history travels with the codebase and can be
diffed/inspected/audited. If sensitive data ever ends up in a candidate
sample (e.g. real customer URLs in an endpoint), the per-run MD would
expose it — review samples before merging if scoring runs against a
production codebase. (Defensive option: redact URLs/emails in
`performancePostRun.ts` before writing the MD.)

## What does NOT get git-tracked

`.scoresheet.lock` — the lockfile (in `.gitignore`).

## Versioning

`RUBRIC.md` carries an implicit version (the `rubricVersion` field in
the JSON output). Bump it when the rubric changes meaningfully. Old
runs scored against rubric v1 stay at v1; their `runs/*.md` records the
version they were scored under so historical scores remain interpretable.

Scoresheet rows include a `rubricVersion` column so cross-version
comparisons are flagged in review.

---

## Phases (status)

- **Phase 1 (DONE):** rubric, process, scoresheet, golden-runs/<java-spring-classic>, CLI script, OpenMRS run 4 scored as the seed golden.
- **Phase 2 (DONE):** auto-trigger hook in runManager + gateway client method + `doPerformanceRun` query param + tests.
- **Phase 3 (DONE):** deterministic heuristic checks, self-improving golden logic.
- **Phase 4 (NOT DONE — deferred):** UI to view scoresheet + per-run MD inline.
