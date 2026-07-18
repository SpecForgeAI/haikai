# Haikai workflow trace logging

A single, shared, human-skimmable trace of the end-to-end migration workflow,
written by every microservice on a local dev machine. Two tiers in one file:

- **`[SUMMARY]`** — human prose, one glyph-led line per meaningful step. `grep`
  these and you get the whole run in a few vertical pages. **For the human eye.**
- **`[detail]`** — a JSON tail with the fields needed to diagnose a failure.
  **For Claude** — when something goes wrong, hand over the file and it diagnoses.

This is a **dev/investigation** facility. It is **OFF by default** (zero overhead)
and must never be on in production.

## Configuration

| Env var | Values | Default | Meaning |
|---|---|---|---|
| `HAIKAI_TRACE` | `off` \| `summary` \| `detail` | `off` | `off` = no-op; `summary` = only `[SUMMARY]` lines; `detail` = `[SUMMARY]` + `[detail]` |
| `HAIKAI_TRACE_FILE` | path | `~/.haikai/trace.log` | the shared file (all services append here). On Windows, `~` = `%USERPROFILE%`. |

When `HAIKAI_TRACE=off`, the tracer is a no-op — it must not touch the
filesystem, build strings, or serialize JSON. Read the env once at process start.

## File + concurrency

- All services append to the SAME file. Each write is **one line via a single
  append (`O_APPEND`)** — atomic for a line on a local machine, so concurrent
  writers interleave cleanly without corrupting a line. Never buffer-then-flush a
  partial line; never hold the file open exclusively.
- Ensure the parent dir exists on first write (`mkdir -p` equivalent).
- One file per machine, append-only; the run header (below) delimits runs.

## Line format (identical across all stacks)

```
{ts}  {tier}  {service}  {corr}  {body}
```

- `{ts}` — ISO-8601 UTC, millisecond precision: `2026-06-16T16:11:39.335Z`.
- `{tier}` — literally `[SUMMARY]` or `[detail]` (distinct casing → unambiguous grep).
- `{service}` — short stable name from the registry below.
- `{corr}` — space-joined `key=value` correlation pairs, **stable key order**:
  `run session job bug project arch`. Include only the ones set. Quote values
  containing spaces: `project="HiFi SVC DB Migration"`. This is the grep anchor
  (`grep session=abc123 trace.log`). **Always include `project` (and `arch`) when
  known** — they are the workflow-spanning grouping key (discovery/capture/migrate
  each have their own `run`/`session`/`job`, but a whole migration is one
  project+architecture). `run`/`session`/`job`/`bug` are the sub-threads.
- `{body}`:
  - SUMMARY → `{glyph} {message}` where glyph ∈ `▶` (start/step) `✓` (ok) `⚠` (warn) `✗` (fail).
  - detail  → `{event} {json}` where `event` is a dotted name and `json` is a
    compact single-line object that **repeats the correlation ids** plus the
    diagnostic fields.

A run starts with a header line so the summarize tool can group:

```
=== HAIKAI TRACE  run={runId}  project="{name}"  arch="{name}"  {ts} ===
```

### Worked example (this is the capture bug we just debugged)

```
=== HAIKAI TRACE  run=mig-7f3  project="HiFi SVC DB Migration"  arch="Current State"  2026-06-16T16:04:19.240Z ===
2026-06-16T16:04:19.300Z  [SUMMARY]  discovery    run=mig-7f3  ✓ code scan COMPLETED — 4 services, 45 endpoints
2026-06-16T16:05:02.110Z  [SUMMARY]  discovery    run=mig-7f3  ✓ database scan COMPLETED — profiling OFF
2026-06-16T16:04:19.240Z  [SUMMARY]  capture-svc  run=mig-7f3 session=abc123  ▶ API capture started — http://hifiuat1:10078/hifi/ auth=header(ssoToken)
2026-06-16T16:11:39.300Z  [detail]   capture-svc  session=abc123  capture.http.fail {"session":"abc123","op":"GET /accounts","status":401,"durationMs":88,"auth":"header:ssoToken"}
2026-06-16T16:11:39.335Z  [SUMMARY]  capture-svc  run=mig-7f3 session=abc123  ✗ capture COMPLETED but 0/45 captured — 45 scenarios errored (http 401 ×45: ssoToken rejected)
2026-06-16T16:12:50.900Z  [SUMMARY]  ams          run=mig-7f3 project="HiFi SVC DB Migration"  ✗ plan readiness INSUFFICIENT — baselines=0; gaps: no_api_baseline, inventory_mismatch
```

`grep '\[SUMMARY\]' trace.log` reproduces the story; `grep session=abc123` follows one capture across services.

## Helper API (same shape in every stack)

Each service constructs a tracer bound to its service name, then calls:

- `summary(glyph, message, corr?)` — write a `[SUMMARY]` line (when tier ≥ summary).
  Convenience wrappers: `step(msg, corr?)` `ok(msg, corr?)` `warn(msg, corr?)` `fail(msg, corr?)`.
- `detail(event, data?, corr?)` — write a `[detail]` line (only when tier == detail).
- `runHeader(runId, project, arch)` — write the `=== HAIKAI TRACE … ===` delimiter.
- `predicate(id, title, ok, expected, actual, corr?)` /
  `predicateSkip(id, title, why, corr?)` — predicate self-scoring layer, below.
- `stageStart(stage, corr?)` / `stageEnd(stage, corr?)` — stage banners + scorecard.
- `configHeader(config, corr?)` — startup config header.

`corr` is a small bag: `{ run, session, job, bug, project, arch }` (all optional).
The tracer formats `corr` into the line and merges it into the detail JSON.
All calls are cheap no-ops when `HAIKAI_TRACE=off`.

Stack locations:
- **Node/TS** (`gateway`, `discovery-service`, `api-migration-validation-service`):
  a self-contained `src/trace.ts` per service (no external deps; byte-identical
  content), `createTracer('service-name')`. (`mcp-server` has no tracer today.)
- **Java** (`architecture-model-service`): `com.example.architecturemodel.trace.HaikaiTrace`
  (static, no Spring dependency so it can be called from anywhere).
- **Python** (`implement-verify-service`): `src/trace.py`, `tracer("impl-verify")`.

## Service-name registry (keep stable)

`gateway` · `discovery` · `capture-svc` (api-migration-validation-service) ·
`ams` (architecture-model-service) · `mcp` (reserved; no tracer yet) ·
`impl-verify` (implement-verify-service) · `schema-apply` (schema-apply-runner,
Spec X — Liquibase-on-boot schema apply) · `data-migrate` (data-migration
runner, Spec Y — Phase-2 bulk load, lives in api-migration-validation-service).

## Predicate self-scoring layer

Every execution area of the migration workflow also emits **boolean predicate
results** so a whole run can be judged from the log alone (by the run-judge LLM
via `docs/run-judge/RUN_JUDGE_INSTRUCTIONS.md`, or a quick `grep`). Design +
predicate inventory: `agent-os/planning/2026-07-10-predicate-run-judging-design.md`.

Predicate lines ride the **`[SUMMARY]` tier** (emitted when tier ≥ summary; full
no-op when off) and use four greppable body markers, each `{glyph} {MARKER} {json}`:

```
✓ HAIKAI_PREDICATE {"id":"SCAN.EDGE.03","title":"...","verdict":"pass","expected":"...","actual":"...","corr":{"run":"mig-7f3"}}
▶ HAIKAI_STAGE_START {"stage":"SCAN"}
✗ HAIKAI_SCORECARD {"stage":"SCAN","service":"discovery","pass":14,"fail":1,"skip":2,"failed":[{"id":"...","actual":"..."}],"cumulative":{"pass":30,"fail":1,"skip":4}}
▶ HAIKAI_CONFIG {"service":"discovery","git_sha":"abc1234","db_creds_present":false}
```

Rules (locked; the run judge depends on them):

- **Ternary verdicts, never silent**: `pass` (glyph ✓) / `fail` (✗) / `skip` (⚠ —
  the check was not exercised this run; `actual` says why). The JSON key order
  above is the cross-stack contract — all three stacks emit byte-identical
  bodies for the same inputs.
- **Stage keying**: a predicate belongs to the stage named by its id prefix
  (`"SCAN.EDGE.03"` → `SCAN`). The per-process scorecard tally is keyed that way,
  so there is no ambient current-stage state to mis-attribute under concurrency.
- **`stageEnd` = the scorecard**: it emits the stage's tally plus the process-
  cumulative totals and doubles as the stage-END banner. A `HAIKAI_STAGE_START`
  with no matching `HAIKAI_SCORECARD` means the stage died mid-flight. Scorecards
  are per service process — when several processes contribute to one stage, sum
  their scorecards (predicate lines are the ground truth; scorecards are tallies).
- **`configHeader` at service startup**: git sha, trace tier, caps, and
  present/absent booleans (e.g. `db_creds_present`) — so the judge can score
  fail-closed degradations as passes when config explains them.
- **No secrets, ever**: counts, ids, classifications, capped snippets only
  (`expected`/`actual` capped at 400 chars; scorecard `failed[].actual` at 160;
  `failed[]` at 25 entries).

## Event taxonomy

**SUMMARY — across the whole workflow** (one line per meaningful step/outcome):
- discovery: run started/completed (code/database), counts, profiling on/off.
- target/scoping: scoping + target-state conversations completed.
- API baseline: capture started (base url + auth), capture completed (**X/Y captured, Z errored**), baseline saved (draft), baseline activated.
- readiness: plan readiness assessed → verdict + the gap list.
- migrate/execute: run started, spec dispatched, build-results received (outcome), run deployed.
- schema apply (Spec X): changelog applied per Liquibase context → `EXEC.SCHEMA.*`.
- data migrate (Spec Y): per-table bulk load + count reconcile → `EXEC.DATA.*`.
- reconcile: reconcile started/completed, breaks count, circuit-breaker trips, verdict posted.

**DETAIL — concentrated where failures hide** (capture, readiness, reconcile):
- capture: per-scenario start/end (terminal tool, **captures persisted count**), each HTTP attempt (op, status, durationMs), `createCapture` ok/fail, diagnostics emitted (type), the mutating-gate decision.
- readiness: the inputs + verdict — `findings`, `totalBaselines`, `activeBaselineCount`, `mappings`, per-axis readiness, and the full resolved gap list with reasons.
- reconcile: per-break (op, kind, severity, volatility_source), auto-dispositions, scoped re-reconcile, circuit-breaker, the verdict round-trip request/response.

Claude owns the detail fields — add whatever makes a failure self-diagnosing from
the file alone; bias toward including ids, outcomes, and the inputs to any
decision/gate.

## `summarize` helper

A dependency-free Node script `scripts/haikai-trace-summarize.mjs`:
`node scripts/haikai-trace-summarize.mjs [file]` (default `$HAIKAI_TRACE_FILE` or
`~/.haikai/trace.log`). It reads the file, **groups by `project` (+`arch`)**, and
prints a clean, column-aligned block of the `[SUMMARY]` lines per project (a
regenerated "top summary" on demand) — so a literal top-summary view exists
without fighting the append-only, multi-writer live file.
`--detail <session|run|job-id>` additionally interleaves the matching `[detail]`
lines for one correlation id. Built + smoke-tested.
