# Specification: Preserve Product Tab UI State

## Goal
Fix the UX bug where Product tabs (Backlog, Roadmap, Implement) lose their expanded/collapsed tree state when switching tabs, ensuring users do not lose their navigation context when moving between tabs.

## User Stories
- As a product manager, I want my expanded epics in Backlog to remain expanded after switching to Roadmap and back so that I do not have to re-expand them to see my features.
- As a user working with roadmap items, I want my initiative/epic expansion state in Roadmap to persist across tab switches so that I can efficiently review different aspects of my project.

## Specific Requirements

**ProductUiStateContext creation**
- Create new context file at `src/contexts/ProductUiStateContext.tsx`
- Context must store expansion state keyed by project identifier and tab key
- Expose `getExpandedIds(projectKey, tabKey)` returning `Set<string>`
- Expose `setExpandedIds(projectKey, tabKey, ids)` for bulk state updates
- Expose `toggleExpanded(projectKey, tabKey, id)` for single toggle operations
- Store internal state as `Record<string, { roadmap: string[]; backlog: string[]; implement: string[] }>`
- No localStorage persistence required (in-memory only for session)

**Provider placement to survive tab unmounts**
- Wrap `ProductView` component (or its parent) with `ProductUiStateProvider`
- Provider must remain mounted when Backlog/Roadmap/Implement pages unmount
- Tab pages can unmount/remount without losing expansion state in context

**Project key derivation**
- Derive stable `projectKey` from `loadedFileName` (from ArchitectureContext)
- When `loadedFileName` changes, reset expansion state for new project
- Pass `projectKey` implicitly via context or explicitly as prop to tab pages

**ProductBacklogPage context integration**
- Replace local `expandedIds` state (line 130) with context-backed state
- Read expansion state via `getExpandedIds(projectKey, 'backlog')`
- Write expansion state via context methods instead of local `setExpandedIds`
- On first load with empty context state, compute initial expansion (initiatives expanded)
- Subsequent loads must use context state without resetting to defaults
- Existing `handleToggle` callback must update context, not local state

**ProductRoadmapPage context integration**
- Replace local `expandedIds` state (line 124) with context-backed state
- Read expansion state via `getExpandedIds(projectKey, 'roadmap')`
- On first load with empty context state, expand non-ARCHIVED initiatives
- Subsequent loads must preserve user-modified expansion state
- Maintain existing `handleToggle` callback pattern but target context

**Implement tab minimal wiring**
- ProductImplementPage does not currently have tree expansion state
- Wire a stub entry for `'implement'` tab key in context for future use
- No functional changes required if no tree UI exists today

**Guard against accidental resets**
- Tab switch must NOT trigger effects that reset expansion to defaults
- Data refetch operations must preserve existing expansion state
- Import/refresh actions should keep expansion for IDs that remain valid
- Unknown IDs in expansion set should be naturally ignored (no crash)

## Visual Design
No mockups provided - this is a state persistence fix with no visual changes.

## Existing Code to Leverage

**`src/contexts/ProjectContext.tsx`**
- Pattern for React context with provider, hooks, and typed state
- Shows how to structure context with `createContext`, `useContext`, provider component
- Use similar hook naming pattern (e.g., `useProductUiState`, `useProductExpansion`)
- Follow same provider props pattern with `children: ReactNode`

**`src/contexts/ArchitectureContext.tsx`**
- Source of `loadedFileName` to derive project key
- Shows pattern for complex state management in context
- Demonstrates how context can be consumed by child components
- Tab pages already import and use `useArchitecture()` hook

**`src/components/ProductView/ProductBacklogPage.tsx` lines 130, 284-294**
- Current local `expandedIds` state at line 130: `useState<Set<string>>(new Set())`
- Initial expansion logic in `loadWorkItems` callback (lines 195-202)
- `handleToggle` callback pattern at lines 284-294 for toggling expansion
- This is the primary file to refactor for context integration

**`src/components/ProductView/ProductRoadmapPage.tsx` lines 124, 179-189, 286-296**
- Current local `expandedIds` state at line 124
- Initial expansion logic at lines 183-189 (non-ARCHIVED initiatives)
- `handleToggle` callback at lines 286-296
- Similar refactor pattern needed as ProductBacklogPage

**`src/components/ProductView/ProductView.tsx` lines 224-238**
- Conditional rendering of tab pages that causes unmount/remount
- This is where ProductUiStateProvider should wrap content
- Shows tab switching mechanism via `activeTab` state

## Out of Scope
- Persisting expansion state to localStorage or backend (session memory only)
- Changing how work items are fetched or stored
- Modifying roadmap import behavior or refresh logic
- Optimizing data fetch strategies
- Adding expansion state for non-tree UI elements
- Persisting state across browser sessions
- Syncing expansion state across browser tabs
- Adding collapse all / expand all functionality
- Changing the visual appearance of tree nodes
- Adding keyboard shortcuts for expansion control
