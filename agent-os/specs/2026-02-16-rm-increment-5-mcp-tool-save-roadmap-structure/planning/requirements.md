# Spec Requirements: RM Increment 5 - MCP Tool: save_roadmap_structure

## Initial Description

Add an MCP tool that persists a high-level roadmap structure as canonical work_items in the architecture-model-service: INITIATIVE (L1) and EPIC (L2). Parent-child relationships created via parent_id. Supports both "create new roadmap" and "modify existing roadmap" by upserting items using external references when provided, otherwise by stable title matching within project (best-effort). No dates, no team assignment, no features/stories.

### Scope Includes
- mcp-server: new tool endpoint save_roadmap_structure
- gateway: tool registration (allowed tool + schema + endpoint mapping)
- architecture-model-service: use existing work_item endpoints to create/update
- support external references (e.g., Jira) when present on inputs

### Scope Excludes
- Jira import (handled in RM-4)
- scheduling fields (start/end dates)
- delivery team assignment
- work items below EPIC (Feature/Story)
- deletion of work items
- merge/diff logic beyond simple upsert

## Requirements Discussion

### First Round Questions

**Q1:** For the mcp-server tool endpoint, should we follow the existing pattern of creating a new route file (e.g., `saveRoadmapStructureRoute.ts`) and a corresponding service file (e.g., `roadmapStructureService.ts`), with the service calling architecture-model-service work_item endpoints via `archModelClient.ts`? Or should this tool proxy through the gateway?
**Answer:** Follow the mcp-server tool pattern: new `/mcp/tools/save_roadmap_structure` route + service, and add the needed work-item HTTP methods to `archModelClient.ts` (do not proxy via gateway).

**Q2:** For title-matching during upsert fallback, should the match be scoped by work_item type (i.e., match INITIATIVE titles only against other INITIATIVEs, EPIC titles only against other EPICs), or should it match across all types within the project?
**Answer:** Yes -- title matching is scoped by type (match INITIATIVE titles only against INITIATIVEs, EPIC titles only against EPICs).

**Q3:** When creating new work_items, should the default status be "PLANNED"? And on update, should the tool preserve the existing status (never overwrite it)?
**Answer:** Yes -- new items default status="PLANNED"; updates must NOT overwrite existing status.

**Q4:** The raw idea specifies `roadmapJson` as a serialized JSON string in the request. Should this be a string in `TOOL_DEFINITIONS` (so the LLM sends it as a string), with the mcp-server responsible for parsing and validating the inner JSON structure?
**Answer:** Yes -- `roadmapJson` is a string in `TOOL_DEFINITIONS`; mcp-server parses/validates inner JSON.

**Q5:** Should the tool set `sort_order` on initiatives and epics based on their array position in the input JSON? On update, should it overwrite the existing sort_order to reflect the new ordering?
**Answer:** Yes -- set `sort_order` from array position for initiatives and epics; on update, overwrite `sort_order` to reflect the new ordering.

**Q6:** Should the response include a `warnings[]` array for edge cases such as ambiguous title matches, skipped items, or orphan handling decisions?
**Answer:** Yes -- include `warnings[]` in the response for ambiguous title matches, skipped items, or orphan handling decisions.

**Q7:** For epic-to-initiative relationships, is nesting in the input JSON sufficient (epics belong to their containing initiative), or should there be an explicit `initiativeRef` field on each epic?
**Answer:** Nesting is sufficient for v0.1 (epics belong to their containing initiative); no explicit `initiativeRef` needed.

**Q8:** For title uniqueness validation, should initiative titles be unique (case-insensitive) across the entire project, and epic titles unique (case-insensitive) only within the same initiative (allowing epics under different initiatives to share titles)?
**Answer:** Correct -- initiative titles unique (case-insensitive) across project; epic titles unique (case-insensitive) within the same initiative only; epics under different initiatives may share titles.

**Q9:** Should this tool wire into the `roadmap_pm` confirmation flow, or is that out of scope for RM Increment 5?
**Answer:** Correct -- wiring into `roadmap_pm` confirmation flow is out of scope for RM Increment 5 (handled in RM Increment 6).

**Q10:** For `delivery_team_id` and tags/provenance metadata, should `delivery_team_id` be NULL on creation and left unchanged on update? Should any provenance metadata (e.g., "created by save_roadmap_structure") be stored in tags?
**Answer:** `delivery_team_id` should be NULL on creation and left unchanged on update; tags/provenance metadata is out of scope (do not store provenance in tags).

**Q11:** For gateway registration, should the required params be `['projectId', 'roadmapJson']` with `sessionId` auto-injected by the gateway tool executor?
**Answer:** Yes -- gateway required params are `['projectId', 'roadmapJson']`; `sessionId` is auto-injected by the gateway tool executor.

**Q12:** For the `externalRef` object, should `externalRef.id` be persisted, or only `system` and `key`? Should the tool construct `external_url` or leave it null?
**Answer:** `externalRef.id` is ignored (not persisted); do not construct `external_url` here -- leave it null (Jira import flow can populate URL separately).

### Existing Code to Reference

**Similar Features Identified:**
- Feature: save_architecture_baseline MCP tool - Path: `mcp-server/src/routes/saveArchitectureBaselineRoute.ts` and `mcp-server/src/services/architectureBaselineService.ts`
- Feature: archModelClient - Path: `mcp-server/src/services/archModelClient.ts`
- Feature: Gateway tool registration - Path: `gateway/src/services/toolExecutor.ts`
- Feature: Tool type definitions - Path: `gateway/src/types/tools.ts`
- Feature: Save architecture baseline types - Path: `mcp-server/src/types/saveArchitectureBaseline.ts`

### Follow-up Questions

No follow-up questions were needed -- all decisions were clear from the first round of answers.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable -- this is a backend MCP tool with no UI component.

## Requirements Summary

### Functional Requirements
- New MCP tool endpoint: `POST /mcp/tools/save_roadmap_structure`
- Accept `sessionId`, `projectId` (UUID), and `roadmapJson` (serialized JSON string) as input
- Parse and validate `roadmapJson` inner structure: `{ initiatives: [{ title, description, externalRef | null, epics: [{ title, description, externalRef | null }] }] }`
- Validate initiatives array is non-empty, titles are non-empty, and no duplicate titles within the same level
- Initiative title uniqueness is case-insensitive across the project; epic title uniqueness is case-insensitive within the same initiative
- Two-phase upsert: process initiatives first, then epics with parent_id set from their containing initiative
- Upsert matching priority: (1) by externalRef (projectId + external_system + external_key), (2) fallback by (projectId + type + title) case-insensitive
- Title matching is scoped by type (INITIATIVE matches only INITIATIVEs, EPIC matches only EPICs)
- New items get status="PLANNED"; updates must NOT overwrite existing status
- Set sort_order from array position; on update, overwrite sort_order to reflect new ordering
- delivery_team_id is NULL on creation and left unchanged on update
- externalRef.id is ignored (not persisted); external_url is left null
- No tags or provenance metadata stored
- Response includes: `{ createdInitiatives, updatedInitiatives, createdEpics, updatedEpics, warnings[] }`
- warnings[] captures ambiguous title matches, skipped items, and orphan handling decisions
- Nesting in input JSON establishes epic-to-initiative relationships (no explicit initiativeRef field)
- No deletion of work items, no features/stories below EPIC, no dates/teams

### Reusability Opportunities
- Follow the `save_architecture_baseline` route + service pattern in mcp-server
- Extend `archModelClient.ts` with needed work_item HTTP methods (GET/POST/PUT for work_items)
- Reference existing gateway tool registration pattern in `toolExecutor.ts` and `tools.ts`
- Reference `saveArchitectureBaseline.ts` types as a model for input/output type definitions

### Scope Boundaries
**In Scope:**
- mcp-server: new route, service, and types for save_roadmap_structure
- mcp-server: new HTTP methods in archModelClient.ts for work_item CRUD
- gateway: tool registration (ALLOWED_TOOL_NAMES, TOOL_DEFINITIONS, TOOL_ENDPOINTS, TOOL_REQUIRED_PARAMS)
- Input validation and duplicate title detection
- Upsert logic with externalRef-first, title-fallback matching
- sort_order management from array position
- warnings[] in response for edge cases

**Out of Scope:**
- Jira import (RM-4)
- roadmap_pm confirmation flow wiring (RM Increment 6)
- Scheduling fields (start/end dates)
- Delivery team assignment
- Work items below EPIC (Feature/Story)
- Deletion of work items
- Merge/diff logic beyond simple upsert
- Tags or provenance metadata
- external_url construction
- externalRef.id persistence

### Technical Considerations
- roadmapJson is a string in TOOL_DEFINITIONS; mcp-server is responsible for parsing/validating inner JSON
- sessionId is auto-injected by the gateway tool executor (not a user-supplied param)
- Gateway required params: ['projectId', 'roadmapJson']
- Must add work_item HTTP methods to archModelClient.ts (direct calls to architecture-model-service, not proxied through gateway)
- Follow existing mcp-server patterns: route file + service file + types file
- Two-phase processing order is critical: initiatives must be created/updated before epics so parent_id can be resolved
