# Raw Idea

## Title
SA Increment 2 – Standards + MISSION Auto-Injection + Artefact Upload/URL Ingestion

## Description
Enhance the Solution Architect mode so that, at conversation start, it automatically receives MISSION.MD (business context) and TECH-STACK.MD (generated standards), and supports user-uploaded artefacts (local files or public URLs) using the same mechanism already implemented for Product Manager. This increment remains tool-less and does NOT persist architecture.

## Key Scope
- Auto-load MISSION.MD and TECH-STACK.MD into SA context on bootstrap
- Enforce standards-generation check at start of SA session
- Reuse existing artefact upload + URL ingestion pipeline (buildAugmentedMessage)
- Inject uploaded artefacts into SA context window
- Ensure artefacts are not written to transcript files

## Excludes
- Architecture meta-model writes
- MCP save tool
- Diagram creation
- Modification of Product Manager behavior
- Structured extraction of artefacts
