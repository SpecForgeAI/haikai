# Raw Idea

## Title
RM Increment 4 – Jira Import for Roadmap Skeleton (Initiatives + Epics)

## Description
Enable the Roadmap PM flow to import an existing roadmap skeleton from Jira using a user-provided JQL, creating canonical INITIATIVE and EPIC work_items in the tool, while storing external Jira references on each imported work item for future sync. This increment performs import + persistence of INITIATIVE/EPIC only. No LLM saving workflow changes beyond collecting JQL (handled in RM-2/RM-1).

## Scope Includes
- gateway: new import endpoint to execute Jira JQL and map results
- jira-service: reuse existing JQL search capability (no new Jira auth model)
- architecture-model-service: add external reference fields to work_item (external_system, external_key, external_id, external_url)
- persistence: upsert work_items of type INITIATIVE and EPIC with parent linkage when determinable

## Scope Excludes
- importing Features/Stories
- delivery team assignment
- due dates / scheduling fields
- sync back to Jira
- deleting/replacing existing roadmap items (import is additive/upsert only)
- complex Jira hierarchy edge cases beyond parent linkage best-effort

## Systems
gateway (primary), jira-service, architecture-model-service

## Architecture-model-service Changes
- Add external reference fields to work_item: external_system (TEXT NULL), external_key (TEXT NULL), external_id (TEXT NULL), external_url (TEXT NULL)
- UNIQUE constraint on (project_id, external_system, external_key) WHERE external_key IS NOT NULL
- DB migration for new columns and constraint
- Extend WorkItem DTO to support external fields

## Gateway Changes
- POST /api/roadmap/jira/import endpoint
- Body: projectId (UUID), jql (string), maxResults (number, default 200)
- Calls jira-service search, classifies issues as INITIATIVE or EPIC by issue type name
- Determines parent-child links (EPIC parent = Initiative via issue.parent.key)
- Orphan EPICs grouped under synthetic "Imported Roadmap" initiative
- Upserts work_items via architecture-model-service
- Returns counts (importedInitiatives, importedEpics, updatedInitiatives, updatedEpics) + warnings
- Idempotent: re-running same JQL updates, doesn't duplicate

## Jira-service Usage
- Reuse existing search endpoint client (JQL)
- Ensure requested fields include parent and issuetype

## Frontend Changes
Minimal or none in this increment

## NFRs
- Import must not delete or overwrite non-Jira items
- Import must not create work items below EPIC
- Best-effort parent linkage; warn when grouping under synthetic initiative
- Keep descriptions optional to avoid large payload issues

## Acceptance Criteria
- JQL returning Initiatives and Epics imports them into canonical work_items
- Each imported work_item stores external_system="JIRA" and external_key
- Re-running same import updates existing items instead of duplicating
- Epics linked to Initiatives when parent detectable; otherwise grouped under "Imported Roadmap"
- No Features/Stories created
- No delivery team assignment or scheduling fields modified
