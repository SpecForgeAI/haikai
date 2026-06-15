# RM Increment 6 – Wire Confirmation → Save Roadmap + Success Message

## Raw Idea / Description

Complete the Roadmap PM flow end-to-end:
- PM structures Initiatives (L1) and Epics (L2)
- PM transitions to phase="ready"
- User confirms saving
- Gateway triggers a dedicated save branch
- Gateway invokes MCP tool save_roadmap_structure
- Assistant responds with a success message and link to the Roadmap screen

This increment persists canonical roadmap structure in the tool. No Jira import logic here (handled in RM-4).

## Scope Includes

- confirmation detection for roadmap_pm mode
- dedicated save branch (separate from normal chat loop)
- generate roadmapJson from PM's structured response
- invoke save_roadmap_structure tool
- transcript persistence excluding roadmapJson/tool args
- success/failure messaging with link to Roadmap view

## Scope Excludes

- Jira import execution
- dates/scheduling fields
- delivery team assignment
- work items below EPIC (features/stories)
- roadmap merge/diff UI
- conversation reset controls

## Systems

- primary: gateway
- dependency: mcp-server (save_roadmap_structure)
- frontend: RoadmapPmChatPanel (minimal)

## Gateway Changes

Gateway changes include confirmation detection (regex-based), a save branch that extracts proposedInitiatives, builds roadmapJson, executes save_roadmap_structure tool directly (bypassing agent loop), and responds with success/failure message with link to Roadmap screen.

## Frontend Changes

Frontend changes are minimal — no new UI controls, just render the final assistant message with clickable link.

## Acceptance Criteria

- PM reaches phase="ready" with proposed Initiatives/Epics
- User confirms with a short confirmation message
- Gateway invokes save_roadmap_structure
- INITIATIVE and EPIC work_items are created/updated in DB
- User sees success message with link to Roadmap tab
- Transcript files contain only confirmation + success/failure message (no roadmapJson)
- Other modes remain unaffected
