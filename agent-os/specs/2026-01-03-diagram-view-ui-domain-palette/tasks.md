# Task Breakdown: Diagram View RHS - UI Domain Palette

## Overview
Total Tasks: 26 (across 4 task groups)

This specification adds a "UI" domain to the Diagram View RHS palette with 4 collapsible sections for UI meta-model entity types (Screens, Workflow Transitions, Components, Actions). Users can add UI entities to diagrams as simple box nodes and remove them (diagram-only, not meta-model).

## Task List

### Entity Type Registry Layer

#### Task Group 1: Entity Type Registration
**Dependencies:** None
**Specialist:** Backend/Core Engineer

- [x] 1.0 Complete UI entity type registration in entityTypeRegistry.ts
  - [x] 1.1 Write 4 focused tests for UI entity type registry
    - Test UI_SCREEN mapping exists (may already pass)
    - Test UI_WORKFLOW_TRANSITION maps to 'ui_workflow_transitions'
    - Test UI_COMPONENT maps to 'ui_components'
    - Test UI_ACTION maps to 'ui_actions'
  - [x] 1.2 Add UI_WORKFLOW_TRANSITION to DIAGRAM_NODE_ENTITY_TYPE_MAP
    - Key: 'UI_WORKFLOW_TRANSITION'
    - Value: 'ui_workflow_transitions'
    - Add comment: "UI_WORKFLOW_TRANSITION -> ui_workflow_transitions: UIWorkflowTransition entity"
  - [x] 1.3 Add UI_COMPONENT to DIAGRAM_NODE_ENTITY_TYPE_MAP
    - Key: 'UI_COMPONENT'
    - Value: 'ui_components'
    - Add comment: "UI_COMPONENT -> ui_components: UIComponent entity"
  - [x] 1.4 Add UI_ACTION to DIAGRAM_NODE_ENTITY_TYPE_MAP
    - Key: 'UI_ACTION'
    - Value: 'ui_actions'
    - Add comment: "UI_ACTION -> ui_actions: UIAction entity"
  - [x] 1.5 Add entity types to ENTITY_TYPES constant in model.ts (if not present)
    - Verify/add: UI_SCREEN, UI_WORKFLOW_TRANSITION, UI_COMPONENT, UI_ACTION
  - [x] 1.6 Ensure entity type tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify getKnownEntityTypes() includes all 4 UI types

**Acceptance Criteria:**
- All 4 UI entity types are registered in DIAGRAM_NODE_ENTITY_TYPE_MAP
- getKnownEntityTypes() returns UI_SCREEN, UI_WORKFLOW_TRANSITION, UI_COMPONENT, UI_ACTION
- Diagrams with UI nodes validate without "unknown entity type" errors

---

### Utility Layer

#### Task Group 2: UI Domain Palette Utilities
**Dependencies:** Task Group 1
**Specialist:** Frontend Core Engineer

- [x] 2.0 Complete UI domain palette utility functions
  - [x] 2.1 Write 6 focused tests for UI domain palette utilities
    - Test isEntityOnDiagram returns true when UI_SCREEN node exists
    - Test isEntityOnDiagram returns false when node does not exist
    - Test isEntityOnDiagram works for UI_WORKFLOW_TRANSITION
    - Test isEntityOnDiagram works for UI_COMPONENT
    - Test isEntityOnDiagram works for UI_ACTION
    - Test formatUIEntityLabel formats each entity type correctly
  - [x] 2.2 Create uiDomainPaletteUtils.ts file
    - File location: `frontend/src/utils/uiDomainPaletteUtils.ts`
    - Add file header comment explaining purpose
  - [x] 2.3 Implement isEntityOnDiagram helper function
    - Signature: `isEntityOnDiagram(entityType: string, entityId: string, diagramNodes: DiagramNode[]): boolean`
    - Check diagram_nodes for nodes where `node.entity_type === entityType AND node.entity_id === entityId`
    - Follow pattern from uiWorkflowDiagramPaletteUtils.ts uiScreenOnDiagram()
  - [x] 2.4 Implement formatUIScreenLabel helper function
    - Signature: `formatUIScreenLabel(screen: UIScreen): string`
    - Return `name (route)` if route is present, else just `name`
  - [x] 2.5 Implement formatUIWorkflowTransitionLabel helper function
    - Signature: `formatUIWorkflowTransitionLabel(transition: UIWorkflowTransition, screens: UIScreen[]): string`
    - Return `name` + ` (source -> target)` if source/target screen names can be resolved
    - Use screens array to look up source_screen_id and target_screen_id names
  - [x] 2.6 Implement formatUIComponentLabel helper function
    - Signature: `formatUIComponentLabel(component: UIComponent): string`
    - Return `name [type]` if component_type is present, else just `name`
  - [x] 2.7 Implement formatUIActionLabel helper function
    - Signature: `formatUIActionLabel(action: UIAction): string`
    - Return `name [trigger_type/effect_type]` if present, else just `name`
  - [x] 2.8 Ensure utility tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify all formatting edge cases handled (null-safe)

**Acceptance Criteria:**
- isEntityOnDiagram correctly detects presence for all 4 UI entity types
- Label formatters handle missing optional fields gracefully (null-safe)
- All 6 utility tests pass

---

### UI Components Layer

#### Task Group 3: UI Domain Palette Content in PalettePanel
**Dependencies:** Task Groups 1, 2
**Specialist:** Frontend UI Engineer

- [x] 3.0 Complete UI domain palette implementation in PalettePanel.tsx
  - [x] 3.1 Write 8 focused tests for UI domain palette behavior
    - Test UI domain selector shows MonitorSmartphone icon after Behavioural
    - Test selecting UI domain displays 4 collapsible sections
    - Test UI Screens section lists entities from model.metaModel.entities.ui_screens
    - Test UI Workflow Transitions section lists entities correctly
    - Test row is greyed when entity is already on diagram
    - Test left-click on non-greyed row adds entity as box node
    - Test context menu Delete removes node from diagram (meta-model unchanged)
    - Test disabled state message shown for Sequence/UI_SCREEN diagram types
  - [x] 3.2 Verify PaletteDomainSelector includes UI domain
    - Check architectureDomain.ts ALL_DOMAINS includes 'ui' after 'behavioural'
    - Verify DOMAIN_ICONS['ui'] = MonitorSmartphone
    - Confirm no code changes needed if already working
  - [x] 3.3 Add UI domain section rendering in PalettePanel.tsx
    - Add condition: `selectedDomain === 'ui'`
    - Render in domain-specific section (after behavioural domain handling)
  - [x] 3.4 Implement UI Screens collapsible section
    - Data source: `model.metaModel.entities.ui_screens ?? []`
    - Section ID: 'ui_screens'
    - Section label: 'UI Screens'
    - Use formatUIScreenLabel for row display
    - Use isEntityOnDiagram for grey-out detection
  - [x] 3.5 Implement UI Workflow Transitions collapsible section
    - Data source: `model.metaModel.relationships.ui_workflow_transitions ?? []`
    - Section ID: 'ui_workflow_transitions'
    - Section label: 'UI Workflow Transitions'
    - Use formatUIWorkflowTransitionLabel for row display
    - Note: Rendered as nodes (not edges) in this increment
  - [x] 3.6 Implement UI Components collapsible section
    - Data source: `model.metaModel.entities.ui_components ?? []`
    - Section ID: 'ui_components'
    - Section label: 'UI Components'
    - Use formatUIComponentLabel for row display
  - [x] 3.7 Implement UI Actions collapsible section
    - Data source: `model.metaModel.entities.ui_actions ?? []`
    - Section ID: 'ui_actions'
    - Section label: 'UI Actions'
    - Use formatUIActionLabel for row display
  - [x] 3.8 Add getUIEntityInfo helper function in PaletteSection.tsx
    - Handle section IDs: 'ui_screens', 'ui_workflow_transitions', 'ui_components', 'ui_actions'
    - Return RelationshipInfo with enabled/disabledReason/action based on isEntityOnDiagram
    - Follow pattern from getStateEntityInfo/getUIScreenEntityInfo
  - [x] 3.9 Update getItemInfo router in PaletteSection.tsx
    - Add cases for 'ui_components', 'ui_actions', 'ui_workflow_transitions'
    - Route to getUIEntityInfo helper
    - Note: 'ui_screens' case may already exist - verify and extend if needed
  - [x] 3.10 Implement add behavior for UI entities
    - Left-click on non-greyed row adds entity to diagram
    - Create DiagramNode using createDiagramNodeFromEntity()
    - Entity types: UI_SCREEN, UI_WORKFLOW_TRANSITION, UI_COMPONENT, UI_ACTION
    - Spawn position: DEFAULT_NODE_SPAWN_ORIGIN (100, 100)
    - Use ADD_DIAGRAM_NODE dispatch action
  - [x] 3.11 Implement context menu Add option
    - Right-click on non-greyed row shows "Add" option
    - Selecting Add performs same action as left-click
    - Follow existing PaletteContextMenu patterns
  - [x] 3.12 Implement context menu Delete option
    - Right-click on greyed row shows "Delete" option
    - Delete removes diagram nodes matching (entity_type, entity_id)
    - Use DELETE_DIAGRAM_ELEMENTS dispatch action
    - Meta-model entities remain unchanged
    - After delete, row becomes non-greyed
  - [x] 3.13 Implement diagram type availability rules
    - Check diagram type using getDiagramType()
    - If diagram type is 'Sequence' or 'UI_SCREEN':
      - Show disabled state message: "UI palette is not available for this diagram type."
      - No-op on add attempts (left-click and context menu)
    - Works normally on: General, ER, Activity, State, UI_Workflow
  - [x] 3.14 Ensure UI component tests pass
    - Run ONLY the 8 tests written in 3.1
    - Verify all acceptance criteria met

**Acceptance Criteria:**
- UI domain selector icon (MonitorSmartphone) appears after Behavioural
- Selecting UI shows 4 collapsible sections with correct entity lists
- Rows are greyed when entity is already on diagram
- Left-click/Add adds entity as box node at spawn position (100, 100)
- Delete removes node from diagram only (meta-model unchanged)
- Disabled state shown for Sequence and UI_SCREEN diagram types

---

### Testing & Validation Layer

#### Task Group 4: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-3
**Specialist:** QA Engineer

- [x] 4.0 Review existing tests and fill critical gaps
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review 4 tests from Task Group 1 (entity type registry)
    - Review 6 tests from Task Group 2 (utility functions)
    - Review 8 tests from Task Group 3 (UI components)
    - Total existing tests: 18 tests
  - [x] 4.2 Analyze test coverage gaps for UI domain palette feature
    - Identify critical user workflows lacking test coverage
    - Focus ONLY on gaps related to this spec's requirements
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 4.3 Write up to 8 additional strategic tests maximum
    - Test: UI entity nodes validate and load without errors on diagram refresh
    - Test: UI entity nodes persist correctly through save/load cycle
    - Test: Adding multiple UI entities of different types to same diagram
    - Test: Delete UI entity node then re-add same entity works correctly
    - Test: UI sections show "No items" when meta-model has no UI entities
    - Test: Context menu shows correct option based on on-diagram state
    - Test: UI domain palette works on General diagram type
    - Test: UI domain palette works on Activity diagram type
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 26 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All 26 feature-specific tests pass
- Critical user workflows for UI domain palette are covered
- No more than 8 additional tests added when filling in gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Entity Type Registry** (Foundation)
   - Must be completed first as all other groups depend on registered entity types
   - Enables validation and entity lookup for UI types

2. **Task Group 2: Utility Functions** (Core Logic)
   - Depends on Task Group 1 for entity type constants
   - Provides helpers used by UI components

3. **Task Group 3: UI Components** (User Interface)
   - Depends on Task Groups 1 and 2
   - Implements all user-facing functionality

4. **Task Group 4: Test Review & Gap Analysis** (Quality Assurance)
   - Depends on all previous groups being complete
   - Validates end-to-end functionality

---

## Files to Modify/Create

### Files to Modify:
- `frontend/src/utils/entityTypeRegistry.ts` - Add UI entity type mappings
- `frontend/src/types/model.ts` - Add ENTITY_TYPES constants (if needed)
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - Add UI domain sections
- `frontend/src/components/DiagramsView/PaletteSection.tsx` - Add UI entity info handlers

### Files to Create:
- `frontend/src/utils/uiDomainPaletteUtils.ts` - UI domain palette helper functions
- `frontend/src/__tests__/ui-domain-entity-registry.test.ts` - Entity registry tests
- `frontend/src/__tests__/ui-domain-palette-utils.test.ts` - Utility function tests
- `frontend/src/__tests__/ui-domain-palette-sections.test.ts` - UI component tests
- `frontend/src/__tests__/ui-domain-palette-integration.test.ts` - Integration tests

### Files to Reference (Read-Only Patterns):
- `frontend/src/types/architectureDomain.ts` - UI domain already defined
- `frontend/src/utils/uiWorkflowDiagramPaletteUtils.ts` - On-diagram detection patterns
- `frontend/src/utils/nodeCreation.ts` - Node creation utilities
- `frontend/src/components/DiagramsView/PaletteDomainSelector.tsx` - Domain selector (no changes needed)

---

## Key Implementation Notes

1. **UI domain already exists** in architectureDomain.ts - no changes needed to domain selector
2. **UI_SCREEN already registered** in entityTypeRegistry.ts - only 3 new types needed
3. **Simple box nodes only** - no edges, no custom rendering, no semantics
4. **Null-safe data access** - always use `?? []` for meta-model entity arrays
5. **No backend changes** - frontend-only implementation
6. **No cascading deletes** - simple behavior per spec
