# Task Breakdown: Logical ER Meta-Model Upgrade

## Overview
Total Tasks: 10 Task Groups with 47 sub-tasks

This spec upgrades the LogicalDataEntityRelationship meta-model to support UML-style relationship semantics (cardinality + relationship type enums) and polymorphic endpoints that can connect LogicalEntity and/or PhysicalEntity nodes.

## Task List

---

### Backend: Database Layer

#### Task Group 1: Liquibase Migration
**Dependencies:** None
**Specialist:** database-engineer

- [x] 1.0 Complete Liquibase migration for logical_data_entity_relationships schema changes
  - [x] 1.1 Create migration file `009-logical-er-polymorphic-endpoints.sql`
    - Location: `architecture-model-service/src/main/resources/db/changelog/sql/009-logical-er-polymorphic-endpoints.sql`
    - Follow pattern from existing migrations (e.g., `004-states-state-transitions.sql`)
  - [x] 1.2 Rename column `relationship_type` to `cardinality`
    - Use `ALTER TABLE logical_data_entity_relationships RENAME COLUMN relationship_type TO cardinality;`
  - [x] 1.3 Add new columns for polymorphic endpoints
    - `from_ref_kind TEXT` (nullable)
    - `from_ref_id TEXT` (nullable)
    - `to_ref_kind TEXT` (nullable)
    - `to_ref_id TEXT` (nullable)
    - `relationship TEXT` (nullable)
  - [x] 1.4 Migrate existing data to polymorphic refs
    - Set `from_ref_kind = 'LOGICAL_ENTITY'`
    - Set `from_ref_id = source_entity_id`
    - Set `to_ref_kind = 'LOGICAL_ENTITY'`
    - Set `to_ref_id = target_entity_id`
  - [x] 1.5 Drop legacy columns after data migration
    - `ALTER TABLE logical_data_entity_relationships DROP COLUMN source_entity_id;`
    - `ALTER TABLE logical_data_entity_relationships DROP COLUMN target_entity_id;`
  - [x] 1.6 Add CHECK constraints for enum values
    - Cardinality: `CHECK (cardinality IS NULL OR cardinality IN ('ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'))`
    - Relationship: `CHECK (relationship IS NULL OR relationship IN ('GENERALIZATION', 'REALIZATION', 'COMPOSITION', 'AGGREGATION', 'ASSOCIATION', 'DEPENDENCY'))`
    - Endpoint Kind (from_ref_kind): `CHECK (from_ref_kind IS NULL OR from_ref_kind IN ('LOGICAL_ENTITY', 'PHYSICAL_ENTITY'))`
    - Endpoint Kind (to_ref_kind): `CHECK (to_ref_kind IS NULL OR to_ref_kind IN ('LOGICAL_ENTITY', 'PHYSICAL_ENTITY'))`
  - [x] 1.7 Add pairwise null/non-null CHECK constraints
    - `CHECK ((from_ref_kind IS NULL AND from_ref_id IS NULL) OR (from_ref_kind IS NOT NULL AND from_ref_id IS NOT NULL))`
    - `CHECK ((to_ref_kind IS NULL AND to_ref_id IS NULL) OR (to_ref_kind IS NOT NULL AND to_ref_id IS NOT NULL))`
  - [x] 1.8 Update `db.changelog-master.yaml` with new changeSet
    - Add changeSet id: `009-logical-er-polymorphic-endpoints`
    - Use precondition: `columnExists` check for `cardinality` column (NOT exists)
    - Reference: `db/changelog/sql/009-logical-er-polymorphic-endpoints.sql`

**Acceptance Criteria:**
- Migration file follows existing Liquibase patterns
- Data migration preserves all existing relationships
- CHECK constraints enforce enum value validation
- Pairwise constraints enforce ref_kind/ref_id consistency
- Master changelog includes new changeSet

**Files to Create/Modify:**
- CREATE: `architecture-model-service/src/main/resources/db/changelog/sql/009-logical-er-polymorphic-endpoints.sql`
- MODIFY: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`

---

### Backend: Java Enums

#### Task Group 2: Create Backend Enum Classes (Optional - String-based)
**Dependencies:** Task Group 1
**Specialist:** backend-engineer

- [x] 2.0 Define enum constants (string-based approach - no Java enum classes needed)
  - [x] 2.1 Document enum values as constants in code comments
    - Cardinality: `ONE_TO_ONE`, `ONE_TO_MANY`, `MANY_TO_ONE`, `MANY_TO_MANY`
    - Relationship: `GENERALIZATION`, `REALIZATION`, `COMPOSITION`, `AGGREGATION`, `ASSOCIATION`, `DEPENDENCY`
    - Endpoint Kind: `LOGICAL_ENTITY`, `PHYSICAL_ENTITY`
  - [ ] 2.2 (Optional) Create Java enum classes if type safety is desired
    - `LogicalERCardinality.java` in `model/enums/` package
    - `LogicalERRelationship.java` in `model/enums/` package
    - `LogicalEREndpointKind.java` in `model/enums/` package

**Note:** The existing codebase uses String fields for enum-like values with database CHECK constraints. This approach maintains consistency. Java enums are optional for additional type safety.

**Acceptance Criteria:**
- Enum values documented consistently across codebase
- (Optional) Java enum classes created if desired

**Files to Create (Optional):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/enums/LogicalERCardinality.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/enums/LogicalERRelationship.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/enums/LogicalEREndpointKind.java`

---

### Backend: JPA Entity

#### Task Group 3: Update JPA Entity
**Dependencies:** Task Group 1
**Specialist:** backend-engineer

- [x] 3.0 Complete JPA entity update for LogicalDataEntityRelationshipEntity
  - [x] 3.1 Remove legacy fields from entity
    - Remove `sourceEntityId` field
    - Remove `targetEntityId` field
  - [x] 3.2 Rename field `relationshipType` to `cardinality`
    - Update field name and `@Column` annotation
    - `@Column(name = "cardinality")` (nullable = true per spec)
  - [x] 3.3 Add new polymorphic endpoint fields
    - `private String fromRefKind;` with `@Column(name = "from_ref_kind")`
    - `private String fromRefId;` with `@Column(name = "from_ref_id")`
    - `private String toRefKind;` with `@Column(name = "to_ref_kind")`
    - `private String toRefId;` with `@Column(name = "to_ref_id")`
  - [x] 3.4 Add relationship field
    - `private String relationship;` with `@Column(name = "relationship")`
  - [x] 3.5 Verify Lombok annotations work with new fields
    - `@Getter`, `@Setter`, `@Builder`, `@NoArgsConstructor`, `@AllArgsConstructor`

**Acceptance Criteria:**
- Entity compiles without errors
- All new columns mapped correctly
- Legacy fields removed
- Lombok generates correct builder and accessors

**Files to Modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/LogicalDataEntityRelationshipEntity.java`

---

### Backend: DTO

#### Task Group 4: Update DTO Record
**Dependencies:** Task Group 3
**Specialist:** backend-engineer

- [x] 4.0 Complete DTO update for LogicalDataEntityRelationshipDto
  - [x] 4.1 Remove legacy record parameters
    - Remove `sourceEntityId` parameter
    - Remove `targetEntityId` parameter
  - [x] 4.2 Rename parameter `relationshipType` to `cardinality`
    - Update `@JsonProperty("cardinality")` annotation
  - [x] 4.3 Add new polymorphic endpoint parameters
    - `@JsonProperty("from_ref_kind") String fromRefKind`
    - `@JsonProperty("from_ref_id") String fromRefId`
    - `@JsonProperty("to_ref_kind") String toRefKind`
    - `@JsonProperty("to_ref_id") String toRefId`
  - [x] 4.4 Add relationship parameter
    - `@JsonProperty("relationship") String relationship`
  - [x] 4.5 Reorder parameters for logical grouping
    - id, fromRefKind, fromRefId, toRefKind, toRefId, cardinality, relationship, description, tags, validFrom, validTo

**Acceptance Criteria:**
- DTO record compiles without errors
- JSON property names use snake_case for API contract
- Parameter order is logical and consistent

**Files to Modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/LogicalDataEntityRelationshipDto.java`

---

### Backend: Mapper

#### Task Group 5: Update EntityMapper
**Dependencies:** Task Groups 3, 4
**Specialist:** backend-engineer

- [x] 5.0 Complete EntityMapper update for LogicalDataEntityRelationship
  - [x] 5.1 Update `toDto()` method (lines ~874-885)
    - Remove `entity.getSourceEntityId()` mapping
    - Remove `entity.getTargetEntityId()` mapping
    - Add `entity.getFromRefKind()` mapping
    - Add `entity.getFromRefId()` mapping
    - Add `entity.getToRefKind()` mapping
    - Add `entity.getToRefId()` mapping
    - Rename `entity.getRelationshipType()` to `entity.getCardinality()`
    - Add `entity.getRelationship()` mapping
  - [x] 5.2 Update `toEntity()` method (lines ~887-899)
    - Remove `dto.sourceEntityId()` mapping
    - Remove `dto.targetEntityId()` mapping
    - Add `.fromRefKind(dto.fromRefKind())` builder call
    - Add `.fromRefId(dto.fromRefId())` builder call
    - Add `.toRefKind(dto.toRefKind())` builder call
    - Add `.toRefId(dto.toRefId())` builder call
    - Rename `.relationshipType(dto.relationshipType())` to `.cardinality(dto.cardinality())`
    - Add `.relationship(dto.relationship())` builder call

**Acceptance Criteria:**
- Mapper compiles without errors
- toDto() correctly maps all new fields
- toEntity() correctly maps all new fields
- No references to legacy fields remain

**Files to Modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`

---

### Backend: Validation

#### Task Group 6: Add Service Layer Validation
**Dependencies:** Task Groups 3, 4, 5
**Specialist:** backend-engineer

- [x] 6.0 Add pairwise validation for polymorphic endpoint constraints
  - [x] 6.1 Identify validation location in ModelService
    - Find save/update methods that handle LogicalDataEntityRelationship
    - Add validation before persistence
  - [x] 6.2 Implement pairwise validation logic
    - If `fromRefKind` is non-null, `fromRefId` must be non-null
    - If `fromRefId` is non-null, `fromRefKind` must be non-null
    - Same logic for `toRefKind`/`toRefId` pair
  - [x] 6.3 Add validation error response
    - Return appropriate HTTP 400 error with descriptive message
    - Example: "from_ref_kind and from_ref_id must both be set or both be null"

**Acceptance Criteria:**
- Pairwise validation enforced at service layer
- Clear error messages returned for validation failures
- Validation runs before database save

**Files to Modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`

---

### Backend: Tests

#### Task Group 7: Update Backend Tests
**Dependencies:** Task Groups 1-6
**Specialist:** backend-engineer

- [x] 7.0 Update existing tests for LogicalDataEntityRelationship changes
  - [x] 7.1 Write 4-6 focused tests for the updated functionality
    - Test 1: Save relationship with valid polymorphic endpoints (LOGICAL_ENTITY -> LOGICAL_ENTITY)
    - Test 2: Save relationship with cross-domain endpoints (LOGICAL_ENTITY -> PHYSICAL_ENTITY)
    - Test 3: Load relationship and verify all new fields mapped correctly
    - Test 4: Validate pairwise constraint - reject fromRefKind without fromRefId
    - Test 5: Validate enum values - reject invalid cardinality value
    - Test 6: (Optional) Test migration preserves existing data
  - [x] 7.2 Update ModelServiceSaveTest.java
    - Update test data to use new field names
    - Remove references to sourceEntityId/targetEntityId
    - Add fromRefKind, fromRefId, toRefKind, toRefId, relationship fields
  - [x] 7.3 Update ModelServiceLoadTest.java
    - Update assertions for new field names
    - Verify cardinality field (renamed from relationshipType)
    - Verify relationship field
  - [ ] 7.4 Update ModelControllerTest.java if applicable
    - Update JSON payloads to match new API contract
    - Verify snake_case field names in requests/responses
  - [x] 7.5 Run backend tests to verify changes
    - Run ONLY the LogicalDataEntityRelationship-related tests
    - Do NOT run entire test suite at this stage

**Acceptance Criteria:**
- 4-6 focused tests written and passing
- Existing tests updated to use new field names
- No test references to legacy fields
- Tests verify pairwise validation

**Files to Modify:**
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/ModelServiceSaveTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/ModelServiceLoadTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ModelControllerTest.java`

---

### Frontend: TypeScript Types

#### Task Group 8: Update TypeScript Types
**Dependencies:** Task Groups 4, 5 (API contract finalized)
**Specialist:** frontend-engineer

- [x] 8.0 Complete TypeScript type updates in model.ts
  - [x] 8.1 Add new enum type aliases
    - `export type LogicalERCardinality = 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_ONE' | 'MANY_TO_MANY';`
    - `export type LogicalERRelationship = 'GENERALIZATION' | 'REALIZATION' | 'COMPOSITION' | 'AGGREGATION' | 'ASSOCIATION' | 'DEPENDENCY';`
    - `export type LogicalEREndpointKind = 'LOGICAL_ENTITY' | 'PHYSICAL_ENTITY';`
  - [x] 8.2 Update LogicalDataEntityRelationship interface (lines ~813-823)
    - Remove `source_entity_id: string;`
    - Remove `target_entity_id: string;`
    - Add `from_ref_kind?: LogicalEREndpointKind;`
    - Add `from_ref_id?: string;`
    - Add `to_ref_kind?: LogicalEREndpointKind;`
    - Add `to_ref_id?: string;`
    - Rename `relationship_type: string;` to `cardinality?: LogicalERCardinality;`
    - Add `relationship?: LogicalERRelationship;`
  - [x] 8.3 Update field nullability
    - All new fields are optional (nullable) per spec

**Acceptance Criteria:**
- TypeScript compiles without errors
- Type aliases match backend enum values exactly
- Interface fields match backend DTO snake_case naming
- Nullable fields marked with `?`

**Files to Modify:**
- `frontend/src/types/model.ts`

---

### Frontend: Defaults Configuration

#### Task Group 9: Update Defaults Configuration
**Dependencies:** Task Group 8
**Specialist:** frontend-engineer

- [x] 9.0 Complete defaults.ts updates for new enum options
  - [x] 9.1 Add cardinality options array
    - `export const cardinalityOptions: LogicalERCardinality[] = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'];`
  - [x] 9.2 Add relationship options array
    - `export const logicalERRelationshipOptions: LogicalERRelationship[] = ['GENERALIZATION', 'REALIZATION', 'COMPOSITION', 'AGGREGATION', 'ASSOCIATION', 'DEPENDENCY'];`
  - [x] 9.3 Add endpoint kind options array
    - `export const logicalEREndpointKindOptions: LogicalEREndpointKind[] = ['LOGICAL_ENTITY', 'PHYSICAL_ENTITY'];`
  - [x] 9.4 Deprecate or remove old relationshipTypeOptions
    - Current: `export const relationshipTypeOptions = ['one-to-one', 'one-to-many', 'many-to-many'];` (line 1002)
    - Mark as `@deprecated` or remove if no longer used elsewhere
  - [x] 9.5 Import new type aliases
    - Add `LogicalERCardinality, LogicalERRelationship, LogicalEREndpointKind` to imports from `../types/model`

**Acceptance Criteria:**
- New option arrays exported and typed correctly
- Old relationshipTypeOptions deprecated/removed
- TypeScript compiles without errors

**Files to Modify:**
- `frontend/src/config/defaults.ts`

---

### Frontend: Grid Configuration

#### Task Group 10: Update Grid Configuration
**Dependencies:** Task Groups 8, 9
**Specialist:** frontend-engineer

- [x] 10.0 Complete gridConfigs.ts update for logical_data_entity_relationships
  - [x] 10.1 Remove legacy column configurations (lines ~315-316)
    - Remove `{ field: 'source_entity_id', ... }` column
    - Remove `{ field: 'target_entity_id', ... }` column
  - [x] 10.2 Add from endpoint columns
    - `{ field: 'from_ref_kind', displayName: 'From Kind', cellType: 'dropdown', required: false, width: 140, options: logicalEREndpointKindOptions }`
    - `{ field: 'from_ref_id', displayName: 'From Entity', cellType: 'fk_typeahead', required: false, width: 180, fkTarget: 'logical_data_entities' }`
    - Note: Dynamic fkTarget based on ref_kind is out of scope per spec
  - [x] 10.3 Add to endpoint columns
    - `{ field: 'to_ref_kind', displayName: 'To Kind', cellType: 'dropdown', required: false, width: 140, options: logicalEREndpointKindOptions }`
    - `{ field: 'to_ref_id', displayName: 'To Entity', cellType: 'fk_typeahead', required: false, width: 180, fkTarget: 'logical_data_entities' }`
  - [x] 10.4 Update cardinality column (line ~317)
    - Rename field from `relationship_type` to `cardinality`
    - Update displayName to 'Cardinality'
    - Change options from `relationshipTypeOptions` to `cardinalityOptions`
    - Set required: false (nullable)
  - [x] 10.5 Add relationship column
    - `{ field: 'relationship', displayName: 'Relationship', cellType: 'dropdown', required: false, width: 140, options: logicalERRelationshipOptions }`
  - [x] 10.6 Import new options arrays
    - Add imports for `cardinalityOptions`, `logicalERRelationshipOptions`, `logicalEREndpointKindOptions` from defaults.ts
  - [x] 10.7 Reorder columns for logical grouping
    - id, from_ref_kind, from_ref_id, to_ref_kind, to_ref_id, cardinality, relationship, description, valid_from, valid_to, tags

**Acceptance Criteria:**
- Grid config compiles without errors
- All new columns configured with correct cell types
- Dropdown options reference correct arrays
- Column order is logical and consistent
- Legacy columns removed

**Files to Modify:**
- `frontend/src/config/gridConfigs.ts`

---

## Execution Order

Recommended implementation sequence based on dependencies:

```
Phase 1: Database Foundation
  Task Group 1: Liquibase Migration (database-engineer)
    |
    v
Phase 2: Backend Core Updates (can be parallelized)
  Task Group 2: Backend Enums (backend-engineer) [optional]
  Task Group 3: JPA Entity Update (backend-engineer)
  Task Group 4: DTO Update (backend-engineer)
    |
    v
Phase 3: Backend Integration
  Task Group 5: Mapper Update (backend-engineer)
  Task Group 6: Validation (backend-engineer)
    |
    v
Phase 4: Backend Testing
  Task Group 7: Backend Tests (backend-engineer)
    |
    v
Phase 5: Frontend Updates (can be parallelized after API contract stable)
  Task Group 8: TypeScript Types (frontend-engineer)
  Task Group 9: Defaults Configuration (frontend-engineer)
  Task Group 10: Grid Configuration (frontend-engineer)
```

---

## Summary of Files to Modify

### Backend (architecture-model-service)
| File | Action |
|------|--------|
| `src/main/resources/db/changelog/sql/009-logical-er-polymorphic-endpoints.sql` | CREATE |
| `src/main/resources/db/changelog/db.changelog-master.yaml` | MODIFY |
| `src/main/java/.../model/entity/LogicalDataEntityRelationshipEntity.java` | MODIFY |
| `src/main/java/.../model/dto/relationship/LogicalDataEntityRelationshipDto.java` | MODIFY |
| `src/main/java/.../mapper/EntityMapper.java` | MODIFY |
| `src/main/java/.../service/ModelService.java` | MODIFY |
| `src/test/java/.../service/ModelServiceSaveTest.java` | MODIFY |
| `src/test/java/.../service/ModelServiceLoadTest.java` | MODIFY |
| `src/test/java/.../controller/ModelControllerTest.java` | MODIFY |

### Frontend
| File | Action |
|------|--------|
| `src/types/model.ts` | MODIFY |
| `src/config/defaults.ts` | MODIFY |
| `src/config/gridConfigs.ts` | MODIFY |

---

## Risk Notes

1. **Breaking API Change**: This is a breaking change to the API contract. Frontend and backend must be deployed together.
2. **Data Migration**: The Liquibase migration includes data migration. Test thoroughly on a copy of production data before deployment.
3. **No Backward Compatibility**: Per spec, no backward compatibility layer is provided for the old API contract.
4. **FK Target Limitation**: The fk_typeahead for ref_id columns will default to logical_data_entities. Dynamic filtering based on ref_kind is out of scope.
