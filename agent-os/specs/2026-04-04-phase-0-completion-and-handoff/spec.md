# Specification: Phase 0 Completion and Handoff

## Goal
Wire the completion and persistence flow for the Phase 0 discovery framing conversation (Increment 4 of 16). When the conversation reaches phase="ready", the system deterministically extracts structured data from the thread, generates a discovery brief markdown document, and orchestrates three sequential saves: anchor entities to the architecture model, discovery config with status="COMPLETE", and a DISCOVERY_BRIEF_MD artifact to the project artifact store.

## User Stories
- As an architect, I want the discovery framing conversation to persist my confirmed applications, components, repos, and config when I approve the final review, so that Phase 1 code scanning can consume a well-defined scope.
- As a system operator, I want Phase 0 completion to be idempotent, so that re-running it does not create duplicates or corrupt state.

## Specific Requirements

**Task definition update -- wire artifacts for discovery-framing**
- Add an `artifacts` entry to `gateway/src/config/tasks/architect--discovery-framing.json` with `artifactId: "discovery-framing"`, `tool: "save_discovery_config"`, and a description
- Follow the pattern in `architect--define-architecture.json` which has `{ artifactId, filename, tool, description }`
- This entry causes the gateway's /generate and /save-artifact handlers to derive `artifactType = "discovery-framing"` from `taskDef.artifacts[0].artifactId`

**Frontend TASK_ARTIFACT_MAP entry**
- Add `"architect--discovery-framing"` to `TASK_ARTIFACT_MAP` in `frontend/src/hooks/useChatThread.ts`
- Set `artifactId: "discovery-framing"`, `artifactName: "DISCOVERY_BRIEF"`, `artifactKey: "discoveryBrief"`, `previewType: "artifact-preview"`
- Use `previewType: "artifact-preview"` which renders with `{ type: "artifact-preview", markdownContent }` -- no new preview component needed since the brief is markdown
- The existing phase="ready" detection at line 609 of useChatThread will auto-trigger `generateArtifact` when the user confirms the final review

**POST /generate branch -- deterministic extraction**
- Add a new `if (artifactType === 'discovery-framing')` branch in the /generate handler in `gateway/src/routes/chatV2.ts` (around line 1140, after the roadmap branch)
- Scan thread messages backwards to find the last assistant message with phase="ready" in its structuredResponse, matching the roadmap branch pattern
- Parse the structuredResponse and extract: `applications`, `appComponents`, `repos`, `repoApplicationMappings`, `techHints`, `exclusions`, `notes`, `summary`
- If no phase="ready" message is found, return `{ success: false, error: "..." }`
- Call a standalone `convertDiscoveryBriefToMarkdown(data)` function to generate the brief
- Return `{ success: true, artifactContent: markdownBrief }` where `artifactContent` is the combined payload: a JSON string containing both the structured data and the generated markdown, e.g. `JSON.stringify({ structuredData, markdownBrief })`
- No LLM call -- fully deterministic, following the roadmap /generate pattern

**Discovery brief markdown generation function**
- Create an exported function `convertDiscoveryBriefToMarkdown(data)` in `gateway/src/routes/chatV2.ts` (co-located with `convertTechStackToMarkdown` and `convertTestStrategyToMarkdown`)
- Input: object with `summary`, `applications`, `appComponents`, `repos`, `repoApplicationMappings`, `techHints`, `exclusions`, `notes`
- Output: a markdown string with these sections: heading "Discovery Brief", "Scope Summary" paragraph from summary, "Applications" table (name, description), "Application Components" table (name, parent application, description), "Repositories" table (URL, branch, include paths, exclude paths), "Repository-Application Mappings" table (repo URL, path, application), "Technology Hints" table (repo URL, path, technology, language), "Exclusions" table (pattern, reason), "Notes and Assumptions" bulleted list
- Omit any section where the corresponding array is empty
- Follow the template pattern of `convertTechStackToMarkdown`: build a `lines: string[]` array, push headers and table rows, join with `\n`

**POST /save-artifact branch -- three sequential saves**
- Add a new `else if (artifactType === 'discovery-framing')` branch in the /save-artifact handler in `gateway/src/routes/chatV2.ts` (around line 2300, before the else/mission fallback)
- Parse the `content` from the request body as JSON to recover `structuredData` and `markdownBrief`
- Execute three saves sequentially; if any fails, return `{ success: false, error }` with a message identifying which save failed, but do NOT roll back previously completed saves
- **Save 1 -- Anchor entities**: Perform a direct GET-merge-PUT on the architecture model to add the discovered applications and app_components. Use the gateway's existing import of `fetchProjectFolder` to derive the project filename. Call the MCP server via a new `save_project_anchor_entities` MCP tool (see next requirement) with `{ projectId, applications, appComponents }`. This is needed because `save_architecture_baseline` only creates a single "Core Application"/"Core Component" placeholder -- it cannot persist multiple named applications and app_components from discovery framing
- **Save 2 -- Discovery config**: Call `executeToolCall` with tool `save_discovery_config` and params `{ projectId, discoveryConfigJson }` where discoveryConfigJson is the structured data with `status: "COMPLETE"` injected. The existing `discoveryConfigService` extracts status from the parsed JSON
- **Save 3 -- Discovery brief artifact**: Call `executeToolCall` with a new `create_project_artifact` MCP tool (see next requirement) with params `{ projectId, artifactType: "DISCOVERY_BRIEF_MD", content: markdownBrief, source: "discovery-framing" }`
- Set `completionContent`, `completionArtifactId`, `completionArtifactName` for the completion chip that follows

**New MCP tool: create_project_artifact**
- Create a new MCP route `mcp-server/src/routes/createProjectArtifactRoute.ts` that accepts `{ sessionId, projectId, artifactType, content, source }` and delegates to `archModelClient.createProjectArtifact(projectId, artifactType, content, source)`
- Mount at `/mcp/tools/create_project_artifact` in `mcp-server/src/routes/tools.ts`
- Add `create_project_artifact` to the gateway's `ToolName` union, `ALLOWED_TOOL_NAMES`, `TOOL_ENDPOINTS`, and `TOOL_REQUIRED_PARAMS` in `gateway/src/types/tools.ts` and `gateway/src/services/toolExecutor.ts`
- This is needed because `archModelClient.createProjectArtifact` lives in the MCP server, and the gateway must route all writes through MCP tool endpoints via `executeToolCall`

**New MCP tool: save_project_anchor_entities**
- Create a new MCP route `mcp-server/src/routes/saveProjectAnchorEntitiesRoute.ts` that accepts `{ sessionId, projectId, applications, appComponents }` where applications is an array of `{ name, description }` and appComponents is an array of `{ name, applicationName, description }`
- The service logic performs GET model, builds application and app_component entity objects with generated IDs, deduplicates by name against existing entities, merges into the model, and PUTs the updated model -- a targeted version of the architecture baseline GET-merge-PUT that operates only on applications and app_components
- Mount at `/mcp/tools/save_project_anchor_entities` in `mcp-server/src/routes/tools.ts`
- Add `save_project_anchor_entities` to the gateway's `ToolName` union, `ALLOWED_TOOL_NAMES`, `TOOL_ENDPOINTS`, and `TOOL_REQUIRED_PARAMS` in `gateway/src/types/tools.ts` and `gateway/src/services/toolExecutor.ts`
- Reuse `archModelClient.getProjectById`, `archModelClient.getModel`, `archModelClient.putModel`, and `generateId` from the existing codebase
- Name-based deduplication: if an application or app_component with the same name already exists, skip it (do not create a duplicate)

**Completion chip after successful saves**
- After all three saves succeed, build and persist a completion chip ThreadMessage following the existing pattern at chatV2.ts line 2392
- Use `completionArtifactId: "discovery-framing"`, `completionArtifactName: "DISCOVERY_BRIEF"`, `completionContent: "Discovery Framing complete."`
- The existing completion chip code after the artifact type branches handles persisting the chip to the thread and returning `{ success: true }`

**Idempotent completion**
- Re-running Phase 0 completion must not duplicate entities: anchor entity save uses name-based dedup; discovery config uses upsert semantics (one per project); discovery brief artifact creates a new revision (acceptable, the artifact store supports revisions)
- No additional idempotency logic is needed beyond what the tool implementations provide

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**Roadmap /generate branch (chatV2.ts line 1140)**
- Deterministic thread extraction pattern: scans messages backwards for last assistant message, parses JSON, extracts structured data
- Returns `{ success: true, artifactContent }` with no LLM call
- The discovery-framing /generate branch should follow this exact pattern, scanning for `phase === "ready"` instead of `proposedInitiatives`

**convertTechStackToMarkdown / convertTestStrategyToMarkdown (chatV2.ts line 465)**
- Template for deterministic JSON-to-markdown conversion functions
- Uses `lines: string[]` array pattern with push and join
- The `convertDiscoveryBriefToMarkdown` function should be defined adjacent to these, exported, and follow the same structure

**save_discovery_config MCP tool (discoveryConfigService.ts, saveDiscoveryConfigRoute.ts)**
- Already handles JSON parsing, validation, project existence check, status extraction (defaults to "DRAFT"), and persistence via `archModelClient.saveDiscoveryConfig`
- The /save-artifact branch injects `status: "COMPLETE"` into the structured data before stringifying it as `discoveryConfigJson`

**archModelClient.createProjectArtifact (archModelClient.ts line 370)**
- Calls POST to `/api/model/projects/{projectId}/artifacts/{artifactType}` with `{ content, source }`
- Lives in the MCP server; the new `create_project_artifact` MCP tool route wraps this method for gateway access via executeToolCall

**Completion chip pattern (chatV2.ts line 2392)**
- Builds a ThreadMessage with `structuredResponse.type = "completion-chip"` containing `artifactId`, `artifactName`, `taskId`, `personaId`, `timestamp`
- Appends to thread via `appendMessage(tk, completionChip)`
- Runs discovery insights extraction non-blocking afterwards

## Out of Scope
- Phase 1 discovery execution or repo scanning
- Evidence schema or DecisionTask engine
- New frontend UI components or screens beyond the existing artifact-preview and completion-chip rendering
- Refinement or review UX for the discovery brief
- Log-based or hypothesis-first discovery approaches
- Analyzer packs or AST functionality
- Transaction rollback across the three MCP saves
- Explicit handoff manifest or separate handoff data structure (handoff is implicit in persisted data)
- LLM-based brief generation (deterministic template only in this increment)
- Changes to the architecture-model-service Java backend (all persistence contracts already exist from Increment 2)
- Frontend preview component for discovery brief (reuse existing artifact-preview markdown rendering)
