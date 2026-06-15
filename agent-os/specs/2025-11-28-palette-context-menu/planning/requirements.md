# Palette Context Menu - Requirements

## Overview
Extend the right-hand palette panel so that right-clicking an item opens a custom context menu (instead of the browser default), with context-aware actions. This includes generic Add/Delete options for all items, plus two special "compound add" operations for Application Points of kind = APPLICATION: "Add with business processes" and "Add with app components".

---

## 1) Right-click context menu on palette items

### 1.1 Override browser context menu
- When the user right-clicks (contextmenu event) on any item in the right-hand palette panel:
  - Do NOT show the browser's default context menu.
  - Show the tool's custom context menu instead.

### 1.2 Context menu appearance
- Appear near the cursor.
- Minimal width, white background, border or shadow, clickable rows.
- Auto-dismiss when clicking outside or pressing Escape.

### 1.3 Base menu options (for ALL palette items)
- If the palette item is NOT currently on the active diagram (i.e., no existing diagram_node or diagram_edge for that entity/relationship):
  - Show: "Add"
- If the palette item IS already present on the active diagram:
  - Show: "Delete"

This provides consistent Add/Delete behaviour across the tool.

---

## 2) Context menu extensions for Application Points (kind = APPLICATION)

For palette items representing Application Points of type 'APPLICATION' ONLY, show two additional context menu options:
- "Add with business processes"
- "Add with app components"

These appear in addition to Add/Delete when right-clicking on an item representing an Application.

---

## 3) Behaviour: "Add with business processes"

Triggered when the user right-clicks an APPLICATION Application Point in the palette and chooses "Add with business processes".

### 3.1 Steps:

1. Add the Application's Application Point to the diagram (if not already present).
   - Use standard node creation rules (pos_x, pos_y as default placement if not present).
   - This node becomes the parent container.

2. Query metaModel.relationships.application_point_business_processes:
   - Find all business_process IDs linked to this Application Point ID.

3. For each linked business_process:
   - Add a Business Process diagram_node as a child of the Application Point:
     - Set parent_node_id = <application_point_node_id>.

4. Apply stacked vertical layout for these child Business Process nodes:
   - All child process boxes share the same X coordinate (process_pos_x).
   - Starting from top inside the parent:
     - First process box at parent.pos_y + top padding.
     - Each subsequent process box is placed below the previous one with 5px vertical gap.

5. Height of each process box:
   - Based on the number of wrapped text lines + internal padding already defined earlier.
   - Each Business Process box may differ in height.

6. Width of process boxes:
   - Compute each process node's width based on its text (auto_size rules or default width).
   - Final parent width is dictated by the widest child.

### 3.2 Parent Application Point box sizing:

Let:
- max_child_width = max(process_box.width).
- sum_child_heights = sum(process_box.height + 5px gap).
- app_text_height = height of the Application's label (calculated via existing auto-size rules).

Parent width =
5px padding-left
+ max_child_width
+ 5px padding-right

Parent height =
5px padding-top
+ app_text_height
+ 5px padding-bottom
+ sum_child_heights

The resulting Application box visually encloses all process boxes.

### 3.3 JSON updates
- Add Application Point node + child Process nodes to diagrams[].diagram_nodes.
- Save JSON so the structure is persisted.
- After Save/Load, the diagram recreates the stacked structure.

---

## 4) Behaviour: "Add with app components"

Triggered when the user right-clicks an Application Application Point and chooses "Add with app components".

### 4.1 Steps:

1. Add Application Application Point as parent (if not already present).

2. Find all App Components whose:
   app_component.application_id == this_application.id
   Each App Component is represented as an Application Point of kind = APP_COMPONENT.

3. Add each App Component as a child inside the parent's box:
   - parent_node_id = <application_point_node_id>.
   - Child boxes stack vertically with 5px spacing, identical to business processes.

4. Height of each child box:
   - Determined by its text content and internal padding, as previously defined.

### 4.2 Parent box sizing:
- Exactly identical algorithm as "Add with business processes":
  width = 5px padding + max(child.width) + 5px padding
  height = padding + parent label height + padding + sum(child heights + 5px gaps)

Thus both features share the same layout engine but differ in what children they pull from the meta-model.

### 4.3 JSON updates:
- Add Application parent + App Component children to diagrams[].diagram_nodes.
- Save JSON preserves this hierarchy.

---

## 5) Context menu refresh & palette update after Add/Delete

After performing any of the following actions:
- Add
- Delete
- Add with business processes
- Add with app components

The palette panel must refresh so that:
- Items that were added now show "Delete" instead of "Add".
- Items that were deleted now show "Add" again.

This requires checking diagrams[].diagram_nodes to determine whether an entity has representation on the current diagram.

---

## 6) Error handling & edge cases

- If the Application Point is already on the diagram but the child items are not:
  - "Add with business processes" or "Add with app components" still adds ONLY the missing children.
  - Parent is not duplicated.

- If some child items already exist:
  - Add only the missing ones.
  - Layout should recompute so parent resizes correctly to encompass all children.

- If the user tries to "Add" something already on the diagram:
  - Option may be disabled or hidden; spec requires at least:
    - "Add" only appears if the entity is NOT already on the diagram.

---

## 7) Acceptance criteria

- Right-clicking on any palette item opens a custom context menu (not browser default).
- All items have Add/Delete, depending on presence on diagram.
- Application Point (kind = APPLICATION) items have TWO additional menu actions:
  - "Add with business processes"
  - "Add with app components"
- Both features add the parent + children with stacked layout and correct padding rules.
- Parent box auto-sizes according to children.
- JSON updates correctly, and Save/Load reproduces the layout.
- Palette updates to reflect what is on/off the diagram after each action.
