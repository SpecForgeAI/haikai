# Dashboard Increment 5 -- Wire Card Actions to Navigation + Persona Panel Placeholder (UI Only)

## Overview

Make the Dashboard immediately actionable by wiring each card's primary action button to navigate to the relevant app area AND simultaneously open a lightweight "persona helper" panel. The panel is a right-anchored drawer rendered at the App shell level that displays the persona name, a "How can I help?" greeting, and a disabled chat input placeholder. No LLM integration or backend calls are involved -- this is a pure frontend UI feature.

## Motivation

Dashboard cards currently navigate to their destination views but provide no contextual AI assistant guidance. This increment introduces the UI skeleton for persona-based assistance so users immediately see which AI persona is available for a given area. The reusable PersonaHelperPanel component will be swapped for real chat panels in future increments.

## Scope

### In Scope

- New `PersonaPanelContext` (React Context) for global panel open/close + active persona state
- New `PersonaPanelProvider` wrapping the app in `App.tsx`
- New `PersonaHelperPanel` component (general-purpose, reusable) rendered at the App shell level
- New CSS Module for PersonaHelperPanel (right-anchored drawer, no backdrop)
- Modify DashboardView card action button `onClick` handlers to also call `openPanel(personaName)` alongside existing `navigateTo()`
- Panel header shows persona name + "How can I help?" greeting text
- Disabled `<input>` with "Coming soon..." placeholder to foreshadow future chat
- X close button in panel header
- Escape key closes panel (global keydown listener)
- Panel persists across view changes (mounted at App level, above all views)

### Out of Scope

- No LLM integration or backend API calls
- No actual chat functionality or message sending
- No keyboard shortcuts beyond Escape for panel dismissal
- No URL persistence of panel state (no `?panel=` query param)
- No resizing or dragging of the panel
- No click-outside-to-close behavior
- No changes to existing navigation targets (card destinations stay identical)
- No changes to the Summary Insight disabled card (remains disabled, no persona)
- No animation/transition beyond a trivial CSS transition if desired
- No modifications to `ArchitectureContext.tsx` -- panel state is in a separate context

## Architecture & Design

### Global Panel State (PersonaPanelContext)

A new lightweight React Context that manages panel visibility and the active persona name. This follows the same pattern as `AppConfigContext.tsx` (`frontend/src/contexts/AppConfigContext.tsx`) -- a `createContext` + Provider + custom hooks.

**State shape:**

```
interface PersonaPanelState {
  isOpen: boolean;
  personaName: string | null;
}
```

**Context value:**

```
interface PersonaPanelContextType {
  isOpen: boolean;
  personaName: string | null;
  openPanel: (personaName: string) => void;
  closePanel: () => void;
}
```

**Provider placement:** In `App.tsx` function `App()` (lines 141-153), wrapping `<ArchitectureProvider>` or placed inside it. The provider must be an ancestor of both `<AppContent>` (which renders `PersonaHelperPanel`) and `<DashboardView>` (which calls `openPanel`). Recommended position: inside `<ArchitectureProvider>` but wrapping `<AppContent>`.

**Custom hooks to export:**
- `usePersonaPanel()` -- returns full context (`{ isOpen, personaName, openPanel, closePanel }`)
- `useOpenPersonaPanel()` -- returns just `openPanel` function (for DashboardView consumption)
- `useClosePersonaPanel()` -- returns just `closePanel` function (for PersonaHelperPanel consumption)

**File:** `frontend/src/contexts/PersonaPanelContext.tsx` (new file)

### PersonaHelperPanel Component

A general-purpose reusable component that renders a right-anchored drawer panel. It reads state from `PersonaPanelContext` and renders conditionally when `isOpen` is true.

**Props:** None -- all state comes from `PersonaPanelContext` via hooks.

**Markup structure:**
1. Outer wrapper `div` with `position: fixed` styling (the drawer)
2. Header row: persona name label (styled like `.personaLabel .personaTeal` from `ProductManagerChatPanel.module.css`) + X close button (right-aligned)
3. Greeting text: "How can I help?" (static paragraph)
4. Disabled input field: `<input type="text" disabled placeholder="Coming soon..." />`

**Keyboard handling:** A `useEffect` in `PersonaHelperPanel` registers a global `keydown` listener for `Escape` that calls `closePanel()`. The listener must be added only when `isOpen` is true and cleaned up on unmount or when panel closes. This follows the exact pattern from `CreateOrganisationModal.tsx` (line 30 area, Escape key handling).

**Close button:** An `<button>` with `aria-label="Close persona panel"` in the header row, `onClick={closePanel}`.

**data-testid attributes:**
- Panel wrapper: `data-testid="persona-helper-panel"`
- Persona label: `data-testid="persona-panel-label"`
- Greeting text: `data-testid="persona-panel-greeting"`
- Disabled input: `data-testid="persona-panel-input"`
- Close button: `data-testid="persona-panel-close"`

**File:** `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.tsx` (new file)
**CSS File:** `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.module.css` (new file)

### Dashboard Card Action Wiring

In `DashboardView.tsx` (`frontend/src/components/DashboardView/DashboardView.tsx`), each card's action button `onClick` currently calls only `navigateTo(dispatch, view, tab)`. Each handler must be extended to also call `openPanel(personaName)` from the `PersonaPanelContext`.

**Implementation approach:**

1. Import `useOpenPersonaPanel` from `PersonaPanelContext` at the top of DashboardView.tsx
2. Inside the `DashboardView` component function body (line 75-76 area), call `const openPanel = useOpenPersonaPanel();`
3. Update each card's `onClick` to add a second call. For example, the Product Definition card button (line 219) changes from:
   ```
   onClick={() => navigateTo(dispatch, 'product', 'product')}
   ```
   to:
   ```
   onClick={() => { navigateTo(dispatch, 'product', 'product'); openPanel('Product Manager'); }}
   ```
4. The Summary Insight card (line 465-474) remains unchanged -- it has no button and uses `cardDisabled` class

**All 9 active cards** get this treatment. The `navigateTo()` function itself is NOT modified -- it stays as-is. The `openPanel()` call is added alongside it in the onClick handler.

### Persona Mapping

Complete mapping of each dashboard card to its persona name string and navigation target:

| Card | data-testid | Persona Name String | navigateTo() args | Button Line |
|------|-------------|--------------------|--------------------|-------------|
| Product Definition | `card-product-definition` | `"Product Manager"` | `('product', 'product')` | ~219 |
| Roadmap | `card-roadmap` | `"Product Manager"` | `('product', 'roadmap')` | ~239 |
| Standards | `card-standards` | `"Product Manager"` | `('product', 'product')` | ~263 |
| High-Level Architecture | `card-hla` | `"Solution Architect"` | `('metamodel')` | ~283 |
| Backlog | `card-backlog` | `"Product Manager"` | `('product', 'backlog')` | ~357 |
| Detailed Architecture | `card-detailed-architecture` | `"Solution Architect"` | `('metamodel')` | ~377 |
| Testing Suite | `card-testing-suite` | `"Test Engineer"` | `('product', 'implement')` | ~395 |
| Implementation | `card-implementation` | `"Implementation Assistant"` | `('product', 'implement')` | ~440 |
| Verification | `card-verification` | `"Test Engineer"` | `('product', 'implement')` | ~459 |
| Summary Insight | `card-summary-insight` | *(disabled -- no persona)* | N/A | N/A |

Note: "Test Engineer" and "Implementation Assistant" are new persona label strings introduced in this increment. They have no backing chat functionality -- they are display-only labels.

### CSS Design

**PersonaHelperPanel.module.css** -- a right-anchored fixed-position drawer panel.

**Panel container (`.panel`):**
- `position: fixed`
- `top: 60px` (below the 60px TopBar, matching `App.css .main-content margin-top: 60px`)
- `right: 0`
- `height: calc(100vh - 60px)` (fills remaining viewport height)
- `width: 340px` (consistent with typical side panel widths in the app)
- `background: #ffffff`
- `border-left: 1px solid #e0e0e0` (matches card border color from `DashboardView.module.css`)
- `box-shadow: -2px 0 8px rgba(0, 0, 0, 0.08)` (subtle left shadow for depth, no full backdrop)
- `z-index: 900` (below modal overlay z-index of 1000 from `CreateOrganisationModal.module.css`, but above main content)
- `display: flex; flex-direction: column`

**Panel header (`.header`):**
- `display: flex; align-items: center; justify-content: space-between`
- `padding: 16px 20px` (matches `CreateOrganisationModal.module.css .header`)
- `border-bottom: 1px solid #e0e0e0`
- `flex-shrink: 0`

**Persona label (`.personaLabel`):**
- `font-size: 12px; font-weight: 600` (matches `ProductManagerChatPanel.module.css .personaLabel`)
- Color: `#00695C` (matches `.personaTeal` from `ProductManagerChatPanel.module.css`)

**Close button (`.closeButton`):**
- `background: none; border: none; cursor: pointer`
- `font-size: 18px; color: #666; padding: 0 4px; line-height: 1`
- Hover: `color: #333`

**Panel body (`.body`):**
- `flex: 1; padding: 20px; display: flex; flex-direction: column; gap: 16px`

**Greeting text (`.greeting`):**
- `font-size: 14px; color: #333; line-height: 1.5`

**Disabled input (`.disabledInput`):**
- Follow `ProductManagerChatPanel.module.css .chatInput:disabled` pattern:
- `width: 100%; padding: 8px 12px; font-size: 13px`
- `border: 1px solid #ccc; border-radius: 4px`
- `background: #f5f5f5; color: #999; cursor: not-allowed`

**No backdrop overlay:** Unlike `CreateOrganisationModal.module.css`, there is no semi-transparent backdrop. The panel floats over the main content with just the left shadow providing visual separation. Click-outside does NOT close the panel.

## File Inventory

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/contexts/PersonaPanelContext.tsx` | **Create** | New context with PersonaPanelProvider, usePersonaPanel, useOpenPersonaPanel, useClosePersonaPanel |
| `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.tsx` | **Create** | New reusable drawer panel component reading from PersonaPanelContext |
| `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.module.css` | **Create** | New CSS module for right-anchored fixed drawer styling |
| `frontend/src/App.tsx` | **Modify** | Import PersonaPanelProvider and PersonaHelperPanel; wrap in provider; render panel as sibling after CreateOrganisationModal (~line 133) |
| `frontend/src/components/DashboardView/DashboardView.tsx` | **Modify** | Import useOpenPersonaPanel; add openPanel calls to all 9 active card button onClick handlers |

## Acceptance Criteria

1. Clicking any of the 9 active dashboard card action buttons navigates to the correct destination view AND opens the PersonaHelperPanel on the right side of the screen.
2. The PersonaHelperPanel displays the correct persona name for each card as defined in the persona mapping table.
3. The panel shows the greeting text "How can I help?" below the persona name header.
4. The panel contains a disabled text input with placeholder text "Coming soon..." that cannot be interacted with.
5. Pressing the X close button in the panel header closes the panel.
6. Pressing the Escape key while the panel is open closes the panel.
7. Clicking outside the panel does NOT close it -- the panel remains open.
8. The panel remains visible when navigating between views (it persists at the App shell level).
9. The Summary Insight card remains disabled with no action button and no persona -- no changes to its existing behavior.
10. Clicking a different card's action button while the panel is already open updates the panel's persona name to the new card's persona.
11. The panel is positioned below the 60px TopBar and fills the remaining viewport height on the right side.
12. The panel does not overlap or push the TopBar -- it starts at `top: 60px`.
13. Opening a modal (e.g., CreateOrganisationModal with Ctrl+Shift+M) renders above the panel (modal z-index 1000 > panel z-index 900).
14. No network requests are made when opening or closing the panel -- it is entirely client-side.

## Technical Notes

- **Context pattern reference:** Follow the structure of `frontend/src/contexts/AppConfigContext.tsx` for `createContext` + Provider + custom hooks. Use `useState` (not `useReducer`) since the state shape is simple (two fields: `isOpen` boolean, `personaName` string | null).
- **Provider placement in App.tsx:** Insert `<PersonaPanelProvider>` inside the `App()` function (lines 141-153). It should wrap `<AppContent />`. Place it inside `<ArchitectureProvider>` so that DashboardView (which already consumes ArchitectureContext) also has access to PersonaPanelContext. The order of nesting should be: `AppConfigProvider > ProjectProvider > ArchitectureProvider > PersonaPanelProvider > AppContent`.
- **PersonaHelperPanel mount point:** Render `<PersonaHelperPanel />` inside `AppContent()` return JSX (lines 118-138), as a sibling after the `<CreateOrganisationModal />` block at line 133-136. This mirrors the existing pattern of rendering app-level overlays as siblings of the main layout.
- **Escape key listener:** Only register the `keydown` listener when `isOpen` is true. Use the same guard pattern as `CreateOrganisationModal` -- skip when focus is on `input`, `textarea`, or `contenteditable` elements. However, since this panel has only a disabled input, the guard is mainly for future-proofing. Clean up the listener in the `useEffect` return.
- **DashboardView changes are minimal:** Only the `onClick` handlers change. The `navigateTo()` function signature and implementation remain untouched. Each button's inline arrow function is expanded to a block body with two calls.
- **Persona name strings must be exact:** The string passed to `openPanel()` must match the values in the mapping table exactly (e.g., `"Product Manager"`, `"Solution Architect"`, `"Test Engineer"`, `"Implementation Assistant"`). These strings are displayed directly in the panel header.
- **No conditional rendering for panel content by persona:** In this increment, all personas show the same content ("How can I help?" + disabled input). Per-persona content differentiation is deferred to future increments.
- **CSS Modules naming:** Follow the project convention of `ComponentName.module.css` with camelCase class names. The project uses vanilla CSS in CSS Modules -- no Sass/Less.
- **Testing pattern:** Use Vitest + React Testing Library following existing test patterns in the codebase. Test files should cover: panel opens on card click, correct persona displayed, close on X button, close on Escape, panel persists across view changes, Summary Insight card unchanged.
