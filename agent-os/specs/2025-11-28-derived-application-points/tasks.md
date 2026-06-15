# Task Breakdown: Derived Application Points

## Overview
Total Tasks: 34

This feature transforms Application Points from user-managed entities into automatically derived, internal records that maintain a one-to-one relationship with Applications, App Components, and Services. The implementation hides this complexity from users while preserving existing diagram and relationship functionality.

## Task List

### Type Definitions

#### Task Group 1: ApplicationPoint Interface Enhancement
**Dependencies:** None

- [x] 1.0 Complete ApplicationPoint type enhancements
  - [x] 1.1 Write 4-6 focused tests for ApplicationPoint type validation
    - Test that `kind` field accepts valid values ('APPLICATION', 'APP_COMPONENT', 'SERVICE')
    - Test that `application_component_id` is optional and correctly typed
    - Test that `service_id` is optional and correctly typed
    - Test backward compatibility with existing `application_id` field
  - [x] 1.2 Add `kind` field to ApplicationPoint interface
    - File: `frontend/src/types/model.ts` (lines 56-66)
    - Add: `kind: 'APPLICATION' | 'APP_COMPONENT' | 'SERVICE'`
    - Add TypeScript type for ApplicationPointKind
  - [x] 1.3 Add optional foreign key fields to ApplicationPoint interface
    - File: `frontend/src/types/model.ts`
    - Add: `application_component_id?: string`
    - Add: `service_id?: string`
    - Keep existing `application_id` field for backward compatibility
  - [x] 1.4 Ensure type definition tests pass
    - Run ONLY the tests written in 1.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- ApplicationPoint interface includes `kind` field with union type
- Optional foreign key fields for component and service are present
- Existing `application_id` field is preserved
- TypeScript compiles without errors

---

### Sync Layer

#### Task Group 2: Application Point Synchronization Utilities
**Dependencies:** Task Group 1

- [x] 2.0 Complete Application Point sync utilities
  - [x] 2.1 Write 6-8 focused tests for sync utility functions
    - Test `generateApplicationPointId()` produces deterministic IDs (`ap_{source_id}`)
    - Test `createApplicationPointFromEntity()` creates correct AP for Application
    - Test `createApplicationPointFromEntity()` creates correct AP for App Component
    - Test `createApplicationPointFromEntity()` creates correct AP for Service
    - Test `findApplicationPointForEntity()` lookups work correctly
    - Test `getOrphanedApplicationPoints()` identifies orphans
  - [x] 2.2 Create new file `frontend/src/utils/applicationPointSync.ts`
    - Define `ApplicationPointKind` type alias
    - Define `SourceEntityType` type ('applications' | 'app_components' | 'services')
  - [x] 2.3 Implement `generateApplicationPointId(sourceEntityId: string): string`
    - Return `ap_${sourceEntityId}` for deterministic ID generation
    - Ensure consistent format across load/save cycles
  - [x] 2.4 Implement `createApplicationPointFromEntity()` function
    - Parameters: `sourceEntity`, `sourceType: SourceEntityType`
    - Return new ApplicationPoint with:
      - `id`: generated via `generateApplicationPointId()`
      - `name`: copied from source entity
      - `kind`: set based on sourceType
      - `application_id`: set for APPLICATION kind
      - `application_component_id`: set for APP_COMPONENT kind
      - `service_id`: set for SERVICE kind
      - `description`: empty string
      - `point_type`: empty string (deprecated)
      - `tags`: empty string
  - [x] 2.5 Implement `findApplicationPointForEntity()` function
    - Parameters: `entityId: string`, `applicationPoints: ApplicationPoint[]`
    - Look up by deterministic ID pattern `ap_${entityId}`
    - Return ApplicationPoint or undefined
  - [x] 2.6 Implement `getOrphanedApplicationPoints()` function
    - Parameters: `applicationPoints`, `applications`, `appComponents`, `services`
    - Return array of ApplicationPoints not linked to any source entity
  - [x] 2.7 Ensure sync utility tests pass
    - Run ONLY the tests written in 2.1
    - Verify all utility functions work correctly

**Acceptance Criteria:**
- Deterministic ID generation produces `ap_{source_id}` format
- ApplicationPoint creation correctly sets `kind` and foreign keys
- Lookup function finds AP by entity ID
- Orphan detection identifies APs without source entities

---

#### Task Group 3: Cascade Deletion Utilities
**Dependencies:** Task Group 2

- [x] 3.0 Complete cascade deletion utilities
  - [x] 3.1 Write 4-6 focused tests for cascade deletion
    - Test `cascadeDeleteApplicationPoint()` removes target AP
    - Test cascade removes `application_point_business_processes` referencing AP
    - Test cascade removes `data_movements` where AP is source or target
    - Test cascade returns updated relationships state
  - [x] 3.2 Implement `cascadeDeleteApplicationPoint()` function
    - File: `frontend/src/utils/applicationPointSync.ts`
    - Parameters: `applicationPointId`, `relationships: MetaModelRelationships`
    - Return updated relationships object with:
      - Filtered `application_point_business_processes` (remove refs to deleted AP)
      - Filtered `data_movements` (remove where source or target matches)
  - [x] 3.3 Implement `cascadeDeleteForSourceEntity()` function
    - Parameters: `entityId`, `entityType`, `entities`, `relationships`
    - Find corresponding ApplicationPoint via `findApplicationPointForEntity()`
    - If found, call `cascadeDeleteApplicationPoint()` and filter AP from entities
    - Return updated entities and relationships
  - [x] 3.4 Ensure cascade deletion tests pass
    - Run ONLY the tests written in 3.1
    - Verify cascade correctly removes dependent records

**Acceptance Criteria:**
- Cascade deletion removes ApplicationPoint
- Related `application_point_business_processes` records are removed
- Related `data_movements` records are removed (source or target)
- Function returns properly filtered state

---

#### Task Group 4: JSON Load Reconciliation
**Dependencies:** Task Groups 2, 3

- [x] 4.0 Complete JSON load reconciliation
  - [x] 4.1 Write 4-6 focused tests for reconciliation
    - Test reconciliation creates missing APs for Applications
    - Test reconciliation creates missing APs for App Components
    - Test reconciliation creates missing APs for Services
    - Test reconciliation removes orphaned APs
    - Test reconciliation preserves valid existing APs
  - [x] 4.2 Implement `reconcileApplicationPoints()` function
    - File: `frontend/src/utils/applicationPointSync.ts`
    - Parameters: `metaModel: MetaModel`
    - Return reconciled MetaModel with:
      - Missing APs created for all source entities
      - Orphaned APs removed
      - Existing valid APs preserved
  - [x] 4.3 Add console warnings for reconciliation actions
    - Log warning when creating missing AP: `"Creating missing ApplicationPoint for {entityType} {entityId}"`
    - Log warning when removing orphan: `"Removing orphaned ApplicationPoint {apId}"`
  - [x] 4.4 Ensure reconciliation tests pass
    - Run ONLY the tests written in 4.1
    - Verify reconciliation handles all scenarios

**Acceptance Criteria:**
- Missing ApplicationPoints are created for source entities
- Orphaned ApplicationPoints are removed
- Console warnings logged for reconciliation actions
- Existing valid APs are preserved

---

### Reducer Integration

#### Task Group 5: Reducer Sync Integration
**Dependencies:** Task Groups 2, 3, 4

- [x] 5.0 Complete reducer sync integration
  - [x] 5.1 Write 6-8 focused tests for reducer integration
    - Test ADD_ENTITY for Application creates corresponding AP
    - Test ADD_ENTITY for App Component creates corresponding AP
    - Test ADD_ENTITY for Service creates corresponding AP
    - Test DELETE_ENTITY for Application deletes AP and cascades
    - Test DELETE_ENTITY for App Component deletes AP and cascades
    - Test DELETE_ENTITY for Service deletes AP and cascades
    - Test LOAD_MODEL triggers reconciliation
  - [x] 5.2 Modify ADD_ENTITY case for sync entity types
    - File: `frontend/src/contexts/ArchitectureContext.tsx` (lines 146-161)
    - After adding Application/App Component/Service, create AP
    - Add AP to `entities.application_points` array
    - Maintain atomicity within single state update
  - [x] 5.3 Modify DELETE_ENTITY case for sync entity types
    - File: `frontend/src/contexts/ArchitectureContext.tsx` (lines 163-179)
    - Before deleting Application/App Component/Service:
      - Find corresponding AP via `findApplicationPointForEntity()`
      - Remove AP from entities
      - Call `cascadeDeleteApplicationPoint()` for relationships
    - Return state with all deletions applied atomically
  - [x] 5.4 Modify LOAD_MODEL case to include reconciliation
    - File: `frontend/src/contexts/ArchitectureContext.tsx` (lines 89-106)
    - After loading model, call `reconcileApplicationPoints()`
    - Apply reconciled metaModel to state
  - [x] 5.5 Ensure reducer integration tests pass
    - Run ONLY the tests written in 5.1
    - Verify sync operations occur automatically

**Acceptance Criteria:**
- Creating Application/App Component/Service auto-creates AP
- Deleting source entity auto-deletes AP with cascade
- Loading model triggers reconciliation
- All operations maintain atomicity

---

### UI Removal

#### Task Group 6: Meta-Model View Tab Removal
**Dependencies:** None (can run parallel to Task Groups 2-5)

- [x] 6.0 Complete meta-model view tab removal
  - [x] 6.1 Write 2-4 focused tests for tab removal
    - Test `entityTabNames` does not contain "Application Points"
    - Test `tabToEntityType` does not have "Application Points" key
    - Test default selected tab is valid (not "Application Points")
  - [x] 6.2 Remove "Application Points" from `entityTabNames` array
    - File: `frontend/src/config/gridConfigs.ts` (line 188)
    - Remove string "Application Points" from array
    - Keep array order for remaining tabs
  - [x] 6.3 Remove "Application Points" from `tabToEntityType` mapping
    - File: `frontend/src/config/gridConfigs.ts` (line 164)
    - Delete key-value pair `'Application Points': 'application_points'`
    - Keep `application_points` grid config for internal use (line 58-67)
  - [x] 6.4 Verify default selected tab in initial state
    - File: `frontend/src/contexts/ArchitectureContext.tsx` (line 76)
    - Ensure `selectedTab: 'Users'` remains valid default
  - [x] 6.5 Ensure tab removal tests pass
    - Run ONLY the tests written in 6.1
    - Verify tab is hidden from users

**Acceptance Criteria:**
- "Application Points" tab not visible in meta-model view
- Grid config retained for internal/debug use
- Default tab selection works correctly
- No runtime errors from tab removal

---

#### Task Group 7: Diagram Palette Section Removal
**Dependencies:** None (can run parallel to Task Groups 2-6)

- [x] 7.0 Complete palette section removal
  - [x] 7.1 Write 2-4 focused tests for palette section removal
    - Test `getPaletteSections()` does not return `application_points` section
    - Test `getEntityTypeConstant()` still maps `application_points` (internal use)
    - Test Applications, App Components, Services sections remain visible
  - [x] 7.2 Remove `application_points` section from `getPaletteSections()`
    - File: `frontend/src/utils/paletteData.ts` (lines 74-79)
    - Delete the `application_points` entry from `entitySections` array
    - Keep surrounding sections intact
  - [x] 7.3 Verify `getEntityTypeConstant()` retains `application_points` mapping
    - File: `frontend/src/utils/paletteData.ts` (line 21)
    - Confirm mapping `application_points: ENTITY_TYPES.APPLICATION_POINT` remains
    - This is needed for internal rendering logic
  - [x] 7.4 Ensure palette section tests pass
    - Run ONLY the tests written in 7.1
    - Verify section is hidden from users

**Acceptance Criteria:**
- "Application Points" section not visible in palette
- Internal `getEntityTypeConstant()` mapping preserved
- Other entity sections remain functional
- No runtime errors from section removal

---

### Palette-to-Diagram Mapping

#### Task Group 8: Application Point Node Creation
**Dependencies:** Task Groups 2, 5

- [x] 8.0 Complete palette-to-diagram node mapping
  - [x] 8.1 Write 4-6 focused tests for node creation mapping
    - Test adding Application creates APPLICATION_POINT node
    - Test adding App Component creates APPLICATION_POINT node
    - Test adding Service creates APPLICATION_POINT node
    - Test node `entity_id` is the ApplicationPoint ID (not source entity ID)
    - Test display label shows source entity name
  - [x] 8.2 Create helper function `resolveToApplicationPoint()`
    - File: `frontend/src/utils/applicationPointSync.ts`
    - Parameters: `entityType`, `entityId`, `applicationPoints`
    - For APPLICATION, APP_COMPONENT, SERVICE types:
      - Look up corresponding AP via `findApplicationPointForEntity()`
      - Return `{ entityType: 'APPLICATION_POINT', entityId: ap.id }`
    - For other types, return original values unchanged
  - [x] 8.3 Modify `handleItemClick()` in PalettePanel
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx` (lines 69-100)
    - For `applications`, `app_components`, `services` sections:
      - Call `resolveToApplicationPoint()` to get AP info
      - Create node with `entity_type=APPLICATION_POINT`, `entity_id=ap.id`
    - For other sections, use original behavior
  - [x] 8.4 Modify `handleContextMenuAdd()` in PalettePanel
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx` (lines 123-147)
    - Apply same resolution logic as `handleItemClick()`
    - Ensure context menu "Add" creates APPLICATION_POINT node
  - [x] 8.5 Ensure node creation tests pass
    - Run ONLY the tests written in 8.1
    - Verify nodes are created with correct entity_type

**Acceptance Criteria:**
- Adding Application/Component/Service creates APPLICATION_POINT node
- Node `entity_id` references the ApplicationPoint, not source entity
- Display label still shows source entity name
- Existing non-AP entity types work unchanged

---

#### Task Group 9: Entity Label Resolution Enhancement
**Dependencies:** Task Group 8

- [x] 9.0 Complete entity label resolution for APPLICATION_POINT
  - [x] 9.1 Write 3-5 focused tests for label resolution
    - Test `getEntityLabel()` for APPLICATION kind AP returns Application name
    - Test `getEntityLabel()` for APP_COMPONENT kind AP returns Component name
    - Test `getEntityLabel()` for SERVICE kind AP returns Service name
    - Test fallback to AP name if source entity not found
  - [x] 9.2 Extend `getEntityLabel()` function for APPLICATION_POINT resolution
    - File: `frontend/src/utils/rendering.ts` (lines 44-56)
    - For `entity_type === 'APPLICATION_POINT'`:
      - Look up ApplicationPoint by `entityId`
      - Based on `kind` field, resolve to source entity:
        - APPLICATION: look up in `applications` by `application_id`
        - APP_COMPONENT: look up in `app_components` by `application_component_id`
        - SERVICE: look up in `services` by `service_id`
      - Return source entity's name
      - Fallback to AP name if source not found
  - [x] 9.3 Ensure label resolution tests pass
    - Run ONLY the tests written in 9.1
    - Verify labels display source entity names

**Acceptance Criteria:**
- APPLICATION_POINT nodes display source entity name
- Resolution follows `kind` field to correct source collection
- Graceful fallback if source entity not found
- Existing label resolution for other types unchanged

---

### Testing & Verification

#### Task Group 10: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-9

- [x] 10.0 Review existing tests and fill critical gaps
  - [x] 10.1 Review tests from Task Groups 1-9
    - Review type definition tests (Group 1): ~4-6 tests
    - Review sync utility tests (Group 2): ~6-8 tests
    - Review cascade deletion tests (Group 3): ~4-6 tests
    - Review reconciliation tests (Group 4): ~4-6 tests
    - Review reducer integration tests (Group 5): ~6-8 tests
    - Review UI removal tests (Groups 6-7): ~4-8 tests
    - Review palette mapping tests (Groups 8-9): ~7-11 tests
    - Total existing tests: approximately 35-53 tests
  - [x] 10.2 Analyze test coverage gaps for this feature
    - Identify end-to-end workflows lacking coverage
    - Focus on integration points between sync layer and UI
    - Prioritize scenarios affecting data integrity
  - [x] 10.3 Write up to 8 additional integration tests if needed
    - Test full workflow: create Application -> verify AP created -> add to diagram
    - Test full workflow: delete Application -> verify AP deleted -> verify cascade
    - Test full workflow: load JSON with missing APs -> verify reconciliation
    - Test full workflow: FK dropdown displays source entity name
    - Add maximum of 8 tests to fill critical gaps
  - [x] 10.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Verify all critical workflows pass
    - Do NOT run entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass
- Critical end-to-end workflows covered
- No more than 8 additional tests added
- Testing focused exclusively on derived AP feature

---

## Execution Order

Recommended implementation sequence:

```
Phase 1: Foundation (Sequential)
  1. Task Group 1: Type Definitions
  2. Task Group 2: Sync Layer - Utilities
  3. Task Group 3: Sync Layer - Cascade Deletion
  4. Task Group 4: Sync Layer - Reconciliation

Phase 2: Integration (Sequential, depends on Phase 1)
  5. Task Group 5: Reducer Integration

Phase 3: UI Changes (Parallel, independent of Phase 2)
  6. Task Group 6: Meta-Model Tab Removal    } Can run in parallel
  7. Task Group 7: Palette Section Removal   } with each other

Phase 4: Mapping (Sequential, depends on Phase 2)
  8. Task Group 8: Palette-to-Diagram Mapping
  9. Task Group 9: Label Resolution Enhancement

Phase 5: Verification (Sequential, depends on all)
  10. Task Group 10: Test Review & Gap Analysis
```

---

## Key Files Summary

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/types/model.ts` | 1 | Add `kind` field, optional FK fields to ApplicationPoint |
| `frontend/src/utils/applicationPointSync.ts` | 2, 3, 4, 8 | NEW file - sync utilities |
| `frontend/src/contexts/ArchitectureContext.tsx` | 5 | Wire sync into ADD_ENTITY, DELETE_ENTITY, LOAD_MODEL |
| `frontend/src/config/gridConfigs.ts` | 6 | Remove "Application Points" from tabs |
| `frontend/src/utils/paletteData.ts` | 7 | Remove application_points palette section |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | 8 | Modify add handlers for AP lookup |
| `frontend/src/utils/rendering.ts` | 9 | Extend getEntityLabel() for AP resolution |

---

## Notes

- **Atomicity**: Sync operations (create/delete) must complete in single reducer action to prevent inconsistent state
- **Deterministic IDs**: Use `ap_{source_entity_id}` pattern for predictable cross-session persistence
- **Backward Compatibility**: Existing `application_id` field remains for APPLICATION kind
- **Internal Access**: Grid config and entity type mappings retained for debugging/admin use
- **Out of Scope**: Name sync on edit, migration tooling, undo/redo support
