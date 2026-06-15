# Task Breakdown: Diagram View UI Layout Reorganisation

## Overview

**Total Tasks:** 22 tasks across 4 task groups

**Feature Summary:** Reorganise the Diagram view UI layout to consolidate styling controls into a new second row of the top toolbar, move decoration tools to the left panel, and introduce clear visual separation between toolbar sections. This is a UI-only change with no behavioural modifications.

**Design Principle:** UI reorganisation only - all existing functionality, data model, handlers, and interaction patterns remain unchanged.

## Files to Modify

| File | Purpose | Task Group |
|------|---------|------------|
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | Main layout - add Row 2, restructure panels | 1, 2, 3, 4 |
| `frontend/src/components/DiagramsView/DiagramsView.module.css` | Add Row 2 styles, vertical dividers, update panel styles | 1, 2, 3, 4 |
| `frontend/src/components/DiagramsView/InspectorPanel.tsx` | Extract styling controls, convert to left panel decorations panel | 2, 3 |
| `frontend/src/components/DiagramsView/InspectorPanel.module.css` | Update styles for new left panel layout | 3 |
| `frontend/src/components/DiagramsView/DecorationsPanel.tsx` | Move content to left panel, update layout | 3, 4 |
| `frontend/src/components/DiagramsView/DecorationsPanel.module.css` | Update styles for left panel integration | 3, 4 |

## Task List

---

### UI Layer - Top Toolbar

#### Task Group 1: Row 1 Structure and Vertical Dividers
**Dependencies:** None

- [x] 1.0 Complete Row 1 toolbar restructure with vertical dividers
  - [x] 1.1 Write 4-6 focused tests for Row 1 layout
    - Test Row 1 contains diagram selection section
    - Test Row 1 contains new diagram controls section
    - Test Row 1 contains period/time controls section
    - Test Row 1 contains zoom controls section
    - Test vertical dividers render after New/Copy section
    - Test vertical dividers render after Period section
  - [x] 1.2 Update DiagramsView.tsx header structure for Row 1
    - Wrap existing headerBar content in explicit Row 1 container
    - Organise controls into four logical sections: Diagram Selection, New Diagram, Period, Zoom
    - Ensure all existing controls remain functional (no logic changes)
  - [x] 1.3 Create CSS for vertical dividers
    - Add `.verticalDivider` class with thin grey border styling
    - Ensure consistent height within row
    - Add vertical dividers after New/Copy section and after Period section
  - [x] 1.4 Update Row 1 CSS layout
    - Add `.toolbarRow1` container class
    - Ensure proper flex layout and spacing between sections
    - Add section wrapper classes for logical groupings
  - [x] 1.5 Ensure Row 1 tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all controls remain visible and functional
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Row 1 displays diagram selection dropdown with "Diagram:" label
- Row 1 displays new diagram input, [+ New] button, [+ Copy] button
- Vertical divider appears after New/Copy section
- Row 1 displays Period dropdown, < button, period label, > button
- Vertical divider appears after Period section
- Row 1 displays zoom controls ([+], percentage, [-], [Fit to View])
- All existing functionality unchanged

---

#### Task Group 2: Row 2 Styling Controls Toolbar
**Dependencies:** Task Group 1 (COMPLETED)

- [x] 2.0 Complete Row 2 styling toolbar implementation
  - [x] 2.1 Write 4-6 focused tests for Row 2 layout
    - Test Row 2 only visible in Diagram view (not Meta-model view)
    - Test Row 2 contains Font Size section with controls
    - Test Row 2 contains Font Styles section with B, I, U toggles
    - Test Row 2 contains Box Alignment section with H and V controls
    - Test Row 2 contains Colour section with three colour pickers
    - Test vertical dividers render between sections
  - [x] 2.2 Create ToolbarRow2 component or section in DiagramsView
    - Extract styling logic from InspectorPanel (copy handlers, do not move yet)
    - Create Row 2 container with Font Size, Font Styles, Box Alignment, Colour sections
    - Wire existing handlers to new control locations
    - Reference existing InspectorPanel.tsx for handler patterns (lines 580-912)
  - [x] 2.3 Implement Font Size section in Row 2
    - Label: "FONT SIZE" (uppercase)
    - Controls: [-] button, numeric input, [+] button, "px" label
    - Wire to existing font size handlers from InspectorPanel
  - [x] 2.4 Implement Font Styles section in Row 2
    - Label: "FONT STYLES" (uppercase)
    - Three toggle buttons: [B] bold, [I] italic, [U] underline
    - Highlight active states
    - Wire to existing font style handlers from InspectorPanel
    - Vertical divider after this section
  - [x] 2.5 Implement Box Alignment section in Row 2
    - Label: "BOX ALIGNMENT" (uppercase)
    - Horizontal alignment subgroup (H:): [L] left, [C] center, [R] right
    - Vertical alignment subgroup (V:): [T] top, [M] middle, [B] bottom
    - Radio-button behaviour (one active per subgroup)
    - Wire to existing alignment handlers from InspectorPanel
    - Vertical divider after this section
  - [x] 2.6 Implement Colour section in Row 2
    - Label: "COLOUR" (uppercase)
    - Three colour picker buttons with icons:
      1. Background colour (filled square icon)
      2. Line colour (square outline icon)
      3. Text colour ("A" letter icon)
    - Wire to existing colour handlers from InspectorPanel
  - [x] 2.7 Add Row 2 CSS styles
    - Add `.toolbarRow2` container class
    - Add section styles for each control group
    - Add vertical divider styles matching Row 1
    - Ensure Row 2 visibility toggle based on view type
  - [x] 2.8 Ensure Row 2 tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify styling controls apply to selection correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Row 2 only visible in Diagram view
- FONT SIZE section with [-], input, [+], px label - functional
- Vertical divider after Font Size
- FONT STYLES section with [B], [I], [U] toggles - functional
- Vertical divider after Font Styles
- BOX ALIGNMENT section with H: [L][C][R] and V: [T][M][B] - functional
- Vertical divider after Alignment
- COLOUR section with three colour pickers - functional
- All styling controls apply to current selection as before

---

### UI Layer - Left and Bottom Panels

#### Task Group 3: Left Panel Reorganisation
**Dependencies:** Task Group 2 (COMPLETED)

- [x] 3.0 Complete left panel reorganisation
  - [x] 3.1 Write 4-6 focused tests for left panel layout
    - Test left panel no longer shows Inspector styling controls
    - Test left panel shows Decorations section header
    - Test left panel shows Add Box button
    - Test left panel shows Add Line button
    - Test Decoration text editor visible when single decoration selected
    - Test Decoration tools work correctly (mode toggling)
  - [x] 3.2 Remove styling controls from InspectorPanel
    - Remove Font Size section (now in Row 2)
    - Remove Font Styles section (now in Row 2)
    - Remove Box Alignment section (now in Row 2)
    - Remove Colour section (now in Row 2)
    - Keep panel structure and collapse/expand functionality
    - Rename component or repurpose for Decorations panel
  - [x] 3.3 Move Decoration tools to left panel
    - Add "Decorations" section header
    - Add [Add Box] button with box icon
    - Add [Add Line] button with diagonal line icon
    - Wire to existing decoration add mode handlers
    - Reference DecorationsPanel.tsx for button implementation (lines 134-170)
  - [x] 3.4 Move Decoration text editor to left panel
    - Add "Decoration Text" subsection
    - Add textarea for decoration.text editing
    - Only visible when single decoration selected
    - Wire to existing onUpdateDecorationText handler
    - Reference DecorationsPanel.tsx for text editor (lines 174-184)
  - [x] 3.5 Update left panel CSS styles
    - Update InspectorPanel.module.css for new layout
    - Style Decorations section header
    - Style Add Box and Add Line buttons
    - Style Decoration text editor section
    - Ensure consistent styling with existing panels
  - [x] 3.6 Ensure left panel tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify decoration tools work as before
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Left panel does not show any styling controls (Font Size, Font Styles, Alignment, Colour)
- Left panel shows "Decorations" section with Add Box and Add Line buttons
- Add Box button enters BOX decoration mode when clicked
- Add Line button enters LINE decoration mode when clicked
- Decoration text editor visible only when single decoration selected
- Text editing updates decoration.text and re-renders label
- All decoration functionality works exactly as before

---

#### Task Group 4: Bottom Panel Cleanup
**Dependencies:** Task Group 3 (COMPLETED)

- [x] 4.0 Complete bottom panel cleanup
  - [x] 4.1 Write 2-4 focused tests for bottom panel state
    - Test bottom panel component structure remains in place
    - Test bottom panel contains no decoration tools
    - Test bottom panel is empty or shows placeholder
  - [x] 4.2 Remove decoration content from DecorationsPanel
    - Remove Add Decorations section (now in left panel)
    - Remove Decoration text editor section (now in left panel)
    - Keep component structure intact for future use
    - Keep collapse/expand functionality
  - [x] 4.3 Update bottom panel to empty/placeholder state
    - Remove or hide content
    - Optionally show placeholder text or leave empty
    - Do NOT remove the component entirely
  - [x] 4.4 Update DiagramsView.tsx panel arrangement
    - Ensure DecorationsPanel renders as empty bottom panel
    - Ensure left panel (now with decorations) renders correctly
    - Verify layout with all panels in place
  - [x] 4.5 Update bottom panel CSS
    - Adjust DecorationsPanel.module.css for empty state
    - Maintain collapsed state styling
    - Keep panel structure for future repurposing
  - [x] 4.6 Ensure bottom panel tests pass
    - Run ONLY the 2-4 tests written in 4.1
    - Verify panel renders correctly in empty state
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Bottom panel component structure remains in DOM
- Bottom panel contains no decoration tools or content
- Bottom panel can show placeholder or remain hidden
- Bottom panel collapse/expand mechanism still functional
- Component ready for future repurposing

---

### Integration and Verification

#### Task Group 5: Integration Testing and Verification
**Dependencies:** Task Groups 1-4 (ALL COMPLETED)

- [x] 5.0 Complete integration testing and verification
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review 4-6 tests from Row 1 (Task 1.1) - 6 tests reviewed
    - Review 4-6 tests from Row 2 (Task 2.1) - 6 tests reviewed
    - Review 4-6 tests from Left Panel (Task 3.1) - 16 tests reviewed
    - Review 2-4 tests from Bottom Panel (Task 4.1) - 4 tests reviewed
    - Total existing tests: 32 tests
  - [x] 5.2 Analyse test coverage gaps for this feature
    - Focus on integration between Row 2 and selection state
    - Verify multi-select styling behaviour unchanged
    - Verify decoration creation workflow end-to-end
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 6 additional integration tests if needed
    - Test Row 2 styling controls apply to multi-select correctly
    - Test decoration add mode from left panel creates decorations on canvas
    - Test decoration text editor in left panel updates decoration correctly
    - Test view switching hides Row 2 appropriately
    - Skip edge cases and performance tests
  - [x] 5.4 Run all feature-specific tests
    - Run tests from Tasks 1.1, 2.1, 3.1, 4.1, and 5.3
    - Expected total: approximately 20-28 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass
  - [x] 5.5 Visual verification checklist
    - Verify full layout matches spec visual design
    - Verify vertical dividers appear in correct positions
    - Verify Row 2 visibility toggles correctly
    - Verify left panel shows decorations controls
    - Verify bottom panel is empty
    - Verify no regressions in existing functionality

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-28 tests total) - PASSED: 38 tests total
- Row 1 and Row 2 display correctly with proper dividers
- Left panel contains decorations tools and text editor
- Bottom panel is empty but structurally intact
- All styling controls in Row 2 function as before
- All decoration tools function as before
- No changes to JSON model or data handling
- Multi-select behaviour unchanged
- Visual layout matches spec design

---

## Execution Order

Recommended implementation sequence:

```
1. Task Group 1: Row 1 Structure and Vertical Dividers (Foundation) - COMPLETED
   |
   v
2. Task Group 2: Row 2 Styling Controls Toolbar (Depends on Row 1 structure) - COMPLETED
   |
   v
3. Task Group 3: Left Panel Reorganisation (Depends on Row 2 having styling controls) - COMPLETED
   |
   v
4. Task Group 4: Bottom Panel Cleanup (Depends on decorations moving to left panel) - COMPLETED
   |
   v
5. Task Group 5: Integration Testing and Verification (Final verification) - COMPLETED
```

## Important Notes

1. **No Behavioural Changes:** This is strictly a UI layout reorganisation. All handlers, state management, reducer actions, and data model interactions must remain unchanged.

2. **Extract, Don't Rewrite:** When moving styling controls from InspectorPanel to Row 2, extract the existing logic - do not rewrite it. Copy the handler functions and JSX structure.

3. **Preserve Handlers:** The following handlers must continue to work exactly as before:
   - Font size increase/decrease/input handlers
   - Font style toggle handlers (bold, italic, underline)
   - Alignment change handlers (H and V)
   - Colour change handlers (background, line, text)
   - Decoration add mode handlers
   - Decoration text update handler

4. **CSS Vertical Dividers:** Implement using CSS borders or pseudo-elements. Use subtle grey colour (#e0e0e0) consistent with existing border styling.

5. **Row 2 Visibility:** Row 2 should only render when in Diagram view, not in Meta-model view. Use conditional rendering based on view state.

6. **Keep Bottom Panel Structure:** Do not remove the DecorationsPanel component entirely. Empty it but keep the structural component for potential future use.

## Reference Files

- **DiagramsView.tsx** (lines 311-427): Current layout structure
- **InspectorPanel.tsx** (lines 488-1304): All styling control implementations and handlers
- **DecorationsPanel.tsx** (lines 49-199): Decoration tools and text editor implementations
- **DiagramsView.module.css**: Existing header and layout styles
- **InspectorPanel.module.css**: Existing panel and control styles

## Test Summary (Task Group 5)

**Test Files Created/Used:**
- `frontend/src/__tests__/row1-toolbar-layout.test.ts` - 6 tests
- `frontend/src/__tests__/row2-toolbar-layout.test.ts` - 6 tests
- `frontend/src/__tests__/left-panel-reorganisation.test.ts` - 16 tests
- `frontend/src/__tests__/bottom-panel-cleanup.test.ts` - 4 tests
- `frontend/src/__tests__/ui-reorganisation-integration.test.ts` - 6 tests (NEW)

**Total Tests: 38 (all passing)**

**Integration Tests Added (Task 5.3):**
1. testRow2StylingAppliestoMultiSelect - Verifies Row 2 styling applies to multi-selected items
2. testDecorationAddModeWorkflow - Verifies decoration add mode workflow from left panel
3. testDecorationTextEditorUpdates - Verifies decoration text editor updates correctly
4. testViewSwitchingRow2Visibility - Verifies Row 2 visibility toggles with view switching
5. testLeftPanelStateIntegration - Verifies left panel state integration with DiagramsView
6. testBottomPanelEmptyStateIntegration - Verifies bottom panel functions in empty state
