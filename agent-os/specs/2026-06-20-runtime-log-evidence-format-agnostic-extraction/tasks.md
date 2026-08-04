# Task Breakdown: Runtime Log Evidence — Format-Agnostic Extraction

## Overview
Total Task Groups: 9
Stacks involved: discovery-service (TypeScript/Node), gateway (TypeScript/Node), AMS (Java 21 / Spring Boot — verification only; the consumer is NOT modified).

This spec wires uploaded runtime logs into the V3 scan's Stage 2.5 so they
produce countable `source='log'` `discovery_evidence` rows, clearing the
`insufficient_runtime_evidence` migration-readiness gap. The quality-first
flow is: pre-scan + sample (cheap, deterministic) → richness-gated known-format
fast path → LLM recipe induction on small redacted samples → recipe-aware
deterministic full-file extraction → persist evidence + best-effort findings,
with a broadened deterministic matcher as the always-available fallback.

---

## ⚠️ IMPLEMENTER GUARDRAILS — READ BEFORE ANY EDIT ⚠️

These are MANDATORY. Past whole-file `Write`s have CLOBBERED large files in
this repo, and implementer subagents have `Write` but NO `Edit`.

1. **EXISTING files — NEVER re-`Write` the whole file.** Make ANCHORED in-place
   edits via `Bash`/Node string splices against unique anchors. This applies
   especially to:
   - `discovery-service/src/services/runtimeEvidence/runDiscoveryRuntimeEvidence.ts`
   - `discovery-service/src/services/runtimeEvidence/runtimeEvidencePersistence.ts`
   - `discovery-service/src/services/discoveryV3Pipeline.ts`
   - `discovery-service/src/services/archModelClient.ts`
   - `discovery-service/src/services/gatewayClient.ts`
   - `gateway/src/routes/index.ts`, `gateway/src/server.ts`
   - any other already-existing file you touch.
2. **NEW files MAY use `Write`.** All new modules (sampler, recipe-aware
   extractor, recipe induction client wrapper, pre-scan, known-format fast
   path, the new gateway route file) and all NEW test files may be created
   with `Write`.
3. **NEVER use `git checkout`, `git stash`, or `git reset`.** Do not attempt
   to recover by reverting; if a splice fails, inspect and fix forward.
4. **After every edit to an existing file**, grep the file for the mojibake
   corruption marker (the corruption em-dash, U+0097 / the `â€"`-style
   sequence) and visually verify the spliced region AND its immediate
   surroundings are byte-intact. A safe check after each splice:
   - grep the file for the literal mojibake markers; expect ZERO hits.
   - re-read the ~15 lines around your anchor to confirm the splice landed
     cleanly and no surrounding code was truncated.
5. **Prefer the smallest possible anchored splice.** Insert a new function or
   import next to a unique existing string; do not rewrite neighbouring blocks.
6. **Verify with the TypeScript compiler / linter after edits**, not by
   re-Writing. If a build breaks, fix forward with another anchored splice.

---

## Architectural anchors (verified in code — use these exact targets)

- **Broken matcher**: `HTTP_METHOD_PATH_REGEX` at
  `discovery-service/src/services/runtimeEvidence/runDiscoveryRuntimeEvidence.ts`
  ~lines 93-94. It requires a `/`-leading path immediately after the method
  (`\s+(\/[^\s...]+)`), so `POST http://host:port/path` extracts ZERO. The
  per-entry application is `tryExtractFromMessage` (~lines 317-361).
- **Evidence persistence (REUSE)**: `archModelClient.bulkSaveEvidence(projectId, runId, atoms)`
  (`archModelClient.ts` ~line 1365) writes `EvidenceAtom[]` to AMS with
  `source` mapped through. The atom shape to emulate is in
  `logExtractors/endpointUsageExtractor.ts` (`type: 'string_pattern'`,
  `source: 'log'`, `data.patternName: 'endpoint_usage_log'`, `logOrigin: {...}`).
  EvidenceAtom type: `discovery-service/src/types/evidenceAtom.ts`.
  DO NOT extend `endpointUsageExtractor.ts` for richness — drive `bulkSaveEvidence`
  from the NEW recipe-aware extractor.
- **`runtimeEvidencePersistence.ts`** today writes only `steps_payload` +
  in-memory candidate enrichment; it writes NO `discovery_evidence` row. Add
  the evidence write here (or in the orchestrator), reusing `bulkSaveEvidence`.
- **Stage 2.5 call site**: `discoveryV3Pipeline.ts` ~lines 1140-1199 already
  calls `runDiscoveryRuntimeEvidence({...})` with `projectId`, `runId`,
  `architectureId`, `projectFolder`, `deterministicCandidates`,
  `configSnapshot`, `archModelClient`. The auto-run wiring already exists — do
  not add a trigger.
- **logFiles reader**: `readLogFileArtifacts(configSnapshot)` in
  `runDiscoveryRuntimeEvidence.ts` (~line 212) already reads
  `config_snapshot.inputArtifacts.logFiles[]`. Reuse it; resolve each file via
  `path.join(projectFolder, artifact.relativePath)` (existing pattern ~line 494).
- **Gateway relay pattern (MIRROR)**: `gateway/src/routes/discoveryGapFill.ts`
  (the `POST /v3/gap-fill` relay → `getLlmClient().sendChatRequest(...)`).
  Registered in `gateway/src/routes/index.ts` (~line 63 export) and mounted in
  `gateway/src/server.ts` (~line 78, `app.use('/api/v1/discovery', discoveryGapFillRouter)`).
- **Discovery-side relay client (MIRROR)**: `gatewayClient.gapFill(prompt, filePath, runId)`
  (`gatewayClient.ts` ~line 365) and its sibling `captureBehaviour` (~line 469)
  POST to `/api/v1/discovery/v3/...` with 429/5xx retry+backoff. Add a sibling
  method for `/v3/log-recipe`.
- **Redaction (REUSE as-is)**: `redactFullBody` from
  `discovery-service/src/utils/snippetRedaction.ts` (~line 340). Use existing
  defaults; add nothing.
- **Known-format parsers (REUSE)**: `logParsing/` (`logFormatDetector.ts`,
  `jsonLinesParser.ts`, `frameworkPatternParser.ts`) and
  `runtimeEvidence/accessLogParser.ts` (CLF). `parseLogContent` / `detectLogFormat`
  are already imported in the orchestrator.
- **Matching trio (REUSE)**: `endpointRuntimeMatcher.matchAggregatesToCandidates`,
  `endpointRuntimeAggregator.aggregateObservations`, `endpointPathNormalizer.normalizePath`.
- **Findings emission (REUSE)**: `findings/emissionSources.ts` →
  `buildRuntimeUsageObservationFinding` / `buildUnmatchedRuntimeEndpointFinding`
  emit `category: 'runtime_usage'`; emitted via `findingEmitter.emitFindings(...)`.
  The AMS consumer counts categories in `{runtime_usage, runtime_log, log}`.
- **AMS consumer (NOT modified)**:
  `service/migration/MigrationDiscoveryContextService.java` `buildRuntimeUsageSummary`
  (~lines 944-960). `hasRuntimeEvidence = (source='log' evidence count > 0) ||
  (findings in {runtime_usage,runtime_log,log} count > 0)`, scoped to the latest
  3 COMPLETED runs of the current architecture.
- **Test conventions**: discovery-service tests live next to source under
  `__tests__/` (e.g. `runtimeEvidence/__tests__/*.test.ts`). Gateway route
  tests under `gateway/src/routes/__tests__/*.test.ts`.

---

## NON-GOALS (do NOT do these — enforce throughout)

- Do NOT modify `MigrationDiscoveryContextService.buildRuntimeUsageSummary`
  (the consumer). The gap clears automatically once evidence flows.
- Do NOT change the migration-plan wizard / gap registry UI
  (`MigrationDeliveryPlanWizard.tsx`, `gapWayfindingRegistry.ts`).
- NEVER invent a response/body/header/field not present in the log.
- No real-time / streaming ingestion (batch, at discovery-run time only).
- No capture seed-data productization (fast-follow).
- The "No sample data hints" bug is ALREADY FIXED — out of scope.
- No Anthropic SDK in discovery-service (model selection stays gateway-side).
- No separate manual trigger in v1 (`routes/logEnrichment.ts` stays unchanged).
- No DB schema change (recipe + diagnostic live in `steps_payload`).
- No new gap type for the ~0-despite-hits diagnostic.
- Do NOT extend the old regex-only `endpointUsageExtractor.ts` for richness.

---

## Task List

### Discovery-Service — Deterministic Core

#### Task Group 1: Flexible Deterministic Matcher (fallback + pre-scan primitive)
**Dependencies:** None
**Stack:** discovery-service (TypeScript)
**Files:** `runtimeEvidence/runDiscoveryRuntimeEvidence.ts` (EXISTING — anchored splice only)

This broadened matcher is BOTH the Step-3b deterministic fallback (always at
least clears the gap) AND the Step-1 pre-scan "request-like line" detector
primitive reused by Task Group 2.

- [x] 1.0 Broaden the deterministic HTTP method+path matcher
  - [x] 1.1 Write 2-8 focused tests (NEW file
    `runtimeEvidence/__tests__/flexibleMethodPathMatcher.test.ts`)
    - SampleSvc absolute-URL case: `POST http://host:port/api/orders` → method `POST`,
      path `/api/orders` (THE load-bearing failing case).
    - Bare-path still works: `GET /api/users 200` → method `GET`, path `/api/users`,
      status `200` (regression guard — must not break existing behaviour).
    - Status capture preserved (KV-tail and bare-after-quote fallbacks still fire).
    - Non-request lines ignored (e.g. a log4j banner line yields no match).
    - Keep to 2-8 tests; do not exhaustively enumerate every verb/URL shape.
  - [x] 1.2 Broaden `HTTP_METHOD_PATH_REGEX` (~lines 93-94) via ANCHORED splice
    - Accept `METHOD <absolute-URL>` (`https?://host[:port]/path`) AND the
      existing `METHOD /path`. Extract method + the PATH portion of the URL
      (strip scheme/host/port; keep `/path[?query]` per existing capture rules).
    - Preserve the existing status-capture group and the `KV_STATUS_REGEX` /
      `BARE_STATUS_AFTER_QUOTE_REGEX` fallbacks unchanged.
    - If a single regex becomes unwieldy, add a small helper alongside
      `tryExtractFromMessage` (anchored insert) that normalizes an absolute URL
      to its path before normalization — but do NOT rewrite `tryExtractFromMessage`
      wholesale; splice the minimal change.
  - [x] 1.3 Update `tryExtractFromMessage` (~lines 317-361) only as needed
    - Ensure `rawPath` is the extracted path (not the full URL) before
      `normalizePath(rawPath)`. Anchored splice on the unique `const rawPath = m[2];`
      line if extraction moves to a helper.
  - [x] 1.4 Export the request-like-line detector primitive for reuse by TG2
    - Export a small pure predicate/extractor (e.g. `detectRequestLikeLine(line)`
      → `{ method, path } | null`) that TG2's pre-scan imports, so the candidate
      detector and the fallback matcher share one source of truth. Add via
      anchored insert near the regex; do not duplicate the regex in TG2.
  - [x] 1.5 Verify byte-integrity and run ONLY this group's tests
    - Grep the edited file for mojibake markers (expect zero); re-read ~15 lines
      around each splice.
    - Run ONLY `flexibleMethodPathMatcher.test.ts` plus the existing
      `userLogShape.regression.test.ts` (it asserts the bare-path shape) and
      confirm both pass. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2-8 tests in 1.1 pass, including the SampleSvc `POST http://host:port/path` case.
- Bare-path + status capture regress cleanly (`userLogShape.regression.test.ts` green).
- A shared request-like-line detector primitive is exported for TG2.
- `runDiscoveryRuntimeEvidence.ts` is byte-intact (no mojibake, no truncation).

---

#### Task Group 2: Pre-Scan + Sampler (streaming, deterministic, no LLM)
**Dependencies:** Task Group 1 (consumes the request-like-line detector)
**Stack:** discovery-service (TypeScript)
**Files:** NEW `runtimeEvidence/logPreScanSampler.ts` (Write); reuses
`utils/snippetRedaction.redactFullBody` and the TG1 detector.

- [x] 2.0 Build the streaming pre-scan + sample-block assembler
  - [x] 2.1 Write 2-8 focused tests (NEW
    `runtimeEvidence/__tests__/logPreScanSampler.test.ts`)
    - Block assembly: a hit line yields a block of ~10 lines before + ~30 after.
    - Byte-offset spread: hits clustered at the top do NOT crowd out later-file
      blocks; blocks are spread across byte offsets (startup banners at top must
      not consume the budget).
    - Dedup: many near-identical hammered-endpoint blocks collapse so one
      endpoint does not consume the budget.
    - Redaction applied: a planted secret in a sample block is scrubbed (assert
      `redactFullBody` ran on output).
    - Budget caps: per-line truncation ~2k chars; assembled sample ≤ ~12k chars total.
    - No-hits fallback: a file with zero request-like lines yields offset-stratified
      head/middle/tail windows (non-empty, representative).
    - Determinism: same input bytes → identical block selection (reproducible).
  - [x] 2.2 Implement streaming whole-file scan
    - Stream via `fs.createReadStream` + `readline` (mirror `sampleFirstLines`
      style) tracking BYTE OFFSET per line, not just line index.
    - Detect candidate request lines using: an HTTP verb, OR `http(s)://`, OR a
      `/seg/seg` path token — reuse the TG1 `detectRequestLikeLine` primitive for
      the verb/URL signal; add the bare `/seg/seg` token signal here.
  - [x] 2.3 Assemble 8-12 sample BLOCKS
    - Each block = hit line + ~10 lines before + ~30 lines after (≈40 lines,
      enough to span one request→response cycle).
    - Spread blocks across the file by BYTE OFFSET; dedup near-identical blocks.
  - [x] 2.4 Apply truncation, redaction, and total budget cap
    - Truncate any over-long individual line to ~2k chars.
    - Scrub EVERY block with `redactFullBody` (existing defaults; add nothing).
      This is the invariant: no un-redacted content may leave the process.
    - Cap the assembled sample to ~12k chars total.
  - [x] 2.5 No-hits fallback
    - On ZERO pre-scan hits, return offset-stratified head/middle/tail windows
      (still redacted, still budgeted) so the LLM gets representative data.
  - [x] 2.6 Run ONLY this group's tests
    - Run ONLY `logPreScanSampler.test.ts`. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2-8 tests in 2.1 pass.
- Pre-scan and block selection are deterministic/reproducible.
- Every emitted block is redacted; per-line and total budgets are enforced.
- Zero-hits input falls back to head/middle/tail windows.

---

#### Task Group 3: Known-Format Fast Path (richness-gated)
**Dependencies:** Task Group 1
**Stack:** discovery-service (TypeScript)
**Files:** NEW `runtimeEvidence/knownFormatFastPath.ts` (Write); reuses
`logParsing/` parsers + `accessLogParser.ts`.

- [x] 3.0 Implement the richness-gated known-format fast path
  - [x] 3.1 Write 2-8 focused tests (NEW
    `runtimeEvidence/__tests__/knownFormatFastPath.test.ts`)
    - Rich JSON-lines (method + path + headers + body + response status/body)
      PASSES the richness gate → deterministic structured extraction is used.
    - Thin CLF (method + path only, no bodies/responses) FAILS the gate →
      signals "fall through to LLM".
    - The richness predicate itself: classify a record as rich vs thin given a
      known field map.
    - Keep to 2-8 tests.
  - [x] 3.2 Try existing structured parsers
    - Use `detectLogFormat` + `parseLogContent` (JSON-lines / framework / syslog /
      plaintext) and `parseClfStream` (CLF common/combined). Reuse, do not rewrite.
  - [x] 3.3 Implement the richness gate
    - Use deterministic structured extraction for the WHOLE file ONLY IF it
      yields the RICH field set the log supports: method, path, request headers,
      request body, response status + body.
    - If the result is THIN (e.g. only method+path when the log clearly carries
      more), return a "fall through to LLM" signal — do NOT settle.
    - A plain CLF log (no bodies/responses) fails the gate and falls to the LLM
      (which also cannot invent missing fields) — acceptable, one extra call.
  - [x] 3.4 Return a typed result
    - `{ extracted: RichObservation[], usedFastPath: true }` when rich, else
      `{ usedFastPath: false }`. Keep the observation shape compatible with the
      evidence-atom builder used in TG7.
  - [x] 3.5 Run ONLY this group's tests
    - Run ONLY `knownFormatFastPath.test.ts`. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2-8 tests in 3.1 pass.
- Rich JSON-lines uses the deterministic fast path; thin CLF falls through to LLM.
- No field is invented; thin logs are never force-fit to "rich".

---

### Gateway — LLM Relay Endpoint

#### Task Group 4: Gateway `/discovery/v3/log-recipe` Relay Endpoint
**Dependencies:** None (can proceed in parallel with TG1-3); TG5 consumes it
**Stack:** gateway (TypeScript)
**Files:** NEW `gateway/src/routes/discoveryLogRecipe.ts` (Write);
`gateway/src/routes/index.ts` (EXISTING — anchored splice), `gateway/src/server.ts`
(EXISTING — anchored splice).

- [x] 4.0 Add the log-recipe relay endpoint
  - [x] 4.1 Write 2-8 focused tests (NEW
    `gateway/src/routes/__tests__/discoveryLogRecipe.test.ts`)
    - Relay shape: a valid POST forwards the prompt to the LLM client and
      returns `{ content, usage? }` verbatim (mock `getLlmClient`).
    - Returns the model's recipe payload (or its "no pattern" content) unmodified.
    - Validation: empty/missing prompt → 400; missing `runId` → 400 (mirror gap-fill).
    - Keep to 2-8 tests.
  - [x] 4.2 Create `discoveryLogRecipe.ts` MIRRORING `discoveryGapFill.ts`
    - `POST /v3/log-recipe`; stateless relay → `getLlmClient().sendChatRequest(...)`
      with `temperature: 0` (deterministic), returning `{ content, usage }`.
    - Request body carries the redacted sample(s) + `runId` (+ correlation fields).
      The model is selected gateway-side (latest Claude per gateway config) — no
      model id from discovery-service.
  - [x] 4.3 Register the router (anchored splices)
    - `index.ts`: add `export { discoveryLogRecipeRouter } from './discoveryLogRecipe';`
      next to the existing `discoveryGapFillRouter` export (~line 63).
    - `server.ts`: import alongside the other discovery routers (~line 10) and add
      `app.use('/api/v1/discovery', discoveryLogRecipeRouter);` next to the gap-fill
      mount (~line 78). Optionally add the startup log line + `listMountedRoutes`
      entry to match the gap-fill pattern (~lines 288, 313).
  - [x] 4.4 Verify byte-integrity and run ONLY this group's tests
    - Grep `index.ts` and `server.ts` for mojibake markers (expect zero); re-read
      around each splice.
    - Run ONLY `discoveryLogRecipe.test.ts`. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2-8 tests in 4.1 pass.
- `POST /api/v1/discovery/v3/log-recipe` relays to the LLM and returns
  recipe-or-no-pattern content unmodified; bad requests 400.
- `index.ts` and `server.ts` are byte-intact (no mojibake, no truncation).

---

### Discovery-Service — LLM Recipe Induction & Validation

#### Task Group 5: Recipe Induction Client + Validation + Bounded Retries + Persistence
**Dependencies:** Task Group 1 (held-out validation reuses the matcher),
Task Group 2 (sample blocks), Task Group 4 (gateway endpoint)
**Stack:** discovery-service (TypeScript)
**Files:** NEW `runtimeEvidence/logRecipeInduction.ts` (Write);
`gatewayClient.ts` (EXISTING — anchored splice to add the sibling relay method);
recipe persistence into `steps_payload` (via the orchestrator, see TG7 wiring).

- [x] 5.0 Induce, validate, and persist a structured recipe
  - [x] 5.1 Write 2-8 focused tests (NEW
    `runtimeEvidence/__tests__/logRecipeInduction.test.ts`)
    - Accept by threshold: a recipe extracting method+path from ≥60% of
      request-like lines in a HELD-OUT block is accepted.
    - Reject by threshold: <60% held-out yield is rejected.
    - Retry budget: weak yield re-samples up to 2 retries; HARD cap of 3 LLM
      calls per file is never exceeded (assert call count on a mock relay).
    - Fallback on "no pattern": a "no pattern" LLM response (or exhausted
      retries) returns a signal to use the TG1 deterministic fallback matcher.
    - Recipe persistence + fingerprint reuse: a persisted recipe keyed by
      format-fingerprint is reused on a same-fingerprint re-run WITHOUT another
      LLM call.
    - Keep to 2-8 tests (mock the relay; do not hit a real LLM).
  - [x] 5.2 Add the relay method to `gatewayClient` (anchored splice)
    - Add a sibling of `gapFill`/`captureBehaviour` (e.g. `induceLogRecipe(payload, runId)`)
      that POSTs to `/api/v1/discovery/v3/log-recipe` with the same 429/5xx
      retry+backoff transport. Anchored insert AFTER the `captureBehaviour`
      method's closing brace; do NOT rewrite neighbouring methods.
  - [x] 5.3 Implement recipe induction orchestration
    - Send the redacted sample blocks (from TG2) via the new relay; parse the
      STRUCTURED recipe: record delimiter + field rules for method/path/headers/body/response.
    - Tolerate a "no pattern" response.
  - [x] 5.4 Implement held-out validation
    - Apply the parsed recipe to a HELD-OUT block the LLM did NOT see; accept if
      method+path extraction ≥60% of request-like lines in that block (reuse the
      TG1 detector to count request-like lines).
    - On weak yield, re-sample different/more blocks (from TG2) and retry — bounded
      to 2 retries / max 3 LLM calls total per file. Then fall back to TG1's matcher.
  - [x] 5.5 Implement recipe persistence + fingerprint keying (shape only here)
    - Define the recipe object and a deterministic format-fingerprint hash
      (e.g. hash of normalized candidate-line shape), plus a per-source-file
      fallback key. Persist into `steps_payload.v3.runtimeEvidence.recipe`
      (NO schema change). The actual `steps_payload` write is wired in TG7's
      orchestrator splice; this group provides the recipe object + fingerprint +
      a reuse-lookup helper and unit-tests them against an in-memory steps_payload.
    - Induce ONE recipe PER FILE — do NOT assume a shared format across files.
  - [x] 5.6 Verify byte-integrity and run ONLY this group's tests
    - Grep `gatewayClient.ts` for mojibake markers (expect zero); re-read around
      the spliced method.
    - Run ONLY `logRecipeInduction.test.ts`. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2-8 tests in 5.1 pass.
- Recipe accepted at ≥60% held-out yield; rejected below; ≤3 LLM calls/file enforced.
- "No pattern" / exhausted retries → deterministic fallback signal.
- Recipe persists in `steps_payload.v3.runtimeEvidence.recipe` and is reused by
  fingerprint without a further LLM call.
- `gatewayClient.ts` is byte-intact.

---

#### Task Group 6: Recipe-Aware Deterministic Full-File Extractor
**Dependencies:** Task Group 5 (recipe object), Task Group 1 (path normalization)
**Stack:** discovery-service (TypeScript)
**Files:** NEW `runtimeEvidence/recipeAwareExtractor.ts` (Write).

CRITICAL invariant: the LLM ONLY ever sees small redacted samples; the WHOLE
file is ALWAYS processed by this deterministic code.

- [x] 6.0 Apply a validated recipe across the full file
  - [x] 6.1 Write 2-8 focused tests (NEW
    `runtimeEvidence/__tests__/recipeAwareExtractor.test.ts`)
    - Multi-line record assembly: a SampleSvc block (`<id> > METHOD http://host/path`,
      `<id> > header: value` lines, blank `<id> >`, then JSON body) is assembled
      into ONE record → method + path + headers + body extracted.
    - Response captured ONLY when present; a request with no logged response
      yields NO invented response field.
    - Streaming a large file: extraction works in a streamed pass (no whole-file
      buffering assumption beyond the existing per-file cap).
    - Interleaved noise (log4j `[thread] [logger]` lines) does not corrupt record
      assembly.
    - Keep to 2-8 tests.
  - [x] 6.2 Implement recipe-driven record assembly
    - Use the recipe's record delimiter + field rules to assemble multi-line
      records across the FULL file (e.g. the 27MB target), streamed.
    - Pull EVERY field the log contains: method, path, headers, body,
      response status + body — response ONLY if logged, NEVER invented.
  - [x] 6.3 Normalize paths via the existing normalizer
    - Reuse `endpointPathNormalizer.normalizePath` so extracted paths align with
      candidate path templates for downstream matching.
  - [x] 6.4 Emit a rich observation shape compatible with TG7's atom builder
    - Output observations carrying method/path (+ headers/body/response where
      present) plus line range / source-file metadata for `logOrigin`.
  - [x] 6.5 Run ONLY this group's tests
    - Run ONLY `recipeAwareExtractor.test.ts`. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2-8 tests in 6.1 pass, including the SampleSvc multi-line record case.
- Responses/fields are captured ONLY when present; nothing is invented.
- The extractor streams the full file and emits a TG7-compatible observation shape.

---

### Discovery-Service — Persist + Wire (the dead-branch fix)

#### Task Group 7: Persist `source='log'` Evidence + Wire Stage 2.5
**Dependencies:** Task Groups 1, 3, 5, 6
**Stack:** discovery-service (TypeScript) + AMS-level verification
**Files (EXISTING — anchored splices only):**
`runtimeEvidence/runDiscoveryRuntimeEvidence.ts`,
`runtimeEvidence/runtimeEvidencePersistence.ts`. Optional NEW
`runtimeEvidence/runtimeEvidenceAtomBuilder.ts` (Write) for the atom-shaping
helper. Reuses `archModelClient.bulkSaveEvidence` + the matching trio +
`findingEmitter`.

This is THE dead-branch fix: writing `source='log'` evidence flips
`hasRuntimeEvidence` true and clears the gap.

- [x] 7.0 Wire the pipeline and write countable evidence
  - [x] 7.1 Write 2-8 focused tests
    - NEW `runtimeEvidence/__tests__/runtimeEvidenceAtomBuilder.test.ts` (if the
      builder is extracted): observations → `EvidenceAtom[]` with `type:'string_pattern'`,
      `source:'log'`, `data.patternName:'endpoint_usage_log'`, populated `logOrigin`.
    - Orchestrator-level test (extend/add in `runtimeEvidence/__tests__/`):
      given logFiles + a deterministic fallback extraction, `bulkSaveEvidence`
      is called with ≥1 `source:'log'` atom (assert on a stubbed `archModelClient`).
    - hasRuntimeEvidence proxy: a faithful unit-level assertion that the written
      atoms have `source==='log'` (the exact condition `buildRuntimeUsageSummary`
      counts) — i.e. the gap-clearing precondition holds.
    - Best-effort findings on match: when an extracted path matches a candidate,
      a `runtime_usage` finding is emitted via `findingEmitter`; when nothing
      matches, evidence is STILL written (findings are best-effort, not required).
    - Keep to 2-8 tests.
  - [x] 7.2 Choose the extraction path inside the orchestrator (anchored splice)
    - In `runDiscoveryRuntimeEvidence` (~the per-file loop ~lines 526-588), after
      reading each logFile: (a) try TG3 known-format fast path; if rich, use it;
      (b) else build TG2 samples → TG5 induction+validation; if a valid recipe,
      run TG6 recipe-aware extractor across the full file; (c) else fall back to
      the TG1 broadened matcher (the existing `tryExtractFromMessage` path, now
      absolute-URL-capable).
    - Splice minimally next to the existing `if (format === 'clf_common' ...)`
      branch; do NOT rewrite the whole loop body.
  - [x] 7.3 Build and persist `source='log'` evidence atoms (REUSE bulkSaveEvidence)
    - Shape atoms like `endpointUsageExtractor` (`type:'string_pattern'`,
      `source:'log'`, `data.patternName:'endpoint_usage_log'`, `logOrigin`),
      driven by the rich observations from TG6/TG3 (or method+path from TG1
      fallback). Persist via `archModelClient.bulkSaveEvidence(projectId, runId, atoms)`.
    - Add the call in `runtimeEvidencePersistence.ts` (anchored insert — it
      currently writes NO evidence row) OR in the orchestrator after extraction;
      keep one clear owner. Reuse `_resolveArchitectureForRun` indirectly via
      `bulkSaveEvidence` (it resolves the arch id itself).
    - This must run even when zero candidates match — evidence alone clears the gap.
  - [x] 7.4 Run the matching trio for best-effort `runtime_usage` findings
    - The orchestrator already aggregates → matches → emits findings
      (`aggregateObservations` / `matchAggregatesToCandidates` /
      `buildRuntimeUsageObservationFinding` via `findingEmitter`). Feed the new
      rich observations into this existing path so matched paths still emit
      `runtime_usage` findings. Best-effort: failures here must NOT block the
      evidence write or fail the run.
  - [x] 7.5 Persist the recipe into steps_payload (anchored splice)
    - Extend the `steps_payload.v3.runtimeEvidence` read-modify-write in
      `runtimeEvidencePersistence.ts` (`persistRunSummary`, ~lines 146-169) to
      also carry the TG5 `recipe` keyed by fingerprint. Preserve existing sibling
      keys (`gapFill`, etc.) and the existing `runtimeEvidence` summary fields.
  - [x] 7.6 Verify byte-integrity and run ONLY this group's tests
    - Grep `runDiscoveryRuntimeEvidence.ts` and `runtimeEvidencePersistence.ts`
      for mojibake markers (expect zero); re-read around each splice; confirm the
      orchestrator's NEVER-throws contract is intact.
    - Run ONLY this group's new/updated tests. Do NOT run the whole suite.
  - [x] 7.7 AMS-level confirmation of the gap-clearing precondition
    - Confirm (by reading, no modification) that `buildRuntimeUsageSummary`
      counts `source='log'` evidence; document the link in the test that asserts
      `source==='log'` atoms are written. If an AMS integration assertion is
      feasible without modifying the consumer, prefer it; otherwise the
      unit-level `source==='log'` proxy in 7.1 is the accepted surrogate.

**Acceptance Criteria:**
- The 2-8 tests in 7.1 pass.
- `bulkSaveEvidence` is called with ≥1 `source:'log'` atom on a successful
  extraction (fast-path, recipe, or fallback) — even with zero candidate matches.
- The written atoms satisfy the exact `source==='log'` condition that flips
  `hasRuntimeEvidence` true (clearing `insufficient_runtime_evidence`).
- Best-effort `runtime_usage` findings emit on matches; their absence never
  blocks the evidence write or fails the run.
- Recipe is persisted under `steps_payload.v3.runtimeEvidence.recipe`.
- Both edited files are byte-intact and the never-throws contract is preserved.

---

#### Task Group 8: Diagnostics — ~0 Extraction Despite Pre-Scan Hits
**Dependencies:** Task Group 7
**Stack:** discovery-service (TypeScript)
**Files (EXISTING — anchored splices only):**
`runtimeEvidence/runDiscoveryRuntimeEvidence.ts`,
`runtimeEvidence/runtimeEvidencePersistence.ts`. Reuses `findings/emissionSources.ts`
+ `findingEmitter`.

- [x] 8.0 Record a diagnostic without failing the run
  - [x] 8.1 Write 2-8 focused tests
    - Diagnostic recorded: pre-scan finds hits but extraction yields ~nothing →
      a structured `extractionOutcome` is written into
      `steps_payload.v3.runtimeEvidence` (assert on the steps_payload write).
    - Run still completes: the orchestrator returns a valid result (never throws).
    - Low-severity finding emitted: a `runtime_log` (low-severity) finding is
      emitted for visibility (assert via stubbed `findingEmitter`).
    - No new gap type is introduced (negative assertion / review note).
    - Keep to 2-8 tests.
  - [x] 8.2 Detect the ~0-despite-hits condition (anchored splice)
    - After extraction in the orchestrator, if pre-scan reported candidate lines
      but the observation count is ~0, build a structured `extractionOutcome`
      (e.g. `{ preScanHits, observations, reason, sampledBlocks }`).
  - [x] 8.3 Persist the diagnostic into steps_payload (anchored splice)
    - Add `extractionOutcome` under `steps_payload.v3.runtimeEvidence` via the
      existing read-modify-write (preserve siblings + the summary + the recipe).
  - [x] 8.4 Emit a low-severity `runtime_log` finding
    - Use an existing low-severity builder (or add a minimal `runtime_log`-category
      builder alongside the others in `emissionSources.ts` via anchored insert —
      mirror `buildRuntimeUsageObservationFinding`'s shape, category `runtime_log`,
      low/info severity). Emit best-effort via `findingEmitter`; failures here must
      NOT fail the run.
  - [x] 8.5 Verify byte-integrity and run ONLY this group's tests
    - Grep edited files for mojibake markers (expect zero); re-read around splices;
      confirm the never-throws contract still holds.
    - Run ONLY this group's tests. Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2-8 tests in 8.1 pass.
- ~0-despite-hits records a structured `extractionOutcome` in
  `steps_payload.v3.runtimeEvidence` AND emits a low-severity `runtime_log` finding.
- The run NEVER fails because of the diagnostic; NO new gap type is introduced.
- Edited files are byte-intact.

---

### Testing

#### Task Group 9: Test Review & Gap Analysis (feature-only)
**Dependencies:** Task Groups 1-8
**Stack:** discovery-service + gateway (TypeScript)

- [x] 9.0 Review existing tests and fill the highest-value gaps only
  - [x] 9.1 Review tests from Task Groups 1-8
    - Review TG1 (matcher), TG2 (sampler), TG3 (fast path), TG4 (gateway relay),
      TG5 (induction/validation/persistence), TG6 (recipe extractor), TG7
      (evidence write + wiring), TG8 (diagnostics). Total existing: ~24-60 tests.
  - [x] 9.2 Analyze coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage. Prioritize the
      headline path: SampleSvc-style log → Stage 2.5 → `source='log'` evidence written
      → gap-clearing precondition holds (`source==='log'` atoms present). Do NOT
      assess whole-application coverage.
  - [x] 9.3 Write up to 10 additional strategic tests MAXIMUM
    - Focus on integration / end-to-end seams, especially:
      - SampleSvc-log fixture → orchestrator → `bulkSaveEvidence` called with
        `source:'log'` atoms (the gap-clears headline).
      - Fallback path end-to-end: absolute-URL log with NO valid recipe still
        writes `source='log'` evidence via the broadened matcher.
      - Recipe path end-to-end: rich multi-line log induces+validates a recipe,
        full-file extraction writes rich evidence + best-effort findings.
      - Redaction invariant end-to-end: a planted secret never appears in the
        relay payload sent to the gateway.
    - Skip edge cases, performance, and accessibility unless business-critical.
      Do NOT exceed 10 added tests.
  - [x] 9.4 Run feature-specific tests only
    - Run ONLY this spec's tests (TG1-8 tests + the ≤10 added here). Do NOT run
      the entire application test suite. Verify critical workflows pass.
    - Final byte-integrity sweep: grep every EXISTING file touched across all
      groups for mojibake markers (expect zero).

**Acceptance Criteria:**
- All feature-specific tests pass (~24-70 tests total).
- The headline workflow (SampleSvc-log → `source='log'` evidence → gap-clearing
  precondition) is covered end-to-end.
- No more than 10 additional tests added.
- Testing is exclusively scoped to this spec's feature.
- No mojibake / truncation in any edited existing file.

---

## Execution Order

Recommended implementation sequence (dependency-ordered):

1. **Task Group 1** — Flexible deterministic matcher (fallback + pre-scan primitive).
2. **Task Group 2** — Pre-scan + sampler (depends on TG1's detector).
3. **Task Group 3** — Known-format fast path (depends on TG1).
4. **Task Group 4** — Gateway `/discovery/v3/log-recipe` relay (parallelizable with TG1-3).
5. **Task Group 5** — Recipe induction + validation + persistence (depends on TG1, TG2, TG4).
6. **Task Group 6** — Recipe-aware deterministic full-file extractor (depends on TG5, TG1).
7. **Task Group 7** — Persist `source='log'` evidence + wire Stage 2.5 (depends on TG1, TG3, TG5, TG6).
8. **Task Group 8** — Diagnostics on ~0-despite-hits (depends on TG7).
9. **Task Group 9** — Test review & gap analysis (depends on TG1-8).

Note: TG4 (gateway) has no discovery-service dependency and may be built in
parallel with TG1-3 to unblock TG5 early.
