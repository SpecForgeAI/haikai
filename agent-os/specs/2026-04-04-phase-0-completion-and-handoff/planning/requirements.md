# Spec Requirements: Phase 0 Completion and Handoff

## Initial Description
Increment 4 of 16 for the legacy/current-state discovery capability. When the Phase 0 discovery framing conversation reaches phase="ready", the system must: persist canonical anchor entities (applications, app_components), persist structured discovery configuration, generate and persist a Phase 0 discovery brief artifact (DISCOVERY_BRIEF_MD), and provide a clear structured handoff for Phase 1. All writes must go through the MCP controlled write boundary. The handoff must be explicit and referenceable, not implicit in chat history. Phase 0 completion must be idempotent -- safe to re-run without duplicating entities or corrupting state.

## Requirements Discussion

### First Round Questions

**Q1:** The existing pattern for phase="ready" tasks is: frontend detects phase="ready" in the structuredResponse, then calls POST /api/chat/v2/generate, then POST /api/chat/v2/save-artifact -- a 3-step frontend-driven flow. The discovery-framing task currently has `"artifacts": []`, meaning no artifact flow is wired. Should we follow this existing pattern by adding an artifacts entry to the task definition, adding a /generate branch, and adding a /save-artifact branch that orchestrates the three saves? Or should the gateway trigger persistence automatically server-side without the frontend generate/save-artifact flow?
**Answer:** Follow the existing frontend-driven pattern rather than introducing a new server-side completion model in this increment.

**Q2:** For persisting canonical anchor entities (applications and app_components): the existing save_architecture_baseline MCP tool and its service already handle GET-merge-PUT of applications and app_components into the architecture model. Should we reuse save_architecture_baseline with a minimal payload containing only the applications and app_components arrays, or create a new dedicated MCP tool for saving discovery anchor entities?
**Answer:** Reuse the existing architecture-baseline save path with a minimal payload rather than creating a new dedicated anchor-save tool.

**Q3:** The raw idea says the artifact type is `LEGACY_DISCOVERY_PHASE_0.MD` but Increment 2 defined `DISCOVERY_BRIEF_MD` as the artifact type in the archModelClient. Should we use `DISCOVERY_BRIEF_MD` or a different artifact type name?
**Answer:** Use `DISCOVERY_BRIEF_MD` as the artifact type for consistency; the filename/content can still represent the Phase 0 legacy discovery brief.

**Q4:** For the discovery brief markdown generation: should the brief be generated deterministically from the structured Phase 0 data (template-based markdown, no LLM call -- similar to the roadmap /generate branch), or via an LLM call that can add prose and analysis?
**Answer:** Generate the brief deterministically from the structured Phase 0 data in this increment; no extra LLM generation is needed here.

**Q5:** The discovery config save already exists from Increment 2 (save_discovery_config MCP tool). Currently it saves with status "DRAFT". When Phase 0 completes, should the status be "COMPLETE", "READY", "PHASE_0_COMPLETE", or something else?
**Answer:** Use "COMPLETE" for now; keep it simple unless the existing codebase strongly prefers a different established status style.

**Q6:** The /save-artifact endpoint currently handles a single MCP tool call per artifact type. Phase 0 completion requires three distinct save operations: anchor entities via architecture baseline, discovery config update, and discovery brief artifact creation. Should all three be orchestrated within a single /save-artifact call? If any save fails, should we attempt rollback or leave successful saves in place?
**Answer:** Do not attempt rollback in this increment; keep successful saves in place and surface failure clearly so completion can be retried safely.

**Q7:** For the handoff contract: Phase 1 needs to know what Phase 0 produced. Is the handoff implicit in the persisted data (Phase 1 reads discovery config with status=COMPLETE, reads anchor entities from the model, reads the DISCOVERY_BRIEF_MD artifact), or do we need an explicit handoff manifest?
**Answer:** Keep the handoff implicit in the persisted data for now; no separate handoff manifest is needed in this increment.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Frontend-driven generate/save-artifact flow - Path: `gateway/src/routes/chatV2.ts` (POST /generate handler at ~line 1070, POST /save-artifact handler at ~line 2048)
- Feature: Roadmap /generate branch (deterministic extraction, no LLM) - Path: `gateway/src/routes/chatV2.ts` (artifactType === 'roadmap' branch at ~line 1140)
- Feature: Architecture baseline save with GET-merge-PUT for applications/app_components - Path: `mcp-server/src/services/architectureBaselineService.ts` (buildEntities at ~line 851, mergeWithExisting at ~line 1394)
- Feature: save_architecture_baseline MCP tool and route - Path: `mcp-server/src/routes/saveArchitectureBaselineRoute.ts`
- Feature: save_discovery_config MCP tool, route, and service - Path: `mcp-server/src/routes/saveDiscoveryConfigRoute.ts`, `mcp-server/src/services/discoveryConfigService.ts`
- Feature: archModelClient methods for persistence - Path: `mcp-server/src/services/archModelClient.ts` (saveDiscoveryConfig at ~line 320, createProjectArtifact at ~line 370)
- Feature: Tool executor for MCP tool calls from gateway - Path: `gateway/src/services/toolExecutor.ts`
- Feature: Discovery framing task definition - Path: `gateway/src/config/tasks/architect--discovery-framing.json`
- Feature: Discovery framing prompt - Path: `gateway/src/config/prompts/architect.discovery-framing.task.md`
- Feature: Task artifact map and frontend phase="ready" detection - Path: `frontend/src/hooks/useChatThread.ts` (TASK_ARTIFACT_MAP, generateArtifact at ~line 385, phase detection at ~line 598)
- Feature: Frontend chatV2 API (postGenerateArtifact, postSaveArtifact) - Path: `frontend/src/api/chatV2Api.ts`
- Feature: Tech stack /save-artifact with JSON-to-markdown conversion pattern - Path: `gateway/src/routes/chatV2.ts` (artifactType === 'tech-stack' branch at ~line 2218)
- Feature: Discovery insights extraction at save-artifact time - Path: `gateway/src/services/discoveryInsightsService.ts`
- Feature: Completion chip persistence pattern - Path: `gateway/src/routes/chatV2.ts` (~line 2392)
- Feature: Product define task definition (example of artifacts[] entry) - Path: `gateway/src/config/tasks/product-manager--define-product.json`
- Feature: Architecture define task definition (example of artifacts[] entry) - Path: `gateway/src/config/tasks/architect--define-architecture.json`
- Feature: ProjectArtifactController backend - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectArtifactController.java`

### Follow-up Questions
No follow-up questions were needed. The user's answers were clear and decisive on all points.

## Visual Assets

### Files Provided:
No visual assets provided (confirmed via filesystem check).

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements

**FR-1: Task definition update -- wire artifacts for discovery-framing**
- Add an artifacts entry to `architect--discovery-framing.json` so the frontend recognizes it as an artifact-producing task
- The artifact entry should reference a new artifactId (e.g., "discovery-framing") with a tool reference and description
- This enables the existing frontend phase="ready" detection to trigger the generate/save-artifact flow

**FR-2: Frontend TASK_ARTIFACT_MAP entry**
- Add an entry in the frontend's TASK_ARTIFACT_MAP for `architect--discovery-framing` with the appropriate artifactName and previewType
- This connects the task to the frontend's generateArtifact and confirmArtifact flows

**FR-3: POST /generate branch for discovery-framing**
- Add a new branch in the /generate handler for the discovery-framing artifact type
- Deterministically extract the final structured data from the thread (applications, appComponents, repos, repoApplicationMappings, techHints, exclusions, notes) by scanning assistant messages for the last message with phase="ready"
- Generate a discovery brief markdown document from this structured data (template-based, no LLM call)
- Return the generated markdown as artifactContent so the frontend can display it in a preview
- Pattern: follow the roadmap /generate branch which also does thread extraction without an LLM call

**FR-4: Discovery brief markdown generation (deterministic)**
- Convert the structured Phase 0 data into a human-readable markdown document
- Content must include:
  - Summary of the discovery scope (from the summary field)
  - Confirmed anchor entities: applications with descriptions, app_components with parent application mapping
  - Repository scope: each repo with branch, include paths, exclude paths
  - Repo-to-application mappings
  - Technology and language hints per repo/path
  - Exclusion patterns with reasons
  - Assumptions and ambiguities (from notes array)
- This function should be a standalone, testable utility (similar to convertTechStackToMarkdown or convertTestStrategyToMarkdown in chatV2.ts)

**FR-5: POST /save-artifact branch for discovery-framing**
- Add a new branch in the /save-artifact handler for the discovery-framing artifact type
- Orchestrate three sequential save operations within this single /save-artifact call:
  1. **Save anchor entities**: Call save_architecture_baseline via executeToolCall with a minimal payload containing only the applications and app_components arrays (no services, interfaces, etc.). The existing GET-merge-PUT logic in architectureBaselineService handles deduplication.
  2. **Save discovery config**: Call save_discovery_config via executeToolCall with the full structured config JSON and status="COMPLETE". The existing discoveryConfigService handles upsert semantics (one config per project).
  3. **Save discovery brief artifact**: Call archModelClient.createProjectArtifact (or a new MCP tool) with artifactType="DISCOVERY_BRIEF_MD", the generated markdown content, and a source identifier.
- Execute saves sequentially; if any save fails, return failure with error details but do not roll back previously completed saves
- On full success, persist a completion chip to the thread (following existing pattern) and return success

**FR-6: Completion chip for discovery-framing**
- After all three saves succeed, persist a completion chip ThreadMessage to the thread
- The completion chip should have structuredResponse.type = 'completion-chip' with the appropriate artifactId, artifactName, taskId, and personaId
- Pattern: follow the existing completion chip logic in /save-artifact (~line 2392 of chatV2.ts)

**FR-7: Discovery config status update to COMPLETE**
- When Phase 0 completes, the structured discovery config must be saved with status="COMPLETE"
- The save_discovery_config MCP tool already accepts status from the parsed config
- The /save-artifact branch should set status="COMPLETE" in the config payload before calling the tool

**FR-8: Idempotent completion**
- Re-running Phase 0 completion must not create duplicate applications or app_components
- The architecture-baseline GET-merge-PUT already handles this by name-based deduplication
- The discovery config uses upsert semantics (one per project)
- The discovery brief artifact creates a new revision (which is acceptable -- ProjectArtifactController supports multiple revisions)
- No additional idempotency logic is needed beyond what the existing tools provide

**FR-9: Handoff contract for Phase 1**
- The handoff is implicit in persisted data; no separate manifest is needed
- Phase 1 can consume Phase 0 outputs by:
  - Reading discovery config via GET /api/model/projects/{projectId}/discovery/config (status=COMPLETE signals readiness)
  - Reading anchor entities (applications, app_components) from the architecture model
  - Reading the DISCOVERY_BRIEF_MD artifact via GET /api/model/projects/{projectId}/artifacts/DISCOVERY_BRIEF_MD/latest
- This increment must ensure all three persistence targets are correctly populated so Phase 1 (Increment 5) can rely on them

### Reusability Opportunities

- **Roadmap /generate branch** (chatV2.ts ~line 1140): Pattern for deterministic thread extraction without LLM call
- **Tech stack /save-artifact branch** (chatV2.ts ~line 2218): Pattern for JSON-to-markdown conversion before save
- **Architecture baseline save path** (architectureBaselineService.ts): Reuse directly for anchor entity persistence with minimal payload
- **save_discovery_config MCP tool** (Increment 2): Reuse directly for config persistence with status update
- **archModelClient.createProjectArtifact**: Reuse directly for brief artifact creation
- **convertTechStackToMarkdown / convertTestStrategyToMarkdown** (chatV2.ts): Pattern reference for the deterministic markdown generation function
- **Completion chip pattern** (chatV2.ts ~line 2392): Reuse directly for post-save thread annotation
- **Discovery insights extraction** (discoveryInsightsService.ts): Already runs non-blocking at save-artifact time; will automatically pick up discovery-framing Q&A pairs
- **Frontend TASK_ARTIFACT_MAP and useChatThread**: Existing wiring for phase detection, generateArtifact, confirmArtifact flows

### Scope Boundaries

**In Scope:**
- Update `architect--discovery-framing.json` task definition to include an artifacts[] entry
- Add frontend TASK_ARTIFACT_MAP entry for discovery-framing
- Add /generate branch: deterministic extraction of structured data from thread + markdown generation
- Add /save-artifact branch: orchestrate three sequential MCP saves (anchor entities, discovery config, discovery brief)
- Deterministic markdown brief generation function (standalone, testable)
- Completion chip persistence after successful saves
- Discovery config status update from DRAFT to COMPLETE
- Idempotent completion behavior (leveraging existing tool semantics)
- Implicit handoff contract via persisted data for Phase 1 consumption
- Unit tests for the markdown generation function
- Unit tests for the /generate and /save-artifact branches

**Out of Scope:**
- Phase 1 discovery execution
- Repo scanning or analysis
- Evidence schema or DecisionTask engine
- Frontend-specific workflow beyond existing chat interaction patterns (no new UI components, no new screens)
- Refinement/review UX
- Log-based discovery
- Hypothesis-first discovery
- Analyzer packs or AST functionality
- Transaction rollback across MCP saves
- Explicit handoff manifest or separate handoff data structure
- New MCP tools for anchor entity saving (reuse existing architecture-baseline path)
- LLM-based brief generation (deterministic only in this increment)
- Frontend preview component for the discovery brief (use existing artifact-preview or markdown-preview if available)
- Changes to the architecture-model-service Java backend (all persistence contracts already exist from Increment 2)

### Technical Considerations

- **Three-save orchestration**: The /save-artifact branch must execute three MCP tool calls sequentially. Each call is independent -- failure of one does not require rollback of the others. Error messages should indicate which save failed.
- **Minimal architecture baseline payload**: When calling save_architecture_baseline for anchor entities, the payload should contain only applications and app_components arrays. The existing architectureBaselineService's buildEntities function creates a placeholder application and appComponent -- the discovery framing produces multiple applications and app_components, so the payload structure may need to match the ArchitectureBaselineInput format or be adapted. Research the exact input shape expected by the service.
- **Thread data extraction**: The /generate branch must scan thread messages backwards to find the last assistant message with phase="ready" and extract the accumulating data fields (applications, appComponents, repos, repoApplicationMappings, techHints, exclusions, notes). These are in the structuredResponse of the assistant message.
- **Status injection**: Before calling save_discovery_config, the /save-artifact branch should inject or override `status: "COMPLETE"` in the config payload JSON.
- **Artifact creation via MCP boundary**: The raw idea requires all writes to go through MCP controlled write operations. The brief artifact creation uses archModelClient.createProjectArtifact which is within the MCP server. This may need to be routed through an MCP tool endpoint (either the existing save_markdown_artifact or a dedicated call through the MCP boundary). Evaluate whether the existing save_markdown_artifact tool (which writes to filesystem at agent-os/product/) is appropriate, or whether createProjectArtifact (which writes to the database) is the correct path. The DISCOVERY_BRIEF_MD artifact type defined in Increment 2 uses the database-backed ProjectArtifact table, so createProjectArtifact is likely the correct method.
- **Frontend preview type**: Determine the appropriate previewType for the discovery brief in TASK_ARTIFACT_MAP. Since the content is markdown, 'artifact-preview' (which sets structuredResponse.type = 'artifact-preview' with markdownContent) is the natural choice.
- **Existing discovery insights extraction**: The discoveryInsightsService.ts already runs non-blocking after save-artifact completion. It extracts Q&A pairs from structured conversations. This will automatically work for discovery-framing since it already has the questions/answer pattern. No additional work needed.
- **Project folder resolution**: The /save-artifact handler already calls fetchProjectFolder(projectId) to resolve the project's filesystem path. This is used by save_markdown_artifact but may not be needed for the database-backed artifact creation path.
- **Tool definitions**: If a new MCP tool is needed for the brief artifact (to maintain the controlled write boundary through toolExecutor), it would need entries in TOOL_ENDPOINTS, TOOL_REQUIRED_PARAMS, ALLOWED_TOOL_NAMES, and TOOL_DEFINITIONS in the gateway types. Evaluate whether the existing tools are sufficient or if a thin wrapper is needed.
