# Specification: Sequence Diagram Canvas Rendering v1

## Goal

Render Sequence diagrams visually on the main diagram canvas, displaying participants as headers with lifelines, messages as horizontal arrows, and fragments as frames, with live updates when the RHS Sequence Editor changes data.

## User Stories

- As a user viewing a Sequence diagram, I want to see participants rendered as headers (box or stickman) with vertical lifelines so I can visually understand the interaction flow.
- As a user editing sequence data in the RHS panel, I want the canvas to update immediately so I can see my changes in real-time.

## Specific Requirements

**Sequence Render Mode Switch**
- Detect when `activeDiagram.diagram_type === 'Sequence'` in the Canvas component
- If Sequence: bypass existing node/edge rendering and invoke new SequenceDiagramRenderer
- If not Sequence: keep existing rendering path unchanged
- Pass `sequenceDiagram` state from `useSequenceDiagram` hook to the renderer
- Pass `metaModel` for entity name resolution

**Toolbar: Participant Spacing Control**
- Add numeric input with label "Participant spacing" to toolbar Row 1 (after Period section)
- Default value: 220, Min: 120, Max: 600, Step: 10
- Store in `diagram.settings.sequence.participantSpacing` for persistence
- Fall back to local UI state if settings unavailable
- Trigger immediate rerender on change via callback to update state

**Layout Model (computeSequenceLayout function)**
- Create pure function: `computeSequenceLayout(sequenceDiagram, participantSpacing, canvasWidth, margins)`
- Constants: headerBoxWidth=150, headerBoxHeight=50, userHeaderHeight=70, topMargin=40, leftMargin=60, rowHeight=60
- Compute lifelineTopY = topMargin + headerAreaHeight + 10
- Compute participantX[i] = leftMargin + i * participantSpacing
- Compute lifelineX = participantX + headerBoxWidth/2 for all participant types
- DFS traverse sequenceNodes: Message nodes consume 1 row, Fragment nodes consume 0 rows
- Compute fragment vertical extent from first/last descendant message row indices

**Participant Header Rendering**
- Sort participants by order_index ascending for left-to-right positioning
- For User participants (ref_kind === 'BusinessUser'): render stickman using existing `calculateStickManDimensions` pattern
- For all other participants: render 150x50 header box with wrapped text (max 3 lines, then ellipsis)
- Resolve display name via metaModel lookup: find entity by (ref_kind, ref_id), use entity.name, fallback to ref_id
- Draw vertical lifeline from lifelineTopY to lifelineBottomY at centerline X

**Message Arrow Rendering**
- Render in order derived from sequenceNodes DFS traversal (Message nodes only)
- Compute y = messageStartY + rowIndex * rowHeight
- Compute fromX = lifelineX(from_participant_id), toX = lifelineX(to_participant_id)
- Draw horizontal line with arrowhead pointing to toX
- For exchange_role === 'Response': use dashed stroke (strokeDasharray)
- For exchange_role === 'Request': use solid stroke
- Resolve label: if ref_kind/ref_id set, lookup entity name from metaModel; else use label_text
- Render label centered at (fromX+toX)/2, y-12 with baseline alignment

**Fragment Frame Rendering**
- Render fragment frames after computing row extents (draw behind messages)
- Horizontal span: first participant lifelineX - 80 to last lifelineX + 80
- Vertical span: topY = yAtRow(startRow) - 30, bottomY = yAtRow(endRow) + 30
- Draw thin black stroke rectangle
- Render fragment label in top-left: lowercase fragmentKind ("loop", "opt", "alt")
- If fragment has no messages: render minimal frame height of 1 row as placeholder

**Operand Rendering for Fragments**
- For Loop/Optional fragments: show guard text "[guardExpression]" beneath fragment label
- For Alternative fragments: split frame into operand regions stacked vertically
- Calculate regionHeight = (bottomY-topY) / operandCount
- Draw horizontal separators between regions
- Render each operand guard "[guardExpression]" at top-left of its region

**Live Update Wiring**
- Feed SequenceDiagramRenderer from same reactive state as RHS SequenceEditorPanel
- Re-render on any change to: participants, messages, fragments, operands, sequenceNodes, participantSpacing
- No manual refresh button required - changes propagate automatically via React state

**Edge Cases and Fallbacks**
- If participants.length < 1: render empty canvas message "Add participants to begin"
- If message references missing participantId: skip rendering that message, log to console (no crash)
- If referenced metaModel entity name not found: use ref_id as label fallback
- Text wrapping: max 3 lines, else ellipsis

## Visual Design

No visual mockups were provided in the planning/visuals folder.

## Existing Code to Leverage

**`frontend/src/components/DiagramsView/Canvas.tsx`**
- Main canvas component with SVG rendering infrastructure
- Contains BUSINESS_USER stickman rendering pattern (lines 2038-2114) that can be reused for User participants
- Uses `calculateStickManDimensions` from rendering.ts for stickman proportions
- Shows pattern for detecting entity_type and branching rendering logic

**`frontend/src/hooks/useSequenceDiagram.ts`**
- Hook that manages SequenceDiagram state from typedContent
- Provides `sequenceDiagram` object with participants, messages, fragments, operands, sequence_nodes
- Already wired to SequenceEditorPanel; same hook can feed canvas renderer
- Handles conversion between SequenceContent and SequenceDiagram formats

**`frontend/src/types/typedContent.ts`**
- Defines SequenceContent, SequenceParticipantRef, SequenceMessageRef, SequenceFragmentRef, SequenceOperandRef, SequenceNodeRef
- Used for typedContent storage format on Diagram

**`frontend/src/types/sequenceDiagram.ts`**
- Defines SequenceDiagram, SequenceParticipant, SequenceMessage, SequenceFragment, SequenceOperand, SequenceNode
- Contains ParticipantRefKind, MessageRefKind, ExchangeRole, FragmentKind, NodeKind type unions
- Type guards for validation: isParticipantRefKind, isMessageRefKind, etc.

**`frontend/src/utils/rendering.ts`**
- Contains `calculateStickManDimensions()` function (lines 651-683) for stickman proportions
- Contains `calculateBusinessUserTextPosition()` for text below stickman
- Contains `wrapText()` for text wrapping in nodes
- Contains `getEntityLabel()` for resolving entity names from metaModel

## Out of Scope

- Activation bars on lifelines showing when participant is active
- Self-call messages (message from participant to itself with loop-back arrow)
- Async arrowheads (open vs filled arrowhead styles)
- Auto-layout optimization for minimizing crossing arrows
- Zoom/scroll beyond existing canvas zoom functionality
- Pan gestures beyond existing canvas pan
- Selection/hover of sequence elements on canvas
- Drag-and-drop reordering of participants on canvas
- Click-to-add participants or messages directly on canvas
- Backend API changes (all data stored in typedContent)
