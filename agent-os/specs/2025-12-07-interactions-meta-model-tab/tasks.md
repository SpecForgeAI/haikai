# Task Breakdown: Interactions Meta-Model Tab

## Overview
Total Tasks: 22

This feature adds an "Interactions" tab to the meta-model view, enabling users to create, edit, and delete Interaction records through a dedicated grid interface. The Interaction entity type already exists in the codebase; this feature focuses on exposing it through the UI.

## Task List

### Grid Configuration Layer

#### Task Group 1: Grid Configuration for Interactions
**Dependencies:** None

- [x] 1.0 Complete Interactions grid configuration
  - [x] 1.1 Write 3-5 focused tests for interactions grid configuration
    - Test that `gridConfigs.interactions` exists and has expected column definitions
    - Test that required columns (id, name, user_id, primary_app_business_point_id) are marked required
    - Test that fk_typeahead columns have correct fkTarget values
    - Test that column widths are reasonable values (> 0)
  - [x] 1.2 Add `interactions` entry to `gridConfigs` object in `frontend/src/config/gridConfigs.ts`
    - ID column: cellType 'text', required: true, autoGenerate: true, width: 100
    - Name column: cellType 'text', required: true, width: 180
    - Description column: cellType 'text', required: false, width: 180
    - User column: field 'user_id', cellType 'fk_typeahead', required: true, fkTarget: 'business_users', width: 150
    - Primary Point column: field 'primary_app_business_point_id', cellType 'fk_typeahead', required: true, width: 200
    - Secondary Point column: field 'secondary_app_business_point_id', cellType 'fk_typeahead', required: false, width: 200
    - Tags column: cellType 'tags', required: false, width: 120
    - Follow pattern from existing configs (lines 23-236 in gridConfigs.ts)
  - [x] 1.3 Ensure grid configuration tests pass
    - Run ONLY the tests written in 1.1
    - Verify grid config structure is correct

**Acceptance Criteria:**
- The tests written in 1.1 pass
- `gridConfigs.interactions` returns a valid array of GridColumnConfig objects
- All required columns are properly configured with correct cellType, required, and width values

---

### Tab Integration Layer

#### Task Group 2: Tab and Domain Grouping Integration
**Dependencies:** Task Group 1

- [x] 2.0 Complete tab integration for Interactions
  - [x] 2.1 Write 3-4 focused tests for tab integration
    - Test that `tabToEntityType['Interactions']` equals 'interactions'
    - Test that `entityTabNames` contains 'Interactions'
    - Test that `domainGroupings.business` contains 'Interactions' after 'Activities'
    - Test tab ordering: Users, Processes, Activities, Interactions (in that order within business group)
  - [x] 2.2 Add 'Interactions' entry to `tabToEntityType` mapping in `frontend/src/config/gridConfigs.ts` (line 239-252)
    - Add `'Interactions': 'interactions'` to the Record
  - [x] 2.3 Add 'Interactions' to `entityTabNames` array in `frontend/src/config/gridConfigs.ts` (line 264-277)
    - Insert 'Interactions' after 'Activities' in the array
  - [x] 2.4 Update `domainGroupings.business` array in `frontend/src/config/gridConfigs.ts` (line 279-283)
    - Change from `['Users', 'Processes', 'Activities']` to `['Users', 'Processes', 'Activities', 'Interactions']`
  - [x] 2.5 Ensure tab integration tests pass
    - Run ONLY the tests written in 2.1
    - Verify tab appears in correct position

**Acceptance Criteria:**
- The tests written in 2.1 pass
- Clicking "Interactions" tab loads the interactions grid
- Tab appears in Business domain group after Activities tab
- Tab label displays as "Interactions" (plural)

---

### Polymorphic Formatter Layer

#### Task Group 3: App_Business_Point Display Formatter
**Dependencies:** None (can run in parallel with Task Groups 1-2)

- [x] 3.0 Complete App_Business_Point polymorphic formatter
  - [x] 3.1 Write 4-6 focused tests for appBusinessPointDisplayFormatter
    - Test formatting APPLICATION entity: "Order System (Application)"
    - Test formatting BUSINESS_PROCESS entity: "Order Processing (Business Process)"
    - Test formatting SERVICE entity: "Order API (Service)"
    - Test returning empty string for empty ID
    - Test returning ID fallback when entity not found
    - Test searching across all 7 App_Business_Point collections
  - [x] 3.2 Add `APP_BUSINESS_POINT_KIND_LABELS` constant to `frontend/src/utils/formatters.ts`
    - Map all 7 entity types to human-readable labels:
      - 'APPLICATION': 'Application'
      - 'APP_COMPONENT': 'Application Component'
      - 'SERVICE': 'Service'
      - 'INTERFACE': 'Interface'
      - 'ENDPOINT': 'Endpoint'
      - 'BUSINESS_PROCESS': 'Business Process'
      - 'PROCESS_ACTIVITY': 'Process Activity'
  - [x] 3.3 Create `formatAppBusinessPointDisplay` function in `frontend/src/utils/formatters.ts`
    - Accept entity and entityType parameters
    - Return format: `<name> (<entity_type_label>)`
    - Follow pattern from `formatApplicationPointDisplay` (lines 44-47)
  - [x] 3.4 Create `createAppBusinessPointDisplayFormatter` factory function in `frontend/src/utils/formatters.ts`
    - Accept metaModel as parameter (needed to search multiple collections)
    - Use `resolveAppBusinessPoint()` from model.ts to find entity across collections
    - Return formatted display string or empty string for empty ID, or ID fallback
    - Follow pattern from `createApplicationPointDisplayFormatter` (lines 61-78)
  - [x] 3.5 Export `appBusinessPointDisplayFormatter` pre-configured formatter
    - Note: This requires access to metaModel at runtime, so may need different approach
    - Consider passing metaModel through displayFormatter signature or using closure pattern
  - [x] 3.6 Ensure formatter tests pass
    - Run ONLY the tests written in 3.1
    - Verify all 7 entity types format correctly

**Acceptance Criteria:**
- The tests written in 3.1 pass
- Formatter displays entities as "Name (Entity Type)"
- All 7 App_Business_Point entity types are supported
- Empty/invalid IDs handled gracefully

---

### Grid Component Layer

#### Task Group 4: Empty Entity Creation and ID Generation
**Dependencies:** Task Group 1

- [x] 4.0 Complete empty entity creation for Interactions
  - [x] 4.1 Write 3-4 focused tests for Interaction entity creation
    - Test that `createEmptyEntity('interactions')` returns object with correct structure
    - Test that returned object has empty strings for user_id, primary_app_business_point_id, secondary_app_business_point_id
    - Test that `generateEntityId('interactions')` returns ID with 'int-' prefix
    - Test that ID follows pattern: `int-<timestamp>-<random>`
  - [x] 4.2 Add 'interactions' case to `createEmptyEntity` function in `frontend/src/components/Grid/Grid.tsx` (lines 237-327)
    - Return object with:
      - id: auto-generated via generateEntityId
      - name: ''
      - description: ''
      - user_id: ''
      - primary_app_business_point_id: ''
      - secondary_app_business_point_id: ''
    - Follow pattern from existing cases (e.g., 'services' on lines 266-273)
  - [x] 4.3 Add 'interactions' prefix to `prefixMap` in `frontend/src/utils/idGenerator.ts` (lines 19-49)
    - Add `interactions: 'int'` to the prefixMap Record
  - [x] 4.4 Ensure entity creation tests pass
    - Run ONLY the tests written in 4.1
    - Verify new Interaction rows can be created with correct defaults

**Acceptance Criteria:**
- The tests written in 4.1 pass
- Clicking "+ Add Row" on Interactions grid creates new row with correct defaults
- Generated IDs follow `int-<timestamp>-<random>` pattern
- All FK fields default to empty strings

---

### Validation Integration Layer

#### Task Group 5: Validation Integration for Interactions
**Dependencies:** Task Groups 1, 4

- [x] 5.0 Complete validation integration for Interactions
  - [x] 5.1 Write 3-4 focused tests for Interaction validation in meta-model context
    - Test that validateModel includes interactions in entity types array
    - Test that required field validation triggers for missing name
    - Test that required field validation triggers for missing user_id
    - Test that required field validation triggers for missing primary_app_business_point_id
  - [x] 5.2 Add 'interactions' to entityTypes array in `validateModel()` function in `frontend/src/utils/validation.ts` (lines 715-728)
    - Add 'interactions' after 'physical_data_attributes' in the array
    - This enables standard required field and FK validation for interactions grid
  - [x] 5.3 Verify existing validateInteractionReferences function integration
    - Confirm function already exists and is called (lines 543-617, 782-784)
    - Verify it validates user_id, primary_app_business_point_id, secondary_app_business_point_id
    - No code changes needed, just verification
  - [x] 5.4 Ensure validation tests pass
    - Run ONLY the tests written in 5.1
    - Verify validation errors display correctly in grid

**Acceptance Criteria:**
- The tests written in 5.1 pass
- Empty required fields show validation errors
- Invalid FK references show validation errors
- Existing validateInteractionReferences continues to work

---

### Testing & Integration

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 3-5 tests written by Task Group 1 (grid config)
    - Review the 3-4 tests written by Task Group 2 (tab integration)
    - Review the 4-6 tests written by Task Group 3 (formatter)
    - Review the 3-4 tests written by Task Group 4 (entity creation)
    - Review the 3-4 tests written by Task Group 5 (validation)
    - Total existing tests: approximately 16-23 tests
  - [x] 6.2 Analyze test coverage gaps for Interactions tab feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize user workflows: create interaction, edit interaction, validate interaction
  - [x] 6.3 Write up to 6 additional integration tests if needed
    - Add tests for end-to-end workflow: click tab -> see grid -> add row -> edit fields -> validate
    - Add test for polymorphic FK dropdown showing entities from all 7 collections
    - Add test for grid rendering with existing Interaction data
    - Do NOT write exhaustive edge case tests
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to Interactions tab feature
    - Expected total: approximately 22-29 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical user workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22-29 tests total)
- Critical user workflows for Interactions tab are covered
- No more than 6 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Grid Configuration** - Foundation for grid display
2. **Task Group 3: Polymorphic Formatter** - Can run in parallel with Group 1
3. **Task Group 2: Tab Integration** - Depends on Group 1
4. **Task Group 4: Empty Entity Creation** - Depends on Group 1
5. **Task Group 5: Validation Integration** - Depends on Groups 1, 4
6. **Task Group 6: Test Review & Gap Analysis** - Final verification

## Key Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/config/gridConfigs.ts` | Add interactions grid config, tab mapping, domain grouping |
| `frontend/src/utils/formatters.ts` | Add App_Business_Point polymorphic formatter |
| `frontend/src/components/Grid/Grid.tsx` | Add interactions case to createEmptyEntity |
| `frontend/src/utils/idGenerator.ts` | Add 'interactions' prefix |
| `frontend/src/utils/validation.ts` | Add 'interactions' to entityTypes array |

## Implementation Notes

1. **Polymorphic FK Handling**: The Primary/Secondary Point columns reference entities across 7 different collections. The formatter must use `resolveAppBusinessPoint()` from `model.ts` to look up entities.

2. **Existing Interaction Support**: The `Interaction` interface, `ENTITY_TYPES.INTERACTION`, and `validateInteractionReferences()` already exist. This feature adds the UI layer.

3. **Grid Column Config Pattern**: Follow existing patterns in `gridConfigs.ts`. Each entity type's config is an array of `GridColumnConfig` objects with field, displayName, cellType, required, width, and optional fkTarget/displayFormatter.

4. **Tab Positioning**: The spec requires Interactions tab between Activities and the domain separator. Update `domainGroupings.business` to include 'Interactions' after 'Activities'.

## Completion Summary

All 6 task groups have been successfully completed:

### Implementation Details:

1. **Grid Configuration (Task Group 1)**: Added `interactions` grid config with 7 columns:
   - id (auto-generated, required)
   - name (required)
   - description (optional)
   - user_id (FK to business_users, required)
   - primary_app_business_point_id (polymorphic FK, required)
   - secondary_app_business_point_id (polymorphic FK, optional)
   - tags (optional)

2. **Tab Integration (Task Group 2)**:
   - Added 'Interactions': 'interactions' to tabToEntityType
   - Added 'Interactions' to entityTabNames after 'Activities'
   - Updated domainGroupings.business: ['Users', 'Processes', 'Activities', 'Interactions']

3. **App_Business_Point Formatter (Task Group 3)**:
   - Created APP_BUSINESS_POINT_KIND_LABELS for all 7 entity types
   - Created formatAppBusinessPointDisplay() function
   - Created createAppBusinessPointDisplayFormatter() factory
   - Created getAllAppBusinessPointEntities() aggregation helper

4. **Entity Creation (Task Group 4)**:
   - Added 'interactions' case to createEmptyEntity() with correct defaults
   - Added 'interactions': 'int' prefix to idGenerator

5. **Validation Integration (Task Group 5)**:
   - Added 'interactions' to entityTypes array in validateModel()
   - Added 'interactions' to ENTITY_TYPE_DISPLAY_NAMES
   - Added POLYMORPHIC_FK_TARGETS array to skip standard FK validation for 'app_business_points'
   - Added 'INTERACTION' to diagram node entity type mapping
   - Verified validateInteractionReferences() is called

6. **Test Suite (Task Group 6)**:
   - Created comprehensive test file with 37 passing tests
   - Tests cover all task groups: grid config, tab integration, formatter, ID generation, validation

### Files Modified:
- `frontend/src/config/gridConfigs.ts`
- `frontend/src/utils/formatters.ts`
- `frontend/src/utils/idGenerator.ts`
- `frontend/src/components/Grid/Grid.tsx`
- `frontend/src/utils/validation.ts`

### Files Created:
- `frontend/src/__tests__/interactions-meta-model-tab.test.ts`

### Test Results:
- 37 tests passing
- 0 tests failing
