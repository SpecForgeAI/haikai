# Specification: Generic Operational-Artifact Discovery (D1)

## Goal
Add an always-on, pack-agnostic discovery pass in `discovery-service` that LLM-summarises every unclaimed-but-relevant text file (shell, Autosys JIL, Perl, monitoring/connection XML, CI YAML, proprietary configs) into exactly one rich `operational_artifact` Finding, so operationally load-bearing batch/scheduler/monitoring files stop being invisible to discovery — with no AMS schema change.

## User Stories
- As a migration architect, I want every operational artifact (shell scripts, scheduler configs, monitoring XML) summarised as a durable Finding so the later completeness gate can say "here are 40 artifacts we found — account for them" instead of silence.
- As a discovery pipeline maintainer, I want the new pass to reuse the gap-fill LLM scaffolding (concurrency, soft-fail, content-addressed cache, line-limit truncation) so it adds no new failure modes and stays affordable without a cost cap.

## Specific Requirements

**New always-on operational-artifact scan pass (D1, D9)**
- New standalone pipeline step `runOperationalArtifactScan` in `discovery-service/src/services`, modeled on `llmGapFillStep.ts` (`runLlmGapFill`) and `llmBehaviourCaptureStep.ts` (exported `*StepInput` / `*StepOutput` interfaces).
- Performs a DEDICATED re-walk of `context.repoRoot`, reading file contents directly — it COMPLEMENTS, does not consume, the pre-pruned scan plan / `sourceFiles` map, so files the scan plan already dropped are still seen.
- Behaves identically for repo-scoped AND service-scoped runs; service/incremental runs honour scope by re-walking only files under the run's subfolder/include-paths (reuse the `subfolder` + `ScanPlanFilterOptions` include/exclude prefix logic from `scanPlanBuilder.buildScanPlanFromFilesystem`).
- Inherits findings idempotency: within-run dedupe via `FindingEmitter`; across runs each run produces fresh findings (dedupe key includes `runId`); NO cross-run reconciliation.
- Must only be edited / run when no discovery run is active (tsx watch auto-reload kills in-flight runs).

**Broad relevance predicate (D2)**
- A file is IN when it is a text file UNCLAIMED by any deterministic parser/pack AND hits at least one relevance signal, then survives the exclusion sets.
- Relevance signals (any one suffices): operational file extension (env-tunable list) OR a shebang first line (`#!`) OR residence in a priority directory (`bin/`, `scripts/`, `ops/`, `batch/`, `etc/`, `cron/`, `jobs/`, `deploy/`, and similar; env-tunable list) OR being referenced/invoked by a known atom.
- This is deliberately NOT a strict allow-list: a strict extension whitelist would re-create the `SOURCE_EXTENSIONS` gap (it must catch extensionless shell scripts, `.cfg`/`.conf`/`.properties`, `.jil`, `.pl`, proprietary configs).
- Plain `.xml` is IN by default, deduped against XML the deterministic packs already consumed (a config XML a pack parsed is not re-summarised) — "unclaimed by a parser" is the gate.

**Exclusions and affordability filters (D2)**
- Subtract the standard skip-dir / exclude sets from `scanPlanBuilder.ts`: `SKIP_DIRECTORIES` (`node_modules`, `.git`, `build`/`dist`/`target`/`out`, etc.), `EXCLUDED_FILENAMES` (lock files, `package.json`), `EXCLUDED_EXTENSIONS` (`.json`, `.lock`), vendored/generated/minified files.
- Subtract binary / null-byte / ≥1MB files (detect a NUL byte in the read buffer; reject by size before/at read).
- These exclusions are what keep the always-on pass affordable WITHOUT a cost cap — they must be honoured.

**File-count cap and per-file truncation (D3)**
- A FILE-COUNT cap ONLY, default ~2000, env-tunable. There is NO cost / bytes / token budget (explicitly declined).
- Per-file content truncation reuses `DISCOVERY_FILE_LINE_LIMIT` (config.ts, default 10000), truncating with a note exactly as gap-fill does.
- Files beyond the count cap are recorded in ONE run-level skip Finding (count + a sample of skipped paths) — NEVER silently dropped.

**Per-file summariser call (D7)**
- One LLM call per selected file via a NEW `gatewayClient` method (e.g. `summariseOperationalArtifact(prompt, filePath, runId)`) targeting the new gateway route; mirror the `gapFill` transport (429/5xx retry + `Retry-After`-aware backoff + typed error class).
- Concurrency via the hand-rolled `promisePool` pattern, env-tunable (default ~2).
- Content-addressed reproducibility cache: a `GapFillResponseCache` analogue (new instance, reuse the approach; note the existing file is lowercase `gapFillResponseCache.ts`), keyed on `(normalized prompt + model + temperature 0)`.
- Per-file soft-fail recorded on a `failures[]` list; the run continues; stage marked `failed` only when the failure rate exceeds a max-failure-rate guard (mirror `GAP_FILL_MAX_FAILURE_RATE`, default 0.2).
- The summariser prompt requests the strict `detailJson` JSON object below; parse + validate, dropping a single file's output on malformed JSON (counts as that file's soft-fail).

**Finding emission shape (D4, D5, D6)**
- Emit EXACTLY ONE `operational_artifact` Finding per file (even when one artifact spans files or one script does many things — grouping is D2).
- Build a `FindingEmitInput` and route it onto the SAME post-persist emission boundary the pipeline already uses (`collectedFindingInputs` → `runManager.emitPipelineFindingsForRun` via `findingEmitter`); do NOT add a parallel emitter.
- Fixed fields: `findingType: 'operational_artifact'`, `category` mirrors `artifactKind`, `severity: 'info'`, `confidence` from the LLM (clamp to a sensible band), `source: 'operational_artifact_scan'`, `createdByStage: 'findings.operationalArtifactScan'`; no `reviewStatus` (let AMS default `pending_review`); `links: []` (standalone — D6).
- `detailJson` fields: `purpose`, `artifactKind` (stable vocab below), `behaviourBearing` (best-effort boolean — does it do operational work that must carry over like-for-like, consumed by the D4 completeness gate), `invokes[]`, `inputs[]`, `outputs[]`, `sideEffects[]`, `externalSystems[]`, `evidence[]` (snippets), `filePath`, `language`, and the relevance-signal that selected the file.
- `invokes[]` / `inputs[]` / `outputs[]` are PLAIN STRINGS only — NO candidate/entity resolution (D6 keeps D1 order-independent of candidate persistence; resolution is D2).

**Stable artifactKind vocabulary (D5)**
- Controlled set: `batch_job` | `shell_script` | `scheduler_config` | `monitoring_config` | `ci_config` | `integration_config` | `deployment_script` | `maintenance_script` | `other`.
- Normalise any LLM value outside the set to `other` (do not invent new kinds).

**New gateway summariser relay route (D7)**
- New route file (sibling of `gateway/src/routes/discoveryGapFill.ts`), e.g. `POST /api/v1/discovery/v3/operational-artifact`, registered on the existing `/api/v1/discovery` mount in `gateway/src/server.ts` (export through `gateway/src/routes`).
- Stateless relay: accept `{ prompt, filePath, runId }`, validate non-empty, forward to `getLlmClient().sendChatRequest` with `{ tools: [], temperature: 0 }`, return `{ content, usage }` verbatim — gives clean prompt/model/cache separation from gap-fill (the prompt is composed in discovery-service, NOT loaded gateway-side).

**No schema change (D5)**
- `findingType` / `category` are free-text and `detailJson` is open JSONB, so the new type and rich payload need NO new AMS table/column and NO new Liquibase changeset; persist via the existing `archModelClient.createDiscoveryFinding` / `bulkCreateDiscoveryFindings` path.

**Env toggle and knobs (D8)**
- ON by default. Env kill-switch (e.g. `OPERATIONAL_ARTIFACT_SCAN_ENABLED=true`) plus env-tunable knobs: the file-count cap, the operational-extension list, and the priority-dir list — mirroring the `GAP_FILL_*` convention in `config.ts`. NO per-run query param for v1.

## Visual Design
No visual assets provided. D1 is a backend discovery pass; `planning/visuals/` is empty (verified by directory listing).

## Existing Code to Leverage

**`discovery-service/src/services/llmGapFillStep.ts` (`runLlmGapFill`)**
- Template for the whole LLM-pass scaffold: hand-rolled `promisePool` concurrency limiter, per-file `processFile` with cache-hit/miss → relay → parse → soft-fail, `failures[]` accumulation, and the `failureRate > maxFailureRate ? 'failed' : 'completed'` stage-status rule.
- Reuse the env-reader idiom (`readConcurrency` / `readMaxFailureRate`) and the per-file truncation-aware sourceCode contract; do NOT reuse its candidate-shaping (D1 emits findings, not candidates).

**`discovery-service/src/services/gapFillResponseCache.ts` (`GapFillResponseCache`)**
- Content-addressed, in-process, per-run cache keyed on `(normalizePromptForHash(prompt) + model + temperature)`; instantiate a fresh analogue for the operational-artifact relay (reuse the approach + `temperature 0`, do not share the gap-fill instance).

**`discovery-service/src/services/findings/FindingEmitter.ts` + `emissionSources.ts`**
- `FindingEmitInput` is the exact shape to build (`findingType`/`category`/`severity`/`title`/`detailJson`/`confidence`/`source`/`createdByStage`/`links`); `findingEmitter` normalises + dedupes (within-run, key includes `runId`) + soft-fails on AMS error. Add an `emissionSources.ts` builder (e.g. `buildOperationalArtifactFinding`) following `buildDeferredSurfacePresentFinding` (info/advisory, run-level `links: []`, `detailJson`-rich).

**`discovery-service/src/services/scanPlanBuilder.ts`**
- Reuse `SKIP_DIRECTORIES` / `EXCLUDED_FILENAMES` / `EXCLUDED_EXTENSIONS` for D1's exclusions, the recursive `walk` + `ScanPlanFilterOptions` include/exclude-prefix logic for the scoped re-walk, and `DISCOVERY_FILE_LINE_LIMIT` for truncation. D1's predicate is the broad inverse of this file's strict `SOURCE_EXTENSIONS` allow-list.

**`gateway/src/routes/discoveryGapFill.ts` + `discovery-service/src/services/gatewayClient.ts` (`gapFill`)**
- The relay route is a near-clone of `discoveryGapFillRouter` (validate body, single user message, `temperature: 0`, verbatim `{ content, usage }`); the client method clones `gapFill`'s retry/backoff transport and typed-error surfacing. Register the route exactly like `discoveryGapFillRouter` on `/api/v1/discovery` in `server.ts`.

## Out of Scope
- Capability / feature clustering and the `discovery_capability` grouping entity (D2).
- Autosys JIL job-topology / DAG parsing (D2).
- Plain-Java `main()` batch-entrypoint recognition (D2).
- JIL → shell → Java → DB invocation linkage and candidate/entity resolution of the `invokes` strings (D2).
- Any cost / bytes / token budget cap (explicitly declined by the user — file-count cap only).
- Cross-run reconciliation / deduplication of findings.
- A per-run query-param toggle for v1 (env kill-switch only).
- Any AMS schema change, new table/column, or new Liquibase changeset.
- Any tree-sitter usage or new bare `require('tree-sitter')` (D1 summarises, it does not parse).
- Live-LLM in tests (mock `gatewayClient`).
