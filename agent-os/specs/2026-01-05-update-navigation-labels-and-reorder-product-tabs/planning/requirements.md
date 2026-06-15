# Requirements: Update Navigation Labels and Reorder Product Tabs

## Title
Update navigation labels and reorder Product sub-tabs (UI text/order only)

## Intent
Make two small frontend-only navigation UI adjustments:
1) Rename the top-level navigation button labels to better reflect scope.
2) Reorder the Product sub-tab buttons so Roadmap appears first.

## Scope
- frontend only
- UI text + button render order only
- no changes to component names, props, state keys, routes, internal values, or test IDs
- no backend/schema changes

## Requirements

### 1) Top-level navigation (header buttons)
- Change visible button text only:
  - "Product" -> "Product & Delivery"
  - "Architecture" -> "Architecture & Design"
  - "Diagrams" stays "Diagrams"
- Keep all existing:
  - onClick handlers
  - internal view values (e.g., 'product', 'metamodel', 'diagrams')
  - data-testid attributes
  - CSS classes and structure

### 2) Product view sub-tabs
- Change the visual order of the Product tab buttons from:
  [Backlog][Implement][Roadmap]
  to:
  [Roadmap][Backlog][Implement]
- Keep each button's:
  - label text (Backlog / Implement / Roadmap)
  - onClick action (handleTabChange with the same tab key)
  - data-testid attributes (roadmap-tab, backlog-tab, implement-tab)
  - styling classes and activeTab logic
- No changes to the content rendering logic for each tab (only the tab bar order)

## Implementation Notes

### frontend:
- File: src/components/TopBar/TopBar.tsx
  - Update the rendered button label strings only:
    - Product button inner text: "Product & Delivery"
    - Architecture button inner text: "Architecture & Design"
    - Diagrams button inner text remains unchanged

- File: src/components/ProductView/ProductView.tsx
  - In the tab bar markup (data-testid="product-tab-bar"):
    - Reorder the existing three <button> blocks so the Roadmap button renders first,
      then Backlog, then Implement
    - Do not modify the onClick callbacks, tab keys, active checks, or data-testid values

## Constraints
- Do NOT rename any identifiers or internal values (e.g., state.currentView values, ProductTab union values)
- Do NOT change any routes, URL param logic, or navigation behavior
- Do NOT change any data-testid attributes
- Keep changes limited to these two files (unless a shared label constant already exists; if so, update only the displayed text)

## Acceptance Criteria
- Top navigation displays: "Product & Delivery", "Architecture & Design", "Diagrams"
- Clicking each top nav button behaves exactly as before
- Product sub-tab buttons display in order: Roadmap, Backlog, Implement
- Clicking each Product sub-tab still activates the correct tab and preserves existing URL/tab behavior
- No TypeScript errors and existing tests/selectors using data-testid continue to work
