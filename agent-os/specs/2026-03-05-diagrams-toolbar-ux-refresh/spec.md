# Specification: Diagrams Toolbar UX Refresh

## 1. Overview

Replace the existing flat `<select>` diagram selector and inline New/Copy input controls in the Diagrams View toolbar with a single-line toolbar composed of a grouped autocomplete selector and four modal-driven action buttons (New, Copy, Rename, Delete). This is a frontend-only change within the React/TypeScript codebase.

## 2. Motivation

- The current flat `<select>` dropdown does not scale when many diagrams exist; users cannot search or filter.
- The inline "New Diagram name + type dropdown + button" and "Copy" button clutter the header row and mix creation concerns into the selector area.
- Copy, Rename, and Delete need explicit, safe workflows via modals and confirmation dialogs to prevent accidental data loss.
- A grouped typeahead pattern already exists in `ApplicationPointPickerCell` and should be reused for consistency across the application.

## 3. Scope

### In Scope
- Frontend-only change (React/TypeScript) within the Diagrams View toolbar (Row 1).
- Replace the `DiagramSelector` component with a new toolbar layout: `Search: [Grouped Autocomplete] [New] [Copy] [Rename] [Delete]`.
- Three modals: New Diagram, Copy Diagram, Rename Diagram.
- One confirmation dialog: Delete Diagram.
- New `DELETE_DIAGRAM` reducer action in `ArchitectureContext`.
- Button enable/disable rules based on diagram selection state.
- Validation using the existing `validateDiagramName` utility.

### Out of Scope
- Backend / persistence changes.
- Diagram content editing behavior.
- Changes to period/zoom/export controls outside the diagram selection/action area.
- Keyboard shortcuts beyond basic combobox behavior (Escape to close, Enter to select).
- Drag-to-reorder diagrams.
- Batch operations on diagrams.

## 4. Requirements

### 4.1 Toolbar Layout

The existing `diagramSelectionSection` in Row 1 of `DiagramsView.tsx` (line 2048) currently renders a "Diagram:" label followed by the `<DiagramSelector />` component. This entire section must be replaced with a single horizontal row:

```
Search: [Grouped Autocomplete Input] [New] [Copy] [Rename] [Delete]
```

- "Search:" is a visible text `<label>` (not a placeholder), styled with the existing `selectorLabel` class pattern (font-size 14px, font-weight 500, color #333).
- The four action buttons use the existing `Button` component (`frontend/src/components/common/Button.tsx`) with `variant="secondary"`.
- The entire section remains inside `diagramSelectionSection` with `display: flex; align-items: center; gap: 12px`.
- The vertical divider after the section and the period/zoom/export sections are unchanged.

### 4.2 Grouped Autocomplete Selector

A new component that replaces the flat `<select>` dropdown. It follows the grouped typeahead pattern established in `ApplicationPointPickerCell` (lines 207-509 of `frontend/src/components/Grid/ApplicationPointPickerCell.tsx`).

**Activation:**
- Clicking anywhere on the selector input opens the dropdown immediately, showing all diagrams grouped by `DiagramType`.
- No separate dropdown arrow button is needed.

**Grouping:**
- Diagrams are grouped by their `diagram_type` field using the 7 values from the `DiagramType` union type: `General`, `ER`, `Sequence`, `Activity`, `State`, `UI_Workflow`, `UI_SCREEN`.
- Group headers display the human-readable labels from `DIAGRAM_TYPE_LABELS` (e.g., "UI Workflow", "UI Screen").
- Group header styling follows the inline style pattern from `ApplicationPointPickerCell` (lines 544-555): `padding: 6px 12px`, `fontSize: 11px`, `fontWeight: 600`, `color: #666`, `backgroundColor: #f0f0f0`, `borderBottom: 1px solid #ddd`, `textTransform: uppercase`, `letterSpacing: 0.5px`.
- Groups with zero matching diagrams are hidden entirely.

**Filtering:**
- Typing in the input filters results live via case-insensitive substring match on `diagram.name`.
- Filtering uses the same pattern as `ApplicationPointPickerCell` (line 225): `const search = searchText.toLowerCase()` then `.filter(d => d.name.toLowerCase().includes(search))`.

**Selection:**
- Selecting a diagram from the dropdown dispatches `SELECT_DIAGRAM` with the diagram's `id`.
- The input displays the name of the currently selected diagram when not actively searching.

**Keyboard:**
- `Escape` closes the dropdown without changing selection.
- `Enter` selects the first visible result in the filtered list (same as `ApplicationPointPickerCell` line 506-508).

**Click-outside:**
- Clicking outside the component closes the dropdown (same `handleClickOutside` pattern as `ApplicationPointPickerCell` lines 413-422).

**Empty state:**
- When `state.model.diagrams.length === 0`, the input is disabled and shows placeholder text "No diagrams defined".

### 4.3 New Diagram Modal

- **Title:** "Create New Diagram"
- **Fields:**
  - "Diagram Name" - text input, starts empty, autofocused.
  - "Diagram Type" - `<select>` dropdown populated from `ALL_DIAGRAM_TYPES` with labels from `DIAGRAM_TYPE_LABELS`. Default value: `DEFAULT_DIAGRAM_TYPE` (`'General'`).
- **Buttons:** "Create" (primary) / "Cancel" (secondary).
- **Validation:** On Create click, trim the name and call `validateDiagramName(trimmedName, state.model.diagrams)`. If validation returns an error string, display it inline below the name input (red, font-size 12px, matching the existing `.validationError` class pattern). Block submission until valid.
- **On success:**
  1. Generate a new ID via `generatePrefixedId('diag')` (produces format `diag-{timestamp36}-{random5}`).
  2. Construct a `Diagram` object: `{ id, name: trimmedName, description: '', diagram_type: selectedType, settings: {}, diagram_nodes: [], diagram_edges: [] }`.
  3. Dispatch `{ type: 'ADD_DIAGRAM', payload: newDiagram }`. The existing `ADD_DIAGRAM` reducer (line 1853) already auto-selects the new diagram and initializes `view_quarter` and `decorations`.
  4. Close the modal.
- **Always enabled** regardless of current selection state.

### 4.4 Copy Diagram Modal

- **Title:** "Copy Diagram"
- **Fields:**
  - "Copied Diagram New Name" - text input, pre-populated with `"[selectedDiagram.name] (Copy)"`.
- **Buttons:** "Create" (primary) / "Cancel" (secondary).
- **Only enabled** when `selectedDiagramId` is set and diagrams list is non-empty.
- **Validation:** Same as New - `validateDiagramName(trimmedName, state.model.diagrams)`.
- **On success:**
  1. Deep copy the currently selected diagram via `JSON.parse(JSON.stringify(selectedDiagram))` (same pattern as existing `handleCopyDiagram` at line 95 of `DiagramSelector.tsx`).
  2. Assign new `id` via `generatePrefixedId('diag')`.
  3. Set `name` to the user-provided trimmed name.
  4. Preserve the original `diagram_type` from the source diagram.
  5. Dispatch `{ type: 'ADD_DIAGRAM', payload: copiedDiagram }`.
  6. Close the modal.

### 4.5 Rename Diagram Modal

- **Title:** "Rename Diagram"
- **Fields:**
  - "Diagram New Name" - text input, pre-populated with the current `selectedDiagram.name`.
- **Buttons:** "Rename" (primary) / "Cancel" (secondary).
- **Only enabled** when `selectedDiagramId` is set and diagrams list is non-empty.
- **Validation:**
  1. Name must not be empty (standard `validateDiagramName` check).
  2. If the trimmed name is identical to the current diagram name, block with message: "The new name is the same as the current name." This is a separate check that runs before `validateDiagramName` to provide a specific message.
  3. `validateDiagramName(trimmedName, state.model.diagrams)` must pass (catches duplicates with other diagrams).
- **On success:**
  1. Dispatch `{ type: 'UPDATE_DIAGRAM', diagramId: selectedDiagram.id, updates: { name: trimmedName } }`. The existing `UPDATE_DIAGRAM` reducer (line 1875) merges the `updates` into the diagram.
  2. Close the modal.

### 4.6 Delete Diagram Confirmation

- **Only enabled** when `selectedDiagramId` is set and diagrams list is non-empty.
- **Message:** "Are you sure you want to permanently delete this diagram?"
- **Buttons:** "Delete" (danger/red variant) / "Cancel" (secondary).
- **Escape key** and **overlay click** dismiss the dialog (same pattern as `DeleteDiagramElementModal` lines 34-53).
- **On confirm:**
  1. Dispatch `{ type: 'DELETE_DIAGRAM', payload: selectedDiagramId }`.
  2. The reducer handles fallback selection (see 4.7).
  3. Close the dialog.

### 4.7 DELETE_DIAGRAM Reducer Action

A new action type added to the `AppAction` union in `ArchitectureContext.tsx`.

**Action shape:**
```typescript
| { type: 'DELETE_DIAGRAM'; payload: string }  // payload is the diagram ID to delete
```

**Reducer logic:**
1. Filter out the diagram with `id === action.payload` from `state.model.diagrams`.
2. Determine the new `selectedDiagramId` using fallback logic:
   - Find the index of the deleted diagram in the original array.
   - If there are remaining diagrams and the deleted index is within bounds, select the diagram at the same index (or the last remaining if the deleted was at the end).
   - If no diagrams remain, set `selectedDiagramId` to `null`.
3. Return updated state with the filtered diagrams array and new selection.

### 4.8 Disabled States

- **New button:** Always enabled.
- **Copy button:** Disabled when `!selectedDiagramId` or `state.model.diagrams.length === 0`.
- **Rename button:** Disabled when `!selectedDiagramId` or `state.model.diagrams.length === 0`.
- **Delete button:** Disabled when `!selectedDiagramId` or `state.model.diagrams.length === 0`.
- The `disabled` prop is passed directly to the `Button` component, which applies `opacity: 0.5; cursor: not-allowed` via `Button.module.css` line 11-14.

## 5. Technical Design

### 5.1 New Files

| File | Description |
|------|-------------|
| `frontend/src/components/DiagramsView/DiagramAutocomplete.tsx` | Grouped autocomplete selector component. Manages `isEditing`, `searchText`, `showDropdown` state. Renders grouped diagram list with `DIAGRAM_TYPE_LABELS` headers. |
| `frontend/src/components/DiagramsView/DiagramAutocomplete.module.css` | Styles for the autocomplete: container, input, dropdown, group headers, option rows, no-results message. Follow the typeahead visual pattern from `Grid.module.css` lines 194-246. |
| `frontend/src/components/DiagramsView/modals/NewDiagramModal.tsx` | Modal for creating a new diagram. Contains name input, type dropdown, validation display, Create/Cancel buttons. |
| `frontend/src/components/DiagramsView/modals/NewDiagramModal.module.css` | Styles for New Diagram modal. Follow `DeleteDiagramElementModal.module.css` pattern (overlay, modal, header, content, footer, button variants). |
| `frontend/src/components/DiagramsView/modals/CopyDiagramModal.tsx` | Modal for copying a diagram. Contains pre-populated name input, validation display, Create/Cancel buttons. |
| `frontend/src/components/DiagramsView/modals/CopyDiagramModal.module.css` | Styles for Copy Diagram modal. Same pattern as NewDiagramModal. |
| `frontend/src/components/DiagramsView/modals/RenameDiagramModal.tsx` | Modal for renaming a diagram. Contains pre-populated name input, same-name check, validation display, Rename/Cancel buttons. |
| `frontend/src/components/DiagramsView/modals/RenameDiagramModal.module.css` | Styles for Rename Diagram modal. Same pattern as NewDiagramModal. |
| `frontend/src/components/DiagramsView/modals/DeleteDiagramConfirmModal.tsx` | Confirmation dialog for deleting a diagram. Contains warning message, Delete (danger)/Cancel buttons. |
| `frontend/src/components/DiagramsView/modals/DeleteDiagramConfirmModal.module.css` | Styles for Delete Diagram confirmation. Follow `DeleteDiagramElementModal.module.css` pattern with danger button styling. |

### 5.2 Modified Files

| File | Changes |
|------|---------|
| `frontend/src/components/DiagramsView/DiagramSelector.tsx` | Gutted and replaced entirely. The component now renders the new toolbar layout: `DiagramAutocomplete` + four `Button` components + modal state management (`useState<boolean>` for each modal's open state). All modal open/close handlers and action callbacks live here. |
| `frontend/src/components/DiagramsView/DiagramsView.module.css` | Remove obsolete styles: `.newDiagramLabel`, `.diagramInput`, `.diagramTypeSelector`. Add any new styles needed for the autocomplete container width or toolbar spacing adjustments. The `.selectorContainer` class may be kept but simplified. |
| `frontend/src/contexts/ArchitectureContext.tsx` | Add `DELETE_DIAGRAM` to the `AppAction` union type (after line 191). Add the `DELETE_DIAGRAM` case to the `appReducer` switch (after the `ADD_DIAGRAM` case at line 1870). |

### 5.3 Component Architecture

```
DiagramsView.tsx
  toolbarRow1
    diagramSelectionSection
      label "Diagram:"
      DiagramSelector (refactored)
        DiagramAutocomplete (new)
        Button "New"
        Button "Copy" (disabled when no selection)
        Button "Rename" (disabled when no selection)
        Button "Delete" (disabled when no selection)
        NewDiagramModal (conditional)
        CopyDiagramModal (conditional)
        RenameDiagramModal (conditional)
        DeleteDiagramConfirmModal (conditional)
    verticalDivider
    periodSection
    verticalDivider
    zoomSection
```

Data flow:
- `DiagramSelector` reads `state.model.diagrams`, `state.selectedDiagramId` from `useArchitecture()`.
- `DiagramSelector` dispatches `SELECT_DIAGRAM`, `ADD_DIAGRAM`, `UPDATE_DIAGRAM`, `DELETE_DIAGRAM` via `useArchitectureDispatch()`.
- `DiagramAutocomplete` receives `diagrams`, `selectedDiagramId`, and an `onSelect` callback as props from `DiagramSelector`.
- Each modal receives `isOpen`, `onClose`, and an `onSubmit`/`onConfirm` callback as props from `DiagramSelector`.

### 5.4 State Management

**Local state in DiagramSelector:**
- `showNewModal: boolean` - controls New Diagram modal visibility.
- `showCopyModal: boolean` - controls Copy Diagram modal visibility.
- `showRenameModal: boolean` - controls Rename Diagram modal visibility.
- `showDeleteConfirm: boolean` - controls Delete confirmation dialog visibility.

**Local state in DiagramAutocomplete:**
- `searchText: string` - current search/filter text.
- `showDropdown: boolean` - whether the dropdown is visible.
- `inputRef: React.RefObject<HTMLInputElement>` - for focus management.
- `containerRef: React.RefObject<HTMLDivElement>` - for click-outside detection.

**Local state in each modal:**
- `name: string` - the name input value (managed locally within the modal).
- `diagramType: DiagramType` - the type dropdown value (New modal only).
- `validationError: string | null` - inline validation error message.

**Context state changes (ArchitectureContext):**
- `ADD_DIAGRAM` (existing, line 1853): Appends diagram, auto-selects it.
- `UPDATE_DIAGRAM` (existing, line 1875): Merges updates into diagram by `diagramId`.
- `SELECT_DIAGRAM` (existing, line 498): Sets `selectedDiagramId`.
- `DELETE_DIAGRAM` (new): Removes diagram, applies fallback selection.

### 5.5 Styling Approach

- All new components use CSS Modules (`.module.css` files), consistent with the entire codebase.
- Modal styling follows the established pattern in `DeleteDiagramElementModal.module.css`: overlay with `position: fixed; z-index: 1000`, modal card with `border-radius: 8px; box-shadow`, header/content/footer sections.
- Button colors: primary (#1976D2), secondary (white/#f5f5f5), danger (#d32f2f) - matching `Button.module.css`.
- Autocomplete dropdown styling is based on `Grid.module.css` typeahead classes (lines 194-246): white background, border, border-radius 4px, box-shadow, max-height with overflow-y auto.
- Validation error text uses `color: #d32f2f; font-size: 12px` matching the existing `.validationError` class in `DiagramsView.module.css` line 546-552.
- Form inputs in modals use `padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px` matching the existing `.diagramInput` pattern.

## 6. Acceptance Criteria

1. The flat `<select>` diagram dropdown is replaced with a grouped autocomplete input that shows all diagrams organized by `DiagramType` group headers.
2. Typing in the autocomplete input filters diagrams by name (case-insensitive substring match) and hides groups with zero matches.
3. Selecting a diagram from the autocomplete dropdown updates the selected diagram (dispatches `SELECT_DIAGRAM`).
4. Pressing Escape closes the autocomplete dropdown; pressing Enter selects the first visible match.
5. Clicking outside the autocomplete dropdown closes it.
6. The "New" button opens a modal with an empty name field and a type dropdown defaulting to "General".
7. Creating a new diagram validates the name via `validateDiagramName`, generates an ID via `generatePrefixedId('diag')`, dispatches `ADD_DIAGRAM`, and auto-selects the new diagram.
8. The "Copy" button is disabled when no diagram is selected and opens a modal with the name pre-populated as `"[OriginalName] (Copy)"` when enabled.
9. Copying a diagram deep-copies the selected diagram (including all nodes, edges, decorations), assigns a new ID, preserves the original `diagram_type`, and dispatches `ADD_DIAGRAM`.
10. The "Rename" button is disabled when no diagram is selected and opens a modal pre-populated with the current diagram name when enabled.
11. Renaming validates the name, blocks same-name renames with a specific message, and dispatches `UPDATE_DIAGRAM` with `{ name: newName }`.
12. The "Delete" button is disabled when no diagram is selected and opens a confirmation dialog when enabled.
13. Confirming deletion dispatches `DELETE_DIAGRAM`, which removes the diagram and auto-selects the next sensible diagram (next by index, or first remaining, or null if empty).
14. The `DELETE_DIAGRAM` action is properly added to the `AppAction` type union and handled in the `appReducer`.
15. When no diagrams exist, the autocomplete shows "No diagrams defined" and is disabled; Copy, Rename, and Delete buttons are disabled; only New is enabled.
16. All modals support Escape key to close, overlay click to close, and have a close (x) button in the header.
17. Validation errors in modals are displayed inline in red below the input field and clear when the user modifies the input.

## 7. Implementation Notes

- **Typeahead pattern:** Follow `ApplicationPointPickerCell` (lines 207-509 of `frontend/src/components/Grid/ApplicationPointPickerCell.tsx`) for state management (`isEditing`, `searchText`, `showDropdown`), grouped option building, group header rendering, keyboard handling, and click-outside detection. The key difference is that the diagram autocomplete activates on single click (not double-click) and groups by `DiagramType` instead of `OptionGroup`.
- **Modal pattern:** Follow `DeleteDiagramElementModal` (lines 1-127 of `frontend/src/components/DiagramsView/modals/DeleteDiagramElementModal.tsx`) for the modal structure: `useEffect` for Escape key binding, `handleOverlayClick` with `e.target === e.currentTarget` guard, header/content/footer layout, and `isOpen` guard returning null.
- **Validation:** Reuse `validateDiagramName` from `frontend/src/utils/validation.ts` (lines 901-917). For Rename, add a same-name check before calling `validateDiagramName`: `if (trimmedName === currentDiagram.name) return 'The new name is the same as the current name.'`.
- **ID generation:** Use `generatePrefixedId('diag')` from `frontend/src/utils/idGenerator.ts` (lines 11-15), which produces IDs in the format `diag-{base36timestamp}-{random5chars}`.
- **Type alignment:** Import `DiagramType`, `ALL_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS`, `DEFAULT_DIAGRAM_TYPE` from `frontend/src/types/diagramType.ts`. The `Diagram` interface (`frontend/src/types/model.ts` line 2006) has `diagram_type?: string`, so the grouping logic must use `getDiagramType(diagram)` (from `diagramType.ts` line 119) which normalizes and defaults to `'General'`.
- **Deep copy for Copy:** Use `JSON.parse(JSON.stringify(selectedDiagram))` as established in the existing `handleCopyDiagram` (line 95 of `DiagramSelector.tsx`). This creates a full deep copy including all diagram_nodes, diagram_edges, decorations, label_decorations, and typedContent.
- **ADD_DIAGRAM reducer:** The existing reducer at line 1853 of `ArchitectureContext.tsx` already handles setting `selectedDiagramId` to the new diagram's ID and initializing `view_quarter`, `decorations`, and `label_decorations` defaults. No changes needed to this action.
- **UPDATE_DIAGRAM reducer:** The existing reducer at line 1875 merges `action.updates` into the diagram. Passing `{ name: newName }` will update only the name field.
- **DELETE_DIAGRAM fallback selection:** Implemented in the new reducer case. Find the index of the deleted diagram, filter it out, then select: `remainingDiagrams[Math.min(deletedIndex, remainingDiagrams.length - 1)]?.id ?? null`.
