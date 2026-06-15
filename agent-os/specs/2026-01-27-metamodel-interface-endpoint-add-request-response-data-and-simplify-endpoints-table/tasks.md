# Task Breakdown: Metamodel Interface Endpoint - Add Request/Response Data and Simplify Endpoints Table

## Overview
Total Tasks: 4 Task Groups, 20 sub-tasks

## Task List

### Database Layer

#### Task Group 1: Migration 040 - Add Request/Response FK Columns
**Dependencies:** None

- [x] 1.0 Complete database migration
  - [x] 1.1 Write 3 focused tests for migration validation
    - Test that `request_data_entity_point_id` column exists after migration
    - Test that `response_data_entity_point_id` column exists after migration
    - Test that FK constraints allow NULL values and enforce referential integrity
  - [x] 1.2 Create SQL migration file `architecture-model-service/src/main/resources/db/changelog/sql/040-add-endpoint-request-response-data-entity-point.sql`
    - `ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS request_data_entity_point_id VARCHAR(64)`
    - `ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS response_data_entity_point_id VARCHAR(64)`
    - `ALTER TABLE endpoints ADD CONSTRAINT fk_ep_request_data_entity_point FOREIGN KEY (request_data_entity_point_id) REFERENCES data_entity_points(id) ON DELETE SET NULL`
    - `ALTER TABLE endpoints ADD CONSTRAINT fk_ep_response_data_entity_point FOREIGN KEY (response_data_entity_point_id) REFERENCES data_entity_points(id) ON DELETE SET NULL`
    - Follow pattern from migrations 036-039 (ADD COLUMN IF NOT EXISTS)
    - Reference migration 022 for FK convention but add ON DELETE SET NULL
  - [x] 1.3 Update `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Add changeset with id `040-add-endpoint-request-response-data`, author `architecture-tool`
    - Use `columnExists` precondition on `request_data_entity_point_id` with `onFail: MARK_RAN`
    - Use `sqlFile` change type with `splitStatements: true` and `stripComments: true`
    - Place after the existing changeset 039
  - [x] 1.4 Verify migration runs successfully
    - Start the service and confirm Liquibase applies migration 040
    - Confirm `ddl-auto=validate` passes after migration

**Acceptance Criteria:**
- Migration SQL file exists at the correct path
- Changelog master YAML includes the new changeset entry
- Both columns are nullable VARCHAR(64)
- FK constraints reference `data_entity_points(id)` with ON DELETE SET NULL
- Service starts successfully with Hibernate validation

---

### Backend Layer

#### Task Group 2: Entity, DTO, and Mapper Updates
**Dependencies:** Task Group 1

- [x] 2.0 Complete backend model layer changes
  - [x] 2.1 Write 4 focused tests for backend changes
    - Test EndpointDto serialization includes `request_data_entity_point_id` and `response_data_entity_point_id` in JSON
    - Test EndpointDto serialization does NOT include `lifecycle_status`, `version`, or `tags`
    - Test EntityMapper.toDto(EndpointEntity) maps the two new fields correctly
    - Test EntityMapper.toEntity(EndpointDto) maps the two new fields correctly
  - [x] 2.2 Update `EndpointEntity.java` - add new fields
    - Add `@Column(name = "request_data_entity_point_id")` field `requestDataEntityPointId` (String, nullable)
    - Add `@Column(name = "response_data_entity_point_id")` field `responseDataEntityPointId` (String, nullable)
    - Position after `validTo` field
    - Do NOT remove `lifecycleStatus`, `version`, or `tags` from entity (DB columns remain)
  - [x] 2.3 Update `EndpointDto.java` record
    - Add `@JsonProperty("request_data_entity_point_id") String requestDataEntityPointId`
    - Add `@JsonProperty("response_data_entity_point_id") String responseDataEntityPointId`
    - Remove `lifecycleStatus`, `version`, `tags` fields from the record
    - Keep `validFrom` and `validTo`
  - [x] 2.4 Update `InterfaceEndpointDto.java` record
    - Add `requestDataEntityPointId` and `responseDataEntityPointId` fields
    - Use camelCase JSON property names (`requestDataEntityPointId`, `responseDataEntityPointId`)
    - Remove `lifecycleStatus`, `version`, `tags` fields
  - [x] 2.5 Update `EntityMapper.java` endpoint mapping methods
    - Update `toDto(EndpointEntity)`: add mapping for `requestDataEntityPointId` and `responseDataEntityPointId`; stop passing `lifecycleStatus`/`version`/`tags` to DTO constructor
    - Update `toEntity(EndpointDto, String)`: add `.requestDataEntityPointId(dto.requestDataEntityPointId())` and `.responseDataEntityPointId(dto.responseDataEntityPointId())` to builder; stop mapping removed DTO fields
  - [x] 2.6 Ensure backend tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify JSON serialization and mapper behavior

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- EndpointEntity has both new @Column fields
- EndpointDto and InterfaceEndpointDto include new fields and exclude removed fields
- EntityMapper correctly maps new fields in both directions
- Removed fields (lifecycleStatus/version/tags) no longer appear in API responses
- Service compiles and starts successfully

---

### Frontend Layer

#### Task Group 3: TypeScript Interface and Grid Config Updates
**Dependencies:** Task Group 2

- [x] 3.0 Complete frontend changes
  - [x] 3.1 Write 3 focused tests for frontend changes
    - Test that `Endpoint` interface accepts objects with `request_data_entity_point_id` and `response_data_entity_point_id`
    - Test that endpoints grid config contains "Request Data" and "Response Data" columns with `data_entity_point_picker` cellType
    - Test that endpoints grid config does NOT contain `lifecycle_status`, `version`, or `tags` columns
  - [x] 3.2 Update `frontend/src/types/model.ts` - Endpoint interface
    - Add `request_data_entity_point_id?: string`
    - Add `response_data_entity_point_id?: string`
    - Remove `lifecycle_status`, `version`, `tags` fields
    - Keep `valid_from` and `valid_to`
  - [x] 3.3 Update `frontend/src/config/gridConfigs.ts` - endpoints grid columns
    - Add column: `{ field: 'request_data_entity_point_id', displayName: 'Request Data', cellType: 'data_entity_point_picker', required: false, width: 200 }`
    - Add column: `{ field: 'response_data_entity_point_id', displayName: 'Response Data', cellType: 'data_entity_point_picker', required: false, width: 200 }`
    - Position new columns after `direction` and before `description`
    - Remove `lifecycle_status` column entry
    - Remove `version` column entry
    - Remove `tags` column entry
  - [x] 3.4 Ensure frontend tests pass
    - Run ONLY the 3 tests written in 3.1
    - Verify TypeScript compilation succeeds with no errors

**Acceptance Criteria:**
- The 3 tests written in 3.1 pass
- Endpoint interface has new fields and lacks removed fields
- Grid config shows Request Data and Response Data picker columns
- Grid config no longer shows Status, Version, or Tags columns
- Frontend compiles without TypeScript errors

---

### Verification

#### Task Group 4: Test Review and End-to-End Verification
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and verify end-to-end
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review 3 migration tests (Task 1.1)
    - Review 4 backend tests (Task 2.1)
    - Review 3 frontend tests (Task 3.1)
    - Total existing tests: 10
  - [x] 4.2 Analyze test coverage gaps for this feature
    - Check if round-trip API test exists (create endpoint with request/response data, read it back)
    - Check if NULL FK handling is tested (create endpoint without data entity points)
    - Check if ON DELETE SET NULL behavior is verified
  - [x] 4.3 Write up to 5 additional tests to fill critical gaps
    - Integration test: create an endpoint via API with `request_data_entity_point_id` set, verify it persists and returns correctly
    - Integration test: create an endpoint without the new FK fields, verify they default to null
    - Integration test: verify that removed fields (`lifecycle_status`, `version`, `tags`) are absent from API responses
    - Frontend test: verify grid renders data_entity_point_picker cells for both new columns
    - Integration test: verify ON DELETE SET NULL - delete referenced data_entity_point, confirm endpoint FK becomes null
  - [x] 4.4 Run all feature-specific tests
    - Run the 10 tests from groups 1-3 plus up to 5 new tests from 4.3
    - Expected total: approximately 15 tests
    - Verify all pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 15 tests total)
- End-to-end flow works: create endpoint with data entity point references, view in grid
- Removed fields do not appear in API responses or grid UI
- No regressions in existing endpoint CRUD operations

## Execution Order

Recommended implementation sequence:
1. **Database Layer** (Task Group 1) - Migration must run first; all other layers depend on the new columns existing
2. **Backend Layer** (Task Group 2) - Entity/DTO/Mapper changes depend on the DB columns; frontend depends on API shape
3. **Frontend Layer** (Task Group 3) - TypeScript and grid changes depend on the backend API contract being finalized
4. **Verification** (Task Group 4) - End-to-end validation after all layers are complete
