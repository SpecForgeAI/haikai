# Task Breakdown: Update Navigation Labels and Reorder Product Tabs

## Overview
Total Tasks: 5

This is a simple frontend-only UI change requiring:
1. Two text label updates in TopBar.tsx
2. Button render order change in ProductView.tsx

No changes to internal state, types, test IDs, or behavior.

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/TopBar/TopBar.tsx` | Update button text on lines 222 and 230 |
| `frontend/src/components/ProductView/ProductView.tsx` | Reorder button blocks in tab bar (lines 144-164) |

## Task List

### Frontend UI Updates

#### Task Group 1: Navigation Label and Tab Order Changes
**Dependencies:** None

- [x] 1.0 Complete navigation UI updates
  - [x] 1.1 Update TopBar navigation button labels
    - Change line 222 from `Product` to `Product & Delivery`
    - Change line 230 from `Architecture` to `Architecture & Design`
    - Keep `Diagrams` button text unchanged (line 237)
    - Preserve all onClick handlers, data-testid attributes, and CSS classes
    - Preserve internal view values ('product', 'metamodel', 'diagrams')
  - [x] 1.2 Reorder ProductView tab buttons
    - Move Roadmap button block (currently lines 158-164) to render first
    - Keep Backlog button block (currently lines 144-150) as second tab
    - Keep Implement button block (currently lines 151-157) as third tab
    - Final render order: [Roadmap][Backlog][Implement]
    - Preserve each button's onClick callback with same tab key
    - Preserve each button's data-testid value (roadmap-tab, backlog-tab, implement-tab)
    - Preserve each button's label text (Roadmap, Backlog, Implement)
    - Preserve activeTab conditional styling logic for each button
  - [x] 1.3 Verify no changes to internal logic
    - Confirm ProductTab type union remains unchanged
    - Confirm parseTabFromUrl() default return value remains 'backlog'
    - Confirm initial activeTab state is still set from URL parsing
    - Confirm content rendering logic (lines 169-180) is unchanged

**Acceptance Criteria:**
- Top navigation displays: "Product & Delivery", "Architecture & Design", "Diagrams"
- Clicking each top nav button triggers the same view change as before
- Product sub-tab buttons display in visual order: Roadmap, Backlog, Implement
- Clicking each Product sub-tab activates the correct tab content
- All data-testid attributes are preserved and unchanged
- No TypeScript compilation errors
- URL/tab behavior unchanged (default tab remains 'backlog')

### Verification

#### Task Group 2: Manual Verification
**Dependencies:** Task Group 1

- [x] 2.0 Verify changes work correctly
  - [x] 2.1 Visual verification
    - Confirm TopBar shows "Product & Delivery" button
    - Confirm TopBar shows "Architecture & Design" button
    - Confirm TopBar shows "Diagrams" button (unchanged)
    - Confirm Product view tab bar shows tabs in order: Roadmap, Backlog, Implement
  - [x] 2.2 Functional verification
    - Click "Product & Delivery" button and confirm Product view loads
    - Click "Architecture & Design" button and confirm Architecture view loads
    - Click "Diagrams" button and confirm Diagrams view loads
    - Click each Product sub-tab and confirm correct content renders
    - Verify URL parameter behavior still works (tab=backlog, tab=implement, tab=roadmap)

**Acceptance Criteria:**
- All navigation buttons display correct labels
- All navigation buttons trigger correct view changes
- Product sub-tabs display in correct order
- Tab switching works correctly
- URL parameters continue to control tab selection

## Execution Order

1. **Task Group 1**: Navigation Label and Tab Order Changes
2. **Task Group 2**: Manual Verification

## Code Change Details

### TopBar.tsx Changes (lines 217-238)

**Before:**
```tsx
<button
  className={`${styles.toggleButton} ${state.currentView === 'product' ? styles.active : ''}`}
  onClick={() => handleViewChange('product')}
  data-testid="product-nav-button"
>
  Product
</button>
...
<button
  className={`${styles.toggleButton} ${state.currentView === 'metamodel' ? styles.active : ''}`}
  onClick={() => handleViewChange('metamodel')}
  data-testid="architecture-nav-button"
>
  Architecture
</button>
```

**After:**
```tsx
<button
  className={`${styles.toggleButton} ${state.currentView === 'product' ? styles.active : ''}`}
  onClick={() => handleViewChange('product')}
  data-testid="product-nav-button"
>
  Product & Delivery
</button>
...
<button
  className={`${styles.toggleButton} ${state.currentView === 'metamodel' ? styles.active : ''}`}
  onClick={() => handleViewChange('metamodel')}
  data-testid="architecture-nav-button"
>
  Architecture & Design
</button>
```

### ProductView.tsx Changes (lines 143-165)

**Before (button order: Backlog, Implement, Roadmap):**
```tsx
<div className={styles.tabBar} data-testid="product-tab-bar">
  <button ... data-testid="backlog-tab">Backlog</button>
  <button ... data-testid="implement-tab">Implement</button>
  <button ... data-testid="roadmap-tab">Roadmap</button>
</div>
```

**After (button order: Roadmap, Backlog, Implement):**
```tsx
<div className={styles.tabBar} data-testid="product-tab-bar">
  <button ... data-testid="roadmap-tab">Roadmap</button>
  <button ... data-testid="backlog-tab">Backlog</button>
  <button ... data-testid="implement-tab">Implement</button>
</div>
```

## Notes

- This is a UI-only change with no impact on application logic or state management
- The internal ProductTab type ('backlog' | 'implement' | 'roadmap') remains unchanged
- The default tab remains 'backlog' (controlled by parseTabFromUrl function)
- All existing tests using data-testid selectors will continue to work
- No new tests are required for this change as it only affects display text and render order
