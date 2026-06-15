# Task Breakdown: Meta-Model View - UI Domain Tab

## Overview
Total Tasks: 19 sub-tasks across 4 task groups

This feature adds a new "UI" architecture domain as the 5th domain tab in the Meta-Model view. The UI domain contains 4 entity tables (UI Screens, UI Workflow Transitions, UI Components, UI Actions) and no Relationships section.

## Task List

### Type Definitions Layer

#### Task Group 1: Type Definitions and Domain Configuration
**Dependencies:** None

- [x] 1.0 Complete type definitions and domain configuration
  - [x] 1.1 Extend ArchitectureDomain type and constants in architectureDomain.ts
    - **File:** `frontend/src/types/architectureDomain.ts`
    - Add `'ui'` to `ArchitectureDomain` type union (line 20)
    - Add `'ui'` to `ALL_DOMAINS` array after `'behavioural'` (line 25)
    - Add entry to `DOMAIN_LABELS`: `ui: 'UI'` (lines 31-36)
    - Import `MonitorSmartphone` from lucide-react (line 14)
    - Add entry to `DOMAIN_ICONS`: `ui: MonitorSmartphone` (lines 42-47)
    - Update `isArchitectureDomain` type guard (line 54-56) - inherently works via ALL_DOMAINS
    - **Pattern to follow:** Existing domain entries (business, application, data, behavioural)
  - [x] 1.2 Add UIComponent interface to model.ts
    - **File:** `frontend/src/types/model.ts`
    - Add after UIWorkflowTransition interface (around line 638)
    - Fields: `id: string`, `name: string`, `component_type?: string`, `description?: string`
    - **Pattern to follow:** UIScreen interface structure
  - [x] 1.3 Add UIAction interface to model.ts
    - **File:** `frontend/src/types/model.ts`
    - Add after UIComponent interface
    - Fields: `id: string`, `name: string`, `trigger_type: string`, `owner_type: string`, `owner_id: string`, `effect_type: string`
    - **Pattern to follow:** UIWorkflowTransition interface structure
  - [x] 1.4 Add ui_components and ui_actions to MetaModelEntities interface
    - **File:** `frontend/src/types/model.ts`
    - Add to MetaModelEntities interface (around line 1737): `ui_components: UIComponent[]`, `ui_actions: UIAction[]`
    - **Pattern to follow:** ui_screens entry in MetaModelEntities
  - [x] 1.5 Add ui_components and ui_actions to EntityType union
    - **File:** `frontend/src/types/model.ts`
    - Add to EntityType union (around line 1790): `| 'ui_components'`, `| 'ui_actions'`
    - **Pattern to follow:** ui_screens entry in EntityType union
  - [x] 1.6 Add UIComponent and UIAction to AnyEntity union
    - **File:** `frontend/src/types/model.ts`
    - Add to AnyEntity union (around line 1829): `| UIComponent`, `| UIAction`
    - **Pattern to follow:** UIScreen entry in AnyEntity union

**Acceptance Criteria:**
- TypeScript compiles without errors
- ArchitectureDomain type includes 'ui'
- ALL_DOMAINS array contains 5 domains in order: business, application, data, behavioural, ui
- UIComponent and UIAction interfaces are properly defined
- MetaModelEntities includes ui_components and ui_actions arrays

---

### Configuration Layer

#### Task Group 2: Grid Configuration and Domain Groupings
**Dependencies:** Task Group 1

- [x] 2.0 Complete grid configuration and domain groupings
  - [x] 2.1 Add UI domain groupings to gridConfigs.ts
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Add to `domainGroupings` (around line 453): `ui: ['UI Screens', 'UI Workflow Transitions', 'UI Components', 'UI Actions']`
    - Add to `DOMAIN_ENTITY_TYPES` (around line 470): `ui: ['ui_screens', 'ui_workflow_transitions', 'ui_components', 'ui_actions']`
    - **Pattern to follow:** behavioural domain entries
  - [x] 2.2 Add tab name to entity type mappings in gridConfigs.ts
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Add to `tabToEntityType` (around line 407): `'UI Screens': 'ui_screens'`, `'UI Workflow Transitions': 'ui_workflow_transitions'`, `'UI Components': 'ui_components'`, `'UI Actions': 'ui_actions'`
    - Add to `entityTabNames` (around line 446): `'UI Screens'`, `'UI Workflow Transitions'`, `'UI Components'`, `'UI Actions'`
    - **Pattern to follow:** Behavioural domain tab mappings
  - [x] 2.3 Add ui_screens grid config to gridConfigs
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Add config for `ui_screens` in `gridConfigs` Record (around line 373)
    - Columns: ID (auto-generate, width 120), Name (required, width 200), Route (required, width 200), Description (optional, width 250)
    - **Pattern to follow:** applications grid config structure
  - [x] 2.4 Add ui_workflow_transitions grid config to gridConfigs
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Add config for `ui_workflow_transitions`
    - Columns: ID (auto-generate, width 100), Name (width 150), Source Screen (fk_typeahead to ui_screens, width 180), Target Screen (fk_typeahead to ui_screens, width 180), Trigger (optional, width 150), Guard (optional, width 150)
    - **Pattern to follow:** state_transitions grid config structure
  - [x] 2.5 Add ui_components grid config to gridConfigs
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Add config for `ui_components`
    - Columns: ID (auto-generate, width 120), Name (required, width 200), Component Type (dropdown, width 150), Description (optional, width 250)
    - Create `uiComponentTypeOptions` array in defaults.ts: `['Button', 'Form', 'Modal', 'Table', 'Card', 'Navigation', 'Input', 'Other']`
    - **Pattern to follow:** classes grid config structure
  - [x] 2.6 Add ui_actions grid config to gridConfigs
    - **File:** `frontend/src/config/gridConfigs.ts`
    - Add config for `ui_actions`
    - Columns: ID (auto-generate, width 100), Name (required, width 180), Trigger Type (dropdown, width 130), Owner Type (dropdown, width 130), Owner ID (text, width 180), Effect Type (dropdown, width 130)
    - Create option arrays in defaults.ts:
      - `uiActionTriggerTypeOptions`: `['Click', 'Submit', 'Change', 'Focus', 'Blur', 'Load', 'Unload', 'Other']`
      - `uiActionOwnerTypeOptions`: `['Screen', 'Component', 'Other']`
      - `uiActionEffectTypeOptions`: `['Navigate', 'Submit', 'Validate', 'Update', 'Delete', 'Open', 'Close', 'Other']`
    - **Pattern to follow:** state_transitions grid config structure

**Acceptance Criteria:**
- domainGroupings contains ui domain with 4 entity tabs
- DOMAIN_ENTITY_TYPES contains ui domain with 4 entity type keys
- All 4 UI entity types have grid configurations
- Tab name to entity type mappings work correctly
- TypeScript compiles without type errors

---

### Data Layer

#### Task Group 3: Data Initialization and Model Defaults
**Dependencies:** Task Group 1

- [x] 3.0 Complete data initialization
  - [x] 3.1 Add UI entity arrays to emptyModel in defaults.ts
    - **File:** `frontend/src/config/defaults.ts`
    - Add to `emptyModel.metaModel.entities` (around line 1083): `ui_components: []`, `ui_actions: []`
    - **Pattern to follow:** ui_screens entry in emptyModel
  - [x] 3.2 Add entity colors for UIComponent and UIAction in defaults.ts
    - **File:** `frontend/src/config/defaults.ts`
    - Add to `entityColors` (around line 415): `UI_COMPONENT: { background: '#E8EAF6', border: '#5C6BC0' }`, `UI_ACTION: { background: '#E3F2FD', border: '#1976D2' }`
    - **Pattern to follow:** UI_SCREEN and UI_WORKFLOW_TRANSITION colors

**Acceptance Criteria:**
- emptyModel includes ui_components and ui_actions as empty arrays
- Entity colors defined for new entity types
- Model loads without null/undefined crashes

---

### UI Layer

#### Task Group 4: Meta-Model View Component Updates and Testing
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete UI updates and testing
  - [x] 4.1 Hide Relationships row when UI domain is selected in MetaModelView.tsx
    - **File:** `frontend/src/components/MetaModelView/MetaModelView.tsx`
    - Wrap Relationships header row (lines 144-149) in conditional: `{state.selectedDomain !== 'ui' && ( ... )}`
    - Only render Relationships row when domain is not 'ui'
    - **Pattern to follow:** Existing conditional rendering patterns in React components
  - [x] 4.2 Write focused unit tests for UI domain
    - **File:** `frontend/src/__tests__/meta-model-ui-domain.test.tsx` (new file)
    - Test 1: UI tab appears after Behavioural in ALL_DOMAINS order
    - Test 2: Selecting UI domain shows exactly 4 entity tabs (UI Screens, UI Workflow Transitions, UI Components, UI Actions)
    - Test 3: Relationships row is not rendered when UI domain is selected
    - Test 4: Tables render correctly with mock UI entity data
    - Test 5: DomainSelector shows UI domain button with MonitorSmartphone icon
    - Maximum 5-6 focused tests
    - **Pattern to follow:** Existing test files in `frontend/src/__tests__/` directory
  - [x] 4.3 Verify TypeScript compilation and type safety
    - Run `npm run build` or `tsc --noEmit` to verify no type errors
    - Check all imports are properly resolved
    - Verify no circular dependencies introduced
  - [x] 4.4 Run feature-specific tests
    - Run ONLY the new tests from 4.2
    - Verify all 5-6 tests pass
    - Do NOT run the entire application test suite at this stage

**Acceptance Criteria:**
- UI domain tab renders with MonitorSmartphone icon after Behavioural
- When UI domain is selected, Entities row shows exactly 4 tabs: UI Screens | UI Workflow Transitions | UI Components | UI Actions
- Relationships row is hidden when UI domain is selected
- All 5-6 feature-specific tests pass
- TypeScript compiles without errors

---

## File Change Summary

| File Path | Change Type | Description |
|-----------|-------------|-------------|
| `frontend/src/types/architectureDomain.ts` | Modify | Add 'ui' to type union, ALL_DOMAINS, DOMAIN_LABELS, DOMAIN_ICONS |
| `frontend/src/types/model.ts` | Modify | Add UIComponent, UIAction interfaces; update MetaModelEntities, EntityType, AnyEntity |
| `frontend/src/config/gridConfigs.ts` | Modify | Add domainGroupings, DOMAIN_ENTITY_TYPES, tabToEntityType, entityTabNames, grid configs |
| `frontend/src/config/defaults.ts` | Modify | Add emptyModel entries, entity colors, dropdown option arrays |
| `frontend/src/components/MetaModelView/MetaModelView.tsx` | Modify | Conditionally hide Relationships row for UI domain |
| `frontend/src/__tests__/meta-model-ui-domain.test.tsx` | Create | New test file with 5-6 focused tests |

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Definitions** - Define TypeScript interfaces and types first
2. **Task Group 2: Grid Configuration** - Configure grid columns and domain groupings
3. **Task Group 3: Data Initialization** - Set up default model with empty arrays
4. **Task Group 4: UI Updates and Testing** - Update component and write tests

This order ensures type safety through the entire implementation, with each layer building on the previous one.

---

## Implementation Notes

### Key Patterns to Follow

1. **Type Definition Pattern** (architectureDomain.ts):
   ```typescript
   // Existing pattern
   export type ArchitectureDomain = 'business' | 'application' | 'data' | 'behavioural';
   // Add: | 'ui'
   ```

2. **Domain Groupings Pattern** (gridConfigs.ts):
   ```typescript
   // Existing pattern
   behavioural: ['Events', 'States', 'State Transitions', ...],
   // Add:
   ui: ['UI Screens', 'UI Workflow Transitions', 'UI Components', 'UI Actions'],
   ```

3. **Grid Config Pattern** (gridConfigs.ts):
   ```typescript
   // Existing pattern for ui_screens
   ui_screens: [
     { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
     { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
     // ...
   ],
   ```

4. **Conditional Rendering Pattern** (MetaModelView.tsx):
   ```tsx
   {state.selectedDomain !== 'ui' && (
     <div className={styles.headerRow}>
       <span className={styles.headerLabel}>Relationships:</span>
       ...
     </div>
   )}
   ```

### Out of Scope (Do NOT implement)
- No changes to Diagram View RHS palette/editor
- No new "UI Contract" entity
- No backend changes
- No relationship tabs for UI domain
- No validation of owner_id against owner_type for UIAction
