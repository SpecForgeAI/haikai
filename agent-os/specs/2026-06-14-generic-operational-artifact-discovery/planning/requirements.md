# Spec Requirements: Generic Operational-Artifact Discovery (D1)

## Initial Description

D1 is Spec 1 of a 6-spec discovery-completeness + net-new program that makes the
migration tool discover NON-API / internal functionality it currently misses. The
first real migration target is a Sybase / Spring-Classic / Java risk-hierarchy
system whose batch tier is CA Autosys JIL + shell scripts + plain-Java `main()`
classes + Geneos monitoring XML + Argon/TIBCO FTP — almost none of which discovery
picks up today.

D1 adds a NEW, always-on, pack-agnostic discovery pass in `discovery-service` that
LLM-summarises "unknown-but-potentially-relevant" files no dedicated parser handles,
emitting EACH as a rich `operational_artifact` Finding via the existing findings
model (no schema change). Capability clustering, JIL parsing, and batch-entrypoint
linkage are explicitly deferred to D2.

## Problem Statement / Context (verified by code-tracing)

The migration product's North Star is a like-for-like migration where a current
service+DB is treated as a black box whose insides are upgraded; discovery must be
rich enough to seed complete operation capture and the migration book-of-work. A
legacy system that is mostly shell + scheduler DSL + monitoring/connection config
is today effectively invisible to that discovery, for three concrete reasons:

1. **Hard `SOURCE_EXTENSIONS` whitelist.** Discovery ingestion is limited to a fixed
   extension allow-list (Java/TS/Py/Go/SQL/XML/YAML/contract files). `.jil`, `.pl`,
   and proprietary XML are dropped entirely.

2. **No generic / LLM fallback.** There is no pass that handles files no dedicated
   deterministic parser claims. Anything outside the packs' competence has nowhere
   to go.

3. **Scan-plan drops symbol-less files.** `.sh` files are read into a `file_structure`
   atom but are pruned out before the LLM by the scan-plan filter unless ctags
   happens to find symbols, and there is no shell-semantic pass. So even files that
   ARE read get dropped before any summarisation.

Net effect: the raw material is essentially free (every text file ≤1MB is already
read into a `file_structure` atom), yet the operationally load-bearing batch /
scheduler / monitoring / connection files never reach an LLM and never become a
durable signal. The completeness gate (a later spec) therefore sees silence where it
should see "here are 40 operational artifacts we found — account for them."

D1 closes exactly this gap and nothing more: a per-file LLM summary of the
unclaimed-but-relevant files, emitted as findings. The deliberately broad relevance
predicate (Decision 2) is the load-bearing design point — a strict extension
allow-list would simply re-create the very `SOURCE_EXTENSIONS` whitelist gap this
spec exists to close (extensionless shell scripts, `.cfg`/`.conf`/`.properties`,
proprietary configs would all be missed again).

## Requirements Discussion

The clarifying-question phase is complete. All decisions below are FINALIZED and
user-confirmed. Notable user steers captured during discussion:

- User explicitly DECLINED a cost / bytes / token budget cap; the only volume
  control is a file-count cap (Decision 3).
- D1 is accepted to touch the gateway with one small new relay route — a deliberate
  scope addition beyond "discovery-service only" — to keep prompt/model/cache
  separation clean from gap-fill (Decision 7).
- Plain `.xml` is IN by default, deduped against XML the deterministic packs already
  consumed (Decision 2).

## Confirmed Decisions

### Decision 1 — File source

D1 performs a DEDICATED re-walk of `context.repoRoot` with its own relevance filter,
reading file contents directly. This makes D1 behave identically across repo-scoped
AND service-scoped runs. It COMPLEMENTS — does not consume — the existing pre-pruned
scan plan / `sourceFiles` map; D1 does not depend on what the scan plan already
dropped.

### Decision 2 — Relevance gating (BROADER predicate, not a strict allow-list)

D1 uses a broad relevance predicate, NOT a strict extension allow-list. A file is
included when it is a text file UNCLAIMED by any deterministic parser/pack AND hits a
relevance signal, then survives the standard exclusion sets. Relevance signals (any
one suffices):

- an operational file extension, OR
- a shebang line (`#!`), OR
- residence in a priority directory (`bin/`, `scripts/`, `ops/`, `batch/`, `etc/`,
  `cron/`, `jobs/`, `deploy/`, and similar), OR
- being referenced / invoked by a known atom.

Exclusions (subtracted from the above):

- the standard exclusion sets: `node_modules`, `.git`, `build`/`dist`/`target`,
  vendored / generated / minified files, lock files / `.json` (reuse the
  skip-dir / exclude sets from `scanPlanBuilder.ts`), AND
- the existing binary / null-byte / ≥1MB filters.

Plain `.xml` is IN by default, deduped against XML the deterministic packs already
consumed (so a config XML a pack already parsed is not re-summarised).

Rationale (load-bearing): a strict allow-list would re-create the `SOURCE_EXTENSIONS`
whitelist gap this spec exists to close — it must catch extensionless shell scripts,
`.cfg` / `.conf` / `.properties`, and proprietary configs.

### Decision 3 — Volume cap (file-count ONLY)

A FILE-COUNT cap only, default ~2000, env-tunable. There is NO cost / bytes / token
budget — the user explicitly declined a cost cap. Per-file content truncation reuses
the existing line limit (`DISCOVERY_FILE_LINE_LIMIT`), truncating with a note exactly
as gap-fill does. Files beyond the count cap are recorded in ONE run-level skip
finding — never silently dropped.

### Decision 4 — Granularity

Exactly ONE `operational_artifact` finding per file — even when an artifact spans
multiple files, and even when a single script does many things. Cross-file grouping
is deferred to D2.

### Decision 5 — Finding shape (no schema change)

- `findingType`: `operational_artifact`
- `severity`: `info` (presence is a signal, not a defect)
- `confidence`: from the LLM, clamped to a sensible band
- `source`: `operational_artifact_scan`
- `createdByStage`: e.g. `findings.operationalArtifactScan`
- `category`: may mirror `artifactKind`

`detailJson` fields:

- `purpose` — what the file does
- `artifactKind` — STABLE controlled vocabulary: `batch_job` | `shell_script` |
  `scheduler_config` | `monitoring_config` | `ci_config` | `integration_config` |
  `deployment_script` | `maintenance_script` | `other`
- `behaviourBearing` — best-effort boolean: does this file DO operational work that
  must be carried over like-for-like, vs pure config / noise. Consumed by the D4
  completeness-gate spec.
- `invokes[]` — files / Java FQCNs / external commands, as plain strings
- `inputs[]` — files / DB / env / network
- `outputs[]` — files / DB / env / network
- `sideEffects[]`
- `externalSystems[]`
- `evidence[]` — snippets
- `filePath`
- `language`
- the relevance-signal that selected the file

No schema change: `findingType` / `category` are free-text and `detailJson` is open
JSONB, so the new type and the rich payload need no new table or column.

### Decision 6 — Linking (standalone)

D1 is standalone: referenced names are captured as plain strings in
`detailJson.invokes`, with NO candidate/entity resolution. This keeps D1
order-independent of candidate persistence. Resolution / linkage to candidates and
entities is D2.

### Decision 7 — LLM relay (one new gateway route)

A NEW dedicated gateway relay route for the summariser, e.g.
`POST /api/v1/discovery/v3/operational-artifact`, giving clean prompt / model /
cache separation from gap-fill. This means D1 DOES touch the gateway with one small
route — a deliberate scope addition beyond discovery-service-only.

Reuse the established gap-fill patterns:

- `promisePool` concurrency, env-tunable, default ~2
- one file per LLM call
- temperature 0
- a content-addressed response cache (a `gapFillResponseCache` analogue) for re-run
  reproducibility
- per-file soft-fail with a max-failure-rate guard
- the summariser prompt requests the strict `detailJson` JSON object

### Decision 8 — Toggle

ON by default. An env kill-switch (e.g. `OPERATIONAL_ARTIFACT_SCAN_ENABLED=true`)
plus env-tunable knobs (the file-count cap, the extension / priority-dir lists),
mirroring the `GAP_FILL_*` convention. NO per-run query param for v1.

### Decision 9 — Idempotency / re-run

Inherit existing findings semantics:

- within-run dedupe via `FindingEmitter`
- across runs, each run produces fresh `operational_artifact` findings (the dedupe
  key includes `runId`); no cross-run reconciliation
- service-scoped / incremental runs scan only files under their scope

### Decision 10 — Test strategy

- Mock `gatewayClient` — NO live LLM (per repo rule)
- Deterministic unit tests for: the relevance predicate, the caps, and the per-file
  `detailJson` shaping
- A standalone `runOperationalArtifactScan` pipeline step with its own suite,
  modeled on `llmGapFillStep`
- NO tree-sitter usage — D1 summarises, it does not parse — so no bare
  `require('tree-sitter')`

### Decision 11 — Scope

OUT of D1 (all are D2):

- Autosys JIL job-topology / DAG parsing
- plain-Java `main()` batch-entrypoint recognition
- JIL → shell → Java → DB invocation linkage
- capability clustering
- the `discovery_capability` grouping entity

D1 = per-file summaries → findings only.

## Existing Code to Reference

All reuse targets verified present in the working tree.

**Owners:**

- `discovery-service` — the new always-on pass + relevance gating + per-file emission
  to findings
- `gateway` — one new summariser relay route

**Files to model on / reuse (verified paths):**

- LLM-pass template (`promisePool` + soft-fail + cache + truncation):
  `discovery-service/src/services/llmGapFillStep.ts`
- Emission (findingType / category free-text, detailJson open):
  `discovery-service/src/services/findings/FindingEmitter.ts` and
  `discovery-service/src/services/findings/emissionSources.ts`
- Determinism / content-addressed cache:
  `discovery-service/src/services/gapFillResponseCache.ts`
- Skip-dir / exclude sets for D1 exclusions, plus the `DISCOVERY_FILE_LINE_LIMIT`
  truncation pattern: `discovery-service/src/services/scanPlanBuilder.ts`
- Relay client pattern: `discovery-service/src/services/gatewayClient.ts`
- Existing `/api/v1/discovery/v3/*` relay route to model the new route on:
  `gateway/src/routes/discoveryGapFill.ts` (registered in `gateway/src/server.ts`)
- Env / config knobs (`GAP_FILL_*` convention, `DISCOVERY_FILE_LINE_LIMIT`):
  `discovery-service/src/config.ts`

**No similar features beyond the above** were identified; D1 is a new pass built from
the gap-fill template.

## Visual Assets

No visual assets provided. D1 is a backend discovery pass; `planning/visuals/` is
empty (verified by directory listing).

## Requirements Summary

### Functional Requirements

- Add an always-on, pack-agnostic discovery pass that re-walks `context.repoRoot`
  (Decision 1) and applies a broad relevance predicate (Decision 2) to select
  unclaimed-but-relevant text files.
- For each selected file, call a new gateway summariser relay route (Decision 7) to
  produce a strict `detailJson` object, then emit exactly one `operational_artifact`
  finding (Decisions 4, 5) via the existing `FindingEmitter`.
- Cap volume by file count only (Decision 3), truncate per file by the existing line
  limit, and record overflow in one run-level skip finding.
- Gate behind an env kill-switch, ON by default, with env-tunable knobs (Decision 8).

### Reusability Opportunities

- The entire LLM-pass scaffolding (concurrency, per-file soft-fail, max-failure-rate
  guard, content-addressed cache, line-limit truncation) is lifted from
  `llmGapFillStep.ts` / `gapFillResponseCache.ts`.
- Exclusion / skip-dir sets are lifted from `scanPlanBuilder.ts`.
- Emission and finding persistence reuse `FindingEmitter` / `emissionSources.ts` with
  zero schema change.
- The new gateway route is a sibling of `discoveryGapFill.ts`.

### Scope Boundaries

**In Scope:**

- New always-on operational-artifact scan pass in `discovery-service` (re-walk +
  broad relevance predicate + file-count cap + per-file truncation).
- One new gateway relay route for the summariser (clean prompt / model / cache
  separation).
- Per-file emission of `operational_artifact` findings with the rich `detailJson`
  shape and a stable `artifactKind` vocabulary, plus a `behaviourBearing` boolean for
  the D4 completeness gate.
- Env kill-switch + tunable knobs; existing within-run / across-run findings
  semantics; service-scoped runs honour scope.
- Deterministic unit + pipeline-step tests with `gatewayClient` mocked.

**Out of Scope (all D2):**

- Capability / feature clustering and the `discovery_capability` grouping entity.
- Autosys JIL job-topology / DAG parsing.
- Plain-Java `main()` batch-entrypoint recognition.
- JIL → shell → Java → DB invocation linkage and candidate/entity resolution of the
  `invokes` strings.
- Any cost / bytes / token budget cap (explicitly declined by the user).
- Cross-run reconciliation of findings; per-run query-param toggle.

### Technical Considerations

- **No AMS schema change, no new Liquibase changeset.** `findingType` / `category`
  are free-text and `detailJson` is open JSONB.
- **discovery-service is TypeScript.** Tree-sitter jest-isolation rules apply in
  general, but D1 needs no tree-sitter (it summarises, it does not parse) — never add
  a bare top-level `require('tree-sitter')`.
- **Only edit `discovery-service/src` when no discovery run is active** (tsx watch
  auto-reload kills in-flight runs).
- **No live LLM in tests** — mock `gatewayClient`.
- D1 must be order-independent of candidate persistence (referenced names stay as
  plain strings in `detailJson.invokes`).
- Standard exclusion sets + binary / null-byte / ≥1MB filters must be honoured so the
  pass stays affordable without a cost cap.
