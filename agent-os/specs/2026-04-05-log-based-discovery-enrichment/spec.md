# Specification: Log-based Discovery Enrichment

## Goal
Enable the discovery pipeline to ingest application logs, extract log-derived evidence atoms (source="log"), merge them into an existing discovery run's evidence graph, update candidate confidence via simple additive adjustment, and support explicit user-triggered reprocessing of downstream phases (1b-1d) in sequence.

## User Stories
- As an architect, I want to feed application logs into the discovery system so that runtime signals (endpoint usage, service interactions, error traces) strengthen or refine the code-derived discovery results.
- As a discovery pipeline operator, I want to explicitly reprocess downstream phases after log enrichment so that relationships, clusters, and candidates reflect the combined code + log evidence.

## Specific Requirements

**Log format detection and parsing**
- Support three common log formats via auto-detection: JSON lines (one JSON object per line), syslog-style (`timestamp hostname process[pid]: message`), and common framework patterns (Log4j/Logback `%d [%t] %p %c - %m%n`)
- Implement a `LogFormatDetector` in `discovery-service/src/services/logParsing/logFormatDetector.ts` that samples the first N lines (e.g., 20) and returns the detected format or `unknown`
- Implement one parser per format in `discovery-service/src/services/logParsing/` (`jsonLinesParser.ts`, `syslogParser.ts`, `frameworkPatternParser.ts`) each producing a common `ParsedLogEntry` intermediate type
- `ParsedLogEntry` fields: `timestamp` (string, nullable), `level` (string, nullable), `logger` (string, nullable), `message` (string), `rawLine` (string), `lineNumber` (number), `metadata` (Record of any additional structured fields extracted from JSON lines)
- Parsing is rule-based and deterministic; no LLM involvement in log parsing
- If auto-detection fails or format is `unknown`, fall back to treating each line as a plain text message with no structured metadata

**Log evidence extraction rules**
- Create a `discovery-service/src/services/logExtractors/` directory following the `extractors/` sub-directory pattern, with a barrel `index.ts`
- Implement extraction rules as pure functions that receive `ParsedLogEntry[]` and the run context, and return `EvidenceAtom[]` with `source: "log"` in the atom data
- Five initial extractors: `endpointUsageExtractor` (URL/route patterns from log messages), `serviceInteractionExtractor` (HTTP calls, gRPC calls, service name references), `errorTraceExtractor` (stack traces, exception class names, error codes), `databaseQueryExtractor` (SQL patterns, connection strings, table name references), `userFlowHintExtractor` (sequential request patterns suggesting user journeys)
- Each extractor produces atoms using existing `EvidenceAtomType` values (`string_pattern` for most log evidence) with `source: "log"` and log-specific metadata in the `data` payload

**Extend EvidenceAtom model with source and log origin metadata**
- Add an optional `source` field to the `EvidenceAtom` interface in `discovery-service/src/types/evidenceAtom.ts`: `source?: 'code' | 'log'` (defaults to `'code'` for backward compatibility; existing atoms without the field are treated as code-sourced)
- Add an optional `logOrigin` field to `EvidenceAtom`: `logOrigin?: { filePath: string; lineStart: number; lineEnd: number; timestamp?: string; occurrenceCount?: number }`
- Add the corresponding nullable columns (`source TEXT`, `log_origin JSONB`) to the `discovery_evidence` table via a new Liquibase migration SQL file (next available number after the latest existing migration)
- Add the fields to `DiscoveryEvidenceEntity.java` and `DiscoveryEvidenceDto.java` as nullable/optional, maintaining backward compatibility
- All existing code-derived atoms continue to work unchanged (null source treated as `'code'`)

**Log ingestion endpoint in discovery-service**
- New route file `discovery-service/src/routes/logEnrichment.ts` mounted at `/discovery/log-enrichment` via the routes barrel
- `POST /` accepts `{ projectId: string, runId: string, logFilePath?: string, logContent?: string }` where either `logFilePath` (path readable by the service) or `logContent` (inline text up to a configurable max size) is provided
- Validate that the referenced discovery run exists and is in `COMPLETED` status (enrichment only applies to completed runs)
- Orchestration: detect format, parse entries, run all log extractors, persist new atoms via `archModelClient.bulkSaveEvidence` in BULK_SAVE_BATCH_SIZE batches
- Return a summary response: `{ atomsExtracted: number, atomsByType: Record<string, number>, formatDetected: string, linesProcessed: number }`
- Processing is synchronous (batch, not streaming); target moderate volumes (tens of MB)

**Gateway proxy route for log enrichment**
- Add a POST proxy route in `gateway/src/routes/discovery.ts` at `/projects/:projectId/runs/:runId/log-enrichment`
- Proxy to discovery-service `POST /discovery/log-enrichment` with the request body (projectId, runId, logFilePath or logContent)
- Follow the existing proxy pattern (503 on network error, transparent response forwarding)

**Explicit downstream reprocessing**
- New route `POST /discovery/reprocess` in `discovery-service/src/routes/logEnrichment.ts` accepting `{ projectId: string, runId: string }`
- Validate the run exists and is `COMPLETED`; reject if run is currently `RUNNING` or `PENDING`
- Reprocessing executes steps 1b, 1c, 1d in sequence by calling the existing `executeStep1b`, `executeStep1c`, `executeStep1d` functions from `runManager.ts`
- Before reprocessing, update the run status to `RUNNING` and set `current_step` to `1b`; after completion, set status back to `COMPLETED`; on failure, set status to `FAILED` with error_message
- The reprocessing uses delete-and-recreate semantics already built into `executeStep1c` and `executeStep1d`, so downstream artifacts are rebuilt from the combined code + log atom set
- Return a summary combining the metadata from all three re-run steps
- Fire-and-forget async pattern (same as `startRun`): return 202 Accepted immediately, process in background

**Gateway proxy route for reprocessing**
- Add a POST proxy route in `gateway/src/routes/discovery.ts` at `/projects/:projectId/runs/:runId/reprocess`
- Proxy to discovery-service `POST /discovery/reprocess`
- Follow the existing proxy pattern

**Simple additive confidence adjustment**
- Define `LOG_CORROBORATION_CONFIDENCE_BOOST` constant in a new `discovery-service/src/constants/logEnrichmentDefaults.ts` (default value 0.10)
- Define `LOG_MAX_CONFIDENCE_CAP` (default 0.98) to prevent confidence from exceeding a ceiling
- During reprocessing, the existing 1b/1c/1d logic naturally incorporates log atoms alongside code atoms because the log atoms are stored in the same `discovery_evidence` table
- Additionally, when the linker rules and clustering rules encounter atoms with `source: "log"` that corroborate existing code-based patterns, confidence is boosted by `LOG_CORROBORATION_CONFIDENCE_BOOST`, capped at `LOG_MAX_CONFIDENCE_CAP`
- The confidence adjustment is applied within the existing triage engines (`triageEngine.ts`, `clusterTriageEngine.ts`, `candidateTriageEngine.ts`) as a post-triage pass: for each candidate/cluster/relationship where at least one contributing atom has `source: "log"`, add the boost

**Log enrichment metadata on candidates**
- Extend `DiscoveryCandidate` interface with an optional `logEnrichment` field: `logEnrichment?: { enriched: boolean; logAtomCount: number; signalSummary: string }`
- The `signalSummary` is a human-readable string summarizing log contributions (e.g., "3 endpoint hits observed, 5 error traces matched")
- During `executeStep1d` reprocessing, compute `logEnrichment` for each candidate by counting `source: "log"` atoms in the candidate's source clusters and generating the summary string
- Add the corresponding nullable JSONB column (`log_enrichment`) to the `discovery_candidate` table via the same or a companion Liquibase migration
- Add the field to `DiscoveryCandidateEntity.java`, `DiscoveryCandidateDto.java`, and the TypeScript `DiscoveryCandidate` interface
- No dedicated filtering UX; the metadata is visible in existing candidate detail/listing views

**Log enrichment defaults and size limits**
- Define `LOG_MAX_CONTENT_SIZE_BYTES` (default 50MB) and `LOG_MAX_LINE_COUNT` (default 500000) in `logEnrichmentDefaults.ts`
- The ingestion endpoint rejects requests exceeding these limits with a 413 status code
- Define `LOG_SAMPLE_LINES_FOR_DETECTION` (default 20) for format auto-detection

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**Phase 1a extractors (`discovery-service/src/services/extractors/`)**
- `fileStructureExtractor.ts`, `symbolExtractor.ts`, `stringPatternExtractor.ts` are self-contained, testable extraction units that are the structural template for log extractor files
- Each receives input data and returns `EvidenceAtom[]` with deterministic IDs; log extractors should follow the same single-responsibility pattern
- File organization under a sub-directory with barrel export (`extractors/index.ts`) is the pattern for `logExtractors/`

**EvidenceAtom type and persistence stack**
- `discovery-service/src/types/evidenceAtom.ts` defines the atom model; extend it with `source` and `logOrigin` optional fields
- `archModelClient.bulkSaveEvidence` persists atoms in batches; reuse for log-derived atoms without changes
- `DiscoveryEvidenceEntity.java` and Liquibase migration `066-discovery-evidence.sql` provide the persistence template for new nullable columns

**Run manager step functions (`discovery-service/src/services/runManager.ts`)**
- `executeStep1b`, `executeStep1c`, `executeStep1d` are the functions invoked during reprocessing; they already implement full pipeline logic including fetch-upstream, process, triage, persist
- `startRun()` loop (lines 1953-2002) demonstrates the step-by-step sequencing pattern with status updates; reprocessing follows the same pattern but starts at step 1b
- `BULK_SAVE_BATCH_SIZE` constant and batched persistence pattern should be reused for log atom ingestion

**Discovery routes barrel (`discovery-service/src/routes/index.ts`)**
- Mounts sub-routers at `/discovery/phase0`, `/discovery/phase1`, `/discovery/runs`; add `/discovery/log-enrichment` and `/discovery/reprocess` following the same pattern

**Gateway discovery proxy routes (`gateway/src/routes/discovery.ts`)**
- Contains all existing proxy routes following a consistent pattern: extract params, build URL, forward with error handling (503 for network, 500 for unexpected errors)
- New log enrichment and reprocessing proxy routes replicate this exact pattern

## Out of Scope
- Real-time or streaming log ingestion (batch only)
- Complex log parsing frameworks or user-provided parser configurations
- Advanced correlation across distributed systems (e.g., distributed tracing assembly)
- Advanced log analytics, anomaly detection, or statistical analysis
- Automatic deletion or overwriting of candidates/entities based on log evidence
- Any automatic destructive changes to candidates or saved canonical entities
- Frontend log visualization, dedicated log filtering UX, or log upload UI
- AST enrichment or language/version-specific analyzer packs
- Complex probabilistic confidence scoring models
- Fine-grained selective phase re-runs (e.g., just 1c without 1b)
- Heavy LLM use for log parsing or log-based reasoning
