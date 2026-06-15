# Task Breakdown: User Journey Native Diagram Type and Renderer

## Overview
Total Tasks: 27 (across 4 task groups)

This feature registers `USER_JOURNEY` as a first-class diagram type, integrates the existing `UserJourneyDiagramRenderer` into the Canvas.tsx dispatch chain, adds auto-sized SVG content bounds, and excludes the type from manual creation in the NewDiagramModal.

## Task List

### Type Registry and Modal Filtering

#### Task Group 1: DiagramType Registry Extension and NewDiagramModal Filtering
**Dependencies:** None

- [x] 1.0 Complete DiagramType registry extension and modal filtering
  - [x] 1.1 Write 5 focused tests for registry and modal changes
    - Test 1: `USER_JOURNEY` is present in `ALL_DIAGRAM_TYPES` array
    - Test 2: `DIAGRAM_TYPE_LABELS` maps `USER_JOURNEY` to `'User Journey'`
    - Test 3: `normalizeDiagramType('user_journey')` and `normalizeDiagramType('user journey')` both return `'USER_JOURNEY'`
    - Test 4: `USER_JOURNEY` is NOT present in `CREATABLE_DIAGRAM_TYPES`
    - Test 5: `NewDiagramModal` does not render a `User Journey` option in its type `<select>` dropdown
    - Place registry tests (1-4) in a new file: `frontend/src/types/__tests__/diagramType.test.ts`
    - Place modal test (5) as an additional test in: `frontend/src/components/DiagramsView/modals/__tests__/NewDiagramModal.test.tsx`
  - [x] 1.2 Add `USER_JOURNEY` to the `DiagramType` union type in `frontend/src/types/diagramType.ts`
    - Extend the union: `'General' | 'ER' | 'Sequence' | 'Activity' | 'State' | 'UI_Workflow' | 'UI_SCREEN' | 'USER_JOURNEY'`
    - Add `'USER_JOURNEY'` to the `ALL_DIAGRAM_TYPES` array
    - Add `USER_JOURNEY: 'User Journey'` to the `DIAGRAM_TYPE_LABELS` record
    - Add `user_journey: 'USER_JOURNEY'` and `'user journey': 'USER_JOURNEY'` entries to `DIAGRAM_TYPE_MAP`
  - [x] 1.3 Define `CREATABLE_DIAGRAM_TYPES` constant in `frontend/src/types/diagramType.ts`
    - Export a new constant `CREATABLE_DIAGRAM_TYPES` containing all diagram types except `USER_JOURNEY`
    - Place adjacent to `ALL_DIAGRAM_TYPES` for discoverability
    - This is an explicit array (not a filter), making it easy to exclude future non-creatable types
  - [x] 1.4 Update `NewDiagramModal.tsx` to use `CREATABLE_DIAGRAM_TYPES`
    - Change the import in `frontend/src/components/DiagramsView/modals/NewDiagramModal.tsx` from `ALL_DIAGRAM_TYPES` to `CREATABLE_DIAGRAM_TYPES`
    - Update line 166 to iterate `CREATABLE_DIAGRAM_TYPES` instead of `ALL_DIAGRAM_TYPES`
    - No other structural or logic changes required
  - [x] 1.5 Ensure Task Group 1 tests pass
    - Run ONLY the 5 tests written in 1.1 (the 4 registry tests and 1 modal test)
    - Verify existing 3 NewDiagramModal tests still pass (regression check)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `USER_JOURNEY` appears in `ALL_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS`, and `DIAGRAM_TYPE_MAP`
- `normalizeDiagramType` resolves `'user_journey'` and `'user journey'` to `'USER_JOURNEY'`
- `CREATABLE_DIAGRAM_TYPES` exists and excludes `USER_JOURNEY`
- `NewDiagramModal` type dropdown does not offer `User Journey` as an option
- All 5 new tests pass; existing 3 NewDiagramModal tests remain green

### Renderer Adaptation

#### Task Group 2: UserJourneyDiagramRenderer Extension for Canvas Context
**Dependencies:** Task Group 1

- [x] 2.0 Complete renderer extension for Canvas context
  - [x] 2.1 Write 4 focused tests for renderer adaptation and content bounds
    - Test 1: `computeContentBounds` returns correct `{ width, height }` for a 2-lane, 3-step diagram (verifying max x+width and max y+height plus padding)
    - Test 2: `computeContentBounds` returns a minimum fallback size for an empty diagram (0 lanes, 0 steps)
    - Test 3: Renderer calls `onContentBounds` callback (when provided) with computed dimensions after layout
    - Test 4: Renderer renders without errors when `onContentBounds` is not provided (backward compatibility with journey review flow)
    - Place tests in: `frontend/src/components/DiagramsView/__tests__/UserJourneyDiagramRenderer.test.tsx` (append to existing file)
  - [x] 2.2 Extract `computeContentBounds` utility from `computeLayout` results
    - Add an exported function `computeContentBounds` in `UserJourneyDiagramRenderer.tsx` (or a separate utility file)
    - Input: the `laneRects` and `stepPositions` returned by `computeLayout`, plus a padding margin constant (e.g., 40px)
    - Output: `{ width: number; height: number }` representing the total content dimensions
    - Computation: find max(x + width) across all lane rects and step positions, find max(y + height) across all, add padding margin to each
  - [x] 2.3 Add optional `onContentBounds` callback prop to the renderer
    - Extend `UserJourneyDiagramRendererProps` with `onContentBounds?: (bounds: { width: number; height: number }) => void`
    - After `computeLayout` runs, call `computeContentBounds` and invoke `onContentBounds` if provided
    - Use `useEffect` or `useLayoutEffect` to report bounds after render (avoid calling during render)
    - Ensure the callback is NOT called when rendering in the journey review context (it simply won't be passed)
  - [x] 2.4 Add default render_hints handling
    - If `render_hints` fields are missing or malformed, default to: `lane_axis: 'HORIZONTAL'`, `flow_direction: 'LEFT_TO_RIGHT'`, `show_title: true`
    - Apply defaults at the top of the renderer component before using the values
  - [x] 2.5 Verify existing 7 renderer tests remain green
    - Run ALL 7 existing tests in `UserJourneyDiagramRenderer.test.tsx` plus the 4 new tests from 2.1
    - Confirm no regressions to the existing rendering behavior
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `computeContentBounds` correctly calculates total diagram dimensions from layout output
- `onContentBounds` callback is invoked with computed dimensions when provided
- Renderer works identically to before when `onContentBounds` is not provided
- Missing `render_hints` values fall back to safe defaults
- All 7 existing tests + 4 new tests pass (11 total)

### Canvas Integration

#### Task Group 3: Canvas.tsx Dispatch Chain Integration with Auto-Sizing
**Dependencies:** Task Group 2

- [x] 3.0 Complete Canvas.tsx integration with auto-sized SVG
  - [x] 3.1 Write 4 focused tests for Canvas dispatch and auto-sizing
    - Test 1: When `diagram.diagram_type === 'USER_JOURNEY'`, the `UserJourneyDiagramRenderer` component is dispatched (not the General fallback renderer)
    - Test 2: When `diagram.diagram_type === 'USER_JOURNEY'`, the SVG viewBox dimensions match the computed content bounds (not `appConfig.canvas.defaultWidth/defaultHeight`)
    - Test 3: When `diagram.diagram_type === 'General'`, the existing General renderer is dispatched (no regression)
    - Test 4: The `UserJourneyDiagramRenderer` receives the correct `diagram` data (extracted from the native Diagram object's embedded journey data) and `zoom` prop
    - Place tests in: `frontend/src/components/DiagramsView/__tests__/UserJourneyCanvasIntegration.test.tsx` (new file, following the pattern of `SequenceDiagramCanvasIntegration.test.ts`)
  - [x] 3.2 Add `isUserJourneyDiagram` boolean check in Canvas.tsx
    - Near line 708 (alongside `isActivityDiagram`, `isStateDiagram`, `isUIWorkflowDiagram`), add: `const isUserJourneyDiagram = getDiagramType(diagram) === 'USER_JOURNEY';`
    - Follow the exact same pattern as the existing checks
  - [x] 3.3 Import `UserJourneyDiagramRenderer` in Canvas.tsx
    - Add import at the top of `Canvas.tsx` (near lines 117-124) following the same pattern as `ActivityDiagramRenderer`, `StateDiagramRenderer`, `UIWorkflowDiagramRenderer`
    - Import: `import UserJourneyDiagramRenderer from './UserJourneyDiagramRenderer';`
  - [x] 3.4 Add `USER_JOURNEY` dispatch branch in the renderer conditional chain
    - Insert after `isUIWorkflowDiagram` and before the General fallback (near line 3496)
    - Pattern: `isUserJourneyDiagram ? (<UserJourneyDiagramRenderer ... />) : (/* General fallback */)`
    - Pass `diagram` data: extract the `UserJourneyDiagramDto` from the native `Diagram` object's embedded data (the diagram object's typed content or a dedicated field holding the journey JSON)
    - Pass `zoom={zoom}` prop
    - Pass `onContentBounds` callback to receive computed dimensions
  - [x] 3.5 Implement auto-sized SVG viewBox for User Journey diagrams
    - Add local state to Canvas.tsx (or the wrapper) for content dimensions: `const [journeyBounds, setJourneyBounds] = useState<{ width: number; height: number } | null>(null)`
    - When `isUserJourneyDiagram` is true and `journeyBounds` is available, override `canvasWidth` and `canvasHeight` with `journeyBounds.width` and `journeyBounds.height`
    - The SVG `width`, `height`, and `viewBox` attributes should reflect the auto-sized dimensions (multiplied by zoom for width/height pixel values)
    - When the diagram changes or is cleared, reset `journeyBounds` to null
    - When rendering in the journey review context (DiagramsView.tsx line ~3601), continue using `appConfig.canvas.defaultWidth/defaultHeight` -- no changes to DiagramsView.tsx
  - [x] 3.6 Create adapter to convert native Diagram object to UserJourneyDiagramDto
    - The Canvas.tsx dispatch receives a native `Diagram` object, but `UserJourneyDiagramRenderer` expects `UserJourneyDiagramDto`
    - Create an adapter function (e.g., `extractUserJourneyDiagram(diagram: Diagram): UserJourneyDiagramDto | null`) that reads the journey data from the diagram's embedded/typed content
    - Handle the case where journey data is missing or malformed (return null, and fall back to an error state or the General renderer)
    - Place the adapter alongside the dispatch logic or in a shared utility
  - [x] 3.7 Ensure Task Group 3 tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify the Canvas dispatch correctly routes to `UserJourneyDiagramRenderer` for `USER_JOURNEY` diagrams
    - Verify auto-sizing produces correct SVG dimensions
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Canvas.tsx dispatches `UserJourneyDiagramRenderer` when `diagram_type === 'USER_JOURNEY'`
- SVG viewBox auto-sizes to content bounds for User Journey diagrams
- General, Activity, State, Sequence, and UI_Workflow diagrams are unaffected (no regressions)
- Journey review flow in DiagramsView.tsx remains unchanged and functional
- All 4 new Canvas integration tests pass

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 5 tests written by Task Group 1 (registry + modal)
    - Review the 4 tests written by Task Group 2 (renderer + content bounds)
    - Review the 4 tests written by Task Group 3 (Canvas dispatch + auto-sizing)
    - Total existing new tests: 13
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical workflows lacking test coverage across the feature
    - Focus ONLY on gaps related to this spec's requirements
    - Do NOT assess entire application test coverage
    - Key areas to evaluate: render_hints defaults, orphan step handling in Canvas context, journey review flow backward compatibility, diagram data adapter error paths
  - [x] 4.3 Write up to 5 additional strategic tests maximum
    - Potential gap: `getDiagramType(diagram)` returns `'USER_JOURNEY'` when `diagram.diagram_type` is `'USER_JOURNEY'` (case-insensitive via normalization)
    - Potential gap: Existing journey review flow in DiagramsView.tsx still renders correctly after all changes (regression test verifying `UserJourneyDiagramRenderer` works without `onContentBounds`)
    - Potential gap: Adapter returns null for a diagram with missing/malformed journey data and Canvas handles this gracefully
    - Potential gap: Renderer with missing `render_hints` fields uses correct defaults and renders without errors
    - Potential gap: `CREATABLE_DIAGRAM_TYPES` length equals `ALL_DIAGRAM_TYPES` length minus 1 (or minus the count of non-creatable types)
    - Place tests in the most appropriate existing test files
  - [x] 4.4 Run all feature-specific tests
    - Run ONLY tests related to this spec's feature:
      - `frontend/src/types/__tests__/diagramType.test.ts` (new, ~5-6 tests)
      - `frontend/src/components/DiagramsView/__tests__/UserJourneyDiagramRenderer.test.tsx` (7 existing + 4 new = ~11 tests)
      - `frontend/src/components/DiagramsView/__tests__/UserJourneyCanvasIntegration.test.tsx` (new, ~4 tests)
      - `frontend/src/components/DiagramsView/modals/__tests__/NewDiagramModal.test.tsx` (3 existing + 1 new = ~4 tests)
    - Expected total: approximately 24-28 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows for this feature pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-28 tests total)
- Critical user workflows for this feature are covered: type registration, modal exclusion, Canvas dispatch, auto-sizing, renderer backward compatibility
- No more than 5 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements
- All 7 pre-existing UserJourneyDiagramRenderer tests remain green (no regressions)

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: DiagramType Registry Extension and NewDiagramModal Filtering** -- No dependencies; establishes the foundational type registration that all subsequent work relies on. Pure data/constant changes with a single import swap in the modal.

2. **Task Group 2: UserJourneyDiagramRenderer Extension for Canvas Context** -- Depends on Task Group 1 (needs `USER_JOURNEY` to be a recognized type). Extends the existing renderer with `computeContentBounds` and `onContentBounds` callback without touching Canvas.tsx yet.

3. **Task Group 3: Canvas.tsx Dispatch Chain Integration with Auto-Sizing** -- Depends on Task Groups 1 and 2 (needs the type registered and the renderer extended with content bounds reporting). Wires everything together in the Canvas dispatch chain.

4. **Task Group 4: Test Review and Gap Analysis** -- Depends on Task Groups 1-3. Reviews all tests, identifies gaps, and adds a small number of strategic additional tests.

## Key Files Modified

| File | Task Group | Change Description |
|------|-----------|-------------------|
| `frontend/src/types/diagramType.ts` | 1 | Add `USER_JOURNEY` to union, arrays, labels, map; add `CREATABLE_DIAGRAM_TYPES` |
| `frontend/src/components/DiagramsView/modals/NewDiagramModal.tsx` | 1 | Import swap: `ALL_DIAGRAM_TYPES` to `CREATABLE_DIAGRAM_TYPES` |
| `frontend/src/components/DiagramsView/UserJourneyDiagramRenderer.tsx` | 2 | Add `computeContentBounds`, `onContentBounds` prop, render_hints defaults |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 3 | Add import, `isUserJourneyDiagram` check, dispatch branch, auto-sizing state |

## New Files Created

| File | Task Group | Description |
|------|-----------|-------------|
| `frontend/src/types/__tests__/diagramType.test.ts` | 1 | Registry tests for `USER_JOURNEY` type and `CREATABLE_DIAGRAM_TYPES` |
| `frontend/src/components/DiagramsView/__tests__/UserJourneyCanvasIntegration.test.tsx` | 3 | Canvas dispatch and auto-sizing integration tests |
