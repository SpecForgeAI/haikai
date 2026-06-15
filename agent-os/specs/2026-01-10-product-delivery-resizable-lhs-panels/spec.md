# Specification: Product & Delivery - Resizable LHS Panels

## Goal
Enable users to horizontally resize the left-hand (tree/list) panel in the Product & Delivery Roadmap and Backlog tabs, with the right-hand details panel flexing to fill remaining space, and persist the chosen width per browser.

## User Stories
- As a user viewing the Roadmap or Backlog, I want to drag the divider between the tree panel and the details panel so that I can adjust the layout to my preference.
- As a user, I want my panel width preference to be remembered across tab switches and page reloads so that I do not have to resize every time.

## Specific Requirements

**ResizableSplitPane shared component**
- Create a new reusable component (e.g., `ResizableSplitPane.tsx`) in `frontend/src/components/shared/`
- Inputs: `left: ReactNode`, `right: ReactNode`, `storageKey: string`, `defaultLeftWidthPx: number`, `minLeftWidthPx: number`, `maxLeftWidthPx: number`
- Render a flex container with left pane, drag handle, and right pane
- Left pane width is controlled in pixels; right pane uses `flex: 1` to fill remaining space
- On mount, read stored width from localStorage using `storageKey`; if absent or invalid, use `defaultLeftWidthPx`
- Clamp width to `[minLeftWidthPx, maxLeftWidthPx]` on read and during drag

**Drag handle behavior**
- Render a thin vertical element (4-6px wide) between left and right panes as the drag handle
- On mouse enter/hover, change cursor to `col-resize`
- On mousedown on the handle, begin drag mode: attach global `mousemove` and `mouseup` listeners to `document`
- During drag, compute new width as `event.clientX - leftPaneRect.left`, clamp to min/max, and update left pane width state
- On mouseup, persist width to localStorage and remove global listeners
- Handle edge case where mouse leaves window during drag (keep tracking until mouseup)

**Disable text selection during drag**
- While dragging, set `user-select: none` on the body or a container class to prevent accidental text selection
- Restore normal selection after drag ends

**Keyboard accessibility**
- The drag handle must be focusable (`tabIndex={0}`) with a visible focus ring
- When focused, left/right arrow keys adjust width by 10px; shift+arrow adjusts by 50px
- Arrow key adjustments are clamped to min/max and persisted to localStorage

**ProductRoadmapPage integration**
- Wrap the existing tree panel (`.treePanel` content) and detail content (import summary cards, CTA, tree display) in `ResizableSplitPane`
- Use `storageKey="pd.roadmap.leftWidth"`, `defaultLeftWidthPx=350`, `minLeftWidthPx=200`, `maxLeftWidthPx=600`
- Roadmap currently has a single-column layout; refactor to two-column with tree on left and summary/CTA cards on right if needed, or keep tree on left and details placeholder on right

**ProductBacklogPage integration**
- Replace the current static `.treePanel` and `.detailsPanel` flex layout with `ResizableSplitPane`
- Use `storageKey="pd.backlog.leftWidth"`, `defaultLeftWidthPx=350`, `minLeftWidthPx=200`, `maxLeftWidthPx=600`
- Ensure `WorkItemTree` remains in the left pane and `WorkItemDetailsPanel` in the right pane

**Styling and UX**
- Drag handle: subtle border or background color (e.g., `#e0e0e0`), slightly darker on hover (`#bdbdbd`)
- Smooth width transitions are optional; avoid jank during drag by using direct state updates (no CSS transitions during drag)
- After drag ends, localStorage write should not block UI

**Responsiveness and window resize**
- On window resize, if stored width exceeds available space, clamp to valid range
- Consider a useEffect that listens to `window.resize` and re-clamps if needed

## Visual Design
No visual mockups provided. Follow the existing styling conventions in `ProductBacklogPage.module.css` and `ProductView.module.css` for colors and borders.

## Existing Code to Leverage

**ProductBacklogPage.tsx layout (lines 558-616)**
- Current two-column layout uses `.container` (flex row), `.treePanel` (fixed 350px width), and `.detailsPanel` (flex: 1)
- The new `ResizableSplitPane` should replace this structure while preserving the child content

**ProductBacklogPage.module.css (lines 11-37)**
- `.container`: `display: flex; flex: 1; min-height: 0; overflow: hidden;`
- `.treePanel`: `width: 350px; min-width: 280px; max-width: 450px; border-right: 1px solid #e0e0e0; ...`
- `.detailsPanel`: `flex: 1; min-width: 0; ...`
- These styles can be adapted into the shared component's internal styling

**ProductRoadmapPage.tsx (lines 490-599)**
- Currently single-column with conditional cards and tree panel; may need minor restructure to fit two-pane model
- Uses `baseStyles.container` and `baseStyles.treePanel` from ProductBacklogPage.module.css

**localStorage patterns in ProductBacklogPage.tsx (lines 160-205)**
- `getArchivedFilterStorageKey` pattern for project-scoped localStorage keys
- Read on mount with try/catch, write in useEffect with error handling
- Similar pattern should be used for panel width persistence (but not project-scoped; global per-tab key)

**ProductUiStateContext.tsx**
- Demonstrates context-based state management with hooks (`useProductExpansion`)
- Panel width persistence uses localStorage, not context, so no changes needed here

## Out of Scope
- Implement tab is not affected; only Roadmap and Backlog tabs
- No backend or model-service changes
- No changes to data/state behavior of Roadmap/Backlog trees (expand/collapse/select remain unchanged)
- No new global layout framework; implement within existing page components
- Collapsible panel feature (fully hiding LHS) is not included
- Vertical resizing or resizing the details panel independently
- Persisting width per project (use a single global key per tab)
- Touch/mobile drag support (mouse only for this spec)
