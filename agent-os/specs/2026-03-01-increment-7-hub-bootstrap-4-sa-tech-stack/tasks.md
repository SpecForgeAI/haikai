# Task Breakdown: Increment 7 -- SA Tech Stack + TE Test Strategy End-to-End

## Overview
Total Task Groups: 7
Total Sub-Tasks: ~95
Covers Requirements: R1-R15 from spec.md

This increment wires two bootstrap conversations through the hub conversation engine:
1. Solution Architect "Define Tech Stack" (4th bootstrap)
2. Test Engineer "Define Test Strategy" (5th bootstrap)

Includes task definitions, discovery prompts, context injection, JSON-mode generation with corrective retry, a new generic `save_markdown_artifact` MCP tool, two preview bubble components, MessageBubble type guards, TASK_ARTIFACT_MAP entries, dashboard exists/not-exists checks, and transcript download extensions.

## Execution Order

```
TG1 (task defs + prompts) ----+
                               +--> TG3 (backend endpoints)
TG2 (MCP save tool) ----------+            |
                                           +---> TG4 (backend dashboard)
                                           |
                                           +---> TG5 (frontend components)
                                                         |
                                                         v
                                                   TG6 (frontend integration wiring)
                                                         |
                                                         v
                                                   TG7 (test review & gap analysis)
```

- TG1 and TG2 can run in parallel (no file conflicts).
- TG4 and TG5 can run in parallel after TG3 (gateway vs frontend files).
- TG6 depends on TG4 + TG5.
- TG7 depends on all prior groups.

---

## Task List

### Task Group 1: Task Definitions + Discovery Prompts (R1, R2, R3)

**Dependencies:** None
**Parallelizable with:** TG2
**Scope:** Create the new SA tech-stack task definition, upgrade the existing TE test-strategy task definition in-place, and write both multi-section discovery prompts.

- [x] 1.0 Complete task definitions and discovery prompts
  - [x] 1.1 Write 4-6 focused tests for task definition validation
    - Test 1: `architect--define-tech-stack.json` parses as valid JSON and contains an `artifacts` array with an entry where `artifactId === 'tech-stack'`
    - Test 2: `architect--define-tech-stack.json` artifact entry has expected shape: `{ artifactId: 'tech-stack', filename: 'TECH-STACK.MD', tool: 'save_markdown_artifact', description: string }`; verify `mode: 'discovery'`, `persistence: 'hub'`, `availableFrom: ['hub']`, `contextNeeds: ['mission', 'architecture-baseline']`
    - Test 3: `architect--define-tech-stack.json` has `responseFormat` with `required: ['phase', 'section', 'questions', 'summary']` and section enum includes at least `current_landscape`, `frontend_tech`, `backend_tech`, `data_storage`, `final_review`
    - Test 4: `test-engineer--test-strategy.json` has been upgraded: `responseFormat` is non-null with `required: ['phase', 'section', 'questions', 'summary']`, `contextNeeds: ['mission', 'roadmap', 'tech-stack']`, and `artifacts` array with `artifactId === 'test-strategy'`
    - Test 5: `test-engineer--test-strategy.json` retains original fields unchanged: `id === 'test-engineer--test-strategy'`, `personaId === 'test-engineer'`, `mode === 'discovery'`, `persistence === 'hub'`
    - Test 6: `architect--tech-standards.json` is NOT modified (unchanged from before this increment)
    - Follow test file naming pattern: `gateway/src/__tests__/hub-bootstrap-4-task-definition.test.ts`
    - Follow pattern from: `gateway/src/__tests__/hub-bootstrap-3-task-definition.test.ts`
  - [x] 1.2 Create task definition `gateway/src/config/tasks/architect--define-tech-stack.json`
    - Set `id: 'architect--define-tech-stack'`
    - Set `personaId: 'architect'`
    - Set `menuLabel: 'Define Tech Stack'`
    - Set `description`: meaningful description of the tech stack discovery conversation
    - Set `mode: 'discovery'`
    - Set `persistence: 'hub'`
    - Set `availableFrom: ['hub']`
    - Set `taskPromptRef: 'prompts/architect.define-tech-stack.task.md'`
    - Set `responseFormat` with type/required/properties matching the architecture task pattern; section enum values: `current_landscape`, `frontend_tech`, `backend_tech`, `data_storage`, `infrastructure`, `dev_tooling`, `design_decisions`, `constraints_review`, `final_review`
    - Set `contextNeeds: ['mission', 'architecture-baseline']`
    - Set `artifacts: [{ artifactId: 'tech-stack', filename: 'TECH-STACK.MD', tool: 'save_markdown_artifact', description: 'Technology stack definition' }]`
    - Set `phases: null`
    - Follow pattern from: `gateway/src/config/tasks/architect--define-architecture.json`
    - Do NOT modify `architect--tech-standards.json`
  - [x] 1.3 Upgrade task definition `gateway/src/config/tasks/test-engineer--test-strategy.json` in-place
    - Keep existing fields: `id: 'test-engineer--test-strategy'`, `personaId`, `menuLabel`, `description`, `mode`, `persistence`, `availableFrom`, `taskPromptRef`
    - Add `responseFormat` with type/required/properties matching the architecture task pattern; section enum values: `project_context`, `test_levels`, `coverage_targets`, `tooling`, `quality_gates`, `testing_principles`, `strategy_review`, `final_review`
    - Set `contextNeeds: ['mission', 'roadmap', 'tech-stack']`
    - Set `artifacts: [{ artifactId: 'test-strategy', filename: 'TEST-STRATEGY.MD', tool: 'save_markdown_artifact', description: 'Test strategy definition' }]`
    - Keep `phases: null`
  - [x] 1.4 Create discovery prompt `gateway/src/config/prompts/architect.define-tech-stack.task.md`
    - Write a detailed multi-section discovery prompt guiding the SA through tech stack definition
    - Reference the section enum values from R1 (`current_landscape`, `frontend_tech`, `backend_tech`, `data_storage`, `infrastructure`, `dev_tooling`, `design_decisions`, `constraints_review`, `final_review`)
    - Instruct the LLM to use the structured responseFormat (phase/section/questions/summary JSON)
    - Instruct the LLM to signal `phase: 'ready'` when sufficient information has been gathered
    - Include guidance on tech stack categories, technology choices, version constraints, design decisions, and project constraints
  - [x] 1.5 Replace discovery prompt stub in `gateway/src/config/prompts/test-engineer.test-strategy.task.md`
    - Replace the existing one-line stub with a detailed multi-section discovery prompt
    - Reference the section enum values from R2 (`project_context`, `test_levels`, `coverage_targets`, `tooling`, `quality_gates`, `testing_principles`, `strategy_review`, `final_review`)
    - Instruct the LLM to use the structured responseFormat (phase/section/questions/summary JSON)
    - Instruct the LLM to signal `phase: 'ready'` when sufficient information has been gathered
    - Include guidance on test levels, coverage targets, tooling choices, quality gates, and testing principles
  - [x] 1.6 Ensure task definition tests pass
    - Run ONLY the tests written in 1.1: `npx jest hub-bootstrap-4-task-definition --no-coverage`
    - Verify all 4-6 tests pass
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- All 4-6 task definition tests pass
- `architect--define-tech-stack.json` exists with correct structure, mode, persistence, artifacts, contextNeeds, and responseFormat
- `test-engineer--test-strategy.json` upgraded in-place with responseFormat, contextNeeds, and artifacts while retaining original id/mode/persistence
- `architect--tech-standards.json` is unchanged
- Both discovery prompts are detailed, multi-section, reference section enums, and instruct the LLM to use structured JSON responses with `phase: 'ready'` signaling

**Files Created/Modified:**
- `gateway/src/config/tasks/architect--define-tech-stack.json` (NEW)
- `gateway/src/config/tasks/test-engineer--test-strategy.json` (MODIFIED)
- `gateway/src/config/prompts/architect.define-tech-stack.task.md` (NEW)
- `gateway/src/config/prompts/test-engineer.test-strategy.task.md` (MODIFIED)
- `gateway/src/__tests__/hub-bootstrap-4-task-definition.test.ts` (NEW)

---

### Task Group 2: New Generic save_markdown_artifact MCP Tool (R8)

**Dependencies:** None
**Parallelizable with:** TG1
**Scope:** Create the MCP route, register it in the MCP tools router, and add gateway-side tool type definitions and executor mappings.

- [x] 2.0 Complete save_markdown_artifact MCP tool end-to-end
  - [x] 2.1 Write 5 focused tests for MCP save tool
    - Test 1: `save_markdown_artifact` tool is present in `ToolName` union, `ALLOWED_TOOL_NAMES`, and `TOOL_DEFINITIONS`; verify `TOOL_DEFINITIONS` entry has correct name, description, and required params `['projectId', 'artifactFilename', 'markdown']`
    - Test 2: `toolExecutor.ts` has `save_markdown_artifact` in `TOOL_ENDPOINTS` pointing to `/mcp/tools/save_markdown_artifact` and `TOOL_REQUIRED_PARAMS` with `['projectId', 'artifactFilename', 'markdown']`
    - Test 3: MCP route validates input: rejects missing `projectId`, invalid UUID, empty `markdown`, missing `artifactFilename`; rejects unsafe filenames containing `..`, `/`, or `\`; rejects filenames not ending in `.MD` or `.md`
    - Test 4: MCP route accepts valid input and writes file atomically to `<basePath>/agent-os/product/<artifactFilename>` using mkdir + tmp + rename pattern
    - Test 5: MCP route rejects markdown exceeding 200KB byte limit
    - Gateway tests go in: `gateway/src/__tests__/hub-bootstrap-4-mcp-tool.test.ts`
    - MCP tests go in: `mcp-server/src/__tests__/saveMarkdownArtifactRoute.test.ts`
    - Follow pattern from: `mcp-server/src/__tests__/saveProductArtifactsRoute.test.ts`
  - [x] 2.2 Create MCP route `mcp-server/src/routes/saveMarkdownArtifactRoute.ts`
    - Export `saveMarkdownArtifactRouter = Router()`
    - POST `/` handler
    - Params: `{ sessionId: string, projectId: string, artifactFilename: string, markdown: string }`
    - Validate `sessionId` is non-empty string
    - Validate `projectId` matches UUID v4 regex
    - Validate `artifactFilename`: must be non-empty string; must NOT contain `..`, `/`, or `\`; must end in `.MD` or `.md`
    - Validate `markdown`: must be non-empty string; byte length must not exceed 200KB (204800 bytes)
    - Session management: `getOrCreateSession(sessionId)`
    - Resolve write path: `path.join(config.basePath, 'agent-os', 'product', artifactFilename)` where `config.basePath` follows the same resolution pattern as `saveProductArtifactsRoute.ts` (use `projectParentFolder` from session or config)
    - NOTE: The route needs a `projectParentFolder` or equivalent base path. Use the same pattern as `saveProductArtifactsRoute.ts` -- either accept it as an additional parameter or resolve from gateway config. The gateway `/save-artifact` adapter in TG3 will pass the base path. For consistency, accept an optional `projectParentFolder` param. If not provided, use a config-based default.
    - Atomic write: `mkdir -p` the target directory, write to `.tmp`, rename to final filename
    - On success, return `{ writtenPaths: ['agent-os/product/<artifactFilename>'] }`
    - Error handling with `createHttpError` for 400 (validation), 500 (write failure)
    - Follow pattern from: `mcp-server/src/routes/saveProductArtifactsRoute.ts`
  - [x] 2.3 Create MCP types `mcp-server/src/types/saveMarkdownArtifact.ts`
    - Define `SaveMarkdownArtifactRequest` interface: `{ sessionId: string, projectId: string, projectParentFolder?: string, artifactFilename: string, markdown: string }`
    - Define `SaveMarkdownArtifactResponse` interface: `{ writtenPaths: string[] }`
    - Export from `mcp-server/src/types/index.ts`
  - [x] 2.4 Register MCP route in `mcp-server/src/routes/tools.ts`
    - Import `saveMarkdownArtifactRouter` from `./saveMarkdownArtifactRoute`
    - Add `toolsRouter.use('/save_markdown_artifact', saveMarkdownArtifactRouter);`
    - Follow the existing pattern at lines 28-35 of `tools.ts`
  - [x] 2.5 Add gateway tool type definitions in `gateway/src/types/tools.ts`
    - Add `'save_markdown_artifact'` to the `ToolName` union type (line 12-19)
    - Add `'save_markdown_artifact'` to the `ALLOWED_TOOL_NAMES` array (line 24-32)
    - Add `SaveMarkdownArtifactParams` interface: `{ projectId: string, projectParentFolder?: string, artifactFilename: string, markdown: string }`
    - Add `SaveMarkdownArtifactParams` to the `ToolParams` union type (line 179-186)
    - Add OpenAI tool definition to `TOOL_DEFINITIONS` array with name `'save_markdown_artifact'`, description, and required params `['projectId', 'artifactFilename', 'markdown']`
  - [x] 2.6 Add gateway executor mappings in `gateway/src/services/toolExecutor.ts`
    - Import `SaveMarkdownArtifactParams` from types
    - Add endpoint mapping: `save_markdown_artifact: '/mcp/tools/save_markdown_artifact'` in `TOOL_ENDPOINTS` (line 25-33)
    - Add required params: `save_markdown_artifact: ['projectId', 'artifactFilename', 'markdown']` in `TOOL_REQUIRED_PARAMS` (line 38-46)
  - [x] 2.7 Ensure MCP tool tests pass
    - Run gateway tests: `npx jest hub-bootstrap-4-mcp-tool --no-coverage`
    - Run MCP tests: `npx jest saveMarkdownArtifactRoute --no-coverage`
    - Verify all 5 tests pass
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- All 5 MCP tool tests pass
- `save_markdown_artifact` is fully registered in gateway types, executor, and MCP router
- MCP route validates filename safety (no path traversal), UUID format, byte-length limit
- Atomic write pattern (mkdir + tmp + rename) is used
- Route rejects unsafe filenames and oversized content

**Files Created/Modified:**
- `mcp-server/src/routes/saveMarkdownArtifactRoute.ts` (NEW)
- `mcp-server/src/types/saveMarkdownArtifact.ts` (NEW)
- `mcp-server/src/types/index.ts` (MODIFIED -- add export)
- `mcp-server/src/routes/tools.ts` (MODIFIED -- add route mount)
- `gateway/src/types/tools.ts` (MODIFIED -- add ToolName, params, definition)
- `gateway/src/services/toolExecutor.ts` (MODIFIED -- add endpoint + required params)
- `gateway/src/__tests__/hub-bootstrap-4-mcp-tool.test.ts` (NEW)
- `mcp-server/src/__tests__/saveMarkdownArtifactRoute.test.ts` (NEW)

---

### Task Group 3: Backend Endpoint Extensions (R4, R5, R6, R7, R9)

**Dependencies:** TG1 (task definitions for task ID matching), TG2 (save_markdown_artifact tool for /save-artifact adapter)
**Scope:** Add context injection for both tasks in POST `/`, generation branches with JSON validation and corrective retry for both artifact types in POST `/generate`, save-artifact adapter branches with JSON-to-markdown conversion in POST `/save-artifact`, and generation prompt templates in `promptBuilder.ts`.

- [x] 3.0 Complete backend endpoint extensions for both tasks
  - [x] 3.1 Write 14 focused tests for backend endpoints
    - **Context injection tests (4):**
    - Test 1: POST `/` with `task.id === 'architect--define-tech-stack'` injects `resolvedContext['MISSION']` from disk (two-path fallback) and `resolvedContext['ARCHITECTURE BASELINE']` from `fetchMetaModelSummary`
    - Test 2: POST `/` with `task.id === 'architect--define-tech-stack'` when TECH-STACK.MD exists, injects `resolvedContext['TECH STACK']` and a system hint indicating update mode
    - Test 3: POST `/` with `task.id === 'test-engineer--test-strategy'` injects `resolvedContext['MISSION']`, `resolvedContext['ROADMAP']` from `buildRoadmapSummary(fetchProductSummary())`, and `resolvedContext['TECH STACK']`
    - Test 4: POST `/` with `task.id === 'test-engineer--test-strategy'` when TEST-STRATEGY.MD exists, injects a system hint indicating update mode
    - **Generation tests (6):**
    - Test 5: POST `/generate` with `artifactType === 'tech-stack'` calls `sendChatRequest` with `jsonMode: true`, `temperature: 0.2`, `maxTokens: 16000` and returns `{ success: true, artifactContent }` with validated JSON
    - Test 6: POST `/generate` with `artifactType === 'tech-stack'` on first JSON shape validation failure performs corrective retry
    - Test 7: POST `/generate` with `artifactType === 'tech-stack'` on second validation failure returns `{ success: false, error }`
    - Test 8: POST `/generate` with `artifactType === 'test-strategy'` calls `sendChatRequest` with `jsonMode: true`, `temperature: 0.2`, `maxTokens: 16000` and returns `{ success: true, artifactContent }` with validated JSON
    - Test 9: POST `/generate` with `artifactType === 'test-strategy'` on first JSON shape validation failure performs corrective retry
    - Test 10: POST `/generate` with `artifactType === 'test-strategy'` on second validation failure returns `{ success: false, error }`
    - **Save-artifact tests (4):**
    - Test 11: POST `/save-artifact` with `artifactType === 'tech-stack'` parses JSON content, converts to markdown, calls `executeToolCall` with `save_markdown_artifact` and `{ artifactFilename: 'TECH-STACK.MD', markdown }`, returns completion metadata with `'Tech Stack complete.'`
    - Test 12: POST `/save-artifact` with `artifactType === 'test-strategy'` parses JSON content, converts to markdown, calls `executeToolCall` with `save_markdown_artifact` and `{ artifactFilename: 'TEST-STRATEGY.MD', markdown }`, returns completion metadata with `'Test Strategy complete.'`
    - Test 13: POST `/save-artifact` tech-stack JSON-to-markdown conversion produces readable markdown with category headers, technology tables, design decisions list, and constraints list
    - Test 14: POST `/save-artifact` test-strategy JSON-to-markdown conversion produces readable markdown with test levels, quality gates, and testing principles sections
    - Follow test file naming: `gateway/src/__tests__/hub-bootstrap-4-endpoints.test.ts`
    - Follow pattern from: `gateway/src/__tests__/hub-bootstrap-3-endpoints.test.ts`
  - [x] 3.2 Add context injection block for `architect--define-tech-stack` in `gateway/src/routes/chatV2.ts` POST `/` handler
    - Add inline context assembly block for `task.id === 'architect--define-tech-stack'` following the architecture task pattern at lines 1322-1358
    - Load MISSION.MD with two-path fallback (MISSION.MD then mission.md) into `resolvedContext['MISSION']`
    - Call `fetchMetaModelSummary(projectId)` and serialize as JSON into `resolvedContext['ARCHITECTURE BASELINE']`; if null, log debug and skip
    - Load TECH-STACK.MD with two-path fallback into `resolvedContext['TECH STACK']` (optional; if not found, log debug and proceed)
    - If TECH-STACK.MD exists, inject a system hint: "An existing Tech Stack (TECH-STACK.MD) was found. The user may be refining or updating it."
    - No deterministic first-turn short-circuit
  - [x] 3.3 Add context injection block for `test-engineer--test-strategy` in `gateway/src/routes/chatV2.ts` POST `/` handler
    - Add inline context assembly block for `task.id === 'test-engineer--test-strategy'`
    - Load MISSION.MD with two-path fallback into `resolvedContext['MISSION']`
    - Call `fetchProductSummary(projectId)` then `buildRoadmapSummary()` to serialize roadmap into `resolvedContext['ROADMAP']`; if no roadmap, log debug and skip
    - Load TECH-STACK.MD with two-path fallback into `resolvedContext['TECH STACK']` (optional)
    - If TEST-STRATEGY.MD exists (two-path fallback), inject a system hint: "An existing Test Strategy (TEST-STRATEGY.MD) was found. The user may be refining or updating it."
    - No deterministic first-turn short-circuit
  - [x] 3.4 Create `TECH_STACK_GENERATION_PROMPT_TEMPLATE` in `gateway/src/services/promptBuilder.ts`
    - Add template constant with placeholders: `{missionContent}`, `{architectureContext}`, `{existingTechStack}`, `{conversationTranscript}`
    - Define the target JSON schema in the template: `{ categories: [{ name: string, technologies: [{ name: string, version: string, purpose: string, rationale: string }] }], designDecisions: [{ title: string, description: string, rationale: string }], constraints: [{ name: string, description: string, type: string }] }`
    - Instruct the model to return ONLY valid JSON (no markdown, no prose, no code blocks)
    - Follow pattern from: `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` at line 749+
  - [x] 3.5 Create `TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE` in `gateway/src/services/promptBuilder.ts`
    - Add template constant with placeholders: `{missionContent}`, `{roadmapContext}`, `{techStackContent}`, `{conversationTranscript}`
    - Define the target JSON schema in the template: `{ testLevels: [{ name: string, scope: string, coverageTarget: string, tools: string[], rationale: string }], qualityGates: [{ name: string, criteria: string[], enforcement: string }], testingPrinciples: [{ title: string, description: string }] }`
    - Instruct the model to return ONLY valid JSON
  - [x] 3.6 Add generation branch for `artifactType === 'tech-stack'` in `chatV2.ts` POST `/generate` handler
    - Build prompt from `TECH_STACK_GENERATION_PROMPT_TEMPLATE` with resolved placeholders
    - Call `sendChatRequest` with `{ jsonMode: true, temperature: 0.2, maxTokens: 16000 }`
    - Implement `validateTechStackJsonShape(parsed)` function: top-level has `categories` (array), `designDecisions` (array), `constraints` (array); each category has `name` (string) and `technologies` (array); each technology has `name` (string)
    - On first validation failure, append invalid response + corrective instruction, retry once
    - On success, return `{ success: true, artifactContent: JSON.stringify(parsedJson) }`
    - On second failure, return `{ success: false, error: <validation message> }`
  - [x] 3.7 Add generation branch for `artifactType === 'test-strategy'` in `chatV2.ts` POST `/generate` handler
    - Build prompt from `TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE` with resolved placeholders
    - Call `sendChatRequest` with `{ jsonMode: true, temperature: 0.2, maxTokens: 16000 }`
    - Implement `validateTestStrategyJsonShape(parsed)` function: top-level has `testLevels` (array), `qualityGates` (array), `testingPrinciples` (array); each testLevel has `name` (string); each qualityGate has `name` (string)
    - On first validation failure, corrective retry once (same pattern as tech stack)
    - On success, return `{ success: true, artifactContent: JSON.stringify(parsedJson) }`
  - [x] 3.8 Add save-artifact adapter for `artifactType === 'tech-stack'` in `chatV2.ts` POST `/save-artifact` handler
    - Parse content as JSON
    - Convert JSON to human-readable markdown:
      - H1 header: `# Tech Stack`
      - For each category: H2 header with category name, technology table with columns: Name, Version, Purpose, Rationale
      - H2 `## Design Decisions` section: list each decision with title, description, rationale
      - H2 `## Constraints` section: list each constraint with name, description, type
    - Call `executeToolCall` with `save_markdown_artifact` tool and params: `{ projectId, projectParentFolder, artifactFilename: 'TECH-STACK.MD', markdown }`
    - Set completion metadata: content `'Tech Stack complete.'`
  - [x] 3.9 Add save-artifact adapter for `artifactType === 'test-strategy'` in `chatV2.ts` POST `/save-artifact` handler
    - Parse content as JSON
    - Convert JSON to human-readable markdown:
      - H1 header: `# Test Strategy`
      - H2 `## Test Levels` section: for each level, show name, scope, coverage target, tools list, rationale
      - H2 `## Quality Gates` section: for each gate, show name, criteria list, enforcement
      - H2 `## Testing Principles` section: for each principle, show title and description
    - Call `executeToolCall` with `save_markdown_artifact` tool and params: `{ projectId, projectParentFolder, artifactFilename: 'TEST-STRATEGY.MD', markdown }`
    - Set completion metadata: content `'Test Strategy complete.'`
  - [x] 3.10 Ensure backend endpoint tests pass
    - Run ONLY: `npx jest hub-bootstrap-4-endpoints --no-coverage`
    - Verify all 14 tests pass
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- All 14 backend endpoint tests pass
- Context injection loads correct files and service data for both tasks
- System hints injected when existing artifacts found
- Generation uses jsonMode with temperature=0.2, maxTokens=16000, validates JSON shape, performs corrective retry
- Save adapters convert JSON to readable markdown and call `save_markdown_artifact` tool
- Completion metadata set correctly for both artifacts

**Files Created/Modified:**
- `gateway/src/routes/chatV2.ts` (MODIFIED -- context injection, generate, save-artifact branches)
- `gateway/src/services/promptBuilder.ts` (MODIFIED -- two new generation prompt templates)
- `gateway/src/__tests__/hub-bootstrap-4-endpoints.test.ts` (NEW)

---

### Task Group 4: Backend Dashboard Integration (R14)

**Dependencies:** TG3 (save adapter must exist so artifacts can exist on disk)
**Parallelizable with:** TG5
**Scope:** Add exists/not-exists checks for TECH-STACK.MD and TEST-STRATEGY.MD in the dashboard summary endpoint, and map them to the existing `strategicFoundation.standards` metrics.

- [x] 4.0 Complete dashboard integration for both artifacts
  - [x] 4.1 Write 3 focused tests for dashboard exists/not-exists
    - Test 1: When TECH-STACK.MD exists on disk, `strategicFoundation.standards.companyStandards.value` is 1; when missing, it is 0
    - Test 2: When TEST-STRATEGY.MD exists on disk, `strategicFoundation.standards.productStandards.value` is 1; when missing, it is 0
    - Test 3: Both checks use two-path fallback (TECH-STACK.MD then tech-stack.md; TEST-STRATEGY.MD then test-strategy.md) and do not throw on missing files
    - Follow test file naming: `gateway/src/__tests__/hub-bootstrap-4-dashboard.test.ts`
    - Follow pattern from: `gateway/src/__tests__/hub-bootstrap-3-dashboard.test.ts`
  - [x] 4.2 Add TECH-STACK.MD exists check in `gateway/src/routes/dashboardSummary.ts`
    - After the existing architecture baseline block (lines 126-149), add a new try/catch block
    - Attempt `fs.access` on `path.join(config.conversationPersistBasePath, 'agent-os', 'product', 'TECH-STACK.MD')`
    - On ENOENT, try fallback path `tech-stack.md`
    - If found: set `dto.strategicFoundation.standards.companyStandards = { label: 'Tech Stack', value: 1 }`
    - If not found: set `dto.strategicFoundation.standards.companyStandards = { label: 'Tech Stack', value: 0 }`
    - On unexpected error, log warning and leave mock values unchanged (graceful degradation)
  - [x] 4.3 Add TEST-STRATEGY.MD exists check in `gateway/src/routes/dashboardSummary.ts`
    - Add another try/catch block after the tech stack check
    - Attempt `fs.access` on `path.join(config.conversationPersistBasePath, 'agent-os', 'product', 'TEST-STRATEGY.MD')`
    - On ENOENT, try fallback path `test-strategy.md`
    - If found: set `dto.strategicFoundation.standards.productStandards = { label: 'Test Strategy', value: 1 }`
    - If not found: set `dto.strategicFoundation.standards.productStandards = { label: 'Test Strategy', value: 0 }`
    - On unexpected error, log warning and leave mock values unchanged
  - [x] 4.4 Ensure dashboard tests pass
    - Run ONLY: `npx jest hub-bootstrap-4-dashboard --no-coverage`
    - Verify all 3 tests pass
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- All 3 dashboard tests pass
- Dashboard summary endpoint returns correct exists/not-exists values for both TECH-STACK.MD and TEST-STRATEGY.MD
- Two-path fallback used for both files
- Graceful degradation on unexpected errors (keeps mock values)

**Files Created/Modified:**
- `gateway/src/routes/dashboardSummary.ts` (MODIFIED -- two new exists checks)
- `gateway/src/__tests__/hub-bootstrap-4-dashboard.test.ts` (NEW)

---

### Task Group 5: Frontend Components (R10, R11, R12, R13)

**Dependencies:** TG3 (backend must serve correct preview types); TG1 (TASK_ARTIFACT_MAP entries reference task IDs)
**Parallelizable with:** TG4
**Scope:** Create TechStackPreviewBubble and TestStrategyPreviewBubble components, add type guards and rendering branches in MessageBubble, and add TASK_ARTIFACT_MAP entries with generateArtifact routing in useChatThread.

- [x] 5.0 Complete frontend components for both tasks
  - [x] 5.1 Write 16 focused tests for frontend components
    - **TechStackPreviewBubble tests (5):**
    - Test 1: TechStackPreviewBubble renders header "Generated Tech Stack" with category and technology counts
    - Test 2: TechStackPreviewBubble renders collapsible category sections; clicking a section header toggles expansion showing technology rows with name, version, purpose
    - Test 3: TechStackPreviewBubble toggles between summary and JSON view via "Show JSON"/"Show Summary" button
    - Test 4: TechStackPreviewBubble Confirm/Reject buttons work (shows "Saving..." when isConfirming, disabled when disabled prop is true)
    - Test 5: TechStackPreviewBubble handles malformed JSON gracefully (shows error state)
    - **TestStrategyPreviewBubble tests (5):**
    - Test 6: TestStrategyPreviewBubble renders header "Generated Test Strategy" with test level and quality gate counts
    - Test 7: TestStrategyPreviewBubble renders collapsible sections for test levels, quality gates, and testing principles
    - Test 8: TestStrategyPreviewBubble toggles between summary and JSON view
    - Test 9: TestStrategyPreviewBubble Confirm/Reject buttons work (Saving... state, disabled state)
    - Test 10: TestStrategyPreviewBubble handles malformed JSON gracefully
    - **MessageBubble type guard and rendering tests (4):**
    - Test 11: `isTechStackPreview` type guard returns true for `{ type: 'tech-stack-preview', content: '...' }` and false for other types
    - Test 12: `isTestStrategyPreview` type guard returns true for `{ type: 'test-strategy-preview', content: '...' }` and false for other types
    - Test 13: MessageBubble renders TechStackPreviewBubble when structuredResponse type is `'tech-stack-preview'`
    - Test 14: MessageBubble renders TestStrategyPreviewBubble when structuredResponse type is `'test-strategy-preview'`
    - **TASK_ARTIFACT_MAP and useChatThread tests (2):**
    - Test 15: TASK_ARTIFACT_MAP contains `'architect--define-tech-stack'` entry with `artifactId: 'tech-stack'`, `previewType: 'tech-stack-preview'`, and correct metadata
    - Test 16: TASK_ARTIFACT_MAP contains `'test-engineer--test-strategy'` entry with `artifactId: 'test-strategy'`, `previewType: 'test-strategy-preview'`, and correct metadata
    - Follow test file naming: `frontend/src/__tests__/hub-bootstrap-4-components.test.tsx`
    - Follow pattern from: `frontend/src/__tests__/hub-bootstrap-3-components.test.tsx`
  - [x] 5.2 Create `frontend/src/components/UnifiedChat/TechStackPreviewBubble.tsx`
    - Follow `ArchitecturePreviewBubble.tsx` pattern exactly
    - Define `TechStack` interface: `{ categories: [{ name: string, technologies: [{ name: string, version: string, purpose: string, rationale: string }] }], designDecisions: [{ title: string, description: string, rationale: string }], constraints: [{ name: string, description: string, type: string }] }`
    - Props: `{ content: string, onConfirm: () => void, onReject: () => void, isConfirming?: boolean, disabled?: boolean }`
    - Parse helper: `parseTechStackContent(content)` returning `{ data, error }`
    - Header: "Generated Tech Stack" with counts (N categories, M technologies total)
    - Collapsible category sections: each header shows category name and technology count; expanded view shows technology rows with name, version, purpose
    - Collapsible "Design Decisions" section listing title + description + rationale
    - Collapsible "Constraints" section listing name + description + type
    - "Show JSON"/"Show Summary" toggle button
    - Confirm/Reject action buttons (same props pattern: isConfirming, disabled)
    - Use `data-testid="tech-stack-preview-bubble"` on root container
  - [x] 5.3 Create `frontend/src/components/UnifiedChat/TechStackPreviewBubble.module.css`
    - Follow the same CSS module structure as `ArchitecturePreviewBubble.module.css`
    - Container, header, headerCounts, sectionHeader, sectionChevron, sectionContent, entityItem, entityName, entityDescription, toggleButton, rawJson, actions, confirmButton, rejectButton, errorMessage
  - [x] 5.4 Create `frontend/src/components/UnifiedChat/TestStrategyPreviewBubble.tsx`
    - Follow same pattern as TechStackPreviewBubble
    - Define `TestStrategy` interface: `{ testLevels: [{ name: string, scope: string, coverageTarget: string, tools: string[], rationale: string }], qualityGates: [{ name: string, criteria: string[], enforcement: string }], testingPrinciples: [{ title: string, description: string }] }`
    - Props: same as TechStackPreviewBubble
    - Parse helper: `parseTestStrategyContent(content)` returning `{ data, error }`
    - Header: "Generated Test Strategy" with counts (N test levels, M quality gates)
    - Collapsible "Test Levels" section: each level shows name, scope, coverage target, tools (comma-separated), rationale
    - Collapsible "Quality Gates" section: each gate shows name, criteria (bulleted list), enforcement
    - Collapsible "Testing Principles" section: each principle shows title + description
    - "Show JSON"/"Show Summary" toggle and Confirm/Reject buttons
    - Use `data-testid="test-strategy-preview-bubble"` on root container
  - [x] 5.5 Create `frontend/src/components/UnifiedChat/TestStrategyPreviewBubble.module.css`
    - Same CSS module structure as TechStackPreviewBubble.module.css
  - [x] 5.6 Add type guards in `frontend/src/components/UnifiedChat/MessageBubble.tsx`
    - Add `isTechStackPreview` type guard: `sr.type === 'tech-stack-preview' && typeof sr.content === 'string'`
    - Add `isTestStrategyPreview` type guard: `sr.type === 'test-strategy-preview' && typeof sr.content === 'string'`
    - Both should follow the exact pattern of `isArchitecturePreview` (lines 149-155)
    - Export both type guards (for test imports)
  - [x] 5.7 Add rendering branches in `frontend/src/components/UnifiedChat/MessageBubble.tsx`
    - Import `TechStackPreviewBubble` and `TestStrategyPreviewBubble`
    - Add `showTechStackPreview` and `showTestStrategyPreview` boolean flags (following the `showArchitecturePreview` pattern at line 191)
    - Update `showQuestions` guard to exclude both new preview types (line 193)
    - Add rendering branch for TechStackPreviewBubble after the architecture-preview branch, before the completion-chip branch
    - Add rendering branch for TestStrategyPreviewBubble after the tech-stack-preview branch
    - Both branches pass `content`, `onConfirm`, `onReject`, `isConfirming`, `disabled` props
  - [x] 5.8 Add TASK_ARTIFACT_MAP entries in `frontend/src/hooks/useChatThread.ts`
    - Add 4th entry at line ~96:
      ```
      'architect--define-tech-stack': {
        artifactId: 'tech-stack',
        artifactName: 'TECH-STACK.MD',
        artifactKey: 'techStack',
        completionMessage: 'Tech Stack complete.',
        warningText: 'A Tech Stack already exists. Completing this conversation will replace it.',
        previewType: 'tech-stack-preview',
      }
      ```
    - Add 5th entry:
      ```
      'test-engineer--test-strategy': {
        artifactId: 'test-strategy',
        artifactName: 'TEST-STRATEGY.MD',
        artifactKey: 'testStrategy',
        completionMessage: 'Test Strategy complete.',
        warningText: 'A Test Strategy already exists. Completing this conversation will replace it.',
        previewType: 'test-strategy-preview',
      }
      ```
  - [x] 5.9 Add generateArtifact routing branches in `frontend/src/hooks/useChatThread.ts`
    - In `generateArtifact` callback (lines 309-328), add two new `else if` branches:
    - `else if (previewType === 'tech-stack-preview')`: build `structuredResponse = { type: 'tech-stack-preview', content: artifactContent }`
    - `else if (previewType === 'test-strategy-preview')`: build `structuredResponse = { type: 'test-strategy-preview', content: artifactContent }`
    - Follow the exact pattern of the `architecture-preview` branch at lines 318-322
  - [x] 5.10 Ensure frontend component tests pass
    - Run ONLY: `npx vitest run hub-bootstrap-4-components --no-coverage`
    - Verify all 16 tests pass
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- All 16 frontend component tests pass
- TechStackPreviewBubble and TestStrategyPreviewBubble render correctly with collapsible sections, counts, JSON toggle, and action buttons
- Both components handle malformed JSON gracefully
- MessageBubble type guards correctly identify both preview types
- MessageBubble renders correct preview bubble components for each preview type
- TASK_ARTIFACT_MAP has 5 entries (3 existing + 2 new)
- generateArtifact routing creates correct structuredResponse for both preview types

**Files Created/Modified:**
- `frontend/src/components/UnifiedChat/TechStackPreviewBubble.tsx` (NEW)
- `frontend/src/components/UnifiedChat/TechStackPreviewBubble.module.css` (NEW)
- `frontend/src/components/UnifiedChat/TestStrategyPreviewBubble.tsx` (NEW)
- `frontend/src/components/UnifiedChat/TestStrategyPreviewBubble.module.css` (NEW)
- `frontend/src/components/UnifiedChat/MessageBubble.tsx` (MODIFIED -- type guards + rendering branches)
- `frontend/src/hooks/useChatThread.ts` (MODIFIED -- TASK_ARTIFACT_MAP entries + generateArtifact routing)
- `frontend/src/__tests__/hub-bootstrap-4-components.test.tsx` (NEW)

---

### Task Group 6: Frontend Integration Wiring (R14 frontend, R15)

**Dependencies:** TG4 (dashboard provides standards metrics), TG5 (TASK_ARTIFACT_MAP entries and components exist)
**Scope:** Wire the DashboardView to pass `techStack` and `testStrategy` keys in the `artifactExists` record, and extend `handleDownloadTranscript` for both new task IDs.

- [x] 6.0 Complete frontend integration wiring
  - [x] 6.1 Write 6 focused tests for integration wiring
    - **DashboardView artifactExists tests (3):**
    - Test 1: DashboardView passes `techStack: true` in `artifactExists` when `strategicFoundation.standards.companyStandards.value > 0` and `techStack: false` when value is 0
    - Test 2: DashboardView passes `testStrategy: true` in `artifactExists` when `strategicFoundation.standards.productStandards.value > 0` and `testStrategy: false` when value is 0
    - Test 3: DashboardView passes all 5 artifact keys in `artifactExists`: `mission`, `roadmap`, `architecture`, `techStack`, `testStrategy`
    - **Transcript download tests (3):**
    - Test 4: `handleDownloadTranscript` for `architect--define-tech-stack` uses `artifactDescription = 'TECH-STACK.MD (technology stack)'` and `filename = 'architect-define-tech-stack-transcript.md'`
    - Test 5: `handleDownloadTranscript` for `test-engineer--test-strategy` uses `artifactDescription = 'TEST-STRATEGY.MD (test strategy)'` and `filename = 'test-engineer-test-strategy-transcript.md'`
    - Test 6: `handleDownloadTranscript` correctly identifies the last completion chip taskId and routes to the right branch
    - Follow test file naming: `frontend/src/__tests__/hub-bootstrap-4-integration.test.ts`
    - Follow pattern from: `frontend/src/__tests__/hub-bootstrap-3-integration.test.ts`
  - [x] 6.2 Extend `artifactExists` record in `frontend/src/components/DashboardView/DashboardView.tsx`
    - In the `<UnifiedChatPanel>` JSX (lines 518-529), add two new keys to the `artifactExists` prop:
    - `techStack: (data?.strategicFoundation?.standards?.companyStandards?.value ?? 0) > 0`
    - `testStrategy: (data?.strategicFoundation?.standards?.productStandards?.value ?? 0) > 0`
    - Existing keys remain unchanged: `mission`, `roadmap`, `architecture`
  - [x] 6.3 Extend `handleDownloadTranscript` in `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
    - In the `handleDownloadTranscript` callback (lines 221-252), add two new branches in the `if/else if` chain:
    - `else if (lastCompletionTaskId === 'architect--define-tech-stack')`: set `artifactDescription = 'TECH-STACK.MD (technology stack)'`, `filename = 'architect-define-tech-stack-transcript.md'`
    - `else if (lastCompletionTaskId === 'test-engineer--test-strategy')`: set `artifactDescription = 'TEST-STRATEGY.MD (test strategy)'`, `filename = 'test-engineer-test-strategy-transcript.md'`
    - Insert before the `else` fallback (mission default)
  - [x] 6.4 Ensure integration wiring tests pass
    - Run ONLY: `npx vitest run hub-bootstrap-4-integration --no-coverage`
    - Verify all 6 tests pass
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- All 6 integration tests pass
- DashboardView passes 5-key `artifactExists` record to UnifiedChatPanel
- `handleDownloadTranscript` correctly routes to both new task branches with correct artifact descriptions and filenames
- Existing transcript download branches for mission, roadmap, architecture remain unchanged

**Files Created/Modified:**
- `frontend/src/components/DashboardView/DashboardView.tsx` (MODIFIED -- artifactExists extension)
- `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` (MODIFIED -- transcript download branches)
- `frontend/src/__tests__/hub-bootstrap-4-integration.test.ts` (NEW)

---

### Task Group 7: Test Review & Gap Analysis

**Dependencies:** TG1-TG6 (all implementation complete)
**Scope:** Review all tests written by prior task groups, identify critical gaps, and write up to 20 additional tests to fill them.

- [x] 7.0 Review existing tests and fill critical gaps
  - [x] 7.1 Review all tests from Task Groups 1-6
    - Review 4-6 tests from TG1 (task definitions): `hub-bootstrap-4-task-definition.test.ts`
    - Review 5 tests from TG2 (MCP tool): `hub-bootstrap-4-mcp-tool.test.ts` + `saveMarkdownArtifactRoute.test.ts`
    - Review 14 tests from TG3 (backend endpoints): `hub-bootstrap-4-endpoints.test.ts`
    - Review 3 tests from TG4 (dashboard): `hub-bootstrap-4-dashboard.test.ts`
    - Review 16 tests from TG5 (frontend components): `hub-bootstrap-4-components.test.tsx`
    - Review 6 tests from TG6 (integration wiring): `hub-bootstrap-4-integration.test.ts`
    - Total existing tests: approximately 48-50 tests
  - [x] 7.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to Increment 7 feature requirements (R1-R15)
    - Prioritize:
      - End-to-end flow gaps (e.g., full context-injection-to-generation-to-save cycle)
      - Edge cases in JSON-to-markdown conversion (empty arrays, missing optional fields)
      - Corrective retry edge cases (malformed JSON that partially validates)
      - MCP route edge cases (concurrent writes, filename boundary cases)
      - Preview bubble edge cases (very large JSON, empty sections)
      - Cross-cutting concerns (e.g., existing artifact detection system hint appears in messages)
    - Do NOT assess entire application test coverage
  - [x] 7.3 Write up to 20 additional strategic tests to fill identified gaps
    - Test file: `gateway/src/__tests__/hub-bootstrap-4-gaps.test.ts` (backend gaps)
    - Test file: `frontend/src/__tests__/hub-bootstrap-4-gaps.test.tsx` (frontend gaps)
    - Suggested gap areas (select the most critical):
      - Tech stack JSON-to-markdown conversion with edge cases (empty categories, missing version fields, special characters)
      - Test strategy JSON-to-markdown conversion with edge cases (empty tools arrays, missing criteria)
      - Context injection when MISSION.MD does not exist (both tasks should still proceed)
      - Context injection when `fetchMetaModelSummary` returns null (tech stack task proceeds without architecture context)
      - Context injection when `fetchProductSummary` returns null (test strategy task proceeds without roadmap)
      - Generation prompt template placeholder substitution produces well-formed prompts
      - `validateTechStackJsonShape` rejects objects missing `categories` or with non-array `categories`
      - `validateTestStrategyJsonShape` rejects objects missing `testLevels` or with non-array `testLevels`
      - MCP route with filename exactly at `.MD` boundary (e.g., `.MD`, `.md`, `.Md` -- only `.MD` and `.md` accepted)
      - MCP route with filename containing only dots: `..md` (should be rejected)
      - TechStackPreviewBubble with empty categories array (renders but shows "No categories")
      - TestStrategyPreviewBubble with empty test levels array (renders but shows "No test levels")
      - MessageBubble `showQuestions` correctly excludes both new preview types
      - TASK_ARTIFACT_MAP `warningText` is displayed when `artifactExists[artifactKey]` is true
      - DashboardView Standards card renders "Tech Stack" and "Test Strategy" labels from metrics
    - Do NOT write comprehensive coverage for all scenarios
    - Skip performance tests, accessibility tests, and non-critical edge cases
  - [x] 7.4 Run all feature-specific tests
    - Run gateway tests: `npx jest hub-bootstrap-4 --no-coverage`
    - Run MCP tests: `npx jest saveMarkdownArtifactRoute --no-coverage`
    - Run frontend tests: `npx vitest run hub-bootstrap-4 --no-coverage`
    - Expected total: approximately 50-70 tests
    - Do NOT run the entire application test suite
    - Verify all tests pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 50-70 total)
- Critical user workflows for both bootstrap conversations are covered
- No more than 20 additional tests added
- Testing focused exclusively on Increment 7 requirements (R1-R15)
- JSON-to-markdown conversion edge cases covered
- Corrective retry and validation edge cases covered
- Both preview bubbles tested with edge cases

**Files Created/Modified:**
- `gateway/src/__tests__/hub-bootstrap-4-gaps.test.ts` (NEW)
- `frontend/src/__tests__/hub-bootstrap-4-gaps.test.tsx` (NEW)

---

## Summary of All Files

### New Files (18)
| File | Task Group |
|------|-----------|
| `gateway/src/config/tasks/architect--define-tech-stack.json` | TG1 |
| `gateway/src/config/prompts/architect.define-tech-stack.task.md` | TG1 |
| `gateway/src/__tests__/hub-bootstrap-4-task-definition.test.ts` | TG1 |
| `mcp-server/src/routes/saveMarkdownArtifactRoute.ts` | TG2 |
| `mcp-server/src/types/saveMarkdownArtifact.ts` | TG2 |
| `gateway/src/__tests__/hub-bootstrap-4-mcp-tool.test.ts` | TG2 |
| `mcp-server/src/__tests__/saveMarkdownArtifactRoute.test.ts` | TG2 |
| `gateway/src/__tests__/hub-bootstrap-4-endpoints.test.ts` | TG3 |
| `gateway/src/__tests__/hub-bootstrap-4-dashboard.test.ts` | TG4 |
| `frontend/src/components/UnifiedChat/TechStackPreviewBubble.tsx` | TG5 |
| `frontend/src/components/UnifiedChat/TechStackPreviewBubble.module.css` | TG5 |
| `frontend/src/components/UnifiedChat/TestStrategyPreviewBubble.tsx` | TG5 |
| `frontend/src/components/UnifiedChat/TestStrategyPreviewBubble.module.css` | TG5 |
| `frontend/src/__tests__/hub-bootstrap-4-components.test.tsx` | TG5 |
| `frontend/src/__tests__/hub-bootstrap-4-integration.test.ts` | TG6 |
| `gateway/src/__tests__/hub-bootstrap-4-gaps.test.ts` | TG7 |
| `frontend/src/__tests__/hub-bootstrap-4-gaps.test.tsx` | TG7 |

### Modified Files (11)
| File | Task Group |
|------|-----------|
| `gateway/src/config/tasks/test-engineer--test-strategy.json` | TG1 |
| `gateway/src/config/prompts/test-engineer.test-strategy.task.md` | TG1 |
| `mcp-server/src/types/index.ts` | TG2 |
| `mcp-server/src/routes/tools.ts` | TG2 |
| `gateway/src/types/tools.ts` | TG2 |
| `gateway/src/services/toolExecutor.ts` | TG2 |
| `gateway/src/routes/chatV2.ts` | TG3 |
| `gateway/src/services/promptBuilder.ts` | TG3 |
| `gateway/src/routes/dashboardSummary.ts` | TG4 |
| `frontend/src/components/UnifiedChat/MessageBubble.tsx` | TG5 |
| `frontend/src/hooks/useChatThread.ts` | TG5 |
| `frontend/src/components/DashboardView/DashboardView.tsx` | TG6 |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` | TG6 |

### Files NOT Modified (verified out of scope)
| File | Reason |
|------|--------|
| `gateway/src/config/tasks/architect--tech-standards.json` | Existing advisory task; must NOT be modified (R1 explicit) |
