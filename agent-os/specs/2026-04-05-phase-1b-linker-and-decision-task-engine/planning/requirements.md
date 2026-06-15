# Spec Requirements: Phase 1b Linker and DecisionTask Engine

## Initial Description
Increment 8 of 16 -- Legacy / Current-State Discovery capability. Implements Phase 1b evidence relationship linking with real logic (replacing the current backbone stub), plus introduces the DecisionTask engine for LLM-assisted ambiguity resolution.

Phase 1b takes the Phase 1a evidence atoms (file_structure, symbol, string_pattern) and infers relationships between them. The linking process has two tiers:

1. **Deterministic linking rules**: Pattern-matching on atom data fields to produce high-confidence relationships (e.g., import statements matching symbol names, directory containment from file paths, class extension patterns)
2. **DecisionTask engine**: When deterministic rules produce ambiguous or low-confidence results, a DecisionTask is created. The DecisionTask engine uses LLM calls to resolve ambiguity -- confirming relationships, choosing between competing candidates, or discarding false positives.

## Requirements Discussion

### First Round Questions

**Q1:** For deterministic linking rules, I assume each rule maps to a specific relationship type and operates on specific atom type combinations. For example:
- **imports**: Match `string_pattern` atoms with `patternName: 'import'` to `symbol` atoms where the `matchedText` contains the symbol's `name` -- producing a high-confidence (0.9+) `imports` relationship.
- **contains**: Match `file_structure` atoms where one `relativePath` is a prefix of another -- producing 1.0 confidence `contains` relationships for directory hierarchy.
- **extends**: Match `string_pattern` atoms with `patternName: 'extends'`/`'implements'` to `symbol` atoms with matching `name` -- producing high-confidence `extends` relationships.
- **calls**: Match `symbol` atoms with `kind: 'function'`/`'method'` where one references the name of another (via `string_pattern` cross-reference) -- lower confidence, more likely to generate DecisionTasks.

Is this roughly the right mental model for the deterministic rules? Should each rule be a self-contained, testable unit (e.g., a "linker rule" interface with `match(atoms) -> candidate relationships`)? And should we aim for an extensible registry of rules (similar to the analyzer registry pattern) or a simpler hardcoded set for this increment?
**Answer:** Use self-contained, testable rule units with an extensible registry-style shape; keep the initial rule set small.

**Q2:** For the confidence scoring model, I assume a numeric range of 0.0 to 1.0 (matching the existing `confidence` field on `EvidenceRelationship`). I'm thinking the triage thresholds would be:
- **>= 0.8**: Auto-accept -- relationship is persisted directly, no DecisionTask needed.
- **0.4 to 0.79**: Ambiguous -- a `confirm_relationship` DecisionTask is created for LLM review.
- **< 0.4**: Auto-discard -- relationship is dropped without LLM involvement.

Are these thresholds reasonable? Should they be configurable (e.g., in the discovery config or as constants), or hardcoded for now?
**Answer:** Yes, that general threshold pattern is reasonable for this increment; keep it simple and centrally configurable rather than scattering magic numbers.

**Q3:** For DecisionTask persistence, I assume a new `discovery_decision_task` database table in architecture-model-service with:
- `id` (UUID PK), `run_id` (FK), `task_type` ('confirm_relationship' | 'resolve_competing_relationships'), `status` ('pending' | 'resolved' | 'failed'), `input_data` (JSONB -- the atoms and candidate relationships to evaluate), `output_data` (JSONB -- the LLM's decision and reasoning), `created_at`, `resolved_at`

This would follow the same JPA stack pattern as the other discovery tables (entity, DTO, repository, service, controller, Liquibase migration). Is that correct, or should DecisionTasks be transient (in-memory only, not persisted)?
**Answer:** Persist DecisionTasks as real run-scoped data, not in-memory only.

**Q4:** For LLM integration, the gateway currently owns all LLM calls via `llmClient.ts`. The discovery-service has no LLM client of its own. I see three approaches:
- **(A)** Discovery-service calls the gateway's LLM proxy endpoint (if one exists or is created) via HTTP -- keeping LLM ownership in the gateway.
- **(B)** Discovery-service gets its own LLM client (duplicating or importing the LLM client pattern) and calls OpenAI/Azure directly.
- **(C)** Discovery-service sends DecisionTask batches to a new gateway endpoint that resolves them via LLM and returns results -- a "DecisionTask resolution" API.

I'm leaning toward (C) because it keeps LLM configuration centralized in the gateway, avoids duplicating API keys/config in discovery-service, and provides a clean contract boundary. The discovery-service would POST a batch of DecisionTasks to the gateway, which resolves them via LLM and returns the decisions. Is that the right approach?
**Answer:** Route LLM resolution through the gateway rather than giving the discovery-service its own separate LLM path.

**Q5:** For DecisionTask execution within the 1b step, I assume the flow is:
1. Run all deterministic linker rules against the 1a atoms, producing candidate relationships with confidence scores.
2. Triage candidates: auto-accept high-confidence, auto-discard low-confidence, collect ambiguous ones into DecisionTasks.
3. Persist the auto-accepted relationships immediately.
4. Send the DecisionTask batch to the gateway (or LLM) for resolution -- synchronously within the 1b step execution.
5. Process DecisionTask results: persist confirmed relationships, discard rejected ones.
6. Persist all DecisionTasks (with their resolutions) for auditability.
7. Return summary metadata (relationshipCount, decisionTaskCount, etc.)

Is this synchronous batch model correct? Or should DecisionTask resolution be asynchronous (e.g., step 1b completes with pending tasks, and a separate process resolves them before 1c begins)?
**Answer:** Use a simple synchronous step-local execution model in this increment.

**Q6:** For order of magnitude: a typical repository might produce hundreds to low-thousands of 1a atoms. I'm assuming the deterministic linker will produce perhaps 50-200 high-confidence relationships and 10-50 DecisionTasks per run. The LLM batch could be resolved in a single API call (or a few calls) rather than hundreds of individual calls. Is this roughly the right scale? Should we set a maximum batch size for LLM calls?
**Answer:** Those rough volumes sound fine for v1; keep batching conservative and implementation-driven rather than over-optimizing now.

**Q7:** For the LLM prompts:
- **confirm_relationship**: I assume the prompt provides the source atom's data, the target atom's data, the proposed relationship type, the confidence score, and asks the LLM to confirm/reject with reasoning. Something like "Given these two code elements, is the inferred [relationship_type] relationship correct?"
- **resolve_competing_relationships**: I assume the prompt provides a source atom and multiple target candidates, asking the LLM to pick the correct one or none.

Should the prompts be stored as template files (like the existing task prompts in `gateway/src/config/prompts/`) or hardcoded in the resolution service? Should the LLM response be structured (JSON) or free-text parsed?
**Answer:** Use structured prompts with structured JSON responses, not free-text parsing.

**Q8:** Is there anything that should be explicitly excluded from this increment? For example: should we exclude the 1c/1d real logic, frontend UI for DecisionTask review, human-in-the-loop override of LLM decisions, or retry/circuit-breaker for failed LLM calls?
**Answer:** Yes -- exclude real 1c/1d logic, frontend work, human-in-the-loop flows, and resilience sophistication like retries/circuit-breakers in this increment.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Phase 1a extractor sub-extractors -- Path: `discovery-service/src/services/extractors/fileStructureExtractor.ts`, `symbolExtractor.ts`, `stringPatternExtractor.ts` -- Self-contained, testable extraction units that form the structural template for linker rule units. Each extractor processes atoms independently and returns results, which is the same pattern linker rules should follow.
- Feature: Analyzer registry -- Path: `discovery-service/src/services/analyzerRegistry.ts` -- Registry pattern for organizing and looking up analyzer packs. The linker rule registry should follow a similar extensible shape.
- Feature: Phase 1a analyzer pack -- Path: `discovery-service/src/services/phase1aAnalyzerPack.ts` -- Orchestrates multiple sub-extractors and collects results. The 1b linker should orchestrate multiple linker rules similarly.
- Feature: Run manager executeStep1b stub -- Path: `discovery-service/src/services/runManager.ts` (lines 141-147) -- The current stub that will be replaced with real linking logic.
- Feature: Evidence atom types -- Path: `discovery-service/src/types/evidenceAtom.ts` -- The input data shapes (FileStructureData, SymbolData, StringPatternData) that linker rules will pattern-match against.
- Feature: Relationship types -- Path: `discovery-service/src/types/relationship.ts` -- The output data shapes (EvidenceRelationship, RelationshipType, type-specific data interfaces) that linker rules will produce.
- Feature: archModelClient relationship methods -- Path: `discovery-service/src/services/archModelClient.ts` (lines 237-290) -- bulkSaveRelationships, getRelationshipsByRun, getRelationshipCount for persisting linker output.
- Feature: Gateway LLM client -- Path: `gateway/src/services/llmClient.ts` -- Provider-agnostic LLM interface (getLlmClient, sendChatRequest) that the new gateway DecisionTask resolution endpoint will use.
- Feature: Gateway chatV2 routes -- Path: `gateway/src/routes/chatV2.ts` -- Established pattern for how the gateway handles LLM calls with structured prompts and responses.
- Feature: Gateway prompt templates -- Path: `gateway/src/config/prompts/` -- Existing prompt templates stored as files; the DecisionTask prompts should follow this pattern.
- Feature: Discovery evidence JPA stack -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryEvidenceEntity.java`, `...service/DiscoveryEvidenceService.java`, `...controller/DiscoveryEvidenceController.java`, `...repository/entity/DiscoveryEvidenceRepository.java` -- Direct template for the new DecisionTask JPA entity/service/controller/repository.
- Feature: Discovery relationship Liquibase migration -- Path: `architecture-model-service/src/main/resources/db/changelog/sql/067-discovery-relationship.sql` -- Template for the new DecisionTask table migration.
- Feature: AnalyzerResult type -- Path: `discovery-service/src/types/analyzerPack.ts` -- Has optional `relationships` field that the 1b step will populate.
- Feature: Discovery-service config -- Path: `discovery-service/src/config.ts` -- Where the gateway base URL for DecisionTask resolution calls would be configured.

### Follow-up Questions
No follow-up questions were needed. All answers were clear and provided sufficient direction for each design decision.

## Visual Assets

### Files Provided:
No visual assets provided (confirmed via file system check).

### Visual Insights:
N/A -- no visual assets to analyze.

## Requirements Summary

### Functional Requirements

**FR-1: Linker Rule Interface and Registry**

Define a `LinkerRule` interface in `discovery-service/src/types/` that each deterministic linking rule implements. Each rule is a self-contained, testable unit.

LinkerRule interface shape:
- `id`: string -- unique rule identifier (e.g., 'imports-by-pattern', 'contains-by-path', 'extends-by-pattern')
- `name`: string -- human-readable name
- `description`: string -- what the rule detects
- `targetRelationshipType`: RelationshipType -- which relationship type this rule produces
- `match(atoms: EvidenceAtom[]): CandidateRelationship[]` -- takes the full set of 1a atoms and returns candidate relationships with confidence scores

Define a `CandidateRelationship` interface representing an unfinalized relationship proposal:
- `sourceAtomId`: string
- `targetAtomId`: string
- `relationshipType`: RelationshipType
- `confidence`: number (0.0 to 1.0)
- `data`: RelationshipData (type-specific payload)
- `ruleId`: string -- which linker rule produced this candidate (for traceability)

Create a linker rule registry (following the analyzerRegistry pattern) that holds registered rules and provides iteration/lookup. Rules are registered at startup.

**FR-2: Initial Deterministic Linker Rules**

Implement a small initial set of linker rules. Keep the set small for this increment -- the registry is extensible for future rules. Initial rules:

1. **ContainsByPathRule**: Match `file_structure` atoms where one `relativePath` is a directory-prefix of another. Produces `contains` relationships at 1.0 confidence. This is purely structural and deterministic.

2. **ImportsByPatternRule**: Match `string_pattern` atoms with `patternName` indicating an import (e.g., 'import', 'require', 'from') to `symbol` atoms where the `matchedText` contains or references the symbol's `name`. Produces `imports` relationships. Confidence varies based on match quality (exact name match = 0.9+, partial/ambiguous match = 0.5-0.7).

3. **ExtendsByPatternRule**: Match `string_pattern` atoms with `patternName` indicating inheritance/extension (e.g., 'extends', 'implements') to `symbol` atoms with matching `name` and appropriate `kind` (class, interface). Produces `extends` relationships. Confidence varies similarly to imports.

4. **ReferencesBySymbolRule**: A catch-all rule that finds `string_pattern` atoms referencing `symbol` atom names that don't match more specific rules. Produces `references` relationships at lower confidence (0.3-0.6), which are more likely to generate DecisionTasks or be auto-discarded.

Each rule should be in its own file under `discovery-service/src/services/linkerRules/` (following the extractor sub-directory pattern).

**FR-3: Confidence Threshold Configuration**

Define centrally configurable confidence thresholds that control the triage of candidate relationships:

- `AUTO_ACCEPT_THRESHOLD`: number (default 0.8) -- candidates at or above this confidence are persisted directly as relationships without LLM review.
- `AMBIGUOUS_THRESHOLD`: number (default 0.4) -- candidates at or above this but below `AUTO_ACCEPT_THRESHOLD` generate DecisionTasks for LLM review.
- Candidates below `AMBIGUOUS_THRESHOLD` are auto-discarded.

These thresholds should be defined as named constants in a single configuration location within discovery-service (e.g., `discovery-service/src/constants/linkerDefaults.ts` or similar), not scattered as magic numbers throughout the code. They are not user-facing configuration in this increment -- just centralized constants that are easy to adjust.

**FR-4: Candidate Triage Engine**

Implement a triage function that takes the full list of `CandidateRelationship[]` from all linker rules and partitions them into three buckets:

1. **accepted**: confidence >= AUTO_ACCEPT_THRESHOLD -- ready for immediate persistence as `EvidenceRelationship` records.
2. **ambiguous**: confidence >= AMBIGUOUS_THRESHOLD and < AUTO_ACCEPT_THRESHOLD -- will become DecisionTasks.
3. **discarded**: confidence < AMBIGUOUS_THRESHOLD -- dropped, not persisted.

Additionally, the triage engine should detect competing relationships: when multiple candidates share the same `sourceAtomId` and `targetAtomId` (or the same source atom targeting different candidates for semantically similar relationships), these should be grouped into `resolve_competing_relationships` DecisionTasks rather than individual `confirm_relationship` tasks.

The triage function should be a standalone, testable unit.

**FR-5: DecisionTask TypeScript Types**

Define TypeScript types in `discovery-service/src/types/decisionTask.ts`:

- `DecisionTaskType`: union type -- `'confirm_relationship'` | `'resolve_competing_relationships'`
- `DecisionTaskStatus`: union type -- `'pending'` | `'resolved'` | `'failed'`
- `ConfirmRelationshipInput`: interface -- contains the source atom data, target atom data, proposed relationship type, confidence score, and rule ID that produced the candidate
- `ResolveCompetingInput`: interface -- contains the source atom data, array of competing target candidates (each with atom data, relationship type, confidence, rule ID)
- `DecisionTaskInput`: union of `ConfirmRelationshipInput` | `ResolveCompetingInput`
- `ConfirmRelationshipOutput`: interface -- contains `decision` ('confirm' | 'reject'), `adjustedConfidence` (number), `reasoning` (string)
- `ResolveCompetingOutput`: interface -- contains `selectedIndex` (number | null, null = none selected), `adjustedConfidence` (number), `reasoning` (string)
- `DecisionTaskOutput`: union of `ConfirmRelationshipOutput` | `ResolveCompetingOutput`
- `DecisionTask`: interface -- `id` (string UUID), `runId` (string), `taskType` (DecisionTaskType), `status` (DecisionTaskStatus), `inputData` (DecisionTaskInput), `outputData` (DecisionTaskOutput | null), `createdAt` (string), `resolvedAt` (string | null)

Export all types via the barrel export in `discovery-service/src/types/index.ts`.

**FR-6: DecisionTask Persistence (architecture-model-service)**

New `discovery_decision_task` database table and full JPA persistence stack following the established discovery entity pattern:

Table columns:
- `id` -- UUID primary key
- `run_id` -- UUID FK to discovery_run.id, ON DELETE CASCADE, NOT NULL
- `task_type` -- TEXT NOT NULL ('confirm_relationship' or 'resolve_competing_relationships')
- `status` -- TEXT NOT NULL DEFAULT 'pending' ('pending', 'resolved', 'failed')
- `input_data` -- JSONB NOT NULL (the atoms, candidates, and context for the decision)
- `output_data` -- JSONB (nullable; populated when resolved with LLM decision and reasoning)
- `created_at` -- TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `resolved_at` -- TIMESTAMPTZ (nullable; set when status transitions to 'resolved' or 'failed')

Indexes:
- Non-unique index on `run_id`
- Composite index on `(run_id, status)`
- Composite index on `(run_id, task_type)`

Liquibase migration: next available migration number after the existing discovery migrations (check `db.changelog-master.yaml` for the latest number).

JPA entity: `DiscoveryDecisionTaskEntity` with Lombok annotations, `@Type(JsonType.class)` for JSONB columns, `@PrePersist` lifecycle callback, `@ConditionalOnProperty` for DB feature toggle.

DTO: `DiscoveryDecisionTaskDto` Java record.

Repository: `DiscoveryDecisionTaskRepository` with `findByRunId`, `findByRunIdAndStatus`, `findByRunIdAndTaskType`, `countByRunId`, `countByRunIdAndStatus`.

Service: `DiscoveryDecisionTaskService` with `bulkCreate`, `getByRunId`, `getByRunIdAndStatus`, `countByRunId`, `updateTask` (for status/output updates). `@Transactional` on write methods, `@Transactional(readOnly = true)` on reads.

Controller: `DiscoveryDecisionTaskController` under `/api/model/projects/{projectId}/discovery/runs/{runId}/decision-tasks` with:
- POST (bulk insert)
- GET (list with optional `?status=` and `?taskType=` filters)
- GET `/count` (count with optional `?status=` filter)
- PUT `/{taskId}` (update status, output_data, resolved_at)

**FR-7: archModelClient DecisionTask Methods**

New methods on `discovery-service/src/services/archModelClient.ts` for DecisionTask persistence:

- `bulkSaveDecisionTasks(projectId, runId, tasks: DecisionTask[])` -- POST to decision-tasks endpoint
- `getDecisionTasksByRun(projectId, runId, status?, taskType?)` -- GET with optional filters
- `getDecisionTaskCount(projectId, runId, status?)` -- GET count with optional status filter
- `updateDecisionTask(projectId, runId, taskId, update)` -- PUT for status/output updates

Following the exact same HTTP client patterns as the existing evidence, relationship, cluster, and candidate methods.

**FR-8: Gateway DecisionTask Resolution Endpoint**

New gateway endpoint for resolving DecisionTasks via LLM. The discovery-service sends a batch of pending DecisionTasks to the gateway, which resolves them using the existing `getLlmClient()` and returns the decisions.

Endpoint: POST `/api/v1/discovery/resolve-decision-tasks`

Request body:
- `projectId`: string
- `runId`: string
- `tasks`: array of DecisionTask objects (with `inputData` populated, `status: 'pending'`)

Response body:
- `results`: array of objects, each containing:
  - `taskId`: string
  - `status`: 'resolved' | 'failed'
  - `outputData`: DecisionTaskOutput (the LLM's decision)
  - `error`: string | null (populated if status is 'failed')

The gateway handler:
1. Receives the batch of tasks.
2. For each task (or grouped efficiently), constructs a structured prompt based on `taskType`.
3. Calls `getLlmClient().sendChatRequest()` with the prompt.
4. Parses the structured JSON response from the LLM.
5. Returns the array of results.

The gateway should process tasks in a simple sequential loop for this increment (no parallelism/batching sophistication). If an individual task's LLM call fails, that task gets `status: 'failed'` with an error message, but other tasks continue processing.

**FR-9: Structured LLM Prompts for DecisionTasks**

Two prompt templates stored as files in `gateway/src/config/prompts/` (following the existing prompt template pattern):

**confirm_relationship prompt** (`discovery.confirm-relationship.prompt.md` or similar):
- System message establishing context: "You are analyzing code evidence to confirm or reject an inferred relationship between two code elements."
- Input context: source atom type/data, target atom type/data, proposed relationship type, confidence score, file paths, rule that produced the candidate.
- Expected output: structured JSON with `{ "decision": "confirm" | "reject", "adjustedConfidence": <number 0.0-1.0>, "reasoning": "<brief explanation>" }`

**resolve_competing_relationships prompt** (`discovery.resolve-competing-relationships.prompt.md` or similar):
- System message establishing context: "You are analyzing code evidence to determine which of several competing relationship targets is most accurate for a given source element."
- Input context: source atom type/data, array of competing targets each with atom data/type/confidence.
- Expected output: structured JSON with `{ "selectedIndex": <number or null>, "adjustedConfidence": <number 0.0-1.0>, "reasoning": "<brief explanation>" }`

The prompts should instruct the LLM to return valid JSON only. The gateway parses the response as JSON and maps it to the appropriate `DecisionTaskOutput` type.

**FR-10: Phase 1b Linker Orchestration (replace stub)**

Replace the current `executeStep1b` stub in `discovery-service/src/services/runManager.ts` with real linking logic. The new implementation follows this synchronous flow:

1. **Fetch 1a atoms**: Call `archModelClient.getEvidenceByRun(projectId, runId)` to get all Phase 1a evidence atoms for the run.

2. **Run linker rules**: Iterate over all registered linker rules, passing the full atom set to each rule's `match()` method. Collect all `CandidateRelationship[]` results.

3. **Triage candidates**: Pass the combined candidate list through the triage engine (FR-4), producing accepted, ambiguous, and discarded buckets.

4. **Persist auto-accepted relationships**: Convert accepted candidates to `EvidenceRelationship` objects (generating UUIDs, setting runId, inferredAt). Call `archModelClient.bulkSaveRelationships()` in batches (following the 1a BULK_SAVE_BATCH_SIZE pattern).

5. **Create DecisionTasks for ambiguous candidates**: Convert ambiguous candidates (and competing relationship groups) into `DecisionTask` objects with `status: 'pending'`, structured `inputData`. Persist them via `archModelClient.bulkSaveDecisionTasks()`.

6. **Resolve DecisionTasks via gateway**: Call the gateway's DecisionTask resolution endpoint (FR-8) with the batch of pending tasks. The discovery-service needs a configured gateway base URL (add to `discovery-service/src/config.ts`).

7. **Process resolution results**: For each resolved task:
   - If `confirm_relationship` with `decision: 'confirm'`: create an `EvidenceRelationship` from the candidate with the `adjustedConfidence` and persist it.
   - If `confirm_relationship` with `decision: 'reject'`: do not create a relationship.
   - If `resolve_competing_relationships` with a `selectedIndex`: create an `EvidenceRelationship` for the selected candidate with `adjustedConfidence` and persist it.
   - If `resolve_competing_relationships` with `selectedIndex: null`: do not create any relationship.

8. **Update DecisionTasks with results**: Call `archModelClient.updateDecisionTask()` for each task to set `status`, `outputData`, `resolvedAt`.

9. **Return summary metadata**: Return an object with counts for inclusion in the run's `stepsPayload`:
   - `relationshipCount`: total relationships persisted (auto-accepted + LLM-confirmed)
   - `autoAcceptedCount`: relationships persisted without LLM review
   - `decisionTaskCount`: total DecisionTasks created
   - `decisionTaskResolvedCount`: tasks resolved by LLM
   - `decisionTaskFailedCount`: tasks that failed LLM resolution
   - `discardedCount`: candidates auto-discarded below threshold
   - `upstreamAtomCount`: total 1a atoms processed

**FR-11: Discovery-Service Gateway Client Configuration**

Add a `GATEWAY_BASE_URL` configuration entry to `discovery-service/src/config.ts` for calling the gateway's DecisionTask resolution endpoint. Follow the same pattern as the existing `ARCHITECTURE_MODEL_SERVICE_BASE_URL` configuration.

The HTTP call from discovery-service to gateway should use the same axios-based pattern as the archModelClient. This could be a separate client class (e.g., `gatewayClient.ts`) or added as methods on a new client, keeping concerns separate from the archModelClient.

### Reusability Opportunities
- Phase 1a extractor sub-extractors (`discovery-service/src/services/extractors/`) are the direct structural template for linker rule units -- self-contained files, each processing atoms and returning results.
- Analyzer registry (`discovery-service/src/services/analyzerRegistry.ts`) is the template for the linker rule registry.
- Phase 1a analyzer pack (`discovery-service/src/services/phase1aAnalyzerPack.ts`) is the template for how the 1b linker orchestrates multiple rules and collects results.
- Run manager `executeStep1a` function is the template for the new `executeStep1b` implementation (fetch upstream data, process, persist results in batches, return summary metadata).
- All existing discovery JPA entity/service/controller/repository stacks (`DiscoveryEvidenceEntity`, `DiscoveryRelationshipEntity`, etc.) are direct templates for the new `DiscoveryDecisionTaskEntity` stack.
- Gateway LLM client (`gateway/src/services/llmClient.ts`) with `getLlmClient().sendChatRequest()` is used by the new resolution endpoint.
- Gateway prompt templates in `gateway/src/config/prompts/` provide the file-based prompt pattern for the new DecisionTask prompts.
- archModelClient methods for relationships (bulkSaveRelationships, etc.) are the template for new DecisionTask client methods.
- Extraction defaults constants file (`discovery-service/src/constants/extractionDefaults.ts`) is the pattern for the new linker defaults/thresholds constants file.

### Scope Boundaries

**In Scope:**
- LinkerRule interface and linker rule registry in discovery-service
- Four initial deterministic linker rules (ContainsByPath, ImportsByPattern, ExtendsByPattern, ReferencesBySymbol) in `discovery-service/src/services/linkerRules/`
- CandidateRelationship type definition
- Centrally configured confidence thresholds (AUTO_ACCEPT_THRESHOLD, AMBIGUOUS_THRESHOLD)
- Candidate triage engine (partition candidates into accepted/ambiguous/discarded buckets, detect competing relationships)
- DecisionTask TypeScript types (DecisionTask, DecisionTaskType, DecisionTaskStatus, input/output interfaces)
- `discovery_decision_task` database table with Liquibase migration in architecture-model-service
- DiscoveryDecisionTaskEntity, DTO, Repository, Service, Controller in architecture-model-service
- archModelClient methods for DecisionTask CRUD (bulkSave, getByRun, count, update)
- Gateway DecisionTask resolution endpoint (POST `/api/v1/discovery/resolve-decision-tasks`)
- Two structured LLM prompt templates (confirm_relationship, resolve_competing_relationships) in `gateway/src/config/prompts/`
- Discovery-service gateway client configuration (GATEWAY_BASE_URL) and HTTP client for calling the resolution endpoint
- Replace executeStep1b stub with real orchestration: fetch atoms, run rules, triage, persist accepted, create/resolve DecisionTasks, persist results, return summary metadata
- Updated stepsPayload metadata for step 1b (relationshipCount, autoAcceptedCount, decisionTaskCount, etc.)
- Unit tests for all linker rules (each rule in isolation)
- Unit tests for the triage engine
- Unit tests for the DecisionTask JPA stack (JUnit 5: service, controller)
- Unit tests for the archModelClient DecisionTask methods (Jest)
- Unit tests for the gateway DecisionTask resolution endpoint
- Unit tests for the updated executeStep1b orchestration
- Types barrel export updates

**Out of Scope:**
- Real 1c cluster formation logic (remains backbone stub)
- Real 1d candidate synthesis logic (remains backbone stub)
- Frontend UI for browsing relationships, DecisionTasks, or linker results
- Frontend UI for human-in-the-loop DecisionTask review or override
- Human-in-the-loop workflows for DecisionTask approval/rejection
- Retry logic or circuit breakers for failed LLM calls (simple fail-and-record in this increment)
- Parallel or concurrent DecisionTask LLM resolution (sequential loop only)
- Streaming or WebSocket progress updates during 1b execution
- Gateway proxy routes for the decision-task architecture-model-service endpoints (discovery-service calls architecture-model-service directly)
- MCP tool wiring for DecisionTask endpoints
- Advanced competing relationship detection heuristics beyond same-source-same-target grouping
- Performance optimization for large atom sets (pagination, streaming)
- Phase 2+ pipeline stages
- Authentication or authorization on new endpoints
- Changes to 1a extractors or evidence schema
- Changes to discovery_config or discovery_run table schemas (beyond stepsPayload metadata content)

### Technical Considerations
- The latest Liquibase migration number must be checked in `db.changelog-master.yaml` before creating the new migration. The previous increment (7) added migrations 067-070 for relationship, cluster, cluster_member, and candidate tables. The DecisionTask migration will be the next available number.
- The `discovery_decision_task` table follows the same cascade-delete pattern as other discovery tables: `ON DELETE CASCADE` on the `run_id` FK ensures cleanup when a run is deleted.
- The gateway DecisionTask resolution endpoint should be in a new route file (e.g., `gateway/src/routes/discoveryDecisionTasks.ts`) rather than being added to an existing route file, following separation of concerns.
- The discovery-service needs a new environment variable for `GATEWAY_BASE_URL` (e.g., `http://localhost:3001` in development). This must be added to Docker Compose configuration for the discovery-service container.
- The LLM prompt templates should instruct the model to return ONLY valid JSON (no markdown fencing, no preamble). The gateway parsing code should handle both raw JSON and markdown-fenced JSON for resilience.
- The linker rules directory (`discovery-service/src/services/linkerRules/`) should include an `index.ts` barrel export and a `registerLinkerRules()` function called at startup (similar to how analyzer packs are registered).
- DecisionTask `inputData` should include enough context for the LLM to make a decision without needing additional database queries -- i.e., the full atom data for source and target, not just IDs.
- The `CandidateRelationship` type is internal to the discovery-service (not persisted to the database). It exists only during the triage phase and is converted to either an `EvidenceRelationship` (if accepted) or a `DecisionTask` (if ambiguous).
- The triage engine's competing relationship detection should use a simple grouping strategy for this increment: group candidates that share the same `sourceAtomId` and have the same `relationshipType`. More sophisticated detection can be added in later increments.
- The gateway resolution endpoint does not need authentication in this increment (internal service-to-service call), but should validate the request body structure.
- All new JPA entities should include `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)` consistent with existing DB-dependent controllers/services.
- Docker Compose: no new service entries needed. The discovery-service container needs a `GATEWAY_BASE_URL` environment variable pointing to the gateway. The gateway container does not need new configuration (it already has LLM provider config).
