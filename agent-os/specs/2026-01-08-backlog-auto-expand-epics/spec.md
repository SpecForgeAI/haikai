# Specification: Backlog Auto-Expand Epics on Initial Load

## Goal
Ensure the Product Backlog displays all Features under all Epics immediately on initial load, without requiring user interaction, while preserving existing expansion state persistence across tab switches.

## User Stories
- As a product owner, I want to see all Features under all Epics immediately when opening the Backlog tab so that I can review the backlog without manually expanding each Epic.
- As a user, I want my manual expansion/collapse choices to persist across tab switches so that the interface respects my preferences after I have interacted with it.

## Specific Requirements

**Update initial expansion defaults to include EPIC nodes**
- Locate the "first-load initialization" `useEffect` in `ProductBacklogPage.tsx` (lines 239-275)
- Modify the initial expansion computation loop to add both INITIATIVE and EPIC item IDs to the `initialExpanded` Set
- Keep FEATURE nodes collapsed by default (stories remain hidden until user expands a feature)
- Preserve the existing guard: only run when `expandedIds.size === 0` (context empty for this project/tab)
- Preserve the `initializedForProjectRef` guard to prevent re-initialization within the same component lifecycle

**Update the inline comment to reflect new behavior**
- Change the comment on line 260 from "First load: context is empty, compute initial expansion (INITIATIVE nodes expanded)" to "First load: expand INITIATIVE and EPIC nodes so Features are visible under Epics"

**Preserve user state protection**
- The existing `if (expandedIds.size > 0)` guard (lines 254-258) must remain unchanged
- This ensures users who have manually collapsed/expanded nodes retain their state
- The default expansion rule only applies when there is no stored expansion state

**No regression to tab switch persistence**
- The context-backed expansion state via `useProductExpansion` hook must remain the source of truth
- The `setExpandedIds` call to context (line 270) must continue to use the context setter
- Do not introduce any logic that resets expansion state on subsequent loads or tab switches

## Visual Design
No visual mockups provided - this is a behavioral change to existing functionality.

## Existing Code to Leverage

**`ProductBacklogPage.tsx` first-load initialization effect (lines 239-275)**
- Contains the exact location where expansion defaults are computed
- Currently only adds INITIATIVE items to `initialExpanded` Set (lines 261-266)
- Modify the loop condition to include `item.type === 'EPIC'` alongside INITIATIVE
- All guards and ref tracking logic should remain unchanged

**`ProductUiStateContext.tsx` expansion hooks**
- `useProductExpansion` hook (lines 222-256) provides context-backed state
- Returns `expandedIds`, `setExpandedIds`, and `toggleExpanded` bound to project/tab
- Already in use - no changes required to the context

**`ProductRoadmapPage.tsx` initialization pattern (lines 233-263)**
- Shows parallel pattern for roadmap tab initialization
- Demonstrates how to check context empty state and set defaults
- Backlog implementation should mirror this approach (already does for INITIATIVE)

**`WorkItemTree` component**
- Receives `nodesWithExpanded` with `isExpanded` boolean per node
- No changes required - rendering logic handles any expansion state

**Work item type constants**
- Item types: 'INITIATIVE', 'EPIC', 'FEATURE', 'STORY'
- INITIATIVE and EPIC are roadmap items; FEATURE and STORY are backlog items

## Out of Scope
- Backend changes or API modifications
- WorkItemTree rendering logic changes
- Roadmap page expansion behavior changes
- Changes to how expansion state is persisted in ProductUiStateContext
- Changes to create/update/delete handlers beyond the initial expansion fix
- Adding expansion defaults for FEATURE or STORY nodes
- LocalStorage persistence for expansion state (uses in-memory context only)
- Changes to archived filter behavior
- Changes to empty state or error state handling
- Unit test additions or modifications
