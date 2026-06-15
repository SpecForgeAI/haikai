# Task Breakdown: Architecture Diagram Generation Task Framework (ER First)

## Overview
Total Tasks: 34
Increment: 2 of multi-increment feature
Stack: Gateway (Express/TypeScript, Jest tests)

This spec introduces a new Architect persona workflow task for generating ER diagrams from the architecture data model. All deliverables are within the gateway service -- no frontend or backend (Java) changes required.

## Task List

### Configuration & Prompt Assets

#### Task Group 1: Task Definition, Persona Registration, and Prompt Files
**Dependencies:** None

- [x] 1.0 Complete task definition, persona registration, and all prompt/contract assets
  - [x] 1.1 Write 3 focused tests for task registration and prompt loading
    - Test 1: Verify `architect--generate-architecture-diagram.json` loads from disk and has required fields (`id`, `personaId`, `mode`, `responseFormat`, `persistence`, `availableFrom`, `menuLabel`, `description`, `taskPromptRef`)
    - Test 2: Verify `architect.json` persona `tasks` array contains `"architect--generate-architecture-diagram"`
    - Test 3: Verify the task prompt file at `gateway/src/config/prompts/architect.generate-architecture-diagram.task.md` loads and contains key markers (the 4 questions, `json:temporaryArchitectureDiagram` tag instruction, stop-after-generation instruction)
  - [x] 1.2 Create task definition JSON file
    - Path: `gateway/src/config/tasks/architect--generate-architecture-diagram.json`
    - Fields: `id: "architect--generate-architecture-diagram"`, `personaId: "architect"`, `mode: "workflow"`, `responseFormat: null`, `contextNeeds: []`, `persistence: "panel"`, `availableFrom: ["panel"]`, `phases: null`, `artifacts: []`
    - `menuLabel: "Generate ER Diagram"`, `description` summarizing the task purpose
    - `taskPromptRef: "prompts/architect.generate-architecture-diagram.task.md"`
    - Replicate exact structure from `architect--oas-spec.json`
  - [x] 1.3 Add task ID to architect persona definition
    - File: `gateway/src/config/personas/architect.json`
    - Append `"architect--generate-architecture-diagram"` to the `tasks` array
  - [x] 1.4 Create the task prompt file
    - Path: `gateway/src/config/prompts/architect.generate-architecture-diagram.task.md`
    - Define the 4-question workflow sequence:
      1. "Should this be a logical or physical ER diagram?"
      2. "Which entities should be included: all entities or a specific subset?"
      3. "Which attributes should be shown: all, none, or key attributes (primary and foreign keys)?"
      4. "Should relationship cardinalities be shown?"
    - Allow all 4 questions to be presented in a single turn
    - Instruct LLM to not proceed until all 4 are answered
    - Define confirmation step: restate diagram_kind=ER, view_mode, entity selection, attribute display, cardinality preference
    - Define generation step: produce full `TemporaryArchitectureDiagram` JSON wrapped in ` ```json:temporaryArchitectureDiagram ``` ` fenced code block
    - Define stop instruction: no follow-up explanation or UI instructions after JSON payload
    - Embed all behavioral rules:
      - Use ONLY entities/attributes from injected data model context
      - Use EXACT names -- never abbreviate or rename
      - NEVER create `*_points` wrapper entities
      - NEVER create/update/delete architecture model entities (read-only)
      - NEVER output native diagram JSON -- ONLY `TemporaryArchitectureDiagram`
      - Limited to ER diagrams only (`diagram_kind: "ER"`) -- decline non-ER requests
      - Decline generation when no data entities available in context
      - All `id` fields are local payload identifiers (e.g. `"node-1"`, `"edge-1"`) -- no architecture IDs
  - [x] 1.5 Create condensed TemporaryArchitectureDiagram contract summary
    - Path: `gateway/src/config/prompts/shared/temporary-diagram-contract.md`
    - Reference source: `frontend/src/types/temporaryArchitectureDiagram.ts`
    - Cover top-level required fields: `id`, `name`, `diagram_kind`, `source_architecture_domain`, `view_mode`, `version`, `nodes`, `edges`
    - Cover node structure: required fields, `compartments` array for attributes
    - Cover edge structure: required fields, optional `cardinality`, `relationship_type`, labels
    - Cover compartment item structure and point structure
    - State the "no architecture IDs" rule: all `id` fields are local payload-only identifiers; cross-referencing uses `ref_name` exact name matching
    - State ER-specific semantic_type constraints: LOGICAL view uses `LOGICAL_DATA_ENTITY` / `LOGICAL_DATA_ATTRIBUTE`; PHYSICAL view uses `PHYSICAL_DATA_ENTITY` / `PHYSICAL_DATA_ATTRIBUTE`
    - State `version: 1` and `source_architecture_domain: "DATA"`
  - [x] 1.6 Ensure task registration tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify task JSON loads correctly
    - Verify persona tasks array updated
    - Verify prompt file loads with expected content markers

**Acceptance Criteria:**
- The 3 tests from 1.1 pass
- Task JSON matches the `architect--oas-spec.json` structure exactly (with new field values)
- Persona tasks array includes the new task ID
- Task prompt contains all 4 questions, behavioral rules, fenced block instruction, and stop instruction
- Contract summary covers all required structures from the TypeScript interfaces

---

### Context Builder

#### Task Group 2: Filtered Data Model Context Builder
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete filtered data model context builder
  - [x] 2.1 Write 4 focused tests for `buildDataModelContextSection`
    - Test 1: Verify correct filtering -- returned context includes ONLY `logical_data_entities`, `logical_data_attributes`, `physical_data_entities`, `physical_data_attributes`, `logical_data_entity_relationships`, `logical_data_entity_physical_data_entities` keys from the full model
    - Test 2: Verify that irrelevant model keys (e.g. `applications`, `services`, `interfaces`, `business_processes`, `ui_screens`) are excluded from the filtered output
    - Test 3: Verify the architecture explainer markdown content is included in the returned section (same as `buildArchitectureContextSection` pattern)
    - Test 4: Verify empty string is returned when `fetchFullArchitectureContext` returns null (graceful degradation)
  - [x] 2.2 Implement `buildDataModelContextSection` function
    - File: `gateway/src/services/architectureContextBuilder.ts`
    - New exported async function: `buildDataModelContextSection(projectId: string): Promise<string>`
    - Call `fetchFullArchitectureContext(projectId)` to get the full model data
    - Filter the returned object to include ONLY the 6 data-related keys:
      - `logical_data_entities`
      - `logical_data_attributes`
      - `physical_data_entities`
      - `physical_data_attributes`
      - `logical_data_entity_relationships`
      - `logical_data_entity_physical_data_entities`
    - Handle nested model structure (keys may be under `entities` and/or `relationships` sub-objects -- follow the structure returned by `fetchFullArchitectureContext`)
    - Combine filtered data with `loadArchitectureExplainer()` output, following the same compose pattern as `buildArchitectureContextSection`
    - Return empty string on fetch failure
  - [x] 2.3 Ensure context builder tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify filtering logic is correct
    - Verify graceful degradation works
    - Add tests to existing test file at `gateway/src/__tests__/architectureContextBuilder.test.ts`

**Acceptance Criteria:**
- The 4 tests from 2.1 pass
- Function filters model to exactly the 6 specified data-related keys
- Architecture explainer is included in the output
- Empty string returned on fetch failure
- Function is exported and callable from chatV2.ts

---

### Tool Registration

#### Task Group 3: Save Tool Definition and Executor Wiring
**Dependencies:** None (can run in parallel with Task Groups 1 and 2)

- [x] 3.0 Complete tool definition and executor wiring
  - [x] 3.1 Write 3 focused tests for tool registration
    - Test 1: Verify `'saveTemporaryArchitectureDiagram'` is in `ALLOWED_TOOL_NAMES` and the `ToolName` union accepts it
    - Test 2: Verify `TOOL_DEFINITIONS` contains an entry with name `saveTemporaryArchitectureDiagram`, required params `['projectId', 'diagramJson']`, and a description
    - Test 3: Verify `validateToolArguments('saveTemporaryArchitectureDiagram', ...)` rejects when `projectId` or `diagramJson` is missing, and accepts when both are present
  - [x] 3.2 Add tool name to type system
    - File: `gateway/src/types/tools.ts`
    - Add `'saveTemporaryArchitectureDiagram'` to the `ToolName` union type
    - Add `'saveTemporaryArchitectureDiagram'` to the `ALLOWED_TOOL_NAMES` array
  - [x] 3.3 Add tool parameter interface
    - File: `gateway/src/types/tools.ts`
    - New interface `SaveTemporaryArchitectureDiagramParams` with `projectId: string` and `diagramJson: string`
    - Add to the `ToolParams` union type
  - [x] 3.4 Add tool definition entry
    - File: `gateway/src/types/tools.ts`
    - Add new `ToolDefinition` entry in `TOOL_DEFINITIONS` array:
      - name: `'saveTemporaryArchitectureDiagram'`
      - description: `"Save a temporary architecture diagram payload for future mapping and rendering"`
      - parameters: `projectId` (string, required), `diagramJson` (string, required)
  - [x] 3.5 Add endpoint mapping and required params
    - File: `gateway/src/services/toolExecutor.ts`
    - Add to `TOOL_ENDPOINTS`: `saveTemporaryArchitectureDiagram: '/mcp/tools/saveTemporaryArchitectureDiagram'`
    - Add to `TOOL_REQUIRED_PARAMS`: `saveTemporaryArchitectureDiagram: ['projectId', 'diagramJson']`
    - Add `SaveTemporaryArchitectureDiagramParams` to the import statement from `'../types'`
  - [x] 3.6 Ensure tool registration tests pass
    - Run ONLY the 3 tests written in 3.1
    - Verify tool appears in allowed list
    - Verify definition has correct parameters
    - Verify argument validation works

**Acceptance Criteria:**
- The 3 tests from 3.1 pass
- `saveTemporaryArchitectureDiagram` appears in all 5 registration locations (ToolName union, ALLOWED_TOOL_NAMES, TOOL_DEFINITIONS, TOOL_ENDPOINTS, TOOL_REQUIRED_PARAMS)
- New params interface is defined and included in the ToolParams union
- TypeScript compiles without errors

---

### ChatV2 Integration

#### Task Group 4: Context Assembly Wiring and Server-Side Payload Extraction
**Dependencies:** Task Groups 1, 2, and 3

- [x] 4.0 Complete chatV2 integration (context injection + payload extraction + save + termination)
  - [x] 4.1 Write 5 focused tests for chatV2 integration
    - Test 1: Verify that when `task.id === 'architect--generate-architecture-diagram'`, the context assembly block calls `buildDataModelContextSection` and injects result into `resolvedContext['DATA MODEL CONTEXT']`
    - Test 2: Verify that the condensed contract summary file content is loaded and injected into `resolvedContext['TEMPORARY DIAGRAM CONTRACT']`
    - Test 3: Verify server-side extraction successfully extracts JSON from a ` ```json:temporaryArchitectureDiagram ... ``` ` fenced block in the assistant response, parses it, validates required top-level fields (`id`, `name`, `diagram_kind`, `nodes`, `edges`, `version`), and calls `executeToolCall` with tool name `'saveTemporaryArchitectureDiagram'` and arguments `{ projectId, diagramJson: <stringified payload> }`
    - Test 4: Verify that on extraction failure (no JSON block found, or missing required fields), the assistant message is returned as-is without calling the save tool -- a warning is logged
    - Test 5: Verify that on successful extraction and save, the turn is treated as complete (assistant message persisted, no further LLM turn initiated)
  - [x] 4.2 Add context assembly block in chatV2.ts
    - Location: After the existing inline context assembly blocks (after the `fullArchContextTasks` block near line ~3004)
    - Pattern: Follow the `architect--detailed-data-model` block pattern
    - When `task.id === 'architect--generate-architecture-diagram'`:
      - Call `buildDataModelContextSection(threadKey.projectId)` and inject into `resolvedContext['DATA MODEL CONTEXT']`
      - Load `gateway/src/config/prompts/shared/temporary-diagram-contract.md` file content and inject into `resolvedContext['TEMPORARY DIAGRAM CONTRACT']`
      - Wrap both in try/catch with logger.warn on failure
    - Import `buildDataModelContextSection` from `'../services/architectureContextBuilder'` (add to existing import if `buildArchitectureContextSection` is already imported)
  - [x] 4.3 Implement server-side payload extraction logic
    - Location: In chatV2.ts, in the post-LLM-response processing section for the `architect--generate-architecture-diagram` task
    - Scan the assistant's response content for a fenced code block tagged `json:temporaryArchitectureDiagram` using regex: `` /```json:temporaryArchitectureDiagram\s*\n([\s\S]*?)\n```/ ``
    - Extract the JSON string from the captured group
    - Parse with `JSON.parse()`
    - Validate required top-level fields exist: `id`, `name`, `diagram_kind`, `nodes`, `edges`, `version`
    - On validation success: call `executeToolCall` with:
      - `callId`: generate a UUID
      - `toolName`: `'saveTemporaryArchitectureDiagram'`
      - `args`: `{ projectId: threadKey.projectId, diagramJson: JSON.stringify(parsedPayload) }`
      - `mcpSessionId`: use existing session ID pattern from chatV2
      - `requestId` and `sessionId`: from existing request context
    - On extraction failure (no block found, parse error, missing fields): log a warning and return the assistant message as-is without saving
  - [x] 4.4 Implement server-side termination enforcement
    - After successful payload extraction and save tool call:
      - Persist the assistant message (including the JSON block) to the thread
      - Treat the turn as complete -- do NOT initiate another LLM turn
      - Do not strip the JSON block from the persisted message
    - This aligns with both prompt-level stop instruction (from 1.4) and server-side enforcement
  - [x] 4.5 Ensure chatV2 integration tests pass
    - Run ONLY the 5 tests written in 4.1
    - Verify context injection works for the new task
    - Verify extraction + save + termination flow works end-to-end
    - Verify graceful failure on missing/malformed payload

**Acceptance Criteria:**
- The 5 tests from 4.1 pass
- Context assembly correctly injects both `DATA MODEL CONTEXT` and `TEMPORARY DIAGRAM CONTRACT` sections
- Payload extraction reliably finds and parses the tagged JSON block
- Required field validation catches incomplete payloads
- Save tool is called with correct arguments on success
- Turn terminates after successful save
- Graceful degradation on extraction failure (warning logged, message returned as-is)

---

### Test Review

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 3 tests from Task Group 1 (task registration and prompt loading)
    - Review the 4 tests from Task Group 2 (filtered context builder)
    - Review the 3 tests from Task Group 3 (tool registration)
    - Review the 5 tests from Task Group 4 (chatV2 context assembly + extraction + save)
    - Total existing tests: 15
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify any critical integration paths not yet tested
    - Focus on: end-to-end flow from context injection through extraction to save call
    - Focus on: edge cases in extraction regex (e.g., extra whitespace, multiple code blocks, nested backticks)
    - Focus on: contract summary file loading failure
    - Do NOT assess entire gateway test coverage
  - [x] 5.3 Write up to 5 additional strategic tests to fill gaps
    - Potential gap: extraction regex with extra whitespace or trailing content after the code block
    - Potential gap: malformed JSON inside otherwise valid fenced block (parse error path)
    - Potential gap: valid JSON but wrong shape (e.g., missing `nodes` array) -- partial validation failure
    - Potential gap: `buildDataModelContextSection` when model has no data-related keys (all filtered keys absent -- returns explainer only with empty data)
    - Potential gap: contract summary file missing from disk (graceful degradation in context assembly)
    - Maximum of 5 additional tests
  - [x] 5.4 Run all feature-specific tests
    - Run ONLY tests related to this spec (from groups 1-4 plus new gap tests)
    - Expected total: approximately 15-20 tests
    - Do NOT run the entire gateway test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 15-20 tests total)
- Critical extraction edge cases are covered
- No more than 5 additional tests added
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Phase 1 (parallel):
  Task Group 1: Configuration & Prompt Assets
  Task Group 2: Filtered Data Model Context Builder
  Task Group 3: Save Tool Definition and Executor Wiring

Phase 2 (depends on Phase 1):
  Task Group 4: ChatV2 Context Assembly + Payload Extraction + Save + Termination

Phase 3 (depends on Phase 2):
  Task Group 5: Test Review & Gap Analysis
```

**Rationale:**
- Groups 1, 2, and 3 are independent of each other and can be developed in parallel. Group 1 produces the configuration files and prompt assets. Group 2 produces the context builder function. Group 3 produces the tool registration. None of these depend on each other at implementation time.
- Group 4 depends on all three Phase 1 groups because it wires them together: it imports the context builder (Group 2), references the tool name (Group 3), and the task ID check only makes sense once the task is registered (Group 1).
- Group 5 runs last to review all tests from Groups 1-4 and fill any remaining gaps.

## Files Created or Modified

| File | Action | Task Group |
|------|--------|------------|
| `gateway/src/config/tasks/architect--generate-architecture-diagram.json` | CREATE | 1 |
| `gateway/src/config/personas/architect.json` | MODIFY | 1 |
| `gateway/src/config/prompts/architect.generate-architecture-diagram.task.md` | CREATE | 1 |
| `gateway/src/config/prompts/shared/temporary-diagram-contract.md` | CREATE | 1 |
| `gateway/src/services/architectureContextBuilder.ts` | MODIFY | 2 |
| `gateway/src/__tests__/architectureContextBuilder.test.ts` | MODIFY | 2 |
| `gateway/src/types/tools.ts` | MODIFY | 3 |
| `gateway/src/services/toolExecutor.ts` | MODIFY | 3 |
| `gateway/src/routes/chatV2.ts` | MODIFY | 4 |
| `gateway/src/__tests__/chatV2-diagram-generation.test.ts` | CREATE | 4, 5 |
| `gateway/src/__tests__/tool-registration-diagram.test.ts` | CREATE | 3 |
| `gateway/src/__tests__/task-registration-diagram.test.ts` | CREATE | 1 |
