# Task Breakdown: Fix SequenceMessage Entity Missing isCollection Field

## Overview
Total Tasks: 2 task groups, 9 sub-tasks

This is a 3-line bugfix across 2 files. The DB column and DTO field already exist; only the Entity class and Mapper are missing the wiring.

## Task List

### Backend Bugfix

#### Task Group 1: Entity and Mapper Fix
**Dependencies:** None

- [x] 1.0 Complete isCollection bugfix
  - [x] 1.1 Write 3 focused tests for the isCollection round-trip
    - Test that EntityMapper.toDto() maps isCollection=true from entity to DTO
    - Test that EntityMapper.toDto() maps isCollection=false (default) correctly
    - Test that EntityMapper.toEntity() maps isCollection from DTO to entity
  - [x] 1.2 Add isCollection field to SequenceMessageEntity.java
    - Add `@Column(name = "is_collection") private Boolean isCollection;` after the `labelText` field (line 43-44)
    - Follows the exact pattern of `showEndpointName` at lines 45-46
    - No manual accessors needed (Lombok @Getter/@Setter/@Builder)
  - [x] 1.3 Fix EntityMapper.toDto() to read isCollection from entity
    - Line 1184: replace `null,  // isCollection - Entity doesn't have this field yet...` with `entity.getIsCollection(),`
    - Remove or update the Javadoc comment block (lines 1164-1172) that documents this as a known gap
  - [x] 1.4 Fix EntityMapper.toEntity() to write isCollection from DTO
    - Add `.isCollection(dto.isCollection())` to the builder chain after `.labelText(dto.labelText())` (after line 1208)
  - [x] 1.5 Run tests from 1.1 and verify they pass

**Acceptance Criteria:**
- The 3 tests from 1.1 pass
- isCollection value round-trips correctly: DTO -> Entity -> DTO
- Hibernate schema validation passes (entity field matches existing DB column)

### Verification

#### Task Group 2: Build and Integration Check
**Dependencies:** Task Group 1

- [x] 2.0 Verify the fix end-to-end
  - [x] 2.1 Run existing SequenceMessage-related tests to confirm no regressions
    - Run `WorkItemImplementContextServiceTest` and any other existing mapper/sequence tests
  - [x] 2.2 Verify the application compiles and Hibernate `ddl-auto=validate` passes
  - [x] 2.3 Confirm no other files reference the removed null/comment (grep for the old comment text)

**Acceptance Criteria:**
- All existing tests pass with no regressions
- Application starts without Hibernate schema validation errors
- No stale references to the old "Entity doesn't have isCollection" comment remain

## Execution Order

1. Entity and Mapper Fix (Task Group 1)
2. Build and Integration Check (Task Group 2)

## Files to Modify

1. `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/SequenceMessageEntity.java` - Add isCollection field
2. `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` - Fix toDto() and toEntity() methods

## Files NOT to Modify (already correct)

- `SequenceMessageDto.java` - already has isCollection field
- Migration 039 SQL - DB column already exists
- Frontend files - already handle is_collection correctly
