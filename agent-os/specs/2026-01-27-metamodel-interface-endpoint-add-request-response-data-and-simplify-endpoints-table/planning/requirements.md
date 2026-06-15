# Spec Requirements: Metamodel Interface Endpoint - Add Request/Response Data and Simplify Endpoints Table

## Initial Description
Extend InterfaceEndpoint (Endpoints) to capture request/response body data entities via Data Entity Point FKs, and simplify the Endpoints UI table by removing unused columns (Status, Version, Tags). Two new nullable FK columns pointing to data_entity_points, grouped dropdown pickers in the UI, and removal of lifecycle_status/version/tags from DTOs and frontend interfaces (DB columns left intact).

## Requirements Discussion

### First Round Questions

**Q1:** FK nullability and delete behavior -- should both FK fields be nullable, and what ON DELETE behavior: CASCADE or SET NULL?
**Answer:** Both FK fields nullable, FK -> data_entity_points(id), ON DELETE SET NULL (no cascade).

**Q2:** Picker UI -- should we reuse the existing data_entity_point_picker cellType from GridCell.tsx (grouped Logical/Physical), or use a simpler fk_typeahead?
**Answer:** Reuse existing data_entity_point_picker cellType from GridCell.tsx (grouped Logical/Physical). Not a simpler fk_typeahead.

**Q3:** Should valid_from / valid_to also be removed from the surface, or only Status/lifecycle_status, Version, and Tags?
**Answer:** Keep valid_from and valid_to (only remove Status/lifecycle_status, Version, Tags).

**Q4:** DTO updates -- which DTO classes need changes, and what fields are added/removed?
**Answer:** Remove lifecycleStatus/version/tags from EndpointDto.java + InterfaceEndpointDto.java, add requestDataEntityPointId + responseDataEntityPointId. DB columns for removed fields remain (no dropping).

**Q5:** Frontend TS interface -- what fields are removed and added?
**Answer:** Remove lifecycle_status/version/tags, add request_data_entity_point_id?: string and response_data_entity_point_id?: string.

**Q6:** Migration number and column types?
**Answer:** Next migration is 040 (after 039). Use two nullable VARCHAR(64) columns + FK constraints to data_entity_points(id). Prefer VARCHAR(64) to match existing id columns.

**Q7:** Explicit exclusions -- anything else out of scope?
**Answer:** Do NOT update any diagram rendering (sequence/interface/contract) to display request/response data. No new UI toggles; no column drops; no other endpoint semantics changes.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Data Entity Point Picker - Path: `frontend/src/components/` (existing data_entity_point_picker cellType in GridCell.tsx)
- Feature: Endpoints grid config - Path: `frontend/src/config/gridConfigs.ts`
- Feature: InterfaceEndpoint DTOs - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/`
- Feature: InterfaceEndpoint Entity - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/`
- Feature: Liquibase changelog - Path: `architecture-model-service/src/main/resources/db/changelog/`

### Follow-up Questions
No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements
- Add two new nullable FK columns (request_data_entity_point_id, response_data_entity_point_id) to interface_endpoints table referencing data_entity_points(id)
- ON DELETE SET NULL for both FKs
- Expose new fields in InterfaceEndpoint DTOs (requestDataEntityPointId, responseDataEntityPointId)
- Remove lifecycleStatus, version, tags from EndpointDto.java and InterfaceEndpointDto.java
- Remove lifecycle_status, version, tags from frontend TS interfaces
- Add request_data_entity_point_id and response_data_entity_point_id to frontend TS interfaces
- Add "Request Data" and "Response Data" columns to Endpoints UI table using existing data_entity_point_picker cellType (grouped Logical/Physical)
- Remove Status, Version, Tags columns from Endpoints UI table
- Keep valid_from and valid_to columns in UI and DTOs

### Reusability Opportunities
- Reuse data_entity_point_picker cellType from GridCell.tsx for both new columns
- Follow existing FK column patterns (VARCHAR(64)) from other migrations
- Follow existing DTO field patterns for FK reference fields

### Scope Boundaries
**In Scope:**
- Migration 040: two nullable VARCHAR(64) columns with FK constraints to data_entity_points(id), ON DELETE SET NULL
- Update InterfaceEndpoint JPA entity with new fields
- Update EndpointDto.java and InterfaceEndpointDto.java: add request/response fields, remove lifecycleStatus/version/tags
- Update frontend TS interfaces: add request/response fields, remove lifecycle_status/version/tags
- Update Endpoints grid config: add Request Data and Response Data picker columns, remove Status/Version/Tags columns
- Update Liquibase master changelog to include migration 040

**Out of Scope:**
- No diagram rendering changes (sequence, interface, contract)
- No DB column drops for status/version/tags
- No new UI toggles
- No changes to endpoint verb/path behavior or validation beyond the two new FK fields
- No other endpoint semantics changes

### Technical Considerations
- Migration number is 040 (follows 039)
- Column type VARCHAR(64) to match existing id column conventions
- Both FKs nullable with ON DELETE SET NULL
- DB columns for removed fields (lifecycle_status, version, tags) remain untouched
- Service must start with ddl-auto=validate after Liquibase runs
