# Task Breakdown: Web Access Log Runtime Endpoint Evidence

## Overview
Total Tasks: 5 task groups, ~38 sub-tasks
Spec 5 of 7. Code-heavy spec entirely confined to `discovery-service` (8 new TS modules + one pipeline-file modification). NO frontend, NO gateway, NO architecture-model-service code or schema changes. Only existing AMS endpoints (`PUT /runs/{runId}`, `PUT /candidates/{candidateId}`) are used for persistence.

> **IMPLEMENTATION DISCIPLINE — READ FIRST**
> Per project memory feedback (`feedback_no_src_edits_during_run`): editing `discovery-service/src/**` while a discovery run is in flight will trigger a `tsx watch` reload and KILL the run. Before any sub-task in this list that edits source under `discovery-service/src/`, confirm no live run is active. Test files under `__tests__/` are safe to edit at any time.

> **TOP-LEVEL PIPELINE STEPS DO NOT CHANGE**
> `VALID_STEPS = ['1a', '1b', '1c-llm-analysis']` stays exactly as-is. The new sub-stage is INTERNAL to `runDiscoveryV3`, between Stage 2 (`FrameworkPack.adapt`) and Stage 3 (LLM gap-fill). Do NOT touch `runManager.ts`'s step machinery.

## Task List

### Discovery Service — Foundation Modules

#### Task Group 1: Types, Path Normalizer, Access Log Parser
**Dependencies:** None

These three modules are pure (no I/O, no AMS client). They are independent of each other and form the foundation the rest of the spec builds on.

- [x] 1.0 Complete foundation modules (types + path normalizer + CLF parser)
  - [x] 1.1 Write 2-8 focused tests for the foundation modules
    - Limit to 2-8 highly focused tests maximum across all three modules combined
    - Test only critical behaviours:
      - `endpointPathNormalizer`: numeric `/users/123` → `/users/{id}`, UUID `/orders/550e8400-e29b-41d4-a716-446655440000` → `/orders/{id}`, 16+ char with digit `/objects/a1b2c3d4e5f6g7h8` → `/objects/{id}`, slug-only `/products/my-product-name` UNCHANGED, query-string stripping `/users/123?x=1` → `/users/{id}`
      - `accessLogParser`: parses one Apache/Nginx Combined Log Format line and one Common Log Format line, extracting `method`, `path`, `status`, and `timestamp`
    - Skip exhaustive coverage of malformed lines, locale-specific timestamps, edge encodings
    - Test files: `discovery-service/src/services/runtimeEvidence/__tests__/endpointPathNormalizer.test.ts` and `discovery-service/src/services/runtimeEvidence/__tests__/accessLogParser.test.ts`
    - Pattern: pure-module Jest tests with no mocks (per project memory)
  - [x] 1.2 Create `discovery-service/src/services/runtimeEvidence/httpRuntimeObservation.ts`
    - Define and export TypeScript types only — NO runtime code, NO tests
    - `HttpRuntimeObservation` — `{ method, rawPath, normalizedPath, status, timestampIso?, sourceArtifactId, sourceFileName, lineNumber, snippet? }`
    - Co-locate the other type-only declarations the rest of the spec needs (avoids cross-module circular imports):
      - `EndpointRuntimeAggregate`
      - `MatchedRuntimeEvidence`
      - `NoUsageRuntimeEvidence`
      - `UnmatchedRouteHint`
      - `RuntimeEvidenceRunSummary` (incl. variant shapes `{ skipped: true, reason: 'no_log_artifacts' }` and `{ skipped: true, reason: 'log_processing_failed', warnings: string[] }`)
      - `LogEnrichmentRuntimeBlock` — union of `{ matched: MatchedRuntimeEvidence }` or `{ noUsageObserved: true } & NoUsageRuntimeEvidence`
      - `RuntimeEvidenceLlmContext` — compact LLM-facing summary
      - `RuntimeEvidenceResult` — orchestrator return type (carries both the persistence summary and the LLM context)
    - Field shapes must match the spec exactly (cross-reference `spec.md` "Type definitions to pin")
  - [x] 1.3 Create `discovery-service/src/services/runtimeEvidence/endpointPathNormalizer.ts`
    - Export `normalizePath(rawPath: string): string`
    - Strip query string (`?...` and onwards) BEFORE per-segment normalization
    - Tier order applied per segment, in this exact order:
      1. Numeric — `^\d+$` → `{id}`
      2. UUID — `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (case-insensitive) → `{id}`
      3. Long token — `^[a-zA-Z0-9_-]{16,}$` AND `/\d/.test(segment)` → `{id}`
    - Slug-only segments (no digits) are NOT normalized — `my-product-name` stays as-is
    - Also export `arePathsEquivalentByPlaceholder(a: string, b: string): boolean` for the matcher (different placeholder names treated as equivalent — `/owners/{id}/pets/{id}` matches `/owners/{ownerId}/pets/{petId}`)
    - Reuse pattern from inline normalization in: `discovery-service/src/services/logExtractors/endpointUsageExtractor.ts` (existing extractor stays untouched — it serves the manual reprocess route)
  - [x] 1.4 Create `discovery-service/src/services/runtimeEvidence/accessLogParser.ts`
    - Export `parseClfLine(line: string, format: 'clf_common' | 'clf_combined', lineNumber: number): ParsedAccessLogEntry | null` and `parseClfStream(filePath: string, format, sourceArtifactId, sourceFileName): AsyncIterable<HttpRuntimeObservation>`
    - Use `fs.createReadStream + readline.createInterface` for line-by-line parsing (per spec "Stream/line-by-line parsing where practical")
    - Common Log Format: `host ident authuser [date] "method path proto" status bytes`
    - Combined Log Format: same plus `"referrer" "user-agent"` — referrer and user agent are PARSED but DISCARDED (per spec "Do NOT store IPs, user agents, or referrers")
    - Apache/Nginx CLF date format: `[10/Oct/2026:13:55:36 +0000]` → ISO 8601
    - Reuse `ParsedLogEntry` shape from `discovery-service/src/services/logParsing/` for non-CLF formats — DO NOT duplicate JSONL/syslog/framework-pattern/plaintext parsing
    - Extend `discovery-service/src/services/logParsing/logFormatDetector.ts` to recognize CLF Common and Combined lines (new branch returning `clf_common` / `clf_combined`) — additive change, must not break existing detector behaviour for the four current formats
  - [x] 1.5 Ensure foundation tests pass
    - Run ONLY the 2-8 tests written in 1.1: `npx jest discovery-service/src/services/runtimeEvidence/__tests__/endpointPathNormalizer.test.ts discovery-service/src/services/runtimeEvidence/__tests__/accessLogParser.test.ts`
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- `httpRuntimeObservation.ts` compiles standalone (it's type-only)
- `endpointPathNormalizer.ts` correctly applies the 3-tier rule order with query-string stripping
- `accessLogParser.ts` parses both Common and Combined formats and discards IP/user-agent/referrer
- Format detector returns `clf_common` / `clf_combined` for CLF lines without breaking existing format outputs

---

### Discovery Service — Aggregation and Matching

#### Task Group 2: Endpoint Runtime Aggregator and Matcher
**Dependencies:** Task Group 1

The aggregator and matcher are tightly coupled (matcher consumes aggregator's output keyed shape) so they are built together.

- [x] 2.0 Complete aggregation and matching modules
  - [x] 2.1 Write 2-8 focused tests for aggregator + matcher
    - Limit to 2-8 highly focused tests maximum across both modules combined
    - Test only critical behaviours:
      - Aggregator: aggregates by `method + normalizedPath` with status distribution (2xx/3xx/4xx/5xx counts), `observedUsageCount` = 2xx+3xx only, `firstSeen`/`lastSeen` timestamps captured
      - Aggregator: pure-404 routes (every observation 404, zero 2xx/3xx) excluded from aggregates AND from unmatched hints
      - Aggregator: env-configurable threshold `RUNTIME_UNMATCHED_HINT_THRESHOLD` honoured (default 5; below threshold → no hint emitted)
      - Matcher: exact normalized-path match → `matchConfidence: 'high'`
      - Matcher: equivalent-placeholder match → `matchConfidence: 'medium'`
      - Matcher: cross-method matching REJECTED when code candidate's method is known and differs; ALLOWED only when code candidate's method is unknown/missing
      - Matcher: ambiguous multi-candidate match (two non-deterministic best matches) → NOT attached to any candidate
    - Skip exhaustive testing of every status-code edge case, every placeholder permutation
    - Test file: `discovery-service/src/services/runtimeEvidence/__tests__/endpointRuntimeAggregator.test.ts` and `discovery-service/src/services/runtimeEvidence/__tests__/endpointRuntimeMatcher.test.ts`
    - Pattern: pure-module Jest tests, no mocks
  - [x] 2.2 Create `discovery-service/src/services/runtimeEvidence/endpointRuntimeAggregator.ts`
    - Export `aggregateObservations(observations: HttpRuntimeObservation[]): { aggregates: Map<string, EndpointRuntimeAggregate>, unmatchedRouteHintCandidates: EndpointRuntimeAggregate[] }`
    - Aggregate key: `${method.toUpperCase()} ${normalizedPath}`
    - Per-aggregate fields: `totalLogRequests`, `observedUsageCount` (2xx+3xx only), `status2xxCount`, `status3xxCount`, `status4xxCount`, `status5xxCount`, `topStatusCodes`, `firstSeen`, `lastSeen`, `sourceLogFileCount`, `sourceLogFiles[]`, `sampleLineRefs[]`
    - Read `RUNTIME_UNMATCHED_HINT_THRESHOLD` env var at module init via `Number(process.env.RUNTIME_UNMATCHED_HINT_THRESHOLD ?? 5)` — apply globally (no per-host logic)
    - Pure-404 exclusion: an aggregate where `status2xxCount === 0 && status3xxCount === 0` and there ARE 4xx observations and ALL 4xx are 404 is excluded entirely
  - [x] 2.3 Create `discovery-service/src/services/runtimeEvidence/endpointRuntimeMatcher.ts`
    - Export `matchAggregatesToCandidates(aggregates: Map<string, EndpointRuntimeAggregate>, candidates: DiscoveryCandidate[]): { matched: MatchedRuntimeEvidence[], noUsage: NoUsageRuntimeEvidence[], ambiguousObservations: EndpointRuntimeAggregate[] }`
    - Filter `candidates` to `candidateType === 'endpoints'` only
    - Match preference order:
      1. Exact normalized-path match (use the candidate's path template, normalized identically) → `matchConfidence: 'high'`, `matchReason: 'exact_normalized_path'`
      2. Equivalent placeholder match via `arePathsEquivalentByPlaceholder` → `matchConfidence: 'medium'`, `matchReason: 'equivalent_placeholders'`
    - HTTP method case-insensitive equality required UNLESS code candidate's method is unknown/missing
    - Multi-candidate match → if one candidate is strictly more specific (fewer placeholders, longer literal-segment count) pick it; otherwise mark ambiguous and return in `ambiguousObservations` (do NOT attach to any candidate)
    - When matched: preserve code candidate's original `pathTemplate` as `codePathTemplate` and retain observation's `normalizedLogPath`
    - Build `noUsage` array: every endpoint candidate with no matched aggregate gets a `NoUsageRuntimeEvidence` entry with `noUsageObserved: true`, all counts zeroed, and a non-judgemental `note` like `"No matching log observations in processed log window"`
  - [x] 2.4 Ensure aggregation and matching tests pass
    - Run ONLY the 2-8 tests written in 2.1: `npx jest discovery-service/src/services/runtimeEvidence/__tests__/endpointRuntimeAggregator.test.ts discovery-service/src/services/runtimeEvidence/__tests__/endpointRuntimeMatcher.test.ts`
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- `observedUsageCount` excludes 4xx and 5xx (only 2xx + 3xx contribute)
- Pure-404 routes do not appear as endpoint evidence OR as unmatched hints
- `RUNTIME_UNMATCHED_HINT_THRESHOLD` (default 5) honoured globally
- Cross-method matches rejected unless code candidate method is unknown
- Ambiguous matches not attached to any candidate

---

### Discovery Service — Persistence and LLM Context

#### Task Group 3: Runtime Evidence Persistence and LLM Context Builder
**Dependencies:** Task Group 2

- [x] 3.0 Complete persistence and LLM context modules
  - [x] 3.1 Write 2-8 focused tests for persistence + LLM context builder
    - Limit to 2-8 highly focused tests maximum across both modules combined
    - Test only critical behaviours:
      - Persistence: per-candidate `logEnrichment.runtime` write is ADDITIVE — existing `{enriched, logAtomCount, signalSummary}` keys are preserved (read-modify-write pattern)
      - Persistence: run-level write to `steps_payload.v3.runtimeEvidence` does NOT collide with sibling keys (e.g. existing `gapFill` sub-tree under `steps_payload.v3` is preserved)
      - Persistence: `archModelClient.updateCandidate` and `archModelClient.updateRun` are called with the expected payload shapes
      - LLM context builder: produces compact JSON matching the pinned `RuntimeEvidenceLlmContext` shape
      - LLM context builder: NO raw log content (full lines, snippets > short, IPs, user agents) in output
      - LLM context builder: rough token cap respected (≤500 tokens per spec — assert serialized length stays under a generous byte budget like 8KB for fixture)
    - Test file: `discovery-service/src/services/runtimeEvidence/__tests__/runtimeEvidencePersistence.test.ts` and `discovery-service/src/services/runtimeEvidence/__tests__/runtimeEvidenceLlmContextBuilder.test.ts`
    - Pattern: mock `archModelClient` via `jest.mock('../../archModelClient')` + `jest.requireActual` spread (per project memory — partial mock without `requireActual` breaks runtime if callers use unmocked methods; the client has 22 methods so this is required)
  - [x] 3.2 Create `discovery-service/src/services/runtimeEvidence/runtimeEvidencePersistence.ts`
    - Export `persistRuntimeEvidence({ runId, matched, noUsage, runSummary, archModelClient }): Promise<void>`
    - Per-candidate write (matched): use `archModelClient.updateCandidate(candidateId, partial)` with payload `{ logEnrichment: { ...existingLogEnrichment, runtime: { matched } } }`. Read existing `logEnrichment` value first to preserve `{enriched, logAtomCount, signalSummary}` keys.
    - Per-candidate write (no usage): same pattern, payload `{ logEnrichment: { ...existing, runtime: { noUsageObserved: true, ...noUsageEvidence } } }`
    - Run-level write: use `archModelClient.updateRun(runId, partial)` (a.k.a. `updateDiscoveryRun`) with payload that namespaced-merges into `steps_payload.v3.runtimeEvidence` — preserve any existing sibling keys under `steps_payload.v3` (e.g. `gapFill`). Read-modify-write pattern.
    - If `archModelClient` does not yet expose a thin per-candidate `updateCandidate` method, add one that PUTs to `/candidates/{candidateId}` — NO new AMS endpoint involved, just a thin client wrapper. (Per shaping notes: "If a thin wrapper does not yet exist on the client, add a minimal `updateCandidate` method".)
    - Wrap individual per-candidate writes in try/catch — a single failed candidate write should warn and continue, not abort the whole persistence pass
  - [x] 3.3 Create `discovery-service/src/services/runtimeEvidence/runtimeEvidenceLlmContextBuilder.ts`
    - Export `buildRuntimeEvidenceLlmContext(matched: MatchedRuntimeEvidence[], noUsage: NoUsageRuntimeEvidence[], runSummary: RuntimeEvidenceRunSummary): RuntimeEvidenceLlmContext`
    - Output JSON shape pinned in spec:
      ```
      {
        runtimeEvidenceSummary: {
          logFilesProcessed,
          logWindow: { firstSeen, lastSeen },
          matchedEndpoints: [{ candidateId, method, pathTemplate, observedUsageCount, status2xxCount, status3xxCount, status4xxCount, status5xxCount }],
          codeEndpointsWithNoObservedUsage: [{ candidateId, method, pathTemplate }],
          unmatchedRuntimeRouteHints: [{ method, pathTemplate, observedUsageCount }]
        }
      }
      ```
    - Strip ALL fields not in the pinned shape — no `firstSeen`/`lastSeen` per endpoint, no source file lists, no sample line refs, no snippets
    - When input is the `{ skipped: true, ... }` variant of `RuntimeEvidenceRunSummary`, return a minimal context the gap-fill stage can interpret as "no runtime context available"
  - [x] 3.4 Ensure persistence and LLM context tests pass
    - Run ONLY the 2-8 tests written in 3.1: `npx jest discovery-service/src/services/runtimeEvidence/__tests__/runtimeEvidencePersistence.test.ts discovery-service/src/services/runtimeEvidence/__tests__/runtimeEvidenceLlmContextBuilder.test.ts`
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Per-candidate `logEnrichment.runtime` is ADDITIVE — existing keys preserved
- Run-level `steps_payload.v3.runtimeEvidence` does not overwrite sibling keys (e.g. `gapFill`)
- LLM context contains ONLY pinned fields; no raw log content, no IPs, no user agents
- `archModelClient` is called via existing methods (no new AMS endpoint required)

---

### Discovery Service — Orchestrator and Pipeline Insertion

#### Task Group 4: Orchestrator + V3 Pipeline Wiring
**Dependencies:** Task Groups 1-3

This is the riskiest group: it touches the live V3 pipeline file and inserts the new sub-stage. Confirm no live discovery run is active before starting (per project memory feedback `feedback_no_src_edits_during_run`).

- [x] 4.0 Complete orchestrator and pipeline insertion
  - [x] 4.1 Write 2-8 focused tests for orchestrator + pipeline integration
    - Limit to 2-8 highly focused tests maximum across orchestrator + integration combined
    - Test only critical behaviours:
      - Orchestrator: no-logs short-circuit returns `{ skipped: true, reason: 'no_log_artifacts' }` and persists same to `steps_payload.v3.runtimeEvidence`
      - Orchestrator: file-missing-on-disk records a warning, skips that file, continues with remaining files
      - Orchestrator: all-files-fail short-circuit returns `{ skipped: true, reason: 'log_processing_failed', warnings: [...] }`
      - Orchestrator: happy path produces matched evidence + no-usage entries + unmatched hints (using fixture log file + fixture deterministic candidate set)
      - Pipeline integration: `runDiscoveryRuntimeEvidence` is called between Stage 2 and Stage 3 in `runDiscoveryV3`; the `RuntimeEvidenceLlmContext` is injected into the gap-fill prompt context (assert the gap-fill call receives it)
      - Pipeline integration: when log processing fails, the discovery RUN does NOT fail — it continues to Stage 3 with no runtime context (acceptance criterion 22)
    - Skip exhaustive testing of every CLF byte-perfect parsing detail (covered in Group 1) and every matcher edge case (covered in Group 2)
    - Test files: `discovery-service/src/services/runtimeEvidence/__tests__/runDiscoveryRuntimeEvidence.test.ts` and `discovery-service/src/services/__tests__/discoveryV3Pipeline.runtimeEvidence.integration.test.ts`
    - Pattern: stub `FrameworkPack.adapt` to return fixture deterministic candidates; stub the LLM call (`runLlmGapFill` or its prompt composer) to capture the injected context; mock `archModelClient` per `jest.requireActual` spread pattern
    - Use real on-disk fixture log files placed under `discovery-service/src/__tests__/fixtures/runtimeEvidence/` (CLF + a JSONL sample) so the orchestrator's `fs.createReadStream` path is exercised end-to-end
  - [x] 4.2 Create `discovery-service/src/services/runtimeEvidence/runDiscoveryRuntimeEvidence.ts`
    - Export `runDiscoveryRuntimeEvidence({ projectId, runId, architectureId, projectFolder, deterministicCandidates, configSnapshot, archModelClient }): Promise<RuntimeEvidenceResult>`
    - `RuntimeEvidenceResult` shape: `{ persistenceSummary: RuntimeEvidenceRunSummary, llmContext: RuntimeEvidenceLlmContext }`
    - Step 1: read `configSnapshot.inputArtifacts.logFiles[]`. If empty/missing → write `{ skipped: true, reason: 'no_log_artifacts' }` to `steps_payload.v3.runtimeEvidence` via `runtimeEvidencePersistence` and return early.
    - Step 2: for each log file entry, resolve disk path as `path.join(projectFolder, entry.relativePath)`. Apply `LOG_PARSE_MAX_FILE_BYTES` (default `52428800`) per file and `LOG_PARSE_MAX_TOTAL_BYTES` (default `209715200`) total — files exceeding caps SKIP with warning, continue.
    - Step 3: for each surviving file, detect format via the format detector. If `clf_common` or `clf_combined`, use the new `accessLogParser`. Otherwise, use the existing `parseLogContent` from `logParsing/` (JSONL, syslog, framework_pattern, plaintext). DO NOT duplicate non-CLF parsing.
    - Step 4: stream parsed entries into `HttpRuntimeObservation` rows, applying `endpointPathNormalizer`. Skip entries lacking method/path/status (parser already extracts these as first-class fields for CLF; for non-CLF formats, attempt the existing `endpointUsageExtractor`-style regex against the message field).
    - Step 5: feed observations into `endpointRuntimeAggregator.aggregateObservations`.
    - Step 6: feed aggregates + `deterministicCandidates` into `endpointRuntimeMatcher.matchAggregatesToCandidates`.
    - Step 7: build `RuntimeEvidenceRunSummary` (logFilesProcessed, logWindow, totals, warnings, unmatchedRouteHints — filtered by env threshold).
    - Step 8: call `runtimeEvidencePersistence.persistRuntimeEvidence(...)`.
    - Step 9: call `runtimeEvidenceLlmContextBuilder.buildRuntimeEvidenceLlmContext(...)`.
    - Step 10: return `RuntimeEvidenceResult`.
    - Top-level try/catch: ANY uncaught error → write `{ skipped: true, reason: 'log_processing_failed', warnings: [errorMessage] }` to `steps_payload.v3.runtimeEvidence` and return a result whose `llmContext` is the no-runtime-available variant. The discovery run NEVER fails because of log processing (acceptance criterion 22).
  - [x] 4.3 Modify `discovery-service/src/services/discoveryV3Pipeline.ts`
    - Locate `runDiscoveryV3`. Confirm the 4-stage shape: Stage 1 `LanguagePack.extract` → Stage 2 `FrameworkPack.adapt` → Stage 3 `runLlmGapFill` (a.k.a. `runGapFillStage`) → Stage 4 merge + `bulkSaveCandidates`.
    - Insert call: `const runtimeEvidenceResult = await runDiscoveryRuntimeEvidence({ projectId, runId, architectureId, projectFolder, deterministicCandidates: stage2Candidates, configSnapshot, archModelClient });` immediately after Stage 2 and before Stage 3.
    - Pass `runtimeEvidenceResult.llmContext` into Stage 3's prompt composition. The exact mechanism mirrors how `packCandidates` and `ir` are already injected today — extend the gap-fill input shape additively with an optional `runtimeEvidenceContext?: RuntimeEvidenceLlmContext` field. NO change to existing fields.
    - DO NOT add to `VALID_STEPS`. DO NOT modify `runManager.ts`. The new sub-stage's status visibility is exclusively through `steps_payload.v3.runtimeEvidence` (mirrors the existing `gapFill` sub-tree pattern).
    - Verify `steps_payload.v3` namespace doesn't collide: the existing `gapFill` key sits there; the new key is `runtimeEvidence`.
  - [x] 4.4 Modify the gap-fill prompt composer
    - File: `discovery-service/src/services/llmGapFillStep.ts` (and/or its prompt composer module).
    - Accept the new optional `runtimeEvidenceContext` input. When present, render its compact JSON into a new prompt section labelled `Runtime Evidence Summary` placed alongside the existing `packCandidates` and `ir` sections. When absent or `{ skipped: true }`, render nothing (or a one-line "no runtime evidence available for this run" stub).
    - NO raw log content ever passed — only the pre-built `RuntimeEvidenceLlmContext`.
  - [x] 4.5 Ensure orchestrator + integration tests pass
    - Run ONLY the 2-8 tests written in 4.1: `npx jest discovery-service/src/services/runtimeEvidence/__tests__/runDiscoveryRuntimeEvidence.test.ts discovery-service/src/services/__tests__/discoveryV3Pipeline.runtimeEvidence.integration.test.ts`
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- `runDiscoveryV3` calls `runDiscoveryRuntimeEvidence` between Stage 2 and Stage 3
- `VALID_STEPS` and `runManager.ts` are UNCHANGED
- No-logs short-circuit produces `{ skipped: true, reason: 'no_log_artifacts' }` byte-for-byte preserving existing no-log behaviour
- Log-processing failure does NOT fail the discovery run
- Gap-fill prompt receives `runtimeEvidenceContext` when available
- `steps_payload.v3.runtimeEvidence` written; `steps_payload.v3.gapFill` (and any other sibling) preserved

---

### Verification

#### Task Group 5: End-to-End Verification and Non-Regression
**Dependencies:** Task Groups 1-4

This is the final group. It verifies all new tests pass together and confirms existing discovery-service test suites that COULD be affected still pass.

- [x] 5.0 Verify the full Spec 5 test set and confirm no regressions
  - [x] 5.1 Review existing tests written in Groups 1-4
    - Review the 2-8 tests written in Task 1.1 (foundation: types/normalizer/parser)
    - Review the 2-8 tests written in Task 2.1 (aggregator/matcher)
    - Review the 2-8 tests written in Task 3.1 (persistence/LLM context)
    - Review the 2-8 tests written in Task 4.1 (orchestrator + pipeline integration)
    - Total existing Spec 5 tests: 29 tests across 8 files (foundation: 5+2; aggregation/matching: 3+4; persistence/LLM: 5+4; orchestrator/integration: 4+2)
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identified two end-to-end gaps not exercised by the per-group unit tests:
      1. Mixed-format input (CLF + JSONL in the SAME run) — proves the orchestrator's per-file format-detection branch threads observations from BOTH formats into the matched `logEnrichment.runtime` payload that gets written.
      2. File-size cap exceeded — exercises the `LOG_PARSE_MAX_FILE_BYTES` skip path: warning recorded, oversized file skipped, run continues with remaining files.
    - The third candidate gap (ambiguous match observation) is already directly covered by the `endpointRuntimeMatcher.test.ts` unit test "ambiguous multi-candidate match (two non-deterministic best matches) → NOT attached to any candidate". No additional E2E test needed.
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Added 2 strategic E2E tests in `discovery-service/src/services/runtimeEvidence/__tests__/runDiscoveryRuntimeEvidence.e2e.test.ts`:
      1. Mixed CLF + JSONL E2E test — confirms both formats contribute observations to `logEnrichment.runtime` and the per-candidate write payload is correct end-to-end.
      2. File-size-cap E2E test — uses an artificially low `LOG_PARSE_MAX_FILE_BYTES` (256B) via `jest.isolateModules`, with a temp-dir fixture, to confirm the warning + skip + continue behaviour.
    - Total Spec 5 tests after 5.3: 31 (29 from groups 1-4 + 2 new in 5.3).
  - [x] 5.4 Run all Spec 5 feature-specific tests
    - All 31 Spec 5 tests across 9 test suites PASS:
      - `endpointPathNormalizer.test.ts` (5 pass)
      - `accessLogParser.test.ts` (2 pass)
      - `endpointRuntimeAggregator.test.ts` (3 pass)
      - `endpointRuntimeMatcher.test.ts` (4 pass)
      - `runtimeEvidencePersistence.test.ts` (5 pass)
      - `runtimeEvidenceLlmContextBuilder.test.ts` (4 pass)
      - `runDiscoveryRuntimeEvidence.test.ts` (4 pass)
      - `runDiscoveryRuntimeEvidence.e2e.test.ts` (2 pass — new in 5.3)
      - `discoveryV3Pipeline.runtimeEvidence.integration.test.ts` (2 pass)
  - [x] 5.5 Run targeted non-regression suites in `discovery-service`
    - Existing test files that COULD be affected (only those that actually exist):
      - `discoveryV3Pipeline.test.ts` + `discoveryV3Pipeline.techHints.test.ts` — PASS (3 + 6 = 9 tests)
      - `logParsing.test.ts` (covers `detectLogFormat` extension) — PASS (8/8 tests; 4 detectLogFormat assertions confirm the CLF detector extension does not break the 4 pre-existing format outputs)
      - `logEnrichmentRoutes.test.ts` — PASS (10/10)
      - `llmGapFillStep.test.ts` + `llmGapFillAddedByPersistence.test.ts` (covers the gap-fill composer extension that accepts `runtimeEvidenceContext`) — PASS (23/23)
      - `archModelClient*.test.ts` (7 files; covers the new `updateCandidate` thin wrapper and existing `updateDiscoveryRun`) — PASS (34/34)
    - Pre-existing failures (NOT introduced by Spec 5; rooted in the prior "Multi-architecture per project introduced" + earlier commits):
      - `runManagerAndRoutes.test.ts` — TS compile error: `mode` field missing in `DiscoveryRunResponseDto` mock fixtures (multi-arch DTO change)
      - `runManagerBackbone.test.ts` — same TS compile error as above
      - `runManagerPipelineRestructuring.test.ts` — TS compile error: `startRun` signature now requires `architectureId` as 3rd positional arg (multi-arch refactor)
      - `runManagerStepsPayloadMerge.test.ts` — Partial mock of `archModelClient` missing `resetDefaultArchitectureCache` (introduced in multi-arch spec); 2 tests fail
      - `logEnrichmentGapFill.test.ts` — 1 pre-existing test fail (`mockExecuteStep1c` not called as expected); unrelated to Spec 5
    - Verified: `runManager.ts`, the multi-arch DTO, and the gap-fill route are NOT modified by Spec 5; `git status` shows the branch is clean apart from work outside this spec's scope. The format-detector extension, `updateCandidate` wrapper, and V3 pipeline insertion introduced NO new regressions in the suites that compile.
  - [ ] 5.6 Manual smoke test (DEFERRED TO USER)
    - > **NOTE — DEFERRED TO USER**: Operator-only manual smoke; deferred to the user before marking Spec 5 complete. Do not attempt programmatically.
    - [ ] User: start a fresh discovery run that has log files uploaded via Spec 4
    - [ ] User: confirm the run completes successfully (status `complete`)
    - [ ] User: confirm `steps_payload.v3.runtimeEvidence` is populated with `logFilesProcessed`, `logWindow`, `totals`, and (where applicable) `unmatchedRouteHints[]`
    - [ ] User: confirm at least one endpoint candidate has `logEnrichment.runtime.matched` populated and that the existing `{enriched, logAtomCount, signalSummary}` keys are still present alongside it (additive merge worked)
    - [ ] User: confirm at least one endpoint candidate (one with no traffic in the fixture logs) has `logEnrichment.runtime.noUsageObserved === true`
    - [ ] User: spot-check the LLM gap-fill prompt log (if logged in dev) or trace evidence that `runtimeEvidenceSummary` was injected into the Stage 3 prompt
    - [ ] User: start a second run with NO log files uploaded; confirm `steps_payload.v3.runtimeEvidence === { skipped: true, reason: 'no_log_artifacts' }` and run completes normally

**Acceptance Criteria:**
- All Spec 5 feature-specific tests pass (approximately 18-42 tests total)
- No regressions in `runManager`, V3 pipeline, log format detector, log-enrichment route, or archModelClient test suites
- No more than 10 additional tests added in 5.3
- Testing focused exclusively on Spec 5's runtime evidence pipeline
- Manual smoke checklist (5.6) deferred to user with clear NOTE block — not blocking on programmatic completion

---

## Execution Order

Recommended implementation sequence:
1. Foundation modules — types + path normalizer + access log parser (Task Group 1)
2. Aggregator + matcher (Task Group 2)
3. Persistence + LLM context builder (Task Group 3)
4. Orchestrator + V3 pipeline insertion + gap-fill prompt wiring (Task Group 4)
5. End-to-end verification + non-regression (Task Group 5)

## Critical Constraints (recap)

- NO new top-level pipeline step. `VALID_STEPS = ['1a', '1b', '1c-llm-analysis']` stays exactly as-is.
- NO frontend, NO gateway, NO architecture-model-service code or schema changes.
- Per-candidate `logEnrichment.runtime` is ADDITIVE — existing `{enriched, logAtomCount, signalSummary}` keys MUST be preserved (read-modify-write).
- Run-level `steps_payload.v3.runtimeEvidence` MUST NOT collide with existing `steps_payload.v3` keys (e.g. `gapFill`); namespaced merge required.
- Path normalization tier order: numeric → UUID → 16+ chars-with-digit. Slug-only segments NOT normalized.
- Cross-method matching only when code candidate's method is unknown/missing.
- Unmatched-hint threshold env-configurable as `RUNTIME_UNMATCHED_HINT_THRESHOLD` (default 5), applied globally.
- Pure-404 routes excluded from BOTH endpoint evidence AND unmatched hints regardless of count.
- Discovery run NEVER fails solely because log processing fails.
- File size limits: per-file 50MB (`LOG_PARSE_MAX_FILE_BYTES`), total 200MB (`LOG_PARSE_MAX_TOTAL_BYTES`).
- Stream/line-by-line parsing where practical (`fs.createReadStream + readline.createInterface`).
- NO IPs / user agents / referrers stored in candidate evidence or run summary.
- NO raw log content passed to LLM.
- Reuse `parseLogContent` and `ParsedLogEntry` from `logParsing/` for non-CLF formats; reuse `archModelClient.updateRun` and `archModelClient.updateCandidate` (add thin wrapper if missing).
- Implementation discipline: do NOT edit `discovery-service/src/**` while a discovery run is active (`tsx watch` reload kills the run).
