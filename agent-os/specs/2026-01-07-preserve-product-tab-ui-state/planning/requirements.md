# Preserve Product tab UI state across tab switches (Backlog/Roadmap/Implement) - keep expanded tree state

## Title
Preserve Product tab UI state across tab switches (Backlog/Roadmap/Implement) - keep expanded tree state

## Intent
Fix the UX bug where Backlog (and other Product tabs) lose their UI state when switching tabs
(e.g., features appear to "disappear" because the epic expansion state resets on remount).
Ensure Product tab pages retain UI state across tab switches, with minimum scope being
the expanded/collapsed state of the roadmap/backlog trees.

## Scope
- frontend only
- Product area components only (ProductView + ProductBacklogPage + ProductRoadmapPage, and Implement if applicable)
- no backend changes
- no schema changes

## Non-Goals
- Changing how work items are stored/persisted (this is UI state only)
- Changing roadmap import behavior
- Optimizing fetch strategies (can remain as-is)

## Root Cause (Current Behavior)
- ProductView conditionally renders tab pages, so switching tabs unmounts/remounts pages
- Backlog/Roadmap keep expanded/collapsed state in component-local state
- On remount, initial expansion only expands initiatives, collapsing epics and hiding features

## Requirements

### 1) Do not lose expanded/collapsed state on tab switches
- When user expands initiatives/epics in Backlog or Roadmap, then switches tabs and returns,
  the same nodes must remain expanded.
- Minimum requirement: preserve expansion state for:
  - Backlog tree (initiative/epic/feature/story)
  - Roadmap tree (initiative/epic)

### 2) Persist per-project and per-tab (in-memory)
- Expansion state should persist for the currently opened project/file during the session.
- When user opens a different project, expansion state should reset for that new project.

### 3) Implementation approach
- Introduce a small Product UI state store (React context) that lives above tab pages so it is not destroyed on unmount.
- Store expansion sets keyed by:
  - project identifier (prefer activeProject.id; fall back to current filename)
  - tab (roadmap/backlog/implement)
- Tab pages must read and write expansion state through this context rather than component-local state.

### 4) Backward compatibility
- If no expansion state exists yet (first render), use current initial expansion logic.
- Once user changes expansion state, the context becomes the source of truth.

## Implementation Details

### A) Add ProductUiStateContext
- Create:
  - src/contexts/ProductUiStateContext.tsx
- Context value:
  - getExpandedIds(projectKey: string, tabKey: 'roadmap'|'backlog'|'implement'): Set<string>
  - setExpandedIds(projectKey, tabKey, ids: Set<string>): void
  - toggleExpanded(projectKey, tabKey, id: string): void
  - resetProjectState(projectKey): void (optional)
- Internally store:
  - expandedByProject: Record<string, { roadmap: string[]; backlog: string[]; implement: string[] }>
  (store as arrays for serialization/simple state updates; expose as Set in helpers)

### B) Provide context high enough to survive tab switches
- Wrap ProductView (or the Product area router) with ProductUiStateProvider
  so Backlog/Roadmap/Implement pages can unmount but the state persists.

### C) Define projectKey consistently
- In ProductView, derive a stable key:
  - Prefer: activeProject.id (from existing project/active project state)
  - Else: currentFilename (top-right name) if that is already tracked
- Pass projectKey down or let pages read from the same source.

### D) Update ProductBacklogPage to use context
- Replace local `expandedIds` state with:
  - const { expandedIds, setExpandedIds/toggleExpanded } from context for (projectKey,'backlog')
- Initial expansion:
  - On first successful work item load:
    - if context has no entries yet for backlog (empty array AND a "hasInitialized" flag is false):
      - compute initialExpanded (current behavior)
      - setExpandedIds(...) in context
- On expand/collapse clicks:
  - use toggleExpanded(...) and do NOT recreate/reset expanded state on every fetch

### E) Update ProductRoadmapPage similarly
- Use context for (projectKey,'roadmap')
- Preserve initiative/epic expansion exactly as user left it.

### F) Implement tab (minimal)
- If Implement has any tree/selection state that resets and is user-visible:
  - store minimum needed selection/expansion in context under 'implement'
- If Implement is not tree-based today, no changes required beyond wiring stub.

### G) Guard against accidental resets
- Ensure that switching tabs does NOT trigger any effect that resets expanded state to defaults.
- Any "refresh" action (e.g., import/refresh roadmap) should:
  - keep existing expanded state where possible (IDs stable)
  - if IDs change materially, allow expanded state to naturally drop unknown ids.

## Acceptance Criteria
- Create features in Backlog under an epic, expand that epic, switch to Roadmap and back to Backlog:
  - the same epic remains expanded and the features are still visible without any additional action.
- Roadmap expanded state also persists across tab switches.
- Opening a different project resets product UI expansion state for that new project.
- No regressions to existing work item fetching/saving behavior.
