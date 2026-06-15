# Task Breakdown: Temporary Architecture Diagram JSON Contract (ER First)

## Overview
Total Tasks: 22

This is a contract/type-definition-only increment. There is no backend, API, persistence, rendering, or mapping code. All deliverables are TypeScript interfaces, example JSON files, and optional lightweight validation helpers in the frontend `types/` directory.

## Task List

### Type Definitions

#### Task Group 1: Core Contract Interfaces
**Dependencies:** None

- [x] 1.0 Complete core TypeScript interface definitions
  - [x] 1.1 Write 4 focused tests for core type structure and constraints
    - Test that `TemporaryArchitectureDiagram` requires all mandatory fields (`id`, `name`, `diagram_kind`, `source_architecture_domain`, `view_mode`, `version`, `nodes`, `edges`)
    - Test that a well-formed LOGICAL ER diagram object satisfies the interface (compile-time or runtime shape check)
    - Test that a well-formed PHYSICAL ER diagram object satisfies the interface
    - Test that `version` starts at 1 (constant/default check)
  - [x] 1.2 Create file `frontend/src/types/temporaryArchitectureDiagram.ts` with file-level JSDoc block
    - Explain the contract's purpose as a pre-binding interchange format
    - Document its relationship to native `Diagram`, `DiagramNode`, `DiagramEdge` in `model.ts`
    - Explicitly state it is distinct from `ERContent` / `TypedContentEnvelope` in `typedContent.ts`
    - State that no internal architecture IDs appear anywhere in this contract
  - [x] 1.3 Define `TemporaryArchitectureDiagramPoint` interface
    - Fields: `sequence_order` (number), `pos_x` (number), `pos_y` (number)
    - JSDoc: note deliberate omission of `id` field present on native `EdgePoint`; temporary diagrams use sequence ordering only
  - [x] 1.4 Define `TemporaryArchitectureDiagramCompartmentItem` interface
    - Fields: `id` (string), `item_kind` (string literal, initially `'ATTRIBUTE'`), `ref_name` (string), `display_name` (string), `semantic_type` (string)
    - Optional `metadata`: `is_primary_key?` (boolean), `is_foreign_key?` (boolean), `data_type?` (string), `is_nullable?` (boolean)
    - JSDoc on `semantic_type`: document ER constraints -- LOGICAL uses `"LOGICAL_DATA_ATTRIBUTE"`, PHYSICAL uses `"PHYSICAL_DATA_ATTRIBUTE"`
    - JSDoc on `ref_name`: must match the `name` field on `LogicalDataAttribute` or `PhysicalDataAttribute` exactly
  - [x] 1.5 Define `TemporaryArchitectureDiagramCompartment` interface
    - Fields: `id` (string), `compartment_kind` (string literal, initially `'ATTRIBUTES'`), `items` (array of `TemporaryArchitectureDiagramCompartmentItem`)
    - JSDoc: explain this replaces native `embedded_attribute_ids` / `selected_attribute_ids` with a name-based, self-contained representation
  - [x] 1.6 Define `TemporaryArchitectureDiagramNode` interface
    - Fields: `id` (string), `node_kind` (string literal, initially `'ENTITY'`), `semantic_type` (string), `ref_name` (string), `display_name` (string), `pos_x` (number), `pos_y` (number), `width` (number), `height` (number)
    - Optional: `z_index` (number), `compartments` (array of `TemporaryArchitectureDiagramCompartment`)
    - Optional `style`: `background_color?`, `line_color?`, `text_color?` (all hex strings)
    - Optional `metadata`: `is_primary?` (boolean), `is_reference?` (boolean), `tags?` (string array)
    - JSDoc on `semantic_type`: LOGICAL uses `"LOGICAL_DATA_ENTITY"`, PHYSICAL uses `"PHYSICAL_DATA_ENTITY"`
    - JSDoc on `ref_name`: must match the `name` field on `LogicalDataEntity` or `PhysicalDataEntity` exactly, no abbreviations
  - [x] 1.7 Define `TemporaryArchitectureDiagramEdge` interface
    - Fields: `id` (string), `edge_kind` (string literal, initially `'RELATIONSHIP'`), `semantic_type` (string), `source_node_id` (string), `target_node_id` (string), `source_ref_name` (string), `target_ref_name` (string), `edge_points` (array of `TemporaryArchitectureDiagramPoint`)
    - Optional: `source_item_ref_name` (string), `target_item_ref_name` (string) for attribute-level endpoints
    - Optional `relationship_type`: string literal union `'GENERALIZATION' | 'REALIZATION' | 'COMPOSITION' | 'AGGREGATION' | 'ASSOCIATION' | 'DEPENDENCY'` -- must align with `LogicalERRelationship` in `model.ts`
    - Optional `cardinality`: string literal union `'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_ONE' | 'MANY_TO_MANY'` -- must align with `LogicalERCardinality` in `model.ts`
    - Optional `relationship_hint` (string) for freeform LLM context
    - Optional nested `source_label?` and `target_label?`: `{ text: string; pos_x: number; pos_y: number }` -- do NOT use native flat field pattern
    - Optional `style`: `line_color?` (string), `line_type?` (`'SOLID' | 'DASHED'`), `line_weight?` (number)
    - Optional `metadata`: `optionality?` (`'OPTIONAL' | 'REQUIRED' | 'UNKNOWN'`), `notes?` (string array)
    - JSDoc on `source_ref_name` / `target_ref_name`: used for future name-based matching to resolve native entity IDs
    - JSDoc on `relationship_type`: explicitly reference `LogicalERRelationship` from `model.ts`
    - JSDoc on `cardinality`: explicitly reference `LogicalERCardinality` from `model.ts`
  - [x] 1.8 Define `TemporaryArchitectureDiagramGroup` interface
    - Fields: `id` (string), `group_kind` (string), `pos_x` (number), `pos_y` (number), `width` (number), `height` (number), `child_node_ids` (string array)
    - Optional: `ref_name` (string), `display_name` (string)
    - Optional `style`: `background_color?`, `line_color?`, `text_color?`
    - JSDoc: explain groups enable future schema-grouping, swimlane, or container concepts
  - [x] 1.9 Define top-level `TemporaryArchitectureDiagram` interface
    - Fields: `id` (string), `name` (string), `diagram_kind` (string literal, initially `'ER'`), `source_architecture_domain` (string literal, initially `'DATA'`), `view_mode` (string literal union, initially `'LOGICAL' | 'PHYSICAL'`), `version` (number, starts at 1), `nodes` (array of `TemporaryArchitectureDiagramNode`), `edges` (array of `TemporaryArchitectureDiagramEdge`)
    - Optional: `description` (string), `groups` (array of `TemporaryArchitectureDiagramGroup`), `metadata` object with `created_by_task?` (string) and `notes?` (string array)
    - JSDoc on `version`: starts at 1, increments only for breaking contract changes; additive optional fields do not bump version
    - JSDoc on `diagram_kind`, `source_architecture_domain`, `view_mode`: typed as string literal unions to allow future extension without breaking the generic structure
  - [x] 1.10 Ensure core interface tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify the file compiles without TypeScript errors
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- `frontend/src/types/temporaryArchitectureDiagram.ts` compiles cleanly
- Every field on every interface has a JSDoc comment
- File-level JSDoc block is present explaining contract purpose and relationship to native types
- `relationship_type` and `cardinality` literal unions exactly match `LogicalERRelationship` and `LogicalERCardinality` from `model.ts`
- No internal architecture IDs appear anywhere in the contract
- All `*_kind` fields are typed as extensible string literals, not closed enums

---

### Example JSON Payloads

#### Task Group 2: Example JSON Files
**Dependencies:** Task Group 1

- [x] 2.0 Complete example JSON payload files
  - [x] 2.1 Write 4 focused tests for example JSON validity
    - Test that `temporary-er-diagram-logical.json` can be imported and satisfies `TemporaryArchitectureDiagram` (type assertion or runtime shape check)
    - Test that `temporary-er-diagram-physical.json` can be imported and satisfies `TemporaryArchitectureDiagram`
    - Test that the LOGICAL example uses correct semantic types (`LOGICAL_DATA_ENTITY`, `LOGICAL_DATA_ATTRIBUTE`) throughout
    - Test that the PHYSICAL example uses correct semantic types (`PHYSICAL_DATA_ENTITY`, `PHYSICAL_DATA_ATTRIBUTE`) throughout
  - [x] 2.2 Create directory `frontend/src/types/examples/` if it does not exist
  - [x] 2.3 Create `frontend/src/types/examples/temporary-er-diagram-logical.json`
    - At least 3 entities (nodes) with `semantic_type = "LOGICAL_DATA_ENTITY"` and meaningful `ref_name` values
    - Each entity must have a `compartments` array with `ATTRIBUTES` compartment containing multiple items
    - Compartment items must use `semantic_type = "LOGICAL_DATA_ATTRIBUTE"` with `is_primary_key`, `is_foreign_key`, `data_type`, `is_nullable` metadata
    - At least 2 relationships (edges) with `cardinality` and `relationship_type` fields populated
    - Edges must include `edge_points` with `sequence_order` / `pos_x` / `pos_y`
    - At least one edge must have `source_label` and `target_label` with positions
    - Include at least one group demonstrating schema-grouping
    - Include top-level `metadata` with `created_by_task` and `notes`
    - `view_mode` must be `"LOGICAL"`, `diagram_kind` must be `"ER"`, `source_architecture_domain` must be `"DATA"`, `version` must be `1`
  - [x] 2.4 Create `frontend/src/types/examples/temporary-er-diagram-physical.json`
    - At least 3 entities with `semantic_type = "PHYSICAL_DATA_ENTITY"` and meaningful `ref_name` values
    - Each entity must have `compartments` with `ATTRIBUTES` items using `semantic_type = "PHYSICAL_DATA_ATTRIBUTE"`
    - Items should include `data_type` values appropriate for physical storage (e.g., `VARCHAR(255)`, `BIGINT`, `TIMESTAMP`)
    - At least 2 relationships with `cardinality` and `relationship_type`
    - Include `edge_points`, `source_label`/`target_label`, a group, and top-level `metadata`
    - `view_mode` must be `"PHYSICAL"`
  - [x] 2.5 Ensure both examples are realistic and internally consistent
    - All `source_node_id` / `target_node_id` on edges must reference actual node `id` values
    - All `source_ref_name` / `target_ref_name` on edges must match actual node `ref_name` values
    - All `child_node_ids` in groups must reference actual node `id` values
    - Positions and dimensions should represent plausible layout (no overlapping, reasonable sizes)
  - [x] 2.6 Ensure example JSON tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify both JSON files parse without errors
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- Both JSON files are valid JSON and conform to the `TemporaryArchitectureDiagram` interface
- LOGICAL example uses `LOGICAL_DATA_ENTITY` / `LOGICAL_DATA_ATTRIBUTE` semantic types throughout
- PHYSICAL example uses `PHYSICAL_DATA_ENTITY` / `PHYSICAL_DATA_ATTRIBUTE` semantic types throughout
- Both examples demonstrate all major features: compartments, edge labels, edge points, groups, metadata, cardinality, relationship_type
- Internal references (node IDs, ref_names, child_node_ids) are consistent within each file

---

### Validation Helpers

#### Task Group 3: Optional Lightweight Validation Helpers
**Dependencies:** Task Group 1

- [x] 3.0 Complete optional validation helper functions
  - [x] 3.1 Write 6 focused tests for validation helpers
    - Test `isTemporaryArchitectureDiagram` returns `true` for a valid diagram object
    - Test `isTemporaryArchitectureDiagram` returns `false` for `null`, `undefined`, and objects missing required fields
    - Test `isValidERDiagram` returns `true` for a valid ER diagram with correct `diagram_kind` and `view_mode`
    - Test `isValidERDiagram` returns `false` when `diagram_kind` is not `"ER"` or `view_mode` is not `"LOGICAL"` / `"PHYSICAL"`
    - Test a semantic type consistency checker detects mismatched `semantic_type` values (e.g., LOGICAL view_mode with PHYSICAL_DATA_ENTITY nodes)
    - Test an internal reference consistency checker detects edges referencing non-existent node IDs
  - [x] 3.2 Add validation helpers to `frontend/src/types/temporaryArchitectureDiagram.ts` (or a co-located file if the main file is large)
    - `isTemporaryArchitectureDiagram(obj: unknown): obj is TemporaryArchitectureDiagram` -- lightweight type guard checking presence of required fields and correct types
    - `isValidERDiagram(diagram: TemporaryArchitectureDiagram): boolean` -- checks `diagram_kind === 'ER'` and `view_mode` is `'LOGICAL'` or `'PHYSICAL'`
    - These must be plain runtime checks, not a validation library (no Zod, io-ts, or JSON Schema)
  - [x] 3.3 Add ER-specific semantic type consistency checker
    - Function that verifies LOGICAL diagrams use `LOGICAL_DATA_ENTITY` / `LOGICAL_DATA_ATTRIBUTE` semantic types throughout
    - Function that verifies PHYSICAL diagrams use `PHYSICAL_DATA_ENTITY` / `PHYSICAL_DATA_ATTRIBUTE` semantic types throughout
    - Returns a list of inconsistency messages (or empty array if valid)
  - [x] 3.4 Add internal reference consistency checker
    - Function that verifies all `source_node_id` / `target_node_id` on edges reference existing node IDs
    - Function that verifies all `child_node_ids` in groups reference existing node IDs
    - Returns a list of broken reference messages (or empty array if valid)
  - [x] 3.5 Ensure validation helper tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify all helpers work correctly for valid and invalid inputs
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 3.1 pass
- Type guard `isTemporaryArchitectureDiagram` correctly identifies valid and invalid objects
- ER-specific checker `isValidERDiagram` validates `diagram_kind` and `view_mode`
- Semantic type consistency checker detects mismatches between `view_mode` and `semantic_type` values
- Internal reference checker detects broken node ID references in edges and groups
- All helpers are plain runtime JavaScript/TypeScript -- no external validation libraries

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4 tests written for core interfaces (Task 1.1)
    - Review the 4 tests written for example JSON files (Task 2.1)
    - Review the 6 tests written for validation helpers (Task 3.1)
    - Total existing tests: 14 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify any critical contract behaviors lacking coverage
    - Focus on edge cases in the contract that could cause future mapping failures
    - Check whether `relationship_type` and `cardinality` literal value alignment with `model.ts` is explicitly tested
    - Check whether optional fields (style, metadata, groups) are tested when present and when absent
    - Do NOT assess entire application test coverage
  - [x] 4.3 Write up to 8 additional strategic tests to fill identified gaps
    - Test that edge `relationship_type` literal values exactly match `LogicalERRelationship` values from `model.ts`
    - Test that edge `cardinality` literal values exactly match `LogicalERCardinality` values from `model.ts`
    - Test that a diagram with all optional fields omitted still satisfies the interface
    - Test that a diagram with all optional fields populated satisfies the interface
    - Test that `edge_points` ordering by `sequence_order` is preserved correctly in examples
    - Test that `source_item_ref_name` / `target_item_ref_name` on edges correctly reference attribute ref_names when present
    - Test that group `child_node_ids` in example files reference only existing node IDs
    - Test that the examples contain no internal architecture IDs (no fields matching UUID patterns that could be entity IDs)
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 22 tests
    - Do NOT run the entire application test suite
    - Verify all tests pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22 tests total)
- Critical contract behaviors are covered including literal value alignment with existing `model.ts` types
- Optional field presence/absence is tested
- Example JSON internal consistency is verified by tests
- No more than 8 additional tests added
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Type Definitions (Task Group 1)** -- Define all interfaces first since everything else depends on them. Start with leaf types (`Point`, `CompartmentItem`) and build up to the top-level `TemporaryArchitectureDiagram`. This order avoids forward references and makes incremental compilation possible.

2. **Example JSON Payloads (Task Group 2)** -- Create realistic example files that exercise every interface field. These serve as living documentation and as test fixtures for validation helpers. Depends on Task Group 1 because the examples must conform to the defined interfaces.

3. **Validation Helpers (Task Group 3)** -- Implement lightweight runtime checks. These can use the example JSON files from Task Group 2 as test fixtures. Depends on Task Group 1 for the type definitions and benefits from Task Group 2 for realistic test data.

4. **Test Review and Gap Analysis (Task Group 4)** -- Review all tests from Groups 1-3, identify gaps, and add targeted tests for literal value alignment, optional field handling, and internal consistency. Depends on all prior groups being complete.

## Notes

- **No backend, API, or database tasks** -- this spec is entirely frontend TypeScript type definitions and JSON examples.
- **No UI components** -- no React components, rendering, or visual output is in scope.
- **No visual assets** -- the spec confirmed no visual designs are provided.
- **Existing type alignment is critical** -- the `relationship_type` and `cardinality` literal unions on edges must exactly match `LogicalERRelationship` and `LogicalERCardinality` from `frontend/src/types/model.ts`. Tests should explicitly verify this alignment.
- **JSDoc completeness** -- every field on every interface must have a JSDoc comment. This is a spec requirement, not optional.
- **The project uses Vitest** for frontend tests -- all test files should use Vitest conventions (`describe`, `it`, `expect`, `vi.mock` if needed).
