# Spec Idea: user-journey-links-meta-model-foundation

## Summary
Introduce a new first-class Business Architecture relationship called USER_JOURNEY_LINK so that relationships between User Journeys become authoritative architecture data and can later drive parent overview diagram generation and navigation.

## Motivation
- The next architecture layer needs a zoomed-out parent diagram for a given user/role, with child User Journey diagrams beneath it.
- That parent diagram should be generated from architecture truth, not from manually added post-drawing arrows.
- Therefore journey-to-journey connections must become a first-class Business Architecture relationship in the meta-model.
- This increment establishes the relationship foundation only; workbook ingestion, overview diagram generation, and diagram linking come later.

## Scope
- Backend/meta-model foundation for a new relationship entity: USER_JOURNEY_LINK
- Add persistence, DTOs, CRUD/list/search endpoints, validation, and project/model scoping.
- Add frontend type/config registration so USER_JOURNEY_LINK appears as a new Business Architecture relationship table/tab in the existing Architecture & Design workspace.
- Reuse the existing relationship-table UX pattern already used by other Business relationships.
- No workbook/XLSX ingestion, No UX Designer conversation/save-flow changes, No parent overview diagram generation, No diagram-link creation/navigation in this increment.

## Out of Scope
- XLSX parser updates
- UX Designer task/prompt changes
- MCP/generate/save-artifact changes
- Parent "User Journey Overview" diagram type
- Child/parent diagram linking
- Any sync behavior
- Bulk import/export UX
- Any new dedicated screen outside the existing Business Architecture table framework

## Domain Model

### USER_JOURNEY_LINK
- **Required fields:** id, model_file_id, source_user_journey_id, target_user_journey_id, relationship_type
- **Optional fields:** label, description, tags (if consistent with conventions)
- Relationship is directed, no self-links.

### Relationship Type Enum
RELATES_TO, PRECEDES, DEPENDS_ON, OPTIONALLY_LEADS_TO, TRIGGERS

## Persistence
- Liquibase migration
- FK/indexes
- Uniqueness on (source, target, type, label)
- CHECK constraint preventing self-links

## Backend
- JPA entity, repository, service with validation
- Controller with CRUD/list/search endpoints
- Response DTOs with resolved journey names

## Frontend
- New "User Journey Links" tab in Business relationships
- Standard grid/table UX with FK typeahead for source/target journeys
- Enum dropdown for relationship type
