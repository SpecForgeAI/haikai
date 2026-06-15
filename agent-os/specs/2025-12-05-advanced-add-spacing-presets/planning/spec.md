# Advanced Add – Spacing Presets (Spacious, Normal, Tight)

## Overview

This specification adds a "Spacing" dropdown to the Advanced Add dialog, allowing users to control the layout density of nodes created by the hierarchical layout algorithm. Three presets—Spacious, Normal, and Tight—provide different padding, gap, and minimum height values to produce more spread out or more compact diagram layouts.

## Problem Statement

The current Advanced Add hierarchical layout uses fixed spacing constants defined in `compoundLayout.ts`:

```typescript
export const LAYOUT_PADDING_X = 20;
export const LAYOUT_PADDING_Y = 20;
export const LAYOUT_CHILD_VERTICAL_GAP = 10;
export const LAYOUT_MIN_NODE_WIDTH = 120;
export const LAYOUT_MIN_NODE_HEIGHT = 40;
```

Users have no control over how densely or sparsely the generated hierarchy is laid out. Some users prefer compact layouts to minimize diagram size, while others prefer spacious layouts for better readability.

---

## Specification

### 1. Spacing Presets Definition

Three presets control the layout density:

| Preset | PADDING_X | PADDING_Y | CHILD_VERTICAL_GAP | MIN_EXTRA_HEIGHT |
|--------|-----------|-----------|---------------------|------------------|
| **Spacious** | 20 | 20 | 10 | 20 |
| **Normal** | 10 | 10 | 7 | 10 |
| **Tight** | 5 | 5 | 4 | 5 |

**Note**: `MIN_EXTRA_HEIGHT` is added to the base `MIN_NODE_HEIGHT` to calculate the effective minimum height for each preset.

#### 1.1 TypeScript Type Definition

```typescript
export type SpacingPreset = 'spacious' | 'normal' | 'tight';

export interface SpacingConfig {
  paddingX: number;
  paddingY: number;
  childVerticalGap: number;
  minExtraHeight: number;
}

export const SPACING_PRESETS: Record<SpacingPreset, SpacingConfig> = {
  spacious: {
    paddingX: 20,
    paddingY: 20,
    childVerticalGap: 10,
    minExtraHeight: 20,
  },
  normal: {
    paddingX: 10,
    paddingY: 10,
    childVerticalGap: 7,
    minExtraHeight: 10,
  },
  tight: {
    paddingX: 5,
    paddingY: 5,
    childVerticalGap: 4,
    minExtraHeight: 5,
  },
};

export const DEFAULT_SPACING_PRESET: SpacingPreset = 'normal';
```

#### 1.2 Derived Constants

The layout algorithm uses these derived values:

```typescript
const paddingX = config.paddingX;
const paddingY = config.paddingY;
const childVerticalGap = config.childVerticalGap;
const minNodeWidth = LAYOUT_MIN_NODE_WIDTH;  // Fixed at 120
const minNodeHeight = LAYOUT_MIN_NODE_HEIGHT + config.minExtraHeight;
const labelPadding = LAYOUT_LABEL_PADDING;  // Fixed at 10
```

---

### 2. UI: Spacing Dropdown in Advanced Add Dialog

#### 2.1 Placement

Add a "Spacing" dropdown in the Advanced Add dialog footer, positioned to the left of the existing "Cancel" and "Add to Diagram" buttons.

```
┌─────────────────────────────────────────────────────────────┐
│ Advanced Add                                          [X]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [Tree view content...]                                     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Spacing: [Normal ▼]              [Cancel] [Add to Diagram] │
└─────────────────────────────────────────────────────────────┘
```

#### 2.2 Dropdown Options

| Value | Display Label |
|-------|---------------|
| `spacious` | Spacious |
| `normal` | Normal |
| `tight` | Tight |

#### 2.3 Default Selection

The dropdown defaults to **Normal** preset.

#### 2.4 UI Implementation

```tsx
// In AdvancedAddDialog.tsx
const [spacingPreset, setSpacingPreset] = useState<SpacingPreset>('normal');

// In the footer/actions area:
<FormControl size="small" sx={{ minWidth: 120, mr: 2 }}>
  <InputLabel id="spacing-preset-label">Spacing</InputLabel>
  <Select
    labelId="spacing-preset-label"
    id="spacing-preset"
    value={spacingPreset}
    label="Spacing"
    onChange={(e) => setSpacingPreset(e.target.value as SpacingPreset)}
  >
    <MenuItem value="spacious">Spacious</MenuItem>
    <MenuItem value="normal">Normal</MenuItem>
    <MenuItem value="tight">Tight</MenuItem>
  </Select>
</FormControl>
```

---

### 3. Layout Algorithm Parameterization

#### 3.1 Update `measure()` Function

The `measure()` function must accept a `SpacingConfig` parameter:

```typescript
export function measure(
  node: LayoutTreeNode,
  spacingConfig: SpacingConfig
): MeasuredNode {
  const { paddingX, paddingY, childVerticalGap, minExtraHeight } = spacingConfig;
  const minNodeHeight = LAYOUT_MIN_NODE_HEIGHT + minExtraHeight;

  // ... rest of implementation using these values
}
```

#### 3.2 Update `assignPositions()` Function

The `assignPositions()` function must accept a `SpacingConfig` parameter:

```typescript
export function assignPositions(
  node: MeasuredNode,
  originX: number,
  originY: number,
  spacingConfig: SpacingConfig
): LayoutNode {
  const { paddingX, paddingY, childVerticalGap } = spacingConfig;

  // ... rest of implementation using these values
}
```

#### 3.3 Update `layoutAdvancedAddSelection()` Function

The main entry point must accept and propagate the spacing config:

```typescript
export function layoutAdvancedAddSelection(
  rootTreeNode: LayoutTreeNode,
  viewportCenter: { x: number; y: number },
  spacingPreset: SpacingPreset = 'normal'
): LayoutNode {
  const spacingConfig = SPACING_PRESETS[spacingPreset];

  // Pass spacingConfig to measure()
  const measuredRoot = measure(rootTreeNode, spacingConfig);

  // Calculate root origin
  const rootX = viewportCenter.x - measuredRoot.measuredWidth / 2;
  const rootY = viewportCenter.y - measuredRoot.measuredHeight / 2;

  // Pass spacingConfig to assignPositions()
  return assignPositions(measuredRoot, rootX, rootY, spacingConfig);
}
```

---

### 4. Data Flow

The spacing preset flows through the system as follows:

```
AdvancedAddDialog
  └─ spacingPreset state (SpacingPreset)
       └─ onConfirm callback
            └─ handleAdvancedAddConfirm (PalettePanel.tsx)
                 └─ buildWrappedNodeHierarchy()
                      └─ layoutAdvancedAddSelection(tree, viewport, spacingPreset)
                           └─ measure(node, spacingConfig)
                           └─ assignPositions(node, x, y, spacingConfig)
                                └─ convertTodiagramNodes(layoutNode, zIndex)
```

#### 4.1 Update Callback Signature

The `onConfirm` callback in `AdvancedAddDialog` must pass the spacing preset:

```typescript
// Current signature (approximate):
onConfirm: (selectedNodes: TreeNodeData[]) => void;

// Updated signature:
onConfirm: (selectedNodes: TreeNodeData[], spacingPreset: SpacingPreset) => void;
```

#### 4.2 Update `buildWrappedNodeHierarchy()`

The function must accept and use the spacing preset:

```typescript
function buildWrappedNodeHierarchy(
  treeData: TreeNodeData[],
  viewportCenter: { x: number; y: number },
  spacingPreset: SpacingPreset = 'normal'
): { nodesToAdd: DiagramNode[]; nodesToUpdate: DiagramNode[] } {
  // Convert tree to LayoutTreeNode
  const layoutTree = convertTreeNodeToLayoutTree(treeData);

  // Use spacing preset in layout
  const layoutRoot = layoutAdvancedAddSelection(layoutTree, viewportCenter, spacingPreset);

  // Convert to diagram nodes
  return convertTodiagramNodes(layoutRoot, baseZIndex);
}
```

---

### 5. Fixed Constants

These constants remain fixed and are not affected by spacing presets:

| Constant | Value | Reason |
|----------|-------|--------|
| `LAYOUT_MIN_NODE_WIDTH` | 120 | Minimum readable width |
| `LAYOUT_LABEL_PADDING` | 10 | Space below parent label |
| `LAYOUT_DEFAULT_FONT_SIZE` | 12 | Text measurement consistency |

---

### 6. Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/types/advancedAdd.ts` | Add `SpacingPreset`, `SpacingConfig`, `SPACING_PRESETS`, `DEFAULT_SPACING_PRESET` |
| `frontend/src/utils/compoundLayout.ts` | Parameterize `measure()`, `assignPositions()`, `layoutAdvancedAddSelection()` with spacing config |
| `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` | Add spacing dropdown, pass preset in `onConfirm` |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Update `handleAdvancedAddConfirm()` and `buildWrappedNodeHierarchy()` to accept spacing preset |

---

### 7. Testing Requirements

#### 7.1 Unit Tests for Spacing Presets

- Test that `SPACING_PRESETS` contains all three presets with correct values
- Test that `DEFAULT_SPACING_PRESET` is 'normal'
- Test that `SpacingConfig` interface has all required fields

#### 7.2 Layout Algorithm Tests

- Test `measure()` produces larger dimensions with 'spacious' preset
- Test `measure()` produces smaller dimensions with 'tight' preset
- Test `assignPositions()` uses correct gaps between siblings for each preset
- Test `layoutAdvancedAddSelection()` accepts spacing preset parameter

#### 7.3 Integration Tests

- Test that selecting 'spacious' preset results in larger overall layout
- Test that selecting 'tight' preset results in smaller overall layout
- Test that nodes do not overlap regardless of spacing preset
- Test that containment relationships are maintained across all presets

#### 7.4 UI Tests

- Test dropdown renders with correct options
- Test dropdown defaults to 'Normal'
- Test changing dropdown updates state
- Test spacing preset is passed to onConfirm callback

---

### 8. Acceptance Criteria

1. **UI Present**: Advanced Add dialog shows "Spacing" dropdown with Spacious/Normal/Tight options
2. **Default Selection**: Dropdown defaults to "Normal"
3. **Spacious Layout**: Selecting "Spacious" produces visibly larger spacing between nodes
4. **Tight Layout**: Selecting "Tight" produces visibly smaller spacing between nodes
5. **No Overlap**: Nodes never overlap regardless of spacing preset selected
6. **Hierarchy Preserved**: Parent-child containment relationships are maintained
7. **Existing Behavior**: When "Normal" is selected, layout matches current behavior (backward compatibility)

---

### 9. Visual Examples

#### 9.1 Spacious Preset

```
┌──────────────────────────────────────────────────────────┐
│ Application: My App                                      │
│                                                          │
│   ┌──────────────────────────────────────────────────┐   │
│   │ App Component: My Comp                           │   │
│   │                                                  │   │
│   │   ┌──────────────────────────────────────────┐   │   │
│   │   │ Service: My Service                      │   │   │
│   │   └──────────────────────────────────────────┘   │   │
│   │                                                  │   │
│   └──────────────────────────────────────────────────┘   │
│                                                          │
│   ┌──────────────────────────────────────────────────┐   │
│   │ Business Process: Order                          │   │
│   └──────────────────────────────────────────────────┘   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

#### 9.2 Tight Preset

```
┌──────────────────────────────────────────┐
│ Application: My App                      │
│ ┌──────────────────────────────────────┐ │
│ │ App Component: My Comp               │ │
│ │ ┌──────────────────────────────────┐ │ │
│ │ │ Service: My Service              │ │ │
│ │ └──────────────────────────────────┘ │ │
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │ Business Process: Order              │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

---

### 10. Summary

This specification adds user-controlled layout density to Advanced Add through:

1. **Three presets**: Spacious, Normal, Tight with different spacing values
2. **UI dropdown**: In dialog footer, defaulting to Normal
3. **Parameterized layout**: measure() and assignPositions() accept SpacingConfig
4. **Clean data flow**: Preset flows from dialog → callback → layout functions
5. **Backward compatible**: Normal preset matches current behavior
