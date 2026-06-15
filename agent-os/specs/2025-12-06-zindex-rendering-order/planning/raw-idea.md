Title: z_index as the Single Source of Truth for Rendering Order

Summary:
Although z_index values are correctly updated in the diagram JSON when the user chooses "Bring Forward", "Send Backward", "Bring to Front", or "Send to Back", the actual rendering still respects creation/insertion order instead of z_index.
This spec makes z_index authoritative: all diagram elements (nodes, edges, decorations) MUST be rendered strictly in ascending z_index order.

--------------------------------------------------------------------
1. z_index governs draw order for ALL drawable elements

All drawable diagram entities must share the same z-index space:

• Meta-model nodes
• Node edges (relationship lines)
• Decorations (shapes, lines, arrows)

**Rendering rule (mandatory):**
> Elements MUST be painted in ascending z_index order (lowest first).
> Elements with higher z_index must always appear visually on top.

This replaces any previous "insertion-based" or "group-based" ordering logic.

--------------------------------------------------------------------
2. Required rendering pipeline update

Whenever the diagram is initially loaded OR redrawn:

1. Collect ALL drawable elements into a single list:
   - Nodes
   - Edges (relationship lines)
   - Decorations (shapes/arrows)

2. Sort the list by:
   - Primary key: z_index (ascending)
   - Secondary key (tie-breaker): stable deterministic value (e.g., element id)

3. Render items in this sorted order.

The renderer MUST NOT rely on:
- canvas insertion order, or
- reactive layer order, or
- creation timestamp.

z_index must be the sole determinant.

--------------------------------------------------------------------
3. Required behaviour when the user changes z-index through context menu

When the user triggers any of the following:

• Bring Forward → `z_index = z_index + 1`
• Send Backward → `z_index = z_index - 1`
• Bring to Front → `z_index = (max_z_index_of_all_items) + 1`
• Send to Back → `z_index = (min_z_index_of_all_items) - 1`

Then:

1. The underlying JSON is updated (already working).
2. The renderer MUST immediately:
   - Recompute global z_index ordering,
   - Re-sort all elements,
   - Fully redraw the diagram according to the sorted order.

A node/decoration moved to the top MUST ALWAYS appear visually above all others.

--------------------------------------------------------------------
4. z_index persistence and load behaviour

On load:

• z_index values MUST be read from JSON and preserved.
• The rendering MUST sort by those values before painting.

If any item lacks a z_index (legacy diagrams), assign values as follows:

• Determine the current highest z_index in the dataset;
• Append legacy items after the largest existing z_index using incremental ordering.

This ensures backward compatibility without breaking the new layering system.

--------------------------------------------------------------------
5. Acceptance Criteria

✔ Changing z-index via context menu immediately updates the visual stacking order.
✔ An element with higher z_index ALWAYS appears above lower z_index elements, regardless of:
   - creation order
   - previous drawing order
   - element type (node, edge, decoration)

✔ Bring to Front makes the selected item the highest-layered visual object.
✔ Send to Back makes it the lowest-layered visual object.
✔ Reloading a diagram restores z-index correctly and the visual layering matches the saved order.
✔ No category (nodes, edges, decorations) has special priority; only z_index determines order.

This completes the specification for enforcing z_index as the single authoritative source for rendering order.
