# Task Breakdown: Nested Diagram Schema

## Overview
Total Tasks: 24
Estimated Time: 4-6 hours

## Task List

### Type Definitions

#### Task Group 1: Update Type Interfaces
**Dependencies:** None
**Effort:** M (60-90 min)

- [ ] 1.0 Complete type definition updates
  - [ ] 1.1 Write 4-6 focused tests for type validation
    - Test ENTITY_TYPES constant values are SCREAMING_SNAKE_CASE
    - Test DiagramNode interface has pos_x/pos_y instead of x/y
    - Test DiagramEdge interface includes edge_points array
    - Test Diagram interface includes diagram_nodes and diagram_edges arrays
    - Test ArchitectureModel does not include root-level diagram arrays
  - [ ] 1.2 Create ENTITY_TYPES constant with SCREAMING_SNAKE_CASE values
    - Add: APPLICATION, APP_COMPONENT, SERVICE, APPLICATION_POINT
    - Add: BUSINESS_USER, BUSINESS_PROCESS
    - Add: LOGICAL_DATA_ENTITY, PHYSICAL_DATA_ENTITY
    - Export DiagramEntityType type
  - [ ] 1.3 Update EdgePoint interface
    - Remove `edge_id` field
    - Rename `sequence` to `sequence_order`
    - Rename `x` to `pos_x`, `y` to `pos_y`
  - [ ] 1.4 Update DiagramEdge interface
    - Remove `diagram_id` field
    - Add `edge_points: EdgePoint[]` array
    - Add `relationship_type`, `label_text`, `label_pos_x`, `label_pos_y`
    - Add `line_weight`, `line_type`, `arrow_start`, `arrow_end`
    - Add `style_override: Record<string, unknown>`
  - [ ] 1.5 Update DiagramNode interface
    - Remove `diagram_id` field
    - Rename `x` to `pos_x`, `y` to `pos_y`
    - Change `entity_type` to use DiagramEntityType
    - Add `auto_size`, `z_index`, `style_override`
  - [ ] 1.6 Update Diagram interface
    - Add `diagram_nodes: DiagramNode[]` array
    - Add `diagram_edges: DiagramEdge[]` array
    - Add `diagram_type` and `settings` fields
  - [ ] 1.7 Update ArchitectureModel interface
    - Remove `diagram_nodes`, `diagram_edges`, `edge_points` from root level
    - Keep only `metaModel` and `diagrams`
  - [ ] 1.8 Ensure type definition tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- All interfaces use nested structure
- Position fields use pos_x/pos_y naming
- Entity types use SCREAMING_SNAKE_CASE
- TypeScript compilation passes

### Configuration Layer

#### Task Group 2: Update Defaults and Config
**Dependencies:** Task Group 1
**Effort:** S (30 min)

- [ ] 2.0 Complete configuration updates
  - [ ] 2.1 Write 3-4 focused tests for entity type mappings
    - Test entityColors maps SCREAMING_SNAKE_CASE entity types
    - Test emptyModel has correct nested structure
    - Test entity type lookup functions work with new format
  - [ ] 2.2 Update entityColors mapping in defaults.ts
    - Change keys from PascalCase to SCREAMING_SNAKE_CASE
    - Example: `Application` -> `APPLICATION`
  - [ ] 2.3 Update emptyModel in defaults.ts
    - Remove root-level `diagram_nodes`, `diagram_edges`, `edge_points`
    - Keep only `metaModel` and `diagrams`
  - [ ] 2.4 Ensure configuration tests pass
    - Run ONLY the 3-4 tests written in 2.1
    - Verify entity color lookups work

**Acceptance Criteria:**
- Entity colors map to SCREAMING_SNAKE_CASE types
- emptyModel matches new nested structure
- No compilation errors

### File Operations

#### Task Group 3: Update Load/Parse Operations
**Dependencies:** Task Group 1, Task Group 2
**Effort:** M (45-60 min)

- [ ] 3.0 Complete file load operations
  - [ ] 3.1 Write 4-6 focused tests for loading nested structure
    - Test loading nested diagram_nodes from diagram object
    - Test loading nested diagram_edges from diagram object
    - Test loading nested edge_points from edge object
    - Test default empty arrays when diagram_nodes/diagram_edges missing
    - Test pos_x/pos_y field mapping
  - [ ] 3.2 Update buildModelFromData in fileOperations.ts
    - Remove root-level diagram_nodes, diagram_edges, edge_points parsing
    - Parse diagram_nodes and diagram_edges from each diagram
    - Parse edge_points from each diagram_edge
  - [ ] 3.3 Add helper for parsing diagram arrays
    - Create function to default missing diagram_nodes/diagram_edges to []
    - Handle missing edge_points on edges
  - [ ] 3.4 Ensure load tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify nested data is correctly parsed

**Acceptance Criteria:**
- Nested JSON structure loads correctly
- Missing arrays default to empty
- All diagram data is accessible

#### Task Group 4: Update Save/Serialize Operations
**Dependencies:** Task Group 3
**Effort:** S (30 min)

- [ ] 4.0 Complete file save operations
  - [ ] 4.1 Write 3-4 focused tests for saving nested structure
    - Test saved JSON has nested diagram_nodes in diagram
    - Test saved JSON has nested edge_points in edges
    - Test saved JSON uses pos_x/pos_y field names
    - Test round-trip load-save-load preserves all data
  - [ ] 4.2 Update serializeModel in fileOperations.ts
    - Ensure nested structure is serialized correctly
    - Verify no root-level diagram arrays are included
  - [ ] 4.3 Ensure save tests pass
    - Run ONLY the 3-4 tests written in 4.1
    - Verify saved JSON matches expected structure

**Acceptance Criteria:**
- Saved JSON uses nested structure
- Round-trip preserves all diagram data
- Field names match spec (pos_x, pos_y, sequence_order)

### Validation Layer

#### Task Group 5: Update Validation Logic
**Dependencies:** Task Group 3
**Effort:** M (45-60 min)

- [ ] 5.0 Complete validation updates
  - [ ] 5.1 Write 4-5 focused tests for nested validation
    - Test validateJsonStructure accepts nested diagram arrays
    - Test validateModel validates nodes within diagrams
    - Test entity type mapping for SCREAMING_SNAKE_CASE
    - Test parent node validation within same diagram
  - [ ] 5.2 Update validateJsonStructure in validation.ts
    - Remove validation of root-level diagram_nodes, diagram_edges, edge_points
    - Add validation of nested arrays within diagrams
    - Check diagram_nodes and diagram_edges are arrays if present
  - [ ] 5.3 Update validateModel for nested structure
    - Iterate through each diagram's diagram_nodes and diagram_edges
    - Update entity type mapping to SCREAMING_SNAKE_CASE
    - Remove diagram_id validation (now implicit)
    - Validate edge_points within each edge
  - [ ] 5.4 Update entity type mapping
    - Change `Application` to `APPLICATION`
    - Change all PascalCase to SCREAMING_SNAKE_CASE
  - [ ] 5.5 Ensure validation tests pass
    - Run ONLY the 4-5 tests written in 5.1
    - Verify validation catches invalid references

**Acceptance Criteria:**
- Nested structure validation works correctly
- Entity type validation uses SCREAMING_SNAKE_CASE
- Invalid entity references are detected

### Rendering Layer

#### Task Group 6: Update Rendering Utilities
**Dependencies:** Task Group 1, Task Group 5
**Effort:** M (45-60 min)

- [ ] 6.0 Complete rendering utility updates
  - [ ] 6.1 Write 4-6 focused tests for rendering functions
    - Test getNodesInRenderOrder accesses nodes from diagram object
    - Test getEdgesForDiagram accesses edges from diagram object
    - Test getEdgePoints accesses points from edge object
    - Test getEntityLabel handles SCREAMING_SNAKE_CASE types
    - Test getEntityColor handles SCREAMING_SNAKE_CASE types
  - [ ] 6.2 Update getEntityLabel in rendering.ts
    - Change entityTypeMap to use SCREAMING_SNAKE_CASE keys
    - Example: `APPLICATION_POINT: 'application_points'`
  - [ ] 6.3 Update getNodesInRenderOrder
    - Accept diagram object instead of diagramId
    - Access nodes from `diagram.diagram_nodes`
    - Remove filter by diagram_id
    - Use `node.pos_x` and `node.pos_y` for position access
  - [ ] 6.4 Update getEdgesForDiagram
    - Accept diagram object instead of diagramId
    - Return `diagram.diagram_edges`
    - Remove filter by diagram_id
  - [ ] 6.5 Update getEdgePoints
    - Access points from `edge.edge_points` instead of model.edge_points
    - Use `point.pos_x`, `point.pos_y` instead of x, y
    - Use `point.sequence_order` instead of sequence
    - Update source/target node position access to pos_x/pos_y
  - [ ] 6.6 Update calculateChildBounds and getDiagramBounds
    - Use `node.pos_x` and `node.pos_y` for calculations
    - Accept diagram object where appropriate
  - [ ] 6.7 Update validateDiagramNodes
    - Change entityTypeMap to SCREAMING_SNAKE_CASE keys
    - Access nodes from diagram object
  - [ ] 6.8 Ensure rendering tests pass
    - Run ONLY the 4-6 tests written in 6.1
    - Verify nodes and edges render correctly

**Acceptance Criteria:**
- Rendering functions work with nested structure
- Position fields use pos_x/pos_y
- Entity type lookups work with SCREAMING_SNAKE_CASE

### Context Layer

#### Task Group 7: Update Architecture Context
**Dependencies:** Task Group 1, Task Group 3
**Effort:** S (20-30 min)

- [ ] 7.0 Complete context updates
  - [ ] 7.1 Write 2-3 focused tests for context state
    - Test initial state has no root-level diagram arrays
    - Test model state matches nested structure
  - [ ] 7.2 Update ArchitectureContext.tsx
    - Remove diagram_nodes, diagram_edges, edge_points from initial state
    - Update any state management accessing these arrays
    - Ensure setModel handles nested structure
  - [ ] 7.3 Ensure context tests pass
    - Run ONLY the 2-3 tests written in 7.1
    - Verify context state is correct

**Acceptance Criteria:**
- Context state matches nested model structure
- No references to root-level diagram arrays

### Sample Data

#### Task Group 8: Update Sample Data
**Dependencies:** Task Group 1-7
**Effort:** S (30 min)

- [ ] 8.0 Complete sample data updates
  - [ ] 8.1 Write 2-3 focused tests for sample data
    - Test sample JSON loads without errors
    - Test diagram nodes display at correct positions
    - Test edges connect nodes correctly
  - [ ] 8.2 Update sample-architecture.json structure
    - Move diagram_nodes into each diagram object
    - Move diagram_edges into each diagram object
    - Move edge_points into each edge object
    - Remove root-level diagram arrays
  - [ ] 8.3 Update field names in sample data
    - Change x/y to pos_x/pos_y on nodes
    - Change x/y to pos_x/pos_y on edge_points
    - Change sequence to sequence_order
    - Remove diagram_id from nodes/edges
    - Remove edge_id from edge_points
  - [ ] 8.4 Update entity type values
    - Change to SCREAMING_SNAKE_CASE format
    - Example: `ApplicationPoint` -> `APPLICATION_POINT`
  - [ ] 8.5 Add new fields to sample data
    - Add diagram_type and settings to diagrams
    - Add auto_size, z_index, style_override to nodes
    - Add relationship_type, label_*, line_*, arrow_*, style_override to edges
  - [ ] 8.6 Ensure sample data tests pass
    - Run ONLY the 2-3 tests written in 8.1
    - Verify sample loads and displays correctly

**Acceptance Criteria:**
- Sample JSON uses complete nested structure
- All field names match spec
- Sample loads and displays correctly

### Testing

#### Task Group 9: Test Review & Integration
**Dependencies:** Task Groups 1-8
**Effort:** M (30-45 min)

- [ ] 9.0 Review existing tests and verify integration
  - [ ] 9.1 Review tests from Task Groups 1-8
    - Review type definition tests (Task 1.1): ~4-6 tests
    - Review configuration tests (Task 2.1): ~3-4 tests
    - Review load operation tests (Task 3.1): ~4-6 tests
    - Review save operation tests (Task 4.1): ~3-4 tests
    - Review validation tests (Task 5.1): ~4-5 tests
    - Review rendering tests (Task 6.1): ~4-6 tests
    - Review context tests (Task 7.1): ~2-3 tests
    - Review sample data tests (Task 8.1): ~2-3 tests
    - Total existing tests: approximately 26-37 tests
  - [ ] 9.2 Analyze test coverage gaps
    - Focus ONLY on gaps related to nested schema feature
    - Identify missing integration between components
    - Prioritize end-to-end load/save/render workflow
  - [ ] 9.3 Write up to 8 additional integration tests
    - Full round-trip: load nested JSON -> display -> save -> reload
    - Entity type color mapping end-to-end
    - Validation error reporting for nested structure
    - Edge rendering with nested edge_points
  - [ ] 9.4 Run all feature-specific tests
    - Run ONLY tests related to nested schema feature
    - Expected total: approximately 34-45 tests
    - Verify all acceptance criteria are met

**Acceptance Criteria:**
- All feature-specific tests pass
- Load/save round-trip works correctly
- Diagrams display with correct positions and colors
- Validation catches invalid references

## Execution Order

Recommended implementation sequence:

1. **Type Definitions (Task Group 1)** - Foundation for all other changes
2. **Configuration (Task Group 2)** - Entity mappings needed by rendering
3. **Load Operations (Task Group 3)** - Parse nested JSON structure
4. **Save Operations (Task Group 4)** - Serialize nested structure
5. **Validation (Task Group 5)** - Validate nested data
6. **Rendering (Task Group 6)** - Display diagrams from nested structure
7. **Context (Task Group 7)** - State management updates
8. **Sample Data (Task Group 8)** - Update test data
9. **Integration Testing (Task Group 9)** - Verify end-to-end

## Files Modified

| File | Task Groups | Primary Changes |
|------|-------------|-----------------|
| `frontend/src/types/model.ts` | 1 | Interface updates, ENTITY_TYPES constant |
| `frontend/src/config/defaults.ts` | 2 | entityColors mapping, emptyModel |
| `frontend/src/utils/fileOperations.ts` | 3, 4 | buildModelFromData, serializeModel |
| `frontend/src/utils/validation.ts` | 5 | validateJsonStructure, validateModel |
| `frontend/src/utils/rendering.ts` | 6 | All rendering utility functions |
| `frontend/src/contexts/ArchitectureContext.tsx` | 7 | State structure |
| `frontend/public/sample-architecture.json` | 8 | Complete restructure |

## Risk Areas

1. **Type Changes Cascade** - Changes to model.ts affect many files
2. **Validation Logic** - Must handle both nested structure access and SCREAMING_SNAKE_CASE
3. **Rendering Functions** - Multiple functions need diagram object parameter changes

## Notes

- This is a structural refactor - no new features, just data restructuring
- All changes maintain backward compatibility with existing metaModel structure
- UI components (Canvas.tsx) may need minor updates to use rendering utility changes
- Test sample JSON thoroughly before marking complete
