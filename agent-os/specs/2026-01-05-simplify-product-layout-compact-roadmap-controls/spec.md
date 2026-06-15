# Specification: Simplify Product Layout and Compact Roadmap Controls

## Goal
Reduce vertical and horizontal space waste in the Product area by removing the redundant "Product" header row and compacting Roadmap import/refresh controls into a thin control row below the Product sub-tabs, leaving the roadmap tree as the primary visible content.

## User Stories
- As a user, I want the Product sub-tabs to appear immediately below the top navigation so that I have more vertical space for content.
- As a user, I want a single "Import/Refresh roadmap.md" button with inline status info so that I can perform roadmap operations without scrolling past multiple controls.

## Specific Requirements

**Remove "Product" header row**
- Delete the `.header` div containing the `<h1>Product</h1>` title from `ProductView.tsx` (lines 139-142)
- The `.tabBar` div should become the first child after the container div opens
- Remove the associated `.header` and `.title` CSS classes from `ProductView.module.css` (lines 17-31)
- No replacement header should be added

**Compact control row below sub-tabs (Roadmap tab only)**
- Create a new CSS class `.roadmapControlRow` for a thin horizontal bar
- Height should match the tab bar height (compact, single-line, ~36-40px)
- Only render this row when `activeTab === 'roadmap'` in ProductView
- Background should be subtle (#fafafa) with bottom border consistent with tab bar styling

**Merge Import and Refresh into single button**
- Replace the two buttons ("Import roadmap.md" and "Refresh") with one button labeled "Import/Refresh roadmap.md"
- The unified button should call `handleImport()` which already handles both initial import and refresh operations
- Remove the separate `handleRefresh()` function from ProductRoadmapPage
- Keep existing disabled state logic (disabled when `!activeProject || importing`)

**Inline "Last Imported" status display**
- Move the "Last imported" information into the control row, positioned to the right of the button
- Remove the card-style `.lastImportedPanel` container
- Display inline: revision badge ("Rev N"), timestamp ("X minutes ago"), source badge ("AGENT OS")
- Keep existing badge styles but arrange horizontally with flexbox and gap
- When `lastImportedMetadata` is null, show "Not imported yet" inline in muted text

**Remove old left-side panel structure**
- The current ProductRoadmapPage has an action row at top (lines 345-362) with buttons - this becomes the compact control row
- Remove the separate `.lastImportedPanel` block (lines 372-393)
- Remove inline styles for `actionRowStyles`, `primaryButtonStyles`, `secondaryButtonStyles` (lines 499-528)
- Use CSS module classes instead of inline styles for the control row

**Roadmap tree as sole main content**
- The `.treePanel` wrapper (line 478) should remain the only content below the control row
- Tree should start at the left edge of the content area (left-align, no left margin)
- Tree width should remain constrained (current `350px` min-width pattern from treePanel)
- Right side of content area remains empty (implicit, no explicit empty div needed)

**Relocate control row rendering**
- The compact control row should be rendered in `ProductView.tsx` (not in `ProductRoadmapPage.tsx`)
- This allows tab-conditional rendering: only show when Roadmap tab is active
- Import/refresh handler and metadata state may need to be lifted to ProductView or passed down

**Error and success cards remain in page**
- Keep the existing error card (`.errorCard`) and import summary card (`.importSummaryCard`) in ProductRoadmapPage
- These appear below the control row when errors or import results exist
- CTA section (`.ctaSection`) also remains in ProductRoadmapPage

## Existing Code to Leverage

**ProductView.tsx (lines 137-186)**
- Contains the header div to remove (lines 139-142)
- Tab bar structure (lines 144-167) provides pattern for control row placement
- Content area (lines 170-183) shows where RoadmapPage is rendered
- Tab state `activeTab` can gate control row rendering

**ProductRoadmapPage.tsx (lines 180-228)**
- `handleImport()` (lines 180-211) contains all import/refresh logic - reuse this
- `handleRefresh()` (lines 216-219) simply calls `loadRoadmapItems()` and `loadMetadata()` - can be eliminated
- `lastImportedMetadata` state and `formatTimestamp()` helper for inline display

**ProductView.module.css (lines 33-39)**
- `.tabBar` styling provides height/padding pattern for control row
- Gap and background patterns to match

**ProductRoadmapPage.module.css (lines 36-93)**
- `.lastImportedContent` (lines 54-59) provides flexbox pattern for inline badges
- Badge classes (`.revisionBadge`, `.timestamp`, `.sourceBadge`) can be reused directly

**WorkItemTree component**
- Renders the collapsible initiative/epic tree
- Already used in ProductRoadmapPage - no changes needed

## Out of Scope
- Changes to roadmap import API endpoints or backend behavior
- Changes to tab routing keys or URL query parameter logic
- Modifications to WorkItemTree component or tree behavior
- Changes to import success/error handling logic
- Changes to the Backlog or Implement tab layouts
- Adding new features or functionality beyond layout compaction
- Changes to initiative/epic tree item rendering or styling
- Backend API changes
- Changes to ProjectContext or ArchitectureContext
- Mobile responsive layout adjustments beyond what exists
