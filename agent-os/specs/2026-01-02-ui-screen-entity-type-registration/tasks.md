# Task Breakdown: Fix UI_SCREEN Entity Type Registration

## Overview
Total Tasks: 9
Scope: Frontend-only bugfix - single registry entry addition

This is a minimal bugfix to register UI_SCREEN as a known entity type so that UI_WORKFLOW diagrams containing UIScreen nodes load and validate successfully.

## Task List

### Registry Update

#### Task Group 1: Add UI_SCREEN to Entity Type Registry
**Dependencies:** None

- [x] 1.0 Complete registry update
  - [x] 1.1 Add UI_SCREEN entry to DIAGRAM_NODE_ENTITY_TYPE_MAP
    - Location: `frontend/src/utils/entityTypeRegistry.ts` line ~107
    - Add new section comment: `// UI Architecture Domain (1 type)`
    - Add entry: `UI_SCREEN: 'ui_screens'`
    - Follow existing pattern (e.g., ACTIVITY_FLOW at line 106)
  - [x] 1.2 Verify prerequisite types exist (read-only verification)
    - Confirm `ENTITY_TYPES.UI_SCREEN = 'UI_SCREEN'` exists in `frontend/src/types/model.ts` (line 991)
    - Confirm `ui_screens: UIScreen[]` exists in MetaModelEntities interface (line 1736)
    - Confirm `'ui_screens': 'UI_SCREEN'` exists in ENTITY_TYPE_DISPLAY_NAMES in `frontend/src/utils/validation.ts` (line 57)
    - No changes needed - verification only

**Acceptance Criteria:**
- UI_SCREEN entry exists in DIAGRAM_NODE_ENTITY_TYPE_MAP
- Entry maps to 'ui_screens' MetaModelEntities key
- New "UI Architecture Domain" section comment added for organization

---

### Test Updates

#### Task Group 2: Update Existing Tests and Create UI_SCREEN Tests
**Dependencies:** Task Group 1

- [x] 2.0 Complete test updates
  - [x] 2.1 Update expected count in behavioural-entity-type-registration.test.ts
    - Location: `frontend/src/__tests__/behavioural-entity-type-registration.test.ts`
    - Update line 74: change expected count from 19 to 22 (actual count including STATE_TRANSITION, ACTIVITY_FLOW, UI_SCREEN)
    - Update line 84 console message: change "19" to "22"
    - Add 'UI_SCREEN' to expectedEntityTypes array (line ~70, after ACTIVITY_PARTITION)
  - [x] 2.2 Create new test file for UI_SCREEN registration
    - Location: `frontend/src/__tests__/ui-screen-entity-type-registration.test.ts`
    - Follow pattern from `endpoint-entity-type-registration.test.ts`
    - Write 4-5 focused tests:
      - Test DIAGRAM_NODE_ENTITY_TYPE_MAP contains UI_SCREEN -> 'ui_screens'
      - Test getEntityLabel returns UIScreen.name for UI_SCREEN nodes
      - Test getEntity returns UIScreen entity for UI_SCREEN type
      - Test validateDiagramNodes passes for diagram with UI_SCREEN node (no "unknown entity type" error)
      - Test ENTITY_TYPE_DISPLAY_NAMES includes 'ui_screens' -> 'UI_SCREEN' mapping
  - [x] 2.3 Run UI_SCREEN specific tests
    - Run `frontend/src/__tests__/ui-screen-entity-type-registration.test.ts`
    - Run `frontend/src/__tests__/behavioural-entity-type-registration.test.ts`
    - Verify all tests pass

**Acceptance Criteria:**
- behavioural-entity-type-registration.test.ts expects 22 entity types
- ui-screen-entity-type-registration.test.ts exists with 4-5 focused tests
- All UI_SCREEN registration tests pass

---

### Verification

#### Task Group 3: End-to-End Verification
**Dependencies:** Task Group 2

- [x] 3.0 Complete verification
  - [x] 3.1 Verify validateDiagramNodes recognizes UI_SCREEN
    - Confirm no direct changes needed to `frontend/src/utils/rendering.ts`
    - Adding UI_SCREEN to registry automatically enables validation
    - validateDiagramNodes uses entityTypeMap which references DIAGRAM_NODE_ENTITY_TYPE_MAP
  - [x] 3.2 Verify getEntityLabel resolves UI_SCREEN node labels
    - Confirm no special handling needed in rendering.ts
    - UIScreen entities have a `name` field that will be returned via standard resolution
  - [x] 3.3 Run all feature-specific tests
    - Run: `frontend/src/__tests__/ui-screen-entity-type-registration.test.ts`
    - Run: `frontend/src/__tests__/behavioural-entity-type-registration.test.ts`
    - Expected: All tests pass (approximately 11 tests total)
  - [ ] 3.4 Manual verification (optional)
    - Load a UI_WORKFLOW diagram containing UIScreen nodes
    - Verify no "unknown entity type UI_SCREEN" errors in console
    - Verify UIScreen nodes display their name correctly

**Acceptance Criteria:**
- All feature-specific tests pass
- No "unknown entity type UI_SCREEN" errors when loading UI_WORKFLOW diagrams
- UIScreen nodes display correct labels in diagrams

---

## Execution Order

Recommended implementation sequence:
1. **Task Group 1: Registry Update** - Add UI_SCREEN to DIAGRAM_NODE_ENTITY_TYPE_MAP
2. **Task Group 2: Test Updates** - Update existing test count, create new UI_SCREEN tests
3. **Task Group 3: Verification** - Verify validation and label resolution work

## Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| `frontend/src/utils/entityTypeRegistry.ts` | Modify | Add UI_SCREEN entry to DIAGRAM_NODE_ENTITY_TYPE_MAP |
| `frontend/src/__tests__/behavioural-entity-type-registration.test.ts` | Modify | Update expected count from 19 to 22, add UI_SCREEN to array |
| `frontend/src/__tests__/ui-screen-entity-type-registration.test.ts` | Create | New test file for UI_SCREEN registration tests |

## Files to Verify (Read-Only)

| File | Verification |
|------|--------------|
| `frontend/src/types/model.ts` | ENTITY_TYPES.UI_SCREEN exists (line 991) |
| `frontend/src/types/model.ts` | MetaModelEntities.ui_screens exists (line 1736) |
| `frontend/src/utils/validation.ts` | ENTITY_TYPE_DISPLAY_NAMES includes ui_screens (line 57) |
| `frontend/src/utils/rendering.ts` | Uses DIAGRAM_NODE_ENTITY_TYPE_MAP (no changes needed) |

## Out of Scope

- No backend changes required
- No new UI components or screens
- No changes to UIScreen entity creation flow
- No changes to palette or diagram editing functionality
- No changes to UI_WORKFLOW_TRANSITION handling
- No changes to edge rendering or relationship handling
- No changes to diagram type configuration
- No changes to canvas rendering logic
- No migration scripts or database changes
- No changes to API contracts or DTOs
