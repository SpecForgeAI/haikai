# Spec Requirements: Dashboard Increment 5 -- Wire Card Actions to Navigation + Persona Panel Placeholder

## Initial Description

Make the Dashboard immediately actionable by wiring each card's primary action to navigate to the relevant app area and open a lightweight "persona helper" panel as a placeholder (no LLM, no backend) that simply asks "How can I help?" and is contextual to the card/persona.

## Requirements Discussion

### First Round Questions

**Q1:** I assume navigating from each card should take the user to the same destination views already wired (e.g., Product Definition -> product tab, HLA -> metamodel). Should the persona panel simply be added on top of this existing navigation, or should we change any navigation targets?
**Answer:** Specifically add the persona helper panel on top of the existing navigation; do NOT change navigation targets in this increment.

**Q2:** For the panel placement, two approaches: (A) App-level overlay/drawer rendered at the App shell level so it persists across views and always appears on the right, or (B) Panel injected into each destination view (ProductView, MetaModelView). I'm leaning toward (A) for simplicity and reusability. Which approach?
**Answer:** Choose (A): App-level overlay/drawer rendered at the App shell level so it persists across views and always appears on the right.

**Q3:** I need an explicit card-to-persona mapping. I'm assuming: Product Definition -> Product Manager, Roadmap -> Product Manager, Standards -> Product Manager, HLA -> Solution Architect, Backlog -> Product Manager, Detailed Architecture -> Solution Architect. What about Testing Suite, Implementation, Verification, and Summary Insight?
**Answer:**
- Product Definition -> Product Manager
- Roadmap -> Product Manager
- Standards -> Product Manager
- High-Level Architecture -> Solution Architect
- Backlog -> Product Manager
- Detailed Architecture -> Solution Architect
- Testing Suite -> Test Engineer (introduce label only; placeholder, no functionality)
- Implementation -> Implementation Assistant
- Verification -> Test Engineer
- Summary Insight -> disabled (no persona)

**Q4:** Should clicking the existing card action button (e.g., "Open Product") do both navigate AND open the panel in one action, or should there be a separate icon/button on each card for the persona panel?
**Answer:** The existing "Open X" button does both navigate + open the panel.

**Q5:** For the panel content, beyond showing the persona name and "How can I help?", should we include a disabled input field to foreshadow future chat functionality, or just a static text message?
**Answer:** Yes, include a disabled input field with "Coming soon..." placeholder to foreshadow future chat.

**Q6:** Panel dismissal: I'm assuming X button closes the panel, plus Escape key. Should clicking outside the panel also close it, or should it stay open until explicitly dismissed?
**Answer:** X button + Escape closes; clicking outside does NOT close.

**Q7:** Should the PersonaHelperPanel be built as a general-purpose reusable component (persona name, greeting text as props) that we'll later swap out for real chat panels, or a simpler one-off implementation?
**Answer:** Make it general-purpose/reusable `PersonaHelperPanel` component (will reuse later for real persona chat).

**Q8:** Anything that should be explicitly excluded from this increment?
**Answer:** Also exclude any keyboard shortcuts beyond Escape, any URL persistence of panel state, and any resizing/dragging of the panel.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: CreateOrganisationModal (overlay pattern) - Path: `frontend/src/components/Organisation/CreateOrganisationModal.tsx` and `CreateOrganisationModal.module.css`
  - Provides the `position: fixed` overlay pattern with z-index: 1000
  - Escape key handling pattern
  - X close button pattern
  - However: this is a centered modal, NOT a side drawer -- the new panel needs a right-anchored drawer instead

- Feature: ProductManagerChatPanel (persona label styling) - Path: `frontend/src/components/ProductView/ProductManagerChatPanel.tsx` and `ProductManagerChatPanel.module.css`
  - `.personaLabel` styling: `font-size: 12px; font-weight: 600;`
  - `.personaTeal` color: `#00695C`
  - Chat container layout, disabled input styling patterns

- Feature: SolutionArchitectChatPanel (persona label styling) - Path: `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx` and `SolutionArchitectChatPanel.module.css`
  - Same persona label pattern as ProductManagerChatPanel
  - `.personaTeal` color: `#00695C`

- Feature: App.tsx (app shell structure) - Path: `frontend/src/App.tsx`
  - AppContent renders `<div className="app">` -> `<TopBar>` -> `<main className="main-content">`
  - CreateOrganisationModal is already rendered at app root level as a sibling of the main layout
  - The PersonaHelperPanel should be rendered similarly at this level

- Feature: ArchitectureContext (state management) - Path: `frontend/src/contexts/ArchitectureContext.tsx`
  - AppState and AppAction types
  - SET_VIEW action pattern for navigation
  - Reducer pattern for state changes

- Feature: DashboardView (navigation + card actions) - Path: `frontend/src/components/DashboardView/DashboardView.tsx`
  - `navigateTo()` helper function: dispatches SET_VIEW + pushState
  - Card action buttons with onClick handlers
  - Card-to-view mapping already established

- Feature: DashboardView CSS (card styling) - Path: `frontend/src/components/DashboardView/DashboardView.module.css`
  - `.card`, `.cardAction`, `.cardDisabled` patterns
  - Design system colors and spacing

- Feature: App.css (layout constraints) - Path: `frontend/src/App.css`
  - `.main-content` has `margin-top: 60px; height: calc(100vh - 60px);`
  - The panel must account for the 60px TopBar height

### Follow-up Questions

No follow-up questions were needed. All requirements were fully clarified in the first round.

## Visual Assets

### Files Provided:
No visual assets provided. The visuals directory exists but contains no files.

### Visual Insights:
N/A -- no visual assets to analyze.

## Requirements Summary

### Functional Requirements
- Each of the 10 dashboard cards' action buttons should navigate to the existing destination AND open the PersonaHelperPanel
- Exception: Summary Insight card remains disabled (no persona, no action)
- The PersonaHelperPanel is an app-level right-anchored drawer/overlay rendered in the App shell
- Panel displays the persona name contextual to the card that was clicked
- Panel shows a greeting message: "How can I help?"
- Panel includes a disabled text input with "Coming soon..." placeholder text
- Panel is dismissed via X button or Escape key
- Clicking outside the panel does NOT close it
- Panel persists across view changes (rendered at App level, above all views)
- Panel appears on the right side of the screen

### Card-to-Persona Mapping
| Card | Persona Label | Notes |
|------|--------------|-------|
| Product Definition | Product Manager | |
| Roadmap | Product Manager | |
| Standards | Product Manager | |
| High-Level Architecture | Solution Architect | |
| Backlog | Product Manager | |
| Detailed Architecture | Solution Architect | |
| Testing Suite | Test Engineer | New label; placeholder only, no existing chat functionality |
| Implementation | Implementation Assistant | |
| Verification | Test Engineer | New label; placeholder only, no existing chat functionality |
| Summary Insight | (disabled) | No persona, card remains disabled |

### Reusability Opportunities
- PersonaHelperPanel should be a general-purpose reusable component accepting persona name and greeting text as props
- Will be reused in future increments when real persona chat is wired up
- Overlay/drawer CSS pattern will be new but should follow existing design system (colors, fonts, border-radius from ProductPage/DashboardView patterns)
- Escape key handling pattern already exists in CreateOrganisationModal -- follow same approach
- App-level rendering pattern already exists with CreateOrganisationModal -- follow same mounting approach

### Scope Boundaries

**In Scope:**
- New `PersonaHelperPanel` component (general-purpose, reusable)
- New CSS module for PersonaHelperPanel (right-anchored drawer style)
- State management for panel open/close and active persona (likely local state in App.tsx or a simple context)
- Modify DashboardView card action buttons to pass persona info and trigger panel open alongside navigation
- Modify App.tsx to render PersonaHelperPanel at app shell level
- Escape key handler to close panel
- X button to close panel
- Disabled input field with "Coming soon..." placeholder
- Persona-specific greeting/label displayed in panel header

**Out of Scope:**
- No LLM integration / no backend calls
- No actual chat functionality
- No keyboard shortcuts beyond Escape
- No URL persistence of panel state (no ?panel= query param)
- No resizing or dragging of the panel
- No click-outside-to-close behavior
- No changes to existing navigation targets
- No changes to the Summary Insight disabled card
- No animation/transition for panel open/close (unless trivially simple)

### Technical Considerations
- **App shell rendering**: PersonaHelperPanel should be rendered as a sibling of the main content in App.tsx, similar to how CreateOrganisationModal is rendered at app root level (line 133 of App.tsx)
- **State management**: Panel state (isOpen, personaName) could be managed via:
  - Simple useState in AppContent (like isCreateOrgModalOpen)
  - Or a lightweight context if the DashboardView needs to signal "open panel with persona X" to the App shell
  - Recommendation: Since DashboardView is deeply nested and needs to communicate to App.tsx, either pass a callback through context or introduce a small dedicated context/state
- **Panel positioning**: Must account for the 60px TopBar (App.css `.main-content` has `margin-top: 60px`)
- **z-index**: Modal overlay uses z-index: 1000; the panel should use a similar or slightly lower z-index since it's a drawer, not a blocking modal
- **CSS**: Follow existing design system -- CSS Modules with vanilla CSS, no preprocessors
- **navigateTo() modification**: The existing `navigateTo()` function in DashboardView.tsx dispatches SET_VIEW + pushState. It needs to be extended (or supplemented) to also open the panel with the correct persona
- **Testing**: Vitest + React Testing Library following existing test patterns
