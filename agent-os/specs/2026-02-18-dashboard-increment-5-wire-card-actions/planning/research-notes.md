# Research Notes: Dashboard Increment 5 -- Wire Card Actions to Navigation + Persona Panel Placeholder

## Raw Idea Summary

Make the Dashboard immediately actionable by wiring each card's primary action to navigate to the relevant app area and open a lightweight "persona helper" panel as a placeholder (no LLM, no backend) that simply asks "How can I help?" and is contextual to the card/persona.

---

## Research Findings

### 1. Dashboard Cards -- Current State

**File:** `frontend/src/components/DashboardView/DashboardView.tsx`

There are **10 dashboard cards** organized in 3 sections:

**Strategic Foundation (4 cards):**
| Card | data-testid | Button Label | Current navigateTo() |
|------|------------|--------------|---------------------|
| Product Definition | `card-product-definition` | "Open Product" | `('product', 'product')` |
| Roadmap | `card-roadmap` | "Open Roadmap" | `('product', 'roadmap')` |
| Standards | `card-standards` | "View Standards" | `('product', 'product')` |
| High-Level Architecture | `card-hla` | "Open Architecture" | `('metamodel')` |

**Pre-Coding (3 cards):**
| Card | data-testid | Button Label | Current navigateTo() |
|------|------------|--------------|---------------------|
| Backlog | `card-backlog` | "Open Backlog" | `('product', 'backlog')` |
| Detailed Architecture | `card-detailed-architecture` | "Open Architecture" | `('metamodel')` |
| Testing Suite | `card-testing-suite` | "Open Tests" | `('product', 'implement')` |

**Post-Coding (3 cards):**
| Card | data-testid | Button Label | Current navigateTo() |
|------|------------|--------------|---------------------|
| Implementation | `card-implementation` | "Open Implement" | `('product', 'implement')` |
| Verification | `card-verification` | "Open Verification" | `('product', 'implement')` |
| Summary Insight | `card-summary-insight` | (disabled) | N/A -- "AI insights coming soon" |

**Key observation:** Navigation is already wired. The `navigateTo()` helper dispatches `SET_VIEW` and pushes URL state with `?tab=`. The raw idea says "wire card actions" -- but they are already wired for basic navigation. The new behavior is adding the **persona panel** overlay/drawer on top of the navigation.

### 2. Navigation/Routing Architecture

**File:** `frontend/src/contexts/ArchitectureContext.tsx`

- `AppState.currentView` is typed as `'product' | 'metamodel' | 'diagrams' | 'dashboard'`
- `SET_VIEW` action changes `currentView`
- No existing mechanism for passing "open a panel" alongside view change

**File:** `frontend/src/App.tsx` (AppContent)

- View switch is a simple conditional: `{state.currentView === 'dashboard' && <DashboardView />}` etc.
- No concept of an overlay or side panel at the App level

**File:** `frontend/src/components/TopBar/TopBar.tsx`

- TopBar dispatches `SET_VIEW` for view navigation
- Dashboard button is always visible, Product & Delivery is gated by `includeDelivery`

### 3. Product View Tab System

**File:** `frontend/src/components/ProductView/ProductView.tsx`

- Tab type: `type ProductTab = 'backlog' | 'implement' | 'roadmap' | 'product'`
- Tab is parsed from URL: `parseTabFromUrl()` reads `?tab=` param
- Tab change: `handleTabChange(tab)` calls `updateUrl()` which does `window.history.pushState`
- The dashboard's `navigateTo()` already pushes `?tab=<tabname>` which ProductView reads on mount

### 4. Existing Panel/Drawer Patterns

**File:** `frontend/src/components/shared/ResizableSplitPane.tsx`

- Reusable left/right split pane with draggable divider
- Used in Product & Delivery views (Backlog, Implement pages)
- Supports localStorage persistence of width, min/max constraints, keyboard accessibility
- This is the closest existing pattern to a "side panel"

**File:** `frontend/src/components/common/Modal.tsx`

- Simple overlay modal with backdrop click-to-close
- Used for error modals, import/export modals
- Not suitable for a persistent "helper panel"

**No existing drawer/slide-out component exists.** The app has:
- Full-page views (Dashboard, MetaModel, Diagrams)
- Split-pane layouts (Backlog, Implement pages)
- Modal overlays (various modals)
- Chat panels embedded within page layouts (ProductManagerChatPanel, SolutionArchitectChatPanel)

### 5. Persona Concepts in the Codebase

**File:** `frontend/src/components/ProductView/ProductPage.tsx`

- Sub-tab bar with "Product Manager" and "Discuss Architecture" (Solution Architect)
- State: `activeTab: 'pm' | 'sa'`

**File:** `frontend/src/components/ProductView/ProductManagerChatPanel.tsx`

- Persona label: "Product Manager" (displayed as `.personaTeal` styled label)
- Chat mode: `mode: 'product_manager'`
- Bootstrap message pattern, phase-based rendering

**File:** `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx`

- Persona: "Solution Architect"
- Chat mode: `mode: 'solution_architect'` (implied from context)
- Same chat pattern as ProductManagerChatPanel

**File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`

- Used in the Implement tab
- Complex chat with bootstrap, phased conversations, context bundles

**File:** `frontend/src/components/ProductView/RoadmapPmChatPanel.tsx`

- Exists in the codebase (seen in file listing)
- Likely a Product Manager chat for roadmap context

**Persona-to-card mapping (inferred from raw idea):**
- Product Definition -> Product Manager
- Roadmap -> Product Manager (Roadmap variant?)
- Standards -> ? (no obvious persona yet)
- HLA -> Solution Architect
- Backlog -> Product Manager
- Detailed Architecture -> Solution Architect
- Testing Suite -> ? (no obvious persona yet)
- Implementation -> Implementation Assistant
- Verification -> ? (no obvious persona yet)
- Summary Insight -> Disabled

### 6. CSS/Styling Patterns

**Design system constants observed across the codebase:**
- Primary color: `#1976D2`
- Text: `#333`
- Muted text: `#888`
- Border: `#e0e0e0`
- Border radius: `6px`
- Card shadow: `0 1px 3px rgba(0, 0, 0, 0.06)`
- Font sizes: `11-14px`
- Chat bubble styling: user messages green `#E6F4EA`, assistant gray `#F1F1F1`

### 7. Tech Stack Relevant to This Feature

- React 18.x with TypeScript
- CSS Modules (vanilla CSS, no preprocessors)
- State management: React Context + useReducer
- No routing library (manual URL params + pushState)
- Vitest + React Testing Library for testing

---

## Key Architecture Questions

1. **Where does the persona panel live?** The raw idea says "persona helper panel." But this panel needs to appear after navigating away from the dashboard. Once the user clicks a card, they navigate to Product & Delivery or Architecture & Design view. Does the panel:
   - Appear as an overlay/drawer on the destination view?
   - Stay as part of the dashboard view before navigating?
   - Appear at the App level (above all views)?

2. **What triggers the panel to open?** The card buttons already navigate. Do we:
   - Change the button to only open the panel (no navigation)?
   - Add a second button/icon to cards for the persona panel?
   - Make the existing button do both (navigate AND open panel)?

3. **Card-to-persona mapping is ambiguous** for several cards (Standards, Testing Suite, Verification). Need explicit mapping.

4. **Panel dismissal** -- How does the user close the panel? Click outside? X button? Escape key?

5. **The "Summary Insight" card is disabled** -- should it remain disabled or get wired too?

6. **No existing drawer component** -- this would be a new UI pattern for the app.

---

## Clarifying Question Answers (User Responses)

### Q1: Navigation targets
**Question:** Should the persona panel simply be added on top of this existing navigation, or should we change any navigation targets?
**Answer:** Specifically add the persona helper panel on top of the existing navigation; do NOT change navigation targets in this increment.

### Q2: Panel placement
**Question:** (A) App-level overlay/drawer rendered at App shell level, or (B) Panel injected into each destination view?
**Answer:** Choose (A): App-level overlay/drawer rendered at the App shell level so it persists across views and always appears on the right.

### Q3: Persona mapping
**Question:** Explicit card-to-persona mapping for all 10 cards?
**Answer:**
| Card | Persona |
|------|---------|
| Product Definition | Product Manager |
| Roadmap | Product Manager |
| Standards | Product Manager |
| High-Level Architecture | Solution Architect |
| Backlog | Product Manager |
| Detailed Architecture | Solution Architect |
| Testing Suite | Test Engineer (introduce label only; placeholder, no functionality) |
| Implementation | Implementation Assistant |
| Verification | Test Engineer |
| Summary Insight | disabled (no persona) |

### Q4: Single vs. dual action
**Question:** Should clicking the card button do both navigate AND open the panel, or should there be a separate button?
**Answer:** The existing "Open X" button does both navigate + open the panel.

### Q5: Panel content
**Question:** Include a disabled input field to foreshadow future chat, or just static text?
**Answer:** Yes, include a disabled input field with "Coming soon..." placeholder to foreshadow future chat.

### Q6: Panel dismissal
**Question:** How does the user close the panel? X button? Escape? Click outside?
**Answer:** X button + Escape closes; clicking outside does NOT close.

### Q7: Component scope
**Question:** General-purpose reusable component or one-off implementation?
**Answer:** Make it general-purpose/reusable `PersonaHelperPanel` component (will reuse later for real persona chat).

### Q8: Exclusions
**Question:** Anything to explicitly exclude?
**Answer:** Also exclude any keyboard shortcuts beyond Escape, any URL persistence of panel state, and any resizing/dragging of the panel.

---

## Deep-Dive Codebase Analysis (Post-Answers)

### App Shell Structure (App.tsx)

The `AppContent` component at `frontend/src/App.tsx` renders:
```
<div className="app">
  <TopBar>
    <main className="main-content">
      {views...}
    </main>
  </TopBar>
  <CreateOrganisationModal ... />   // <-- App-level overlay precedent
</div>
```

**Key findings:**
- `CreateOrganisationModal` is already rendered at the app root level as a sibling of the TopBar/main layout (line 133)
- This establishes the exact pattern for mounting PersonaHelperPanel
- The panel would be rendered similarly: `<PersonaHelperPanel ... />` as a sibling after `</TopBar>`
- State for panel open/close is managed via `useState` in AppContent (same pattern as `isCreateOrgModalOpen`)

**Challenge:** DashboardView needs to signal "open panel with persona X" to AppContent. Options:
1. Add panel state to ArchitectureContext (heavy -- context is already 2300+ lines)
2. Create a lightweight dedicated context (clean separation)
3. Pass callbacks through existing context/props (DashboardView is rendered inside `<main>` inside `<TopBar>` -- prop threading is awkward)

**Recommendation:** A small dedicated context (e.g., `PersonaPanelContext`) with `openPanel(personaName)` and `closePanel()` is the cleanest approach. It avoids bloating ArchitectureContext and enables any component to open/close the panel.

### ArchitectureContext Analysis

**File:** `frontend/src/contexts/ArchitectureContext.tsx`

- AppState is already complex with 13+ fields
- AppAction union type has 30+ action variants
- Adding panel state here would work but adds complexity to an already large reducer
- The panel state is UI-only, transient, and unrelated to the architecture model -- it does not belong in ArchitectureContext

**Conclusion:** Panel state should NOT live in ArchitectureContext. A separate lightweight context or simple state in App.tsx with a dedicated context for the open/close callbacks is more appropriate.

### DashboardView navigateTo() Analysis

**File:** `frontend/src/components/DashboardView/DashboardView.tsx` (lines 43-54)

```typescript
function navigateTo(
  dispatch: React.Dispatch<AppAction>,
  view: string,
  tab?: string
): void {
  if (view === 'product' && tab) {
    dispatch({ type: 'SET_VIEW', payload: 'product' });
    window.history.pushState({}, '', '?tab=' + tab);
  } else if (view === 'metamodel') {
    dispatch({ type: 'SET_VIEW', payload: 'metamodel' });
  }
}
```

**Key findings:**
- This is a local helper function (not exported), not a hook
- It takes `dispatch` as a parameter
- It needs to be extended to also call `openPanel(personaName)` from the panel context
- Each card's `onClick` would become: `navigateTo(dispatch, view, tab)` + `openPanel(personaName)`
- Or the navigateTo function signature is extended to accept a persona parameter

### Modal Overlay CSS Pattern (CreateOrganisationModal.module.css)

**Key CSS patterns to reference for the drawer:**
```css
.overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1000;
}
```

**Differences for the drawer:**
- No centered flex layout -- panel is right-anchored
- May not need a full-screen semi-transparent backdrop (since click-outside does NOT close)
- If no backdrop, the panel is just a `position: fixed; right: 0; top: 60px;` element
- Consider a subtle shadow instead of backdrop overlay

### Chat Panel Persona Label Styling

**File:** `frontend/src/components/ProductView/ProductManagerChatPanel.module.css`

```css
.personaLabel {
  display: block;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
}
.personaTeal { color: #00695C; }
```

**File:** `frontend/src/components/ProductView/SolutionArchitectChatPanel.module.css`

Same pattern. The PersonaHelperPanel header should follow this styling for consistency.

### App.css Layout Constraints

```css
.main-content {
  flex: 1;
  margin-top: 60px;
  height: calc(100vh - 60px);
  overflow: hidden;
}
```

The panel must be positioned with `top: 60px` to sit below the TopBar, and `height: calc(100vh - 60px)` to fill the remaining viewport height.

---

## Resolved Architecture Questions

1. **Panel lives at App level** -- Rendered in AppContent as a sibling of the main content, same pattern as CreateOrganisationModal.
2. **Existing button does both** -- Navigate + open panel in one click.
3. **Persona mapping is fully defined** -- See table above. Two new labels introduced: "Test Engineer" and "Implementation Assistant".
4. **Dismissal: X + Escape only** -- No click-outside-to-close.
5. **Summary Insight stays disabled** -- No persona, no action.
6. **New drawer pattern** -- Right-anchored `position: fixed` panel, no backdrop, with shadow. First drawer component in the app.
