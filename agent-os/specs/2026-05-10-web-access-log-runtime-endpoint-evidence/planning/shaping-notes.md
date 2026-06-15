# Shaping Notes — Spec 5: Web Access Log Runtime Endpoint Evidence

Date: 2026-05-10. Author: spec-shaper. Inputs: `planning/raw-idea.md`, brief from caller, code inspection of `discovery-service` + `architecture-model-service`.

---

## 1. Current Pipeline Shape (as inspected)

### Run pipeline (`runManager.ts`)

`VALID_STEPS = ['1a', '1b', '1c-llm-analysis']` (line 180).

| Step | Function | Purpose | Where the step's work lives |
|---|---|---|---|
| `1a` | `executeStep1a` | Phase 1a analyzer pack (universal extraction) → atoms | `phase1aAnalyzerPack.ts` |
| `1b` | `executeStep1b` | Linker rules → relationships → triage → DecisionTasks resolved by gateway LLM | `linkerRules/`, `triageEngine.ts`, `gatewayClient.resolveDecisionTasks` |
| `1c-llm-analysis` | `executeStepLlmAnalysis` → `executeLlmFileAnalysis` → `runDiscoveryV3` | Clones repo, runs deterministic LanguagePack + FrameworkPack, then LLM gap-fill, then candidate persist | `llmFileAnalysisStep.ts` → `discoveryV3Pipeline.ts` (4 stages) |

### Where deterministic vs LLM work happens

The deterministic / LLM split is INSIDE step `1c-llm-analysis`, not BETWEEN steps:

`runDiscoveryV3` (`discoveryV3Pipeline.ts`) has 4 stages:
1. **Stage 1**: `LanguagePack.extract()` — IR from source files (deterministic)
2. **Stage 2**: `FrameworkPack.adapt()` — pack-emitted candidates from IR (deterministic)
3. **Stage 3**: `runLlmGapFill` — per-file LLM gap-fill with prompt composition (LLM)
4. **Stage 4**: merge pack + LLM candidates, persist via `bulkSaveCandidates`

This means "after deterministic analysis, before LLM gap-fill/review" (the brief's wording) maps to a precise insertion point: **after Stage 2 of `runDiscoveryV3`, before Stage 3** — OR a brand-new step `1b-log-enrichment` between `1b` and `1c-llm-analysis` (but a new step doesn't have access to deterministic endpoint candidates yet, since those are produced INSIDE `1c-llm-analysis`).

This is the single biggest decision in the spec. See Question 1 below.

### Pre-existing log-enrichment route

`POST /discovery/log-enrichment` (`logEnrichment.ts`) is a SEPARATE, MANUAL endpoint:
- Operates on ALREADY-COMPLETED runs
- Takes inline `logContent` or a `logFilePath` (single file)
- Calls `parseLogContent` → `runAllLogExtractors` → `archModelClient.bulkSaveEvidence`
- Persists log-derived findings as evidence ATOMS with `source: "log"` and `data.patternName: "endpoint_usage_log"` etc.
- A separate `POST /discovery/reprocess` endpoint then re-runs `1b` + `1c-llm-analysis` against the enriched atom set.

This route is NOT part of the live pipeline. It's a manual reprocess path. Spec 5 must run inside the pipeline, not via this route. But it can REUSE much of the parsing/extractor code.

### Existing log parsing capability

`logParsing/`:
- `logFormatDetector.ts` — auto-detects format; current outputs: `json_lines | syslog | framework_pattern | unknown`. **No detector for Apache/Nginx common/combined**.
- `jsonLinesParser.ts`, `syslogParser.ts`, `frameworkPatternParser.ts`, `plaintextParser.ts` — all produce `ParsedLogEntry { timestamp, level, logger, message, rawLine, lineNumber, metadata }`.
- `parseLogContent(content)` — convenience auto-dispatcher.

Gap: **no Apache/Nginx CLF/combined parser**. Existing parsers extract a generic `message` field; HTTP method/path/status are NOT first-class. Endpoint extractor regex-mines the `message` field.

`logExtractors/`:
- `endpointUsageExtractor.ts` — regex-based scan of `entry.message`; produces `string_pattern` atoms with patternName `endpoint_usage_log`. **Already does basic path normalization: `/\d+/g → /{id}`**.
- Plus `serviceInteractionExtractor`, `errorTraceExtractor`, `databaseQueryExtractor`, `userFlowHintExtractor` — all out of scope for Spec 5 (the brief explicitly excludes service deps, DB queries, error analysis as candidate-producing).

Gap (vs Spec 5 needs):
- No status code extraction → cannot do 2xx/3xx vs 4xx/5xx semantics
- No timestamp window aggregation (firstSeen/lastSeen)
- No UUID/long-hash normalization (only numeric IDs)
- No matching to deterministic code endpoint candidates
- No no-usage marking for unmatched code endpoints
- No unmatched-route-hint threshold logic

So Spec 5 is mostly NEW logic but can reuse `parseLogContent` for non-CLF formats and `ParsedLogEntry` as the line model.

### Existing `logEnrichment` field on DiscoveryCandidate

**Critical finding**: `DiscoveryCandidate.logEnrichment?: LogEnrichmentMetadata` already exists (TS at `types/candidate.ts:170`, Java DTO at `DiscoveryCandidateDto.java:89` with `@JsonProperty("log_enrichment")`).

Current shape (Increment 14):
```ts
interface LogEnrichmentMetadata {
  enriched: boolean;
  logAtomCount: number;
  signalSummary: string;
}
```

This is currently a thin summary computed during candidate generation by `logEnrichmentMetadata.ts`. It's a JSONB column on the candidate row, written via `bulkSaveCandidates` and updateable via `PUT /candidates/{id}`. **It can hold richer runtime evidence** without any schema migration — just expand the JSON shape.

### AMS controllers — what already exists

| Controller | Endpoint | Use for Spec 5? |
|---|---|---|
| `DiscoveryRunController` | `PUT /runs/{runId}` (full payload) | Could write `steps_payload.runtimeEvidence` blob |
| `DiscoveryRunController` | `PATCH /runs/{runId}/input-artifacts/log-files` | NOT applicable — Spec 4 specific |
| `DiscoveryRunController` | (no other PATCH endpoint for steps_payload sub-keys) | The PUT works for steps_payload, see V3 pipeline pattern |
| `DiscoveryEvidenceController` | `POST /evidence` (bulk insert atoms) | Could persist runtime observations as atoms (existing pattern) |
| `DiscoveryCandidateController` | `PUT /candidates/{candidateId}` | Could write `log_enrichment` JSONB per candidate — **strong reuse fit** |
| `DiscoveryCandidateController` | `POST /candidates` (bulk) | Already used to seed candidates in step 1c |

**No new AMS endpoint is strictly required** — every persistence option below is reachable through existing controllers.

---

## 2. Pipeline Insertion Decision (Question 1)

Three viable insertion points:

### Option A: NEW step `1b-log-enrichment` between `1b` and `1c-llm-analysis`
- Pros: clean separation, new step name visible in `current_step`, easy to resume independently
- Cons: **deterministic endpoint candidates DON'T EXIST YET at this point** (they're produced inside `1c-llm-analysis` Stage 2). Matching must be deferred or the step would only do parse+aggregate, with matching pushed into 1c. Splits the work awkwardly.

### Option B: Internal sub-step inside `executeStepLlmAnalysis`, between Stage 2 and Stage 3 of `runDiscoveryV3`
- Pros: deterministic pack candidates ARE available (Stage 2 just emitted them). Clean match-and-attach in one place. LLM context can be built and injected into Stage 3 trivially.
- Cons: hides the work inside `1c-llm-analysis` — `current_step` does not change, no resume granularity. Status/observability is via `steps_payload.v3.runtimeEvidence` sub-tree (mirroring how `gapFill` already lives there).
- **Recommended default.** Mirrors the existing pattern where Stage 3 (`gapFill`) lives inside the same step and persists its summary into `steps_payload.v3.gapFill`.

### Option C: New sub-step PLUS new VALID_STEPS entry (e.g. `1c-log-enrichment` between current 1b and 1c)
- Pros + Cons: a hybrid; same matching problem as Option A.

### Recommendation
**Option B** — implemented as a new function (e.g. `runRuntimeEvidenceStage`) called from `runDiscoveryV3` between Stage 2 (pack adapt) and Stage 3 (LLM gap-fill). Stage status persisted to `steps_payload.v3.runtimeEvidence`.

---

## 3. Persistence Decision (Question 2)

Three viable targets:

### Option A: Single run-level blob — `steps_payload.v3.runtimeEvidence` (or `config_snapshot.runtimeEvidence`)
- Pros: one write, matches the existing `gapFill` pattern; trivially holds matched + unmatched + summary together
- Cons: Spec 6 will read it back per-row in the candidates table — needs to denormalize per-candidate at read time (acceptable; Spec 6 is a UI spec, the run object is small)

### Option B: Per-candidate `logEnrichment` JSONB on `DiscoveryCandidate`
- Pros: **field already exists and is wired end-to-end** (Java DTO, TS type, JSONB column, persist via `bulkSaveCandidates` or update via `PUT /candidates/{id}`); Spec 6 reads each candidate row directly with no extra fetch
- Cons: only works for matched and no-usage cases; unmatched route hints have no candidate to attach to → still need a sibling location for those

### Option C: Per-candidate evidence atoms via `bulkSaveEvidence`
- Pros: fits existing `string_pattern + source: "log"` pattern; the pre-existing `endpoint_usage_log` atom design already does this
- Cons: atoms are raw observations not aggregates; the brief wants a structured per-endpoint summary, not 1842 atoms per endpoint; queries to roll up are awkward; reviewers will not see them in the candidate row

### Recommendation: hybrid B + A
- Per-endpoint matched evidence and per-endpoint no-usage evidence → expand the existing `DiscoveryCandidate.logEnrichment` JSON shape (Option B)
- Run-level summary including `unmatchedRuntimeRouteHints[]` and `logProcessingSummary{}` → `steps_payload.v3.runtimeEvidence` (Option A)
- Both reachable today via existing AMS endpoints (`PUT /candidates/{id}` and `PUT /runs/{runId}` with `steps_payload`). No new AMS endpoint needed.

---

## 4. Other Decisions Settled by Code Inspection (no question needed)

| Decision | Default chosen | Reason |
|---|---|---|
| LLM context injection mechanism | Add `runtimeEvidenceSummary` field to `GapFillStepFile` (or composer input) and inject as a new prompt section in `prompts/composer.ts` | Mirrors how `packCandidates`, `ir`, etc. are injected today |
| Module location | `discovery-service/src/services/runtimeEvidence/` (sibling of `logExtractors/` and `logParsing/`) | Matches existing folder convention |
| Suggested module names from brief (accessLogParser, endpointPathNormalizer, endpointRuntimeAggregator, endpointRuntimeMatcher, runtimeEvidencePersistence, runtimeEvidenceLlmContextBuilder) | Use them | Brief specifies; consistent with existing log* naming |
| Reuse `parseLogContent` for non-CLF formats | Yes | Already handles JSONL/syslog/framework/plaintext |
| Add new Apache/Nginx common+combined CLF parser | Yes (NEW) | No existing parser; brief explicitly requires |
| Add new format detector branch for `clf_common`/`clf_combined` | Yes (NEW) | Detector currently returns `unknown` for CLF lines |
| Behaviour when no log artifacts | Skip the runtime evidence stage entirely; `runtimeEvidence: { skipped: true }` in steps_payload | Matches "no logs → existing behaviour unchanged" acceptance criterion |
| Behaviour when log processing fails | Catch top-level, write `runtimeEvidence: { stageStatus: 'failed', error }` to steps_payload + run `warnings`, continue to Stage 3 | Matches "do not fail the whole run" criterion |
| File size enforcement | Reuse the 50MB/200MB env-configurable limits already established in Spec 4 | Brief says so |
| Streaming vs whole-file read | Read whole file (consistent with `executeLlmFileAnalysis` reading source files into memory); add a per-file `LOG_MAX_BYTES_PER_FILE` early-exit | Simpler; existing 50MB limit caps memory |
| Query string handling | Strip `?...` before normalization | Brief specifies |
| Path normalization rules (numeric/UUID specifics) | Numeric: `^\d+$`; UUID: 8-4-4-4-12 hex regex | Standard |
| Match preference order | Exact method+path > equivalent placeholder match (brief specifies) | Brief specifies |
| Ambiguous match behaviour | Don't attach automatically; record under run-level `runtimeEvidence.ambiguousObservations[]` for transparency | Brief specifies first half; second half is implementation detail |
| Test layout | `discovery-service/src/services/runtimeEvidence/__tests__/` per existing Jest convention | Matches repo |

---

## 5. Genuine Open Questions (4 of them)

These all have downstream-spec or architecture-significant implications that I cannot reasonably default unilaterally.

### Q1. Pipeline insertion point
Where does Spec 5's runtime-evidence stage live?
- **Option A**: NEW pipeline step `1b-log-enrichment` between `1b` and `1c-llm-analysis` (parse + aggregate only; matching deferred to 1c — splits the work)
- **Option B (recommended)**: internal sub-stage inside `runDiscoveryV3`, between Stage 2 (FrameworkPack.adapt) and Stage 3 (LLM gap-fill). Status persisted to `steps_payload.v3.runtimeEvidence`. Mirrors the existing `gapFill` sub-stage pattern. Deterministic endpoint candidates are available so matching happens in one place.
- **Option C**: NEW step `1c-log-enrichment` after the current `1c-llm-analysis` (post-LLM) — rejected because brief explicitly says BEFORE LLM gap-fill.

### Q2. Persistence target
Where does the runtime evidence get persisted?
- **Option A**: single run-level blob at `discovery_run.steps_payload.v3.runtimeEvidence` (matched + no-usage + unmatched + summary all in one)
- **Option B**: per-candidate, expanding the EXISTING `DiscoveryCandidate.logEnrichment` JSONB field (already in Java DTO + TS type + DB column from Increment 14) — for matched + no-usage; unmatched route hints have nowhere candidate-side to live so still need a sibling
- **Option C**: per-candidate evidence atoms via the existing `string_pattern + source: "log"` atom path — hits the wrong granularity (raw observations, not aggregates)
- **Recommended hybrid (B + A)**: matched + no-usage in candidate `logEnrichment`; unmatched + run summary in `steps_payload.v3.runtimeEvidence`. No new AMS endpoint required.

### Q3. Unmatched route hint threshold — global or per-host? Configurable?
Brief says "≥5 successful/redirect responses" before producing an unmatched route hint.
- **Option A**: hardcoded constant `UNMATCHED_HINT_MIN_2XX_3XX = 5` in code
- **Option B (recommended)**: env-configurable with default 5 (matches the pattern of `LOG_MAX_CONTENT_SIZE_BYTES`, `GAP_FILL_CONCURRENCY` etc.) → `RUNTIME_UNMATCHED_HINT_THRESHOLD`
- **Per-host vs global**: brief doesn't say. Recommended default: **global** (per-host adds host-extraction logic the brief doesn't ask for). If multiple hosts are in the same log, a route appearing on host A 4× and host B 4× still won't pass threshold — this is conservative and matches the brief's "avoid noise" intent.

### Q4. Long-hash normalization length cutoff
Brief says "long hashes/tokens → {id}" but doesn't define "long". Examples in the brief include `a1b2c3d4e5f6g7h8` (16 chars).
- **Option A**: 8+ chars hex (overly aggressive — would catch `abcdef12`)
- **Option B (recommended)**: 16+ chars matching `[a-zA-Z0-9_-]+` AND containing at least one digit AND not a known dictionary word — this catches Base64-ish slugs, hex tokens, JWT segments, but leaves human-readable slugs like `my-product-name` alone
- **Option C**: 32+ chars (matches MD5/SHA hashes only — too narrow, misses 16-char slugs like the brief's own example)

Recommendation: 16+ chars with at-least-one-digit constraint. Document the rule in the path normalizer module.

---

## 6. Summary of Code Files Inspected

**Pipeline core**:
- `discovery-service/src/services/runManager.ts` (2276 lines) — VALID_STEPS, executeStep1a/1b/LlmAnalysis
- `discovery-service/src/services/discoveryV3Pipeline.ts` (679 lines) — 4-stage V3 pipeline
- `discovery-service/src/services/llmFileAnalysisStep.ts` (362 lines) — bridge between runManager and V3
- `discovery-service/src/services/llmGapFillStep.ts` (1250 lines) — LLM gap-fill stage

**Existing log infrastructure**:
- `discovery-service/src/routes/logEnrichment.ts` — manual reprocess route (NOT in pipeline)
- `discovery-service/src/services/logParsing/{index,logFormatDetector,jsonLinesParser,syslogParser,frameworkPatternParser,plaintextParser}.ts`
- `discovery-service/src/services/logExtractors/{index,endpointUsageExtractor,...}.ts`
- `discovery-service/src/services/logEnrichmentMetadata.ts` — Increment 14 candidate enrichment summary

**Persistence**:
- `discovery-service/src/services/archModelClient.ts` (1759 lines) — 22+ methods; runtime needs reachable via existing `updateDiscoveryRun` (steps_payload), `bulkSaveCandidates`, and (new helper) per-candidate update
- `architecture-model-service/src/main/java/.../controller/DiscoveryRunController.java` — has `PUT /runs/{runId}` and `PATCH /input-artifacts/log-files`; no per-key steps_payload PATCH but PUT works
- `architecture-model-service/src/main/java/.../controller/DiscoveryCandidateController.java` — has `PUT /candidates/{id}` for per-candidate updates
- `architecture-model-service/src/main/java/.../controller/DiscoveryEvidenceController.java` — has `POST` for bulk atom insert
- `architecture-model-service/src/main/java/.../model/dto/DiscoveryCandidateDto.java` — already has `logEnrichment` JSONB field (line 89, `@JsonProperty("log_enrichment")`)
- `discovery-service/src/types/candidate.ts` — `LogEnrichmentMetadata` interface (line 112), `DiscoveryCandidate.logEnrichment` field (line 170)

**Types/constants**:
- `discovery-service/src/types/candidate.ts` (172 lines)
- `discovery-service/src/constants/candidateTypes.ts` — `endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities` all listed in `SERVICE_SCOPED_CANDIDATE_TYPES`

**Visuals**: none provided; bash check confirmed empty.

---

## Resolved decisions (user-confirmed 2026-05-10)

The four clarifying questions raised during shaping have been resolved by the user. All four match the shaper's recommended defaults.

1. **Pipeline insertion point → option (b): internal sub-stage inside `runDiscoveryV3`, between Stage 2 (`FrameworkPack.adapt`) and Stage 3 (LLM gap-fill).**
   - The sub-stage is internal to `runDiscoveryV3`; no new top-level step is added to `VALID_STEPS`. The pipeline shape stays `1a → 1b → 1c-llm-analysis`.
   - Sub-stage status, results, log window, processed file counts, warnings, and unmatched-hint summary are persisted to `steps_payload.v3.runtimeEvidence` (mirrors the existing `gapFill` pattern).
   - When the run has no uploaded log artifacts (`config_snapshot.inputArtifacts.logFiles[]` empty/missing), the sub-stage is a fast no-op: write `steps_payload.v3.runtimeEvidence = { skipped: true, reason: 'no_log_artifacts' }` and immediately proceed to Stage 3. Existing no-log behaviour is byte-for-byte preserved.

2. **Persistence target → option (d): hybrid.**
   - **Per-candidate evidence** (matched runtime evidence + no-usage evidence for endpoint candidates) is written to the existing `DiscoveryCandidate.logEnrichment` JSONB field via the existing AMS `PUT /candidates/{candidateId}` endpoint. No schema change. The `logEnrichment` blob shape is extended (additive) with a new `runtime` sub-key holding the matched/no-usage payload from the spec; the existing `{enriched, logAtomCount, signalSummary}` keys remain untouched for backwards compatibility.
   - **Run-level summary** (log window, log files processed, processing warnings, unmatched route hints, totals) is written to `steps_payload.v3.runtimeEvidence` via the existing AMS `PUT /runs/{runId}` endpoint.
   - No new AMS endpoint or controller is added in Spec 5.

3. **Unmatched-hint threshold → option (b): env-configurable, default 5, applied globally.**
   - Env var: `RUNTIME_UNMATCHED_HINT_THRESHOLD` (number; default `5`).
   - Read at module init in the unmatched-hints aggregator (e.g. `endpointRuntimeAggregator.ts`).
   - Applied globally — host extraction is intentionally NOT added in Spec 5.
   - Pure 404 routes are still excluded entirely from unmatched hints regardless of threshold (per spec acceptance criterion 11).

4. **Long-hash normalization cutoff → option (b): 16+ chars matching `[a-zA-Z0-9_-]+` with at least one digit.**
   - Predicate: segment matches `^[a-zA-Z0-9_-]{16,}$` AND contains at least one digit (`/\d/.test(segment)`).
   - Catches the brief's own example (`a1b2c3d4e5f6g7h8` — 16 chars, has digits) and standard hex/base64 IDs.
   - Leaves human slugs like `my-product-name` alone (no digits).
   - Numeric-only segments and UUIDs continue to be normalized via their existing dedicated rules (numeric `^\d+$` and UUID `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` case-insensitive). The 16+ char rule is the third tier and runs after the numeric and UUID checks.

---
