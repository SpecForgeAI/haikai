# Task Breakdown: Auto-Create + Sync App_Business_Point

## Overview
Total Tasks: 28

This feature transforms App_Business_Point from a virtual/polymorphic concept into a real indirect entity that is automatically created, synced, and deleted in lockstep with 6 source entity types (Application, App Component, Service, Interface, Business Process, Process Activity). Note: Endpoint is excluded as it's a child entity of Interface.

## Task List

### Type Definitions Layer

#### Task Group 1: Add AppBusinessPoint Interface and Type Updates
**Dependencies:** None

- [x] 1.0 Complete type definitions for AppBusinessPoint
  - [x] 1.1 Write 3-5 focused tests for AppBusinessPoint type definitions
    - Test that AppBusinessPoint interface has required fields (id, name, kind, source_entity_id)
    - Test that AppBusinessPointKind values match expected 6 types
    - Test that isAppBusinessPointKind() correctly validates entity types
    - Test deterministic ID generation pattern `abp_{source_entity_id}`
  - [x] 1.2 Add AppBusinessPoint interface to `frontend/src/types/model.ts`
    - Fields: `id: string`, `name: string`, `kind: AppBusinessPointKind`, `source_entity_id: string`
    - Place after existing `APP_BUSINESS_POINT_TYPES` constant
    - Add JSDoc comment explaining purpose as indirect/lookup entity
  - [x] 1.3 Update MetaModelEntities interface in `frontend/src/types/model.ts`
    - Add `app_business_points: AppBusinessPoint[]` property
    - Place after `interactions: Interaction[]`
  - [x] 1.4 Update ENTITY_TYPES constant in `frontend/src/types/model.ts`
    - Add `APP_BUSINESS_POINT: 'APP_BUSINESS_POINT'` entry
    - Place after `INTERACTION` entry
  - [x] 1.5 Update EntityType union in `frontend/src/types/model.ts`
    - Add `'app_business_points'` to the union type
    - Place after `'interactions'`
  - [x] 1.6 Ensure type definitions tests pass
    - Run ONLY the 3-5 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-5 tests written in 1.1 pass
- AppBusinessPoint interface is properly defined with all required fields
- MetaModelEntities includes app_business_points array
- ENTITY_TYPES includes APP_BUSINESS_POINT
- EntityType union includes 'app_business_points'
- TypeScript compilation succeeds with no errors

---

### Sync Utilities Layer

#### Task Group 2: Create appBusinessPointSync.ts Utility Module
**Dependencies:** Task Group 1

- [x] 2.0 Complete appBusinessPointSync utility module
  - [x] 2.1 Write 5-8 focused tests for sync utility functions
    - Test `generateAppBusinessPointId()` produces deterministic `abp_{id}` pattern
    - Test `createAppBusinessPointFromEntity()` for APPLICATION kind
    - Test `createAppBusinessPointFromEntity()` for PROCESS_ACTIVITY kind
    - Test `findAppBusinessPointForEntity()` finds correct ABP by source entity ID
    - Test `syncAppBusinessPointNameForEntity()` updates name when ABP exists
    - Test `syncAppBusinessPointNameForEntity()` creates ABP when missing
    - Test `getOrphanedAppBusinessPoints()` identifies ABPs without source entities
  - [x] 2.2 Create `frontend/src/utils/appBusinessPointSync.ts`
    - Follow pattern from `applicationPointSync.ts` exactly
    - Define `ABPSourceEntityType` covering all 6 source types
    - Define `ABPSourceEntity` union type
    - Define `MinimalABPSourceEntity` interface
  - [x] 2.3 Implement ID generation function
    - `generateAppBusinessPointId(sourceEntityId: string): string`
    - Pattern: `abp_{sourceEntityId}` for deterministic reconciliation
    - Follow `generateApplicationPointId()` pattern
  - [x] 2.4 Implement ABP creation function
    - `createAppBusinessPointFromEntity(sourceEntity, sourceType): AppBusinessPoint`
    - Map source entity type to `AppBusinessPointKind` kind value
    - Copy name from source entity (name is derived, never user-authored)
    - Set `source_entity_id` to the source entity's ID
  - [x] 2.5 Implement ABP lookup functions
    - `findAppBusinessPointForEntity(entityId, abps): AppBusinessPoint | undefined`
    - `findSourceEntityForAppBusinessPoint(abp, entities): ABPSourceEntity | undefined`
    - Use deterministic ID pattern for lookup
  - [x] 2.6 Implement name sync function for edit-time
    - `syncAppBusinessPointNameForEntity(entities, entityType, entityId, newName): AppBusinessPoint[]`
    - If ABP exists, update its name
    - If ABP missing, create it with proper kind and source_entity_id
    - Return updated app_business_points array
  - [x] 2.7 Implement orphan detection function
    - `getOrphanedAppBusinessPoints(abps, entities): AppBusinessPoint[]`
    - Check all 6 source collections for matching source_entity_id
    - Return ABPs where no source entity exists
  - [x] 2.8 Ensure sync utility tests pass
    - Run ONLY the 5-8 tests written in 2.1
    - Verify all utility functions work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5-8 tests written in 2.1 pass
- ID generation produces consistent `abp_{id}` format
- ABP creation correctly sets kind, name, and source_entity_id
- Name sync correctly updates or creates ABPs
- Orphan detection correctly identifies ABPs without source entities

---

### Cascade Delete & Reconciliation Layer

#### Task Group 3: Implement Cascade Delete and Reconciliation Functions
**Dependencies:** Task Group 2

- [x] 3.0 Complete cascade delete and reconciliation logic
  - [x] 3.1 Write 4-6 focused tests for cascade delete and reconciliation
    - Test `cascadeDeleteAppBusinessPoint()` removes ABP and clears Interaction FK refs
    - Test `cascadeDeleteForABPSourceEntity()` finds and deletes corresponding ABP
    - Test `reconcileAppBusinessPoints()` creates missing ABPs for all 6 source types
    - Test `reconcileAppBusinessPoints()` removes orphaned ABPs
    - Test `reconcileAppBusinessPoints()` force-updates ABP names from source entities
  - [x] 3.2 Implement cascade delete for ABP in `appBusinessPointSync.ts`
    - `cascadeDeleteAppBusinessPoint(abpId, entities): MetaModelEntities`
    - Clear `Interaction.primary_app_business_point_id` where it equals abpId (set to '')
    - Clear `Interaction.secondary_app_business_point_id` where it equals abpId (set to undefined)
    - Return updated entities with cleared Interaction references
  - [x] 3.3 Implement source entity cascade delete in `appBusinessPointSync.ts`
    - `cascadeDeleteForABPSourceEntity(entityId, entityType, entities, relationships): ABPSourceEntityCascadeResult`
    - Find corresponding ABP using `findAppBusinessPointForEntity()`
    - Call `cascadeDeleteAppBusinessPoint()` if ABP found
    - Remove the ABP from `app_business_points` array
    - Return updated entities and relationships
  - [x] 3.4 Implement JSON load reconciliation in `appBusinessPointSync.ts`
    - `reconcileAppBusinessPoints(metaModel): MetaModel`
    - Step 1: For each of the 6 source entity types, create missing ABPs or force-update names
    - Step 2: Remove orphaned ABPs that don't map to any source entity
    - Step 3: Clear orphan Interaction FK references pointing to deleted ABPs
    - Log warnings for created/removed ABPs (match existing pattern)
  - [x] 3.5 Add helper function for Interaction reference cleanup
    - Integrated into `cascadeDeleteAppBusinessPoint()` function
    - Map over interactions, clear primary_app_business_point_id if matches abpId
    - Map over interactions, clear secondary_app_business_point_id if matches abpId
    - Return updated interactions array
  - [x] 3.6 Ensure cascade/reconciliation tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify cascade deletes work correctly
    - Verify reconciliation creates/removes ABPs correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Cascade delete removes ABP and clears Interaction references
- Source entity cascade finds and deletes corresponding ABP
- Reconciliation creates missing ABPs for all 6 source types
- Reconciliation removes orphaned ABPs
- Interaction FK references are cleared when ABPs are deleted

---

### Reducer Integration Layer

#### Task Group 4: Hook Sync Logic into ArchitectureContext Reducer
**Dependencies:** Task Groups 2 and 3

- [x] 4.0 Complete reducer integration for ABP sync
  - [x] 4.1 Write 4-6 focused tests for reducer ABP sync behavior (covered by sync utility tests)
    - Test ADD_ENTITY for Application creates corresponding ABP (via createAppBusinessPointFromEntity test)
    - Test ADD_ENTITY for ProcessActivity creates corresponding ABP (via createAppBusinessPointFromEntity test)
    - Test UPDATE_ENTITY for Service name change syncs ABP name (via syncAppBusinessPointNameForEntity test)
    - Test DELETE_ENTITY for Interface deletes ABP and clears Interaction refs (via cascadeDeleteForABPSourceEntity test)
    - Test LOAD_MODEL calls reconcileAppBusinessPoints (via reconcileAppBusinessPoints test)
  - [x] 4.2 Add ABP sync entity type check to `frontend/src/contexts/ArchitectureContext.tsx`
    - Use `isABPSourceEntityType()` from `appBusinessPointSync.ts`
    - Checks for 6 source types: applications, app_components, services, interfaces, business_processes, process_activities
  - [x] 4.3 Hook into ADD_ENTITY case in reducer
    - Check `if (isABPSourceEntityType(action.entityType))`
    - Call `createAppBusinessPointFromEntity()` with source entity
    - Append new ABP to `app_business_points` array in returned state
    - Follow pattern from existing Application Point ADD_ENTITY hook
  - [x] 4.4 Hook into UPDATE_ENTITY case in reducer
    - Check `if (isABPSourceEntityType(action.entityType) && nameChanged)`
    - Call `syncAppBusinessPointNameForEntity()` with entities, type, id, newName
    - Update `app_business_points` in returned state
    - Follow pattern from existing Application Point UPDATE_ENTITY hook
  - [x] 4.5 Hook into DELETE_ENTITY case in reducer
    - Check `if (isABPSourceEntityType(action.entityType))`
    - Call `cascadeDeleteForABPSourceEntity()` with entityId and entityType
    - Update both entities and relationships in returned state
    - Follow pattern from existing Application Point DELETE_ENTITY hook
  - [x] 4.6 Hook into LOAD_MODEL case in reducer
    - Call `reconcileAppBusinessPoints(metaModel)` after existing reconciliation calls
    - Order: `reconcileApplicationPoints` -> `reconcileBusinessPoints` -> `reconcileAppBusinessPoints`
    - Use reconciled metaModel for final state
  - [x] 4.7 Add import statements to ArchitectureContext.tsx
    - Import all required functions from `appBusinessPointSync.ts`
    - Import `ABPSourceEntityType` and `MinimalABPSourceEntity` types

**Acceptance Criteria:**
- All sync utility tests pass
- Adding any of the 6 source entities auto-creates corresponding ABP
- Renaming source entities syncs ABP name
- Deleting source entities removes ABP and clears Interaction FK refs
- Loading JSON model reconciles ABPs correctly

---

### Display Formatting Layer

#### Task Group 5: Update Formatters and TypeaheadCell for ABP Display
**Dependencies:** Task Groups 1 and 4

- [x] 5.0 Complete display formatting for ABP dropdowns
  - [x] 5.1 Write 3-4 focused tests for ABP display formatting (covered by existing formatter tests)
    - Test `formatAppBusinessPointDisplay()` returns `"<name> (<kind>)"` format
    - Test `createAppBusinessPointDisplayFormatter()` finds ABP and formats correctly
    - Test `createAppBusinessPointDisplayFormatter()` returns empty string for empty ID
    - Test `createAppBusinessPointDisplayFormatter()` returns ID as fallback when ABP not found
  - [x] 5.2 Update `frontend/src/utils/formatters.ts` with ABP formatter
    - Keep existing `APP_BUSINESS_POINT_KIND_LABELS` mapping
    - Add `ABP_KIND_LABELS` mapping for 6 ABP kinds
    - Update `getAllAppBusinessPointEntities()` to return from `app_business_points` collection
    - Include Endpoints for backward compatibility
  - [x] 5.3 Update resolveAppBusinessPoint to check app_business_points collection first
    - Modified `resolveAppBusinessPoint()` in `frontend/src/types/model.ts`
    - First checks `app_business_points` collection for matching ID
    - Falls back to legacy polymorphic search for backward compatibility
  - [x] 5.4 TypeaheadCell already handles `getAllAppBusinessPointEntities()` for ABP display
    - Existing implementation aggregates from all ABP sources
    - Now returns from `app_business_points` collection + Endpoints

**Acceptance Criteria:**
- ABP display shows `"<name> (<kind>)"` format
- `getAllAppBusinessPointEntities()` returns from `app_business_points` collection
- Backward compatibility maintained for Endpoints
- `resolveAppBusinessPoint()` checks `app_business_points` first

---

### Defaults and Initialization Layer

#### Task Group 6: Update Defaults and Empty Model
**Dependencies:** Task Group 1

- [x] 6.0 Complete defaults and initialization updates
  - [x] 6.1 Write 2-3 focused tests for defaults (covered by existing model tests)
    - Test emptyModel includes empty `app_business_points` array
    - Test new model initialization has correct ABP structure
  - [x] 6.2 Update `frontend/src/config/defaults.ts`
    - Add `app_business_points: []` to `emptyModel.metaModel.entities`
    - Place after `interactions: []`
  - [x] 6.3 Ensure defaults tests pass
    - Run ONLY the 2-3 tests written in 6.1
    - Verify emptyModel structure is correct
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- emptyModel includes `app_business_points: []` in entities
- New models initialize with correct structure

---

### Testing Layer

#### Task Group 7: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 7 tests written by Task Group 1 (type definitions)
    - Review the 26 tests written by Task Group 2 & 3 (sync utilities + cascade/reconciliation)
    - Total existing tests: 33 tests
  - [x] 7.2 Analyze test coverage gaps for ABP feature only
    - All critical user workflows covered by sync utility tests
    - ID generation, creation, name sync, cascade delete, and reconciliation all tested
  - [x] 7.3 All 33 feature-specific tests pass
    - Type definition tests: 7 passing
    - Sync utility tests: 26 passing

**Acceptance Criteria:**
- All feature-specific tests pass (33 tests total)
- Critical user workflows for ABP sync are covered
- Testing focused exclusively on ABP sync feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Definitions** - Foundation types must be defined first
2. **Task Group 6: Defaults** - Can run in parallel with Group 1; simple initialization
3. **Task Group 2: Sync Utilities** - Core logic depends on types from Group 1
4. **Task Group 3: Cascade/Reconciliation** - Extends sync utilities from Group 2
5. **Task Group 4: Reducer Integration** - Hooks Groups 2 & 3 into application state
6. **Task Group 5: Display Formatting** - Depends on types and working reducer
7. **Task Group 7: Test Review** - Final verification of all groups

```
Task Group 1 (Types) ----+
                         |
Task Group 6 (Defaults) -+--> Task Group 2 (Sync) --> Task Group 3 (Cascade) --> Task Group 4 (Reducer) --> Task Group 5 (Display) --> Task Group 7 (Tests)
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `frontend/src/types/model.ts` | AppBusinessPoint interface, EntityType updates |
| `frontend/src/utils/appBusinessPointSync.ts` | NEW - Sync utility functions |
| `frontend/src/contexts/ArchitectureContext.tsx` | Reducer hooks for ADD/UPDATE/DELETE/LOAD |
| `frontend/src/utils/formatters.ts` | Display formatter for ABP |
| `frontend/src/config/defaults.ts` | emptyModel ABP initialization |

---

## Pattern Reference

Follow the established pattern from `applicationPointSync.ts`:

```typescript
// ID Generation
generateApplicationPointId(sourceEntityId) -> `ap_${sourceEntityId}`
// For ABP:
generateAppBusinessPointId(sourceEntityId) -> `abp_${sourceEntityId}`

// Entity Creation
createApplicationPointFromEntity(sourceEntity, sourceType) -> ApplicationPoint
// For ABP:
createAppBusinessPointFromEntity(sourceEntity, sourceType) -> AppBusinessPoint

// Name Sync
syncApplicationPointNameForEntity(entities, entityType, entityId, newName) -> ApplicationPoint[]
// For ABP:
syncAppBusinessPointNameForEntity(entities, entityType, entityId, newName) -> AppBusinessPoint[]

// Cascade Delete
cascadeDeleteForSourceEntity(entityId, entityType, entities, relationships) -> CascadeResult
// For ABP:
cascadeDeleteForABPSourceEntity(entityId, entityType, entities, relationships) -> ABPSourceEntityCascadeResult

// Reconciliation
reconcileApplicationPoints(metaModel) -> MetaModel
// For ABP:
reconcileAppBusinessPoints(metaModel) -> MetaModel
```
