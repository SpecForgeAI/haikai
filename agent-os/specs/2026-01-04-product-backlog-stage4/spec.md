# Specification: Product Backlog Stage 4 - Roadmap Epic Anchoring

## Goal
Align the Backlog authoring workflow with Roadmap Epics by hiding archived initiatives/epics by default, restricting feature creation to non-archived epics, and guiding users to import roadmap when no active epics exist.

## User Stories
- As a product owner, I want to see only active roadmap items by default so that my backlog view is not cluttered with archived content.
- As a product owner, I want to add Features only under active Epics so that I maintain proper product hierarchy alignment with the roadmap.

## Specific Requirements

**Archived filter state management**
- Add `showArchivedRoadmapItems` boolean state to ProductBacklogPage (default: false)
- Persist preference to localStorage with key pattern: `product_backlog_show_archived::<projectId>`
- When toggling archived filter, rebuild the tree and clear selection if the selected item becomes hidden

**Filter work items before building tree**
- When `showArchivedRoadmapItems` is false, exclude items where type is INITIATIVE or EPIC and status equals "ARCHIVED"
- Filtering parents naturally hides their descendants since the parent chain is removed from the tree
- Features/Stories under archived epics remain hidden when toggle is off (acceptable per UX rules)

**Filter toggle UI in backlog header**
- Add a header section above the tree panel with hint text: "Features belong under Roadmap Epics."
- Render checkbox or toggle control with label "Show archived roadmap items"
- On toggle change: update state, trigger tree rebuild, adjust selection if currently selected item becomes hidden

**Archived items visual styling when shown**
- When `showArchivedRoadmapItems` is true, archived initiatives/epics appear in tree with existing `.archivedRow` muted styling
- Display "ARCHIVED" badge using existing `.archivedBadge` class from WorkItemTree.module.css
- Archived items remain selectable but feature creation is disabled

**Empty state guidance when no active epics**
- Compute `visibleEpics` count: items where type is EPIC and status is not ARCHIVED
- When `visibleEpics.length === 0`, show guidance block replacing or above tree area
- Guidance text: "No active roadmap epics found." and "Import a roadmap to create epics before adding features."
- Include "Go to Roadmap" button that navigates to `/product/roadmap`
- Still allow toggling "Show archived roadmap items" to reveal archived epics if any exist

**Feature creation gating on epic selection**
- Only enable "+ Add Feature" button when selected item has type EPIC and status is not ARCHIVED
- When selected EPIC is ARCHIVED: show disabled button with tooltip or help text: "Cannot add features under an archived epic."
- Ensure keyboard and mouse interactions are consistent with gating rules

**Selection behavior on filter toggle**
- If current selection becomes hidden due to toggling archived filter OFF, clear `selectedId` to null
- Details panel shows "Select an item to see details." placeholder when selection is cleared

**Preserve existing CRUD functionality**
- Create, edit, and delete operations for FEATURE and STORY remain unchanged
- No new backend API calls are introduced
- Cascade delete warnings continue to function as before

## Existing Code to Leverage

**ProductBacklogPage.tsx (main page component)**
- Already manages `workItems` state array, `selectedId`, and `expandedIds`
- Contains `loadWorkItems` callback and tree building via `buildWorkItemTree`
- Modal orchestration for create/edit/delete already implemented
- Extend with `showArchivedRoadmapItems` state and filtering logic before tree build

**WorkItemTree.tsx (tree renderer)**
- Already supports ARCHIVED badge display via `item.status === 'ARCHIVED'` check
- Has `.archivedRow` and `.archivedBadge` CSS classes applied conditionally
- Receives filtered nodes from parent; no changes needed to tree rendering logic

**WorkItemTree.module.css (tree styles)**
- Contains `.archivedBadge` styling (grey background, uppercase text)
- Contains `.archivedRow` styling (opacity: 0.6, hover opacity: 0.7)
- Reuse these existing styles for archived items when filter is enabled

**workItemTreeBuilder.ts (tree building utility)**
- `buildWorkItemTree(items)` accepts filtered array and returns tree structure
- Filter items before passing to this function to exclude archived roadmap items
- No modifications needed to the builder itself

**WorkItemDetailsPanel.tsx (details panel)**
- Already conditionally renders "+ Add Feature" button when EPIC is selected
- Extend ActionButtons to check `item.status !== 'ARCHIVED'` before enabling feature creation
- Add disabled state and tooltip text for archived epic case

## Out of Scope
- Chat-driven backlog creation or AI assistance
- Changes to backend APIs or database schema
- Changes to feature/story CRUD semantics beyond visibility and gating
- Drag and drop reordering of work items
- Changes to the Roadmap page or roadmap import functionality
- Editing or modifying INITIATIVE or EPIC items from the Backlog page
- Batch operations on multiple work items
- Export or reporting features for backlog items
- Status workflow automation or transitions
- Integration with external issue tracking systems (JIRA, etc.)
