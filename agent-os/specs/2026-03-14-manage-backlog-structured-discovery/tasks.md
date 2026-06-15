# Task Breakdown: Manage Backlog -- Structured Discovery Task (Backend)

## Overview
Total Tasks: 13

Converts the existing advisory backlog task into a full structured discovery task with questions, generation, and save pipeline. Modeled on the existing "Build Roadmap" task. Changes span the gateway (task config, prompt, context builder, route branches, tool definitions) and MCP server (types, service, route).

## Task List

### Gateway Configuration

- [x] Task 1: Update task definition `gateway/src/config/tasks/product-manager--backlog.json`
  - Changed mode from `advisory` to `discovery`
  - Added `responseFormat` with 9 required fields and 5 discovery sections
  - Added `artifacts` array with `save_backlog_items` tool
  - Updated `contextNeeds` to `["mission"]`

- [x] Task 2: Create task prompt `gateway/src/config/prompts/product-manager.backlog.task.md`
  - 5 discovery sections: epic_selection, feature_identification, story_decomposition, acceptance_criteria, final_review
  - 16 rules matching roadmap prompt pattern
  - Context usage, question strategy, handling uncertainty sections

### Gateway Services

- [x] Task 3: Extend WorkItemRaw and EpicSummary
  - Added `priority` and `sort_order` to `WorkItemRaw` interface
  - Added optional `priority` and `sortOrder` to `EpicSummary` interface
  - Populated new fields in `fetchProductSummary`

- [x] Task 4: Create backlog-specific epic list builder
  - New file: `gateway/src/services/backlogContextBuilder.ts`
  - `buildEpicListForBacklog(projectId)` function
  - Groups epics by initiative with ID, title, priority, feature count

### Gateway Routes (chatV2.ts)

- [x] Task 5: Add inline context assembly and first-turn short-circuit
  - Step 5f-2: Inline context assembly for backlog task (MISSION.MD + epic list)
  - Step 5f-3: Deterministic first-turn short-circuit (Path A: epics exist, Path B: no epics)

- [x] Task 6: Add /generate branch for backlog
  - Deterministic extraction of `proposedFeatures`, `selectedEpic`, `epicPriorityUpdates` from thread
  - Validation: features non-empty, selectedEpic non-null

- [x] Task 7: Add /save-artifact branch for backlog
  - JSON parse validation
  - Routes to `save_backlog_items` MCP tool
  - Completion chip: `Backlog complete.`

### Gateway Tool Registration

- [x] Task 8: Add MCP tool definition
  - Added `save_backlog_items` to `ToolName` union, `ALLOWED_TOOL_NAMES`, `TOOL_DEFINITIONS`
  - Added `SaveBacklogItemsParams` interface

- [x] Task 13: Register tool in gateway's tool executor
  - Added `save_backlog_items` to `TOOL_ENDPOINTS` and `TOOL_REQUIRED_PARAMS`
  - Added `SaveBacklogItemsParams` import

### MCP Server

- [x] Task 9: Create MCP server types
  - New file: `mcp-server/src/types/saveBacklogItems.ts`
  - Types: `BacklogStoryInput`, `BacklogFeatureInput`, `EpicPriorityUpdate`, `BacklogInput`, `SaveBacklogItemsRequest`, `SaveBacklogItemsResult`
  - Re-exported from `mcp-server/src/types/index.ts`

- [x] Task 10: Create MCP server service
  - New file: `mcp-server/src/services/backlogItemsService.ts`
  - `parseAndValidateBacklogJson`: validates epicId, features, titles, uniqueness
  - `saveBacklogItems`: Phase 0 (epic priorities), Phase 1 (upsert features), Phase 2 (upsert stories)
  - Story description builder concatenates description + acceptance criteria

- [x] Task 11: Create MCP server route
  - New file: `mcp-server/src/routes/saveBacklogItemsRoute.ts`
  - POST / with sessionId, projectId, backlogJson validation
  - 400/502 error handling pattern

- [x] Task 12: Register the MCP route
  - Added import and mount in `mcp-server/src/routes/tools.ts`
  - Mounted at `/mcp/tools/save_backlog_items`

## Key File Reference

| Layer | File | Change Type |
|-------|------|-------------|
| Gateway Task Config | `gateway/src/config/tasks/product-manager--backlog.json` | Rewrite |
| Gateway Task Prompt | `gateway/src/config/prompts/product-manager.backlog.task.md` | Rewrite |
| Gateway Types | `gateway/src/types/chat.ts` | Extend (EpicSummary) |
| Gateway Types | `gateway/src/types/tools.ts` | Extend (tool definition) |
| Gateway Types | `gateway/src/types/index.ts` | Extend (re-export) |
| Gateway Service | `gateway/src/services/architectureModelClient.ts` | Extend (WorkItemRaw, fetchProductSummary) |
| Gateway Service | `gateway/src/services/backlogContextBuilder.ts` | **New** |
| Gateway Service | `gateway/src/services/toolExecutor.ts` | Extend (endpoint + params) |
| Gateway Route | `gateway/src/routes/chatV2.ts` | Extend (context, first-turn, generate, save) |
| MCP Types | `mcp-server/src/types/saveBacklogItems.ts` | **New** |
| MCP Types | `mcp-server/src/types/index.ts` | Extend (re-export) |
| MCP Service | `mcp-server/src/services/backlogItemsService.ts` | **New** |
| MCP Route | `mcp-server/src/routes/saveBacklogItemsRoute.ts` | **New** |
| MCP Route | `mcp-server/src/routes/tools.ts` | Extend (mount) |
