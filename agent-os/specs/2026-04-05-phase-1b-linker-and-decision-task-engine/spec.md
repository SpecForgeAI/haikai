# Specification: Phase 1b Linker and DecisionTask Engine

## Goal
Replace the Phase 1b backbone stub with real evidence relationship linking -- deterministic linker rules that pattern-match 1a atoms into candidate relationships, a confidence-based triage engine, and a DecisionTask engine that routes ambiguous candidates through the gateway's LLM for resolution.

## User Stories
- As a discovery pipeline operator, I want Phase 1b to automatically infer relationships between 1a evidence atoms so that the downstream 1c/1d steps receive meaningful structural data instead of empty backbones.
- As a discovery pipeline operator, I want ambiguous relationship candidates to be resolved by LLM so that the pipeline produces higher-quality relationships without manual intervention.

## Specific Requirements

**LinkerRule Interface and Registry**
- Define a `LinkerRule` interface in `discovery-service/src/types/` with fields: `id` (string), `name` (string), `description` (string), `targetRelationshipType` (RelationshipType), and a `match(atoms: EvidenceAtom[]): CandidateRelationship[]` method
- Define a `CandidateRelationship` interface with: `sourceAtomId`, `targetAtomId`, `relationshipType`, `confidence` (0.0-1.0), `data` (RelationshipData), and `ruleId` (traceability back to the producing rule)
- `CandidateRelationship` is internal to discovery-service -- never persisted directly; it is converted to either an `EvidenceRelationship` (accepted) or a `DecisionTask` (ambiguous)
- Create a linker rule registry in `discovery-service/src/services/linkerRuleRegistry.ts` following the `analyzerRegistry.ts` pattern: in-memory Map, `initializeLinkerRuleRegistry()`, `getLinkerRuleRegistry()`, `registerLinkerRule()`
- Include a `linkerRules/index.ts` barrel export and a `registerAllLinkerRules()` function called from `initializeLinkerRuleRegistry()`

**Four Initial Deterministic Linker Rules**
- Each rule lives in its own file under `discovery-service/src/services/linkerRules/` (mirroring the `extractors/` sub-directory pattern)
- **ContainsByPathRule**: matches `file_structure` atoms where one `relativePath` is a directory-prefix of another; produces `contains` relationships at 1.0 confidence
- **ImportsByPatternRule**: matches `string_pattern` atoms with import-related `patternName` (e.g., `import_statement`, `require_statement`) to `symbol` atoms where `matchedText` contains the symbol's `name`; confidence 0.9+ for exact name match, 0.5-0.7 for partial/ambiguous match
- **ExtendsByPatternRule**: matches `string_pattern` atoms with inheritance `patternName` to `symbol` atoms with matching `name` and appropriate `kind` (class, interface); confidence varies similarly to imports
- **ReferencesBySymbolRule**: catch-all rule matching `string_pattern` atoms referencing `symbol` names not captured by more specific rules; produces `references` relationships at 0.3-0.6 confidence (likely to generate DecisionTasks or be discarded)

**Confidence Threshold Configuration**
- Define `AUTO_ACCEPT_THRESHOLD` (default 0.8) and `AMBIGUOUS_THRESHOLD` (default 0.4) as named constants in `discovery-service/src/constants/linkerDefaults.ts`, following the `extractionDefaults.ts` pattern
- Candidates at or above `AUTO_ACCEPT_THRESHOLD` are auto-accepted; between the two thresholds generate DecisionTasks; below `AMBIGUOUS_THRESHOLD` are auto-discarded
- These are centralized constants, not user-facing configuration in this increment

**Candidate Triage Engine**
- Implement a standalone, testable triage function that takes `CandidateRelationship[]` and partitions into three buckets: `accepted`, `ambiguous`, `discarded`
- Detect competing relationships: when multiple ambiguous candidates share the same `sourceAtomId` and same `relationshipType`, group them into a single `resolve_competing_relationships` DecisionTask rather than individual `confirm_relationship` tasks
- Non-competing ambiguous candidates each become a `confirm_relationship` DecisionTask
- Return the three buckets plus the grouped competing-relationship sets

**DecisionTask TypeScript Types**
- Define all DecisionTask types in `discovery-service/src/types/decisionTask.ts`: `DecisionTaskType` ('confirm_relationship' | 'resolve_competing_relationships'), `DecisionTaskStatus` ('pending' | 'resolved' | 'failed'), input/output interfaces for each task type, and the top-level `DecisionTask` interface
- `ConfirmRelationshipInput` includes full source/target atom data (not just IDs), proposed relationship type, confidence, and ruleId -- enough context for LLM resolution without additional DB queries
- `ResolveCompetingInput` includes source atom data plus an array of competing target candidates each with their atom data, relationship type, confidence, and ruleId
- Export all new types via the barrel export in `discovery-service/src/types/index.ts`

**DecisionTask Persistence (architecture-model-service)**
- New `discovery_decision_task` table via Liquibase migration `071-discovery-decision-task.sql` (next after 070-discovery-candidate)
- Columns: `id` (UUID PK), `run_id` (UUID FK to discovery_run ON DELETE CASCADE), `task_type` (TEXT NOT NULL), `status` (TEXT NOT NULL DEFAULT 'pending'), `input_data` (JSONB NOT NULL), `output_data` (JSONB nullable), `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW()), `resolved_at` (TIMESTAMPTZ nullable)
- Indexes: `run_id`, composite `(run_id, status)`, composite `(run_id, task_type)` -- following the discovery_relationship migration pattern
- Full JPA stack: `DiscoveryDecisionTaskEntity` (with `@Type(JsonType.class)` for JSONB, `@PrePersist`, Lombok), DTO record, Repository with `findByRunId`/`findByRunIdAndStatus`/`findByRunIdAndTaskType`/`countByRunId`/`countByRunIdAndStatus`, Service with `@Transactional` annotations, Controller under `/api/model/projects/{projectId}/discovery/runs/{runId}/decision-tasks`

**DecisionTask Controller Endpoints**
- POST (bulk insert array of tasks)
- GET (list with optional `?status=` and `?taskType=` query filters)
- GET `/count` (count with optional `?status=` filter)
- PUT `/{taskId}` (update status, output_data, resolved_at)
- All DB-dependent beans use `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)` consistent with existing discovery controllers

**archModelClient DecisionTask Methods**
- Add to `discovery-service/src/services/archModelClient.ts`: `bulkSaveDecisionTasks`, `getDecisionTasksByRun` (with optional status/taskType filters), `getDecisionTaskCount` (with optional status filter), `updateDecisionTask`
- Follow the identical axios HTTP client patterns used by the existing relationship/cluster/candidate methods

**Gateway DecisionTask Resolution Endpoint**
- New route file `gateway/src/routes/discoveryDecisionTasks.ts` with POST `/api/v1/discovery/resolve-decision-tasks`
- Request body: `{ projectId, runId, tasks: DecisionTask[] }` where tasks have `status: 'pending'` and populated `inputData`
- Response body: `{ results: [{ taskId, status, outputData, error }] }`
- Handler iterates tasks sequentially (no parallelism), constructs a structured prompt per `taskType`, calls `getLlmClient().sendChatRequest()`, parses JSON response
- Individual task LLM failures get `status: 'failed'` with error message; other tasks continue processing
- Register the route in `gateway/src/server.ts`

**Structured LLM Prompts**
- Two prompt template files in `gateway/src/config/prompts/`: `discovery.confirm-relationship.prompt.md` and `discovery.resolve-competing-relationships.prompt.md`
- Confirm-relationship prompt: provides source/target atom data, proposed relationship type, confidence, ruleId; expects JSON `{ "decision": "confirm"|"reject", "adjustedConfidence": number, "reasoning": string }`
- Resolve-competing prompt: provides source atom data and array of competing targets; expects JSON `{ "selectedIndex": number|null, "adjustedConfidence": number, "reasoning": string }`
- Prompts instruct LLM to return ONLY valid JSON; gateway parsing handles both raw JSON and markdown-fenced JSON for resilience

**Phase 1b Linker Orchestration (replace executeStep1b stub)**
- Replace the stub in `discovery-service/src/services/runManager.ts` with real synchronous logic: fetch 1a atoms, run all registered linker rules, triage candidates, persist auto-accepted relationships in BULK_SAVE_BATCH_SIZE batches, create/persist DecisionTasks, call gateway resolution endpoint, process results (persist confirmed relationships, skip rejected), update DecisionTask records with output/status, return summary metadata
- Summary metadata includes: `relationshipCount`, `autoAcceptedCount`, `decisionTaskCount`, `decisionTaskResolvedCount`, `decisionTaskFailedCount`, `discardedCount`, `upstreamAtomCount`
- The `executeStep1b` function signature remains `(projectId, runId) => Promise<Record<string, unknown>>` for compatibility with the existing step sequencing in `startRun`

**Discovery-Service Gateway Client Configuration**
- Add `GATEWAY_BASE_URL` (default `http://localhost:3001`) to `discovery-service/src/config.ts` following the `ARCHITECTURE_MODEL_SERVICE_BASE_URL` pattern
- Create a separate `discovery-service/src/services/gatewayClient.ts` for HTTP calls to the gateway (keeps concerns separate from archModelClient)
- Add `GATEWAY_BASE_URL` environment variable to Docker Compose for the discovery-service container

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**Phase 1a extractor sub-extractors (`discovery-service/src/services/extractors/`)**
- Self-contained, testable extraction units (`fileStructureExtractor.ts`, `symbolExtractor.ts`, `stringPatternExtractor.ts`) that are the direct structural template for linker rule files
- Each processes atoms/files independently and returns typed results -- linker rules should follow the same single-responsibility pattern
- File organization under a sub-directory with barrel export is the pattern for `linkerRules/`

**Analyzer registry (`discovery-service/src/services/analyzerRegistry.ts`)**
- In-memory Map registry with `initialize`, `get`, `register` functions -- direct template for the linker rule registry
- Initialization at startup with built-in entries, extensible via `registerLinkerRule()`
- Console log on initialization reporting registry size

**Run manager executeStep1a (`discovery-service/src/services/runManager.ts` lines 78-128)**
- Template for the new `executeStep1b` implementation: fetch upstream data from archModelClient, process through analyzer/rules, persist results in BULK_SAVE_BATCH_SIZE batches via archModelClient, return summary metadata object
- The step sequencing in `startRun` (lines 204-253) requires no changes -- it already calls `executeStep1b` and merges returned metadata into stepsPayload

**archModelClient relationship methods (`discovery-service/src/services/archModelClient.ts` lines 237-290)**
- `bulkSaveRelationships`, `getRelationshipsByRun`, `getRelationshipCount` demonstrate the exact axios HTTP patterns (URL construction with `encodeURIComponent`, optional query params, typed responses) for the new DecisionTask client methods

**Discovery JPA stack (`DiscoveryRelationshipEntity`, migration `067-discovery-relationship.sql`)**
- Direct template for `DiscoveryDecisionTaskEntity`: same annotation pattern (`@Entity`, `@Table` with indexes, `@Type(JsonType.class)` for JSONB, `@PrePersist`, Lombok), same service/controller/repository structure, same Liquibase SQL migration format with comments and indexes

## Out of Scope
- Real 1c cluster formation logic (remains backbone stub)
- Real 1d candidate synthesis logic (remains backbone stub)
- Frontend UI for browsing relationships, DecisionTasks, or linker results
- Frontend UI for human-in-the-loop DecisionTask review or override
- Human-in-the-loop workflows for DecisionTask approval/rejection
- Retry logic or circuit breakers for failed LLM calls (simple fail-and-record only)
- Parallel or concurrent DecisionTask LLM resolution (sequential loop only)
- Streaming or WebSocket progress updates during 1b execution
- Gateway proxy routes for the decision-task architecture-model-service endpoints (discovery-service calls architecture-model-service directly)
- Performance optimization for large atom sets (pagination, streaming, concurrent rule execution)
