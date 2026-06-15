# Advanced Add – Correct Child Node Height Using CHILD_NODE_HEIGHT and Spacing Presets

## Summary

Spacing presets (Spacious, Normal, Tight) must directly control the *actual* height of child/leaf nodes in the Advanced Add hierarchical layout. Previously, height was treated as a minimum bound, causing children not to visually shrink or grow with spacing choices. This update introduces two explicit concepts per spacing preset:

1. **MIN_HEIGHT**
   - the minimum height for **container nodes** (nodes with children)
   - equals textHeight + presetPadding

2. **CHILD_NODE_HEIGHT**
   - the **exact height** used for all leaf nodes (nodes with no children)
   - equals textHeight + presetPadding

Parent containers continue to grow beyond MIN_HEIGHT as needed to fit their children. Leaf nodes always use CHILD_NODE_HEIGHT exactly.

This ensures that switching between Spacious / Normal / Tight visibly adjusts the height of child nodes in a predictable and consistent way.

---

## 1. Updated spacing preset definitions

For each preset, define:

- MIN_HEIGHT = textHeight + presetPadding
- CHILD_NODE_HEIGHT = textHeight + presetPadding

Where presetPadding is:

### Spacious
- PADDING_X = 20 px
- PADDING_Y = 20 px
- CHILD_VERTICAL_GAP = 10 px
- MIN_WIDTH = 120 px
- MIN_HEIGHT = textHeight + 20 px
- CHILD_NODE_HEIGHT = textHeight + 20 px

### Normal
- PADDING_X = 10 px
- PADDING_Y = 10 px
- CHILD_VERTICAL_GAP = 7 px
- MIN_WIDTH = 120 px
- MIN_HEIGHT = textHeight + 10 px
- CHILD_NODE_HEIGHT = textHeight + 10 px

### Tight
- PADDING_X = 5 px
- PADDING_Y = 5 px
- CHILD_VERTICAL_GAP = 4 px
- MIN_WIDTH = 120 px
- MIN_HEIGHT = textHeight + 5 px
- CHILD_NODE_HEIGHT = textHeight + 5 px

**Notes:**
- CHILD_NODE_HEIGHT applies **only to leaf nodes**.
- MIN_HEIGHT applies **only to nodes with children** and is a baseline height before wrapping children.

---

## 2. Updated measure() function logic

Modify the measure() pass as follows.

### 2.1 Leaf nodes (node.children is empty):

```
height = CHILD_NODE_HEIGHT
width  = max(MIN_WIDTH, labelWidth + 2 * PADDING_X)
```

Store:
```
node.measuredHeight = CHILD_NODE_HEIGHT
node.measuredWidth  = width
```

This height MUST NOT increase unless the label wraps; it is exact.

### 2.2 Non-leaf nodes:

1. Compute MIN_HEIGHT = textHeight + presetPadding
2. Compute child sizes as normal
3. contentHeight = max(totalChildrenHeight, MIN_HEIGHT)

Then:

```
height = contentHeight + 2 * PADDING_Y
width  = max(MIN_WIDTH, max(labelWidth, childrenMaxWidth) + 2 * PADDING_X)
```

Store:
```
node.measuredHeight = height
node.measuredWidth  = width
```

This ensures:
- A parent is never shorter than its own label height + preset padding.
- A parent expands vertically to wrap all children.

---

## 3. assignPositions() remains unchanged

The height values used during placement are simply the new measuredHeight values from measure().

Child positioning and padding rules remain as previously specified.

---

## 4. Behavioural expectations

1. Leaf node heights change visibly with spacing mode:
   - Spacious → tallest
   - Normal → medium
   - Tight → shortest

2. Parent nodes adjust:
   - If children require more height, parent grows.
   - If not, parent uses MIN_HEIGHT.

3. Hierarchy and containment remain unchanged.

4. No overlapping occurs regardless of spacing mode.

---

## 5. Acceptance criteria

1. Leaf nodes clearly shrink/grow as users switch between Spacious / Normal / Tight.
2. Parent containers maintain correct wrapping around child nodes with updated spacing.
3. Advanced Add layout remains deterministic and stable.
4. Re-running Advanced Add applies new spacing rules without duplicating nodes.

---

This spec fully corrects node height behaviour by introducing explicit MIN_HEIGHT (for containers) and CHILD_NODE_HEIGHT (exact height for leaf nodes), tied directly to spacing presets.
