# Advanced Add – add "Spacing" presets (Spacious, Normal, Tight) to control layout constants

## Summary

The Advanced Add hierarchical layout is now working, but uses a single fixed set of spacing constants. Introduce a "Spacing" dropdown in the Advanced Add dialog to let the user choose between three layout density presets: "Spacious", "Normal", and "Tight". The chosen preset controls the padding, gap, and minimum height constants used by the recursive layout algorithm (measure + assignPositions), so that the diagram is drawn more spread out or more compact without changing the logical hierarchy.

## Scope

- UI: Add a "Spacing" dropdown to the Advanced Add dialog.
- Layout: Parameterise the existing layout algorithm to use spacing presets.
- Behaviour: Use the selected spacing when computing sizes and positions for the nodes created by Advanced Add.

## Out of scope

- Any change to the structure or content of the Advanced Add tree itself.
- Non–Advanced-Add layouts or other layout modes (they may continue to use fixed constants or later adopt the same presets in a separate change).
