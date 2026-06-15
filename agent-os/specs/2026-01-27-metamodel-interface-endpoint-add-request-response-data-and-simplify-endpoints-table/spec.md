# Specification: Metamodel Interface Endpoint - Add Request/Response Data and Simplify Endpoints Table

## Goal
Extend the InterfaceEndpoint entity with two new nullable FK fields (request/response data entity point) and simplify the Endpoints UI table by removing unused columns (Status, Version, Tags) from the API surface and frontend grid.

## User Stories
- As an architect, I want to associate request and response data entities with each endpoint so that the data contract is captured directly on the endpoint definition.
- As an architect, I want a cleaner Endpoints table without rarely-used Status, Version, and Tags columns so that I can focus on the fields that matter.

## Specific Requirements

**Database Migration 040 - Add request/response FK columns to interface_endpoints**
- Create SQL file `db/changelog/sql/040-add-endpoint-request-response-data-entity-point.sql`
- Add two nullable `VARCHAR(64)` columns: `request_data_entity_point_id` and `response_data_entity_point_id`
- Use `ALTER TABLE interface_endpoints ADD COLUMN IF NOT EXISTS` pattern (consistent with migrations 036-039)
- Add FK constraints referencing `data_entity_points(id)` with `ON DELETE SET NULL` (differs from migration 022 which had no ON DELETE clause)
- Name constraints `fk_ep_request_data_entity_point` and `fk_ep_response_data_entity_point`
- Note: the actual table name is `endpoints` not `interface_endpoints` based on the JPA `@Table(name = "endpoints")` annotation at `EndpointEntity.java:7`
- Add changelog entry in `db.changelog-master.yaml` with id `040-add-endpoint-request-response-data` and author `architecture-tool`, using `columnExists` precondition on `request_data_entity_point_id`

**Backend Entity - Add new FK fields to EndpointEntity**
- File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/EndpointEntity.java`
- Add two new `@Column` fields: `requestDataEntityPointId` (mapped to `request_data_entity_point_id`) and `responseDataEntityPointId` (mapped to `response_data_entity_point_id`)
- Both fields are nullable String type, positioned after `validTo` (line 59)
- Do NOT remove `lifecycleStatus`, `version`, or `tags` fields from the entity (DB columns remain)

**Backend DTO - Update EndpointDto record**
- File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/EndpointDto.java`
- Add two new `@JsonProperty` fields: `requestDataEntityPointId` (JSON: `request_data_entity_point_id`) and `responseDataEntityPointId` (JSON: `response_data_entity_point_id`)
- Remove three fields from the record: `lifecycleStatus`, `version`, `tags`
- Keep `validFrom` and `validTo` fields

**Backend DTO - Update InterfaceEndpointDto record**
- File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/InterfaceEndpointDto.java`
- Add `requestDataEntityPointId` and `responseDataEntityPointId` fields
- Remove `lifecycleStatus`, `version`, `tags` fields
- This DTO is used in OAS context bundle; update JSON property names to use camelCase (`requestDataEntityPointId`, `responseDataEntityPointId`)

**Backend Mapper - Update EntityMapper endpoint methods**
- File: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
- Update `toDto(EndpointEntity)` method (line 292): add mapping for new fields, stop passing `lifecycleStatus`/`version`/`tags` to the DTO constructor
- Update `toEntity(EndpointDto, String)` method (line 311): add `.requestDataEntityPointId(dto.requestDataEntityPointId())` and `.responseDataEntityPointId(dto.responseDataEntityPointId())` to the builder; stop mapping removed DTO fields (entity still has them, but they will no longer be populated from DTO)

**Backend Controller/API - No structural changes**
- The existing generic CRUD endpoints for `endpoints` entity type already handle field pass-through via the DTO/mapper layer
- No new endpoints, routes, or controller methods are needed
- The two new fields will automatically flow through existing create/update/read APIs once DTO and mapper are updated

**Frontend TypeScript Interface - Update Endpoint type**
- File: `frontend/src/types/model.ts`, `Endpoint` interface at line 110
- Add two new optional fields: `request_data_entity_point_id?: string` and `response_data_entity_point_id?: string`
- Remove three fields: `lifecycle_status`, `version`, `tags`
- Keep `valid_from` and `valid_to`

**Frontend Grid Config - Update endpoints grid columns**
- File: `frontend/src/config/gridConfigs.ts`, `endpoints` config at line 151
- Add two new columns using `data_entity_point_picker` cellType: `{ field: 'request_data_entity_point_id', displayName: 'Request Data', cellType: 'data_entity_point_picker', required: false, width: 200 }` and `{ field: 'response_data_entity_point_id', displayName: 'Response Data', cellType: 'data_entity_point_picker', required: false, width: 200 }`
- Position new columns after `direction` (line 159) and before `description`
- Remove three column entries: `lifecycle_status` (line 160), `version` (line 161), `tags` (line 163)
- The `data_entity_point_picker` cellType is already implemented in `GridCell.tsx` and used by `data_movements` (line 521) and `logical_data_entity_relationships` (lines 456-458) grids

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**`data_entity_point_picker` cellType in GridCell.tsx**
- Already renders a grouped dropdown with LOGICAL DATA ENTITIES / PHYSICAL DATA ENTITIES headers
- Displays items as "Name [TYPE]" format
- Used by `data_movements` grid (field: `dataEntityPointId`, line 521 of gridConfigs.ts) and `logical_data_entity_relationships` grid (lines 456-458)
- Reuse identically for the two new endpoint columns with no modifications to the cell component

**Migration 022 FK pattern (`022-data-entity-point-fk-columns.sql`)**
- Demonstrates the convention for adding FK columns to `data_entity_points(id)`
- Uses `ALTER TABLE ... ADD COLUMN` followed by `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES data_entity_points(id)`
- This spec adds `ON DELETE SET NULL` which migration 022 did not include

**EntityMapper endpoint methods (lines 292-329)**
- `toDto()` and `toEntity()` are positional record constructors / builder patterns
- New fields must be added to both methods; removed fields must be excluded from DTO construction but entity fields are left intact

**EndpointEntity JPA entity (`EndpointEntity.java`)**
- Uses Lombok `@Builder`, `@Getter`, `@Setter` annotations; new fields only require adding `@Column`-annotated fields
- Table name is `endpoints` (not `interface_endpoints`) per `@Table(name = "endpoints")` at line 7

**`db.changelog-master.yaml` changeset conventions**
- Last entry is changeset id `039-add-sequence-messages-is-collection` (line 713)
- Uses `columnExists` precondition with `onFail: MARK_RAN`
- Standard `sqlFile` change type with `splitStatements: true` and `stripComments: true`

## Out of Scope
- Do NOT drop any existing DB columns for lifecycle_status, version, or tags
- Do NOT update any diagram rendering (sequence, interface contract, or other) to display request/response data
- Do NOT add new UI toggles or filter controls
- Do NOT change endpoint verb/path validation or behavior beyond the two new FK fields
- Do NOT modify the EndpointLifecycleStatus enum or endpointLifecycleStatusOptions in frontend defaults (they may still be used elsewhere)
- Do NOT create new API endpoints or controller methods
- Do NOT change the `interface_endpoints` table name (it is actually `endpoints`)
- Do NOT modify the `data_entity_point_picker` GridCell component implementation
- Do NOT add cascade delete behavior (use SET NULL only)
- Do NOT remove valid_from or valid_to from any layer
