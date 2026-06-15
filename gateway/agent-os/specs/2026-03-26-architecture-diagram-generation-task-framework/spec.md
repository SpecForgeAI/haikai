# Specification: Architecture Diagram Generation Task Framework (ER First)

## Goal
Introduce a new Architect persona workflow task that generates a `TemporaryArchitectureDiagram` payload from the project's existing architecture data model using a structured 4-question conversational flow, then saves the result via a server-side MCP tool invocation and terminates.

## User Stories
- As an architect, I want to generate an ER diagram from my saved data model so that I can visualize entity relationships without manually drawing them.
- As an architect, I want to choose between logical and physical views, select specific entities, and control attribute visibility so that the generated diagram matches my current need.

## Specific Requirements

**Task Definition Registration**
- New task JSON file at `gateway/src/config/tasks/architect--generate-architecture-diagram.json`
- Fields: `id: "architect--generate-architecture-diagram"`, `personaId: "architect"`, `mode: "workflow"`, `responseFormat: null`, `persistence: "panel"`, `availableFrom: ["panel"]`, `contextNeeds: []`, `phases: null`, `artifacts: []`
- `menuLabel: "Generate ER Diagram"` and a `description` summarizing the task's purpose
- Add the task ID `"architect--generate-architecture-diagram"` to the `tasks` array in `gateway/src/config/personas/architect.json`

**Task Prompt File**
- New prompt file at `gateway/src/config/prompts/architect.generate-architecture-diagram.task.md`
- The prompt must define the complete 4-question workflow sequence, confirmation step, generation step, and stop instruction
- The prompt must embed all behavioral rules and prohibitions (detailed in the Behavioral Rules requirement below)
- The prompt must instruct the LLM to wrap its generated `TemporaryArchitectureDiagram` JSON payload in a fenced code block tagged `json:temporaryArchitectureDiagram` so that server-side extraction can reliably locate it
- The prompt must instruct the LLM to stop generating content after producing the JSON payload -- no follow-up explanation, no UI instructions

**4-Question Conversational Flow**
- The task asks exactly these four questions (prompt-enforced, not schema-enforced): (1) "Should this be a logical or physical ER diagram?" (2) "Which entities should be included: all entities or a specific subset?" (3) "Which attributes should be shown: all, none, or key attributes (primary and foreign keys)?" (4) "Should relationship cardinalities be shown?"
- All 4 questions may be asked in a single turn (the LLM presents all four at once)
- The LLM must not proceed to generation until all 4 are answered
- After receiving answers, the LLM provides a brief confirmation restating: diagram_kind=ER, view_mode (LOGICAL or PHYSICAL), entity selection, attribute display mode, and cardinality preference
- After the user confirms (or does not object), the LLM generates the full `TemporaryArchitectureDiagram` JSON payload

**Filtered Data Model Context Builder**
- New exported async function `buildDataModelContextSection(projectId: string): Promise<string>` in `gateway/src/services/architectureContextBuilder.ts`
- Calls `fetchFullArchitectureContext(projectId)` then filters the returned model to include ONLY: `logical_data_entities`, `logical_data_attributes`, `physical_data_entities`, `physical_data_attributes`, `logical_data_entity_relationships`, `logical_data_entity_physical_data_entities`
- Combines the filtered data with the architecture explainer (from `loadArchitectureExplainer()`) into a single context section string, following the same pattern as `buildArchitectureContextSection`
- Returns empty string on fetch failure (graceful degradation)

**Context Assembly Wiring in chatV2.ts**
- New inline context assembly block in the chatV2 route, following the existing pattern at lines ~2931-3004 (the `architect--detailed-data-model` and `fullArchContextTasks` blocks)
- When `task.id === 'architect--generate-architecture-diagram'`, call `buildDataModelContextSection(threadKey.projectId)` and inject the result into `resolvedContext['DATA MODEL CONTEXT']`
- Also load and inject the condensed contract summary markdown file content into `resolvedContext['TEMPORARY DIAGRAM CONTRACT']`
- The condensed contract file is at `gateway/src/config/prompts/shared/temporary-diagram-contract.md`

**Condensed TemporaryArchitectureDiagram Contract Summary**
- New markdown file at `gateway/src/config/prompts/shared/temporary-diagram-contract.md`
- Human-readable condensed summary of the `TemporaryArchitectureDiagram` TypeScript contract from `frontend/src/types/temporaryArchitectureDiagram.ts`
- Must cover: top-level required fields (`id`, `name`, `diagram_kind`, `source_architecture_domain`, `view_mode`, `version`, `nodes`, `edges`), node structure (required fields, `compartments` for attributes), edge structure (required fields, optional `cardinality`, `relationship_type`, labels), compartment item structure, point structure
- Must state the "no architecture IDs" rule: all `id` fields are local payload-only identifiers; all cross-referencing uses `ref_name` exact name matching
- Must state ER-specific semantic_type constraints: LOGICAL view uses `LOGICAL_DATA_ENTITY` / `LOGICAL_DATA_ATTRIBUTE`; PHYSICAL view uses `PHYSICAL_DATA_ENTITY` / `PHYSICAL_DATA_ATTRIBUTE`
- Must state `version: 1` and `source_architecture_domain: "DATA"`

**Server-Side Payload Extraction and Save**
- After the LLM produces a response for the `architect--generate-architecture-diagram` task, server-side code in chatV2.ts scans the assistant's response content for a fenced code block tagged `json:temporaryArchitectureDiagram`
- Extracts the JSON string from within that code block and parses it
- Validates that the parsed object has required top-level fields (`id`, `name`, `diagram_kind`, `nodes`, `edges`, `version`)
- Calls `executeToolCall` with tool name `saveTemporaryArchitectureDiagram` and arguments `{ projectId, diagramJson: <stringified payload> }`
- On successful extraction and save call, the server treats the turn as complete: the assistant message (including the JSON block) is persisted to the thread, and no further LLM turn is initiated
- On extraction failure (no JSON block found, parse error, missing required fields): log a warning and return the assistant message as-is without saving -- the user can retry

**Tool Definition for saveTemporaryArchitectureDiagram**
- Add `'saveTemporaryArchitectureDiagram'` to the `ToolName` union type in `gateway/src/types/tools.ts`
- Add it to the `ALLOWED_TOOL_NAMES` array
- Add a new `ToolDefinition` entry in `TOOL_DEFINITIONS` with: name `saveTemporaryArchitectureDiagram`, description "Save a temporary architecture diagram payload for future mapping and rendering", parameters `{ projectId: string (required), diagramJson: string (required) }`
- Add new `SaveTemporaryArchitectureDiagramParams` interface with `projectId: string` and `diagramJson: string`
- Add endpoint mapping in `toolExecutor.ts` `TOOL_ENDPOINTS`: `saveTemporaryArchitectureDiagram: '/mcp/tools/saveTemporaryArchitectureDiagram'`
- Add required params in `TOOL_REQUIRED_PARAMS`: `saveTemporaryArchitectureDiagram: ['projectId', 'diagramJson']`
- The actual MCP endpoint on architecture-model-service is NOT implemented in this increment; the tool wiring allows the call to be made and will return an error from the downstream service until the endpoint exists

**Behavioral Rules and Prohibitions (enforced via prompt)**
- Use ONLY entities and attributes present in the injected data model context -- never hallucinate entities or attributes
- Use EXACT entity and attribute names as they appear in the context -- never abbreviate or rename
- NEVER create `data_entity_points`, `application_points`, `business_points`, `app_business_points`, or any `*_points` wrapper entities
- NEVER create, update, or delete architecture model entities -- this task is read-only; it only generates a diagram view
- NEVER output native diagram JSON (DiagramNode, DiagramEdge from model.ts) -- ONLY output `TemporaryArchitectureDiagram`
- Limited to ER diagrams only (`diagram_kind: "ER"`) in this increment -- decline requests for other diagram kinds
- If the injected data model context contains zero logical_data_entities AND zero physical_data_entities, decline generation with a clear message explaining that no data entities are available
- All `id` fields in the output are local payload identifiers (e.g. `"node-1"`, `"edge-1"`) -- no architecture entity IDs, attribute IDs, or relationship IDs from the model

**Unit Tests**
- Unit tests for `buildDataModelContextSection` in a new or existing test file alongside `architectureContextBuilder.ts` tests: verify correct filtering of model keys, verify explainer is included, verify empty string on fetch failure
- Unit tests for the server-side payload extraction logic: verify extraction from a fenced `json:temporaryArchitectureDiagram` block, verify parse and validation of required fields, verify behavior on missing block or malformed JSON

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**`architect--oas-spec.json` task definition (closest workflow-mode pattern)**
- Uses `mode: "workflow"`, `responseFormat: null`, `contextNeeds: []`, `persistence: "panel"`, `availableFrom: ["panel"]`
- The new task definition should replicate this exact structure with its own id, menuLabel, description, and taskPromptRef

**`architectureContextBuilder.ts` (context builder pattern)**
- `fetchFullArchitectureContext(projectId)` fetches the full model and strips diagrams -- reuse this as the data source for the new filtered builder
- `loadArchitectureExplainer()` loads the shared explainer markdown -- reuse this unchanged in the new function
- `buildArchitectureContextSection(projectId)` combines explainer + full model JSON -- the new `buildDataModelContextSection` follows the same compose pattern but filters model keys before stringifying

**chatV2.ts inline context assembly blocks (lines ~2931-3004)**
- The `architect--detailed-data-model` block shows the pattern: check `task.id`, call context builder, inject into `resolvedContext[KEY]`
- The new block for `architect--generate-architecture-diagram` follows this same pattern but calls `buildDataModelContextSection` and also loads the contract summary file

**`tools.ts` and `toolExecutor.ts` (tool registration pattern)**
- `ToolName` union, `ALLOWED_TOOL_NAMES`, `TOOL_DEFINITIONS`, `TOOL_ENDPOINTS`, `TOOL_REQUIRED_PARAMS` all follow a consistent additive pattern
- Adding `saveTemporaryArchitectureDiagram` means one new entry in each of these five locations plus a new params interface

**`promptComposer.ts` (prompt assembly pipeline)**
- The pipeline automatically assembles Layer 1 (identity from `architect.identity.md`) + Layer 2 (task prompt from the new `.task.md` file) + Layer 3 (resolved context sections with `=== SECTION_NAME ===` delimiters)
- No changes needed to the composer itself; the new task only needs its context sections populated in `resolvedContext` before `composeSystemPrompt()` is called

## Out of Scope
- MCP endpoint implementation on architecture-model-service for `saveTemporaryArchitectureDiagram`
- Diagram rendering (canvas, SVG, React components)
- Auto-mapping from temporary diagram names to native entity IDs
- Matching modal UX for name resolution
- Final diagram persistence (converting TemporaryArchitectureDiagram to native Diagram/DiagramNode/DiagramEdge)
- Support for non-ER diagram kinds (Sequence, Activity, State, Class, etc.)
- Frontend UI changes (no new React components, panels, or buttons)
- Hub-level availability of this task (panel-only for this increment)
- Hot-reloading of the task definition (follows existing startup-load pattern)
- Streaming/SSE support for the diagram generation response
