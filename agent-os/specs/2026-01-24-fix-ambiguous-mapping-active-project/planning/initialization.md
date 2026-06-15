# Spec Initialization

## Title
Fix Server Startup Ambiguous Mapping for GET /api/projects/active

## Description
Resolve Spring Boot startup failure caused by ambiguous request mappings:
both ProjectController#getActiveProject and an existing ActiveProjectController#getActiveProject
are mapped to GET /api/projects/active. Ensure there is exactly one controller/handler mapping
for /api/projects/active (and related active-project routes) so the server starts reliably.

## Scope Includes
- Remove duplicate GET mapping for /api/projects/active
- Consolidate all "active project" endpoints into a single controller with stable route structure
- Ensure compilation overwrites any stale class artifacts for ActiveProjectController

## Out of Scope
- Any DB/liquibase changes (this is not a DB issue)
- Any changes to endpoint URLs consumed by the frontend (routes remain the same)
