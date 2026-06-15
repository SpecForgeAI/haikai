# Task Breakdown: Phase 0 Completion and Handoff

## Overview
Total Tasks: 43 (across 6 task groups)

This is Increment 4 of 16 -- wiring up the completion and persistence flow for the Phase 0 discovery framing conversation. When the conversation reaches phase="ready", the system deterministically extracts structured data, generates a discovery brief markdown, and orchestrates three sequential saves: anchor entities, discovery config (status=COMPLETE), and a DISCOVERY_BRIEF_MD artifact.

## Task List

### MCP Server Layer

#### Task Group 1: New MCP Tools (save_project_anchor_entities, create_project_artifact)
**Dependencies:** None

These two new MCP tools provide the controlled write boundary for anchor entity persistence and project artifact creation. They must exist before the gateway /save-artifact branch can call them via executeToolCall.

- [x] 1.0 Complete MCP tool: save_project_anchor_entities
  - [x] 1.1 Write 4 focused tests for the anchor entities service logic
    - Test 1: Given applications and appComponents arrays, verify entities are built with generated IDs matching `app-` and `comp-` prefixes via `generateId`
    - Test 2: Given an existing model with an application named "MyApp", verify that submitting applications with the same name skips the duplicate (name-based deduplication)
    - Test 3: Given an empty/null existing model (GET returns 404), verify an empty model shell is created and entities are merged into it
    - Test 4: Given valid input, verify the service calls `archModelClient.getProjectById`, `archModelClient.getModel`, and `archModelClient.putModel` in sequence
  - [x] 1.2 Create anchor entities service `mcp-server/src/services/anchorEntitiesService.ts`
    - Export function `saveProjectAnchorEntities(projectId: string, applications: Array<{name: string, description: string}>, appComponents: Array<{name: string, applicationName: string, description: string}>): Promise<{projectId: string, applicationsCreated: number, appComponentsCreated: number}>`
    - Reuse `archModelClient.getProjectById(projectId)` to validate project exists and derive filename from `project.name`
    - Call `archModelClient.getModel(filename)` to GET the existing model; if null, create empty model shell (follow `createEmptyModelShell` pattern from `architectureBaselineService.ts` line 1402)
    - For each application: check `model.metaModel.entities.applications` for existing entry with same `name`; if not found, push new entity with `id: generateId('app-')`, name, description, and null/empty fields matching the schema from `buildEntities` (line 860)
    - For each appComponent: resolve parent application ID by matching `applicationName` against the (now-merged) applications array; check `model.metaModel.entities.app_components` for existing entry with same `name`; if not found, push new entity with `id: generateId('comp-')`, name, description, `application_id`, and null/empty fields matching schema (line 875)
    - Call `archModelClient.putModel(filename, model)` to persist
    - Import `generateId` from `../utils/generateId`
  - [x] 1.3 Create route `mcp-server/src/routes/saveProjectAnchorEntitiesRoute.ts`
    - Follow the exact pattern from `saveDiscoveryConfigRoute.ts` and `saveArchitectureBaselineRoute.ts`
    - Export `saveProjectAnchorEntitiesRouter` as an Express Router
    - POST `/` handler: validate `sessionId` (non-empty string), `projectId` (UUID v4 regex), `applications` (required array), `appComponents` (required array)
    - Call `getOrCreateSession(sessionId)` for session management
    - Delegate to `saveProjectAnchorEntities(projectId, applications, appComponents)`
    - Return `{ projectId, applicationsCreated, appComponentsCreated }` on success
    - Handle 400 and 502 errors following the existing route pattern
  - [x] 1.4 Mount route in `mcp-server/src/routes/tools.ts`
    - Import `saveProjectAnchorEntitiesRouter` from `./saveProjectAnchorEntitiesRoute`
    - Add `toolsRouter.use('/save_project_anchor_entities', saveProjectAnchorEntitiesRouter);`
  - [x] 1.5 Run anchor entities tests only
    - Run ONLY the 4 tests written in 1.1
    - Verify the service logic and route compile and function correctly

- [x] 1.6 Complete MCP tool: create_project_artifact
  - [x] 1.7 Write 2 focused tests for the create_project_artifact route
    - Test 1: Given valid `{ sessionId, projectId, artifactType, content, source }`, verify `archModelClient.createProjectArtifact` is called with `(projectId, artifactType, content, source)` and the response is forwarded
    - Test 2: Given missing `artifactType`, verify 400 error is returned
  - [x] 1.8 Create route `mcp-server/src/routes/createProjectArtifactRoute.ts`
    - Follow the same Express Router pattern as `saveDiscoveryConfigRoute.ts`
    - Export `createProjectArtifactRouter`
    - POST `/` handler: validate `sessionId`, `projectId` (UUID v4), `artifactType` (non-empty string), `content` (non-empty string), `source` (non-empty string)
    - Call `getOrCreateSession(sessionId)`
    - Delegate to `archModelClient.createProjectArtifact(projectId, artifactType, content, source)` -- the method already exists at `archModelClient.ts` line 370
    - Return the response from the archModelClient
    - Handle 400/502 errors
  - [x] 1.9 Mount route in `mcp-server/src/routes/tools.ts`
    - Import `createProjectArtifactRouter` from `./createProjectArtifactRoute`
    - Add `toolsRouter.use('/create_project_artifact', createProjectArtifactRouter);`
  - [x] 1.10 Run create_project_artifact tests only
    - Run ONLY the 2 tests written in 1.7
    - Verify route compiles and functions correctly

**Acceptance Criteria:**
- The 6 tests from 1.1 and 1.7 pass
- `save_project_anchor_entities` performs GET-merge-PUT with name-based deduplication
- `create_project_artifact` delegates to `archModelClient.createProjectArtifact`
- Both routes are mounted in `mcp-server/src/routes/tools.ts`
- Both routes follow the existing MCP route validation patterns (sessionId, projectId, 400/502 error handling)

---

### Gateway Tool Registration Layer

#### Task Group 2: Gateway Tool Registration for New MCP Tools
**Dependencies:** Task Group 1

Register both new MCP tools in the gateway's tool type system and executor so that `executeToolCall` can route to them.

- [x] 2.0 Complete gateway tool registration
  - [x] 2.1 Write 2 focused tests for tool registration
    - Test 1: Verify `isToolAllowed('save_project_anchor_entities')` returns true
    - Test 2: Verify `isToolAllowed('create_project_artifact')` returns true
  - [x] 2.2 Update `gateway/src/types/tools.ts`
    - Add `'save_project_anchor_entities'` and `'create_project_artifact'` to the `ToolName` union type
    - Add both to the `ALLOWED_TOOL_NAMES` array
    - Add `SaveProjectAnchorEntitiesParams` interface: `{ projectId: string; applications: Array<{name: string, description: string}>; appComponents: Array<{name: string, applicationName: string, description: string}> }`
    - Add `CreateProjectArtifactParams` interface: `{ projectId: string; artifactType: string; content: string; source: string }`
    - Add both to the `ToolParams` union
    - Add both to `TOOL_DEFINITIONS` array with appropriate OpenAI function definitions (name, description, parameters with required fields)
  - [x] 2.3 Update `gateway/src/services/toolExecutor.ts`
    - Add `save_project_anchor_entities: '/mcp/tools/save_project_anchor_entities'` to `TOOL_ENDPOINTS`
    - Add `create_project_artifact: '/mcp/tools/create_project_artifact'` to `TOOL_ENDPOINTS`
    - Add `save_project_anchor_entities: ['projectId', 'applications', 'appComponents']` to `TOOL_REQUIRED_PARAMS`
    - Add `create_project_artifact: ['projectId', 'artifactType', 'content', 'source']` to `TOOL_REQUIRED_PARAMS`
    - Add imports for the new param types
  - [x] 2.4 Run tool registration tests only
    - Run ONLY the 2 tests written in 2.1
    - Verify tools are recognized and routable

**Acceptance Criteria:**
- The 2 tests from 2.1 pass
- Both new tool names are in `ToolName`, `ALLOWED_TOOL_NAMES`, `TOOL_ENDPOINTS`, `TOOL_REQUIRED_PARAMS`, and `TOOL_DEFINITIONS`
- `executeToolCall` can route calls to both new tools without errors

---

### Gateway /generate and /save-artifact Layer

#### Task Group 3: chatV2.ts /generate Branch (Deterministic Extraction + Brief Generation)
**Dependencies:** None (this is pure logic, no dependency on MCP tools)

Add the deterministic extraction branch and the markdown generation function to chatV2.ts. This group handles the /generate endpoint behavior when `artifactType === 'discovery-framing'`.

- [x] 3.0 Complete /generate branch and markdown generation
  - [x] 3.1 Write 5 focused tests for the /generate branch and markdown generation
    - Test 1: `convertDiscoveryBriefToMarkdown` with full data (all arrays populated) produces markdown with all sections: heading, summary, applications table, app components table, repositories table, repo-app mappings table, tech hints table, exclusions table, notes list
    - Test 2: `convertDiscoveryBriefToMarkdown` with empty arrays omits corresponding sections
    - Test 3: `convertDiscoveryBriefToMarkdown` with partial data (only applications and repos) produces only those sections
    - Test 4: /generate with `artifactType === 'discovery-framing'` returns `{ success: true, artifactContent }` where artifactContent is a JSON string containing `{ structuredData, markdownBrief }`
    - Test 5: /generate with `artifactType === 'discovery-framing'` and no phase="ready" message in thread returns `{ success: false, error: "..." }`
  - [x] 3.2 Create `convertDiscoveryBriefToMarkdown` function in `gateway/src/routes/chatV2.ts`
    - Co-locate with `convertTechStackToMarkdown` (line 465) and `convertTestStrategyToMarkdown` (line 506)
    - Export the function
    - Input: `data: { summary?: string; applications?: Array<{name: string, description: string}>; appComponents?: Array<{name: string, applicationName: string, description: string}>; repos?: Array<{url: string, branch?: string, includePaths?: string[], excludePaths?: string[]}>; repoApplicationMappings?: Array<{repoUrl: string, path: string, applicationName: string}>; techHints?: Array<{repoUrl: string, path: string, technology: string, language: string}>; exclusions?: Array<{pattern: string, reason: string}>; notes?: string[] }`
    - Output: markdown string
    - Sections (each omitted if corresponding array is empty/missing):
      - `# Discovery Brief` heading
      - `## Scope Summary` paragraph from `summary`
      - `## Applications` table: | Name | Description |
      - `## Application Components` table: | Name | Application | Description |
      - `## Repositories` table: | URL | Branch | Include Paths | Exclude Paths |
      - `## Repository-Application Mappings` table: | Repo URL | Path | Application |
      - `## Technology Hints` table: | Repo URL | Path | Technology | Language |
      - `## Exclusions` table: | Pattern | Reason |
      - `## Notes and Assumptions` bulleted list
    - Follow the `lines: string[]` array pattern: push headers and table rows, join with `\n`
  - [x] 3.3 Add /generate branch for `artifactType === 'discovery-framing'` in chatV2.ts
    - Insert after the roadmap branch (around line 1175, after `return;` of the roadmap branch)
    - Pattern: `if (artifactType === 'discovery-framing') { ... }`
    - Scan thread messages backwards: `for (let i = thread.messages.length - 1; i >= 0; i--)` for the last assistant message
    - Parse message content as JSON; look for `structuredResponse?.phase === 'ready'` or parsed content having `phase === 'ready'`
    - Extract: `applications`, `appComponents`, `repos`, `repoApplicationMappings`, `techHints`, `exclusions`, `notes`, `summary` from the parsed structuredResponse
    - If no phase="ready" message found, return `res.json({ success: false, error: 'No completed discovery framing found in conversation history. Please complete the final review first.' })`
    - Call `convertDiscoveryBriefToMarkdown(structuredData)` to generate the markdown brief
    - Build combined payload: `JSON.stringify({ structuredData, markdownBrief })`
    - Return `res.json({ success: true, artifactContent: combinedPayload })`
    - Log success with requestId and threadKey
  - [x] 3.4 Run /generate branch tests only
    - Run ONLY the 5 tests written in 3.1
    - Verify both the markdown function and the /generate branch work correctly

**Acceptance Criteria:**
- The 5 tests from 3.1 pass
- `convertDiscoveryBriefToMarkdown` produces correct markdown for all section types
- Empty arrays are omitted from the output
- The /generate branch returns combined JSON payload (structuredData + markdownBrief)
- No LLM call is made -- fully deterministic

---

#### Task Group 4: chatV2.ts /save-artifact Branch (Three Sequential Saves)
**Dependencies:** Task Groups 1, 2, 3

Add the /save-artifact branch that orchestrates three sequential MCP tool calls and persists a completion chip.

- [x] 4.0 Complete /save-artifact branch for discovery-framing
  - [x] 4.1 Write 5 focused tests for the /save-artifact branch
    - Test 1: Successful flow -- mock all three `executeToolCall` calls to succeed; verify all three are called in order with correct params: (1) `save_project_anchor_entities` with `{ projectId, applications, appComponents }`, (2) `save_discovery_config` with `{ projectId, discoveryConfigJson }` where status is "COMPLETE", (3) `create_project_artifact` with `{ projectId, artifactType: "DISCOVERY_BRIEF_MD", content: markdownBrief, source: "discovery-framing" }`; verify response is `{ success: true }`
    - Test 2: Save 1 (anchor entities) fails -- verify response is `{ success: false, error }` with error message mentioning "anchor entities"; verify saves 2 and 3 are NOT called
    - Test 3: Save 2 (discovery config) fails -- verify response is `{ success: false, error }` with error message mentioning "discovery config"; verify save 1 was called but save 3 is NOT called
    - Test 4: Save 3 (discovery brief artifact) fails -- verify response is `{ success: false, error }` with error message mentioning "discovery brief artifact"; verify saves 1 and 2 were called
    - Test 5: Verify status="COMPLETE" is injected into the structured data before calling save_discovery_config
  - [x] 4.2 Add /save-artifact branch in chatV2.ts for `artifactType === 'discovery-framing'`
    - Insert before the else/mission fallback (around line 2326, after the backlog branch)
    - Pattern: `else if (artifactType === 'discovery-framing') { ... }`
    - Parse `content` from request body as JSON to recover `{ structuredData, markdownBrief }`
    - **Save 1 -- Anchor entities**: Call `executeToolCall(uuidv4(), 'save_project_anchor_entities', { projectId, applications: structuredData.applications || [], appComponents: structuredData.appComponents || [] }, mcpSessionId, requestId, 'v2-save-' + threadKeyStr)`
    - If save 1 has `.error`, return `res.json({ success: false, error: 'Save failed (anchor entities): ' + toolResult1.error })` and return early
    - **Save 2 -- Discovery config**: Inject `status: "COMPLETE"` into structuredData, then call `executeToolCall(uuidv4(), 'save_discovery_config', { projectId, discoveryConfigJson: JSON.stringify({ ...structuredData, status: 'COMPLETE' }) }, mcpSessionId, requestId, 'v2-save-' + threadKeyStr)`
    - If save 2 has `.error`, return `res.json({ success: false, error: 'Save failed (discovery config): ' + toolResult2.error })` and return early
    - **Save 3 -- Discovery brief artifact**: Call `executeToolCall(uuidv4(), 'create_project_artifact', { projectId, artifactType: 'DISCOVERY_BRIEF_MD', content: markdownBrief, source: 'discovery-framing' }, mcpSessionId, requestId, 'v2-save-' + threadKeyStr)`
    - If save 3 has `.error`, return `res.json({ success: false, error: 'Save failed (discovery brief artifact): ' + toolResult3.error })` and return early
    - Set `completionContent = 'Discovery Framing complete.'`
    - Set `completionArtifactId = 'discovery-framing'`
    - Set `completionArtifactName = 'DISCOVERY_BRIEF'`
    - Fall through to the existing completion chip logic (line 2362+) which handles `toolResult.error` check, completion chip build, `appendMessage`, discovery insights extraction, and `res.json({ success: true })`
  - [x] 4.3 Handle the toolResult variable for the completion chip flow
    - The existing code after the if/else-if branches checks `toolResult.error` at line 2362. Since the discovery-framing branch handles its own errors and returns early, set `toolResult` to the result of the last successful save (save 3) so the existing error check passes through cleanly
  - [x] 4.4 Run /save-artifact branch tests only
    - Run ONLY the 5 tests written in 4.1
    - Verify the three-save orchestration, error handling, and completion chip

**Acceptance Criteria:**
- The 5 tests from 4.1 pass
- Three sequential saves execute in order: anchor entities, discovery config, discovery brief artifact
- If any save fails, subsequent saves do not execute and a clear error is returned identifying which save failed
- Previously completed saves are NOT rolled back on failure
- On full success, `completionContent`, `completionArtifactId`, `completionArtifactName` are set correctly for the completion chip
- status="COMPLETE" is injected into discovery config before save

---

### Task Definition and Frontend Layer

#### Task Group 5: Task Definition Update + Frontend TASK_ARTIFACT_MAP
**Dependencies:** None (these are configuration/wiring changes)

Wire the task definition and frontend so that phase="ready" detection triggers the generate/save-artifact flow.

- [x] 5.0 Complete task definition and frontend wiring
  - [x] 5.1 Write 2 focused tests for configuration correctness
    - Test 1: Verify `architect--discovery-framing.json` has a non-empty `artifacts` array with `artifactId: "discovery-framing"` (can be a JSON parse + assertion test)
    - Test 2: Verify `TASK_ARTIFACT_MAP['architect--discovery-framing']` has the expected shape: `{ artifactId: 'discovery-framing', artifactName: 'DISCOVERY_BRIEF', artifactKey: 'discoveryBrief', previewType: 'artifact-preview' }`
  - [x] 5.2 Update task definition `gateway/src/config/tasks/architect--discovery-framing.json`
    - Change `"artifacts": []` to:
      ```json
      "artifacts": [
        {
          "artifactId": "discovery-framing",
          "filename": "DISCOVERY_BRIEF",
          "tool": "save_discovery_config",
          "description": "Discovery brief with confirmed scope, anchor entities, repos, and config"
        }
      ]
      ```
    - This causes `artifactType` to resolve to `"discovery-framing"` in the /generate and /save-artifact handlers via `taskDef.artifacts[0].artifactId`
  - [x] 5.3 Add TASK_ARTIFACT_MAP entry in `frontend/src/hooks/useChatThread.ts`
    - Add after the last entry (currently `product-manager--backlog` at line 164):
      ```typescript
      'architect--discovery-framing': {
        artifactId: 'discovery-framing',
        artifactName: 'DISCOVERY_BRIEF',
        artifactKey: 'discoveryBrief',
        completionMessage: 'Discovery Framing complete.',
        warningText: 'A Discovery Brief already exists. Completing this conversation will create a new revision.',
        previewType: 'artifact-preview',
      },
      ```
    - `previewType: 'artifact-preview'` renders with `{ type: 'artifact-preview', markdownContent }` -- no new preview component needed since the brief is markdown
    - The existing phase="ready" detection at line 609 will auto-trigger `generateArtifact` when the user confirms the final review
    - The existing `else` branch at line 448 in `generateArtifact` handles `artifact-preview` type: `structuredResponse = { type: 'artifact-preview', markdownContent: artifactContent }`
  - [x] 5.4 Run configuration tests only
    - Run ONLY the 2 tests written in 5.1
    - Verify task definition and frontend map are correctly wired

**Acceptance Criteria:**
- The 2 tests from 5.1 pass
- Task definition has `artifacts[0].artifactId === "discovery-framing"`
- Frontend TASK_ARTIFACT_MAP has the correct entry for `architect--discovery-framing`
- The `previewType` is `artifact-preview` (reuses existing markdown rendering, no new component)
- The `artifactKey` is `discoveryBrief` for artifact existence tracking

---

### Testing Layer

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 6 tests written by MCP engineer (Task Groups 1: tests 1.1 + 1.7)
    - Review the 2 tests written by gateway tool registration (Task Group 2: test 2.1)
    - Review the 5 tests written by /generate branch (Task Group 3: test 3.1)
    - Review the 5 tests written by /save-artifact branch (Task Group 4: test 4.1)
    - Review the 2 tests written by config/frontend wiring (Task Group 5: test 5.1)
    - Total existing tests: approximately 20 tests
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to Phase 0 completion and handoff
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end integration workflows over unit test gaps
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Potential gap areas to consider:
      - Idempotency: Re-running /save-artifact for discovery-framing does not duplicate anchor entities (integration-level test of the dedup logic with a pre-populated model)
      - End-to-end /generate -> /save-artifact flow: Full request/response cycle with mocked executeToolCall verifying the content flows correctly from extraction to save
      - Edge case: Thread with multiple assistant messages, only the LAST one has phase="ready" -- verify only the last is used
      - Edge case: structuredData has applications but empty appComponents -- verify save 1 still succeeds
      - convertDiscoveryBriefToMarkdown with special characters in names/descriptions (pipe characters in table cells)
      - Discovery config status injection: Verify the original structuredData is not mutated (spread operator used)
      - Completion chip: Verify completionChip message has `structuredResponse.type === 'completion-chip'` with `artifactId: 'discovery-framing'` and `artifactName: 'DISCOVERY_BRIEF'`
    - Do NOT write comprehensive coverage for all scenarios
    - Skip performance tests and accessibility tests
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 1.7, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 20-30 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-30 tests total)
- Critical user workflows for Phase 0 completion are covered
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements
- Idempotent completion behavior is verified through at least one test

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: MCP Tools** -- Build the two new MCP tools first since they are the lowest-level persistence components. No dependencies on other task groups.
2. **Task Group 2: Gateway Tool Registration** -- Register the new tools in the gateway so executeToolCall can route to them. Depends on Task Group 1.
3. **Task Group 3: /generate Branch + Markdown Function** -- Can be done in parallel with Task Groups 1-2 since the /generate branch has no MCP tool dependency (pure thread extraction + markdown generation). Placing it here ensures the markdown function exists before /save-artifact needs it.
4. **Task Group 5: Task Definition + Frontend Wiring** -- Can be done in parallel with Task Groups 1-3 since these are configuration changes. Placing it before Task Group 4 means the full generate/save-artifact flow can be tested end-to-end once /save-artifact is wired.
5. **Task Group 4: /save-artifact Branch** -- Depends on Task Groups 1, 2, and 3 (needs the MCP tools registered, needs the structuredData/markdownBrief format from /generate).
6. **Task Group 6: Test Review and Gap Analysis** -- Final pass after all implementation is complete.

Parallelization opportunities:
- Task Groups 1 and 3 can proceed in parallel (MCP tools + /generate branch)
- Task Group 5 can proceed in parallel with Task Groups 1, 2, and 3 (config changes)
- Task Groups 2 and 4 must follow their dependencies sequentially

## Key Files Modified

| File | Task Group | Change Type |
|------|-----------|-------------|
| `mcp-server/src/services/anchorEntitiesService.ts` | 1 | New file |
| `mcp-server/src/routes/saveProjectAnchorEntitiesRoute.ts` | 1 | New file |
| `mcp-server/src/routes/createProjectArtifactRoute.ts` | 1 | New file |
| `mcp-server/src/routes/tools.ts` | 1 | Mount 2 new routes |
| `gateway/src/types/tools.ts` | 2 | Add 2 tool names, params, definitions |
| `gateway/src/services/toolExecutor.ts` | 2 | Add 2 endpoint + required params entries |
| `gateway/src/routes/chatV2.ts` | 3, 4 | Add convertDiscoveryBriefToMarkdown, /generate branch, /save-artifact branch |
| `gateway/src/config/tasks/architect--discovery-framing.json` | 5 | Add artifacts entry |
| `frontend/src/hooks/useChatThread.ts` | 5 | Add TASK_ARTIFACT_MAP entry |
