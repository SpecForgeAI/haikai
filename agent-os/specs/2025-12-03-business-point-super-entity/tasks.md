# Implementation Tasks: Business Point Super-Entity

## Phase 1: Type Definitions and Core Infrastructure

### Task 1.1: Add BusinessPoint type definitions
**File:** `frontend/src/types/model.ts`
**Status:** Complete

Add the following type definitions:
- [x] Add `BusinessPointKind` type: `'BUSINESS_PROCESS' | 'PROCESS_ACTIVITY'`
- [x] Add `BusinessPoint` interface with all fields (id, name, description, kind, business_process_id, process_activity_id, tags, valid_from, valid_to)
- [x] Add `BusinessUserBusinessPoint` interface (replacing BusinessUserProcess)
- [x] Add `ApplicationPointBusinessPoint` interface (replacing ApplicationPointBusinessProcess)
- [x] Add `BUSINESS_POINT` to `ENTITY_TYPES` constant
- [x] Add `USER_BUSINESS_POINT` and `APP_POINT_BUSINESS_POINT` to `RELATIONSHIP_EDGE_TYPES`
- [x] Update `MetaModelEntities` interface to include `business_points: BusinessPoint[]`
- [x] Update `MetaModelRelationships` interface to include new relationship arrays

### Task 1.2: Create businessPointSync.ts utility
**File:** `frontend/src/utils/businessPointSync.ts` (NEW)
**Status:** Complete

Create synchronization utilities mirroring applicationPointSync.ts:
- [x] `generateBusinessPointId(sourceEntityId: string): string` - returns `bp_{sourceEntityId}`
- [x] `createBusinessPointFromEntity(sourceEntity, sourceType): BusinessPoint`
- [x] `syncBusinessPointNames(businessPoints, businessProcesses, processActivities): BusinessPoint[]`
- [x] `syncBusinessPointNameForEntity(entities, entityType, entityId, newName): BusinessPoint[]`
- [x] `reconcileBusinessPoints(metaModel): MetaModel`
- [x] `getOrphanedBusinessPoints(businessPoints, businessProcesses, processActivities): BusinessPoint[]`
- [x] `cascadeDeleteBusinessPoint(businessPointId, relationships): MetaModelRelationships`

### Task 1.3: Add display formatters
**File:** `frontend/src/utils/formatters.ts`
**Status:** Complete

- [x] Add `BUSINESS_POINT_KIND_LABELS` constant mapping kind to display label
- [x] Add `formatBusinessPointDisplay(businessPoint: BusinessPoint): string` function
- [x] Add `businessPointDisplayFormatter` for grid configuration use

---

## Phase 2: Configuration Updates

### Task 2.1: Update grid configurations
**File:** `frontend/src/config/gridConfigs.ts`
**Status:** Complete

- [x] Add `business_points` grid configuration (for internal use, not displayed)
- [x] Add `business_user_business_points` relationship grid configuration with businessPointDisplayFormatter
- [x] Add `application_point_business_points` relationship grid configuration with both formatters
- [x] Update tab name mappings for new relationship types
- [x] Remove or deprecate old `business_user_processes` and `application_point_business_processes` configs

### Task 2.2: Update color defaults
**File:** `frontend/src/config/defaults.ts`
**Status:** Complete

- [x] Add `businessPointColors` object (fill: '#E8D5B7', stroke: '#8B7355', text: '#4A3728')
- [x] Add relationship color mappings for `business_user_business_points`
- [x] Add relationship color mappings for `application_point_business_points`
- [x] Update any color lookups that reference the old relationship types

### Task 2.3: Update palette data
**File:** `frontend/src/utils/paletteData.ts`
**Status:** Complete

- [x] Add `business_points` to palette data structure (hidden from user-facing palette)
- [x] Ensure Business Points don't appear in entity selection UI
- [x] Update any palette section filtering logic

---

## Phase 3: Relationship Utilities

### Task 3.1: Update relationship utilities
**File:** `frontend/src/utils/relationshipUtils.ts`
**Status:** Complete

- [x] Add `processActivitiesOnDiagram: Set<string>` to `EntitiesOnDiagram` interface
- [x] Add `businessPointsOnDiagram: Set<string>` to `EntitiesOnDiagram` interface
- [x] Update `buildEntitiesOnDiagram()` to populate new sets (including BP abstraction mapping)
- [x] Add `isUserBusinessPointEnabledWithSets()` function
- [x] Add `isAppPointBusinessPointEnabledWithSets()` function
- [x] Update `getRelationshipEligibility()` switch statement for new relationship types
- [x] Remove or deprecate old User↔Process and AppPoint↔Process eligibility functions

### Task 3.2: Update advanced add relationships
**File:** `frontend/src/utils/advancedAddRelationships.ts`
**Status:** Complete

- [x] Add `ENTITY_TYPES.BUSINESS_POINT` entry to `EXPANDABLE_RELATIONSHIPS`
- [x] Update `ENTITY_TYPES.BUSINESS_USER` to reference Business Point instead of Business Process
- [x] Update any Application-related entries that expand to processes
- [x] Ensure bidirectional expansion works correctly

### Task 3.3: Update validation utilities
**File:** `frontend/src/utils/validation.ts`
**Status:** Complete

- [x] Add FK validation rules for `business_user_business_points.business_point_id`
- [x] Add FK validation rules for `application_point_business_points.business_point_id`
- [x] Update any validation that referenced old relationship types

---

## Phase 4: File Operations and Migration

### Task 4.1: Update file operations
**File:** `frontend/src/utils/fileOperations.ts`
**Status:** Complete

- [x] Import businessPointSync utilities
- [x] Add `migrateToBusinessPoints()` function for old format migration
- [x] Update `loadMetaModel()` to call Business Point reconciliation
- [x] Update `loadMetaModel()` to detect and migrate old relationship format
- [x] Update `saveMetaModel()` to include business_points in output
- [x] Add empty array defaults for new entity and relationship types

### Task 4.2: Update entity lifecycle in reducer/state management
**File:** `frontend/src/contexts/ArchitectureContext.tsx`
**Status:** Complete

- [x] On Business Process creation: trigger Business Point creation
- [x] On Process Activity creation: trigger Business Point creation
- [x] On Business Process rename: trigger Business Point name sync
- [x] On Process Activity rename: trigger Business Point name sync
- [x] On Business Process deletion: trigger Business Point deletion and cascade
- [x] On Process Activity deletion: trigger Business Point deletion and cascade

---

## Phase 5: Rendering Updates

### Task 5.1: Update rendering utilities
**File:** `frontend/src/utils/rendering.ts`
**Status:** Complete

- [x] Add Business Point node rendering logic
- [x] Add Business Point node styling (colors, shape)
- [x] Add edge rendering for User ↔ Business Point (DASHED, no arrow)
- [x] Add edge rendering for App Point ↔ Business Point (SOLID, no arrow)
- [x] Update any node/edge type switches to include new types

### Task 5.2: Update Canvas component
**File:** `frontend/src/components/DiagramsView/Canvas.tsx`
**Status:** Complete

- [x] Update entity presence detection to include Business Points
- [x] Update relationship rendering to use new relationship types
- [x] Ensure Business Point nodes render correctly for relationships
- [x] Update any interaction handlers for new entity/relationship types

---

## Phase 6: UI Component Updates

### Task 6.1: Update MetaModelPanel (if exists)
**File:** `frontend/src/components/DiagramsView/MetaModelPanel.tsx` (or similar)
**Status:** Complete

- [x] Ensure business_points section is hidden from entity tabs
- [x] Update relationship tabs to show new relationship names
- [x] Remove old relationship tab entries

### Task 6.2: Update relationship editors/forms
**Status:** Complete

- [x] Update User relationship form to use Business Point dropdown
- [x] Update App Point relationship form to use Business Point dropdown
- [x] Ensure dropdown shows formatted Business Point display
- [x] Implement typeahead search on name and type

---

## Phase 7: Testing

### Task 7.1: Create unit tests
**File:** `frontend/src/__tests__/business-point-sync.test.ts` (NEW)
**Status:** Complete

- [x] Test `generateBusinessPointId()` returns correct format
- [x] Test `createBusinessPointFromEntity()` for Business Process
- [x] Test `createBusinessPointFromEntity()` for Process Activity
- [x] Test `syncBusinessPointNames()` updates names correctly
- [x] Test `reconcileBusinessPoints()` creates missing BPs
- [x] Test `reconcileBusinessPoints()` removes orphaned BPs
- [x] Test `cascadeDeleteBusinessPoint()` removes relationships

### Task 7.2: Create migration tests
**File:** `frontend/src/__tests__/business-point-migration.test.ts` (NEW)
**Status:** Complete

- [x] Test migration of `business_user_processes` to `business_user_business_points`
- [x] Test migration of `application_point_business_processes` to `application_point_business_points`
- [x] Test migration preserves all metadata (description, tags, temporal fields)
- [x] Test migration handles empty arrays correctly
- [x] Test migration handles mixed old/new format

### Task 7.3: Create relationship tests
**File:** `frontend/src/__tests__/business-point-relationships.test.ts` (NEW)
**Status:** Complete

- [x] Test User - Business Point eligibility when both on diagram
- [x] Test User - Business Point eligibility when one missing
- [x] Test App Point - Business Point eligibility
- [x] Test relationship edge creation and styling
- [x] Test dropdown formatting

### Task 7.4: Create integration tests
**File:** `frontend/src/__tests__/business-point-integration.test.ts` (NEW)
**Status:** Complete

- [x] Test end-to-end: Create Business Process - Verify Business Point
- [x] Test end-to-end: Create Process Activity - Verify Business Point
- [x] Test end-to-end: Rename Business Process - Verify BP name updated
- [x] Test end-to-end: Delete Business Process - Verify BP deleted
- [x] Test end-to-end: Create relationship - Verify diagram rendering

---

## Phase 8: Cleanup and Documentation

### Task 8.1: Remove deprecated code
**Status:** Complete

- [x] Remove `BusinessUserProcess` type (after migration verified)
- [x] Remove `ApplicationPointBusinessProcess` type (after migration verified)
- [x] Remove old grid configurations
- [x] Remove old eligibility functions
- [x] Clean up any remaining references to old relationship types

### Task 8.2: Update any inline documentation
**Status:** Complete

- [x] Update type comments to reflect new structure
- [x] Update function JSDoc comments
- [x] Add migration notes to fileOperations.ts

---

## Implementation Order

1. **Phase 1** - Core types and sync utilities (foundation)
2. **Phase 2** - Configuration updates (enables grid/UI)
3. **Phase 3** - Relationship utilities (enables eligibility checks)
4. **Phase 4** - File operations and migration (enables persistence)
5. **Phase 5** - Rendering (enables visualization)
6. **Phase 6** - UI components (enables user interaction)
7. **Phase 7** - Testing (validates implementation)
8. **Phase 8** - Cleanup (removes deprecated code)

---

## Dependencies

- Task 1.1 must complete before all other tasks
- Task 1.2 must complete before Tasks 4.1, 4.2
- Task 1.3 must complete before Task 2.1
- Task 2.1 must complete before Task 6.2
- Tasks 3.1, 3.2, 3.3 can proceed in parallel after Task 1.1
- Task 4.1 must complete before Task 4.2
- Tasks 5.1, 5.2 can proceed after Tasks 1.1, 2.2
- Phase 7 testing can begin after Phase 5
- Phase 8 cleanup only after all tests pass
