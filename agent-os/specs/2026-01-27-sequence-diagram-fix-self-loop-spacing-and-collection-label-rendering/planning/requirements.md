# Spec Requirements: Sequence Diagram Fix Self-Loop Spacing and Collection Label Rendering

## Initial Description
Fix two regressions in Sequence Diagram rendering:
1. Self-referencing message exchanges (From == To) must reserve vertical space based on the bottom of the loopback shape, preventing collisions with subsequent messages or fragment boundaries.
2. Message exchanges marked "Is Collection?" for PhysicalEntity/LogicalEntity references must render as "Collection<EntityName>" rather than just "EntityName".

## Requirements Discussion

### First Round Questions

**Q1:** Fix 1 - Self-loop spacing: How should the extra vertical space be accounted for? Should we add a fixed self-loop height to the reserved vertical space, or make it configurable padding?
**Answer:** Add a fixed 30px self-loop height to the reserved vertical space. No configurable padding needed.

**Q2:** Fix 2 - Collection label rendering: The renderer logic already correctly formats "Collection<EntityName>". Should we fix just the renderer, or trace and fix the full pipeline ensuring is_collection flows from TypedContentEnvelope through to SequenceMessage?
**Answer:** Fix the full pipeline, not just the renderer. If is_collection is dropped during data mapping from TypedContentEnvelope to sequence diagram model, fix that mapping so the renderer receives the field.

**Q3:** Do you have any screenshots showing the current broken rendering to help guide the fixes?
**Answer:** No screenshots - these are simple fixes, none needed.

### Code Analysis Findings

This section documents the exact code paths, constants, and logic identified through codebase exploration.

---

#### Fix 1: Self-Loop Spacing

**Root Cause Identified:**

The layout engine in `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/sequenceLayout.ts` uses a uniform `rowHeight` (60px) for ALL messages, regardless of whether they are self-messages. The DFS traversal at lines 311-336 assigns each message exactly 1 row, incrementing `currentRow` by 1.

However, the self-message loopback arrow (rendered in `SequenceDiagramRenderer.tsx` lines 1040-1106) extends vertically by `SELF_MESSAGE_LOOP_HEIGHT = 30` pixels below the message's Y position (line 327, constant defined at line 327 of the renderer). The loopback path goes from `baseY` (the message row Y) down to `baseY + 30`.

With `rowHeight = 60` and `SELF_MESSAGE_LOOP_HEIGHT = 30`, the bottom of the loop is at `y + 30`, and the next message is at `y + 60`. This leaves only 30px gap (minus label space), which can cause visual collisions especially when messages have labels or are at fragment boundaries.

**Confirmed approach:** Add a fixed 30px self-loop height to the reserved vertical space. No configurable padding.

**Key constants:**
- `LAYOUT_CONSTANTS.rowHeight` = 60 (line 44 of `sequenceLayout.ts`)
- `SELF_MESSAGE_LOOP_HEIGHT` = 30 (line 327 of `SequenceDiagramRenderer.tsx`)

**File requiring changes:**
- `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/sequenceLayout.ts` -- the `dfsTraverse` function (lines 308-365), specifically the message branch (lines 312-336). When a message is a self-message (from_participant_id === to_participant_id), the layout must account for the extra 30px vertical space consumed by the loopback.

- The `computeSequenceLayout` function needs access to message data to detect self-messages, which it already has via `messageMap`.

- Fragment bottom Y calculation (lines 393-394) uses `extent.endRow * rowHeight + 30`. If the last message in a fragment is a self-loop, the fragment bottom needs to account for the extra loop height.

**Test file to update/extend:**
- `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/__tests__/sequenceLayout.test.ts`

---

#### Fix 2: Collection Label Rendering

**Code Analysis Result: The rendering logic already exists and is correct.**

The `resolveMessageLabel` function in `SequenceDiagramRenderer.tsx` (lines 531-559) already calls `formatEntityLabel(entity.name, message.is_collection, message.ref_kind)` at line 544. The `formatEntityLabel` function (lines 507-516) correctly returns `Collection<${entityName}>` when `isCollection` is true and the ref_kind is PhysicalEntity or LogicalEntity.

**Confirmed approach:** Fix the full data pipeline. The `is_collection` value from the `SequenceMessageRef` (typedContent) is not being properly mapped to the `SequenceMessage` when constructing the sequence diagram data from the `TypedContentEnvelope`. Fix that mapping so the renderer receives the field.

**Files to investigate for the data mapping gap:**
- Search for where `SequenceContent.messages` (from typedContent) is mapped to `SequenceDiagram.messages` -- this is where `is_collection` is likely being dropped.

**Existing tests confirm the renderer logic works:**
- `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/__tests__/SequenceDiagramRenderer.resolveMessageLabel.test.ts` -- tests PhysicalEntity/LogicalEntity with is_collection=true returning "Collection<EntityName>".

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Self-message rendering - Path: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx` (lines 1040-1106, SelfMessageArrow component)
- Feature: Layout engine - Path: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/sequenceLayout.ts` (complete file, DFS traversal logic)
- Feature: Collection label formatting - Path: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx` (lines 484-559, formatEntityLabel/resolveMessageLabel)

### Follow-up Questions

No follow-up questions needed. The user's answers are clear and decisive.

## Visual Assets

### Files Provided:
No visual assets provided. User confirmed none are needed for these simple fixes.

## Requirements Summary

### Functional Requirements
- Self-loop messages must reserve an additional fixed 30px of vertical space based on the bottom of the loopback shape (baseY + SELF_MESSAGE_LOOP_HEIGHT), not the top segment Y
- Standard inter-message padding must be measured from the bottom-most Y of the self-loop
- Fragment boundaries must not overlap or touch self-loop shapes
- The full data pipeline from TypedContentEnvelope to SequenceMessage must propagate is_collection so that Collection labels for PhysicalEntity/LogicalEntity render as "Collection<EntityName>"

### Reusability Opportunities
- The `SELF_MESSAGE_LOOP_HEIGHT` constant (30px) from SequenceDiagramRenderer.tsx should be imported/shared with sequenceLayout.ts rather than duplicated
- The `isSelfMessage()` helper from SequenceDiagramRenderer.tsx could be reused or a similar check added in the layout engine
- Existing test helpers in `sequenceLayout.test.ts` (createTestDiagram, createParticipant, createMessage) can be extended for self-message test cases

### Scope Boundaries
**In Scope:**
- Fix 1: Modify vertical layout calculation in `sequenceLayout.ts` to add fixed 30px for self-loop messages
- Fix 1: Ensure fragment bottom boundaries account for self-loop messages
- Fix 2: Trace and fix the data mapping pipeline ensuring `is_collection` flows from TypedContentEnvelope through to SequenceMessage
- Add/update unit tests for both fixes

**Out of Scope:**
- No changes to diagram data model or backend persistence
- No changes to non-self-message layout behavior
- No changes to fragment semantics
- No new UI controls
- No configurable spacing/padding options
- No changes to export/print behavior
- No changes to message ordering, routing, or fragment definitions

### Technical Considerations
- **Fix 1 primary file:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/sequenceLayout.ts` - DFS traversal message handling (lines 312-336)
- **Fix 1 constant sharing:** `SELF_MESSAGE_LOOP_HEIGHT` = 30 is defined in SequenceDiagramRenderer.tsx and needs to be accessible to sequenceLayout.ts (consider moving to shared constants or importing)
- **Fix 1 approach:** Add fixed 30px to reserved vertical space for self-messages, no configurability
- **Fix 1 fragment impact:** Fragment bottomY calculation (line 394) needs adjustment when last message is self-loop
- **Fix 2 approach:** Fix the full pipeline -- trace where TypedContentEnvelope messages are mapped to SequenceDiagram messages and ensure is_collection is carried through
- **Fix 2 renderer:** Already correct, no changes needed to formatEntityLabel or resolveMessageLabel
- **Test files:** `sequenceLayout.test.ts` for layout fix, `SequenceDiagramRenderer.resolveMessageLabel.test.ts` for collection label verification
- **Tech stack:** React 18.x, TypeScript 5.x, Vitest for testing
