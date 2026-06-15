# Specification: Increment 7 -- SA Tech Stack + TE Test Strategy End-to-End

## Goal
Wire two bootstrap conversations through the hub conversation engine: Solution Architect "Define Tech Stack" (4th bootstrap) and Test Engineer "Define Test Strategy" (5th bootstrap), including task registration, context injection, JSON-mode artifact generation with corrective retry, preview bubbles, a new generic `save_markdown_artifact` MCP tool, dashboard integration, and completion chips.

## User Stories
- As a Solution Architect, I want to define a categorized tech stack through a guided discovery conversation so that the project has a documented set of technology choices, design decisions, and constraints.
- As a Test Engineer, I want to define a test strategy through a guided discovery conversation so that the project has documented test levels, quality gates, and testing principles.
- As any team member, I want tech stack and test strategy artifacts to be saved as markdown files and reflected on the dashboard so that I can see at a glance whether these foundational artifacts exist.

## Specific Requirements

**R1: New Task Definition -- architect--define-tech-stack**
- Create `gateway/src/config/tasks/architect--define-tech-stack.json` following the exact structure of `architect--define-architecture.json`
- Set `mode: "discovery"`, `persistence: "hub"`, `availableFrom: ["hub"]`
- Set `responseFormat` with phase/section/questions/summary structure; section enum values appropriate for tech stack discovery (e.g., `current_landscape`, `frontend_tech`, `backend_tech`, `data_storage`, `infrastructure`, `dev_tooling`, `design_decisions`, `constraints_review`, `final_review`)
- Set `contextNeeds: ["mission", "architecture-baseline"]`
- Set `artifacts: [{ artifactId: "tech-stack", filename: "TECH-STACK.MD", tool: "save_markdown_artifact", description: "Technology stack definition" }]`
- Set `taskPromptRef: "prompts/architect.define-tech-stack.task.md"`
- Do NOT modify the existing `architect--tech-standards.json` advisory task

**R2: Upgrade Existing Task Definition -- test-engineer--test-strategy**
- Modify `gateway/src/config/tasks/test-engineer--test-strategy.json` in-place; keep the existing task ID `test-engineer--test-strategy`
- Add structured `responseFormat` with phase/section/questions/summary structure; section enum values appropriate for test strategy discovery (e.g., `project_context`, `test_levels`, `coverage_targets`, `tooling`, `quality_gates`, `testing_principles`, `strategy_review`, `final_review`)
- Set `contextNeeds: ["mission", "roadmap", "tech-stack"]`
- Set `artifacts: [{ artifactId: "test-strategy", filename: "TEST-STRATEGY.MD", tool: "save_markdown_artifact", description: "Test strategy definition" }]`
- Keep existing fields unchanged: `id`, `personaId`, `menuLabel`, `description`, `mode`, `persistence`, `availableFrom`, `taskPromptRef`

**R3: Discovery Prompts**
- Create `gateway/src/config/prompts/architect.define-tech-stack.task.md` -- detailed multi-section discovery prompt guiding the SA through tech stack definition; reference the section enum values from R1
- Replace the one-line stub in `gateway/src/config/prompts/test-engineer.test-strategy.task.md` with a detailed multi-section discovery prompt guiding the TE through test strategy definition; reference the section enum values from R2
- Both prompts must instruct the LLM to use the structured responseFormat (phase/section/questions/summary JSON) and to signal `phase: "ready"` when sufficient information has been gathered

**R4: Context Injection -- Tech Stack Conversation**
- In `chatV2.ts` POST `/` handler, add a new inline context assembly block for `task.id === 'architect--define-tech-stack'` following the architecture task pattern at lines 1322-1358
- Load MISSION.MD with two-path fallback (MISSION.MD then mission.md) into `resolvedContext['MISSION']`
- Call `fetchMetaModelSummary(projectId)` and serialize the result as JSON into `resolvedContext['ARCHITECTURE BASELINE']`; if null, log debug and skip
- Load TECH-STACK.MD with two-path fallback into `resolvedContext['TECH STACK']` (optional; if not found, log debug and proceed)
- If TECH-STACK.MD exists, inject a system hint into the context indicating this is an update to an existing tech stack
- No deterministic first-turn short-circuit; the LLM drives discovery naturally

**R5: Context Injection -- Test Strategy Conversation**
- In `chatV2.ts` POST `/` handler, add a new inline context assembly block for `task.id === 'test-engineer--test-strategy'`
- Load MISSION.MD with two-path fallback into `resolvedContext['MISSION']`
- Call `fetchProductSummary(projectId)` and use `buildRoadmapSummary()` (already imported) to serialize roadmap into `resolvedContext['ROADMAP']`; if no roadmap, log debug and skip
- Load TECH-STACK.MD with two-path fallback into `resolvedContext['TECH STACK']` (optional)
- If TEST-STRATEGY.MD exists, inject a system hint indicating this is an update
- No deterministic first-turn short-circuit

**R6: Generation -- Tech Stack Artifact**
- In `chatV2.ts` POST `/generate` handler, add a new branch for `artifactType === 'tech-stack'`
- Create a `TECH_STACK_GENERATION_PROMPT_TEMPLATE` in `promptBuilder.ts` with placeholders: `{missionContent}`, `{architectureContext}`, `{existingTechStack}`, `{conversationTranscript}`
- The template must define the target JSON schema: `{ categories: [{ name: string, technologies: [{ name: string, version: string, purpose: string, rationale: string }] }], designDecisions: [{ title: string, description: string, rationale: string }], constraints: [{ name: string, description: string, type: string }] }`
- Use `sendChatRequest` with `{ jsonMode: true, temperature: 0.2, maxTokens: 16000 }`
- Implement a `validateTechStackJsonShape(parsed)` function checking: top-level has `categories` (array), `designDecisions` (array), `constraints` (array); each category has `name` (string) and `technologies` (array); each technology has `name` (string)
- On first validation failure, append invalid response + corrective instruction, retry once with same options
- On success, return `{ success: true, artifactContent: JSON.stringify(parsedJson) }`

**R7: Generation -- Test Strategy Artifact**
- In `chatV2.ts` POST `/generate` handler, add a new branch for `artifactType === 'test-strategy'`
- Create a `TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE` in `promptBuilder.ts` with placeholders: `{missionContent}`, `{roadmapContext}`, `{techStackContent}`, `{conversationTranscript}`
- The template must define the target JSON schema: `{ testLevels: [{ name: string, scope: string, coverageTarget: string, tools: string[], rationale: string }], qualityGates: [{ name: string, criteria: string[], enforcement: string }], testingPrinciples: [{ title: string, description: string }] }`
- Use `sendChatRequest` with `{ jsonMode: true, temperature: 0.2, maxTokens: 16000 }`
- Implement a `validateTestStrategyJsonShape(parsed)` function checking: top-level has `testLevels` (array), `qualityGates` (array), `testingPrinciples` (array); each testLevel has `name` (string); each qualityGate has `name` (string)
- On first validation failure, corrective retry once (same pattern as tech stack)
- On success, return `{ success: true, artifactContent: JSON.stringify(parsedJson) }`

**R8: New Generic save_markdown_artifact MCP Tool**
- Create a new MCP route `mcp-server/src/routes/saveMarkdownArtifactRoute.ts` following the `saveProductArtifactsRoute.ts` atomic write pattern (mkdir + write .tmp + rename)
- Params: `{ sessionId: string, projectId: string, artifactFilename: string, markdown: string }`
- Validation: `projectId` must be valid UUID; `artifactFilename` must be a safe filename (no `..`, no `/` or `\`, must end in `.MD` or `.md`); `markdown` must be non-empty string, max 200KB
- Write to `<basePath>/agent-os/product/<artifactFilename>` where basePath is resolved from config (same pattern as saveProductArtifactsRoute)
- Register the new route in MCP server's tools router at `/mcp/tools/save_markdown_artifact`
- In `gateway/src/types/tools.ts`: add `'save_markdown_artifact'` to the `ToolName` union, `ALLOWED_TOOL_NAMES` array, add `SaveMarkdownArtifactParams` interface, add to `ToolParams` union, add OpenAI tool definition to `TOOL_DEFINITIONS`
- In `gateway/src/services/toolExecutor.ts`: add endpoint mapping `save_markdown_artifact: '/mcp/tools/save_markdown_artifact'`, add required params `['projectId', 'artifactFilename', 'markdown']`

**R9: Save-Artifact Adapter -- Tech Stack and Test Strategy**
- In `chatV2.ts` POST `/save-artifact` handler, add two new adapter branches
- For `artifactType === 'tech-stack'`: parse content as JSON, convert to markdown (categories with technology tables, design decisions list, constraints list), call `executeToolCall` with `save_markdown_artifact` tool and `{ projectId, artifactFilename: 'TECH-STACK.MD', markdown }`, set completion metadata accordingly
- For `artifactType === 'test-strategy'`: parse content as JSON, convert to markdown (test levels with details, quality gates, testing principles), call `executeToolCall` with `save_markdown_artifact` tool and `{ projectId, artifactFilename: 'TEST-STRATEGY.MD', markdown }`, set completion metadata accordingly
- Both branches must include JSON-to-markdown conversion logic that produces human-readable markdown from the structured JSON
- Completion chip content: `'Tech Stack complete.'` and `'Test Strategy complete.'` respectively

**R10: TechStackPreviewBubble Component**
- Create `frontend/src/components/UnifiedChat/TechStackPreviewBubble.tsx` following the `ArchitecturePreviewBubble.tsx` pattern
- Parse JSON content into the tech stack shape; show error state if malformed
- Header: "Generated Tech Stack" with counts (N categories, M technologies total)
- Collapsible category sections: each category header shows name and technology count; expanded view shows technology rows with name, version, purpose
- Collapsible "Design Decisions" section listing title + description + rationale
- Collapsible "Constraints" section listing name + description + type
- "Show JSON" / "Show Summary" toggle button
- Confirm/Reject action buttons (same props pattern: onConfirm, onReject, isConfirming, disabled)
- Create matching CSS module `TechStackPreviewBubble.module.css`

**R11: TestStrategyPreviewBubble Component**
- Create `frontend/src/components/UnifiedChat/TestStrategyPreviewBubble.tsx` following the same pattern
- Parse JSON content into the test strategy shape; show error state if malformed
- Header: "Generated Test Strategy" with counts (N test levels, M quality gates)
- Collapsible "Test Levels" section: each level shows name, scope, coverage target, tools list, rationale
- Collapsible "Quality Gates" section: each gate shows name, criteria list, enforcement
- Collapsible "Testing Principles" section: each principle shows title + description
- "Show JSON" / "Show Summary" toggle and Confirm/Reject buttons
- Create matching CSS module `TestStrategyPreviewBubble.module.css`

**R12: MessageBubble Type Guards and Rendering**
- In `MessageBubble.tsx`, add `isTechStackPreview` type guard for `structuredResponse.type === 'tech-stack-preview'`
- Add `isTestStrategyPreview` type guard for `structuredResponse.type === 'test-strategy-preview'`
- Add rendering branches for TechStackPreviewBubble and TestStrategyPreviewBubble in the conditional chain, after the architecture-preview branch
- Update the `showQuestions` guard to exclude both new preview types
- Import TechStackPreviewBubble and TestStrategyPreviewBubble components

**R13: TASK_ARTIFACT_MAP Entries**
- In `useChatThread.ts`, add 4th entry: `'architect--define-tech-stack': { artifactId: 'tech-stack', artifactName: 'TECH-STACK.MD', artifactKey: 'techStack', completionMessage: 'Tech Stack complete.', warningText: 'A Tech Stack already exists. Completing this conversation will replace it.', previewType: 'tech-stack-preview' }`
- Add 5th entry: `'test-engineer--test-strategy': { artifactId: 'test-strategy', artifactName: 'TEST-STRATEGY.MD', artifactKey: 'testStrategy', completionMessage: 'Test Strategy complete.', warningText: 'A Test Strategy already exists. Completing this conversation will replace it.', previewType: 'test-strategy-preview' }`
- In `generateArtifact` callback, add `else if` branches for `previewType === 'tech-stack-preview'` and `previewType === 'test-strategy-preview'` that build the correct `structuredResponse` with `{ type: previewType, content: artifactContent }`

**R14: Dashboard Integration**
- In `dashboardSummary.ts`, add exists/not-exists checks for TECH-STACK.MD and TEST-STRATEGY.MD using `fs.access` with two-path fallback (same pattern as MISSION.MD check at lines 86-98)
- Use the existing `strategicFoundation.standards.companyStandards` metric to reflect tech stack presence (value 1 if TECH-STACK.MD exists, 0 otherwise) and `strategicFoundation.standards.productStandards` to reflect test strategy presence (value 1 if TEST-STRATEGY.MD exists, 0 otherwise)
- In `DashboardView.tsx`, add `techStack` and `testStrategy` keys to the `artifactExists` record passed to `UnifiedChatPanel`, derived from the standards metrics: `techStack: (data?.strategicFoundation?.standards?.companyStandards?.value ?? 0) > 0` and `testStrategy: (data?.strategicFoundation?.standards?.productStandards?.value ?? 0) > 0`

**R15: Transcript Download Extension**
- In `UnifiedChatPanel.tsx` `handleDownloadTranscript`, add branches for `architect--define-tech-stack` and `test-engineer--test-strategy` task IDs
- For tech stack: `artifactDescription = 'TECH-STACK.MD (technology stack)'`, `filename = 'architect-define-tech-stack-transcript.md'`
- For test strategy: `artifactDescription = 'TEST-STRATEGY.MD (test strategy)'`, `filename = 'test-engineer-test-strategy-transcript.md'`

## Visual Design
No visual mockups were provided. Preview bubble components should follow the established visual patterns from ArchitecturePreviewBubble (bordered container, collapsible sections with chevron and count, Show JSON toggle, Confirm/Reject button pair).

## Existing Code to Leverage

**ArchitecturePreviewBubble.tsx -- Preview bubble template**
- Collapsible sections with expand/collapse chevron and item counts in headers
- "Show JSON" / "Show Summary" toggle between readable and raw view
- Confirm/Reject action buttons with isConfirming and disabled props
- Parse helper pattern for JSON content with graceful error handling
- Matching CSS module structure; replicate for both TechStackPreviewBubble and TestStrategyPreviewBubble

**chatV2.ts -- /generate and /save-artifact patterns (lines 607-732, 921-1009, 1322-1358)**
- Architecture baseline /generate branch: direct LLM call with `jsonMode: true`, `temperature: 0.2`, `maxTokens: 64000`, JSON shape validation, corrective retry -- replicate with maxTokens=16000
- /save-artifact adapter pattern: derive artifactType from task registry, branch to correct MCP tool call via `executeToolCall`, build completion chip -- add two new branches
- Inline context assembly pattern for architecture task: two-path file fallback, optional context injection -- replicate for tech stack and test strategy context blocks

**toolExecutor.ts + tools.ts -- Tool registration pattern**
- `ToolName` union type, `ALLOWED_TOOL_NAMES` array, `TOOL_ENDPOINTS` mapping, `TOOL_REQUIRED_PARAMS` mapping, `TOOL_DEFINITIONS` array, and typed params interfaces
- Add `save_markdown_artifact` following the exact same pattern as existing tools like `save_roadmap_structure`

**saveProductArtifactsRoute.ts -- MCP save route template**
- UUID validation, byte-length limit, atomic write (mkdir + tmp + rename) pattern
- Error handling with `createHttpError` and session management
- Use as reference for implementing `saveMarkdownArtifactRoute.ts` with added filename safety validation (no path traversal)

**useChatThread.ts TASK_ARTIFACT_MAP + generateArtifact (lines 64-96, 291-370)**
- TASK_ARTIFACT_MAP constant with per-task artifact metadata, currently 3 entries -- add 2 more
- `generateArtifact` callback with previewType-based routing for structuredResponse construction -- add branches for `tech-stack-preview` and `test-strategy-preview`
- `confirmArtifact` and `selectTask` consume mapping data generically; no changes needed beyond adding map entries

## Out of Scope
- External standards service or governance tooling integration
- Tech stack auto-detection from existing codebase or package files
- Version checking, dependency analysis, or migration path analysis between tech stacks
- Changes to the existing `architect--tech-standards` advisory task (DO NOT MODIFY `architect--tech-standards.json`)
- Test-case generation, test suite scaffolding, or anything beyond high-level test strategy
- CI/CD pipeline configuration or integration
- Restructuring the dashboard `strategicFoundation` section layout or adding new card types
- Rich metric counts (technology count, coverage percentages) on dashboard cards -- exists/not-exists booleans only
- Renaming the `test-engineer--test-strategy` task ID (keep as-is, upgrade in-place)
- Context resolver registry refactoring (inline context assembly only, matching existing pattern)
