# Task Breakdown: Log-based Discovery Enrichment (Increment 14)

## Overview
Total Tasks: 51 (across 7 task groups)

This increment adds log-based enrichment to the discovery pipeline: log format detection/parsing, log evidence extractors, EvidenceAtom model extension, log ingestion and reprocessing endpoints, gateway proxies, confidence adjustment, and log enrichment metadata on candidates.

## Task List

### Data Model Layer (Java / Liquibase)

#### Task Group 1: EvidenceAtom and Candidate Schema Extensions
**Dependencies:** None

- [x] 1.0 Complete database schema extensions for log enrichment
  - [x] 1.1 Write 4 focused tests for the schema extensions
    - Test DiscoveryEvidenceEntity with source and logOrigin fields set (round-trip)
    - Test DiscoveryEvidenceEntity backward compatibility (source and logOrigin null)
    - Test DiscoveryCandidateEntity with logEnrichment JSONB field set (round-trip)
    - Test DiscoveryCandidateEntity backward compatibility (logEnrichment null)
  - [x] 1.2 Create Liquibase migration `075-evidence-log-enrichment-fields.sql`
    - `ALTER TABLE discovery_evidence ADD COLUMN IF NOT EXISTS source TEXT;`
    - `ALTER TABLE discovery_evidence ADD COLUMN IF NOT EXISTS log_origin JSONB;`
    - `ALTER TABLE discovery_candidate ADD COLUMN IF NOT EXISTS log_enrichment JSONB;`
    - Add composite index `idx_discovery_evidence_run_id_source ON discovery_evidence (run_id, source)` for querying log-sourced atoms
    - Add COMMENT ON COLUMN for all three new columns
    - Follow pattern from `074-candidate-review-fields.sql`
  - [x] 1.3 Register migration in `db.changelog-master.yaml`
    - Add changeSet `075-evidence-log-enrichment-fields` with precondition checking `columnExists` for `source` on `discovery_evidence`
    - Follow existing changeSet pattern
  - [x] 1.4 Extend `DiscoveryEvidenceEntity.java`
    - Add nullable `source` field: `@Column(name = "source") private String source;`
    - Add nullable `logOrigin` field: `@Type(JsonType.class) @Column(name = "log_origin", columnDefinition = "jsonb") private Map<String, Object> logOrigin;`
    - Both fields nullable for backward compatibility
  - [x] 1.5 Extend `DiscoveryEvidenceDto.java`
    - Add `@JsonProperty("source") String source` parameter (nullable)
    - Add `@JsonProperty("log_origin") Map<String, Object> logOrigin` parameter (nullable)
  - [x] 1.6 Extend `DiscoveryCandidateEntity.java`
    - Add nullable `logEnrichment` field: `@Type(JsonType.class) @Column(name = "log_enrichment", columnDefinition = "jsonb") private Map<String, Object> logEnrichment;`
  - [x] 1.7 Extend `DiscoveryCandidateDto.java`
    - Add `@JsonProperty("log_enrichment") Map<String, Object> logEnrichment` parameter (nullable)
  - [x] 1.8 Ensure schema extension tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify migration SQL is syntactically valid
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- Migration SQL creates all three new columns as nullable
- DiscoveryEvidenceEntity/Dto have `source` and `logOrigin` fields
- DiscoveryCandidateEntity/Dto have `logEnrichment` field
- All existing code-derived atoms continue to work unchanged (null source treated as 'code')

---

### Discovery Service: Log Parsing Layer

#### Task Group 2: Log Format Detection and Parsers
**Dependencies:** None (independent TypeScript module, no DB dependency)

- [x] 2.0 Complete log format detection and parsing
  - [x] 2.1 Write 8 focused tests for log parsing
    - Test `LogFormatDetector` correctly identifies JSON lines format
    - Test `LogFormatDetector` correctly identifies syslog format
    - Test `LogFormatDetector` correctly identifies framework pattern (Log4j/Logback) format
    - Test `LogFormatDetector` returns `unknown` for unrecognized content
    - Test `jsonLinesParser` extracts structured fields from JSON log lines
    - Test `syslogParser` extracts timestamp, hostname, process, and message
    - Test `frameworkPatternParser` extracts date, thread, level, logger, and message
    - Test fallback parser treats each line as plain text message when format is `unknown`
  - [x] 2.2 Define `ParsedLogEntry` interface in `discovery-service/src/types/logParsing.ts`
    - Fields: `timestamp` (string | null), `level` (string | null), `logger` (string | null), `message` (string), `rawLine` (string), `lineNumber` (number), `metadata` (Record<string, unknown>)
    - Export from `discovery-service/src/types/index.ts` barrel
  - [x] 2.3 Create `discovery-service/src/services/logParsing/logFormatDetector.ts`
    - Export `detectLogFormat(lines: string[]): 'json_lines' | 'syslog' | 'framework_pattern' | 'unknown'`
    - Sample first `LOG_SAMPLE_LINES_FOR_DETECTION` lines (default 20)
    - JSON lines: check if majority of sampled lines parse as valid JSON objects
    - Syslog: regex match for `timestamp hostname process[pid]: message` pattern
    - Framework pattern: regex match for `%d [%t] %p %c - %m` style patterns (Log4j/Logback)
    - Return `unknown` if no format matches
  - [x] 2.4 Create `discovery-service/src/services/logParsing/jsonLinesParser.ts`
    - Export `parseJsonLines(lines: string[]): ParsedLogEntry[]`
    - Parse each line as JSON, extract standard fields (timestamp, level, logger/loggerName, message/msg)
    - Place remaining JSON fields into `metadata`
    - Skip unparseable lines with warning
  - [x] 2.5 Create `discovery-service/src/services/logParsing/syslogParser.ts`
    - Export `parseSyslog(lines: string[]): ParsedLogEntry[]`
    - Regex: capture timestamp, hostname, process name, PID, and message
    - Map process name to `logger`, no `level` unless present in message
  - [x] 2.6 Create `discovery-service/src/services/logParsing/frameworkPatternParser.ts`
    - Export `parseFrameworkPattern(lines: string[]): ParsedLogEntry[]`
    - Handle common Log4j/Logback patterns: `2024-01-15 10:30:45.123 [main] INFO com.example.App - Starting up`
    - Extract date, thread, level, logger class, message
    - Handle multiline stack traces by appending to previous entry's message
  - [x] 2.7 Create `discovery-service/src/services/logParsing/plaintextParser.ts`
    - Export `parsePlaintext(lines: string[]): ParsedLogEntry[]`
    - Fallback: each line becomes a `ParsedLogEntry` with only `message`, `rawLine`, and `lineNumber` populated
  - [x] 2.8 Create barrel `discovery-service/src/services/logParsing/index.ts`
    - Export `detectLogFormat`, all four parsers, and a convenience `parseLogContent(content: string): { format: string; entries: ParsedLogEntry[] }` that auto-detects and delegates
  - [x] 2.9 Ensure log parsing tests pass
    - Run ONLY the 8 tests written in 2.1
    - Verify all format detection and parsing paths work
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 8 tests written in 2.1 pass
- Auto-detection correctly distinguishes JSON lines, syslog, framework patterns, and unknown
- Each parser produces valid `ParsedLogEntry[]` with correct field mapping
- Unknown format falls back to plaintext parser gracefully
- Parsing is purely rule-based with no LLM involvement

---

### Discovery Service: Log Evidence Extractors

#### Task Group 3: Log Evidence Extraction Rules
**Dependencies:** Task Group 1 (EvidenceAtom type extension), Task Group 2 (ParsedLogEntry type)

- [x] 3.0 Complete log evidence extractors
  - [x] 3.1 Write 6 focused tests for log evidence extractors
    - Test `endpointUsageExtractor` finds URL/route patterns in log messages and returns `string_pattern` atoms with `source: "log"`
    - Test `serviceInteractionExtractor` detects HTTP/gRPC calls and service name references
    - Test `errorTraceExtractor` identifies stack traces, exception classes, and error codes
    - Test `databaseQueryExtractor` finds SQL patterns and table name references
    - Test `userFlowHintExtractor` detects sequential request patterns suggesting user journeys
    - Test all extractors produce atoms with correct `logOrigin` metadata (filePath, lineStart, lineEnd, occurrenceCount)
  - [x] 3.2 Create `discovery-service/src/constants/logEnrichmentDefaults.ts`
    - `LOG_CORROBORATION_CONFIDENCE_BOOST = 0.10`
    - `LOG_MAX_CONFIDENCE_CAP = 0.98`
    - `LOG_MAX_CONTENT_SIZE_BYTES = 50 * 1024 * 1024` (50 MB)
    - `LOG_MAX_LINE_COUNT = 500_000`
    - `LOG_SAMPLE_LINES_FOR_DETECTION = 20`
  - [x] 3.3 Extend `EvidenceAtom` interface in `discovery-service/src/types/evidenceAtom.ts`
    - Add optional `source?: 'code' | 'log'`
    - Add optional `logOrigin?: { filePath: string; lineStart: number; lineEnd: number; timestamp?: string; occurrenceCount?: number }`
    - Existing atoms without the field are treated as code-sourced (backward compatible)
  - [x] 3.4 Create `discovery-service/src/services/logExtractors/endpointUsageExtractor.ts`
    - Export `extractEndpointUsage(entries: ParsedLogEntry[], runId: string, repoUrl: string, logFilePath: string): EvidenceAtom[]`
    - Regex patterns for URL paths (`/api/...`, `/v1/...`), HTTP methods (`GET /path`, `POST /path`), route patterns
    - Produce `string_pattern` atoms with `source: "log"` and `data.patternName: "endpoint_usage_log"`
    - Set `logOrigin` with filePath, lineStart, lineEnd, occurrenceCount (aggregate same endpoints)
    - Use `generateEvidenceId` for deterministic IDs following existing extractor pattern
  - [x] 3.5 Create `discovery-service/src/services/logExtractors/serviceInteractionExtractor.ts`
    - Export `extractServiceInteractions(entries: ParsedLogEntry[], runId: string, repoUrl: string, logFilePath: string): EvidenceAtom[]`
    - Detect HTTP calls (`http://`, `https://`, host:port patterns), gRPC references, service name mentions
    - Produce `string_pattern` atoms with `source: "log"` and `data.patternName: "service_interaction_log"`
  - [x] 3.6 Create `discovery-service/src/services/logExtractors/errorTraceExtractor.ts`
    - Export `extractErrorTraces(entries: ParsedLogEntry[], runId: string, repoUrl: string, logFilePath: string): EvidenceAtom[]`
    - Detect stack traces (lines starting with `at `, `Caused by:`), exception class names (e.g., `NullPointerException`), error codes
    - Produce `string_pattern` atoms with `source: "log"` and `data.patternName: "error_trace_log"`
  - [x] 3.7 Create `discovery-service/src/services/logExtractors/databaseQueryExtractor.ts`
    - Export `extractDatabaseQueries(entries: ParsedLogEntry[], runId: string, repoUrl: string, logFilePath: string): EvidenceAtom[]`
    - Detect SQL keywords (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `FROM`), connection strings (`jdbc:`, `postgres://`), table name patterns
    - Produce `string_pattern` atoms with `source: "log"` and `data.patternName: "database_query_log"`
  - [x] 3.8 Create `discovery-service/src/services/logExtractors/userFlowHintExtractor.ts`
    - Export `extractUserFlowHints(entries: ParsedLogEntry[], runId: string, repoUrl: string, logFilePath: string): EvidenceAtom[]`
    - Detect sequential request patterns (e.g., same session/request ID across multiple entries), login/auth/checkout flows
    - Produce `string_pattern` atoms with `source: "log"` and `data.patternName: "user_flow_hint_log"`
  - [x] 3.9 Create barrel `discovery-service/src/services/logExtractors/index.ts`
    - Export all five extractors
    - Export `runAllLogExtractors(entries: ParsedLogEntry[], runId: string, repoUrl: string, logFilePath: string): EvidenceAtom[]` convenience function that calls all five and concatenates results
  - [x] 3.10 Ensure log extractor tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify extractors produce atoms with correct `source: "log"` and `logOrigin` metadata
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 3.1 pass
- All five extractors produce `EvidenceAtom[]` with `source: "log"` and valid `logOrigin`
- Extractors follow the same single-responsibility pattern as existing code extractors
- `EvidenceAtom` interface extended with backward-compatible optional fields
- Constants file defines all configurable defaults

---

### Discovery Service: Endpoints and Orchestration

#### Task Group 4: Log Ingestion Endpoint and Reprocessing
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete log ingestion and reprocessing endpoints
  - [x] 4.1 Write 8 focused tests for ingestion and reprocessing routes
    - Test POST `/discovery/log-enrichment` succeeds with valid `logContent`, returns summary with atomsExtracted, formatDetected, linesProcessed
    - Test POST `/discovery/log-enrichment` rejects when run is not in COMPLETED status (400)
    - Test POST `/discovery/log-enrichment` rejects when neither logFilePath nor logContent is provided (400)
    - Test POST `/discovery/log-enrichment` rejects content exceeding `LOG_MAX_CONTENT_SIZE_BYTES` (413)
    - Test POST `/discovery/log-enrichment` rejects content exceeding `LOG_MAX_LINE_COUNT` (413)
    - Test POST `/discovery/reprocess` returns 202 Accepted immediately
    - Test POST `/discovery/reprocess` rejects when run status is RUNNING (409)
    - Test POST `/discovery/reprocess` rejects when run does not exist (404)
  - [x] 4.2 Create route file `discovery-service/src/routes/logEnrichment.ts`
    - Mount at `/discovery/log-enrichment` via the routes barrel
    - `POST /` handler for log ingestion
    - `POST /reprocess` handler for downstream reprocessing (at `/discovery/reprocess` after barrel mount -- see 4.5)
  - [x] 4.3 Implement log ingestion handler (`POST /discovery/log-enrichment`)
    - Accept `{ projectId: string, runId: string, logFilePath?: string, logContent?: string }`
    - Validate: require at least one of logFilePath or logContent
    - Validate: check content size against `LOG_MAX_CONTENT_SIZE_BYTES` and line count against `LOG_MAX_LINE_COUNT`
    - Validate: fetch the run via `archModelClient`, verify status is COMPLETED; return 400 if not
    - Orchestration: read content (from logFilePath via fs.readFile or from logContent), call `parseLogContent`, call `runAllLogExtractors`, persist atoms via `archModelClient.bulkSaveEvidence` in `BULK_SAVE_BATCH_SIZE` batches
    - Return 413 for size/line limit violations
    - Return summary: `{ atomsExtracted, atomsByType, formatDetected, linesProcessed }`
  - [x] 4.4 Implement reprocessing handler (`POST /discovery/reprocess`)
    - Accept `{ projectId: string, runId: string }`
    - Validate: fetch run, verify status is COMPLETED; return 409 if RUNNING, 404 if not found, 400 otherwise
    - Fire-and-forget pattern (matching `startRun`): return 202 immediately, run background processing
    - Background: set run status to RUNNING with `current_step: '1b'`
    - Execute `executeStep1b`, `executeStep1c`, `executeStep1d` in sequence
    - On success: set status to COMPLETED with `current_step: null`
    - On failure: set status to FAILED with `error_message`
    - Return `{ status: 'accepted', message: 'Reprocessing started' }`
  - [x] 4.5 Register route in `discovery-service/src/routes/index.ts`
    - Import `logEnrichmentRouter` from `./logEnrichment`
    - Mount: `discoveryRouter.use('/log-enrichment', logEnrichmentRouter)`
    - Add a separate mount for reprocess: `discoveryRouter.use('/reprocess', reprocessRouter)` (or mount the reprocess handler as a sibling route in the same file)
  - [x] 4.6 Ensure ingestion and reprocessing tests pass
    - Run ONLY the 8 tests written in 4.1
    - Verify ingestion orchestration produces correct summary
    - Verify reprocessing returns 202 and triggers background processing
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 8 tests written in 4.1 pass
- Ingestion endpoint validates inputs, detects format, extracts atoms, persists them, and returns summary
- Reprocessing endpoint validates run status, returns 202, and executes steps 1b/1c/1d in background
- Size limits enforced with 413 responses
- Run status transitions follow the same pattern as `startRun`

---

### Discovery Service: Confidence Adjustment

#### Task Group 5: Log Corroboration Confidence Boost
**Dependencies:** Task Groups 1, 3

- [x] 5.0 Complete confidence adjustment for log-corroborated evidence
  - [x] 5.1 Write 4 focused tests for confidence adjustment
    - Test that a relationship with at least one `source: "log"` contributing atom gets confidence boosted by `LOG_CORROBORATION_CONFIDENCE_BOOST`
    - Test that confidence is capped at `LOG_MAX_CONFIDENCE_CAP` (does not exceed 0.98)
    - Test that a candidate with no log-sourced atoms is unchanged
    - Test that `logEnrichment` metadata is computed correctly for candidates with log atoms (enriched: true, logAtomCount, signalSummary)
  - [x] 5.2 Add log corroboration post-triage pass to `triageEngine.ts`
    - After standard triage partitioning, iterate over accepted and ambiguous buckets
    - For each relationship where at least one contributing atom has `source: "log"`, add `LOG_CORROBORATION_CONFIDENCE_BOOST` to confidence, capped at `LOG_MAX_CONFIDENCE_CAP`
    - Import constants from `logEnrichmentDefaults.ts`
    - This is additive -- existing triage logic remains untouched
  - [x] 5.3 Add log corroboration post-triage pass to `clusterTriageEngine.ts`
    - Same pattern as 5.2: boost confidence for clusters where contributing atoms include `source: "log"` atoms
    - Cap at `LOG_MAX_CONFIDENCE_CAP`
  - [x] 5.4 Add log corroboration post-triage pass to `candidateTriageEngine.ts`
    - Same pattern: boost confidence for candidates where source clusters contain `source: "log"` atoms
    - Cap at `LOG_MAX_CONFIDENCE_CAP`
  - [x] 5.5 Implement `logEnrichment` metadata computation in candidate generation (step 1d)
    - During `executeStep1d` (or in the candidate generation engine), after candidates are produced:
    - For each candidate, count atoms with `source: "log"` in its source clusters
    - If logAtomCount > 0, set `logEnrichment: { enriched: true, logAtomCount, signalSummary }`
    - `signalSummary` is a human-readable string aggregating extractor pattern names (e.g., "3 endpoint hits observed, 5 error traces matched")
    - If logAtomCount === 0, set `logEnrichment: { enriched: false, logAtomCount: 0, signalSummary: '' }`
  - [x] 5.6 Extend `DiscoveryCandidate` TypeScript interface in `discovery-service/src/types/candidate.ts`
    - Add optional `logEnrichment?: { enriched: boolean; logAtomCount: number; signalSummary: string }`
  - [x] 5.7 Ensure confidence adjustment tests pass
    - Run ONLY the 4 tests written in 5.1
    - Verify boost is applied correctly and capped
    - Verify logEnrichment metadata is computed
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 5.1 pass
- Confidence boost applied additively for log-corroborated items
- Confidence never exceeds `LOG_MAX_CONFIDENCE_CAP` (0.98)
- Items without log atoms are unaffected
- Candidates carry `logEnrichment` metadata when log atoms are present

---

### Gateway Layer

#### Task Group 6: Gateway Proxy Routes
**Dependencies:** Task Group 4 (discovery-service endpoints must be defined)

- [x] 6.0 Complete gateway proxy routes for log enrichment
  - [x] 6.1 Write 4 focused tests for gateway proxy routes
    - Test POST `/discovery/projects/:projectId/runs/:runId/log-enrichment` proxies to discovery-service and forwards response
    - Test POST `/discovery/projects/:projectId/runs/:runId/log-enrichment` returns 503 on network error
    - Test POST `/discovery/projects/:projectId/runs/:runId/reprocess` proxies to discovery-service and forwards 202
    - Test POST `/discovery/projects/:projectId/runs/:runId/reprocess` returns 503 on network error
  - [x] 6.2 Add log enrichment proxy route in `gateway/src/routes/discovery.ts`
    - `POST /projects/:projectId/runs/:runId/log-enrichment`
    - Extract projectId and runId from params, forward body to `{discoveryServiceBaseUrl}/discovery/log-enrichment`
    - Include projectId and runId in the proxied request body
    - Follow the exact same pattern as existing `POST /runs` proxy (503 on network error, transparent response forwarding)
    - Add section comment header: `// Spec 2026-04-05: Log-based Discovery Enrichment (Increment 14)`
  - [x] 6.3 Add reprocessing proxy route in `gateway/src/routes/discovery.ts`
    - `POST /projects/:projectId/runs/:runId/reprocess`
    - Extract projectId and runId from params, forward to `{discoveryServiceBaseUrl}/discovery/reprocess`
    - Include projectId and runId in the proxied request body
    - Follow the same proxy pattern
  - [x] 6.4 Ensure gateway proxy tests pass
    - Run ONLY the 4 tests written in 6.1
    - Verify transparent forwarding works
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 6.1 pass
- Both proxy routes forward to discovery-service correctly
- 503 returned on network error, matching existing pattern
- Response bodies and status codes forwarded transparently

---

### Test Review and Gap Analysis

#### Task Group 7: Test Review and Critical Gap Fill
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 4 tests from Task Group 1 (schema extensions)
    - Review the 8 tests from Task Group 2 (log parsing)
    - Review the 6 tests from Task Group 3 (log extractors)
    - Review the 8 tests from Task Group 4 (ingestion/reprocessing endpoints)
    - Review the 4 tests from Task Group 5 (confidence adjustment)
    - Review the 4 tests from Task Group 6 (gateway proxies)
    - Total existing tests: 34 tests
  - [x] 7.2 Analyze test coverage gaps for log-based discovery enrichment
    - Identify critical end-to-end workflows that lack coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize integration points over unit test gaps
  - [x] 7.3 Write up to 10 additional strategic tests maximum
    - Potential gap areas to consider:
      - End-to-end ingestion flow: content in, atoms persisted with correct source/logOrigin
      - Reprocessing flow: run status transitions COMPLETED -> RUNNING -> COMPLETED
      - Reprocessing failure: run status transitions COMPLETED -> RUNNING -> FAILED
      - Mixed atom query: existing code atoms + new log atoms coexist for same run
      - ParseLogContent convenience function: format detection + parsing in one call
      - Edge case: empty log content (0 lines) handled gracefully
      - Edge case: log content at exactly the size limit boundary
      - Confidence boost does not apply when no log atoms exist (regression guard)
      - logEnrichment signalSummary aggregation from multiple extractor types
      - Gateway proxy body construction includes projectId and runId from URL params
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases that are unlikely to cause production issues
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, and 7.3)
    - Expected total: approximately 34-44 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 34-44 tests total)
- Critical end-to-end workflows for log-based enrichment are covered
- No more than 10 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Schema Extensions** (Java/Liquibase) -- No dependencies. Creates the database foundation.
2. **Task Group 2: Log Format Detection and Parsers** (TypeScript) -- No dependencies. Can run in parallel with Task Group 1.
3. **Task Group 3: Log Evidence Extractors** (TypeScript) -- Depends on Task Groups 1 and 2. Extends the EvidenceAtom type and uses ParsedLogEntry.
4. **Task Group 5: Confidence Adjustment** (TypeScript) -- Depends on Task Groups 1 and 3. Modifies triage engines and candidate generation.
5. **Task Group 4: Log Ingestion Endpoint and Reprocessing** (TypeScript) -- Depends on Task Groups 1-3. Orchestrates the full ingestion pipeline.
6. **Task Group 6: Gateway Proxy Routes** (TypeScript) -- Depends on Task Group 4. Lightweight proxies.
7. **Task Group 7: Test Review and Gap Analysis** -- Depends on all above groups.

**Parallelization opportunities:**
- Task Groups 1 and 2 can be developed in parallel (no shared dependencies).
- Task Group 5 can begin once Task Groups 1 and 3 are complete, in parallel with Task Group 4.

## Key File Inventory

### New Files
| File | Task |
|------|------|
| `architecture-model-service/src/main/resources/db/changelog/sql/075-evidence-log-enrichment-fields.sql` | 1.2 |
| `discovery-service/src/types/logParsing.ts` | 2.2 |
| `discovery-service/src/services/logParsing/logFormatDetector.ts` | 2.3 |
| `discovery-service/src/services/logParsing/jsonLinesParser.ts` | 2.4 |
| `discovery-service/src/services/logParsing/syslogParser.ts` | 2.5 |
| `discovery-service/src/services/logParsing/frameworkPatternParser.ts` | 2.6 |
| `discovery-service/src/services/logParsing/plaintextParser.ts` | 2.7 |
| `discovery-service/src/services/logParsing/index.ts` | 2.8 |
| `discovery-service/src/constants/logEnrichmentDefaults.ts` | 3.2 |
| `discovery-service/src/services/logExtractors/endpointUsageExtractor.ts` | 3.4 |
| `discovery-service/src/services/logExtractors/serviceInteractionExtractor.ts` | 3.5 |
| `discovery-service/src/services/logExtractors/errorTraceExtractor.ts` | 3.6 |
| `discovery-service/src/services/logExtractors/databaseQueryExtractor.ts` | 3.7 |
| `discovery-service/src/services/logExtractors/userFlowHintExtractor.ts` | 3.8 |
| `discovery-service/src/services/logExtractors/index.ts` | 3.9 |
| `discovery-service/src/routes/logEnrichment.ts` | 4.2 |
| `discovery-service/src/services/logEnrichmentMetadata.ts` | 5.5 |
| `discovery-service/src/__tests__/logEnrichmentGapFill.test.ts` | 7.3 |

### Modified Files
| File | Task |
|------|------|
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | 1.3 |
| `architecture-model-service/.../model/entity/DiscoveryEvidenceEntity.java` | 1.4 |
| `architecture-model-service/.../model/dto/DiscoveryEvidenceDto.java` | 1.5 |
| `architecture-model-service/.../model/entity/DiscoveryCandidateEntity.java` | 1.6 |
| `architecture-model-service/.../model/dto/DiscoveryCandidateDto.java` | 1.7 |
| `discovery-service/src/types/evidenceAtom.ts` | 3.3 |
| `discovery-service/src/types/candidate.ts` | 5.6 |
| `discovery-service/src/types/index.ts` | 2.2, 5.6 |
| `discovery-service/src/services/triageEngine.ts` | 5.2 |
| `discovery-service/src/services/clusterTriageEngine.ts` | 5.3 |
| `discovery-service/src/services/candidateTriageEngine.ts` | 5.4 |
| `discovery-service/src/routes/index.ts` | 4.5 |
| `gateway/src/routes/discovery.ts` | 6.2, 6.3 |
