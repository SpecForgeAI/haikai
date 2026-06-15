# Raw Idea

## Title
RM Increment 1 – Roadmap PM Mode + LHS Chat Panel (Tool-less, No Saving)

## Description

Introduce a new Product Manager persona conversation on the Roadmap screen that structures high-level Initiatives (L1) and Epics (L2). This increment is tool-less and does NOT persist or import any roadmap data. It only enables structured roadmap discussion in a dedicated LHS chat panel.

## Scope Includes

- new chat mode: "roadmap_pm"
- LHS chat panel on Roadmap screen
- structured JSON response contract (questions | ready)
- roadmap-focused system prompt
- transcript persistence under kind="roadmap_pm"

## Scope Excludes

- any roadmap saving
- any Jira import
- any MCP tools
- any work_item writes
- delivery team persistence
- modification of existing roadmap UI grid
- changes to PM (Product) or SA modes

## Systems

- primary: gateway
- frontend: RoadmapScreen (Product & Delivery area)
- no_changes: mcp-server, architecture-model-service, jira-service

## Gateway Changes

- New chat mode "roadmap_pm" — tool-less, JSON-mode via prompt-only enforcement, validation + single corrective retry, transcript persisted under kind="roadmap_pm"
- System prompt persona: "Senior Product Manager – Roadmap Planning"
- Structured response contract with phase, section (7 sections), questions, summary, proposedInitiatives, assumptions, openItems
- Section progression: roadmap_existence_check → outcome_alignment → architecture_alignment → sequencing_strategy → initiative_structure → epic_structure → final_review

## Frontend Changes

- RoadmapScreen layout: LHS = RoadmapPmChatPanel, RHS = existing roadmap grid (unchanged)
- RoadmapPmChatPanel.tsx: manages chat state, calls /api/chat with mode="roadmap_pm", renders questions/summary/proposedInitiatives, displays readiness message
- Bootstrap: auto-sends "Help me define the high-level roadmap for this product." if no transcript exists

## Transcript Persistence

- Persist under: <projectParentFolder>/conversations/roadmap_pm/<derivedFolderName>/
- featureId = projectId, featureTitle = "Roadmap PM"

## Non-functional Requirements

- No regression to Product PM or SA modes
- No work_item writes, no Jira calls
- Roadmap UI grid remains editable manually
