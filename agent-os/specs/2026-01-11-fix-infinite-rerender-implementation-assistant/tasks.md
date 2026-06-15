# Task Breakdown: Fix Infinite Re-render Loop in Implementation Assistant

## Overview
Total Tasks: 14

This is a frontend-only React bugfix focused on stabilizing context getter function identities to eliminate the infinite re-render loop ("Maximum update depth exceeded") when navigating to Product & Delivery -> Implement tab.

## Task List

### Context Stabilization Layer

#### Task Group 1: Stabilize ProductUiStateContext Getter Functions
**Dependencies:** None

- [x] 1.0 Complete context getter stabilization
  - [x] 1.1 Write 4 focused tests for getter stability
    - Test that `getExpandedIds` function identity remains stable across state changes
    - Test that `getLastImplementWorkItemId` function identity remains stable across state changes
    - Test that `getImplementChatState` function identity remains stable across state changes
    - Test that context value identity remains stable when only state (not structure) changes
    - Location: `frontend/src/__tests__/ProductUiStateContext.test.ts` (extend existing file)
  - [x] 1.2 Add stateRef pattern to ProductUiStateContext.tsx
    - Add `const stateRef = useRef(state)` after line 186 (after useState declaration)
    - Add sync assignment: `stateRef.current = state` (synchronous during render, not useEffect)
    - Import `useRef` from React
  - [x] 1.3 Stabilize getExpandedIds getter (lines 192-205)
    - Change dependency from `[state]` to `[]`
    - Replace `state[projectKey]` with `stateRef.current[projectKey]` inside callback
    - Verify function still returns correct data
  - [x] 1.4 Stabilize getLastImplementWorkItemId getter (lines 263-272)
    - Change dependency from `[state]` to `[]`
    - Replace `state[projectKey]` with `stateRef.current[projectKey]` inside callback
  - [x] 1.5 Stabilize getImplementChatState getter (lines 297-306)
    - Change dependency from `[state]` to `[]`
    - Replace `state[projectKey]` with `stateRef.current[projectKey]` inside callback
    - This is the primary getter causing the infinite loop
  - [x] 1.6 Verify contextValue useMemo dependencies (lines 331-350)
    - With stable getters (empty deps), contextValue identity should remain stable
    - No changes needed to dependency array; getters are now stable
  - [x] 1.7 Ensure context getter tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify all getters return correct data with stateRef pattern
    - Command: `npm test -- run ProductUiStateContext`

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- `getExpandedIds`, `getLastImplementWorkItemId`, and `getImplementChatState` have stable function identities
- Context still returns correct state data through getters
- No TypeScript errors introduced

### Consumer Component Fixes

#### Task Group 2: Fix ImplementationAssistantPanel Effect Dependencies
**Dependencies:** Task Group 1

- [x] 2.0 Complete consumer component fixes
  - [x] 2.1 Write 3 focused tests for effect behavior
    - Test that hydration effect runs only once on mount (not on every render)
    - Test that persist effect does not create infinite loop
    - Test that chat state persists correctly on meaningful state changes
    - Location: `frontend/src/__tests__/ImplementationAssistantPanelEffects.test.tsx` (new file)
  - [x] 2.2 Destructure context methods at component top level
    - Extract `getImplementChatState` and `setImplementChatState` from `uiStateContext`
    - Place destructuring near line 85 after `const uiStateContext = useProductUiState()`
    - This enables individual methods in dependency arrays
  - [x] 2.3 Fix persistChatState callback dependencies (lines 106-119)
    - Remove `uiStateContext` from dependency array at line 119
    - Add only `setImplementChatState` to dependencies (already stable with `[]` deps)
    - Resulting deps: `[projectKey, workItemId, sessionId, messages, generatedSpecs, error, inputMessage, setImplementChatState]`
  - [x] 2.4 Fix hydration useEffect dependencies (lines 125-160)
    - Remove `uiStateContext` from dependency array at line 160
    - Add `getImplementChatState` to dependencies (now stable after Task Group 1 fixes)
    - Resulting deps: `[projectKey, workItemId, getImplementChatState]`
  - [x] 2.5 Verify persist useEffect behavior (lines 166-171)
    - Confirm `persistChatState` in deps does not cause infinite loop
    - Effect should only re-run on meaningful state changes after fixes
    - Verify persistChatState callback identity is stable due to fixed deps
  - [x] 2.6 Ensure consumer component tests pass
    - Run ONLY the 3 tests written in 2.1
    - Verify no infinite loop occurs during mount and hydration
    - Command: `npm test -- run ImplementationAssistantPanelEffects`

**Acceptance Criteria:**
- The 3 tests written in 2.1 pass
- No "Maximum update depth exceeded" error when mounting component
- Chat state hydration works correctly on initial mount
- Chat state persists correctly on state changes

### Deep Equality Guard (Optional Enhancement)

#### Task Group 3: Add Deep Equality Guard in setImplementChatState
**Dependencies:** Task Group 1

- [x] 3.0 Complete deep equality guard implementation
  - [x] 3.1 Write 2 focused tests for equality guard
    - Test that setImplementChatState does not trigger state update when values are equivalent
    - Test that setImplementChatState does trigger state update when values differ
    - Location: `frontend/src/__tests__/ProductUiStateContext.test.ts` (extend existing file)
  - [x] 3.2 Implement shallow comparison guard in setImplementChatState
    - Add comparison before updating state in setImplementChatState (lines 311-328)
    - Compare chatState fields: sessionId, messages.length, generatedSpecs, error, inputDraft
    - Return `prev` unchanged if values are equivalent to avoid unnecessary re-renders
    - Use manual field comparison for shallow equality check
  - [x] 3.3 Ensure equality guard tests pass
    - Run ONLY the 2 tests written in 3.1
    - Verify unnecessary state updates are prevented
    - Command: `npm test -- run ProductUiStateContext`

**Acceptance Criteria:**
- The 2 tests written in 3.1 pass
- setImplementChatState skips state update when new value equals existing value
- State updates still occur correctly when values differ

### Regression Testing

#### Task Group 4: Test Review and Regression Test
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete regression testing
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4 tests written for context stabilization (Task 1.1)
    - Review the 3 tests written for consumer component fixes (Task 2.1)
    - Review the 2 tests written for equality guard (Task 3.1)
    - Total existing tests: 9 tests
  - [x] 4.2 Analyze test coverage gaps for this bugfix only
    - Identify if end-to-end infinite loop prevention is explicitly tested
    - Check if context value stability across multiple state updates is tested
    - Focus ONLY on gaps related to the infinite re-render bug
  - [x] 4.3 Write up to 5 additional strategic tests if necessary
    - Add integration test that renders ProductUiStateProvider with ImplementationAssistantPanel
    - Verify "Maximum update depth exceeded" warning is not logged during render
    - Verify setImplementChatState is called at most once during initial mount/hydration
    - Verify chat state persistence still functions correctly after the fix
    - Verify tab switching does not cause infinite loops
    - Location: `frontend/src/__tests__/ImplementationAssistantInfiniteLoopRegression.test.tsx` (new file)
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this bugfix (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 9-14 tests
    - Verified: 30 total tests passing (22 context tests + 3 effect tests + 5 regression tests)
    - Commands:
      - `npm test -- run ProductUiStateContext` (22 tests)
      - `npm test -- run ImplementationAssistantPanelEffects` (3 tests)
      - `npm test -- run ImplementationAssistantInfiniteLoopRegression` (5 tests)
    - Verify all tests pass and no regressions introduced

**Acceptance Criteria:**
- All feature-specific tests pass (30 tests total)
- No infinite re-render loop when navigating to Implement tab
- Chat state hydration and persistence work correctly
- Existing ProductUiStateContext functionality unaffected

## Execution Order

Recommended implementation sequence:

1. **Context Stabilization Layer (Task Group 1)** - Must be completed first as it addresses the root cause
   - Stabilize getter function identities using stateRef pattern
   - This enables Task Group 2 fixes to work correctly

2. **Consumer Component Fixes (Task Group 2)** - Depends on Task Group 1
   - Fix effect dependencies in ImplementationAssistantPanel
   - Leverage stable getters from context

3. **Deep Equality Guard (Task Group 3)** - Can run in parallel with Task Group 2
   - Optional enhancement for additional protection
   - Prevents unnecessary state updates

4. **Regression Testing (Task Group 4)** - Depends on all previous groups
   - Review all tests and fill critical gaps
   - Verify end-to-end fix works correctly

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/contexts/ProductUiStateContext.tsx` | Add stateRef, stabilize 3 getters, equality guard |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Fix effect dependencies, destructure context methods |
| `frontend/src/__tests__/ProductUiStateContext.test.ts` | Add 6 new tests for getter stability and equality guard |
| `frontend/src/__tests__/ImplementationAssistantPanelEffects.test.tsx` | New file with 3 effect behavior tests |
| `frontend/src/__tests__/ImplementationAssistantInfiniteLoopRegression.test.tsx` | New file with 5 regression tests |

## Technical Notes

### Root Cause Analysis
The infinite loop occurs because:
1. Getter functions (`getExpandedIds`, `getLastImplementWorkItemId`, `getImplementChatState`) have `[state]` as dependency
2. When state changes, getter function identities change
3. This causes `contextValue` to get a new identity (useMemo deps include getters)
4. Consumer components with getters in effect deps re-run effects
5. Effects call setters, which update state
6. Cycle repeats infinitely

### Solution Approach
- Use `useRef` to store state reference that can be read inside stable callbacks
- Change getter deps from `[state]` to `[]` so function identity remains stable
- Getters read from `stateRef.current` instead of `state` directly
- Update stateRef synchronously during render (not in useEffect) to ensure getters read fresh data
- This pattern is already used successfully in many React codebases

### Existing Patterns to Leverage
- Stable setter pattern already exists in ProductUiStateContext.tsx (setExpandedIds, toggleExpanded, etc.)
- isPersisting ref guard in ImplementationAssistantPanel.tsx (line 99)
- ProductUiStateContext.test.ts test structure with renderHook and wrapper pattern

## Implementation Summary

### Changes Made

1. **ProductUiStateContext.tsx**
   - Added `stateRef = useRef(state)` pattern with synchronous update during render
   - Stabilized `getExpandedIds`, `getLastImplementWorkItemId`, `getImplementChatState` getters with `[]` deps
   - Added `areChatStatesEquivalent()` helper function for equality guard
   - Added equality guard in `setImplementChatState` to prevent unnecessary state updates

2. **ImplementationAssistantPanel.tsx**
   - Destructured `getImplementChatState` and `setImplementChatState` from context at top level
   - Fixed `persistChatState` callback dependencies (removed `uiStateContext`)
   - Fixed hydration `useEffect` dependencies (uses stable `getImplementChatState`)

3. **Tests Created**
   - `ProductUiStateContext.test.ts`: Extended with 6 new tests (4 getter stability + 2 equality guard)
   - `ImplementationAssistantPanelEffects.test.tsx`: New file with 3 effect behavior tests
   - `ImplementationAssistantInfiniteLoopRegression.test.tsx`: New file with 5 regression tests
