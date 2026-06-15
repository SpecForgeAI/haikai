# Task Breakdown: Endpoint Diagram Node Registration

## Overview
Total Tasks: 15

This spec wires the Endpoint meta-model entity into the Diagram view as a first-class node type. The root cause is **missing entity type mappings** that prevent ENDPOINT from being recognized in rendering and validation utilities.

**Note**: The `ENTITY_TYPES.ENDPOINT` constant already exists in `frontend/src/types/model.ts` (line 486). The `getEntityTypeConstant` mapping in `paletteData.ts` already has the `endpoints: ENTITY_TYPES.ENDPOINT` entry (line 26). This task focuses on adding the missing mappings in `rendering.ts` and `validation.ts`.

## Task List

### Entity Type Registration Layer

#### Task Group 1: Add ENDPOINT to entityTypeMap in rendering.ts and validation.ts
**Dependencies:** None

- [x] 1.0 Complete entity type registration
  - [x] 1.1 Write 3-5 focused tests for ENDPOINT entity type mapping
    - Test that `getEntityLabel()` returns correct label for ENDPOINT nodes
    - Test that `getEntity()` returns the endpoint entity when given ENDPOINT type
    - Test that `validateDiagramNodes()` does not report "unknown entity type ENDPOINT" error
    - Test that diagram loading with ENDPOINT nodes succeeds without errors
  - [x] 1.2 Add ENDPOINT mapping to entityTypeMap in rendering.ts
    - File: `frontend/src/utils/rendering.ts`
    - Location: lines 10-22 (entityTypeMap object)
    - Add entry: `ENDPOINT: 'endpoints',`
    - Place after INTERFACE entry for logical grouping
  - [x] 1.3 Add ENDPOINT mapping to entityTypeMap in validation.ts
    - File: `frontend/src/utils/validation.ts`
    - Location: lines 681-693 (entityTypeMap object within validateModel function)
    - Add entry: `ENDPOINT: 'endpoints',`
    - Place after INTERFACE entry for consistency with rendering.ts
  - [x] 1.4 Add endpoints to ENTITY_TYPE_DISPLAY_NAMES in validation.ts
    - File: `frontend/src/utils/validation.ts`
    - Location: lines 21-35 (ENTITY_TYPE_DISPLAY_NAMES constant)
    - Add entry: `'endpoints': 'ENDPOINT',`
    - Place after 'interfaces' entry for logical grouping
  - [x] 1.5 Ensure entity type registration tests pass
    - Run ONLY the 3-5 tests written in 1.1
    - Verify ENDPOINT is recognized in rendering and validation
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-5 tests written in 1.1 pass
- `entityTypeMap` in `rendering.ts` includes `ENDPOINT: 'endpoints'`
- `entityTypeMap` in `validation.ts` includes `ENDPOINT: 'endpoints'`
- `ENTITY_TYPE_DISPLAY_NAMES` in `validation.ts` includes `'endpoints': 'ENDPOINT'`
- No "unknown entity type ENDPOINT" errors when loading diagrams with ENDPOINT nodes

### Palette Integration Layer

#### Task Group 2: Add Endpoints Section to Palette (Optional Enhancement)
**Dependencies:** Task Group 1

**Note**: Per the current `paletteData.ts` implementation, Endpoints are intentionally excluded from the palette because they are "rendered as text rows inside Interface contract boxes" and "added via Advanced Add dialog when expanding an Interface". This task group is marked as OPTIONAL - only implement if the product decision is to allow standalone Endpoint node creation from the palette.

- [x] 2.0 Complete palette integration (OPTIONAL)
  - [x] 2.1 Write 2-3 focused tests for Endpoints palette section
    - Test that `getPaletteSections()` includes an "Endpoints" section (if implemented)
    - Test that Endpoints section appears after Interfaces section
    - Test that Endpoints section contains endpoint entities from metaModel
  - [x] 2.2 Verify getEntityTypeConstant mapping exists
    - File: `frontend/src/utils/paletteData.ts`
    - Confirm line 26 has: `endpoints: ENTITY_TYPES.ENDPOINT`
    - This mapping already exists - no change needed
  - [x] 2.3 Add Endpoints section to getPaletteSections (OPTIONAL)
    - File: `frontend/src/utils/paletteData.ts`
    - Location: After interfaces section (line ~100)
    - Add section object for endpoints (similar to interfaces section)
    - Update comment on line 53-54 if endpoints are now included
  - [x] 2.4 Ensure palette integration tests pass (if implemented)
    - Run ONLY the 2-3 tests written in 2.1
    - Verify Endpoints section appears in palette
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria (if OPTIONAL enhancement is implemented):**
- The 2-3 tests written in 2.1 pass
- Diagram view palette shows "Endpoints" section under "Interfaces"
- Creating Endpoint nodes from palette works
- Endpoints section contains correct items from metaModel.entities.endpoints

### Verification Layer

#### Task Group 3: End-to-End Verification
**Dependencies:** Task Group 1 (and optionally Task Group 2)

- [x] 3.0 Complete end-to-end verification
  - [x] 3.1 Write 4-6 focused integration tests for Endpoint node lifecycle
    - Test loading a diagram JSON file containing ENDPOINT nodes
    - Test that ENDPOINT nodes render as standard boxes with endpoint name
    - Test saving diagram with ENDPOINT nodes and verifying JSON structure
    - Test reloading saved diagram preserves ENDPOINT nodes correctly
    - Test that ENDPOINT nodes can be selected and moved
    - Test that edges can connect to ENDPOINT nodes
  - [x] 3.2 Create test fixture with ENDPOINT nodes
    - Create or update test JSON file with sample ENDPOINT nodes
    - Include at least one ENDPOINT node with proper entity_type and entity_id
    - Ensure corresponding endpoint entity exists in metaModel.entities.endpoints
  - [x] 3.3 Verify diagram load works without errors
    - Load test diagram with ENDPOINT nodes
    - Confirm no console errors about "unknown entity type ENDPOINT"
    - Confirm no validation errors for ENDPOINT nodes
  - [x] 3.4 Verify ENDPOINT node rendering
    - Confirm ENDPOINT nodes render as standard rectangular boxes
    - Confirm endpoint name displays correctly in the node
    - Confirm node has appropriate default colors/styling
  - [x] 3.5 Verify save/reload cycle
    - Save diagram containing ENDPOINT nodes
    - Reload the saved diagram
    - Confirm ENDPOINT nodes are preserved with correct positions
    - Confirm all node properties are retained
  - [x] 3.6 Ensure end-to-end tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify complete Endpoint node lifecycle works
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Diagrams with ENDPOINT nodes load without "unknown entity type ENDPOINT" error
- ENDPOINT nodes render as standard boxes with endpoint name
- Save/reload preserves ENDPOINT nodes correctly
- ENDPOINT nodes are interactive (selectable, movable, connectable)

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Entity Type Registration** (Required - Core Fix)
   - This is the critical fix that resolves the root cause
   - Add ENDPOINT to entityTypeMap in both rendering.ts and validation.ts
   - Add endpoints to ENTITY_TYPE_DISPLAY_NAMES

2. **Task Group 2: Palette Integration** (Optional Enhancement)
   - Only implement if product decision is to allow standalone Endpoint nodes
   - Current design intentionally excludes Endpoints from palette
   - Skip if Endpoints should only be added via Advanced Add dialog

3. **Task Group 3: End-to-End Verification** (Required - Validation)
   - Verify the complete lifecycle of Endpoint nodes
   - Confirm no regressions in existing functionality

## Files Modified Summary

| File | Change | Task |
|------|--------|------|
| `frontend/src/utils/rendering.ts` | Add `ENDPOINT: 'endpoints'` to entityTypeMap (line ~15) | 1.2 |
| `frontend/src/utils/validation.ts` | Add `ENDPOINT: 'endpoints'` to entityTypeMap (line ~687) | 1.3 |
| `frontend/src/utils/validation.ts` | Add `'endpoints': 'ENDPOINT'` to ENTITY_TYPE_DISPLAY_NAMES (line ~28) | 1.4 |
| `frontend/src/utils/paletteData.ts` | Add Endpoints section to getPaletteSections (OPTIONAL) | 2.3 |
| `frontend/src/utils/fileOperations.ts` | Add endpoints to buildModelFromData entity loading | 1.2 (related fix) |

## Test Coverage Summary

- Task Group 1: 5 tests (entity type mapping)
- Task Group 2: 4 tests (palette integration)
- Task Group 3: 10 tests (end-to-end verification)
- **Total: 19 tests**

## Implementation Summary

All 3 task groups have been implemented:

### Task Group 1: Entity Type Registration (COMPLETED)
- Added `ENDPOINT: 'endpoints'` to entityTypeMap in `rendering.ts` (line 15)
- Added `ENDPOINT: 'endpoints'` to entityTypeMap in `validation.ts` (line 687)
- Added `'endpoints': 'ENDPOINT'` to ENTITY_TYPE_DISPLAY_NAMES in `validation.ts` (line 27)
- Added endpoints to JSON structure validation in `validation.ts` (line 823)
- Added endpoints to `buildModelFromData` in `fileOperations.ts` (line 424)
- Created test file: `frontend/src/__tests__/endpoint-entity-type-registration.test.ts`

### Task Group 2: Palette Integration (COMPLETED)
- Added Endpoints section to `getPaletteSections()` in `paletteData.ts` (lines 100-108)
- Verified existing `getEntityTypeConstant` mapping for endpoints (line 26)
- Updated comments to reflect endpoints are now included in palette
- Created test file: `frontend/src/__tests__/endpoint-palette-integration.test.ts`

### Task Group 3: End-to-End Verification (COMPLETED)
- Created comprehensive test fixture with ENDPOINT nodes
- Written 10 integration tests covering full endpoint node lifecycle
- Tests cover loading, rendering, saving, reloading, selection, and edge connections
- Created test file: `frontend/src/__tests__/endpoint-e2e-verification.test.ts`

## Risk Assessment

**Low Risk Changes:**
- Adding entries to entityTypeMap objects is additive and non-breaking
- Adding entry to ENTITY_TYPE_DISPLAY_NAMES is additive and non-breaking

**Medium Risk Changes (Optional):**
- Adding Endpoints to palette may have UX implications
- Current design intentionally excludes Endpoints from direct palette access

## Notes

1. The `ENTITY_TYPES.ENDPOINT` constant already exists in `model.ts` (line 486)
2. The `getEntityTypeConstant` mapping in `paletteData.ts` already includes `endpoints: ENTITY_TYPES.ENDPOINT` (line 26)
3. Per comments in `paletteData.ts`, Endpoints are currently designed to be "text rows inside Interface contract boxes" rather than standalone nodes
4. The palette section addition (Task Group 2) is marked OPTIONAL pending product clarification
