# Specification: ER Diagrams V1 Parity

## Goal
Make ER diagram rendering of Logical/Physical Entities match General diagram "class-style" boxes (header + attributes list), and add the missing "+ New Logical ER" button to the RHS palette CREATE section when an ER diagram is active.

## User Stories
- As an architect, I want ER diagrams to render data entities with headers and attributes so that the visualization matches the General diagram style I am already familiar with.
- As an architect, I want a "+ New Logical ER" button in the ER diagram palette so that I can quickly create Logical ER relationships without navigating away from the diagram.

## Specific Requirements

**ER Diagram Entity Rendering Must Use ERD-Style Box**
- When diagram_type is 'ER', LOGICAL_DATA_ENTITY and PHYSICAL_DATA_ENTITY nodes must render using the same ERD-style box as General diagrams
- The ERD-style box includes: header bar with entity name (bold, centered), divider line, and attribute rows (left-aligned)
- Canvas.tsx already has the ERD rendering logic at line ~2229 via `shouldRenderAsERD(node)` check
- The rendering decision is based on `node.render_style === 'erd'` combined with entity type check
- ER diagram nodes must have `render_style: 'erd'` set when created or placed

**Attribute Resolution for ER Diagrams**
- For LOGICAL_DATA_ENTITY: attributes fetched from `metaModel.entities.logical_data_attributes` filtered by `logical_entity_id`
- For PHYSICAL_DATA_ENTITY: attributes fetched from `metaModel.entities.physical_data_attributes` filtered by `physical_entity_id`
- Use `getAttributesForEntity()` from `erdUtils.ts` which already implements this filtering logic
- Nodes must populate `embedded_attribute_ids` array for attributes to render in the ERD box

**Remove Centered-Name-Only Override for ER Diagrams**
- Ensure ER diagram nodes do not default to centered-name-only rendering
- When ER diagram entities are added/placed, set `render_style: 'erd'` explicitly
- Check CreateAndPlaceDrawer and PalettePanel for ER-specific node creation logic

**Add "+ New Logical ER" Button to ER Palette CREATE Section**
- Modify `getCreateSectionButtons()` in PalettePanel.tsx (line ~2607)
- For `case 'ER':` add third button: `{ label: '+ New Logical ER', entityType: 'LOGICAL_DATA_ENTITY_RELATIONSHIP', title: 'Create Logical ER' }`
- Button should appear after "+ New Logical Entity" and "+ New Physical Entity"
- Use same button styling (styles.createButton class)

**Implement Logical ER Creation Handler**
- Add handling for entityType `'LOGICAL_DATA_ENTITY_RELATIONSHIP'` in `handleCreateButtonClick()` callback
- Unlike State Transition or Activity Flow, Logical ER creation can be immediate (no two-click mode needed)
- Create a new LogicalDataEntityRelationship with default values:
  - id: generated using `generatePrefixedId('ler')`
  - source_entity_id: null (user wires via diagram edge creation later)
  - target_entity_id: null
  - relationship_type: 'ONE_TO_ONE' (default cardinality)
  - description: '' (empty)
  - tags: ''

**Persist Logical ER via ADD_RELATIONSHIP Action**
- Dispatch `ADD_RELATIONSHIP` action with relationshipType `'logical_data_entity_relationships'`
- ArchitectureContext reducer handles this at line ~545 for adding to `model.metaModel.relationships.logical_data_entity_relationships`
- Normal save flow persists the change

**Ensure Logical ER Section Visible in ER Palette**
- Check `getPaletteSections()` in paletteData.ts includes logical_data_entity_relationships section for ER diagram type
- If filtered out, ensure it is included when diagramType === 'ER'

## Existing Code to Leverage

**erdUtils.ts - ERD Rendering Utilities**
- `shouldRenderAsERD(node)`: checks if node should render as ERD style (line ~474)
- `getAttributesForEntity()`: fetches attributes by entity ID and type (line ~116)
- `getAttributesByIds()`: fetches attributes by ID list for embedded rendering (line ~154)
- `ERD_HEADER_HEIGHT`, `ERD_ATTRIBUTE_ROW_HEIGHT`: sizing constants for consistent layout

**Canvas.tsx - ERD Node Rendering**
- Lines 2229-2289: existing ERD rendering logic with header, divider, and attribute rows
- Uses `getAttributesByIds()` to resolve `embedded_attribute_ids` for display
- Applies `formatAttribute()` for "name : type" format

**PalettePanel.tsx - Create Section**
- `getCreateSectionButtons()` at line ~2607: returns button configs per diagram type
- `handleCreateButtonClick()` at line ~1042: dispatches appropriate action based on entityType
- CreateAndPlaceDrawer integration for entity creation with form

**ArchitectureContext.tsx - ADD_RELATIONSHIP Action**
- Action type defined at line ~82: `{ type: 'ADD_RELATIONSHIP'; relationshipType: RelationshipType; relationship: AnyRelationship }`
- Reducer handles at line ~545 for appending to relationships array

**relationshipUtils.ts - Logical ER Utilities**
- `getLogicalERNodes()` at line ~909: gets source/target nodes for Logical ER edge rendering
- `getMultiplicityLabels()` at line ~36: returns "1" or "m" labels based on cardinality

## Out of Scope
- Backend schema changes for Logical ER or other entities
- ER edge rendering enhancements beyond existing Logical ER edges
- New visual styling for ER diagrams beyond matching General diagram appearance
- Automatic wiring of Logical ER endpoints (source/target entity refs) - user wires via diagram edge creation
- Two-click creation mode for Logical ER (like State Transition) - immediate creation is sufficient
- Validation of Logical ER before save (source/target can be null at creation time)
- Cardinality selection UI in the create button - defaults to ONE_TO_ONE
- Physical ER relationship support (only Logical ER in scope)
- Attribute CRUD operations from ER diagram context menu
