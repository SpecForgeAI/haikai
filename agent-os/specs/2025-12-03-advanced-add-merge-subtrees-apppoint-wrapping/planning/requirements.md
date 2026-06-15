# Requirements: Frontend Advanced Add – merge subtrees, include App Point ↔ Process, and recursively wrap selected subtrees

## Summary

Refine the Advanced Add behaviour in three ways:
1) The tree shown in the Advanced Add dialog must merge duplicate subtrees into a single coherent hierarchy per root entity (up to a maximum depth of 10).
2) The App Point ↔ Process association chain (Application → Business Process → Process Activity) must appear in the Advanced Add tree in the same way that Interface ↔ Logical Entity already does, and only these two associations are rendered as parent/child-like branches in the tree.
3) When a subtree is selected in Advanced Add (e.g. Logical Data Entities), the diagram must apply the existing recursive wrapping/nesting rules from the selected leaf nodes up to the root, so the resulting diagram uses the same containment visuals as existing "Add with …" context menu options.

## Scope

- Advanced Add tree-building logic (frontend + backend where applicable).
- Advanced Add tree content for the App Point ↔ Process association.
- Diagram placement/wrapping behaviour when applying Advanced Add selections.

## Out of scope

- Any change to the existing meta-model semantics of parent/child vs association relationships.
- Any change to non-Advanced-Add context menu options ("Add", "Add with application components", etc.), beyond reusing their existing wrapping behaviour.

---

## 1. Tree-building: merge duplicate subtrees and enforce max depth

Amend the previous Advanced Add specification for tree construction as follows.

### 1.1 Node uniqueness and subtree merging

Requirement:

- When building the Advanced Add tree for a given root entity instance:
  - The tree builder must treat each underlying entity instance as **logically unique** within the tree.
  - If the traversal discovers the same entity instance (same entity type + same entity id) via multiple relationship paths, the tree must:
    - Represent that entity as **a single tree node**.
    - Merge any child branches that would have appeared under separate copies into this one node.

Example (for an Application root):

- If traversal discovers:
  - Application → App Component → Service → Interface → Logical Data Entities
  - Application → Service → Interface → Logical Data Entities
- The tree displayed MUST be merged into a single coherent branch, such as:

  - Application: My App
    - App Component: My Component (parent/child)
      - Service: My Service (parent/child)
        - Interface: My API (parent/child)
          - Logical Data Entity: Entity 1 (association)
          - Logical Data Entity: Entity 2 (association)

Implementation notes (behavioural):

- Node identity is determined by `(entityType, entityId)`.
- The tree builder maintains a lookup of created nodes; when a new traversal step reaches an already-instantiated node, it must:
  - Reuse that node instead of creating a duplicate.
  - Attach any new children discovered via the new path to the existing node.

### 1.2 Maximum tree depth

Requirement:

- The Advanced Add tree must not exceed a **maximum depth of 10** levels from the root.
- "Depth" here is defined as:
  - Depth 0: the root entity.
  - Depth 1: its direct children.
  - …
  - Depth 10: the deepest allowed level of children.

Behaviour:

- When traversal would go deeper than depth 10:
  - The tree builder MUST stop expanding further.
  - Child nodes beyond depth 10 are not shown in the tree.
- The spec does not require any special placeholder (e.g. "…"), but the implementation may optionally indicate truncation if desired.

This guarantees that Advanced Add trees remain bounded even in very dense or cyclic graphs.

---

## 2. Include App Point ↔ Process association chain as a tree branch

Clarify and extend the notion of "expandable relationships" used by Advanced Add, with explicit treatment for App Point ↔ Process.

### 2.1 Tree-visible association relationships

The spec must state:

- There are two association types that MUST be rendered as child branches in the Advanced Add tree (i.e. visually similar to parent/child):
  1. `Interface ↔ Logical Entity` (already working today).
  2. `App Point ↔ Process` (must now be included).

- For these association types:
  - When traversing from an entity that participates in the association, the related entity(ies) are considered **children** in the Advanced Add tree.
  - They should be labelled with the same "(association)" hint, but appear as selectable child nodes in the hierarchy.

### 2.2 Application → Business Process → Process Activity chain

Requirement:

- Given an Application "My App" with the usual structures:
  - Application → App Point (association or via some App Point container)
  - App Point ↔ Process (association)
  - Process → Process Activity (parent/child)
- The Advanced Add tree for the Application root MUST include a branch representing this chain.

Example tree fragment:

- Application: My App
  - Business Process: My Business Process (association via App Point ↔ Process)
    - Process Activity: My Process Activity (parent/child)

Notes:

- The exact labels ("Business Process" vs "Process", "App Point") should follow the existing entity naming in the meta-model.
- The important behavioural requirement is:
  - The App Point ↔ Process association must be traversed and exposed in the same way that Interface ↔ Logical Entity currently is.
- No other association types are required to appear as child branches in this iteration unless already specified in previous Advanced Add rules.

---

## 3. Diagram behaviour: recursively wrap selected subtrees from leaf to root

Refine the diagram behaviour that applies when the user confirms an Advanced Add selection.

### 3.1 Implicit inclusion of ancestor nodes for selected leaves

Requirement:

- When the user selects any subtree in the Advanced Add tree (for example, a branch for Logical Data Entities), the system MUST:
  - Implicitly include all ancestor nodes on the selected path from the leaf up to the root entity, even if those ancestor checkboxes are not individually ticked.
- This ensures that:
  - If a leaf node is selected to be added to the diagram, its parent, grandparent, etc., along that path are also available to render as containers/wrappers.

Example:

- User checks only:
  - `Logical Data Entity: Entity 1`
  - `Logical Data Entity: Entity 2`
- The system must treat the selection as including:
  - `Interface: My API`
  - `Service: My Service`
  - `App Component: My Component`
  - `Application: My App`
  along the path that leads to those logical entities.

### 3.2 Recursive wrapping / nesting using existing rules

Requirement:

- When adding nodes to the diagram based on an Advanced Add selection:
  - The diagram engine must apply the **existing wrapping/nesting rules** (currently used by other context menu options such as "Add with application components") recursively from the leaf nodes up to the root.
- Visual behaviour must match existing containment rules:
  - The parent node visually wraps its child nodes:
    - Parent text is bold and top-aligned.
    - There is ~5px padding between:
      - The container border and the text.
      - The text and the child elements.
  - These rules are applied for each level of the containment chain.

Algorithm (behavioural):

- For each selected leaf node (e.g. Logical Data Entity):
  1. Ensure the leaf node is present on the diagram.
  2. Walk up the parent chain (using parent/child relationships and the two tree-visible associations where applicable) to the root of the selected subtree.
  3. For each ancestor in that chain:
     - Ensure a diagram node exists for that ancestor.
     - Apply the wrapping rules so that:
       - The ancestor node becomes the container for its immediate descendants on that path.
     - This wrapping is applied recursively:
       - Leaf(s) nested inside their parent.
       - That parent nested inside its parent, and so on up to the root.

- The net visual result for the previously flat example:
  - Current (flat):
    - Application: My App
    - App Component: My Component
    - Service: My Service
    - Interface: My API
    - Entity 1
    - Entity 2
  - Desired (nested):
    - Application: My App
      - App Component: My Component
        - Service: My Service
          - Interface: My API
            - Entity 1
            - Entity 2

### 3.3 Idempotency and coexistence with existing behaviour

- These recursive wrapping rules must integrate with existing diagram logic such that:
  - If some ancestors are already on the diagram:
    - They are reused as containers; no duplicate parent nodes are created.
  - The Advanced Add wrapping behaviour does not break or override existing explicit "Add with …" operations; both follow the same visual rules.

---

This spec update is limited to:
- Merging Advanced Add subtrees into a single coherent hierarchy per root, with depth capped at 10.
- Ensuring the App Point ↔ Process association chain is included in the Advanced Add tree (visually as a parent/child-like branch) alongside the existing Interface ↔ Logical Entity association.
- Applying recursive wrapping from the selected leaves up to the root when materialising Advanced Add selections on the diagram, using the existing containment visual rules.
