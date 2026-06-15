# Spec Requirements: Discovery Run Model and Orchestration

## Initial Description
Increment 5 of 16 for the legacy/current-state discovery capability. Introduces a discovery run model for explicit, trackable Phase 1 execution. After Phase 0 framing is complete (persisted anchors, config, and brief from Increment 4), Phase 1 needs a run entity to track execution state, step progression, and results across the multi-step code-repo analysis pipeline (steps 1a, 1b, 1c, 1d). This increment establishes the orchestration and persistence plumbing only -- Phase 1 steps remain stubs returning placeholder responses.

## Requirements Discussion

### First Round Questions

**Q1:** I assume the "discovery run" is a new JPA entity persisted in the architecture-model-service, following the same pattern as `DiscoveryConfigEntity` -- a `discovery_run` table with UUID PK, `project_id` FK, JSONB payload for step results, status lifecycle, and timestamps. The entity would have one-to-one relationship with `discovery_config` (one active run per project at a time). Is that correct, or should a project support multiple concurrent or historical runs (one-to-many)?
**Answer:** Support multiple historical runs per project, but only one active run at a time.

**Q2:** I'm thinking the run status lifecycle would be: `PENDING` (created, not yet started), `RUNNING` (actively executing steps), `COMPLETED` (all steps finished successfully), `FAILED` (a step failed), `CANCELLED` (user or system aborted). Is that the right set, or do you want additional states like `PAUSED` or `WAITING_FOR_INPUT`?
**Answer:** Keep it simple for now: PENDING -> RUNNING -> COMPLETED / FAILED / CANCELLED.

**Q3:** For step tracking within a run, I assume each of the four Phase 1 steps (1a, 1b, 1c, 1d) should have its own status (`pending`, `running`, `completed`, `failed`, `skipped`) stored within the run's JSONB payload -- similar to how `config_payload` stores structured JSON in `DiscoveryConfigEntity`. Is that correct, or should each step be its own row/entity with a FK back to the run?
**Answer:** Store 1a-1d step status within the run structure, not as separate entities in this increment.

**Q4:** I assume the gateway orchestration for Phase 1 follows the pattern of the existing `/v2/jobs/orchestrations` job-based routes -- the gateway exposes endpoints to: (a) create/start a discovery run, (b) poll run status, (c) advance to the next step. The discovery-service's existing Phase 1 stub routes would be called by the gateway as it orchestrates each step. Is that the right interaction model, or should the discovery-service itself manage step sequencing internally once a run is kicked off?
**Answer:** The discovery-service should manage step sequencing internally once the run is started.

**Q5:** I assume this increment is about establishing the run model and orchestration plumbing only -- the Phase 1 steps still return stub responses (no real code analysis yet). Real analyzer execution would come in later increments (6+). Is that correct?
**Answer:** Yes -- this increment is orchestration/run plumbing only; Phase 1 steps are still placeholders.

**Q6:** For the gateway-to-discovery-service communication: I assume the gateway should proxy discovery run operations through a new route file that calls the discovery-service. The gateway would also persist run state to the architecture-model-service via MCP tools. Is that the right split of responsibilities, or should the discovery-service itself handle persistence directly?
**Answer:** The discovery-service should own run execution, but persistence should still follow the platform's controlled backend pattern rather than becoming ad hoc gateway state.

**Q7:** I assume the run model needs to capture a reference to the Phase 0 outputs it consumes. Should the run snapshot the discovery config at creation time, or just reference it by project_id?
**Answer:** Snapshot the Phase 0 config at run creation time so the run is stable and reproducible.

**Q8:** Is there anything you explicitly want to exclude from this increment?
**Answer:** Yes -- exclude frontend run-management UX, WebSocket/streaming progress, retry/resume sophistication, and rich run-history/audit features in this increment.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: DiscoveryConfigEntity persistence stack - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryConfigEntity.java`, `...service/DiscoveryConfigService.java`, `...controller/DiscoveryConfigController.java`, `...repository/entity/DiscoveryConfigRepository.java`, `...resources/db/changelog/sql/064-discovery-config.sql`
- Feature: Gateway job-based orchestration routes - Path: `gateway/src/routes/orchestrations.ts` (POST `/v2/jobs/orchestrations` for job creation, GET `/v2/jobs/:job_id` for polling)
- Feature: MCP save_discovery_config tool chain - Path: `mcp-server/src/routes/saveDiscoveryConfigRoute.ts`, `mcp-server/src/services/discoveryConfigService.ts`, `mcp-server/src/services/archModelClient.ts` (getDiscoveryConfig, saveDiscoveryConfig methods)
- Feature: Discovery-service Phase 1 stub routes - Path: `discovery-service/src/routes/phase1.ts` (POST `/phase1/:step` for steps 1a-1d)
- Feature: Discovery-service analyzer registry - Path: `discovery-service/src/services/analyzerRegistry.ts`, `discovery-service/src/services/stubAnalyzerPack.ts`
- Feature: Gateway discovery route - Path: `gateway/src/routes/discovery.ts` (minimal awareness route from Increment 1)
- Feature: Gateway config for discovery-service URL - Path: `gateway/src/config.ts` (`discoveryServiceBaseUrl` already configured)

### Follow-up Questions

No follow-up questions needed. User responses were clear and comprehensive.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements

**Discovery Run Entity (architecture-model-service)**
- New `discovery_run` database table and JPA entity for tracking Phase 1 execution runs
- Multiple historical runs per project supported; only one active run (PENDING or RUNNING) at a time, enforced at the service layer
- Run status lifecycle: PENDING -> RUNNING -> COMPLETED / FAILED / CANCELLED
- Step tracking for 1a, 1b, 1c, 1d stored within the run's JSONB payload (not as separate entities)
- Each step has its own status within the JSONB: pending, running, completed, failed, skipped
- Snapshot of Phase 0 discovery config captured at run creation time (copied into run's JSONB payload for immutability and reproducibility)
- Standard REST endpoints: create run (POST), get run by ID (GET), get runs by project (GET), update run status (PUT)
- Follows DiscoveryConfigEntity pattern: UUID PK, project_id FK with ON DELETE CASCADE, JSONB payload, status, created_at, updated_at timestamps

**Discovery-Service Internal Step Sequencing**
- The discovery-service manages step sequencing internally once a run is started (not externally orchestrated step-by-step by the gateway)
- When a run is started, the discovery-service progresses through steps 1a -> 1b -> 1c -> 1d sequentially
- Each step invocation calls the existing Phase 1 stub route logic (or the analyzer pack for that step in future increments)
- Step results are collected and the run state is updated after each step completes
- In this increment, all steps return stub/placeholder responses -- no real analysis

**Gateway Discovery Run Routes**
- New gateway route file for discovery run operations that proxies to the discovery-service
- Endpoints to: create/start a discovery run, poll/retrieve run status
- The gateway calls the discovery-service at `discoveryServiceBaseUrl` (already configured from Increment 1)
- Persistence of run state goes through the platform's controlled backend pattern (architecture-model-service via the discovery-service or MCP, not ad hoc gateway state)

**MCP / Persistence Integration**
- Run state persistence follows the platform's controlled backend pattern
- New architecture-model-service endpoints for discovery run CRUD (following DiscoveryConfig pattern)
- The discovery-service calls the architecture-model-service to persist run state as steps progress
- MCP tool for saving/updating discovery run state (following save_discovery_config pattern) if needed for gateway-initiated operations

**Run Creation Preconditions**
- A run can only be created if the project has a discovery config with status COMPLETE (Phase 0 is done)
- At creation, the Phase 0 config is snapshotted into the run's payload
- A run cannot be created if there is already an active run (PENDING or RUNNING) for the project

### Reusability Opportunities
- DiscoveryConfigEntity/Service/Controller/Repository/Liquibase pattern is the direct template for DiscoveryRunEntity stack
- Gateway orchestrations.ts job creation and polling pattern informs the gateway discovery run route design
- save_discovery_config MCP tool chain is the template for a potential save_discovery_run MCP tool
- Discovery-service Phase 1 stub routes (phase1.ts) are the step endpoints the internal sequencer will invoke
- Analyzer registry and stub analyzer pack provide the extension point that future increments will wire into the run sequencer
- Gateway config already has `discoveryServiceBaseUrl` -- no new config entry needed

### Scope Boundaries

**In Scope:**
- New `discovery_run` table with Liquibase migration in architecture-model-service
- DiscoveryRunEntity, DiscoveryRunDto, DiscoveryRunRepository, DiscoveryRunService, DiscoveryRunController in architecture-model-service
- Discovery-service internal run execution engine with sequential step progression (1a -> 1b -> 1c -> 1d)
- Discovery-service run management endpoints (create run, start run, get run status)
- Gateway proxy routes for discovery run operations
- Phase 0 config snapshot at run creation time
- Active run constraint (one active run per project)
- Run JSONB payload structure with per-step status tracking
- Stub step execution (all steps return placeholder responses)
- Unit tests for all new code

**Out of Scope:**
- Frontend UI for viewing, managing, or monitoring discovery runs
- WebSocket or streaming-based real-time step progress updates
- Retry or resume logic for failed steps (simple fail-fast in this increment)
- Rich run history or audit trail features
- Real analyzer pack execution or code analysis (steps remain stubs)
- Phase 2+ pipeline stages
- Authentication or authorization on discovery run endpoints
- Evidence schema or DecisionTask engine integration
- Log-based or hypothesis-first discovery approaches
- Transaction rollback across multi-step run execution (fail-fast, record failure)

### Technical Considerations
- The latest Liquibase migration is `064-discovery-config.sql`; the new migration will be `065-discovery-run.sql`
- The discovery-service currently has no persistence layer -- it will need to call the architecture-model-service REST API to persist run state (similar to how MCP server calls archModelClient)
- The discovery-service config already has `ARCHITECTURE_MODEL_SERVICE_BASE_URL` placeholder from Increment 1 -- this will be activated for real HTTP calls in this increment
- The active-run constraint (only one PENDING or RUNNING run per project) should be enforced at the service layer, not via a unique DB index, since multiple historical runs share the same project_id
- Step sequencing is internal to the discovery-service, meaning the gateway does not need to poll and advance steps -- it just starts the run and polls overall run status
- The JSONB payload for a run should contain: snapshotted Phase 0 config, per-step status and results, overall run metadata
- Docker Compose: the discovery-service will need `depends_on` the architecture-model-service now that it makes real HTTP calls (update from Increment 1 where no depends_on was needed)
