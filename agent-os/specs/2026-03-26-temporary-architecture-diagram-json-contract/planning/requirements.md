# Spec Requirements: Temporary Architecture Diagram JSON Contract (ER First)

## Initial Description
Define a generic, robust, and LLM-friendly temporary diagram JSON contract (TemporaryArchitectureDiagram) that can represent many future architecture-derived diagrams, with ER diagrams as the first supported example. The contract must be simple enough for an LLM to generate reliably, deterministic enough for tool-side code to map into native diagram data, and avoid any dependency on internal architecture entity/attribute/relationship IDs. This increment defines the contract only -- it does NOT implement prompt behavior, saving, rendering, mapping, modal flows, or finalization.

## Requirements Discussion

### First Round Questions

**Q1:** The existing shared types live in `frontend/src/types/`. However, this contract needs to be usable by the gateway and potentially by the frontend. Currently there is no shared types package between gateway and frontend. Should the new types live in `frontend/src/types/` as the canonical definition, or should we establish a different location?
**Answer:** Do not create a new shared package in this increment; define the canonical contract in `frontend/src/types/temporaryArchitectureDiagram.ts`, and treat that file as the source of truth for now, with gateway/MCP using the documented JSON shape until a later increment introduces a true shared package if needed.

**Q2:** The existing `LogicalDataEntityRelationship` has both `cardinality` and `relationship` (UML type: GENERALIZATION, REALIZATION, COMPOSITION, AGGREGATION, ASSOCIATION, DEPENDENCY). The proposed edge contract captures `cardinality` but maps UML relationship type into generic `semantic_type` and `relationship_hint` strings. Is `semantic_type` + `relationship_hint` sufficient, or should UML relationship type be an explicit field on the edge?
**Answer:** Add an explicit optional `relationship_type` field on `TemporaryArchitectureDiagramEdge` for ER use so UML/relationship semantics are preserved deterministically; do not rely on `semantic_type` + `relationship_hint` alone.

**Q3:** The native `DiagramNode` has a `render_style` field ('standard' | 'erd' | 'contract'). The temporary contract does not have a render_style equivalent. Should it be explicit, or implied by diagram_kind + node_kind?
**Answer:** Do not make render_style explicit in the temporary contract for this increment; mapping/render code should derive it from `diagram_kind === "ER"` (and current ER node semantics), keeping the temporary contract focused on diagram intent rather than native rendering internals.

**Q4:** The native `DiagramNode` uses `embedded_attribute_ids` and `selected_attribute_ids` (arrays of architecture entity IDs). The temporary contract uses `compartments` with structured items carrying `ref_name`, `display_name`, and metadata. Is this the right abstraction?
**Answer:** Yes, compartments are the right abstraction; the LLM should output exact attribute names plus metadata in compartments, and later mapping code should resolve those names to native `embedded_attribute_ids`.

**Q5:** The raw idea lists example payload files as a deliverable. Should these be standalone `.json` files co-located with the type definitions, or elsewhere?
**Answer:** Co-locate the example JSON files with the type definitions in a nearby examples folder, e.g. `frontend/src/types/examples/`, so the contract and its examples evolve together.

**Q6:** The top-level `version: number` field -- what is its initial value and what drives version increments?
**Answer:** Version should start at 1 and only increment for breaking contract changes; additive optional fields do not require a version bump.

**Q7:** The proposed edge has nested `source_label` / `target_label` objects with `{ text, pos_x, pos_y }`, while the native `DiagramEdge` uses separate flat fields. Is the nested structure preferred?
**Answer:** Yes, keep the nested `source_label` / `target_label` structure in the temporary contract because it is more coherent and LLM-friendly; later mapping code can flatten it into the native DiagramEdge fields.

**Q8:** Is there anything explicitly out of scope beyond what the raw idea states? Should we exclude consideration of non-data-domain diagrams at the type-design level?
**Answer:** Keep the structure intentionally generic for future non-data-domain diagrams; only ER is implemented in this increment, but the contract should not artificially exclude later sequence/activity/state/class-style extensions at the type-design level.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: TypedContentEnvelope pattern - Path: `frontend/src/types/typedContent.ts`
  - Uses a similar envelope pattern (type + version + content). The temporary contract is intentionally standalone and should NOT be forced into this existing pattern in this increment, though its design can remain conceptually compatible with envelope-style patterns.
- Feature: Existing ER typed content types - Path: `frontend/src/types/typedContent.ts` (ERContent, EREntityRef, ERRelationshipRef)
  - The spec should explicitly note that these are native/persisted ER typed-content concepts and are NOT the temporary contract. The temporary contract is a pre-binding, name-based interchange structure that later maps into native diagram data.
- Feature: Native diagram types - Path: `frontend/src/types/model.ts` (Diagram, DiagramNode, DiagramEdge, EdgePoint)
  - The target native format that the temporary contract will eventually be mapped INTO by future mapping code.
- Feature: Logical ER relationship types - Path: `frontend/src/types/model.ts` (LogicalERCardinality, LogicalERRelationship, LogicalDataEntityRelationship)
  - Defines the UML relationship semantics and cardinality enums that the temporary contract's edge fields must align with.
- Feature: NodeRenderStyle - Path: `frontend/src/types/model.ts`
  - Defines render styles ('standard' | 'erd' | 'contract') that mapping code will derive from diagram_kind, not stored on the temporary contract.
- Feature: DiagramType - Path: `frontend/src/types/diagramType.ts`
  - Defines the canonical diagram types; the temporary contract's `diagram_kind` field should align conceptually.
- Feature: Gateway ResolvedRelationship - Path: `gateway/src/types/chat.ts` (ResolvedRelationship, RelationshipEndpoint)
  - Shows how the gateway currently models relationships in context bundles; the temporary contract's edge structure should be conceptually compatible.

### Follow-up Questions
No follow-up questions were needed. All answers were comprehensive and unambiguous.

## Visual Assets

### Files Provided:
No visual assets provided. (Confirmed via mandatory filesystem check.)

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements
- Define a new TypeScript type `TemporaryArchitectureDiagram` as the top-level contract in `frontend/src/types/temporaryArchitectureDiagram.ts`
- Define generic node (`TemporaryArchitectureDiagramNode`), edge (`TemporaryArchitectureDiagramEdge`), compartment, compartment item, point, and group sub-types
- Add an explicit optional `relationship_type` field on `TemporaryArchitectureDiagramEdge` using the existing `LogicalERRelationship` enum values (GENERALIZATION, REALIZATION, COMPOSITION, AGGREGATION, ASSOCIATION, DEPENDENCY) for ER use
- Use nested `source_label` / `target_label` objects on edges (not flat fields) for LLM-friendliness
- Use compartments with structured items (ref_name, display_name, metadata) rather than attribute ID arrays
- Support ER as the first diagram kind with both LOGICAL and PHYSICAL view modes
- ER mapping rules: LOGICAL uses semantic_type = "LOGICAL_DATA_ENTITY" / "LOGICAL_DATA_ATTRIBUTE"; PHYSICAL uses "PHYSICAL_DATA_ENTITY" / "PHYSICAL_DATA_ATTRIBUTE"
- No internal architecture IDs in the contract; matching is by exact name only
- Layout must be explicit and complete (positions, sizes, edge points)
- Version field starts at 1, increments only for breaking changes
- Create example JSON payload files (one PHYSICAL ER, one LOGICAL ER) in `frontend/src/types/examples/`
- Add inline documentation/comments for each field
- Optional validation helpers if appropriate

### Reusability Opportunities
- The generic structure (diagram_kind, node_kind, edge_kind, compartment_kind) is designed for future extension to sequence, activity, state, and other diagram kinds
- The compartment abstraction can represent attributes, methods, sections, or other grouped items in future diagram kinds
- The group structure can represent schema groupings, swimlanes, or other container concepts
- Conceptual compatibility with the existing TypedContentEnvelope pattern allows potential future unification

### Scope Boundaries
**In Scope:**
- TypeScript type/interface definitions for all contract types
- Inline JSDoc comments for every field
- Example JSON files (PHYSICAL ER and LOGICAL ER)
- Optional validation helpers
- The explicit optional `relationship_type` field on edges for UML relationship semantics

**Out of Scope:**
- MCP integration
- Saving logic or persistence
- Rendering logic
- Auto-mapping / resolution code (temporary contract to native diagram)
- Confirmation modal logic
- Modifications to native persisted diagram schema
- Implementation of any non-ER diagram kinds
- Prompt behavior or LLM system prompts
- Shared types package between gateway and frontend (future increment)
- Forcing the contract into the existing TypedContentEnvelope pattern

### Technical Considerations
- Canonical type definitions live in `frontend/src/types/temporaryArchitectureDiagram.ts`
- Gateway and MCP consumers will use the documented JSON shape directly until a shared package is established
- No render_style field on the temporary contract; mapping code derives it from `diagram_kind === "ER"`
- The existing `ERContent`, `EREntityRef`, `ERRelationshipRef` in `typedContent.ts` are native/persisted concepts, distinct from this temporary interchange contract
- The project uses plain TypeScript interfaces (no Zod, io-ts, or JSON Schema validation patterns exist)
- The `relationship_type` field on edges should use string literal union types aligned with the existing `LogicalERRelationship` type in `model.ts`
- Edge cardinality values should align with the existing `LogicalERCardinality` type in `model.ts`
