# Specification: Product Implement View Scaffold and Backlog Handoff

## Goal
Introduce the Stage 5 "Implement" view as a usable scaffold, enabling users to select a FEATURE or STORY from Backlog and hand it off to the Implement view for future implementation work.

## User Stories
- As a product owner, I want to select a Feature or Story in Backlog and click "Work on this now" so that I can transition to the Implement view with that item loaded.
- As a developer, I want to deep-link directly to the Implement view with a specific work item so that I can bookmark or share implementation sessions.

## Specific Requirements

**"Work on this now" Button in Backlog Details Panel**
- Add button to WorkItemDetailsPanel when selected item type is FEATURE or STORY
- Button label: "Work on this now"
- Use primary action styling similar to existing action buttons
- onClick navigates to /product/implement?workItemId=<selectedId>
- Button should not appear for INITIATIVE or EPIC types

**URL-Based Routing with Query Parameter**
- Implement view accessible at route pattern /product/implement?workItemId=<uuid>
- Read workItemId from URL query parameter (use URLSearchParams or React Router hooks)
- URL is source of truth for selected work item; no global state required
- Update ProductView to parse tab from URL and support query params

**Implement View Empty State**
- Display empty state when no workItemId in URL or id is invalid/not found
- Message: "Select a feature or story from Backlog to begin."
- Include "Go to Backlog" button that navigates to /product/backlog (or switches tab)
- Center content vertically and horizontally with muted styling

**Implement View Data Loading**
- When workItemId present in URL, fetch work items using existing fetchWorkItems(projectId)
- Find selected item by ID in the fetched array using byId map
- Derive parent chain using existing deriveParentChain utility
- Derive children list using existing childrenByParent map
- Show loading spinner while fetching; show error state on failure

**Implement View Two-Pane Layout**
- Left pane: "Implementation Assistant" placeholder panel (chat scaffold for future)
- Right pane: "Work Item" summary panel with selected item details
- Use flex layout similar to ProductBacklogPage two-column pattern
- Left pane takes majority width (~60-70%), right pane takes remainder

**Left Pane: Implementation Assistant Placeholder**
- Header with title "Implementation Assistant"
- Placeholder content: "Chat assistant coming soon."
- Style consistently with ChatPanel collapsed/empty state patterns
- Reserve space for future chat integration

**Right Pane: Work Item Summary Panel**
- Display: Title, Type badge, Status badge, Description
- Display parent chain as breadcrumb (reuse ParentChainBreadcrumb pattern)
- Display children list with count and item titles
- Read-only display; no edit/delete actions in this view
- Back to Backlog link or button at bottom

**Navigation Between Backlog and Implement**
- "Work on this now" in Backlog navigates to Implement with workItemId in URL
- "Go to Backlog" in Implement empty state switches back to Backlog tab
- Tab bar should reflect active tab state based on current route
- Browser refresh preserves workItemId and reloads item from API

## Existing Code to Leverage

**WorkItemDetailsPanel.tsx ActionButtons Pattern**
- Add "Work on this now" button alongside existing action buttons
- Follow same conditional rendering pattern based on item type
- Use existing actionButtonPrimary styling class
- Reference props structure for adding new onWorkOnThis callback

**workItemTreeBuilder.ts Utilities**
- Use buildWorkItemTree to get byId map and childrenByParent map
- Use deriveParentChain for computing parent chain breadcrumb
- Use childrenByParent.get(itemId) to get direct children array
- All utilities are pure functions and can be reused directly

**ProductBacklogPage.tsx Data Loading Pattern**
- Replicate useEffect/useCallback pattern for fetching work items
- Use loadedFileName from ArchitectureContext as projectId
- Handle loading, error, and success states identically
- Reuse treeResult memoization pattern for derived data

**ProductView.module.css Layout Styles**
- Extend with new styles for Implement view layout
- Reuse .container, .header, .content patterns
- Add two-pane layout styles similar to ProductBacklogPage.module.css
- Follow established color and spacing conventions

**ChatPanel.tsx Placeholder Styling**
- Reference header and content structure for Implementation Assistant placeholder
- Use similar vertical layout with header and main content area
- Apply consistent font sizing and color palette

## Out of Scope
- No LLM integration or actual chat functionality
- No persistence of "implementation session" state to backend
- No architecture/diagram context linking (Context Picker is next increment)
- No spec generation or write-spec functionality
- No work item editing from Implement view
- No real-time updates or WebSocket subscriptions
- No keyboard shortcuts for navigation
- No drag-and-drop between panes
- No work item status updates from Implement view
- No integration with external tools or IDEs
