# Task Breakdown: Add Service.Core Tech Column and Change Service Type to Free-Text

## Overview
Total Tasks: 16
Total Sub-Tasks: 16

This feature enhances the Service entity by:
1. Adding a new "Core Tech" field for documenting languages/tools/frameworks
2. Changing "Service Type" from a fixed dropdown to free-text input

## Task List

### Backend Database Layer

#### Task Group 1: Database Migration
**Dependencies:** None

- [x] 1.0 Complete database migration for core_tech column
  - [x] 1.1 Write 2 focused tests for core_tech column persistence
    - Test 1: Verify Service entity with core_tech value saves and retrieves correctly
    - Test 2: Verify Service entity with null core_tech saves without error
    - Add to: `architecture-model-service/src/test/java/com/example/architecturemodel/service/ServiceCoreTechPersistenceTest.java`
  - [x] 1.2 Create Liquibase migration file `014-service-core-tech.sql`
    - Location: `architecture-model-service/src/main/resources/db/changelog/sql/014-service-core-tech.sql`
    - Content: `ALTER TABLE services ADD COLUMN core_tech TEXT;`
    - Column is nullable (no NOT NULL constraint)
  - [x] 1.3 Register migration in `db.changelog-master.yaml`
    - Location: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Add changeSet with id: `014-service-core-tech`
    - Precondition: column `core_tech` does not exist on `services` table
    - Follow pattern from changeSet `009-logical-er-polymorphic-endpoints` (lines 130-145)
  - [x] 1.4 Ensure database migration tests pass
    - Run ONLY the 2 tests written in 1.1
    - Verify migration runs successfully on test database

**Acceptance Criteria:**
- Migration file exists at correct path
- Migration registered in changelog-master.yaml
- core_tech column added to services table as nullable TEXT
- The 2 tests written in 1.1 pass

---

### Backend Entity/DTO Layer

#### Task Group 2: JPA Entity and DTO Updates
**Dependencies:** Task Group 1

- [x] 2.0 Complete JPA entity and DTO updates
  - [x] 2.1 Write 3 focused tests for Service core_tech field mapping
    - Test 1: Verify ServiceDto to ServiceEntity mapping includes coreTech
    - Test 2: Verify ServiceEntity to ServiceDto mapping includes coreTech
    - Test 3: Verify arbitrary serviceType string (not in enum list) is accepted
    - Add to: `architecture-model-service/src/test/java/com/example/architecturemodel/service/ServiceCoreTechPersistenceTest.java`
  - [x] 2.2 Update ServiceEntity.java to add coreTech field
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ServiceEntity.java`
    - Add after line 38 (after tags field):
      ```java
      @Column(name = "core_tech")
      private String coreTech;
      ```
    - Lombok @Getter/@Setter/@Builder annotations handle accessors
  - [x] 2.3 Update ServiceDto.java to add coreTech field
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ServiceDto.java`
    - Add new parameter after `serviceType` (line 22):
      ```java
      @JsonProperty("core_tech")
      String coreTech,
      ```
    - Verify no enum validation on serviceType field (already a plain String)
  - [x] 2.4 Update EntityMapper.java toDto and toEntity methods
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
    - Update `toDto(ServiceEntity)` at line 177 to include `entity.getCoreTech()`:
      ```java
      return new ServiceDto(
          entity.getId(),
          entity.getName(),
          entity.getDescription(),
          entity.getApplicationId(),
          entity.getApplicationComponentId(),
          entity.getServiceType(),
          entity.getCoreTech(),  // ADD THIS
          entity.getTags(),
          entity.getValidFrom(),
          entity.getValidTo()
      );
      ```
    - Update `toEntity(ServiceDto, String)` at line 191 to include `.coreTech(dto.coreTech())`:
      ```java
      return ServiceEntity.builder()
          ...
          .serviceType(dto.serviceType())
          .coreTech(dto.coreTech())  // ADD THIS
          .tags(dto.tags())
          ...
          .build();
      ```
  - [x] 2.5 Ensure Entity/DTO mapping tests pass
    - Run ONLY the 3 tests written in 2.1
    - Verify round-trip mapping preserves coreTech value

**Acceptance Criteria:**
- ServiceEntity has coreTech field with @Column annotation
- ServiceDto record includes coreTech with @JsonProperty("core_tech")
- EntityMapper correctly maps coreTech in both directions
- No enum validation exists for serviceType
- The 3 tests written in 2.1 pass

---

### Frontend Model Layer

#### Task Group 3: Frontend TypeScript Model Updates
**Dependencies:** Task Group 2

- [x] 3.0 Complete frontend model updates
  - [x] 3.1 Write 2 focused tests for Service interface and API mapping
    - Test 1: Verify Service object with core_tech property serializes correctly
    - Test 2: Verify Service object with arbitrary service_type string is valid
    - Add to: `frontend/src/__tests__/service-core-tech-column.test.ts`
  - [x] 3.2 Update Service interface in model.ts
    - Location: `frontend/src/types/model.ts`
    - Add optional field after `service_type` at line 260:
      ```typescript
      export interface Service {
        id: string;
        name: string;
        description: string;
        application_id: string;
        app_component_id?: string;
        service_type: string;
        core_tech?: string;  // ADD THIS
        tags: string;
        valid_from?: string;
        valid_to?: string;
      }
      ```
    - Confirm `service_type: string` remains unchanged (already a string type)
  - [x] 3.3 Ensure frontend model tests pass
    - Run ONLY the 2 tests written in 3.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- Service interface includes optional `core_tech?: string` field
- service_type remains as string type (no enum constraint)
- TypeScript compilation passes with no errors
- The 2 tests written in 3.1 pass

---

### Frontend UI Layer

#### Task Group 4: Grid Configuration Updates
**Dependencies:** Task Group 3

- [x] 4.0 Complete grid configuration updates
  - [x] 4.1 Write 3 focused tests for Services grid configuration
    - Test 1: Verify services grid config has core_tech column with cellType 'text'
    - Test 2: Verify services grid config service_type column has cellType 'text' (not 'dropdown')
    - Test 3: Verify services grid config service_type column has no options property
    - Add to: `frontend/src/__tests__/service-core-tech-column.test.ts`
  - [x] 4.2 Update services grid configuration in gridConfigs.ts
    - Location: `frontend/src/config/gridConfigs.ts`
    - Change service_type column at line 104 from:
      ```typescript
      { field: 'service_type', displayName: 'Service Type', cellType: 'dropdown', required: false, width: 100, options: serviceTypeOptions },
      ```
      To:
      ```typescript
      { field: 'service_type', displayName: 'Service Type', cellType: 'text', required: false, width: 120 },
      ```
    - Add new core_tech column after service_type (insert at line 105):
      ```typescript
      { field: 'core_tech', displayName: 'Core Tech', cellType: 'text', required: false, width: 120 },
      ```
    - Final column order: ... | app_component_id | service_type | core_tech | tags | ...
  - [x] 4.3 Remove serviceTypeOptions from gridConfigs.ts imports
    - Location: `frontend/src/config/gridConfigs.ts`
    - Update import at line 6 to remove `serviceTypeOptions`:
      ```typescript
      import {
        appTypeOptions,
        statusOptions,
        // serviceTypeOptions,  // REMOVE THIS
        pointTypeOptions,
        ...
      } from './defaults';
      ```
    - Note: The `serviceTypeOptions` constant in defaults.ts (line 942) can remain for backward compatibility but is no longer used
  - [x] 4.4 Ensure grid configuration tests pass
    - Run ONLY the 3 tests written in 4.1
    - Verify grid renders correctly in browser

**Acceptance Criteria:**
- service_type column uses cellType: 'text' (not 'dropdown')
- service_type column has no options property
- New core_tech column added after service_type
- serviceTypeOptions removed from imports in gridConfigs.ts
- Column order is: ... | App Component | Service Type | Core Tech | Tags | ...
- The 3 tests written in 4.1 pass

---

### Integration Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 2 tests written in Task 1.1 (database layer)
    - Review the 3 tests written in Task 2.1 (entity/DTO layer)
    - Review the 2 tests written in Task 3.1 (frontend model)
    - Review the 3 tests written in Task 4.1 (grid configuration)
    - Total existing tests: approximately 10 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack coverage
    - Focus on: Create Service with core_tech, Update service_type to arbitrary text, Load Service with core_tech
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 4 additional integration tests maximum
    - Test 1: API endpoint accepts Service create with core_tech field
    - Test 2: API endpoint accepts Service update with arbitrary service_type
    - Test 3: Frontend can save Service with both core_tech and free-text service_type
    - Test 4: Existing Services with dropdown values (REST, SOAP, etc.) still display correctly
    - Add to: `frontend/src/__tests__/service-core-tech-column.test.ts`
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this feature (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 14 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 14 tests total)
- Create/Update/Read workflows verified for core_tech field
- Arbitrary service_type strings accepted without validation errors
- Existing dropdown values (REST, SOAP, gRPC, etc.) remain functional
- No more than 4 additional tests added

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Database Migration** - Create Liquibase migration and register in changelog
2. **Task Group 2: Backend Entity/DTO** - Update ServiceEntity, ServiceDto, and EntityMapper
3. **Task Group 3: Frontend Model** - Update Service interface in model.ts
4. **Task Group 4: Frontend UI** - Update gridConfigs.ts for new column and text input
5. **Task Group 5: Integration Testing** - Verify end-to-end workflows

## File Reference Summary

### Backend Files to Modify
| File | Line(s) | Change |
|------|---------|--------|
| `architecture-model-service/src/main/resources/db/changelog/sql/014-service-core-tech.sql` | New file | ALTER TABLE migration |
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | End of file | Add changeSet 014 |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ServiceEntity.java` | After line 38 | Add coreTech field |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ServiceDto.java` | After line 22 | Add coreTech parameter |
| `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` | Lines 177-204 | Update toDto/toEntity |

### Frontend Files to Modify
| File | Line(s) | Change |
|------|---------|--------|
| `frontend/src/types/model.ts` | Line 260 | Add core_tech to Service interface |
| `frontend/src/config/gridConfigs.ts` | Lines 6, 104-105 | Remove import, change dropdown to text, add column |

### Files NOT to Modify (Out of Scope)
- `frontend/src/config/defaults.ts` - serviceTypeOptions remains for backward compatibility
- ServiceRepository - no changes needed
- ModelService - no changes needed beyond what EntityMapper handles
- New API endpoints - only extend existing payloads
