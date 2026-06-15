# Specification: Extend Sequence Diagram Message Exchange Reference Types to Support Interface and Endpoint

## Goal
Allow sequence diagram Message Exchanges to reference Interface and InterfaceEndpoint entities from the meta-model, making them selectable in the Reference Type dropdown and renderable in both the sequence editor and diagram renderer.

## User Stories
- As a sequence diagram author, I want to reference an Interface in a message exchange so that I can model API-level interactions between participants.
- As a sequence diagram author, I want to reference an InterfaceEndpoint in a message exchange so that I can model specific operation calls between participants.

## Specific Requirements

**Extend MessageRefKind type definition**
- Add `Interface` and `InterfaceEndpoint` to the `MessageRefKind` union type in `src/types/sequenceDiagram.ts`
- Add both values to the `MESSAGE_REF_KINDS` array constant
- The `isMessageRefKind` type guard will automatically validate against the updated array
- Maintain backward compatibility with existing reference kinds (Method, LogicalEntity, PhysicalEntity, Class, Event)

**Update Reference Type dropdown population in AddMessageExchangeDrawer**
- Extend the `getReferenceOptions` function in `src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
- Add case `Interface` returning `metaModel.entities.interfaces.map(i => ({ id: i.id, name: i.name }))`
- Add case `InterfaceEndpoint` returning `metaModel.entities.endpoints.map(e => ({ id: e.id, name: e.name }))`
- The existing dropdown rendering already iterates over `MESSAGE_REF_KINDS` so no template changes required

**Update message label resolution in SequenceNodeRow**
- Extend the `getMessageContentLabel` function in `src/components/DiagramsView/SequenceEditor/SequenceNodeRow.tsx`
- Add case `Interface` returning `metaModel.entities.interfaces?.find(i => i.id === refId)?.name || refKind`
- Add case `InterfaceEndpoint` returning `metaModel.entities.endpoints?.find(e => e.id === refId)?.name || refKind`
- Follow the existing switch case pattern for consistency

**Update resolveMessageLabel utility function**
- Extend the `resolveMessageLabel` function in `src/utils/sequenceDiagramUtils.ts`
- Add case `Interface` looking up from `metaModel.entities.interfaces`
- Add case `InterfaceEndpoint` looking up from `metaModel.entities.endpoints`
- Return fallback format `Interface:${message.ref_id}` or `InterfaceEndpoint:${message.ref_id}` when entity not found

**Update MESSAGE_REF_KIND_TO_COLLECTION mapping in SequenceDiagramRenderer**
- Extend the `MESSAGE_REF_KIND_TO_COLLECTION` constant in `src/components/DiagramsView/SequenceDiagramRenderer.tsx`
- Add mapping `Interface: 'interfaces'` to match `MetaModelEntities.interfaces` collection key
- Add mapping `InterfaceEndpoint: 'endpoints'` to match `MetaModelEntities.endpoints` collection key
- The existing `resolveMessageLabel` function in renderer will automatically use this mapping

**Update frontend tests**
- Modify `src/__tests__/flow-tab.test.ts` to validate the new reference kinds
- Update the test that asserts `MESSAGE_REF_KINDS` contains all expected values
- Add `Interface` and `InterfaceEndpoint` to the expected values list
- Update the length assertion from `5` to `7` for the MESSAGE_REF_KINDS array

## Visual Design
No visual mockups provided. The feature extends existing UI elements (dropdown menus, message labels) with new options following established patterns.

## Existing Code to Leverage

**MessageRefKind type and MESSAGE_REF_KINDS array in sequenceDiagram.ts**
- Lines 28-35: `MessageRefKind` union type defines valid reference kinds
- Lines 76-82: `MESSAGE_REF_KINDS` array lists all values for iteration and validation
- Lines 109-111: `isMessageRefKind` type guard validates against the array
- Pattern to follow: add new kinds to both the type union and the array constant

**getReferenceOptions function in AddMessageExchangeDrawer.tsx**
- Lines 122-142: Switch-case function maps refKind to metaModel collections
- Returns `Array<{ id: string; name: string }>` for dropdown population
- Uses optional chaining pattern `(metaModel.entities.X || []).map()`
- Pattern to follow: add two new cases for Interface and InterfaceEndpoint

**getMessageContentLabel function in SequenceNodeRow.tsx**
- Lines 93-126: Resolves message ref_kind/ref_id to display label
- Uses switch-case pattern with optional chaining for safe lookups
- Returns `refKind` as fallback when entity not found
- Pattern to follow: add two new cases matching the existing structure

**resolveMessageLabel in sequenceDiagramUtils.ts**
- Lines 90-128: Utility function for message label resolution
- Returns `label_text` if set, otherwise looks up entity by ref_kind/ref_id
- Uses fallback format `${message.ref_kind}:${message.ref_id}`
- Pattern to follow: add two new cases with the same fallback pattern

**MESSAGE_REF_KIND_TO_COLLECTION in SequenceDiagramRenderer.tsx**
- Lines 166-172: Maps MessageRefKind to MetaModelEntities collection keys
- Used by renderer's resolveMessageLabel for entity lookups
- Type-safe Record mapping ensures correct collection access
- Pattern to follow: add Interface and InterfaceEndpoint mappings

## Out of Scope
- Backend persistence changes for sequence diagram messages
- Migration of existing sequence diagram data
- Changes to architecture-model-service or Java DTOs
- Changes to diagram export/import formats
- Adding Interface/InterfaceEndpoint as participant reference kinds (already supported)
- UI styling changes for the dropdown or message labels
- Validation of referenced entities existence
- Cascading updates when referenced entities are deleted
- Any changes to fragment or operand handling
