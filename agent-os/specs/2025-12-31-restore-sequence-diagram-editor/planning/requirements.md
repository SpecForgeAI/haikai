title: Restore Sequence diagram editor UI by wiring DiagramsView + Canvas to Sequence-specific components and removing dead sequence API code

problem:
  - Even when a diagram's diagram_type is correctly persisted as "Sequence", the UI still renders the generic Palette panel on the RHS, so the Sequence "+ Add Participant / + Add Flow ..." controls never appear.
  - In the current frontend snapshot, there is NO Sequence Editor package/component present under src/components/DiagramsView; DiagramsView.tsx always renders <PalettePanel /> unconditionally.
  - Canvas.tsx also has no branch for Sequence rendering; it only knows how to render the generic node/edge canvas.
  - There is dead code in src/api/sequenceDiagramApi.ts (not imported anywhere) from the old "/sequence-diagrams/{id}" approach, which is now superseded by "typed content stored on the generic Diagram".

goal:
  - When selected diagram_type === "Sequence", the RHS must show a Sequence Editor (not Palette).
  - Canvas must render a Sequence diagram visualization for Sequence diagrams (lifelines + message arrows) based on typed content stored on the Diagram.
  - Remove unused/legacy sequenceDiagramApi.ts to avoid confusing parallel implementations.

scope:
  - frontend only (this increment)
  - update:
      - src/components/DiagramsView/DiagramsView.tsx
      - src/components/DiagramsView/Canvas.tsx
  - add new Sequence editor + renderer components (missing in this repo snapshot)
  - remove dead code: src/api/sequenceDiagramApi.ts

assumptions:
  - Sequence diagram content is stored on the generic Diagram as JSON (Pattern 1).
  - Use Diagram.settings as the storage container for typed diagram content, because Diagram currently exposes:
      - diagram_type?: string
      - settings?: Record<string, unknown>
    and there is no typedContent field in the current Diagram type.
  - Canonical location for sequence content:
      diagram.settings.sequenceDiagram  (camelCase in JS; this is your tool's internal JSON, not necessarily backend snake_case)

acceptance_criteria:
  - Selecting a Sequence diagram shows a RHS titled "Sequence Editor" with:
      - Participants tab
      - Flow tab
      - "+ Add Participant" button
      - "+ Add Flow (Request)" button (and "+ Add Flow (Response)" or equivalent)
  - Adding a Participant/Flow updates diagram.settings.sequenceDiagram and immediately re-renders the canvas.
  - Sequence diagrams do NOT show the generic Palette panel (to prevent the "Events only" empty experience).
  - General/Activity/State diagrams still show PalettePanel unchanged.
  - src/api/sequenceDiagramApi.ts is removed and the build still passes (no references remain).

implementation_details:

1) Add a shared typed-diagram accessor for Sequence (new helper)
  - file: src/utils/typedDiagramContent.ts (new)
  - export functions:
      - getSequenceContent(diagram: Diagram): SequenceDiagramContent | null
      - setSequenceContent(diagram: Diagram, content: SequenceDiagramContent): Diagram
  - behaviour:
      - read from diagram.settings?.sequenceDiagram
      - if missing, return null
      - setSequenceContent returns a shallow-cloned Diagram with:
          settings: { ...(diagram.settings ?? {}), sequenceDiagram: content }

2) Add ArchitectureContext action to update Diagram.settings (required to persist editor changes in app state)
  - file: src/contexts/ArchitectureContext.tsx
  - add action type:
      | { type: 'UPDATE_DIAGRAM_SETTINGS'; diagramId: string; settings: Record<string, unknown> }
  - reducer behaviour:
      - find diagram by id in state.model.diagrams
      - replace diagram.settings with provided settings
      - keep all other diagram fields untouched
  - note:
      - do NOT merge settings in reducer; editor will pass the full merged object to avoid partial overwrite bugs.

3) Implement SequenceEditorPanel (new, minimal but functional)
  - file: src/components/DiagramsView/SequenceEditorPanel.tsx (new)
  - props:
      - diagram: Diagram
      - isCollapsed: boolean
      - onToggleCollapse: () => void
  - UI:
      - panel header with collapse toggle (match PalettePanel style)
      - tabs: "Participants" and "Flow"
      - Participants tab:
          - list current participants (displayName = camelCase(ref.name) + ' : ' + refKind if ref resolvable; otherwise show refId)
          - button: "+ Add Participant"
              - opens a very simple inline form (no modal required v1):
                  - refKind select (User | Application | Service | Interface | Class | etc. from your existing ParticipantRefKind union in src/types/sequenceDiagram.ts)
                  - refId text input
                  - optional label override text input
              - on save:
                  - append participant with id = `p-${nanoid}` (use existing id util if present, otherwise simple timestamp id)
                  - orderIndex = participants.length
                  - write back using UPDATE_DIAGRAM_SETTINGS with updated settings.sequenceDiagram
      - Flow tab:
          - list message exchanges (group by exchangeId) in order of sequence_nodes if present; otherwise list by message array order
          - button: "+ Add Flow (Request)"
              - inline create:
                  - fromParticipantId select
                  - toParticipantId select
                  - labelText OR refKind/refId (if you want to support method/data binding)
              - auto-create exchangeId (x-*)
              - create a request message object (exchangeRole="Request")
              - optionally create a response message using a second button later (or include "Add Response" within the exchange)
      - store content under diagram.settings.sequenceDiagram as:
          {
            id: diagram.id,
            type: "Sequence",
            name: diagram.name,
            participants: [...],
            messages: [...],
            fragments: [],
            operands: [],
            sequence_nodes: [...]
          }
        (match your src/types/sequenceDiagram.ts definitions; use camelCase key names consistently inside settings)

4) Wire DiagramsView.tsx to show SequenceEditorPanel when diagram_type === "Sequence"
  - file: src/components/DiagramsView/DiagramsView.tsx
  - import SequenceEditorPanel
  - in the JSX where PalettePanel is currently always rendered (around line ~1836):
      - replace unconditional <PalettePanel .../> with:
          {diagram?.diagram_type === 'Sequence' ? (
            <SequenceEditorPanel
              diagram={diagram}
              isCollapsed={isPalettePanelCollapsed}   // reuse same collapse state for now
              onToggleCollapse={handleTogglePalettePanel}
            />
          ) : (
            <PalettePanel ...existing props... />
          )}
  - NOTE:
      - do not change Activity/State behaviour in this increment; only replace RHS for Sequence.

5) Add SequenceDiagramRenderer into Canvas.tsx (new renderer + branch)
  A) New renderer component:
    - file: src/components/DiagramsView/SequenceDiagramRenderer.tsx (new)
    - props:
        - diagram: Diagram
        - width: number
        - height: number
    - behaviour:
        - read content via getSequenceContent(diagram)
        - if null: render nothing (or a centered hint "Add participants to start")
        - render using SVG overlay (simplest) inside the existing canvas container:
            - participant header boxes at top:
                - width fixed 150px, text wrap
                - Users: render stickman (reuse existing stickman render helper if available; otherwise draw simple circle+lines)
            - lifelines: vertical black line from header bottom to canvas bottom
            - messages:
                - fixed row height: 60px
                - each Request message draws solid arrow from fromParticipant x to toParticipant x
                - each Response message draws dashed arrow
                - label centered above arrow; label source:
                    - if labelText present: use it
                    - else if refKind/refId present: show ref name if resolvable; else show refId
            - participantSpacing controlled by:
                - diagram.settings.sequenceLayout?.participantSpacing (number, default 200)
                - this can be adjusted later via toolbar; not required in this spec unless already implemented elsewhere
  B) Canvas.tsx branch:
    - file: src/components/DiagramsView/Canvas.tsx
    - at the top-level render return where the SVG/canvas is rendered:
        - if diagram.diagram_type === 'Sequence':
            - render <SequenceDiagramRenderer diagram={diagram} width={canvasWidth} height={canvasHeight} />
            - do NOT render generic node/edge rendering layer for sequence (or render behind but disable interactions)
        - else:
            - existing generic rendering path unchanged

6) Remove dead API implementation
  - delete file: src/api/sequenceDiagramApi.ts
  - verify there are no imports (currently there are none)
  - ensure lint/build passes

7) Type safety updates
  - file: src/types/model.ts
    - no schema changes required, but add a comment to Diagram.settings noting it may contain typed diagram content:
        // settings may include typed-diagram content e.g. settings.sequenceDiagram
  - file: src/types/sequenceDiagram.ts
    - ensure it exports the content type used by renderer/editor (SequenceDiagramContent or equivalent name in that file).
    - if the file is incomplete or uses snake_case keys only, add a small wrapper type for the settings shape (camelCase) or standardize on one.

manual_test_plan:
  - Start app, open Diagrams view.
  - Select a diagram with diagram_type "Sequence":
      - RHS shows "Sequence Editor" and "+ Add Participant".
  - Add 2 participants and a request flow:
      - Canvas updates immediately with 2 lifelines and 1 arrow row.
  - Save model (existing save path), reload file:
      - diagram_type remains "Sequence"
      - Sequence editor still appears
      - sequence content persists in diagram.settings.sequenceDiagram

notes:
  - This spec intentionally does NOT refactor Activity/State to match Sequence; it only restores Sequence editor/rending in a minimal working manner.
  - If later you want consistency, we can unify typed editors behind a "TypedDiagramPanel" router and move Activity/State special UI out of PalettePanel, but that is out-of-scope here.
