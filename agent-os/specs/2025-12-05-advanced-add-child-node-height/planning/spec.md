# Advanced Add – Correct Child Node Height Using CHILD_NODE_HEIGHT and Spacing Presets

## Overview

This specification corrects the height calculation for leaf nodes in the Advanced Add hierarchical layout. Currently, leaf node heights are treated as minimum bounds using `Math.max()`, which prevents children from visually shrinking when switching to tighter spacing presets. This update introduces explicit height concepts:

1. **CHILD_NODE_HEIGHT** – The **exact height** for leaf nodes (nodes with no children)
2. **MIN_HEIGHT** – The **minimum height** for container nodes (nodes with children)

This ensures that switching between Spacious / Normal / Tight presets visibly adjusts the height of child nodes in a predictable and consistent way.

---

## Problem Statement

### Current Behavior

In `compoundLayout.ts`, the `measure()` function calculates leaf node height as:

```typescript
// Current (problematic) implementation
measuredHeight: Math.max(minNodeHeight, labelHeight + 2 * paddingY)
```

Where `minNodeHeight = LAYOUT_MIN_NODE_HEIGHT + minExtraHeight` (40 + preset extra).

This means:
- **Spacious** (minExtraHeight=20): minNodeHeight = 60
- **Normal** (minExtraHeight=10): minNodeHeight = 50
- **Tight** (minExtraHeight=5): minNodeHeight = 45

The problem is the `Math.max()` always uses the larger value. If `labelHeight + 2 * paddingY` is smaller than `minNodeHeight`, all presets produce the same height (the minimum). The height never shrinks below the minimum even when the user selects "Tight".

### Expected Behavior

Leaf nodes should use an **exact height** that varies directly with the spacing preset:
- **Spacious**: Tallest leaf nodes
- **Normal**: Medium height leaf nodes
- **Tight**: Shortest leaf nodes

The height should only exceed the preset value if the label text wraps to multiple lines.

---

## Specification

### 1. Updated SpacingConfig Interface

Remove `minExtraHeight` and replace with explicit height calculation concepts:

```typescript
export interface SpacingConfig {
  /** Horizontal padding inside containers */
  paddingX: number;
  /** Vertical padding inside containers */
  paddingY: number;
  /** Vertical gap between sibling nodes */
  childVerticalGap: number;
}
```

**Note**: `minExtraHeight` is removed because:
- Leaf node height = `textHeight + paddingY` (exact, not minimum)
- Container minimum height = `textHeight + paddingY` (before adding children)

The padding values already encode the spacing intent.

### 2. Updated Spacing Preset Values

| Preset | paddingX | paddingY | childVerticalGap |
|--------|----------|----------|------------------|
| **Spacious** | 20 | 20 | 10 |
| **Normal** | 10 | 10 | 7 |
| **Tight** | 5 | 5 | 4 |

```typescript
export const SPACING_PRESETS: Record<SpacingPreset, SpacingConfig> = {
  spacious: {
    paddingX: 20,
    paddingY: 20,
    childVerticalGap: 10,
  },
  normal: {
    paddingX: 10,
    paddingY: 10,
    childVerticalGap: 7,
  },
  tight: {
    paddingX: 5,
    paddingY: 5,
    childVerticalGap: 4,
  },
};
```

### 3. Height Calculation Rules

#### 3.1 Leaf Nodes (CHILD_NODE_HEIGHT)

For nodes with **no children**, height is calculated as:

```
CHILD_NODE_HEIGHT = labelHeight + 2 * paddingY
```

This is an **exact value**, not a minimum. The height only increases if the label text wraps to multiple lines.

**Implementation**:
```typescript
// Leaf node height calculation
measuredHeight = labelHeight + 2 * paddingY
```

**Width** remains:
```typescript
measuredWidth = Math.max(LAYOUT_MIN_NODE_WIDTH, labelWidth + 2 * paddingX)
```

#### 3.2 Container Nodes (MIN_HEIGHT + Children)

For nodes **with children**, height is calculated as:

```
containerHeight = paddingY + labelHeight + LAYOUT_LABEL_PADDING + totalChildrenHeight + paddingY
```

Where:
- `paddingY` = top padding
- `labelHeight` = height of the container's label text
- `LAYOUT_LABEL_PADDING` = 10 (fixed space below label)
- `totalChildrenHeight` = sum of all children heights + gaps between them
- `paddingY` = bottom padding

The container grows to fit its children. There is no minimum height constraint beyond what the label requires.

**Implementation**:
```typescript
// Container node height calculation
const totalChildrenHeight =
  childHeights.reduce((sum, h) => sum + h, 0) +
  childVerticalGap * (children.length - 1);

const contentHeight = labelHeight + LAYOUT_LABEL_PADDING + totalChildrenHeight;

measuredHeight = contentHeight + 2 * paddingY;
```

### 4. Updated measure() Function

```typescript
export function measure(node: LayoutTreeNode, spacingConfig?: SpacingConfig): MeasuredNode {
  const config = spacingConfig || SPACING_PRESETS.normal;
  const { paddingX, paddingY, childVerticalGap } = config;

  // Determine font weight based on whether this is a container
  const isContainer = node.children.length > 0;
  const fontWeight = isContainer ? LAYOUT_CONTAINER_FONT_WEIGHT : 'normal';

  // Calculate label dimensions
  const wrapWidth = LAYOUT_MIN_NODE_WIDTH - 2 * paddingX;
  const labelWidth = estimateLabelWidth(node.label, LAYOUT_DEFAULT_FONT_SIZE, fontWeight);
  const labelHeight = estimateLabelHeight(
    node.label,
    Math.max(wrapWidth, labelWidth),
    LAYOUT_DEFAULT_FONT_SIZE,
    fontWeight
  );

  // Recursively measure children first (bottom-up)
  const measuredChildren: MeasuredNode[] = node.children.map(child => measure(child, config));

  // LEAF NODE: Use exact CHILD_NODE_HEIGHT
  if (measuredChildren.length === 0) {
    return {
      id: node.id,
      type: node.type,
      label: node.label,
      children: [],
      measuredWidth: Math.max(LAYOUT_MIN_NODE_WIDTH, labelWidth + 2 * paddingX),
      measuredHeight: labelHeight + 2 * paddingY,  // EXACT height, not minimum
    };
  }

  // CONTAINER NODE: Size based on label + children
  const childWidths = measuredChildren.map(c => c.measuredWidth);
  const childHeights = measuredChildren.map(c => c.measuredHeight);

  const maxChildWidth = Math.max(...childWidths);
  const totalChildrenHeight =
    childHeights.reduce((sum, h) => sum + h, 0) +
    childVerticalGap * (measuredChildren.length - 1);

  // Content area
  const contentWidth = Math.max(labelWidth, maxChildWidth);
  const contentHeight = labelHeight + LAYOUT_LABEL_PADDING + totalChildrenHeight;

  return {
    id: node.id,
    type: node.type,
    label: node.label,
    children: measuredChildren,
    measuredWidth: Math.max(LAYOUT_MIN_NODE_WIDTH, contentWidth + 2 * paddingX),
    measuredHeight: contentHeight + 2 * paddingY,  // No minimum, just content
  };
}
```

### 5. assignPositions() Remains Unchanged

The `assignPositions()` function uses the `measuredHeight` values from `measure()`. Since those values are now calculated correctly, no changes are needed to the positioning logic.

### 6. Height Comparison by Preset

For a single-line label with `labelHeight = 14px`:

| Preset | paddingY | CHILD_NODE_HEIGHT | Calculation |
|--------|----------|-------------------|-------------|
| **Spacious** | 20 | 54px | 14 + 2×20 |
| **Normal** | 10 | 34px | 14 + 2×10 |
| **Tight** | 5 | 24px | 14 + 2×5 |

This shows clear visual differentiation between presets.

### 7. Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/types/advancedAdd.ts` | Remove `minExtraHeight` from `SpacingConfig`, update `SPACING_PRESETS` |
| `frontend/src/utils/compoundLayout.ts` | Update `measure()` to use exact height for leaf nodes |
| `frontend/src/__tests__/spacing-presets-layout.test.ts` | Update tests to verify new height behavior |
| `frontend/src/__tests__/spacing-presets-types.test.ts` | Update tests for modified interface |

### 8. Backward Compatibility

The **Normal** preset should produce similar layouts to before, but leaf nodes may be slightly different in height. This is acceptable because:
1. The previous behavior was incorrect (heights didn't change with presets)
2. Users will see more predictable spacing behavior

---

## Acceptance Criteria

1. **Leaf nodes visibly change height** when switching between Spacious / Normal / Tight presets
2. **Spacious produces tallest** leaf nodes
3. **Tight produces shortest** leaf nodes
4. **Container nodes correctly wrap** their children with updated spacing
5. **No overlapping** occurs regardless of spacing preset
6. **Layout remains deterministic** and stable
7. **Re-running Advanced Add** applies new spacing rules without duplicating nodes
8. **All existing tests pass** (with updated expectations where needed)

---

## Visual Examples

### Spacious Preset (paddingY = 20)

```
┌──────────────────────────────────────────────────────────┐
│ Application: My App                                      │
│                                                          │
│   ┌──────────────────────────────────────────────────┐   │
│   │                                                  │   │
│   │  Service: My Service                             │   │
│   │                                                  │   │
│   └──────────────────────────────────────────────────┘   │
│                                                          │
│   ┌──────────────────────────────────────────────────┐   │
│   │                                                  │   │
│   │  Business Process: Order                         │   │
│   │                                                  │   │
│   └──────────────────────────────────────────────────┘   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Tight Preset (paddingY = 5)

```
┌────────────────────────────────────────┐
│ Application: My App                    │
│ ┌────────────────────────────────────┐ │
│ │ Service: My Service                │ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ Business Process: Order            │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

---

## Summary

This specification corrects the leaf node height calculation by:

1. **Removing `minExtraHeight`** from `SpacingConfig` (simplifies the interface)
2. **Using exact height** for leaf nodes: `labelHeight + 2 * paddingY`
3. **Removing `Math.max()` minimum constraint** for leaf nodes
4. **Keeping container logic** that grows to fit children

The result is that spacing presets now directly and visibly control leaf node heights, making the Spacious/Normal/Tight selection meaningful to users.
