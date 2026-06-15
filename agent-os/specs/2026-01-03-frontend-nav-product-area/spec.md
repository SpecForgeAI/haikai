# Specification: Frontend Nav Update - Product Area

## Goal
Update the top-level navigation to add a new "Product" area as the first nav item, rename "Meta-Model" to "Architecture" in the UI, and create a basic Product page shell with Backlog and Implement tabs.

## User Stories
- As a user, I want to see "Product" as the first navigation item so that I can access product management features in the future.
- As a user, I want the "Meta-Model" nav label renamed to "Architecture" so that the terminology better reflects the domain.

## Specific Requirements

**Extend currentView state to support three views**
- Add 'product' as a valid value in the currentView type: `'metamodel' | 'diagrams' | 'product'`
- Update the AppState interface in ArchitectureContext.tsx to include the new view option
- Update SET_VIEW action handler to accept 'product' as a valid payload value
- Ensure initial state remains 'metamodel' to preserve existing default behavior

**Add Product as first navigation item in TopBar**
- Locate the viewToggle div in TopBar.tsx (lines 213-226) containing the toggle buttons
- Insert a new "Product" button BEFORE the existing Meta-Model and Diagrams buttons
- The Product button should use the same toggleButton styling as existing nav items
- Set onClick to dispatch SET_VIEW with 'product' payload
- Button should show active state when state.currentView === 'product'

**Rename Meta-Model button label to Architecture**
- Change the button text from "Meta-model" to "Architecture" in TopBar.tsx (line 218)
- The onClick handler remains `handleViewChange('metamodel')` - only the label changes
- The internal currentView value stays as 'metamodel' to avoid breaking existing logic

**Update App.tsx to render ProductPage for product view**
- Add conditional rendering for the product view alongside existing metamodel/diagrams views
- When currentView === 'product', render the new ProductPage component
- Import ProductPage from the new component location

**Create ProductPage component with tab-based navigation**
- Create new file: frontend/src/components/ProductView/ProductPage.tsx
- ProductPage should render a container similar to MetaModelView structure
- Include a tabRow with two tab buttons: "Backlog" and "Implement"
- Use local component state to track selected tab (default to 'backlog')
- Each tab click updates local state and renders corresponding placeholder content

**Create ProductPage styling module**
- Create new file: frontend/src/components/ProductView/ProductPage.module.css
- Reuse styling patterns from MetaModelView.module.css for consistency
- Include container, tabRow, tab, activeTab, and contentArea styles
- Tab styling should match the headerRow/tab patterns from MetaModelView

**Render placeholder content for Backlog and Implement tabs**
- Backlog tab content: simple div with text "Backlog view coming next."
- Implement tab content: simple div with text "Implement view coming next."
- Style placeholder content centered with muted text color
- Keep implementation minimal - just enough to demonstrate routing works

**Ensure correct navigation order in TopBar**
- Final button order in viewToggle must be: Product, Architecture, Diagrams
- Verify visual spacing and styling consistency across all three buttons
- All three buttons should have identical styling except for active state

## Visual Design
No visual mockups provided. Follow existing TopBar toggle button styling and MetaModelView tab patterns.

## Existing Code to Leverage

**TopBar.tsx viewToggle pattern (lines 213-226)**
- Contains the existing nav toggle buttons with active state handling
- Uses handleViewChange function to dispatch SET_VIEW action
- Styling from TopBar.module.css with toggleButton and active classes
- Copy this button pattern for the new Product nav item

**ArchitectureContext.tsx currentView state (lines 57, 75, 322-326)**
- currentView is typed as `'metamodel' | 'diagrams'` in AppState
- SET_VIEW action type and handler already exist
- Extend the union type to include 'product' and the handler will work automatically

**MetaModelView.tsx component structure**
- Demonstrates view container pattern with flex layout
- Shows tab-based navigation within a view using local state patterns
- Can use similar headerRow and tab styling for Product page tabs

**MetaModelView.module.css tab styling (lines 68-92)**
- .tab and .activeTab classes provide consistent tab appearance
- .headerRow provides the container styling for tab rows
- Reuse these patterns for ProductPage tab styling

**App.tsx conditional rendering (lines 14-18)**
- Shows pattern for switching between views based on currentView
- Add third conditional branch for product view rendering

## Out of Scope
- No roadmap or backlog data display in this increment
- No chat implementation for Product area
- No new backend endpoints or API calls
- No changes to internal component/module naming beyond UI labels
- No React Router implementation - uses existing context-based view switching
- No deep-linking routes like /product/backlog (use context state instead)
- No icons for the Product nav button in this increment
- No persistence of Product tab selection across view switches
- No integration with any existing data models or entities
- No tests beyond manual verification checklist
