title: ER diagrams v1 parity — render entity attributes like General + add "+ New Logical ER" button in ER palette

intent:
  - Make ER diagram rendering of Logical/Physical Entities match General diagram "class-style" boxes (name header + attributes list).
  - Add missing ER-specific create button "+ New Logical ER" in the RHS panel when an ER diagram is active.

scope:
  in:
    - frontend: ER diagram canvas renderer for LOGICAL_DATA_ENTITY + PHYSICAL_DATA_ENTITY nodes
    - frontend: RHS Palette CREATE section when diagram_type === 'ER'
  out:
    - backend schema changes
    - ER edge rendering enhancements beyond existing Logical ER edges

acceptance_criteria:
  1) Rendering:
     - In an ER diagram, nodes of entity_type LOGICAL_DATA_ENTITY and PHYSICAL_DATA_ENTITY render with:
         - top header bar containing entity name
         - attributes listed below (if any) with the same formatting used in General diagrams
     - The rendered layout is visually identical to General diagram rendering for these entity types.
  2) RHS buttons:
     - When diagram_type === 'ER', RHS CREATE area shows exactly:
         - + New Logical Entity
         - + New Physical Entity
         - + New Logical ER
     - Clicking "+ New Logical ER" creates a Logical ER relationship row (meta-model) and persists it via the normal save flow.

================================================================================
A) ER DIAGRAM ENTITY RENDERING PARITY
================================================================================

1) Locate existing General diagram renderer for Logical/Physical Entities
  - Find the component/function used to render LOGICAL_DATA_ENTITY and PHYSICAL_DATA_ENTITY in General diagrams.
  - It will include:
      - a header bar
      - a computed list of attributes for the entity
      - attribute row formatting (e.g. "LA1 : string_uuid")

2) Reuse the same renderer in ER diagrams
  - Locate ER diagram renderer / ER branch in Canvas rendering (diagram_type === 'ER').

  - Update ER rendering for node.entity_type in:
      - LOGICAL_DATA_ENTITY
      - PHYSICAL_DATA_ENTITY

  - Implementation rule:
      - Do NOT create a new ER-specific version of the entity box.
      - Instead, call/reuse the existing General renderer (or extract a shared component):
          - Extract shared component if needed:
              src/components/DiagramsView/renderers/shared/DataEntityBox.tsx
          - Inputs:
              - entityName: string
              - attributes: Array<{ name: string; dataType?: string; typeRef?: string }>
              - sizing/layout props consistent with General

3) Attribute resolution must match General
  - For LOGICAL_DATA_ENTITY:
      - attributes come from metaModelEntities.logical_data_attributes filtered by logical_data_entity_id (or equivalent FK)
  - For PHYSICAL_DATA_ENTITY:
      - attributes come from metaModelEntities.physical_data_attributes filtered by physical_data_entity_id (or equivalent FK)

4) Ensure ER diagram does not override text-centering
  - Remove/disable any ER-specific "centered name only" style for these entity types.

================================================================================
B) RHS PANEL: ADD "+ NEW LOGICAL ER" IN ER DIAGRAMS
================================================================================

1) Add new button in ER CREATE block
  file: src/components/DiagramsView/PalettePanel.tsx (or ER-specific block used by it)

  - In the conditional section that renders ER diagram palette:
      - keep existing buttons:
          - + New Logical Entity
          - + New Physical Entity
      - add third button:
          - + New Logical ER

  - Place the new button under the two existing entity buttons (same style/size).

2) Implement handler to create LogicalER meta-model row
  - Follow the same pattern used by existing "create-in-diagram" buttons:
      - create entity row in ArchitectureContext state
      - persist via existing save path (no dedicated API)

  - Create defaults (must match current LogicalER DTO fields):
      - id: generated (use existing id helper)
      - name: optional or derived, e.g. "logical-er-<shortId>" (if name exists)
      - cardinality: default enum value (e.g. ONE_TO_ONE) if required, else null
      - relationship: default enum value (e.g. ASSOCIATION) if required, else null
      - from/to entity refs may be null at creation time (user will wire via diagram edge creation later)
      - created_at/updated_at handled server-side

  - Append to:
      metaModelEntities.logical_ers (or whatever collection name exists in your model)

3) Ensure the ER palette expands section list includes "Logical ER"
  - If "Logical ER" section already exists (shown in screenshot), leave as-is.
  - If it is hidden for ER diagrams, ensure it is shown when diagram_type === 'ER'.

================================================================================
VERIFICATION
================================================================================

Manual:
  - Open ER diagram containing Logical/Physical entities with attributes:
      - Confirm header bar + attribute list matches General appearance.
  - In ER diagram RHS:
      - Confirm 3 CREATE buttons exist including "+ New Logical ER".
      - Click "+ New Logical ER":
          - new Logical ER row appears in the "Logical ER" section list
          - save + reload retains the new row

definition_of_done:
  - ER diagrams render entities + attributes identically to General.
  - ER diagrams RHS includes "+ New Logical ER" creation button, wired to persistence.
