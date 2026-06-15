name: diagrams-toolbar-ux-refresh
summary: Replace the existing Diagram selector + inline New/Copy inputs with a single-line "Search + Actions" toolbar using an advanced grouped autocomplete selector and modal-driven New/Copy/Rename/Delete flows.

motivation:
- Current toolbar does not scale when many diagrams exist (flat select list).
- Inline "New Diagram name + type + button" clutters the header row.
- Copy/Rename/Delete need explicit, safe workflows (modals / confirmation).
- Align selector UX with the existing grouped typeahead pattern used in ApplicationPointPickerCell.

in_scope:
- Frontend-only change (React/TS) within Diagrams view.
- Replace DiagramSelector toolbar UI with: Search: [Grouped autocomplete selector] [New] [Copy] [Rename] [Delete]
- Add 3 modals (New/Copy/Rename) and 1 confirmation dialog (Delete).
- Implement grouped, typable autocomplete selector where results are grouped by DiagramType enum values.
- Disable action buttons until a diagram is loaded/selected (Copy/Rename/Delete disabled if none).
- Ensure all actions reuse validateDiagramName to prevent duplicates/invalid names.

out_of_scope:
- Backend / persistence changes.
- Diagram content editing behavior.
- Changes to period/zoom/export controls outside the diagram selection/action area.
