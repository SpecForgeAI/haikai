# Specification: Restore Sequence Diagram Editor UI

## Goal

Wire existing Sequence diagram components (SequenceEditorPanel and SequenceDiagramRenderer) into DiagramsView and Canvas, so that selecting a Sequence diagram shows the Sequence Editor panel on the RHS and renders lifelines/messages on the canvas; also remove dead sequenceDiagramApi.ts code that is no longer imported anywhere.

## User Stories

- As a user, I want to see the Sequence Editor panel when I select a Sequence diagram so that I can add participants and flows instead of seeing the generic Palette panel
- As a user, I want to see lifelines and message arrows rendered on the canvas when viewing a Sequence diagram so that I can visualize the sequence flow

## Specific Requirements

**Wire SequenceEditorPanel into DiagramsView.tsx RHS**
- Import SequenceEditorPanel from './SequenceEditorPanel' at the top of DiagramsView.tsx
- Around line 1836, replace the unconditional `<PalettePanel .../>` with a conditional check
- Use `getDiagramType(diagram) === 'Sequence'` for case-insensitive comparison (import getDiagramType from '../../types/diagramType')
- When Sequence, render `<SequenceEditorPanel activeDiagram={diagram} onUpdateDiagram={handleUpdateDiagram} isCollapsed={isPalettePanelCollapsed} onToggleCollapse={handleTogglePalettePanel} metaModel={state.model.metaModel} />`
- Otherwise render existing PalettePanel
- Add a new handleUpdateDiagram callback that dispatches UPDATE_DIAGRAM action with diagram.id and partial updates

**Add isSequenceDiagram check in Canvas.tsx**
- Import SequenceDiagramRenderer from './SequenceDiagramRenderer'
- Import getDiagramType from '../../types/diagramType'
- Add `const isSequenceDiagram = getDiagramType(diagram) === 'Sequence';` similar to existing isActivityDiagram/isStateDiagram checks (around line 545)
- Update the conditional rendering block (lines 2807-2831) to add a Sequence branch before Activity

**Render SequenceDiagramRenderer for Sequence diagrams in Canvas**
- In the conditional rendering section, add Sequence as the first condition: `{isSequenceDiagram ? (...) : isActivityDiagram ? (...) : isStateDiagram ? (...) : (...)}`
- For Sequence, render `<SequenceDiagramRenderer sequenceDiagram={extractSequenceDiagram(diagram)} participantSpacing={220} metaModel={state.model.metaModel!} />`
- Add helper function extractSequenceDiagram to convert Diagram.typedContent to SequenceDiagram format using existing conversion logic from useSequenceDiagram hook
- If typedContent is null/undefined, render empty placeholder text "Add participants to start"

**Extract Sequence content from typedContent**
- Create a helper function or use inline logic to read diagram.typedContent.content as SequenceContent
- Convert SequenceContent to SequenceDiagram format matching SequenceDiagramRendererProps
- Handle case where typedContent is missing or type is not Sequence

**Remove dead sequenceDiagramApi.ts file**
- Delete file: frontend/src/api/sequenceDiagramApi.ts
- Verify no imports remain (grep confirms only a comment in useSequenceDiagram.ts references it)
- Ensure build still passes after deletion

**Verify PalettePanel unchanged for non-Sequence diagrams**
- General diagrams (no diagram_type or diagram_type="General") continue to show PalettePanel
- Activity diagrams continue to show PalettePanel (Activity-specific rendering is in Canvas only)
- State diagrams continue to show PalettePanel (State-specific rendering is in Canvas only)

## Visual Design

No mockups provided. The SequenceEditorPanel and SequenceDiagramRenderer components already exist and implement the full UI design.

## Existing Code to Leverage

**frontend/src/components/DiagramsView/SequenceEditorPanel.tsx**
- Fully implemented tabbed panel with Participants and Flow tabs
- Receives activeDiagram, onUpdateDiagram, isCollapsed, onToggleCollapse, metaModel props
- Uses useSequenceDiagram hook for state management with autosave
- Renders ParticipantsTab and FlowTab child components

**frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx**
- Fully implemented SVG renderer for sequence diagrams
- Props: sequenceDiagram, participantSpacing, metaModel
- Renders participant headers (box or stickman), lifelines, messages with arrows, and fragments
- Uses computeSequenceLayout for positioning calculations

**frontend/src/hooks/useSequenceDiagram.ts**
- Provides sequenceContentToSequenceDiagram conversion function (can be extracted or replicated)
- Reads from diagram.typedContent.content and converts to SequenceDiagram format
- Contains AUTOSAVE_DEBOUNCE_MS and full state management

**frontend/src/components/DiagramsView/Canvas.tsx conditional rendering (lines 2807-2831)**
- Pattern to follow: `isActivityDiagram ? (<ActivityDiagramRenderer ...>) : isStateDiagram ? (<StateDiagramRenderer ...>) : (<generic>)`
- Existing isActivityDiagram and isStateDiagram checks at lines 545-549
- Add isSequenceDiagram check and insert Sequence branch first in the ternary chain

**frontend/src/types/diagramType.ts getDiagramType function**
- Provides case-insensitive diagram_type comparison
- Returns normalized DiagramType enum values
- Already imported in useSequenceDiagram.ts as the pattern to follow

## Out of Scope

- Creating new SequenceEditorPanel component (already exists)
- Creating new SequenceDiagramRenderer component (already exists)
- Creating new useSequenceDiagram hook (already exists)
- Implementing Participant or Flow editing forms (already exist in SequenceEditor subfolder)
- Adding new reducer actions for UPDATE_DIAGRAM (UPDATE_DIAGRAM already exists in ArchitectureContext)
- Modifying Activity or State diagram rendering behavior
- Refactoring PalettePanel to extract a unified "TypedDiagramPanel" router
- Backend changes or API modifications
- Creating new styles/CSS files (SequenceEditorPanel.module.css already exists)
- Adding typedContent field to Diagram type (already exists)
- Implementing sequenceLayout.ts layout calculations (already exists)
- Modifying the save/load flow for diagrams
