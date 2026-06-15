# Raw Idea

## Title
Reclassify Interactions as a Relationship and Render as Dotted Edges (No Interaction Node)

## Summary
User Interactions are currently implemented as diagram nodes (e.g. yellow "Interaction A" boxes) with a "User Interactions" section in the diagram palette and an "Interactions" entity tab. This is incorrect: an Interaction is conceptually a relationship between a User and one or two App_Business_Points. This spec:
- Reclassifies Interactions as a RELATIONSHIP in the meta-model.
- Moves the Interactions table into the relationships row.
- Changes the diagram palette ordering.
- Removes Interaction diagram nodes and replaces them with dotted edges + movable labels as the visualisation.
- Updates the JSON schema and persistence to store Interactions as relationship edges, not nodes.

## Key Changes

### 1. Meta-model: Move Interactions to Relationships Row
- Remove from entities row
- Add to relationships row after "App Point <-> Business Point", before "Logical ER"
- Tab label remains "Interactions"

### 2. Diagram Palette: Move "User Interactions" Section
- Move from entity sections to relationship sections
- Position after "App Point <-> Business Point"

### 3. Diagram Visualization: Edges Instead of Nodes
- Two App_Business_Points case:
  - Dotted line between primary and secondary App_Business_Points
  - Movable label with Interaction name centered on line
  - Second dotted line from User node to midpoint of main line
- Single App_Business_Point case:
  - Single dotted line from User to App_Business_Point
  - Movable label centered on line
- NO interaction node/box is drawn

### 4. JSON Schema Changes
- Remove node-based storage for interactions
- Store as edges with type USER_INTERACTION_MAIN and USER_INTERACTION_USER_LINK
- Include label position metadata

### 5. Editing Behavior
- Label is draggable/movable
- Changes in Interactions table update diagram edges
- Deleting Interaction removes edges from diagrams

## Acceptance Criteria
- AC1: Interactions appear in relationships row, not entities row
- AC2: "User Interactions" section in palette after "App Point <-> Business Point"
- AC3: Diagram renders dotted edges with movable labels, no interaction box
- AC4: JSON stores interactions as edges, not nodes
- AC5: Editing Interaction updates diagrams, deleting removes edges

## Working Directory
C:\Workspaces\SSD\architecture-store-and-diagrams
