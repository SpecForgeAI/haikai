# Specification: Sequence Diagram Fix Self-Loop Spacing and Collection Label Rendering

## Goal
Fix two rendering regressions in the Sequence Diagram: (1) self-referencing message exchanges must reserve additional vertical space so subsequent messages and fragment boundaries do not collide with the loopback shape, and (2) the `is_collection` field must be propagated through the full data pipeline so entity references marked as collections render as `Collection<EntityName>`.

## User Stories
- As a diagram author, I want self-loop messages to have proper spacing below the loopback arrow so that subsequent messages and fragment borders do not overlap or touch the loop shape.
- As a diagram author, I want message exchanges marked "Is Collection?" for PhysicalEntity/LogicalEntity references to render as `Collection<EntityName>` in the diagram.

## Specific Requirements

**Fix 1: Self-loop messages must reserve extra vertical space in the layout engine**
- In `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/sequenceLayout.ts`, the `dfsTraverse` function (lines 308-365) assigns exactly 1 row (60px) per message regardless of type
- The `SelfMessageArrow` component in `SequenceDiagramRenderer.tsx` (line 1049) renders the loopback bottom at `baseY + SELF_MESSAGE_LOOP_HEIGHT` (baseY + 30px), leaving only 30px gap to the next row
- When a message is a self-message (`from_participant_id === to_participant_id`), the layout must add an additional 30px of vertical space after that message's row
- Implement this by adding a fractional row increment (0.5) to `dfsContext.currentRow` after a self-message, OR by tracking cumulative Y offset -- the simplest approach is to increment `dfsContext.currentRow` by an additional 0.5 (since 0.5 * 60px rowHeight = 30px)
- The `SELF_MESSAGE_LOOP_HEIGHT` constant (30px, line 327 of `SequenceDiagramRenderer.tsx`) should be exported and imported into `sequenceLayout.ts` to avoid magic number duplication, OR define a shared constant
- Fragment bottom Y calculation (line 394: `extent.endRow * rowHeight + 30`) must also reflect the extra space when the last message in a fragment is a self-loop
- Non-self-messages must have zero change to their layout behaviour

**Fix 2: Propagate is_collection through the data mapping pipeline**
- The `SequenceMessageRef` type in `typedContent.ts` (line 119) already declares `is_collection?: boolean`
- The `SequenceMessage` type in `sequenceDiagram.ts` (line 180) already declares `is_collection?: boolean`
- The `formatEntityLabel` and `resolveMessageLabel` functions in `SequenceDiagramRenderer.tsx` (lines 507-559) already correctly render `Collection<EntityName>` when `is_collection` is true -- no renderer changes needed
- **Root cause**: `useSequenceDiagram.ts` function `sequenceContentToSequenceDiagram` (lines 83-92) maps `SequenceMessageRef` to `SequenceMessage` but omits `is_collection` from the mapping object
- **Root cause**: `useSequenceDiagram.ts` function `sequenceDiagramToSequenceContent` (lines 144-153) maps `SequenceMessage` back to `SequenceMessageRef` but omits `is_collection` from the mapping object
- Add `is_collection: m.is_collection` to both mapping functions in `useSequenceDiagram.ts`

## Existing Code to Leverage

**`C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/sequenceLayout.ts` -- Layout engine**
- The `dfsTraverse` function (lines 308-365) is the single place where row assignment happens; the self-loop fix must be applied at line 336 where `dfsContext.currentRow++` occurs
- The `messageMap` (line 257-260) already provides access to message data including `from_participant_id` and `to_participant_id` for detecting self-messages
- Fragment bottom Y is computed at line 394; this formula must account for any fractional row from self-loops

**`C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx` -- Renderer constants**
- `SELF_MESSAGE_LOOP_HEIGHT = 30` (line 327) -- reuse or share this constant with the layout engine
- `isSelfMessage()` (lines 471-473) -- reuse this helper or replicate the check in the layout engine

**`C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/hooks/useSequenceDiagram.ts` -- Data pipeline**
- `sequenceContentToSequenceDiagram` (lines 53-131) -- add `is_collection` to message mapping at line 92
- `sequenceDiagramToSequenceContent` (lines 136-175) -- add `is_collection` to reverse message mapping at line 153

**`C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/__tests__/SequenceDiagramRenderer.resolveMessageLabel.test.ts` -- Existing label tests**
- Already tests `formatEntityLabel` with `is_collection=true` for PhysicalEntity and LogicalEntity, confirming the renderer logic works correctly

**`C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/__tests__/sequenceLayout.test.ts` -- Existing layout tests**
- Contains test helpers (`createTestDiagram`, `createParticipant`, `createMessage`) that should be extended for self-message test cases

## Out of Scope
- No backend or persistence changes
- No changes to the `SequenceMessage` or `SequenceMessageRef` type definitions (both already have `is_collection`)
- No changes to `formatEntityLabel` or `resolveMessageLabel` (already correct)
- No changes to non-self-message layout spacing
- No changes to fragment semantics or definitions
- No new UI controls or checkboxes
- No configurable spacing or padding options
- No changes to message ordering, routing, or fragment nesting logic
- No changes to export/print behaviour
- No changes to the `SelfMessageArrow` SVG rendering (only layout spacing changes)
