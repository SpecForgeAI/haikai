# Advanced Add – hierarchical layout using recursive tree-based containment (single-block version)

## Summary

Advanced Add now correctly builds the logical containment tree, but the diagram currently places all selected nodes on top of each other. This spec defines a recursive, two-pass layout algorithm so the diagram visually matches the Advanced Add hierarchy: parents wrap children as nested boxes, siblings are stacked vertically with gaps, and the final layout matches the user's selected tree exactly.

## Scope

- How the Advanced Add selection tree is translated into diagram geometry.
- A two-pass (measure then position) recursive layout algorithm.
- Ensures containment chains render as nested boxes exactly matching the Advanced Add tree.

## Out of scope

- How the selection tree is constructed (already working).
- Edge-only relationships (User ↔ Business Point, Logical ER, etc.).
- Auto-layout or manual positioning outside Advanced Add.
