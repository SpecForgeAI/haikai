# RM Increment 5 – MCP Tool: save_roadmap_structure (Canonical Initiatives + Epics)

## Raw Idea

Add an MCP tool that persists a high-level roadmap structure as canonical work_items in the architecture-model-service: INITIATIVE (L1) and EPIC (L2). Parent-child relationships created via parent_id. Supports both "create new roadmap" and "modify existing roadmap" by upserting items using external references when provided, otherwise by stable title matching within project (best-effort). No dates, no team assignment, no features/stories.

## Scope Includes

- mcp-server: new tool endpoint save_roadmap_structure
- gateway: tool registration (allowed tool + schema + endpoint mapping)
- architecture-model-service: use existing work_item endpoints to create/update
- support external references (e.g., Jira) when present on inputs

## Scope Excludes

- Jira import (handled in RM-4)
- scheduling fields (start/end dates)
- delivery team assignment
- work items below EPIC (Feature/Story)
- deletion of work items
- merge/diff logic beyond simple upsert

## Systems

- mcp-server (primary)
- architecture-model-service (dependency)
- gateway (tool registration only)

## MCP Tool: save_roadmap_structure

- Endpoint: POST /mcp/tools/save_roadmap_structure
- Request: sessionId, projectId (UUID), roadmapJson (serialized JSON string)
- roadmapJson schema: { initiatives: [{ title, description, externalRef: { system, key, id } | null, epics: [{ title, description, externalRef | null }] }] }
- Validation: initiatives non-empty, titles non-empty, reject duplicate titles within same level
- Upsert matching: 1) by externalRef (projectId + external_system + external_key), 2) fallback by (projectId + type + title) case-insensitive
- Response: { createdInitiatives, updatedInitiatives, createdEpics, updatedEpics }
- Two-phase: upsert initiatives first, then epics with parent_id
- No deletes, no features/stories, no dates/teams

## Gateway Registration

Register save_roadmap_structure in:
- ALLOWED_TOOL_NAMES
- TOOL_DEFINITIONS
- TOOL_ENDPOINTS
- TOOL_REQUIRED_PARAMS

## Non-Functional Requirements

- No deletion of work items
- No features/stories below EPIC level
- No dates/teams
- Blind save with upsert handling repeats
