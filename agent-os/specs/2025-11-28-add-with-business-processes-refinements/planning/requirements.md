# Add with Business Processes Refinements - Requirements

## Overview
Refine the existing "Add with business processes" behaviour for Application nodes in the Diagram view. Three specific improvements to the current feature:
1. Application label styling (top-aligned and bold)
2. Process box height calculation with precise padding
3. Placement centered in the visible canvas viewport

---

## 1) Application label styling: top-aligned and bold by default

### Current behaviour
- When the user right-clicks an Application in the right-hand palette and chooses "Add with business processes", the tool:
  - Creates an Application diagram_node (parent) and
  - Creates child Business Process diagram_nodes stacked inside it.

### Required change
- For the **Application parent node** created (or updated) by "Add with business processes":
  - Its label styling should be:
    - text_v_align = "TOP"
    - text_font_weight = "bold" (or equivalent bold weight)
  - This should be applied whenever the Application node is generated/laid out by this feature:
    - If the Application node is newly created → set both properties explicitly.
    - If the Application node already exists and we are only adding child processes, we should:
      - Ensure it also has:
        - text_v_align = "TOP"
        - text_font_weight = "bold"
      - (We can treat this as the canonical style for "Application as parent container".)

### Layout interaction
- The Application name remains rendered in the top "header" area of the box.
- The children (process boxes) are still stacked beneath that header section as before.

---

## 2) Process box height calculation with precise padding

### Current behaviour (approximation)
- Child business process boxes have some height derived from text, but there may be extra margins or inconsistent padding.

### Required behaviour
- For each child **Business Process diagram_node** added by "Add with business processes":
  - The node height must be:

    ```
    process_height = 5px (top padding)
                    + process_text_height
                    + 5px (bottom padding)
    ```

- `process_text_height`:
  - Use the existing text measurement / line-wrapping logic used elsewhere for auto-size to compute the text height for the process label (based on font size, wrapping width, etc.).

- No additional vertical padding or magic numbers beyond:
  - 5px top
  - text height
  - 5px bottom

### Parent Application height
Parent Application height must be recomputed to accommodate the new precise heights:

Let:
- `app_text_height` = height of Application label text.
- `child_heights_sum` = sum of all process_height values.
- `vertical_gaps_sum` = 5px * (number_of_processes)   // one gap below each process, consistent with previous spec.

Then:

```
application_height =
  5px (padding above app name)
  + app_text_height
  + 5px (padding below app name)
  + child_heights_sum
  + vertical_gaps_sum
```

This ensures:
- Each process box fits its text tightly with the defined padding.
- The Application container box grows or shrinks exactly to fit its children.

---

## 3) Placement: add new group in the centre of the visible canvas

### Current behaviour
- When using "Add with business processes", the Application + children group is added at a fixed position that may be outside the current viewport (e.g. below the visible area if the canvas is large and scrolled).

### Required behaviour
- New nodes created by "Add with business processes" must be positioned relative to the **current visible viewport** of the diagram canvas.

### Viewport concept
- The diagram canvas has:
  - A scroll offset (scrollX, scrollY).
  - A visible width and height (viewportWidth, viewportHeight).
- The "visible centre" point is:

  ```
  visibleCenterX = scrollX + (viewportWidth  / 2)
  visibleCenterY = scrollY + (viewportHeight / 2)
  ```

### Placement rules

1) Compute the total bounding box of the Application group:
   - width = application_width (computed per spec, including children)
   - height = application_height (computed per spec, including header + children)

2) Place the Application node so that this bounding box is visually centered in the visible area:

   ```
   application_pos_x = visibleCenterX - (application_width  / 2)
   application_pos_y = visibleCenterY - (application_height / 2)
   ```

3) Child processes:
   - Use the existing stacking logic, but base all child positions on the new application_pos_x and application_pos_y.

### Additional considerations
- If the Application node already exists and only new children are being added:
  - For v0.x it is acceptable to **leave the existing Application position unchanged** and only adjust its height/children as per the new sizing rules.
  - The centering behaviour is primarily for the case where the Application node is created for the first time in that diagram.

---

## Acceptance criteria

- When "Add with business processes" is used on an Application:
  - The Application label is bold and top-aligned in its box.
  - Each process box's height matches exactly: 5px padding + text height + 5px padding.
  - The Application container height adjusts exactly to fit the header plus all processes and gaps.
- When adding a new Application + processes to an otherwise empty or new diagram:
  - The group appears centered in the currently visible area of the canvas, not off-screen.
- Existing Application nodes that are augmented via "Add with business processes" adopt the new label styling (top-aligned, bold) and new child height logic without layout glitches.
