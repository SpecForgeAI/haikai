Title: Advanced Add – Do Not Create Attribute Nodes; Use Attributes Only for ERD Rendering

Summary:
Currently, "Add with attributes" for Logical/Physical Entities works correctly:
- It creates a single LOGICAL_ENTITY or PHYSICAL_ENTITY diagram node.
- It renders the selected attributes as text rows inside the entity box (ERD/UML style).
- No LOGICAL_DATA_ATTRIBUTE or PHYSICAL_DATA_ATTRIBUTE nodes are created.

However, **Advanced Add…** still tries to create diagram nodes for attributes when they are selected in the tree, leading to validation errors such as:
"Node ... has unknown entity type LOGICAL_DATA_ATTRIBUTE".

We want Advanced Add to behave like "Add with attributes" in this respect:
- LOGICAL_DATA_ATTRIBUTE and PHYSICAL_DATA_ATTRIBUTE MUST NOT be created as diagram nodes.
- Attribute selections in Advanced Add only influence which attributes are rendered inside the entity's ERD-style box.

--------------------------------------------------------------------
1. No attribute diagram nodes anywhere

Canonical rule:
- The diagram layer MUST NOT create or persist nodes of type:
  - LOGICAL_DATA_ATTRIBUTE
  - PHYSICAL_DATA_ATTRIBUTE

This applies to:
- Advanced Add…
- Any RHS context menu actions
- Any palette actions

Attributes remain **meta-model entries only**, used for ERD rendering inside entity nodes.

If any existing code is constructing diagram nodes with `entityType: LOGICAL_DATA_ATTRIBUTE` or `PHYSICAL_DATA_ATTRIBUTE`, that behaviour MUST be removed.

--------------------------------------------------------------------
2. Advanced Add behaviour for Logical/Physical Entities + Attributes

In the Advanced Add tree, Logical/Physical Entities appear with their attributes as children, e.g.:

- Logical Data Entity: Entity
  - Logical Data Attribute: Attr1
  - Logical Data Attribute: Attr2

Required Advanced Add semantics:

2.1 Selection meaning

- When the user selects a Logical Entity (LE) and one or more of its Logical Data Attributes (LDAs):
  - Advanced Add MUST create **only one** diagram node:
    - `entityType: LOGICAL_ENTITY`
    - `entityId: <LE id>`
  - The set of selected LDAs is recorded as the list of attributes to be rendered in the ERD-style box for that entity.

- Similarly, for a Physical Entity (PE) with Physical Data Attributes (PDAs):
  - Only a `PHYSICAL_ENTITY` node is created.
  - Selected PDAs determine which attribute rows are shown.

2.2 Unselected attributes

- If some attributes under the entity are **unchecked** in Advanced Add:
  - Those attributes MUST NOT appear in the ERD-style attribute list for that entity on the diagram.
- If the entity is selected but none of its attributes are selected:
  - The entity still appears as an ERD-style box with just its header (no attribute rows).

2.3 Node creation

When Advanced Add is confirmed ("Add to Diagram"):

- For each Logical Entity in the selection:
  - If at least the entity row is selected:
    - Ensure there is exactly one LOGICAL_ENTITY diagram node.
    - Attach the list of selected attributes (may be empty) as rendering metadata for that node.
- For each Physical Entity in the selection:
  - Same pattern with PHYSICAL_ENTITY.

- In all cases:
  - Do NOT create any diagram nodes for LOGICAL_DATA_ATTRIBUTE or PHYSICAL_DATA_ATTRIBUTE.
  - The diagram node list MUST NOT contain entries with those entityTypes.

--------------------------------------------------------------------
3. ERD/UML rendering uses attribute metadata, not attribute nodes

Rendering logic:

- Logical Entities:
  - Rendered as a single ERD-style box:
    - Top: entity name
    - Divider line
    - Below: rows for each selected Logical Data Attribute:
      - `attributeName : dataType`

- Physical Entities:
  - Same pattern, with Physical Data Attributes.

- The renderer gets its attribute list from:
  - The meta-model Logical/Physical Attribute records, filtered by the selection passed from Advanced Add.
  - It does **not** depend on attribute diagram nodes.

--------------------------------------------------------------------
4. Diagram load/save behaviour

4.1 Saving

- When saving a diagram:
  - The diagram JSON must not contain nodes with `entityType: LOGICAL_DATA_ATTRIBUTE` or `PHYSICAL_DATA_ATTRIBUTE`.
  - Logical/Physical Entity nodes may carry an internal field (implementation detail) indicating which attributes are included in their ERD view (e.g. a list of attribute IDs). The exact field name is implementation-specific.

4.2 Loading

- When loading a diagram created with this new behaviour:
  - Entity nodes are loaded.
  - The renderer uses the stored attribute-selection metadata to reconstruct the ERD-style attribute list.

- If legacy diagrams still contain attribute nodes (from before this spec is applied), it is acceptable for now to:
  - treat them as invalid and refuse to load, OR
  - ignore them, depending on implementation preference.
  - The key requirement is that **new** diagrams do not create such nodes.

--------------------------------------------------------------------
5. Acceptance Criteria

1. Using "Add with attributes" on a Logical or Physical Entity continues to:
   - Create a single entity node.
   - Render attributes as rows inside the box.

2. Using **Advanced Add…** with a Logical or Physical Entity and its attributes selected:
   - Results in exactly one node per entity (LOGICAL_ENTITY / PHYSICAL_ENTITY).
   - Attributes appear correctly as rows inside the entity's ERD-style box.
   - No LOGICAL_DATA_ATTRIBUTE / PHYSICAL_DATA_ATTRIBUTE nodes are created.

3. Diagram JSON produced after this change contains:
   - Entity nodes only for entities.
   - Zero nodes with entityType LOGICAL_DATA_ATTRIBUTE or PHYSICAL_DATA_ATTRIBUTE.

4. The previous validation error:
   - "Node ... has unknown entity type LOGICAL_DATA_ATTRIBUTE"
   no longer occurs for diagrams created or updated after this spec is implemented.

This aligns Advanced Add behaviour with "Add with attributes", ensuring attributes are always drawn inside entity/class boxes and never as standalone diagram nodes.
