# Task Breakdown: Fix Implement Assistant Infinite Render Loop

## Overview
Total Tasks: 16

This bug fix eliminates the "Maximum update depth exceeded" React warning caused by unstable getter function identities in ProductUiStateContext. The fix uses a stateRef pattern to stabilize getter identities while maintaining access to current state values.

## Task List

### Context Layer

#### Task Group 1: Implement stateRef Pattern in ProductUiStateContext
**Dependencies:** None

- [x] 1.0 Complete stateRef pattern implementation
  - [x] 1.1 Write 3 focused tests for stateRef synchronization
    - Test that stateRef.current reflects state after updates
    - Test that stateRef.current is accessible within getter callbacks
    - Test that stateRef updates synchronously with state changes
  - [x] 1.2 Add useRef import to ProductUiStateContext.tsx
    - Modify line 18 imports to include `useRef`
    - Current: `import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';`
    - Target: `import { createContext, useContext, useState, useCallback, useMemo, useRef, ReactNode } from 'react';`
  - [x] 1.3 Add stateRef declaration after useState
    - Add `const stateRef = useRef<ProductUiState>(state);` immediately after line 206
    - Position after: `const [state, setState] = useState<ProductUiState>({});`
  - [x] 1.4 Add synchronization effect for stateRef
    - Add `useEffect(() => { stateRef.current = state; }, [state]);` after stateRef declaration
    - Ensure `useEffect` is imported (add to imports if missing)
    - This keeps ref current with latest state for getter access
  - [x] 1.5 Ensure stateRef tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify ref synchronization works correctly

**Acceptance Criteria:**
- The 3 tests written in 1.1 pass
- stateRef is properly declared and synchronized
- useRef and useEffect are imported

#### Task Group 2: Stabilize Context Getter Functions
**Dependencies:** Task Group 1

- [x] 2.0 Complete getter stabilization
  - [x] 2.1 Verify existing getter stability tests (lines 417-557)
    - Review tests 1.1.1, 1.1.2, 1.1.3 in ProductUiStateContext.test.ts
    - Confirm tests check getter identity stability across state changes
    - These tests define the expected behavior the implementation must match
  - [x] 2.2 Stabilize getExpandedIds getter (lines 212-225)
    - Change dependency array from `[state]` to `[]`
    - Replace `state[projectKey]` with `stateRef.current[projectKey]` in callback body
    - Maintains stable function identity while returning current data
  - [x] 2.3 Stabilize getLastImplementWorkItemId getter (lines 283-292)
    - Change dependency array from `[state]` to `[]`
    - Replace `state[projectKey]` with `stateRef.current[projectKey]` in callback body
    - Ensures work item ID retrieval does not cause re-renders
  - [x] 2.4 Stabilize getImplementChatState getter (lines 317-326)
    - Change dependency array from `[state]` to `[]`
    - Replace `state[projectKey]` with `stateRef.current[projectKey]` in callback body
    - This is the critical getter causing the infinite loop
  - [x] 2.5 Ensure getter stability tests pass
    - Run existing getter stability tests (1.1.1, 1.1.2, 1.1.3, 1.1.4)
    - Verify all 4 getter stability tests pass
    - Confirm getters return correct data after stabilization

**Acceptance Criteria:**
- All 4 existing getter stability tests pass
- Getter function identities remain stable across state changes
- Getters still return correct current data via stateRef
- contextValue useMemo no longer recalculates on state changes

### Component Layer

#### Task Group 3: Review and Verify ImplementationAssistantPanel
**Dependencies:** Task Group 2

- [x] 3.0 Complete panel review and verification
  - [x] 3.1 Write 2 focused tests for hydration effect behavior
    - Test that hydration effect runs only on mount/workItemId/projectKey change
    - Test that disk hydration effect does not trigger redundant calls
  - [x] 3.2 Review hydration useEffect (lines 233-284)
    - Verify `getImplementChatState` in dependency array (line 284) is now stable
    - Confirm effect only runs on mount, workItemId change, or projectKey change
    - Document that no code changes needed if context fix is complete
  - [x] 3.3 Review disk hydration useEffect (lines 301-376)
    - Verify `getImplementChatState` at line 372 is now stable
    - Assess whether redundant disk hydration calls are prevented
    - Add equality guard if needed: skip setState if hydrated messages length equals current
  - [x] 3.4 Ensure panel hydration tests pass
    - Run ONLY the 2 tests written in 3.1
    - Verify hydration effects behave correctly with stable getters

**Acceptance Criteria:**
- The 2 tests written in 3.1 pass
- Hydration effects no longer trigger infinite loops
- Panel renders correctly on mount and tab switches

#### Task Group 4: Optional Optimization - Equality Guard
**Dependencies:** Task Group 2

- [x] 4.0 Complete equality guard optimization (optional)
  - [x] 4.1 Write 2 focused tests for equality guard
    - Test that setImplementChatState skips update when sessionId and messages.length match
    - Test that setImplementChatState applies update when values differ
    - Note: Tests 3.1.1 and 3.1.2 may already cover this (lines 563-653)
  - [x] 4.2 Implement equality guard in setImplementChatState setter
    - Inside setState updater, compare incoming chatState with existing state
    - If sessionId matches AND messages.length matches, return `prev` unchanged
    - This prevents no-op state updates that would trigger ref synchronization
  - [x] 4.3 Ensure equality guard tests pass
    - Run ONLY the equality guard tests (including existing 3.1.1, 3.1.2)
    - Verify guard prevents unnecessary state updates

**Acceptance Criteria:**
- Equality guard tests pass
- No-op setImplementChatState calls do not trigger state updates
- Valid state changes are still applied correctly

### Testing

#### Task Group 5: Regression Testing and Verification
**Dependencies:** Task Groups 1-4

- [x] 5.0 Complete regression testing
  - [x] 5.1 Write 2 regression tests for infinite render loop prevention
    - Test that navigating to Implement tab does not trigger "Maximum update depth exceeded"
    - Test that switching away from and back to Implement tab preserves state without warnings
  - [x] 5.2 Run all feature-specific tests
    - Run all ProductUiStateContext tests (approximately 20 tests)
    - Run hydration effect tests from Task Group 3
    - Run equality guard tests from Task Group 4
    - Verify no regressions in existing functionality
  - [ ] 5.3 Manual verification of bug fix (REQUIRES HUMAN TESTING)
    - Navigate to Implement tab with an existing conversation
    - Switch to another tab (Backlog or Roadmap)
    - Switch back to Implement tab
    - Verify no console warnings about "Maximum update depth exceeded"
    - Verify conversation state is preserved

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 25-30 tests total)
- No "Maximum update depth exceeded" warnings in console
- Conversation state preserved across tab switches
- No regressions in ProductUiStateContext functionality

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: stateRef Pattern** - Foundation for the fix
2. **Task Group 2: Getter Stabilization** - Core bug fix
3. **Task Group 3: Panel Review** - Verify fix effectiveness
4. **Task Group 4: Equality Guard** - Optional optimization (can be skipped if loops are resolved)
5. **Task Group 5: Regression Testing** - Final verification

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/contexts/ProductUiStateContext.tsx` | Main fix location - add stateRef, stabilize getters |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Review/verify - may need equality guard in disk hydration |
| `frontend/src/__tests__/ProductUiStateContext.test.ts` | Existing getter stability tests to verify |

## Technical Notes

- **Pattern**: The stateRef pattern allows getters to have empty dependency arrays (stable identity) while still accessing current state values through the ref
- **Why this works**: `useCallback(fn, [])` creates a stable function reference; reading from `stateRef.current` inside the callback always gets the latest state
- **Risk mitigation**: The synchronization effect `useEffect(() => { stateRef.current = state; }, [state])` ensures the ref stays in sync with state

## Implementation Summary (2026-01-17)

All task groups (1-5) have been implemented:

### Changes Made

**ProductUiStateContext.tsx:**
1. Added `useRef` and `useEffect` imports (line 24)
2. Added `stateRef` declaration after useState (line 219)
3. Added synchronization effect to keep stateRef current (lines 221-225)
4. Stabilized `getExpandedIds` getter - changed deps from `[state]` to `[]`, uses `stateRef.current` (lines 234-247)
5. Stabilized `getLastImplementWorkItemId` getter - changed deps from `[state]` to `[]`, uses `stateRef.current` (lines 308-317)
6. Stabilized `getImplementChatState` getter - changed deps from `[state]` to `[]`, uses `stateRef.current` (lines 345-354)
7. Implemented equality guard in `setImplementChatState` - skips update if sessionId, messages.length, and inputDraft match (lines 363-395)

**ProductUiStateContext.test.ts:**
1. Added 3 tests for stateRef synchronization (Spec 2026-01-17 Task Group 1)
2. Added 3 regression tests for infinite render loop prevention (Spec 2026-01-17 Task Group 5)

### Test Results
- All 28 tests pass
- Getter stability tests verify function identity remains stable across state changes
- stateRef synchronization tests verify current state is accessible via getters
- Regression tests verify no infinite loops occur during typical usage patterns
