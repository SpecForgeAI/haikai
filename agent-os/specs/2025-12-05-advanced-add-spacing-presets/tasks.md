# Task Breakdown: Advanced Add Spacing Presets

## Overview
Total Tasks: 18 sub-tasks across 4 task groups

This feature adds a "Spacing" dropdown to the Advanced Add dialog, allowing users to control layout density via three presets: Spacious, Normal, and Tight. The presets control padding, gap, and minimum height values used by the hierarchical layout algorithm.

**Spacing Preset Values:**

| Preset | paddingX | paddingY | childVerticalGap | minExtraHeight |
|--------|----------|----------|------------------|----------------|
| Spacious | 20 | 20 | 10 | 20 |
| Normal | 10 | 10 | 7 | 10 |
| Tight | 5 | 5 | 4 | 5 |

## Task List

### Type Definitions Layer

#### Task Group 1: Add Spacing Types and Constants
**Dependencies:** None

- [x] 1.0 Complete spacing type definitions
  - [x] 1.1 Write 3-4 focused tests for spacing type definitions
    - Test that `SpacingPreset` type accepts 'spacious', 'normal', 'tight' (type checking)
    - Test that `SpacingConfig` interface has paddingX, paddingY, childVerticalGap, minExtraHeight
    - Test that `SPACING_PRESETS` contains all three presets with correct values:
      - `spacious: { paddingX: 20, paddingY: 20, childVerticalGap: 10, minExtraHeight: 20 }`
      - `normal: { paddingX: 10, paddingY: 10, childVerticalGap: 7, minExtraHeight: 10 }`
      - `tight: { paddingX: 5, paddingY: 5, childVerticalGap: 4, minExtraHeight: 5 }`
    - Test that `DEFAULT_SPACING_PRESET` equals 'normal'
    - **Test file:** `frontend/src/__tests__/spacing-presets-types.test.ts`
  - [x] 1.2 Add `SpacingPreset` type to `frontend/src/types/advancedAdd.ts`
    ```typescript
    export type SpacingPreset = 'spacious' | 'normal' | 'tight';
    ```
  - [x] 1.3 Add `SpacingConfig` interface to `frontend/src/types/advancedAdd.ts`
    ```typescript
    export interface SpacingConfig {
      paddingX: number;
      paddingY: number;
      childVerticalGap: number;
      minExtraHeight: number;
    }
    ```
  - [x] 1.4 Add `SPACING_PRESETS` constant to `frontend/src/types/advancedAdd.ts`
    ```typescript
    export const SPACING_PRESETS: Record<SpacingPreset, SpacingConfig> = {
      spacious: { paddingX: 20, paddingY: 20, childVerticalGap: 10, minExtraHeight: 20 },
      normal: { paddingX: 10, paddingY: 10, childVerticalGap: 7, minExtraHeight: 10 },
      tight: { paddingX: 5, paddingY: 5, childVerticalGap: 4, minExtraHeight: 5 },
    };
    ```
  - [x] 1.5 Add `DEFAULT_SPACING_PRESET` constant
    ```typescript
    export const DEFAULT_SPACING_PRESET: SpacingPreset = 'normal';
    ```
  - [x] 1.6 Ensure Task Group 1 tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify type definitions are correct

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- `SpacingPreset`, `SpacingConfig`, `SPACING_PRESETS`, `DEFAULT_SPACING_PRESET` are exported
- Spacing values match specification exactly

**Files to modify:**
- `frontend/src/types/advancedAdd.ts`
- `frontend/src/__tests__/spacing-presets-types.test.ts` (new file)

---

### Layout Algorithm Layer

#### Task Group 2: Parameterize Layout Functions
**Dependencies:** Task Group 1

- [x] 2.0 Complete layout algorithm parameterization
  - [x] 2.1 Write 5-6 focused tests for parameterized layout functions
    - Test `measure()` with spacious config produces larger dimensions than normal
    - Test `measure()` with tight config produces smaller dimensions than normal
    - Test `assignPositions()` uses correct childVerticalGap from config
    - Test `layoutAdvancedAddSelection()` accepts spacingPreset parameter and defaults to 'normal'
    - Test that nodes don't overlap with any spacing preset (verify no negative gaps)
    - Test backward compatibility: omitting preset produces same result as explicitly passing 'normal'
    - **Test file:** `frontend/src/__tests__/spacing-presets-layout.test.ts`
  - [x] 2.2 Update `measure()` function signature in `compoundLayout.ts`
    - Change from: `function measure(node: LayoutTreeNode): MeasuredNode`
    - To: `function measure(node: LayoutTreeNode, spacingConfig: SpacingConfig): MeasuredNode`
    - Replace `LAYOUT_PADDING_X` with `spacingConfig.paddingX`
    - Replace `LAYOUT_PADDING_Y` with `spacingConfig.paddingY`
    - Replace `LAYOUT_CHILD_VERTICAL_GAP` with `spacingConfig.childVerticalGap`
    - Calculate `minNodeHeight = LAYOUT_MIN_NODE_HEIGHT + spacingConfig.minExtraHeight`
    - Update leaf node sizing: `Math.max(minNodeHeight, labelHeight + 2 * spacingConfig.paddingY)`
  - [x] 2.3 Update `assignPositions()` function signature in `compoundLayout.ts`
    - Change from: `function assignPositions(node: MeasuredNode, originX: number, originY: number): LayoutNode`
    - To: `function assignPositions(node: MeasuredNode, originX: number, originY: number, spacingConfig: SpacingConfig): LayoutNode`
    - Replace `LAYOUT_PADDING_X` with `spacingConfig.paddingX`
    - Replace `LAYOUT_PADDING_Y` with `spacingConfig.paddingY`
    - Replace `LAYOUT_CHILD_VERTICAL_GAP` with `spacingConfig.childVerticalGap`
    - Update child positioning calculations to use config values
  - [x] 2.4 Update `layoutAdvancedAddSelection()` function
    - Change signature to accept optional spacing preset:
      ```typescript
      export function layoutAdvancedAddSelection(
        rootTreeNode: LayoutTreeNode,
        viewportCenter: { x: number; y: number },
        spacingPreset: SpacingPreset = 'normal'
      ): LayoutNode
      ```
    - Look up config: `const spacingConfig = SPACING_PRESETS[spacingPreset];`
    - Pass `spacingConfig` to `measure()` call
    - Pass `spacingConfig` to `assignPositions()` call
  - [x] 2.5 Add necessary imports at top of `compoundLayout.ts`
    - Add: `import { SpacingPreset, SpacingConfig, SPACING_PRESETS } from '../types/advancedAdd';`
  - [x] 2.6 Ensure Task Group 2 tests pass
    - Run ONLY the 5-6 tests written in 2.1
    - Verify layout produces correct sizes for each preset

**Acceptance Criteria:**
- The 5-6 tests written in 2.1 pass
- `measure()` and `assignPositions()` accept SpacingConfig parameter
- `layoutAdvancedAddSelection()` accepts SpacingPreset parameter with 'normal' default
- Default behavior (normal preset) matches current behavior (backward compatible)
- No nodes overlap regardless of spacing preset

**Files to modify:**
- `frontend/src/utils/compoundLayout.ts`
- `frontend/src/__tests__/spacing-presets-layout.test.ts` (new file)

---

### UI Layer

#### Task Group 3: Add Spacing Dropdown to Dialog
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete UI implementation
  - [x] 3.1 Write 4-5 focused tests for spacing dropdown UI
    - Test dropdown renders in dialog footer with label "Spacing"
    - Test dropdown has three options: Spacious, Normal, Tight
    - Test dropdown defaults to "Normal" on initial render
    - Test changing dropdown updates internal state (select Tight, verify state change)
    - Test spacingPreset is included in onAdd callback result
    - **Test file:** `frontend/src/__tests__/spacing-presets-ui.test.ts`
  - [x] 3.2 Add imports and spacing state to `AdvancedAddDialog.tsx`
    - Import at top:
      ```typescript
      import { SpacingPreset, DEFAULT_SPACING_PRESET } from '../../types/advancedAdd';
      ```
    - Add state in component:
      ```typescript
      const [spacingPreset, setSpacingPreset] = useState<SpacingPreset>(DEFAULT_SPACING_PRESET);
      ```
  - [x] 3.3 Add Material-UI imports for Select component
    - Add imports:
      ```typescript
      import { FormControl, InputLabel, Select, MenuItem } from '@mui/material';
      ```
    - Note: If using plain HTML select, adjust accordingly
  - [x] 3.4 Add spacing dropdown to dialog footer
    - Add in footer section, positioned LEFT of Cancel/Add buttons:
      ```tsx
      <FormControl size="small" sx={{ minWidth: 120, mr: 2 }}>
        <InputLabel id="spacing-preset-label">Spacing</InputLabel>
        <Select
          labelId="spacing-preset-label"
          id="spacing-preset"
          value={spacingPreset}
          label="Spacing"
          onChange={(e) => setSpacingPreset(e.target.value as SpacingPreset)}
          data-testid="spacing-preset-select"
        >
          <MenuItem value="spacious">Spacious</MenuItem>
          <MenuItem value="normal">Normal</MenuItem>
          <MenuItem value="tight">Tight</MenuItem>
        </Select>
      </FormControl>
      ```
  - [x] 3.5 Update `AdvancedAddResult` interface and dialog result
    - The `AdvancedAddResult` interface in `advancedAdd.ts` needs to include spacingPreset:
      ```typescript
      export interface AdvancedAddResult {
        treeData: TreeNodeData;
        selectedKeys: Set<string>;
        selections: SelectionDescriptor[];
        spacingPreset: SpacingPreset;  // ADD THIS FIELD
      }
      ```
    - Update the handleAdd callback in AdvancedAddDialog to include spacingPreset:
      ```typescript
      const result: AdvancedAddResult = {
        treeData,
        selectedKeys,
        selections,
        spacingPreset,  // Include the selected preset
      };
      onAdd(result);
      ```
  - [x] 3.6 Ensure Task Group 3 tests pass
    - Run ONLY the 4-5 tests written in 3.1
    - Verify dropdown UI works correctly

**Acceptance Criteria:**
- The 4-5 tests written in 3.1 pass
- Spacing dropdown appears in dialog footer, left of buttons
- Dropdown defaults to "Normal"
- Spacing preset is included in `AdvancedAddResult` passed to `onAdd`

**Files to modify:**
- `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`
- `frontend/src/types/advancedAdd.ts` (add spacingPreset to AdvancedAddResult)
- `frontend/src/__tests__/spacing-presets-ui.test.ts` (new file)

---

### Integration Layer

#### Task Group 4: Wire Up PalettePanel Integration
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete integration with PalettePanel
  - [x] 4.1 Write 4-5 focused integration tests
    - Test `handleAdvancedAddConfirm` receives spacingPreset from result
    - Test `buildWrappedNodeHierarchy` passes preset to `layoutAdvancedAddSelection`
    - Test end-to-end: selecting Tight produces smaller layout than Spacious
    - Test end-to-end: selecting Spacious produces larger layout than Normal
    - Test that containment relationships (parent_node_id) are preserved across all presets
    - **Test file:** `frontend/src/__tests__/spacing-presets-integration.test.ts`
  - [x] 4.2 Update `buildWrappedNodeHierarchy` function in `PalettePanel.tsx`
    - Add `spacingPreset: SpacingPreset = 'normal'` parameter to function signature:
      ```typescript
      export function buildWrappedNodeHierarchy(
        orderedNodes: TreeNodeData[],
        treeData: TreeNodeData,
        metaModel: MetaModel,
        diagram: { diagram_nodes: DiagramNode[]; diagram_edges?: DiagramEdge[] },
        viewportCenter: { x: number; y: number },
        spacingPreset: SpacingPreset = 'normal'  // ADD THIS PARAMETER
      ): WrappedNodeResult
      ```
    - Update the call to `layoutAdvancedAddSelection`:
      ```typescript
      const layoutRoot = layoutAdvancedAddSelection(layoutTreeRoot, viewportCenter, spacingPreset);
      ```
  - [x] 4.3 Add import for SpacingPreset in `PalettePanel.tsx`
    - Add to existing import from advancedAdd types:
      ```typescript
      import { AdvancedAddResult, TreeNodeData, LayoutTreeNode, SpacingPreset } from '../../types/advancedAdd';
      ```
  - [x] 4.4 Update `handleAdvancedAddConfirm` callback in `PalettePanel.tsx`
    - Extract spacingPreset from result:
      ```typescript
      const handleAdvancedAddConfirm = useCallback((result: AdvancedAddResult) => {
        // ... existing code ...
        const { treeData, selectedKeys, spacingPreset } = result;  // Extract spacingPreset
        // ... existing code ...

        // Pass spacingPreset to buildWrappedNodeHierarchy
        const wrappedResult = buildWrappedNodeHierarchy(
          orderedNodes,
          treeData,
          metaModel,
          diagram,
          center,
          spacingPreset  // ADD THIS ARGUMENT
        );
        // ... rest of function ...
      }, [...dependencies]);
      ```
  - [x] 4.5 Ensure Task Group 4 tests pass
    - Run ONLY the 4-5 tests written in 4.1
    - Verify end-to-end integration works

**Acceptance Criteria:**
- The 4-5 tests written in 4.1 pass
- Spacing preset flows from dialog through to layout functions
- End-to-end: different presets produce different sized layouts
- All existing functionality preserved (backward compatible)
- Parent-child containment relationships maintained for all presets

**Files to modify:**
- `frontend/src/components/DiagramsView/PalettePanel.tsx`
- `frontend/src/__tests__/spacing-presets-integration.test.ts` (new file)

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Definitions** - Add spacing types and constants (no dependencies)
2. **Task Group 2: Layout Algorithm** - Parameterize measure/assignPositions functions (depends on TG1)
3. **Task Group 3: UI** - Add spacing dropdown to dialog (depends on TG1, TG2)
4. **Task Group 4: Integration** - Wire up PalettePanel to use spacing preset (depends on TG1-3)

## Files Summary

| File | Changes |
|------|---------|
| `frontend/src/types/advancedAdd.ts` | Add SpacingPreset type, SpacingConfig interface, SPACING_PRESETS constant, DEFAULT_SPACING_PRESET constant, add spacingPreset to AdvancedAddResult |
| `frontend/src/utils/compoundLayout.ts` | Parameterize measure(), assignPositions(), layoutAdvancedAddSelection() with spacing config |
| `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` | Add spacing dropdown UI, include spacingPreset in result |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Update handleAdvancedAddConfirm and buildWrappedNodeHierarchy to pass spacing preset |

**New Test Files:**
| File | Purpose |
|------|---------|
| `frontend/src/__tests__/spacing-presets-types.test.ts` | Tests for type definitions and constants |
| `frontend/src/__tests__/spacing-presets-layout.test.ts` | Tests for layout algorithm with spacing config |
| `frontend/src/__tests__/spacing-presets-ui.test.tsx` | Tests for dropdown UI in dialog |
| `frontend/src/__tests__/spacing-presets-integration.test.ts` | End-to-end integration tests |

## Key Implementation Notes

1. **Backward Compatibility**: The 'normal' preset should produce results identical to current behavior. When no preset is specified, 'normal' should be the default.

2. **Fixed Constants**: These remain unchanged (not affected by spacing presets):
   - `LAYOUT_MIN_NODE_WIDTH` = 120
   - `LAYOUT_LABEL_PADDING` = 10
   - `LAYOUT_DEFAULT_FONT_SIZE` = 12

3. **No Overlap Guarantee**: All presets must maintain the no-overlap guarantee from the hierarchical layout algorithm.

4. **Default Selection**: Dropdown defaults to 'normal' preset using `DEFAULT_SPACING_PRESET` constant.

5. **Clean Data Flow**:
   ```
   AdvancedAddDialog (spacingPreset state)
     -> onAdd(result with spacingPreset)
       -> handleAdvancedAddConfirm
         -> buildWrappedNodeHierarchy(spacingPreset)
           -> layoutAdvancedAddSelection(spacingPreset)
             -> SPACING_PRESETS[spacingPreset] -> SpacingConfig
               -> measure(spacingConfig)
               -> assignPositions(spacingConfig)
   ```

6. **UI Layout Reference** (from spec):
   ```
   +-------------------------------------------------------------+
   | Advanced Add                                          [X]   |
   +-------------------------------------------------------------+
   |                                                             |
   |  [Tree view content...]                                     |
   |                                                             |
   +-------------------------------------------------------------+
   |  Spacing: [Normal v]              [Cancel] [Add to Diagram] |
   +-------------------------------------------------------------+
   ```

## Test Count Summary

| Task Group | Test Count | Focus Area |
|------------|------------|------------|
| TG1: Types | 6 tests | Type definitions, constants, values |
| TG2: Layout | 9 tests | Parameterized functions, sizing, no overlap |
| TG3: UI | 8 tests | Dropdown rendering, state, callback |
| TG4: Integration | 9 tests | End-to-end flow, preset propagation |
| **Total** | **32 tests** | Full feature coverage |
