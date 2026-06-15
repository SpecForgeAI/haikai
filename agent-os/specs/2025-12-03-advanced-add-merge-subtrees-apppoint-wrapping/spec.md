# Specification: Advanced Add - Merge Subtrees, App Point Process Chain, and Recursive Wrapping

## Goal
Enhance the Advanced Add dialog to merge duplicate subtrees into a coherent hierarchy (max depth 10), include the App Point to Process association chain as a tree branch alongside Interface to Logical Entity, and apply recursive wrapping from selected leaf nodes up to the root when placing nodes on the diagram.

## User Stories
- As an architect, I want the Advanced Add tree to show each entity only once (even if reachable via multiple paths) so that I can clearly understand the hierarchy and select related items without confusion.
- As a modeler, I want selected leaf nodes (e.g., Logical Data Entities) to be automatically nested inside their parent containers when added to the diagram so that the visual hierarchy matches the meta-model relationships.

## Specific Requirements

**Tree Node Uniqueness and Subtree Merging**
- Node identity is determined by the tuple (entityType, entityId)
- The tree builder must maintain a lookup map of created nodes keyed by (entityType, entityId)
- When traversal discovers an already-instantiated node via a different path, reuse that node instead of creating a duplicate
- Merge any new child branches discovered via the new path into the existing node's children array
- Example: Application -> App Component -> Service -> Interface and Application -> Service -> Interface must merge into a single coherent branch

**Maximum Tree Depth of 10**
- Define depth 0 as the root entity, depth 1 as direct children, and so on
- The tree builder must stop expanding when depth exceeds 10
- Child nodes beyond depth 10 are not rendered in the tree
- No special truncation indicator is required, but may optionally be shown

**App Point to Process Association in Tree**
- Add App Point to Process relationship to the tree-visible associations alongside Interface to Logical Entity
- Update EXPANDABLE_RELATIONSHIPS map in advancedAddRelationships.ts to include this traversal path
- When traversing from Application, include Business Processes linked via ApplicationPoint entities
- The relationship kind label should display "(association)" to match existing convention

**Application to Business Process Chain Representation**
- The tree must show: Application -> Business Process (via App Point association) -> Process Activity (parent/child)
- App Point acts as the linking entity but Business Process appears directly under Application in the tree for visual clarity
- Process Activities appear as children of Business Process nodes in the tree

**Implicit Ancestor Selection for Selected Leaves**
- When a user selects any leaf node (e.g., Logical Data Entity), all ancestor nodes on the path to the root must be implicitly included
- This implicit selection enables the recursive wrapping to create proper containment hierarchy
- The selection algorithm already handles ancestor selection via getAncestorKeys helper - verify this covers all paths

**Recursive Wrapping from Leaf to Root**
- When adding nodes from Advanced Add selection, apply wrapping rules recursively from leaves up to root
- For each selected leaf, walk up the parent chain and ensure each ancestor has a diagram node
- Set parent_node_id on child nodes to establish containment relationships
- Apply existing visual rules: parent text is bold, top-aligned with 5px padding between border and text

**Containment Visual Styling**
- Parent nodes must have text_v_align set to 'TOP' and text_font_weight set to 'bold'
- Child nodes are positioned inside parent bounds using calculateChildPositionWithHeights from compoundLayout.ts
- Parent node dimensions must be calculated using calculateParentSizeWithHeights to fit all children
- 5px padding between container border and content on all sides

**Idempotency with Existing Diagram Content**
- If an ancestor node already exists on the diagram, reuse it as the container - do not create duplicates
- Use nodeExistsForEntity helper to check for existing nodes before creation
- For existing parent nodes, call onUpdateNode to apply containment styling and resize to fit new children

**Integration with Existing Add With Operations**
- The recursive wrapping must use the same visual rules as handleAddWithBusinessProcesses and handleAddWithAppComponents
- Reuse calculateChildPositionWithHeights, calculateParentSizeWithHeights, and calculateApplicationLabelHeight utilities
- Do not alter the behaviour of non-Advanced-Add context menu options

**Tree Builder Algorithm Updates**
- Modify buildTreeData function in AdvancedAddDialog.tsx to implement node deduplication
- Add depth tracking parameter that increments at each recursive call
- Implement cycle detection using the node lookup map to prevent infinite loops

## Visual Design
No mockups provided. The tree UI remains unchanged; only the tree content and diagram placement behaviour are modified.

## Existing Code to Leverage

**AdvancedAddDialog.tsx**
- Contains buildTreeData function that constructs TreeNodeData hierarchy
- Has findRelatedEntities helper that queries meta-model for related entities
- Implements getAncestorKeys and getDescendantKeys for selection propagation
- TreeNodeComponent renders the recursive tree with checkboxes and expand/collapse

**advancedAddRelationships.ts**
- Defines EXPANDABLE_RELATIONSHIPS map with relationship definitions per entity type
- App Point to Process association already partially defined but needs to be made tree-visible
- getExpandableRelationships and hasExpandableRelationships functions for relationship lookup
- RelationshipKind type distinguishes PARENT_CHILD from ASSOCIATION

**compoundLayout.ts**
- calculateChildPositionWithHeights computes child node position accounting for variable heights
- calculateParentSizeWithHeights computes parent dimensions to contain all children
- calculateApplicationLabelHeight measures wrapped text height for parent labels
- PADDING constant (5px) and DEFAULT_CHILD_WIDTH (120px) for consistent spacing

**PalettePanel.tsx**
- handleAddWithBusinessProcesses and handleAddWithAppComponents show the pattern for compound add with wrapping
- handleAdvancedAddConfirm currently adds nodes flat - must be updated for recursive wrapping
- Uses onAddNodes for batch node creation and onUpdateNode for resizing existing parents

**rendering.ts**
- supportsChildNodes returns true for APPLICATION, BUSINESS_PROCESS, and SERVICE entity types
- getParentEntityType returns the parent type for APP_COMPONENT, PROCESS_ACTIVITY, and INTERFACE
- isChildEntityType identifies entity types that should be contained within parents

## Out of Scope
- Changes to meta-model semantics of parent/child vs association relationships
- Changes to non-Advanced-Add context menu options beyond reusing their wrapping logic
- Persisting user tree selections as templates or presets
- Progressive expand/collapse on diagram canvas nodes
- Preview visualization before confirming Advanced Add
- Keyboard navigation within the Advanced Add tree
- Undo/redo integration for the Advanced Add operation
- Multi-select from palette to add multiple root entities at once
- Filter/search within the Advanced Add tree
- Visual icons or colours to distinguish relationship types beyond text labels
