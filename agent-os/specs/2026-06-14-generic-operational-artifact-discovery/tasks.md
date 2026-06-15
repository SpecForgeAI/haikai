# Task Breakdown: Generic Operational-Artifact Discovery (D1)

## Overview
Total Tasks: 4 task groups

A NEW always-on, pack-agnostic `discovery-service` pass that LLM-summarises every
unclaimed-but-relevant text file (shell / Autosys JIL / Perl / monitoring XML / CI
YAML / proprietary config) into exactly one rich `operational_artifact` Finding,
reusing the gap-fill LLM scaffolding and the existing findings model with NO AMS
schema change and NO Liquibase changeset. The pass talks to ONE new dedicated
gateway summariser relay route.

Decisions D1-D11 are FINALIZED in
`agent-os/specs/2026-06-14-generic-operational-artifact-discovery/planning/requirements.md`.

**Repo-wide guardrails that apply to EVERY group below:**
- NO live LLM in any test. discovery-service mocks `gatewayClient`; gateway mocks
  `../services/llmClient` (`getLlmClient`) exactly as
  `gateway/src/__tests__/discoveryGapFill.test.ts` does.
- NO tree-sitter and NO new bare `require('tree-sitter')` anywhere (D1 summarises,
  it does not parse). The tree-sitter jest-isolation rules are therefore N/A for
  this spec.
- NO AMS work, NO new table/column, NO Liquibase changeset (`findingType` /
  `category` are free-text, `detailJson` is open JSONB).
- Only edit `discovery-service/src/**` when no discovery run is active (tsx watch
  auto-reload kills in-flight runs).
- Reuse, do not fork: emission flows through the existing `collectedFindingInputs`
  -> `runManager.emitPipelineFindingsForRun` -> `findingEmitter` boundary. No
  parallel emitter.

## Task List

### Gateway Layer

#### Task Group 1: Summariser Relay Route
**Dependencies:** None

The discovery-service composes the whole summariser prompt; this route is a
stateless relay (clean prompt/model/cache separation from gap-fill). Near-clone of
`gateway/src/routes/discoveryGapFill.ts` (`discoveryGapFillRouter`).

- [x] 1.0 Complete the gateway summariser relay route
  - [x] 1.1 Write 2-8 focused tests for the new relay route
    - Limit to 2-8 highly focused tests maximum.
    - Mock `../services/llmClient` `getLlmClient().sendChatRequest` (the LLM-guard)
      following `gateway/src/__tests__/discoveryGapFill.test.ts` verbatim — NO live
      LLM, and `architectureModelClientMock` where the harness needs it.
    - Cover only: (a) happy path returns `{ content, usage }` verbatim from the
      mocked client; (b) `sendChatRequest` is invoked with `{ tools: [], temperature: 0 }`;
      (c) a 400 on empty/missing `prompt`. Skip exhaustive body-validation permutations.
  - [x] 1.2 Create the new route file `gateway/src/routes/discoveryOperationalArtifact.ts`
    - Export `discoveryOperationalArtifactRouter` (Router), modeled on
      `discoveryGapFillRouter`.
    - Endpoint `POST /v3/operational-artifact` (so it serves
      `POST /api/v1/discovery/v3/operational-artifact` once mounted).
    - Accept `{ prompt, filePath, runId }`; validate each is a non-empty string,
      returning the same 400 error shape as the gap-fill route on failure.
    - Single user message (no system message — the caller-composed prompt is
      self-contained); forward to `getLlmClient().sendChatRequest(messages, requestId, correlationId, { tools: [], temperature: 0 })`.
    - Return `{ content: llmResponse.content || '', usage: llmResponse.usage }`
      verbatim; 500 on thrown error (mirror gap-fill's catch + logger usage).
  - [x] 1.3 Register the route in the routes barrel + server
    - Add `export { discoveryOperationalArtifactRouter } from './discoveryOperationalArtifact';`
      to `gateway/src/routes/index.ts` (alongside `discoveryGapFillRouter` /
      `discoveryBehaviourCaptureRouter`).
    - Import it in `gateway/src/server.ts` and mount with
      `app.use('/api/v1/discovery', discoveryOperationalArtifactRouter);` next to the
      existing `discoveryGapFillRouter` mount (and add to the `listMountedRoutes`
      diagnostics block if that file lists discovery routes).
  - [x] 1.4 Ensure gateway route tests pass
    - Run ONLY the 2-8 tests written in 1.1 (gateway jest, targeted).
    - Run `npx tsc --noEmit` for the gateway package.
    - Do NOT run the entire gateway suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass with the LLM client mocked (no live LLM).
- `POST /api/v1/discovery/v3/operational-artifact` relays at `temperature: 0`,
  `tools: []`, returns `{ content, usage }` verbatim, and 400s on an empty body.
- Route is exported from the barrel and mounted in `server.ts` identically to the
  gap-fill relay.
- Gateway `tsc --noEmit` is clean.

### Discovery-Service Layer — Relevance Gating

#### Task Group 2: Relevance Predicate, Exclusions, and File-Count Cap (pure)
**Dependencies:** None (can proceed in parallel with Group 1)

A pure, deterministically unit-testable module: the BROAD inverse of
`scanPlanBuilder.SOURCE_EXTENSIONS`. No I/O, no LLM, no findings — just "is this
file in scope, and which relevance signal selected it" plus the cap arithmetic.
This is the load-bearing design point (D2) — a strict allow-list would re-create
the `SOURCE_EXTENSIONS` gap.

- [x] 2.0 Complete the relevance gating + cap module
  - [x] 2.1 Write 2-8 focused tests for the predicate + cap
    - Limit to 2-8 highly focused tests maximum.
    - Cover only: (a) INCLUDES a shell script (shebang, no extension), a `.jil`,
      and a monitoring/connection `.xml`; (b) EXCLUDES a vendored/`node_modules`
      file, a lock/`.json` file, and a `.java`/`.ts` file already claimed by a
      deterministic parser; (c) the relevance-signal returned is the right kind
      (extension vs shebang vs priority-dir vs referenced-by-atom); (d) the
      file-count cap selects the first N and reports the overflow set.
    - Skip exhaustive enumeration of every extension and every priority dir.
  - [x] 2.2 Add env knobs to `discovery-service/src/config.ts`
    - Follow the `GAP_FILL_*` / `DISCOVERY_*` convention already in `config.ts`.
    - `OPERATIONAL_ARTIFACT_SCAN_ENABLED` (boolean, default `true` — ON by default;
      parse like `DISCOVERY_PERFORMANCE_AUTO_SCORE`).
    - `OPERATIONAL_ARTIFACT_FILE_CAP` (int, default ~2000).
    - `OPERATIONAL_ARTIFACT_EXTENSIONS` (comma-separated operational-extension list,
      with a sensible default set: `.sh`, `.bash`, `.ksh`, `.pl`, `.jil`, `.cfg`,
      `.conf`, `.properties`, `.ini`, `.env`, `.cmd`, `.bat`, `.ps1`, and similar).
    - `OPERATIONAL_ARTIFACT_PRIORITY_DIRS` (comma-separated, default `bin`,
      `scripts`, `ops`, `batch`, `etc`, `cron`, `jobs`, `deploy`, and similar).
    - Reuse `DISCOVERY_FILE_LINE_LIMIT` for truncation (do NOT add a new line knob).
  - [x] 2.3 Create the relevance predicate module (e.g. `operationalArtifactRelevance.ts`)
    - Import and SUBTRACT the exclusion sets from `scanPlanBuilder.ts`:
      `SKIP_DIRECTORIES`, `EXCLUDED_FILENAMES`, `EXCLUDED_EXTENSIONS` (export them
      from `scanPlanBuilder.ts` if not already exported, rather than duplicating).
    - Implement the BROAD include predicate: a file is IN when it is UNCLAIMED by a
      deterministic parser/pack AND hits >=1 relevance signal:
      operational-extension OR shebang (`#!` first line) OR priority-dir residence
      OR referenced-by-a-known-atom — then survives the exclusion sets.
    - Plain `.xml` is IN by default but DEDUPED against XML the packs already
      consumed ("unclaimed by a parser" is the gate); accept the set of
      pack-consumed/claimed file paths as an input so the predicate can exclude
      them.
    - Reject binary / null-byte (detect a NUL byte in the read buffer) and
      `>= 1MB` files (reject by size at/just-before read).
    - Return both the boolean AND the selecting relevance-signal label (it rides on
      `detailJson` later).
  - [x] 2.4 Implement the file-count cap + overflow accounting (pure)
    - Deterministic ordering (e.g. sorted path order, mirroring
      `buildScanPlanFromFilesystem`'s sort) then take the first
      `OPERATIONAL_ARTIFACT_FILE_CAP`.
    - Return the selected files PLUS the overflow list (count + a sample of skipped
      paths) so the pass (Group 3) can emit ONE run-level skip finding. NEVER drop
      silently.
  - [x] 2.5 Ensure relevance-gating tests pass
    - Run ONLY the 2-8 tests written in 2.1 (discovery-service jest, targeted; mock
      not even needed here — this module is pure).
    - Run `npx tsc --noEmit` for discovery-service.
    - Do NOT run the entire discovery-service suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- Predicate INCLUDES extensionless shell, `.jil`, monitoring `.xml`; EXCLUDES
  vendored/binary/lock/JSON and parser-claimed source; plain `.xml` already
  consumed by a pack is NOT re-selected.
- The cap selects the first N deterministically and surfaces the overflow set.
- Env knobs follow the `GAP_FILL_*`/`DISCOVERY_*` convention and default the pass ON.
- discovery-service `tsc --noEmit` is clean.

### Discovery-Service Layer — The Pass

#### Task Group 3: `runOperationalArtifactScan` Pipeline Step + Wiring
**Dependencies:** Task Group 1 (relay route), Task Group 2 (gating + knobs)

The always-on pass: a standalone step modeled on `llmGapFillStep.ts` that re-walks
`context.repoRoot`, applies Group 2's gating, calls the new relay (concurrency +
soft-fail + content-addressed cache), and emits ONE `operational_artifact`
`FindingEmitInput` per file onto the existing emission boundary.

- [x] 3.0 Complete the operational-artifact scan pass
  - [x] 3.1 Write 2-8 focused tests for the pass
    - Limit to 2-8 highly focused tests maximum.
    - Mock `gatewayClient` (the new summariser method) — NO live LLM.
    - Cover only: (a) end-to-end on a tiny fixture tree → exactly ONE
      `operational_artifact` `FindingEmitInput` per selected file with the fixed
      fields + `detailJson` shape; (b) per-file soft-fail (a malformed-JSON / thrown
      relay for one file) does not abort, and the failure-rate guard flips
      `stageStatus` to `failed` only above the threshold; (c) cache-hit reuse (a
      byte-identical prompt does not re-call the relay).
    - Skip exhaustive permutations; the predicate/cap themselves are covered in 2.1.
  - [x] 3.2 Add the gateway client method `summariseOperationalArtifact`
    - In `discovery-service/src/services/gatewayClient.ts`, add
      `summariseOperationalArtifact(prompt, filePath, runId)` POSTing to
      `/api/v1/discovery/v3/operational-artifact`.
    - Clone `gapFill`'s transport verbatim: 429/5xx retry, `Retry-After`-aware
      backoff, and a typed `OperationalArtifactGatewayError` (mirror
      `GapFillGatewayError`).
  - [x] 3.3 Add a content-addressed cache analogue
    - A `GapFillResponseCache`-style instance for this relay (reuse the APPROACH;
      the existing file is lowercase `gapFillResponseCache.ts`). Either reuse
      `GapFillResponseCache` directly with a fresh instance, or add a thin sibling.
    - Key on `(normalizePromptForHash(prompt) + model + temperature 0)`; instantiate
      fresh per run; do NOT share the gap-fill instance.
  - [x] 3.4 Add the summariser prompt + strict-JSON contract
    - Compose the per-file prompt in discovery-service (NOT gateway-side) requesting
      the strict `detailJson` object: `purpose`, `artifactKind`, `behaviourBearing`
      (boolean), `invokes[]`, `inputs[]`, `outputs[]`, `sideEffects[]`,
      `externalSystems[]`, `evidence[]` (snippets), `language` — `invokes`/`inputs`/
      `outputs` are PLAIN STRINGS (no candidate/entity resolution — D6).
    - Parse + validate the response; drop a single file's output on malformed JSON
      (counts as that file's soft-fail).
    - Normalise any `artifactKind` outside the controlled set to `other`:
      `batch_job | shell_script | scheduler_config | monitoring_config | ci_config |
      integration_config | deployment_script | maintenance_script | other`.
    - Clamp `confidence` to a sensible band.
  - [x] 3.5 Create the standalone step `runOperationalArtifactScan` (e.g. `operationalArtifactScanStep.ts`)
    - Export `OperationalArtifactScanStepInput` / `OperationalArtifactScanStepOutput`
      interfaces (follow `llmGapFillStep` / `llmBehaviourCaptureStep`).
    - DEDICATED re-walk of `context.repoRoot` (reuse the recursive `walk` +
      `ScanPlanFilterOptions` include/exclude-prefix + `subfolder` logic from
      `scanPlanBuilder.buildScanPlanFromFilesystem`) — it COMPLEMENTS, does not
      consume, the pruned scan plan / `sourceFiles` map.
    - Apply Group 2's gating + cap; truncate each file via `DISCOVERY_FILE_LINE_LIMIT`
      with a truncation note (exactly as gap-fill does).
    - `promisePool` concurrency (env-tunable, default ~2 — reuse the
      `readConcurrency` idiom) + per-file soft-fail on a `failures[]` list +
      `failureRate > maxFailureRate ? 'failed' : 'completed'` (mirror
      `GAP_FILL_MAX_FAILURE_RATE`, default 0.2).
    - Build ONE `operational_artifact` `FindingEmitInput` per selected file via a new
      `buildOperationalArtifactFinding` builder in
      `discovery-service/src/services/findings/emissionSources.ts` (follow
      `buildDeferredSurfacePresentFinding`): `findingType: 'operational_artifact'`,
      `category` mirrors `artifactKind`, `severity: 'info'`, `confidence` from the
      LLM (clamped), `source: 'operational_artifact_scan'`,
      `createdByStage: 'findings.operationalArtifactScan'`, NO `reviewStatus` (let
      AMS default `pending_review`), `links: []`, and the rich `detailJson`
      (including `filePath` + the selecting relevance-signal).
    - Emit ONE run-level skip `FindingEmitInput` when the cap overflows (count +
      sample paths).
  - [x] 3.6 Wire the step into the pipeline at the right point
    - Invoke `runOperationalArtifactScan` and push its `FindingEmitInput[]` onto
      `collectedFindingInputs` so it flows through the existing
      `emitPipelineFindingsForRun(stepResult.findingInputs, runId, projectId)`
      boundary (around `discoveryV3Pipeline.ts:1152`) — NO parallel emitter.
    - Gate on `OPERATIONAL_ARTIFACT_SCAN_ENABLED` (ON by default; env kill-switch).
    - Thread scope so service-scoped runs honour it: `context.repoRoot` already
      exists on `V3PipelineContext`, but `subfolder` / `includePaths` / `excludePaths`
      currently live in `runManager` (service-scoped branch ~2116-2143), NOT on the
      context — extend `V3PipelineContext` (or invoke the step where scope is known)
      so the re-walk scans ONLY in-scope files. Repo-scoped and service-scoped runs
      behave identically except for the scope filter (re-walk, not the pruned plan).
    - Inherit findings idempotency: within-run dedupe via `FindingEmitter` (key
      includes `runId`); across runs fresh findings; NO cross-run reconciliation.
  - [x] 3.7 Ensure the pass tests pass
    - Run ONLY the 2-8 tests written in 3.1 (discovery-service jest, targeted;
      `gatewayClient` mocked, NO live LLM).
    - Run `npx tsc --noEmit` for discovery-service.
    - Do NOT run the entire discovery-service suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass with `gatewayClient` mocked.
- The pass emits EXACTLY ONE `operational_artifact` finding per selected file with
  the fixed fields + strict `detailJson`, plus one run-level skip finding on overflow.
- Emission routes through `collectedFindingInputs` ->
  `emitPipelineFindingsForRun` -> `findingEmitter` (no parallel emitter; no AMS
  schema change).
- Per-file soft-fail continues the run; the max-failure-rate guard governs
  `stageStatus`; cache-hits skip the relay.
- ON by default with the env kill-switch; service-scoped runs scan only in-scope files.
- discovery-service `tsc --noEmit` is clean.

### Testing

#### Task Group 4: Test Review & Strategic Gap Fill
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 2-8 gateway relay tests (1.1), the 2-8 relevance/cap tests (2.1),
      and the 2-8 pass tests (3.1). Total existing: ~6-24 tests.
  - [x] 4.2 Analyze coverage gaps for THIS feature only
    - Identify only feature-critical workflows still uncovered. Do NOT assess
      whole-application coverage. Prioritise end-to-end + scoping behaviours.
  - [x] 4.3 Write up to 10 additional strategic tests maximum
    - Add a maximum of 10 new tests to fill identified critical gaps. Likely
      candidates ONLY if not already covered:
      - end-to-end: fixtures (shell + JIL + monitoring-XML) → mocked gateway relay
        → exactly one `operational_artifact` finding per file with the right
        `artifactKind`/`detailJson`;
      - service-scoped scoping: a file outside the run's subfolder/include-paths is
        NOT scanned;
      - always-on toggle: `OPERATIONAL_ARTIFACT_SCAN_ENABLED=false` emits zero
        operational-artifact findings; default (unset) runs the pass;
      - the run-level cap skip-finding end-to-end.
    - NO tree-sitter (D1 summarises, not parses). Skip edge cases / performance /
      accessibility unless business-critical.
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY this spec's tests (1.1 + 2.1 + 3.1 + 4.3): gateway targeted jest
      (LLM-guard + `architectureModelClientMock`) and discovery-service targeted
      jest (`gatewayClient` mocked, NO live LLM), plus `npx tsc --noEmit` for both
      packages. Expected total ~16-34 tests.
    - Do NOT run the entire application test suite. NO AMS run, NO changeset.

**Acceptance Criteria:**
- All feature-specific tests pass (~16-34 tests total).
- Critical workflows covered: per-file emission, service-scoped scoping, always-on
  toggle, and the cap skip-finding.
- No more than 10 additional tests added when filling gaps.
- Testing focused exclusively on this spec; no live LLM, no tree-sitter, no AMS.

## Execution Order

Recommended implementation sequence:
1. Gateway Summariser Relay Route (Task Group 1) — independent; the relay the pass calls.
2. Relevance Predicate + Exclusions + Cap (Task Group 2) — independent, pure; can run in parallel with Group 1.
3. `runOperationalArtifactScan` Pass + Pipeline Wiring (Task Group 3) — depends on Groups 1 and 2.
4. Test Review & Strategic Gap Fill (Task Group 4) — depends on Groups 1-3.

## Verified Reuse Anchors (all present in the working tree)

- LLM-pass template (`promisePool` + per-file soft-fail + `failureRate` guard +
  truncation-aware contract): `discovery-service/src/services/llmGapFillStep.ts`
  (`runLlmGapFill`, `readConcurrency`, `readMaxFailureRate`, `promisePool`).
- Content-addressed cache: `discovery-service/src/services/gapFillResponseCache.ts`
  (`GapFillResponseCache`, `normalizePromptForHash`, `GAP_FILL_RELAY_TEMPERATURE`).
- Exclusion sets + scoped re-walk + truncation:
  `discovery-service/src/services/scanPlanBuilder.ts` (`SKIP_DIRECTORIES`,
  `EXCLUDED_FILENAMES`, `EXCLUDED_EXTENSIONS`, `buildScanPlanFromFilesystem`'s
  recursive `walk` + `ScanPlanFilterOptions`; `SOURCE_EXTENSIONS` is the allow-list
  to INVERT). `DISCOVERY_FILE_LINE_LIMIT` from `discovery-service/src/config.ts`.
- Relay client transport + typed error: `discovery-service/src/services/gatewayClient.ts`
  (`gapFill`, `GapFillGatewayError`).
- Emission: `discovery-service/src/services/findings/FindingEmitter.ts`
  (`FindingEmitInput`, `findingEmitter`) + `emissionSources.ts`
  (`buildDeferredSurfacePresentFinding` as the info/run-level/`links: []`/
  `detailJson`-rich template). Boundary: `collectedFindingInputs` ->
  `runManager.emitPipelineFindingsForRun` (called at `discoveryV3Pipeline.ts:1152`).
- Gateway route to clone: `gateway/src/routes/discoveryGapFill.ts`
  (`discoveryGapFillRouter`), exported from `gateway/src/routes/index.ts`, mounted
  `app.use('/api/v1/discovery', discoveryGapFillRouter)` in `gateway/src/server.ts:78`.
- Gateway LLM-guard test pattern: `gateway/src/__tests__/discoveryGapFill.test.ts`
  (`jest.mock('../services/llmClient', () => ({ getLlmClient: () => ({ sendChatRequest: ... }) }))`).
- Pipeline context: `V3PipelineContext` (`discoveryV3Pipeline.ts:150`) carries
  `repoRoot?: string`; service-scope (`includePaths` / `excludePaths` /
  `repoSubfolder`) is assembled in `runManager.ts` (~2116-2143) — scope must be
  threaded to the new step.
