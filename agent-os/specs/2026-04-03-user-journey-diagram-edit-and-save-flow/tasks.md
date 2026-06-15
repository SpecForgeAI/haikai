# Task Breakdown: User Journey Diagram Edit and Save Flow

## Overview
Total Tasks: 28

This feature enables users to save generated User Journey diagrams as persistent diagram artifacts by adding a "Save as Diagram" action to the JourneyReviewBanner, creating the diagram via the existing typedContent envelope pipeline, and opening it in the standard diagram workspace with full rename/copy/delete lifecycle support.

## Task List

### Backend Layer

#### Task Group 1: Backend DiagramMapper Update
**Dependencies:** None

- [x] 1.0 Complete backend DiagramMapper normalization for USER_JOURNEY
  - [x] 1.1 Write 2 focused tests for USER_JOURNEY normalization
    - Test that `normalizeDiagramType("USER_JOURNEY")` returns `"USER_JOURNEY"` (exact canonical value)
    - Test that `normalizeDiagramType("user_journey")` returns `"USER_JOURNEY"` (case-insensitive handling via the default branch returning trimmed input)
  - [x] 1.2 Add `case "USER_JOURNEY" -> "USER_JOURNEY"` to `normalizeDiagramType` switch in `DiagramMapper.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/DiagramMapper.java`
    - Add new case at line ~39, after the `"STATE"` case and before the `default` branch
    - This ensures canonical behavior rather than relying on the default passthrough
  - [x] 1.3 Ensure backend tests pass
    - Run ONLY the 2 tests written in 1.1
    - Verify the normalization switch handles USER_JOURNEY correctly

**Acceptance Criteria:**
- The 2 tests written in 1.1 pass
- `normalizeDiagramType` returns `"USER_JOURNEY"` for the `"USER_JOURNEY"` input
- No database migration is needed (the `typed_content_json` JSONB column already stores arbitrary content)
- No changes to `DiagramEntity` or `DiagramDto` are required

---

### Frontend Type Registration Layer

#### Task Group 2: TypedContentEnvelope Pipeline Registration for USER_JOURNEY
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete USER_JOURNEY type registration in the typedContent pipeline
  - [x] 2.1 Write 4 focused tests for USER_JOURNEY typed content registration
    - Test that `isDiagramTypedContentType('USER_JOURNEY')` returns `true`
    - Test that `createDefaultTypedContent('USER_JOURNEY')` returns an envelope with `type: 'USER_JOURNEY'`, `version: 1`, and a valid content structure
    - Test that `createDefaultUserJourneyContent()` returns a well-formed default `UserJourneyContent` object
    - Test that `createDefaultTypedContent('General')` still returns `undefined` (regression guard)
  - [x] 2.2 Add `'USER_JOURNEY'` to the `DiagramTypedContentType` union type
    - File: `frontend/src/types/typedContent.ts`, line ~19
    - Change: `'Sequence' | 'ER' | 'Activity' | 'State' | 'UI_SCREEN'` to `'Sequence' | 'ER' | 'Activity' | 'State' | 'UI_SCREEN' | 'USER_JOURNEY'`
  - [x] 2.3 Add `'USER_JOURNEY'` to the `TYPED_DIAGRAM_TYPES` array
    - File: `frontend/src/types/typedContent.ts`, line ~24-30
    - Add `'USER_JOURNEY'` as the last entry in the array
  - [x] 2.4 Create `UserJourneyContent` interface
    - File: `frontend/src/types/typedContent.ts`, add a new section after the UI Screen Content section
    - Interface wraps the `UserJourneyDiagramDto` type from `types/userJourneyDiagram.ts`
    - Fields: `journey: UserJourneyDiagramJourneyDto`, `lanes: UserJourneyDiagramLaneDto[]`, `steps: UserJourneyDiagramStepDto[]`, `edges: UserJourneyDiagramEdgeDto[]`, `render_hints: UserJourneyDiagramRenderHintsDto`, `diagram_type: string`, `version: string`
    - Follow the pattern of `SequenceContent`, `ERContent`, etc.
    - Note: `UserJourneyContent` should match the shape of `UserJourneyDiagramDto` since the DTO itself IS the content
  - [x] 2.5 Add `UserJourneyContent` to the `TypedContentEnvelope.content` union
    - File: `frontend/src/types/typedContent.ts`, line ~70
    - Change the `content` field type to include `| UserJourneyContent`
  - [x] 2.6 Create `createDefaultUserJourneyContent()` factory function
    - File: `frontend/src/types/typedContent.ts`, add after `createDefaultUIScreenContent()`
    - Returns a minimal placeholder `UserJourneyContent` with empty arrays and default metadata
    - Follow the pattern of the other `createDefault*Content()` functions
  - [x] 2.7 Add `'USER_JOURNEY'` case to the `createDefaultTypedContent` switch statement
    - File: `frontend/src/types/typedContent.ts`, line ~416-425 area
    - Add case after `'UI_SCREEN'` that returns `{ type: 'USER_JOURNEY', version: 1, content: createDefaultUserJourneyContent() }`
  - [x] 2.8 Ensure typed content registration tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify TypeScript compilation succeeds with the new types

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- `'USER_JOURNEY'` is recognized by `isDiagramTypedContentType`
- `createDefaultTypedContent('USER_JOURNEY')` returns a valid envelope
- `UserJourneyContent` interface is properly typed and importable
- The `TypedContentEnvelope.content` union includes `UserJourneyContent`

---

### Frontend UI Components Layer

#### Task Group 3: SaveJourneyDiagramModal Component
**Dependencies:** Task Group 2

- [x] 3.0 Complete the SaveJourneyDiagramModal component
  - [x] 3.1 Write 5 focused tests for SaveJourneyDiagramModal
    - Test that the modal renders nothing when `isOpen` is `false`
    - Test that the modal renders with the default name pre-filled from `defaultName` prop
    - Test that clicking Save with an empty name shows the validation error from `validateDiagramName`
    - Test that clicking Save with a valid name calls `onSubmit` with the trimmed name
    - Test that clicking Cancel calls `onClose` and resets state
  - [x] 3.2 Create `SaveJourneyDiagramModal` component file
    - File: `frontend/src/components/DiagramsView/modals/SaveJourneyDiagramModal.tsx`
    - Follow the exact structural pattern of `NewDiagramModal.tsx`: overlay click dismiss, Escape key binding, `isOpen` guard returning null, header/content/footer layout
    - Props interface `SaveJourneyDiagramModalProps`: `isOpen: boolean`, `onClose: () => void`, `onSubmit: (name: string) => void`, `defaultName: string`, `existingDiagrams: Diagram[]`
  - [x] 3.3 Implement modal content: name input with validation
    - Single editable text input for diagram name, defaulting to `defaultName` prop
    - Use `useState` with `defaultName` as initial value; reset when `isOpen` changes via `useEffect`
    - Validate on submit using `validateDiagramName(trimmedName, existingDiagrams)` from `utils/validation`
    - Display validation errors inline below the input field using the `validationError` CSS class
    - No diagram type dropdown (type is always USER_JOURNEY)
  - [x] 3.4 Implement modal footer: Save and Cancel buttons
    - "Save" primary button triggers validation then calls `onSubmit(trimmedName)`
    - "Cancel" secondary button resets state and calls `onClose()`
    - Reuse `NewDiagramModal.module.css` styles (import the same stylesheet)
  - [x] 3.5 Ensure SaveJourneyDiagramModal tests pass
    - Run ONLY the 5 tests written in 3.1
    - Verify modal renders, validates, submits, and cancels correctly

**Acceptance Criteria:**
- The 5 tests written in 3.1 pass
- Modal renders with pre-filled journey name
- Empty/duplicate name validation works with inline error display
- Submit calls `onSubmit` with trimmed name; Cancel calls `onClose`
- Styles are consistent with NewDiagramModal (reuses the same CSS module)
- Escape key and overlay click dismiss the modal

---

#### Task Group 4: JourneyReviewBanner "Save as Diagram" Button
**Dependencies:** None (can run in parallel with Task Groups 1-3)

- [x] 4.0 Complete the "Save as Diagram" button on JourneyReviewBanner
  - [x] 4.1 Write 3 focused tests for the new banner button
    - Test that the "Save as Diagram" button renders and is visible when the banner renders (selectedIndex is always non-null when the banner is shown)
    - Test that clicking "Save as Diagram" calls the `onSaveAsDiagram` callback
    - Test that the button is styled consistently with the existing "Close Review" and "Back to List" buttons
  - [x] 4.2 Add `onSaveAsDiagram` callback prop to `JourneyReviewBannerProps`
    - File: `frontend/src/components/DiagramsView/JourneyReviewBanner.tsx`
    - Add `onSaveAsDiagram: () => void` to the props interface
    - Destructure in the component function parameters
  - [x] 4.3 Add the "Save as Diagram" button to the banner JSX
    - Position the button after the "Close Review" button (or before it, at the right end of the banner)
    - Use inline styles matching the existing button pattern (padding, border, borderRadius, fontSize, cursor)
    - Use a distinctive style to indicate it is a primary action (e.g., blue background matching the Preview badge color scheme: `background: '#1565C0'`, `color: 'white'`)
    - Add `data-testid="journey-review-save-as-diagram"` for test targeting
  - [x] 4.4 Ensure banner button tests pass
    - Run ONLY the 3 tests written in 4.1
    - Verify the button renders, fires the callback, and has consistent styling

**Acceptance Criteria:**
- The 3 tests written in 4.1 pass
- "Save as Diagram" button appears on the JourneyReviewBanner
- Clicking the button fires the `onSaveAsDiagram` callback
- Button styling is visually consistent with the existing banner buttons

---

### Frontend Integration Layer

#### Task Group 5: DiagramsView Integration Wiring
**Dependencies:** Task Groups 2, 3, 4

- [x] 5.0 Complete the DiagramsView integration for the save journey flow
  - [x] 5.1 Write 5 focused tests for the integration wiring
    - Test that `showSaveJourneyModal` state is initially `false`
    - Test that clicking "Save as Diagram" on the banner opens the SaveJourneyDiagramModal (sets `showSaveJourneyModal` to `true`)
    - Test that modal submit constructs a Diagram object with correct fields (`id` from `generatePrefixedId('diag')`, user-entered `name`, `diagram_type: 'USER_JOURNEY'`, empty `diagram_nodes`/`diagram_edges`, `typedContent` envelope with the `UserJourneyDiagramDto`)
    - Test that modal submit dispatches `ADD_DIAGRAM`, calls `closeReviewSession()`, and dispatches `SET_VIEW` with `'diagrams'`
    - Test that a success toast is shown after save with the diagram name
  - [x] 5.2 Add `showSaveJourneyModal` state to DiagramsView
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - Add `const [showSaveJourneyModal, setShowSaveJourneyModal] = useState(false);`
  - [x] 5.3 Wire `onSaveAsDiagram` callback to JourneyReviewBanner
    - Pass `onSaveAsDiagram={() => setShowSaveJourneyModal(true)}` to the `JourneyReviewBanner` component
    - This opens the modal when the user clicks "Save as Diagram"
  - [x] 5.4 Render the SaveJourneyDiagramModal in DiagramsView
    - Import and render `SaveJourneyDiagramModal` with props:
      - `isOpen={showSaveJourneyModal}`
      - `onClose={() => setShowSaveJourneyModal(false)}`
      - `defaultName={currentJourney.journey.name}` (from the currently viewed journey via UserJourneyReviewContext)
      - `existingDiagrams={state.model.diagrams}`
      - `onSubmit={handleSaveJourneyDiagram}` (the handler defined in 5.5)
  - [x] 5.5 Implement `handleSaveJourneyDiagram` handler
    - Build a new `Diagram` object:
      - `id`: from `generatePrefixedId('diag')`
      - `name`: the user-entered name from the modal
      - `description`: empty string
      - `diagram_type`: `'USER_JOURNEY'`
      - `diagram_nodes`: empty array `[]`
      - `diagram_edges`: empty array `[]`
      - `typedContent`: `{ type: 'USER_JOURNEY', version: 1, content: <UserJourneyDiagramDto> }`
    - The `content` field carries the full `UserJourneyDiagramDto` payload from the review session (accessed via `journeyReviewContext.journeys[journeyReviewContext.selectedIndex]`)
    - Follow the ER finalization pattern from DiagramsView lines ~916-932
  - [x] 5.6 Implement post-save flow
    - After building the diagram, dispatch `ADD_DIAGRAM` with the constructed diagram (reducer auto-sets `view_quarter`, initializes `decorations`/`label_decorations`, and selects via `selectedDiagramId`)
    - Close the modal: `setShowSaveJourneyModal(false)`
    - Call `closeReviewSession()` from `UserJourneyReviewContext` to clear ephemeral review state
    - Dispatch `SET_VIEW` with `'diagrams'` to restore the standard diagrams workspace
    - Show success toast: `setToastState({ visible: true, message: \`Diagram '${name}' saved successfully\`, type: 'success' })`
    - Wrap in try/catch following the ER finalization error handling pattern
  - [x] 5.7 Ensure integration tests pass
    - Run ONLY the 5 tests written in 5.1
    - Verify the full flow: button click -> modal open -> submit -> diagram created -> review closed -> toast shown

**Acceptance Criteria:**
- The 5 tests written in 5.1 pass
- Clicking "Save as Diagram" on the banner opens the SaveJourneyDiagramModal
- The modal pre-fills the journey name and validates on submit
- A correct Diagram object is constructed with USER_JOURNEY typed content
- ADD_DIAGRAM is dispatched, review session is closed, view is restored to diagrams
- Success toast is displayed with the diagram name
- Error handling catches and displays failures without closing the review session

---

### Test Review and Verification Layer

#### Task Group 6: Test Review, Gap Analysis, and Round-Trip Verification
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps; verify round-trip integrity
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 2 tests written by backend engineer (Task 1.1)
    - Review the 4 tests written for typed content registration (Task 2.1)
    - Review the 5 tests written for SaveJourneyDiagramModal (Task 3.1)
    - Review the 3 tests written for JourneyReviewBanner button (Task 4.1)
    - Review the 5 tests written for DiagramsView integration (Task 5.1)
    - Total existing tests: approximately 19 tests
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Prioritize end-to-end workflows over unit test gaps
    - Key areas to check: round-trip save/load integrity, Canvas.tsx extraction from saved typedContent, DiagramSelector listing of USER_JOURNEY diagrams
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Verify save/load round-trip: a saved USER_JOURNEY diagram's `typedContent` survives `prepareModelForApiSave` -> `normalizeModelFromApi` with the correct structure
    - Verify `extractUserJourneyDiagram` in Canvas.tsx correctly reads from `typedContent.content` of a saved diagram
    - Verify USER_JOURNEY is NOT in `CREATABLE_DIAGRAM_TYPES` (regression guard against accidental inclusion)
    - Verify that `validateDiagramName` rejects duplicate names across all diagram types including USER_JOURNEY
    - Verify that the `ADD_DIAGRAM` reducer correctly initializes `view_quarter`, `decorations`, and `selectedDiagramId` for a USER_JOURNEY diagram
    - Verify lifecycle operations: a saved USER_JOURNEY diagram can be found in the diagrams array by `selectedDiagramId` after dispatch
    - Focus on integration points between components; skip edge cases, performance tests, and accessibility tests
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 25-29 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 25-29 tests total)
- Save/load round-trip integrity is verified through the full persistence pipeline
- Canvas.tsx correctly renders a saved USER_JOURNEY diagram from `typedContent.content`
- USER_JOURNEY is excluded from `CREATABLE_DIAGRAM_TYPES`
- Standard diagram lifecycle operations (rename, copy, delete) function correctly for USER_JOURNEY diagrams
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: Backend DiagramMapper Update          -- No dependencies
Task Group 2: TypedContent Pipeline Registration    -- No dependencies (parallel with 1)
Task Group 4: JourneyReviewBanner Button            -- No dependencies (parallel with 1, 2)
    |
    v
Task Group 3: SaveJourneyDiagramModal Component     -- Depends on Task Group 2
    |
    v
Task Group 5: DiagramsView Integration Wiring       -- Depends on Task Groups 2, 3, 4
    |
    v
Task Group 6: Test Review & Round-Trip Verification -- Depends on Task Groups 1-5
```

Task Groups 1, 2, and 4 can all be developed in parallel since they have no inter-dependencies. Task Group 3 needs the `UserJourneyContent` type from Task Group 2. Task Group 5 wires everything together and depends on the modal (3), the banner button (4), and the type registration (2). Task Group 6 is the final verification pass.

## Files Modified Summary

| File | Task Group | Change |
|------|-----------|--------|
| `architecture-model-service/.../mapper/DiagramMapper.java` | 1 | Add USER_JOURNEY case to normalizeDiagramType |
| `frontend/src/types/typedContent.ts` | 2 | Add USER_JOURNEY to union, array, interface, factory |
| `frontend/src/components/DiagramsView/modals/SaveJourneyDiagramModal.tsx` | 3 | New file: save confirmation modal |
| `frontend/src/components/DiagramsView/JourneyReviewBanner.tsx` | 4 | Add onSaveAsDiagram prop and button |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | 5 | Add modal state, wiring, save handler, post-save flow |

## Key Patterns to Follow

- **Modal pattern:** Replicate `NewDiagramModal.tsx` structure (overlay, Escape, isOpen guard, header/content/footer), reuse `NewDiagramModal.module.css`
- **Save pattern:** Follow ER finalization effect in DiagramsView lines ~916-932 (build diagram, dispatch ADD_DIAGRAM, close temp state, show toast)
- **TypedContent registration:** Follow existing `SequenceContent`/`ERContent` pattern for interface, factory function, and switch case
- **Backend normalization:** Follow existing `case "STATE" -> "State"` pattern but preserve `USER_JOURNEY` casing
