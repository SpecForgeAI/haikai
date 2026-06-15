# RM Increment 2 – Internal Roadmap Pre-check + Branching Logic

## Raw Idea / Description

Enhance roadmap_pm conversation startup so the gateway first checks whether
a roadmap (Initiatives/Epics) already exists in the tool for the active project.
If it exists, the PM starts in "modify existing roadmap" mode and acknowledges
that a roadmap exists.
If it does not exist, the PM asks the user whether a roadmap exists externally
(No = create new, Yes = Jira + JQL).
This increment remains tool-less and does NOT import from Jira or save roadmap changes.

## Scope Includes

- gateway internal pre-check for existing roadmap work items (INITIATIVE/EPIC)
- branch the initial PM message based on existence
- inject existing roadmap summary into system context when present
- if no internal roadmap, prompt user for external roadmap existence (No vs Jira)
- minimal frontend: no UI changes beyond passing productName/project context as needed

## Scope Excludes

- any Jira calls/import (handled in later increment)
- any saving of roadmap items (handled in later increment)
- delivery teams
- changes to Roadmap screen layout (already done in RM-1)
- Upload Documents handling

## Systems

- primary: gateway
- dependency: architecture-model-service (work items read)
- frontend: RoadmapPmChatPanel (no layout changes)
