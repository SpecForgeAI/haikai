# Specification: Diagram View UI Layout Reorganisation

## Goal
Reorganise the Diagram view UI layout without changing the underlying behaviour or JSON model. The changes consolidate styling controls into a new second row of the top toolbar, move decoration tools to the left panel, and introduce clear visual separation between toolbar sections.

## User Stories
- As an architect, I want styling controls in the top toolbar so I can quickly format elements without using a side panel.
- As a user, I want decoration tools in the left panel alongside other diagram tools for a consistent workflow.
- As a user, I want clear visual separation between control groups so I can quickly find the controls I need.

## Design Principle

**UI reorganisation only — no behavioural changes.**

- All existing functionality remains identical
- Same data model and JSON fields
- Same handlers and interaction patterns
- Only the visual placement of controls changes

## Specific Requirements

### 1. Top Toolbar: Two-Row Layout

The Diagram view top toolbar should have two rows:

- **Row 1:** Diagram selection, creation, period/time controls, zoom controls
- **Row 2:** Styling/Inspector controls (font size, styles, alignment, colours)

#### 1.1 Row 1: Diagram, New/Copy, Period, Zoom

Row 1 elements (left → right):

**A) Diagram Selection**
- Label: `Diagram:`
- Dropdown listing all diagrams by name
- When no diagrams exist, show disabled placeholder: "No diagrams defined"

**B) New Diagram Controls**
- Text label: `- New Diagram`
- Text input with placeholder: `Enter new diagram name`
- `[ + New ]` button: Creates new empty diagram with given name and selects it
- `[ + Copy ]` button: Copies the currently selected diagram
- **Vertical divider** (thin line) after this block

**C) Period / Time Controls**
- Label: `Period:`
- Dropdown: `Quarter | Half | Year`
- `<` button: Move to previous time period
- Period label text: e.g., `End of Q3 2026`
- `>` button: Move to next time period
- **Vertical divider** after this block

**D) Zoom Controls**
- `[ + ]` zoom in
- `100%` zoom level label (updates as zoom changes)
- `[ - ]` zoom out
- `[ Fit to View ]` button

**Visual Layout Row 1:**
```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Diagram: [▼ OMS Flow] - New Diagram [Enter name...] [+New] [+Copy] │ Period: [▼Quarter] < End of Q3 2026 > │ [+] 100% [-] [Fit to View] │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 1.2 Row 2: Styling / Inspector Controls

All styling controls previously in the left Inspector panel move to Row 2.

Row 2 elements (left → right):

**A) Font Size**
- Label: `FONT SIZE`
- Controls:
  - `[-]` button (decrease font size)
  - Numeric input (e.g., `14`) for direct entry
  - `[+]` button (increase font size)
  - Static suffix label: `px`
- Applies to selected element(s) text (nodes, edges, decorations)
- **Vertical divider** after this block

**B) Font Styles**
- Label: `FONT STYLES`
- Three toggle buttons:
  - `[B]` for bold
  - `[I]` for italic
  - `[U]` for underline
- Each button highlights when active
- Toggles corresponding font style for selected items
- **Vertical divider** after this block

**C) Text Alignment**
- Label: `BOX ALIGNMENT`
- Two subgroups:
  - Horizontal alignment (`H:`): `[L]` left, `[C]` center, `[R]` right
  - Vertical alignment (`V:`): `[T]` top, `[M]` middle, `[B]` bottom
- Only one option active in each subgroup (radio-button behaviour)
- Applies to text inside node boxes, BOX decorations, etc.
- **Vertical divider** after this block

**D) Colour**
- Label: `COLOUR`
- Three colour pickers (icons):
  1. Background colour picker: Sets background/fill colour (nodes, BOX decorations)
  2. Line colour picker: Sets stroke/outline colour (nodes, edges, decorations)
  3. Text colour picker: Sets text/label colour
- Applies to currently selected item(s)

**Visual Layout Row 2:**
```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ FONT SIZE [-] [14] [+] px │ FONT STYLES [B] [I] [U] │ BOX ALIGNMENT H: [L][C][R] V: [T][M][B] │ COLOUR [🎨][🖊][T] │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 1.3 Row 2 Visibility

- Row 2 is only visible in **Diagram view** (not in Meta-model view)
- All existing "apply to current selection" and multi-select behaviour remains unchanged

### 2. Left Panel: Decorations Tools

Move decoration tools from the bottom panel to the left panel.

#### 2.1 Left Panel Contents in Diagram View

The left panel is now dedicated to:
- Decoration creation tools
- Decoration text editor (for single selected decoration)

The previous Inspector styling content is removed from the left panel (now in Row 2).

#### 2.2 Decorations Tools Section

Section header: `Decorations` or `Add Decorations`

Tools:
- `[▭] Add Box` — Enter "add BOX decoration" mode
- `[／] Add Line` — Enter "add LINE decoration" mode

**Layout should be extendable** for future decoration types (circles, ovals, etc.).

**Behaviour (unchanged):**

- `[▭] Add Box`:
  - Canvas enters "add BOX decoration" mode
  - User click-drags to create rectangular BOX
  - New entry added to `decorations[]` with type `"BOX"`
  - New decoration is selected

- `[／] Add Line`:
  - Canvas enters "add LINE decoration" mode
  - User clicks to define start/end points
  - New entry added to `decorations[]` with type `"LINE"`
  - New decoration is selected

#### 2.3 Decoration Text Editor

The "Decoration text" editor moves to the left panel.

- Text field/textarea for editing `decoration.text`
- Visibility rules unchanged:
  - Only visible when a single BOX or LINE decoration is selected
  - Editing updates `decoration.text` and re-renders the label

**Visual Layout Left Panel:**
```
┌─────────────────────────┐
│ Decorations             │
├─────────────────────────┤
│ [▭ Add Box]             │
│ [／ Add Line]           │
├─────────────────────────┤
│ Decoration Text         │
│ ┌─────────────────────┐ │
│ │ (text editor)       │ │
│ └─────────────────────┘ │
│ (visible when 1 dec     │
│  selected)              │
└─────────────────────────┘
```

### 3. Bottom Panel: Keep but Empty

- The bottom slide-up panel component **remains in place**
- Contains no functional content for now
- May show a placeholder or be hidden/unused
- Do not remove entirely — may be repurposed later
- All decoration tools and content previously in bottom panel move to left panel or top toolbar

### 4. Vertical Dividers

Thin vertical separator lines (pipes) provide visual separation between logical control groups.

**Row 1 dividers after:**
- New Diagram controls (before Period)
- Period controls (before Zoom)

**Row 2 dividers after:**
- Font Size (before Font Styles)
- Font Styles (before Box Alignment)
- Box Alignment (before Colour)

**Implementation:**
- CSS border or pseudo-element
- Subtle colour (e.g., light grey)
- Consistent height within each row

## Implementation Approach

### Phase 1: Two-Row Top Toolbar
- Restructure DiagramsView header into two rows
- Move existing Row 1 controls into formalised layout
- Add vertical dividers between sections

### Phase 2: Move Inspector to Row 2
- Extract styling controls from InspectorPanel
- Create new TopToolbarRow2 component (or inline in DiagramsView)
- Wire up existing handlers to new control locations

### Phase 3: Reorganise Left Panel
- Remove Inspector styling section from left panel
- Add Decorations tools section
- Add Decoration text editor section
- Update DecorationsPanel to render in left panel location

### Phase 4: Empty Bottom Panel
- Remove all content from bottom panel
- Keep component structure intact
- Hide or show placeholder as appropriate

## Existing Code to Leverage

**DiagramsView.tsx - Main Layout**
- Contains top toolbar structure
- Manages panel visibility and state
- Coordinate restructuring here

**InspectorPanel.tsx - Styling Controls**
- Contains font size, styles, alignment, colour controls
- Extract these into Row 2 component
- Keep handlers and logic unchanged

**DecorationsPanel.tsx - Decoration Tools**
- Contains Add Box, Add Line buttons
- Contains Decoration text editor
- Move to left panel location

**DiagramsView.module.css - Styling**
- Add Row 2 styles
- Add vertical divider styles
- Update left panel styles

## Visual Design

**Full Diagram View Layout:**
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ ROW 1: Diagram [▼] - New [___] [+New][+Copy] │ Period [▼] < Q3 2026 > │ [+]100%[-][Fit] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ROW 2: FONT SIZE [-][14][+]px │ FONT STYLES [B][I][U] │ ALIGNMENT H:[L][C][R] V:[T][M][B] │ COLOUR [🎨][🖊][T] │
├──────────────────┬──────────────────────────────────────────────────────────────────┤
│ LEFT PANEL       │                                                                  │
│ ──────────────── │                                                                  │
│ Decorations      │                                                                  │
│ [▭ Add Box]      │                    CANVAS                                        │
│ [／ Add Line]    │                                                                  │
│ ──────────────── │                                                                  │
│ Decoration Text  │                                                                  │
│ [____________]   │                                                                  │
├──────────────────┴──────────────────────────────────────────────────────────────────┤
│ BOTTOM PANEL (empty/hidden)                                                         │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Acceptance Criteria

**Top Toolbar - Row 1:**
- [ ] Diagram selection dropdown with label
- [ ] New diagram input and [+ New] button
- [ ] [+ Copy] button for current diagram
- [ ] Vertical divider after New/Copy section
- [ ] Period dropdown and navigation buttons
- [ ] Vertical divider after Period section
- [ ] Zoom controls ([+], percentage, [-], Fit to View)

**Top Toolbar - Row 2:**
- [ ] Row 2 only visible in Diagram view
- [ ] FONT SIZE with [-], input, [+], px label
- [ ] Vertical divider after Font Size
- [ ] FONT STYLES with [B], [I], [U] toggles
- [ ] Vertical divider after Font Styles
- [ ] BOX ALIGNMENT with H: [L][C][R] and V: [T][M][B]
- [ ] Vertical divider after Alignment
- [ ] COLOUR with three colour pickers (background, line, text)

**Left Panel:**
- [ ] No longer shows Inspector styling controls
- [ ] Shows Decorations section with Add Box, Add Line
- [ ] Shows Decoration text editor when single decoration selected
- [ ] Decoration tools work exactly as before

**Bottom Panel:**
- [ ] No longer contains decoration tools
- [ ] Component structure remains (empty or placeholder)

**Behavioural Consistency:**
- [ ] All styling controls apply to selection as before
- [ ] All decoration creation works as before
- [ ] No changes to JSON model or data handling
- [ ] Multi-select behaviour unchanged

## Out of Scope

- Changing any behaviour or logic (styling, decorations, selection)
- Modifying JSON schema or data model
- Adding new features or controls
- Removing the bottom panel component entirely
- Changing Meta-model view layout

## TypeScript Types (No Changes)

No new types required. This is purely a UI layout change using existing:
- `Decoration`, `BoxDecoration`, `LineDecoration`
- Existing styling properties on nodes, edges, decorations
- Existing reducer actions and handlers
