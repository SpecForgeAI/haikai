# Task Breakdown: Preserve Product Tab UI State

## Overview
Total Tasks: 19

This spec addresses a UX bug where Product tabs (Backlog, Roadmap, Implement) lose their expanded/collapsed tree state when switching tabs. The solution involves creating a new React context to store expansion state that persists across tab unmount/remount cycles.

## Task List

### Context Layer

#### Task Group 1: ProductUiStateContext Creation
**Dependencies:** None

- [x] 1.0 Complete ProductUiStateContext implementation
  - [x] 1.1 Write 4-6 focused tests for ProductUiStateContext
    - Test `getExpandedIds` returns empty Set for unknown project/tab
    - Test `setExpandedIds` stores and retrieves IDs correctly
    - Test `toggleExpanded` adds ID when not present
    - Test `toggleExpanded` removes ID when present
    - Test state isolation between different projectKey values
    - Test state isolation between different tabKey values
  - [x] 1.2 Create context file at `frontend/src/contexts/ProductUiStateContext.tsx`
    - Define `ProductUiState` type as `Record<string, { roadmap: string[]; backlog: string[]; implement: string[] }>`
    - Define `ProductUiStateContextType` interface with methods:
      - `getExpandedIds(projectKey: string, tabKey: 'roadmap' | 'backlog' | 'implement'): Set<string>`
      - `setExpandedIds(projectKey: string, tabKey: 'roadmap' | 'backlog' | 'implement', ids: Set<string>): void`
      - `toggleExpanded(projectKey: string, tabKey: 'roadmap' | 'backlog' | 'implement', id: string): void`
    - Follow pattern from `frontend/src/contexts/ProjectContext.tsx` (lines 34-93)
  - [x] 1.3 Implement ProductUiStateProvider component
    - Use `useState` to manage internal state
    - Initialize state as empty object `{}`
    - Implement `getExpandedIds` to return Set from stored array (or empty Set if not found)
    - Implement `setExpandedIds` to convert Set to array and store
    - Implement `toggleExpanded` to add/remove single ID
    - Wrap children with context Provider
  - [x] 1.4 Create custom hooks for context access
    - `useProductUiState()` - returns full context (throws if outside provider)
    - `useProductExpansion(projectKey: string, tabKey: string)` - convenience hook returning `{ expandedIds, setExpandedIds, toggleExpanded }` bound to specific project/tab
    - Follow hook pattern from `frontend/src/contexts/ProjectContext.tsx` (lines 105-153)
  - [x] 1.5 Ensure context tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all context methods work correctly

**Acceptance Criteria:**
- Context file exists at `frontend/src/contexts/ProductUiStateContext.tsx`
- `getExpandedIds` returns `Set<string>` for valid inputs
- `setExpandedIds` persists state in memory
- `toggleExpanded` correctly adds/removes single IDs
- State is properly keyed by projectKey and tabKey
- Tests from 1.1 pass

**Files to Create:**
- `frontend/src/contexts/ProductUiStateContext.tsx`

**Files to Reference:**
- `frontend/src/contexts/ProjectContext.tsx` (context pattern)
- `frontend/src/contexts/ArchitectureContext.tsx` (complex state management pattern)

---

### Provider Integration Layer

#### Task Group 2: Provider Placement and Project Key Derivation
**Dependencies:** Task Group 1 - COMPLETED

- [x] 2.0 Complete provider integration
  - [x] 2.1 Write 3-5 focused tests for provider placement
    - Test context is accessible within ProductView
    - Test context survives ProductBacklogPage unmount/remount
    - Test context survives ProductRoadmapPage unmount/remount
    - Test project key derivation from loadedFileName
  - [x] 2.2 Wrap ProductView with ProductUiStateProvider
    - Modify `frontend/src/components/ProductView/ProductView.tsx`
    - Place provider at lines 155-241 (around the container div)
    - Provider must wrap entire component including tab bar and content
    - Alternative: Wrap at App.tsx level if ProductView itself unmounts
  - [x] 2.3 Create projectKey derivation helper
    - Create utility function `deriveProjectKey(loadedFileName: string | null): string`
    - Handle null loadedFileName gracefully (return empty string or special key)
    - Add to ProductUiStateContext.tsx or separate utils file
  - [x] 2.4 Verify provider survives tab switches
    - Confirm provider does not unmount when activeTab changes
    - Test that context state persists across tab changes
  - [x] 2.5 Ensure provider integration tests pass
    - Run ONLY the 3-5 tests written in 2.1
    - Verify provider placement is correct

**Acceptance Criteria:**
- ProductUiStateProvider wraps ProductView (or higher)
- Provider remains mounted during tab switches (lines 224-238 of ProductView.tsx)
- projectKey is derived from loadedFileName
- Context is accessible from all three tab pages

**Files to Modify:**
- `frontend/src/components/ProductView/ProductView.tsx` (lines 155-241)

**Files to Reference:**
- `frontend/src/contexts/ArchitectureContext.tsx` (loadedFileName at line 61)
- `frontend/src/contexts/ProductUiStateContext.tsx` (created in Task Group 1)

---

### Page Integration Layer

#### Task Group 3: ProductBacklogPage Context Integration
**Dependencies:** Task Group 2 - COMPLETED

- [x] 3.0 Complete ProductBacklogPage context integration
  - [x] 3.1 Write 4-6 focused tests for backlog expansion state persistence
    - Test initial load with empty context sets initiatives expanded
    - Test subsequent load preserves user-modified expansion state
    - Test toggle updates context (not just local state)
    - Test expansion state survives tab switch and return
    - Test data refetch does not reset expansion state
    - **IMPLEMENTED:** Created `frontend/src/__tests__/ProductBacklogPageExpansionPersistence.test.ts` with 10 tests
  - [x] 3.2 Replace local expandedIds state with context-backed state
    - Remove line 130: `const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());`
    - Import `useProductExpansion` hook from ProductUiStateContext
    - Get projectKey from loadedFileName (via useArchitecture at line 123)
    - Use `const { expandedIds, setExpandedIds, toggleExpanded } = useProductExpansion(projectKey, 'backlog');`
    - **IMPLEMENTED:** Lines 132-142 of ProductBacklogPage.tsx now use context-backed state
  - [x] 3.3 Implement first-load initialization logic
    - Check if context has empty state for this project/tab
    - If empty, compute initial expansion (INITIATIVE nodes expanded) per lines 195-202
    - If not empty, use existing context state (do not reset to defaults)
    - Move initialization logic to useEffect that runs once on mount
    - **IMPLEMENTED:** Lines 234-275 of ProductBacklogPage.tsx implement initialization with ref tracking
  - [x] 3.4 Update handleToggle callback to use context
    - Modify lines 284-294 to call context's toggleExpanded instead of local setExpandedIds
    - Ensure same toggle behavior (add if not present, remove if present)
    - **IMPLEMENTED:** Lines 350-354 of ProductBacklogPage.tsx now use contextToggleExpanded
  - [x] 3.5 Guard against accidental resets
    - Review loadWorkItems callback (lines 181-210)
    - Remove lines 196-202 that reset expandedIds on every load
    - Ensure subsequent data fetches preserve existing expansion state
    - **IMPLEMENTED:** Lines 202-227 of ProductBacklogPage.tsx no longer reset expandedIds on every load
  - [x] 3.6 Ensure ProductBacklogPage tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify expansion state persists across tab switches
    - **VERIFIED:** All 10 tests pass in ProductBacklogPageExpansionPersistence.test.ts

**Acceptance Criteria:**
- [x] Local expandedIds state removed from ProductBacklogPage
- [x] Expansion state read from and written to ProductUiStateContext
- [x] Initial load sets initiatives expanded only when context is empty
- [x] Subsequent loads preserve user-modified expansion state
- [x] handleToggle updates context correctly
- [x] Tests from 3.1 pass

**Files Modified:**
- `frontend/src/components/ProductView/ProductBacklogPage.tsx`

**Files Created:**
- `frontend/src/__tests__/ProductBacklogPageExpansionPersistence.test.ts`

**Implementation Summary (Task Group 3):**
- Removed local `useState<Set<string>>(new Set())` for expandedIds (was at line 130)
- Added imports for `useProductExpansion` and `deriveProjectKey` from ProductUiStateContext
- Added `useRef` for tracking initialization per project
- Used `useProductExpansion(projectKey, 'backlog')` to get context-backed state
- Moved initialization logic to separate useEffect that only runs when context is empty
- Updated handleToggle to use contextToggleExpanded
- Updated handleCreateSuccess to use context's setExpandedIds
- Removed expansion reset from loadWorkItems callback
- All 10 tests pass verifying the implementation

---

#### Task Group 4: ProductRoadmapPage Context Integration
**Dependencies:** Task Group 2 - COMPLETED

- [x] 4.0 Complete ProductRoadmapPage context integration
  - [x] 4.1 Write 4-6 focused tests for roadmap expansion state persistence
    - Test initial load expands non-ARCHIVED initiatives when context empty
    - Test subsequent load preserves user-modified expansion state
    - Test toggle updates context (not just local state)
    - Test expansion state survives tab switch and return
    - Test ARCHIVED initiatives remain collapsed by default on first load
    - **IMPLEMENTED:** Created `frontend/src/__tests__/ProductRoadmapExpansionPersistence.test.ts` with 11 tests covering all scenarios
  - [x] 4.2 Replace local expandedIds state with context-backed state
    - Removed line 124: `const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());`
    - Imported `useProductExpansion` and `deriveProjectKey` from ProductUiStateContext
    - Derived projectKey from loadedFileName at line 129
    - Used `const { expandedIds, setExpandedIds, toggleExpanded } = useProductExpansion(projectKey, 'roadmap');` at line 133
    - **IMPLEMENTED:** Lines 128-133 of ProductRoadmapPage.tsx now use context-backed state
  - [x] 4.3 Implement first-load initialization logic
    - Added `hasInitializedExpansionRef` ref to track initialization status (line 137)
    - Added useEffect (lines 233-263) that checks if context is empty for this project/tab
    - If empty, computes and sets default expansion (non-ARCHIVED INITIATIVEs)
    - If not empty, preserves existing context state
    - Added useEffect (lines 269-271) to reset initialization flag when projectKey changes
    - **IMPLEMENTED:** Lines 222-271 of ProductRoadmapPage.tsx implement initialization with ref tracking
  - [x] 4.4 Update handleToggle callback to use context
    - Modified handleToggle (lines 357-359) to call context's `toggleExpanded(id)` instead of local setExpandedIds
    - Maintains same toggle behavior pattern
    - **IMPLEMENTED:** Lines 353-359 of ProductRoadmapPage.tsx now use context's toggleExpanded
  - [x] 4.5 Guard against accidental resets
    - Reviewed and modified loadRoadmapItems callback (lines 182-214)
    - Removed lines 183-189 that previously reset expandedIds on every load
    - Data refresh now preserves existing expansion state in context
    - **IMPLEMENTED:** Lines 175-214 of ProductRoadmapPage.tsx no longer reset expandedIds
  - [x] 4.6 Ensure ProductRoadmapPage tests pass
    - Ran tests: `npm test -- --run ProductRoadmapExpansionPersistence`
    - All 11 tests passed
    - Verified expansion state persists across tab switches
    - **VERIFIED:** All 11 tests pass in ProductRoadmapExpansionPersistence.test.ts

**Acceptance Criteria:**
- [x] Local expandedIds state removed from ProductRoadmapPage
- [x] Expansion state read from and written to ProductUiStateContext
- [x] Initial load expands non-ARCHIVED initiatives only when context empty
- [x] ARCHIVED initiatives collapsed by default on first load
- [x] Subsequent loads preserve user-modified expansion state
- [x] Tests from 4.1 pass (11 tests passing)

**Files Modified:**
- `frontend/src/components/ProductView/ProductRoadmapPage.tsx`
  - Added imports for `useProductExpansion` and `deriveProjectKey` (line 39)
  - Added `useRef` import (line 34)
  - Added projectKey derivation (line 129)
  - Replaced local expandedIds state with context-backed state (line 133)
  - Added hasInitializedExpansionRef to prevent repeated resets (line 137)
  - Added initialization useEffect for first-load logic (lines 233-263)
  - Added projectKey change detection useEffect (lines 269-271)
  - Updated handleToggle to use context's toggleExpanded (lines 357-359)
  - Removed expansion reset logic from loadRoadmapItems (removed old lines 183-189)

**Files Created:**
- `frontend/src/__tests__/ProductRoadmapExpansionPersistence.test.ts` (11 tests)

**Implementation Summary (Task Group 4):**
- Removed local `useState<Set<string>>(new Set())` for expandedIds (was at line 124)
- Added imports for `useProductExpansion` and `deriveProjectKey` from ProductUiStateContext
- Added `useRef` for tracking initialization per project (hasInitializedExpansionRef)
- Used `useProductExpansion(projectKey, 'roadmap')` to get context-backed state
- Moved initialization logic to separate useEffect that only runs when:
  - Context is empty for this project/tab (first load)
  - We have roadmap items loaded
  - We haven't already initialized (to prevent repeated resets)
- Added effect to reset initialization flag when projectKey changes
- Updated handleToggle to use context's toggleExpanded
- Removed expansion reset from loadRoadmapItems callback
- All 11 tests pass verifying the implementation

---

#### Task Group 5: Implement Tab Stub Wiring
**Dependencies:** Task Group 2 - COMPLETED

- [x] 5.0 Complete Implement tab stub wiring
  - [x] 5.1 Verify ProductImplementPage has no tree expansion state
    - Confirm `frontend/src/components/ProductView/ProductImplementPage.tsx` does not have expandedIds
    - Document that no changes are needed for current implementation
    - **VERIFIED:** ProductImplementPage.tsx does NOT contain any `expandedIds` state or tree expansion UI.
      The component manages only: `loading`, `error`, `workItems`, `contextState`, and `isContextModalOpen` states.
      No tree expansion functionality exists - no changes needed.
  - [x] 5.2 Ensure 'implement' key is supported in context
    - Verify ProductUiStateContext type includes 'implement' as valid tabKey
    - No functional changes required if no tree UI exists
    - **VERIFIED:** ProductUiStateContext.tsx line 21 defines `TabKey = 'roadmap' | 'backlog' | 'implement'`
      and lines 27-31 include `implement: string[]` in the ProjectTabState interface.
      The 'implement' key is fully supported - no changes needed.

**Acceptance Criteria:**
- [x] 'implement' tab key is valid in context type definition
- [x] ProductImplementPage unchanged (no tree expansion state currently)
- [x] Future tree UI in Implement tab can use context when needed

**Files to Reference:**
- `frontend/src/components/ProductView/ProductImplementPage.tsx`
- `frontend/src/contexts/ProductUiStateContext.tsx` (created in Task Group 1)

**Verification Summary (Task Group 5):**
- ProductImplementPage.tsx was reviewed - no expandedIds state exists
- ProductUiStateContext.tsx already includes 'implement' as a valid TabKey
- No code changes were required - this was a verification-only task group
- Future developers can use `useProductExpansion(projectKey, 'implement')` when tree UI is added

---

### Testing Layer

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5 - COMPLETED

- [x] 6.0 Review existing tests and fill critical gaps
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review 4-6 context tests from Task 1.1
      - **REVIEWED:** ProductUiStateContext.test.ts contains 16 tests covering:
        - `getExpandedIds` returns empty Set for unknown project/tab (2 tests)
        - `setExpandedIds` stores and retrieves IDs correctly (2 tests)
        - `toggleExpanded` adds ID when not present (2 tests)
        - `toggleExpanded` removes ID when present (2 tests)
        - State isolation between different projectKey values (2 tests)
        - State isolation between different tabKey values (2 tests)
        - useProductExpansion convenience hook (3 tests)
        - Error handling when used outside provider (1 test)
    - Review 3-5 provider integration tests from Task 2.1
      - **REVIEWED:** ProductUiStateProviderPlacement.test.ts contains 9 tests covering:
        - Context accessibility within ProductView hierarchy (2 tests)
        - Context survives ProductBacklogPage unmount/remount (1 test)
        - Context survives ProductRoadmapPage unmount/remount (1 test)
        - Project key derivation from loadedFileName (4 tests)
        - Provider survives multiple tab switches (1 test)
    - Review 4-6 ProductBacklogPage tests from Task 3.1
      - **REVIEWED:** ProductBacklogPageExpansionPersistence.test.ts contains 10 tests covering:
        - Initial load with empty context sets initiatives expanded (2 tests)
        - Subsequent load preserves user-modified expansion state (1 test)
        - Toggle updates context (2 tests)
        - Expansion state survives tab switch and return (2 tests)
        - Data refetch does not reset expansion state (2 tests)
        - Full lifecycle scenario (1 test)
    - Review 4-6 ProductRoadmapPage tests from Task 4.1
      - **REVIEWED:** ProductRoadmapExpansionPersistence.test.ts contains 11 tests covering:
        - Initial load expands non-ARCHIVED initiatives when context empty (2 tests)
        - Subsequent load preserves user-modified expansion state (2 tests)
        - Toggle updates context (2 tests)
        - Expansion state survives tab switch and return (2 tests)
        - ARCHIVED initiatives remain collapsed by default on first load (2 tests)
        - Project key derivation and isolation for roadmap (1 test)
    - **TOTAL EXISTING TESTS: 46 tests**
  - [x] 6.2 Analyze test coverage gaps for this feature
    - Identified critical end-to-end workflows lacking explicit coverage:
      - Tab switch round-trip with cross-tab state verification
      - Backlog -> Implement -> Backlog navigation
      - Project change (loadedFileName change) resets state
      - Import/refresh preserves expansion for valid IDs
      - Unknown IDs gracefully ignored (no crash)
      - Empty projectKey (no file loaded) edge case
    - Focus verified on: tab switch round-trip, project change reset, data refetch preservation
    - Did NOT assess entire application test coverage - only this feature
  - [x] 6.3 Write up to 8 additional integration tests
    - **CREATED:** `frontend/src/__tests__/ProductExpansionPersistence.test.ts` with 8 tests:
      1. Test: Backlog expansion survives Backlog -> Roadmap -> Backlog navigation
      2. Test: Roadmap expansion survives Roadmap -> Backlog -> Roadmap navigation
      3. Test: Backlog -> Implement -> Backlog preserves expansion
      4. Test: Changing loadedFileName resets expansion state for new project
      5. Test: Import/refresh on Roadmap preserves expansion for valid IDs
      6. Test: Unknown IDs in expansion set are gracefully ignored (no crash)
      7. Test: Multiple tab switches preserve both Backlog and Roadmap state independently
      8. Test: Context handles empty projectKey (no file loaded) gracefully
  - [x] 6.4 Run feature-specific tests only
    - Ran command: `npm test -- --run ProductUiStateContext ProductUiStateProviderPlacement ProductBacklogPageExpansionPersistence ProductRoadmapExpansionPersistence ProductExpansionPersistence`
    - **TOTAL: 54 tests (all passed)**
      - ProductExpansionPersistence.test.ts: 8 tests
      - ProductUiStateContext.test.ts: 16 tests
      - ProductUiStateProviderPlacement.test.ts: 9 tests
      - ProductRoadmapExpansionPersistence.test.ts: 11 tests
      - ProductBacklogPageExpansionPersistence.test.ts: 10 tests
    - Did NOT run entire application test suite
    - All critical workflows verified passing

**Acceptance Criteria:**
- [x] All feature-specific tests pass (54 tests total)
- [x] Critical tab-switch workflows covered
- [x] Project change behavior covered
- [x] Data refetch preservation verified
- [x] No more than 8 additional tests added in gap analysis (exactly 8 added)

**Test Files Reviewed:**
- `frontend/src/__tests__/ProductUiStateContext.test.ts` (16 tests)
- `frontend/src/__tests__/ProductUiStateProviderPlacement.test.ts` (9 tests)
- `frontend/src/__tests__/ProductBacklogPageExpansionPersistence.test.ts` (10 tests)
- `frontend/src/__tests__/ProductRoadmapExpansionPersistence.test.ts` (11 tests)

**Test Files Created:**
- `frontend/src/__tests__/ProductExpansionPersistence.test.ts` (8 integration tests)

**Implementation Summary (Task Group 6):**
- Reviewed all 46 existing tests from Task Groups 1-5
- Identified 6 critical coverage gaps in end-to-end workflows
- Created 8 new integration tests to fill gaps:
  - Tab switch round-trip tests (Backlog->Roadmap->Backlog, Roadmap->Backlog->Roadmap)
  - Implement tab navigation test (Backlog->Implement->Backlog)
  - Project change reset test (loadedFileName change)
  - Import/refresh preservation test
  - Unknown IDs graceful handling test
  - Multiple tab switches with independent state test
  - Empty projectKey edge case test
- All 54 feature-specific tests pass
- Feature implementation verified complete

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Context Creation** (no dependencies)
   - Create ProductUiStateContext with state management
   - Implement hooks for context access

2. **Task Group 2: Provider Integration** (depends on TG1)
   - Wrap ProductView with provider
   - Implement projectKey derivation

3. **Task Groups 3 & 4: Page Integration** (depend on TG2, can run in parallel)
   - Task Group 3: ProductBacklogPage context integration
   - Task Group 4: ProductRoadmapPage context integration

4. **Task Group 5: Implement Tab Stub** (depends on TG2)
   - Verify no changes needed for Implement tab
   - Document stub support for future use

5. **Task Group 6: Test Review** (depends on TG1-5)
   - Review all tests from previous groups
   - Fill critical coverage gaps
   - Run final verification

---

## Key Implementation Notes

### State Shape
```typescript
type TabKey = 'roadmap' | 'backlog' | 'implement';
type ProductUiState = Record<string, {
  roadmap: string[];
  backlog: string[];
  implement: string[];
}>;
```

### First-Load vs Subsequent-Load Logic
The critical distinction for both BacklogPage and RoadmapPage:

**First load (context empty for project/tab):**
- Compute default expansion based on data (INITIATIVE nodes)
- Store computed expansion in context

**Subsequent load (context has data for project/tab):**
- Use context state directly
- Do NOT recompute defaults
- Preserve user modifications

### Guard Against Resets
Key areas to protect:
1. `loadWorkItems` callback in ProductBacklogPage (lines 195-202)
2. `loadRoadmapItems` callback in ProductRoadmapPage (lines 183-189)
3. Tab switch effects
4. Data refetch operations

### Files Summary

**New Files:**
- `frontend/src/contexts/ProductUiStateContext.tsx`
- `frontend/src/__tests__/ProductUiStateContext.test.ts`
- `frontend/src/__tests__/ProductUiStateProviderPlacement.test.ts`
- `frontend/src/__tests__/ProductBacklogPageExpansionPersistence.test.ts`
- `frontend/src/__tests__/ProductRoadmapExpansionPersistence.test.ts`
- `frontend/src/__tests__/ProductExpansionPersistence.test.ts`

**Modified Files:**
- `frontend/src/components/ProductView/ProductView.tsx`
- `frontend/src/components/ProductView/ProductBacklogPage.tsx`
- `frontend/src/components/ProductView/ProductRoadmapPage.tsx`
