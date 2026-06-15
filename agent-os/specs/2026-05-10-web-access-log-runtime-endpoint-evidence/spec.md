# Specification: Web Access Log Runtime Endpoint Evidence

## Goal
Process the runtime log files uploaded in Spec 4 to derive structured HTTP endpoint runtime evidence, match it to deterministic code-discovered endpoint candidates, and persist it for later UI display and LLM consumption — all inside the existing `1c-llm-analysis` step between Stage 2 (FrameworkPack.adapt) and Stage 3 (LLM gap-fill). This is Spec 5 of a 7-spec roadmap and is the most code-heavy spec, almost entirely confined to `discovery-service`.

## User Stories
- As a discovery reviewer, I want runtime traffic patterns from uploaded logs attached to my endpoint candidates so that I can see which endpoints are actually used and how they respond in production.
- As a discovery reviewer, I want endpoints with no observed log traffic clearly marked as "no usage observed" (not "unused") so that absence of data is not mistaken for evidence of removal.
- As an LLM-driven gap-fill stage, I want a compact structured runtime evidence summary in my prompt context so that I can reason about endpoint relevance without ingesting raw log files.

## Specific Requirements

**Scope summary**
- Almost entirely inside `discovery-service`.
- NO frontend changes, NO gateway changes, NO architecture-model-service code or schema changes.
- Persistence reuses the existing AMS `PUT /runs/{runId}` and `PUT /candidates/{candidateId}` endpoints; no new AMS endpoint or controller is added.
- Pipeline step names stay `1a → 1b → 1c-llm-analysis`; no new top-level step is registered in `VALID_STEPS`.

**What changes from Spec 4 / what does NOT change**
- Spec 5 consumes the upload pathway Spec 4 created: log files on disk at `{projectFolder}/discovery-runs/{runId}/logs/{sanitizedName}` and metadata at `discovery_run.config_snapshot.inputArtifacts.logFiles[]`. There is no overlap of code with Spec 4.
- Unchanged: pipeline step names (`1a`, `1b`, `1c-llm-analysis`), all Spec 1-3 frontend code, the existing manual `POST /discovery/log-enrichment` reprocess route, the existing `logEnrichment` keys `{enriched, logAtomCount, signalSummary}` (the new `runtime` sub-key is additive), the existing `endpointUsageExtractor` and atom-based path, and all existing AMS controllers/DTOs.

**Pipeline insertion point**
- Locate `runDiscoveryV3` in `discovery-service/src/services/discoveryV3Pipeline.ts` and insert a new function call between Stage 2 (`FrameworkPack.adapt(...)`) and Stage 3 (`runLlmGapFill(...)`).
- New orchestrator function: `runDiscoveryRuntimeEvidence({ projectId, runId, architectureId, projectFolder, deterministicCandidates, configSnapshot }): Promise<RuntimeEvidenceResult>`.
- Sub-stage status, results, log window, processed file counts, warnings, and unmatched-hint summary persisted to `steps_payload.v3.runtimeEvidence` (mirrors existing `gapFill` sub-stage pattern).
- No-logs short-circuit: if `configSnapshot.inputArtifacts.logFiles[]` is empty/missing, return `{ skipped: true, reason: 'no_log_artifacts' }`, persist that to `steps_payload.v3.runtimeEvidence`, and immediately proceed to Stage 3 — preserves existing no-log behaviour byte-for-byte.

**New module list (under `discovery-service/src/services/runtimeEvidence/`)**
- `accessLogParser.ts` — Apache/Nginx Common Log Format and Combined Log Format parser (the format the brief explicitly requires that no existing parser covers).
- `httpRuntimeObservation.ts` — TypeScript types for parsed observation rows: method, path, status, timestamp, source artifact reference, line number, optional safe snippet.
- `endpointPathNormalizer.ts` — three-tier normalization (numeric, UUID, long-token-with-digit); preserves the matched code endpoint's path template for display.
- `endpointRuntimeAggregator.ts` — aggregates observations by `method + normalizedPath` with status distribution; emits unmatched route hints respecting the env-configurable threshold; reads `RUNTIME_UNMATCHED_HINT_THRESHOLD` at module init (default 5).
- `endpointRuntimeMatcher.ts` — matches aggregated observations to deterministic endpoint candidates per the matching rules below.
- `runtimeEvidencePersistence.ts` — writes per-candidate `logEnrichment.runtime` via existing `archModelClient.updateCandidate` and run-level `steps_payload.v3.runtimeEvidence` via existing `archModelClient.updateRun`.
- `runtimeEvidenceLlmContextBuilder.ts` — produces the compact `runtimeEvidenceSummary` JSON for the gap-fill prompt.
- `runDiscoveryRuntimeEvidence.ts` — orchestrator called from `discoveryV3Pipeline.ts`; loads files from disk via `relativePath`, parses, aggregates, matches, persists, and returns `RuntimeEvidenceResult` for the LLM context builder.

**Type definitions to pin**
- `HttpRuntimeObservation` — `{ method, rawPath, normalizedPath, status, timestampIso?, sourceArtifactId, sourceFileName, lineNumber, snippet? }`.
- `EndpointRuntimeAggregate` — keyed by `method + normalizedPath`; carries `totalLogRequests`, `observedUsageCount` (2xx+3xx only), `status2xxCount`, `status3xxCount`, `status4xxCount`, `status5xxCount`, `topStatusCodes`, `firstSeen`, `lastSeen`, `sourceLogFileCount`, `sourceLogFiles[]`, `sampleLineRefs[]`.
- `MatchedRuntimeEvidence` — per-candidate matched output: `{ candidateId, candidateType: 'endpoints', method, codePathTemplate, normalizedLogPath, ...counts, firstSeen, lastSeen, sourceLogFileCount, matchConfidence: 'high' | 'medium' | 'low', matchReason }`.
- `NoUsageRuntimeEvidence` — per-candidate no-observation output: `{ candidateId, candidateType: 'endpoints', observedUsageCount: 0, ...zeroedCounts, noUsageObserved: true, note }`.
- `UnmatchedRouteHint` — run-level unmatched hint: `{ method, pathTemplate, observedUsageCount, status2xxCount, status3xxCount }`.
- `RuntimeEvidenceRunSummary` — run-level summary persisted to `steps_payload.v3.runtimeEvidence`: `{ logFilesProcessed, logWindow: { firstSeen, lastSeen }, totals: { observations, matchedEndpoints, noUsageEndpoints, unmatchedHints }, warnings: string[], unmatchedRouteHints: UnmatchedRouteHint[] }`. Variant shapes: `{ skipped: true, reason: 'no_log_artifacts' }` and `{ skipped: true, reason: 'log_processing_failed', warnings: string[] }`.
- `LogEnrichmentRuntimeBlock` — the new `runtime` sub-key inside `LogEnrichmentMetadata`: union of `{ matched: MatchedRuntimeEvidence }` or `{ noUsageObserved: true } & NoUsageRuntimeEvidence`.
- `RuntimeEvidenceLlmContext` — compact LLM-facing summary matching the brief's example shape: `{ logFilesProcessed, logWindow, matchedEndpoints[], codeEndpointsWithNoObservedUsage[], unmatchedRuntimeRouteHints[] }`.

**Path normalization rules (applied per segment, after query string is stripped)**
- Tier 1 — numeric: `^\d+$` → `{id}`.
- Tier 2 — UUID: `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (case-insensitive) → `{id}`.
- Tier 3 — long token: `^[a-zA-Z0-9_-]{16,}$` AND `/\d/.test(segment)` → `{id}`. Catches `a1b2c3d4e5f6g7h8` and standard hex/base64 IDs; leaves human slugs like `my-product-name` alone.
- Otherwise: segment unchanged.
- Query strings stripped (`?...` and onwards) before normalization.

**Matching rules**
- HTTP method must match (case-insensitive). Cross-method matches are NOT allowed unless the code candidate's method is unknown/missing.
- Exact normalized path match preferred.
- Then equivalent placeholder match: different placeholder names accepted (e.g. `/owners/{id}/pets/{id}` matches `/owners/{ownerId}/pets/{petId}`).
- When matched, the code candidate's original path template is preserved as `codePathTemplate` for display; the observation's `normalizedLogPath` is also retained.
- If multiple candidates match the same observation: pick the most specific path if deterministic; otherwise mark ambiguous and DO NOT attach to any candidate (record the observation in run-level summary if practical, but never auto-assign).
- `matchConfidence` values: `high` for exact normalized path match, `medium` for equivalent-placeholder match, `low` reserved for future use.

**Status code semantics**
- Observed usage = 2xx + 3xx only (`observedUsageCount` counts these).
- 4xx and 5xx retained as `status4xxCount` / `status5xxCount` for status distribution but do NOT contribute to `observedUsageCount`.
- Pure-404 routes (every observation is 404, with zero 2xx/3xx) excluded entirely from endpoint evidence AND from unmatched route hints.

**Persistence shape**
- Per-candidate (matched): `logEnrichment.runtime = { matched: MatchedRuntimeEvidence }` written via `PUT /candidates/{candidateId}`. The existing `{ enriched, logAtomCount, signalSummary }` keys remain untouched (additive merge).
- Per-candidate (no usage): `logEnrichment.runtime = { noUsageObserved: true, ...NoUsageRuntimeEvidence }` written via the same endpoint.
- Run-level summary: `steps_payload.v3.runtimeEvidence = RuntimeEvidenceRunSummary | { skipped: true, reason: 'no_log_artifacts' } | { skipped: true, reason: 'log_processing_failed', warnings: string[] }` written via `PUT /runs/{runId}`.

**LLM context shape (for gap-fill prompt)**
- Pin exact JSON shape from the brief's example: `{ runtimeEvidenceSummary: { logFilesProcessed, logWindow: { firstSeen, lastSeen }, matchedEndpoints: [{ candidateId, method, pathTemplate, observedUsageCount, status2xxCount, status3xxCount, status4xxCount, status5xxCount }], codeEndpointsWithNoObservedUsage: [{ candidateId, method, pathTemplate }], unmatchedRuntimeRouteHints: [{ method, pathTemplate, observedUsageCount }] } }`.
- Inject into the existing gap-fill prompt composer alongside `packCandidates` and `ir`; no raw log content ever passed to the LLM.

**Failure-mode policy**
- Log file missing on disk → record a warning in the run-summary `warnings[]`, skip that file, continue with remaining files.
- Log file fails to parse (any format) → record warning, skip that file, continue.
- All files fail or artifact list malformed → run continues, sub-stage records `{ skipped: true, reason: 'log_processing_failed', warnings: [...] }`, LLM stage proceeds without runtime context.
- The discovery run NEVER fails solely because log processing failed (acceptance criterion 22).

**Processing limits and streaming (per Spec 4 caps)**
- Per-file cap 50MB via `LOG_PARSE_MAX_FILE_BYTES` (default `52428800`).
- Total bundle cap 200MB via `LOG_PARSE_MAX_TOTAL_BYTES` (default `209715200`).
- Files exceeding caps → skip with warning, continue.
- Stream/line-by-line parsing where practical via `fs.createReadStream + readline.createInterface` to bound memory.

**Security and privacy**
- Do NOT store IPs, user agents, or referrers in any candidate evidence or run summary.
- Do NOT pass raw log content (full or excerpted at length) to the LLM.
- Snippets in evidence kept ≤200 chars and only included when consistent with existing evidence-atom snippet conventions.

## Visual Design
No visual mockups were provided in `planning/visuals/` (folder exists but is empty). This spec is backend-only inside `discovery-service`; UI display of the produced data lives in Specs 6 and 7.

## Existing Code to Leverage

**`discovery-service/src/services/discoveryV3Pipeline.ts` (`runDiscoveryV3`, 4 stages)**
- Insert the new `runDiscoveryRuntimeEvidence(...)` call between Stage 2 (`FrameworkPack.adapt`) and Stage 3 (`runLlmGapFill`).
- Mirrors how `gapFill` already persists a sub-tree under `steps_payload.v3.gapFill` — copy that persistence pattern for `runtimeEvidence`.

**`discovery-service/src/services/logParsing/` (`parseLogContent`, `ParsedLogEntry`, format detector)**
- Reuse `parseLogContent` for JSONL/syslog/framework_pattern/plaintext formats.
- Extend `logFormatDetector.ts` to recognize Apache/Nginx CLF Common and Combined lines (new branch returning `clf_common` / `clf_combined`).
- New `accessLogParser.ts` handles those two formats and produces `ParsedLogEntry`-compatible rows enriched with first-class `method`, `path`, `status`, `timestamp`.

**`discovery-service/src/services/logExtractors/endpointUsageExtractor.ts`**
- Reference for path-extraction and basic numeric-ID normalization. The new `endpointPathNormalizer.ts` supersedes the inline normalization with the three-tier rule set; the existing extractor is left untouched (it serves the manual reprocess route).

**`discovery-service/src/services/archModelClient.ts`**
- Use existing `updateDiscoveryRun` (writes `steps_payload`) for the run-level summary.
- Use existing per-candidate update method (`PUT /candidates/{candidateId}`) for the additive `logEnrichment.runtime` write. If a thin wrapper does not yet exist on the client, add a minimal `updateCandidate` method that posts the candidate-id-scoped update — no new AMS endpoint involved.

**`discovery-service/src/types/candidate.ts` (`LogEnrichmentMetadata`, `DiscoveryCandidate.logEnrichment`)**
- Already wired end-to-end: TS interface (line 112), Java DTO `@JsonProperty("log_enrichment")` (`DiscoveryCandidateDto.java:89`), JSONB DB column. Extend the TS interface additively with the optional `runtime?: LogEnrichmentRuntimeBlock` sub-key. NO Java/DTO/schema change required because the JSONB column accepts arbitrary keys.

## Out of Scope
- Final UI rendering of runtime evidence in the Log Scans column (Spec 6).
- Confidence-score and tier-label changes; runtime badges (Spec 7).
- Static resource classification, health/metrics/operational endpoint classification.
- IP/user-agent/referrer analysis or storage.
- Service-dependency extraction, database-query extraction, business-logic execution extraction, UI screen/component log enrichment.
- Promoting unmatched route hints to normal endpoint candidates.
- Raw log viewing or download in the UI.
- Any change to AMS controllers, DTOs, or database schema (the JSONB columns already accept the new keys additively).
- Any new top-level pipeline step or change to `VALID_STEPS = ['1a', '1b', '1c-llm-analysis']`.
- Compressed log formats (`.gz`, `.zip`, `.tar`); Spec 4 only landed plaintext extensions.
- Frontend or gateway code changes of any kind.
