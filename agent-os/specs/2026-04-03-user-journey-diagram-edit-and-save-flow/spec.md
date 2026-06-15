# Specification: User Journey Diagram Edit and Save Flow

## Goal
Enable users to save generated User Journey diagrams as first-class persistent diagram artifacts by adding a "Save as Diagram" action to the Journey Review Banner, creating the diagram via the existing typedContent envelope pipeline, and opening it in the standard diagram workspace with full rename/copy/delete lifecycle support.

## User Stories
- As a UX Designer, I want to save a reviewed User Journey diagram so that it becomes a persistent artifact I can access alongside my other diagrams.
- As a UX Designer, I want to review and edit the diagram name before saving so that I can give it a meaningful label in the diagram list.

## Specific Requirements

**"Save as Diagram" button on JourneyReviewBanner**
- Add a "Save as Diagram" button to the JourneyReviewBanner component, styled consistently with the existing "Close Review" and "Back to List" buttons
- The button should only be visible when a specific journey is being viewed (i.e., `selectedIndex` is not null)
- Add a new `onSaveAsDiagram` callback prop to `JourneyReviewBannerProps`; the parent (DiagramsView) is responsible for providing the handler

**SaveJourneyDiagramModal confirmation modal**
- Create a new lightweight modal component `SaveJourneyDiagramModal` in `frontend/src/components/DiagramsView/modals/`
- Follow the same structural pattern as `NewDiagramModal`: overlay click dismiss, Escape key binding, header/content/footer layout, `isOpen` guard returning null
- The modal contains a single editable text input for the diagram name, defaulting to the journey name from `journey.name`
- Validate the name on submit using the existing `validateDiagramName(trimmedName, existingDiagrams)` utility, which checks for empty names and duplicate names across all diagram types
- Display validation errors inline below the input field, matching the `NewDiagramModal` pattern
- Provide "Save" (primary) and "Cancel" (secondary) buttons; reuse the `NewDiagramModal.module.css` styles
- No diagram type dropdown is needed since the type is always USER_JOURNEY

**Frontend TypedContentEnvelope registration for USER_JOURNEY**
- Add `'USER_JOURNEY'` to the `DiagramTypedContentType` union type in `frontend/src/types/typedContent.ts`
- Add `'USER_JOURNEY'` to the `TYPED_DIAGRAM_TYPES` array so `isDiagramTypedContentType` recognizes it
- Create a `UserJourneyContent` interface that wraps the `UserJourneyDiagramDto` type (re-exported from `types/userJourneyDiagram.ts`)
- Add `UserJourneyContent` to the `TypedContentEnvelope.content` union
- Add a `createDefaultUserJourneyContent()` factory function (returns an empty/placeholder structure) and wire it into the `createDefaultTypedContent` switch statement for the `'USER_JOURNEY'` case

**Diagram object construction on save**
- On modal confirm, build a new `Diagram` object with: `id` from `generatePrefixedId('diag')`, user-entered `name`, empty `description`, `diagram_type: 'USER_JOURNEY'`, empty `diagram_nodes` and `diagram_edges` arrays, and a `typedContent` envelope of `{ type: 'USER_JOURNEY', version: 1, content: <UserJourneyDiagramDto> }`
- The `content` field carries the full `UserJourneyDiagramDto` payload (journey metadata, lanes, steps, edges, render_hints) from the review session as the authoritative rendering source
- Dispatch `ADD_DIAGRAM` with the constructed diagram; the reducer automatically sets `view_quarter`, initializes `decorations`/`label_decorations`, and selects the new diagram via `selectedDiagramId`

**Post-save flow: close review session and navigate to saved diagram**
- After dispatching `ADD_DIAGRAM`, call `closeReviewSession()` from `UserJourneyReviewContext` to clear all ephemeral review state
- Dispatch `SET_VIEW` with `'diagrams'` to restore the standard diagrams workspace (the `ADD_DIAGRAM` reducer already sets `selectedDiagramId` to the new diagram)
- Show a success toast message (e.g., "Diagram '{name}' saved successfully") following the pattern used in the ER finalization effect in DiagramsView

**Canvas rendering of saved USER_JOURNEY diagrams**
- The existing `extractUserJourneyDiagram` helper in Canvas.tsx already reads from `typedContent.content` and validates the DTO shape via `isUserJourneyDiagramDto`; no changes are needed to Canvas.tsx
- The existing `UserJourneyDiagramRenderer` renders deterministically from the DTO data; no changes needed there either
- Verify that the round-trip through save/load preserves the `typedContent` structure correctly

**Standard diagram lifecycle operations**
- Once saved, the USER_JOURNEY diagram appears in the DiagramSelector/DiagramAutocomplete dropdown like any other diagram
- Rename (RenameDiagramModal), Copy (CopyDiagramModal), and Delete (DeleteDiagramConfirmModal) work automatically through the existing DiagramSelector toolbar since these operate on the generic `Diagram` object
- USER_JOURNEY should NOT be added to `CREATABLE_DIAGRAM_TYPES` -- users cannot manually create empty USER_JOURNEY diagrams via the NewDiagramModal

**Backend DiagramMapper normalizeDiagramType update**
- Add a `case "USER_JOURNEY" -> "USER_JOURNEY"` entry to the `normalizeDiagramType` switch in `DiagramMapper.java`
- No database migration is needed; the `typed_content_json` JSONB column on `DiagramEntity` already stores arbitrary typed content as `Map<String, Object>`
- The backend save/load pipeline already handles the `typedContentJson` field generically; no changes needed to `DiagramEntity` or `DiagramDto`

**Save/load round-trip integrity**
- The frontend `prepareModelForApiSave` in `modelSerialization.ts` already generically maps `typedContent` to `typed_content` for all diagrams; no serialization changes needed
- The frontend `normalizeModelFromApi` already maps `typed_content` back to `typedContent`; no deserialization changes needed
- The `extractUserJourneyDiagram` helper in Canvas.tsx reads from `typedContent.content`, which is the canonical storage location written by the save flow

**DiagramsView integration wiring**
- In DiagramsView, add state for `showSaveJourneyModal` (boolean) and wire it to the JourneyReviewBanner's `onSaveAsDiagram` callback
- Pass the currently viewed journey's `UserJourneyDiagramDto` and `journey.name` as defaults to the SaveJourneyDiagramModal
- On modal submit, execute the diagram construction, ADD_DIAGRAM dispatch, review session close, SET_VIEW restore, and toast notification in sequence following the pattern of the ER finalization effect (lines ~916-932 of DiagramsView.tsx)

## Existing Code to Leverage

**NewDiagramModal pattern and CSS (`frontend/src/components/DiagramsView/modals/NewDiagramModal.tsx`)**
- Provides the exact modal structure to replicate: overlay click dismiss, Escape key binding, isOpen guard, header/content/footer layout, validation error display
- The `NewDiagramModal.module.css` stylesheet should be reused directly by the new SaveJourneyDiagramModal for consistent styling (overlay, modal, formGroup, formInput, validationError, primaryButton, secondaryButton classes)
- The handleCreate pattern (trim name, call validateDiagramName, show error or proceed) should be replicated

**TypedContentEnvelope pipeline (`frontend/src/types/typedContent.ts`)**
- Contains the `DiagramTypedContentType` union, `TYPED_DIAGRAM_TYPES` array, `TypedContentEnvelope` interface, and `createDefaultTypedContent` factory that all need a `'USER_JOURNEY'` entry
- Existing content interfaces (SequenceContent, ERContent, etc.) provide the pattern for defining the new `UserJourneyContent` interface
- Each typed content type has a corresponding `createDefault*Content()` factory function

**ER finalization flow in DiagramsView (`frontend/src/components/DiagramsView/DiagramsView.tsx` lines ~916-932)**
- Demonstrates the end-to-end pattern: build native diagram, dispatch ADD_DIAGRAM, close temporary state, show success toast
- The toast state management (`setToastState`) and error handling pattern should be replicated for the journey save flow

**DiagramMapper.normalizeDiagramType (`architecture-model-service/.../mapper/DiagramMapper.java` lines ~26-42)**
- The switch statement needs a new `case "USER_JOURNEY" -> "USER_JOURNEY"` entry alongside the existing General/ER/Sequence/Activity/State cases
- The default branch already returns the trimmed input for unknown values, so USER_JOURNEY would work without this change, but adding the explicit case ensures canonical behavior

**UserJourneyReviewContext (`frontend/src/contexts/UserJourneyReviewContext.tsx`)**
- `closeReviewSession()` resets all review state to initial values; must be called after ADD_DIAGRAM dispatch
- The `journeys` array and `selectedIndex` provide access to the currently viewed `UserJourneyDiagramDto` needed for building the diagram's typedContent payload
- The `previousView` field stores the view to restore, but the save flow should dispatch `SET_VIEW` with `'diagrams'` explicitly

## Out of Scope
- SVG/PNG export for User Journey diagrams
- Regeneration of journey data from meta-model entities for an existing saved diagram
- Diagram-to-meta-model synchronization (updating USER_JOURNEY/ACTIVITY_STEP entities from diagram edits)
- Overwrite/update-from-source-journey detection or "re-save" flows
- Bulk save ("Save All" from the journey chooser view)
- Interactive structural editing in canvas (drag steps, reorder lanes, edit step text, add/remove steps or edges)
- Advanced lifecycle or versioning behavior for saved journey diagrams
- Manual creation of USER_JOURNEY diagrams via the NewDiagramModal type dropdown
- Any changes to Canvas.tsx or UserJourneyDiagramRenderer (rendering already works for saved diagrams)
- Any changes to modelSerialization.ts (the generic typedContent mapping already handles USER_JOURNEY)
