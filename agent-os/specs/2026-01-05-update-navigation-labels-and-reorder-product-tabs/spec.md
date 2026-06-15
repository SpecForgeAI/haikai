# Specification: Update Navigation Labels and Reorder Product Tabs

## Goal
Rename top-level navigation button labels to "Product & Delivery" and "Architecture & Design", and reorder the Product sub-tabs so Roadmap appears first, while preserving all internal values, test IDs, and behavior.

## User Stories
- As a user, I want the navigation labels to better reflect the scope of each section so that I understand what content each area contains.
- As a user, I want the Roadmap tab to appear first in the Product view so that I can quickly access roadmap planning as the primary entry point.

## Specific Requirements

**Top-level navigation label updates**
- Change the Product button's visible text from "Product" to "Product & Delivery" (line 222 in TopBar.tsx)
- Change the Architecture button's visible text from "Architecture" to "Architecture & Design" (line 230 in TopBar.tsx)
- Keep "Diagrams" button text unchanged
- Preserve all onClick handlers, data-testid attributes, CSS classes, and internal view values ('product', 'metamodel', 'diagrams')

**Product sub-tab reordering**
- Move the Roadmap button block (lines 158-164 in ProductView.tsx) to render first in the tab bar
- Keep the Backlog button block (lines 144-150) as the second tab
- Keep the Implement button block (lines 151-157) as the third tab
- Final order: [Roadmap][Backlog][Implement]

**Preserve existing button configurations**
- Each button must retain its original onClick callback using handleTabChange with the same tab key
- Each button must retain its original data-testid value (roadmap-tab, backlog-tab, implement-tab)
- Each button must retain its original label text (Roadmap, Backlog, Implement)
- Each button must retain its activeTab conditional styling logic

**No changes to internal state or types**
- The ProductTab type union ('backlog' | 'implement' | 'roadmap') must remain unchanged
- The parseTabFromUrl() function default return value must remain 'backlog'
- The initial activeTab state must continue to be set from URL parsing
- All URL parameter handling logic must remain unchanged

**No changes to content rendering**
- The conditional rendering logic for tab content (lines 169-180) must remain unchanged
- ProductBacklogPage, ProductImplementPage, and ProductRoadmapPage component wiring must stay the same

## Existing Code to Leverage

**TopBar.tsx navigation buttons (lines 215-239)**
- Contains the viewToggle div with three navigation buttons: Product, Architecture, Diagrams
- Each button uses handleViewChange callback with internal values ('product', 'metamodel', 'diagrams')
- Only the inner text content of Product and Architecture buttons needs to change

**ProductView.tsx tab bar (lines 143-165)**
- Contains the tabBar div with data-testid="product-tab-bar"
- Three button elements for Backlog, Implement, and Roadmap tabs
- Each button has consistent structure: className with activeTab conditional, onClick with handleTabChange, data-testid attribute
- Reorder requires moving the Roadmap button block before Backlog button block

**TopBar.module.css styles (lines 49-77)**
- viewToggle and toggleButton classes define the navigation button appearance
- No CSS changes required; styles are applied via class names already in use

**ProductView.module.css styles (lines 33-66)**
- tabBar, tab, and activeTab classes define the sub-tab button appearance
- No CSS changes required; styles are applied via class names already in use

## Out of Scope
- Do NOT modify any component names, file names, or file locations
- Do NOT change internal state values ('product', 'metamodel', 'diagrams', 'backlog', 'implement', 'roadmap')
- Do NOT modify any data-testid attributes
- Do NOT change URL parameter names or parsing logic
- Do NOT modify the ProductTab type definition
- Do NOT change any onClick handlers or their callback parameters
- Do NOT modify CSS classes or add new styles
- Do NOT change the default tab (backlog) when no URL parameter is present
- Do NOT modify any backend code or API endpoints
- Do NOT change the content rendering logic for any tab
