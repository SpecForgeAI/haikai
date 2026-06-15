# Task Breakdown: Fix ProductRoadmapPage Navigation Error

## Overview
Total Tasks: 3

## Task List

### Frontend Navigation Fix

#### Task Group 1: Replace useNavigate with Callback Prop
**Dependencies:** None

- [x] 1.0 Remove useNavigate and replace with callback prop
  - [x] 1.1 Write 2 focused tests for ProductRoadmapPage callback behavior
    - Test that onNavigateToBacklog prop is called when "Go to Backlog" button is clicked
    - Test that component renders correctly when onNavigateToBacklog prop is provided
  - [x] 1.2 Remove useNavigate hook from ProductRoadmapPage
    - Remove import: `import { useNavigate } from 'react-router-dom';`
    - Remove hook call: `const navigate = useNavigate();`
  - [x] 1.3 Add onNavigateToBacklog prop to ProductRoadmapPage
    - Add prop type definition: `onNavigateToBacklog: () => void`
    - Update component signature: `export function ProductRoadmapPage({ onNavigateToBacklog }: { onNavigateToBacklog: () => void })`
  - [x] 1.4 Update handleGoToBacklog to use callback prop
    - Replace `navigate('/product/backlog')` with `onNavigateToBacklog()` call
    - Update useCallback dependency array from `[navigate]` to `[onNavigateToBacklog]`
  - [x] 1.5 Wire callback prop in ProductView
    - Pass `onNavigateToBacklog={() => handleTabChange('backlog')}` when rendering ProductRoadmapPage at line 179
  - [x] 1.6 Update ProductRoadmapPage.test.ts
    - Provide the `onNavigateToBacklog` prop in test setup (mock with jest.fn())
    - Ensure existing tests still pass with the new prop requirement
  - [x] 1.7 Run the 2 tests written in 1.1
    - Verify tests pass
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2 tests written in 1.1 pass
- useNavigate hook is removed from ProductRoadmapPage
- onNavigateToBacklog callback prop is added and properly typed
- handleGoToBacklog calls onNavigateToBacklog() instead of navigate()
- ProductView passes the callback prop correctly
- Existing tests in ProductRoadmapPage.test.ts pass with the new prop

## Files Modified
- `frontend/src/components/ProductView/ProductRoadmapPage.tsx`
- `frontend/src/components/ProductView/ProductView.tsx`
- `frontend/src/__tests__/ProductRoadmapPage.test.ts`

## Execution Order
1. Task Group 1: Replace useNavigate with Callback Prop
