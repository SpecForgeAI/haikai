Title: ERD/UML-Style Rendering for Logical & Physical Entities With Attributes

Summary:
Logical Entities and Physical Entities currently render as a parent box containing multiple child attribute boxes. This specification replaces that rendering *when the entity is added together with its attributes* using an ERD/UML-style unified class-box layout:

• A **single rectangle**
• **Top compartment**: Entity name (centered, bold)
• **Divider line**
• **Lower compartment**: A vertical list of attribute rows (no boxes), each showing attribute name (and type if available)

Two mechanisms must trigger this rendering:
1. **New RHS context menu option:** "Add with attributes" on Logical Entities and Physical Entities.
2. **Advanced Add…**: When a Logical Entity or Physical Entity is selected in the tree with its attributes also selected, the rendered result must use the ERD-style box.

This only affects *displayed nodes*, not the underlying meta-model. Attribute objects remain separate in JSON but their visual representation changes.

--------------------------------------------------------------------
1. New context menu option: "Add with attributes"

In the RHS panels:
- For **Logical Entities**
- For **Physical Entities**

Add a new context menu entry:

    "Add with attributes"

Behaviour:
- When clicked, add the parent entity to the diagram.
- Automatically include **all attributes** belonging to that entity (logical or physical).
- Render the entity using the ERD/UML-style unified box described in Section 3.
- Child attribute boxes are **not** rendered individually; instead the attributes are rendered as text rows inside one box.

--------------------------------------------------------------------
2. Advanced Add… behaviour for Logical/Physical Entities

Currently, Advanced Add shows Logical/Physical Entities as parent nodes and their attributes as children.

Updated behaviour:
- When the user selects:
  • A Logical or Physical Entity
  AND
  • One or more (or all) of its attributes
  then the resulting visual node on the diagram MUST be rendered as a single ERD-style box.

Details:
- Regardless of how many attributes are selected, **the renderer must always collapse them into the unified ERD-style representation**.
- No attribute becomes a standalone child box.
- The overall container size must adjust according to the number of attributes.

--------------------------------------------------------------------
3. ERD/UML-style node rendering specification

When rendering a Logical Entity or Physical Entity *with attributes*:

3.1 Node structure:
- One rectangle containing:
  1. **Name compartment**
     - Bold text
     - Center-aligned horizontally
     - Vertical padding (use existing style padding rules)
  2. **Divider line** (1px stroke)
  3. **Attributes compartment**
     - Each attribute shown as a line of text
     - Format rules:
        Logical:   "<AttributeName> : <DataType>" if type is available
        Physical:  "<AttributeName> : <DataType>" if type is available
     - Each row has consistent padding (spacing inherited from spacing preset: Spacious/Normal/Tight)
     - No boxes around attributes

3.2 Sizing:
- The node auto-sizes to:
  • Fit the entity name
  • Height = sum of all attribute row heights + padding
  • Width = max(name width, widest attribute row) + padding
- If auto_size is disabled, the ERD box still respects minimum width/height rules but allows manual resizing.

3.3 Selection:
- Selecting the ERD-style entity selects the entire box.
- Attributes cannot be individually selected (their semantics remain in data, not UI).

3.4 Z-index, positioning, resizing:
- Behave identically to other nodes.
- If resized manually:
  - Width expands normally.
  - Height expansion creates vertical whitespace below the last attribute row.
  - Attributes never leave the box; overflow must not occur.

--------------------------------------------------------------------
4. JSON model (no changes required)

Logical Attribute and Physical Attribute remain separate child entities in JSON.

Renderer rules:
- When an entity node is rendered in ERD-style mode, *attributes are not rendered as separate visual nodes*, but they still exist in JSON.
- Advanced Add must still pass the selected attributes as part of the build-tree, but the renderer collapses them into one entity node.

--------------------------------------------------------------------
5. Event handling and rule interactions

5.1 Adding an entity without attributes:
- Should continue to display the entity using the normal node styling (a single box, no attribute list).
- Only show ERD-style box when attributes are explicitly included via:
  • "Add with attributes"
  • Advanced Add selection

5.2 Re-running Advanced Add:
- If a Logical/Physical Entity already exists on the diagram:
  - If the entity exists **without attributes**, and the user now adds "with attributes", upgrade it to ERD-style.
  - If it already exists **as ERD-style**, merge/update attributes inside it (no duplicates).

5.3 Layout & spacing presets:
- ERD-style node must use spacing rules from the active preset (Spacious, Normal, Tight) for:
  • padding above/below name
  • attribute row spacing
  • container padding
- Spacing rules supersede previous wrapping rules (this node becomes a flat box, not nested).

--------------------------------------------------------------------
6. Acceptance criteria

1. User right-clicks a Logical or Physical Entity → selects "Add with attributes" → diagram displays a single ERD-style box (entity name + divider + attribute list).
2. User opens Advanced Add… and checks a Logical or Physical Entity + its attributes → diagram displays the ERD-style box.
3. Attributes never appear as separate nested boxes when added through either mechanism.
4. ERD-style entity is fully interactive: selectable, movable, resizable, supports z-index changes.
5. ERD-style box persists correctly in JSON (entity + attribute relationships) and loads back into the same visual form.
6. Entities added without attributes continue to display in the standard node style.

This completes the specification for ERD/UML-style rendering of Logical and Physical Entities when added with their attributes.
