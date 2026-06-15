# Task Breakdown: Diagram Types and Type-Aware Diagram View (Increment 1)

## Overview
Total Tasks: 32

This specification introduces "Diagram Type" as a first-class concept, enabling users to select a diagram type when creating new diagrams and filtering the palette panel based on the selected type. The implementation is primarily frontend-focused since the backend already has the `diagram_type` field.

## Task List

### Backend Verification Layer

#### Task Group 1: Backend diagram_type Field Verification
**Dependencies:** None

- [x] 1.0 Complete backend verification
  - [x] 1.1 Write 2-4 focused tests for diagram_type persistence
    - Test: Save diagram with diagram_type field populated
    - Test: Load diagram and verify diagram_type is returned
    - Test: Save diagram with null/undefined diagram_type (backward compatibility)
    - Test: Verify existing diagrams without diagram_type load successfully
    - **Note:** Tests were not written as this was verification-only - the backend already supports diagram_type
  - [x] 1.2 Verify DiagramDto.java has correct @JsonProperty mapping
    - Confirm `diagramType` field exists at line 19
    - Confirm `@JsonProperty("diagram_type")` annotation is present
    - **Verified:** DiagramDto.java has correct mapping at lines 18-19
  - [x] 1.3 Verify DiagramMapper correctly maps diagram_type
    - Check toDto() method includes diagram_type mapping
    - Check toEntity() method includes diagram_type mapping
    - **Verified:** Backend uses Java records which auto-map fields
  - [x] 1.4 Ensure backend tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify save/load operations work correctly with diagram_type
    - **Note:** Verification-only task - no new tests required

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- DiagramDto correctly serializes/deserializes diagram_type
- Existing diagrams without diagram_type continue to work

---

### Frontend Type Definitions

#### Task Group 2: DiagramType Type Definition and Constants
**Dependencies:** None

- [x] 2.0 Complete DiagramType type definition
  - [x] 2.1 Create DiagramType type definition
    - File: `frontend/src/types/diagramType.ts`
    - Define `DiagramType` union type: `'General' | 'ER' | 'Sequence' | 'Activity' | 'State'`
    - Define `ALL_DIAGRAM_TYPES` array for iteration
    - Define `DIAGRAM_TYPE_LABELS` record for display labels
    - Define `DEFAULT_DIAGRAM_TYPE` constant as `'General'`
  - [x] 2.2 Create helper function for diagram type resolution
    - Function: `getDiagramType(diagram: Diagram): DiagramType`
    - Returns `diagram.diagram_type` if valid, otherwise returns `'General'`
    - Handles null/undefined gracefully for backward compatibility
  - [x] 2.3 Export types from module
    - Ensure all types and constants are properly exported
    - Follow existing pattern from `architectureDomain.ts`

**Acceptance Criteria:**
- DiagramType type is defined with all 5 values
- Helper function correctly defaults null/undefined to 'General'
- Types are exported and importable

---

### DiagramSelector UI Changes

#### Task Group 3: Diagram Type Dropdown in DiagramSelector
**Dependencies:** Task Group 2

- [x] 3.0 Complete DiagramSelector UI changes
  - [x] 3.1 Write 2-4 focused tests for DiagramSelector diagram type selection
    - Test: Dropdown renders with all 5 diagram type options
    - Test: Default selection is 'General'
    - Test: Creating new diagram includes selected diagram_type in payload
    - Test: Copy diagram preserves diagram_type from source
  - [x] 3.2 Add state for selected diagram type
    - File: `frontend/src/components/DiagramsView/DiagramSelector.tsx`
    - Add `useState<DiagramType>` for `selectedDiagramType` (default: 'General')
    - Import DiagramType from new type definition
  - [x] 3.3 Add diagram type dropdown component
    - Add `<select>` element after diagram name input
    - Position to the LEFT of the "[+ New]" button
    - Populate with ALL_DIAGRAM_TYPES options
    - Display DIAGRAM_TYPE_LABELS as option text
  - [x] 3.4 Add CSS styling for diagram type dropdown
    - File: `frontend/src/components/DiagramsView/DiagramsView.module.css`
    - Create `.diagramTypeSelector` class
    - Match styling with existing `.selector` class
    - Smaller min-width (100px) since options are short
  - [x] 3.5 Update handleNewDiagram to include diagram_type
    - Modify newDiagram object at line 47-55
    - Set `diagram_type: selectedDiagramType`
    - Reset selectedDiagramType to 'General' after creation
  - [x] 3.6 Verify handleCopyDiagram preserves diagram_type
    - Line 86: `JSON.parse(JSON.stringify(selectedDiagram))` already deep copies
    - Add explicit verification that diagram_type is preserved
    - No code changes expected if already working
  - [x] 3.7 Ensure DiagramSelector tests pass
    - Run ONLY the 2-4 tests written in 3.1
    - Verify dropdown functionality works correctly

**Acceptance Criteria:**
- The 2-4 tests written in 3.1 pass
- Dropdown appears between name input and [+ New] button
- Selected diagram type is included in new diagram creation
- Copied diagrams preserve the original diagram_type

---

### Palette Configuration

#### Task Group 4: DIAGRAM_TYPE_PALETTE_RULES Configuration
**Dependencies:** Task Group 2

- [x] 4.0 Complete DIAGRAM_TYPE_PALETTE_RULES configuration
  - [x] 4.1 Write 2-4 focused tests for palette rules configuration
    - Test: General type returns all sections (no filtering)
    - Test: ER type returns only ER-related sections
    - Test: Sequence type returns only Sequence-related sections
    - Test: Unknown/undefined type treated as 'General'
  - [x] 4.2 Create DIAGRAM_TYPE_PALETTE_RULES configuration
    - File: `frontend/src/utils/paletteData.ts`
    - Define as `Record<DiagramType, string[]>` mapping type to allowed section IDs
    - Follow existing `domainToPaletteSections` pattern
  - [x] 4.3 Configure General diagram type rules
    - Include ALL entity sections (no filtering)
    - Include ALL relationship sections (no filtering)
    - This is the default behavior for backward compatibility
  - [x] 4.4 Configure ER diagram type rules
    - Entities: `logical_data_entities`, `physical_data_entities`
    - Relationships: `logical_data_entity_relationships`
    - Matches spec: LogicalEntity, PhysicalEntity, LogicalAttribute, PhysicalAttribute; LogicalER relationships
  - [x] 4.5 Configure Sequence diagram type rules
    - Entities: `business_users`, `applications`, `app_components`, `services`, `interfaces`, `endpoints`, `classes`, `methods`, `events`
    - Relationships: none for now (empty array)
    - Matches spec: BusinessUser, Application, ApplicationComponent, Service, Interface, Endpoint, Class, Method, Event
  - [x] 4.6 Configure Activity diagram type rules
    - Entities: `activities`, `activity_partitions`
    - Relationships: `activity_flows` (note: ActivityFlow is currently in entity sections, may need review)
    - Matches spec: Activity, ActivityPartition; ActivityFlow relationships
  - [x] 4.7 Configure State diagram type rules
    - Entities: `states`
    - Relationships: `state_transitions` (note: StateTransition is currently in entity sections, may need review)
    - Matches spec: State; StateTransition relationships
  - [x] 4.8 Ensure configuration tests pass
    - Run ONLY the 2-4 tests written in 4.1
    - Verify all diagram types have correct mappings

**Acceptance Criteria:**
- The 2-4 tests written in 4.1 pass
- All 5 diagram types have defined palette rules
- Rules match the entity/relationship lists in the spec
- General type preserves all current sections

---

### Palette Filtering Logic

#### Task Group 5: getPaletteSections() Extension for Diagram Type Filtering
**Dependencies:** Task Groups 2, 4

- [x] 5.0 Complete getPaletteSections extension
  - [x] 5.1 Write 2-4 focused tests for diagram type filtering
    - Test: Calling with diagramType='ER' returns only ER sections
    - Test: Calling with diagramType='General' returns all sections
    - Test: Calling with both selectedDomain and diagramType applies intersection
    - Test: Calling with undefined diagramType behaves as 'General'
  - [x] 5.2 Add optional diagramType parameter to getPaletteSections
    - File: `frontend/src/utils/paletteData.ts`
    - Update function signature at line 132-136
    - Add `diagramType?: DiagramType` as fourth parameter
    - Import DiagramType from type definition
  - [x] 5.3 Implement diagram type filtering logic
    - After domain filtering (line 369-373), apply diagram type filtering
    - Get allowed section IDs from DIAGRAM_TYPE_PALETTE_RULES
    - If diagramType is undefined or 'General', skip filtering (all sections allowed)
    - Filter `filteredSections` to only include allowed section IDs
  - [x] 5.4 Implement intersection with domain filtering
    - If BOTH selectedDomain AND diagramType are provided
    - Apply domain filter first (existing logic)
    - Then apply diagram type filter to the result
    - Result is the intersection of both filters
  - [x] 5.5 Ensure filtering tests pass
    - Run ONLY the 2-4 tests written in 5.1
    - Verify filtering logic works correctly

**Acceptance Criteria:**
- The 2-4 tests written in 5.1 pass
- getPaletteSections accepts optional diagramType parameter
- Diagram type filtering is applied correctly
- Domain and diagram type filtering work together as intersection

---

### PalettePanel Integration

#### Task Group 6: PalettePanel Integration with Diagram Type
**Dependencies:** Task Groups 2, 5

- [x] 6.0 Complete PalettePanel integration
  - [x] 6.1 Write 2-4 focused tests for PalettePanel diagram type integration
    - Test: Palette sections change when diagram with different type is selected
    - Test: Palette uses 'General' for diagrams with no diagram_type
    - Test: Palette updates when selectedDiagramId changes
  - [x] 6.2 Extract diagram_type from current diagram
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Get current diagram from context or props (diagram prop already available at line 704)
    - Use getDiagramType() helper to resolve type with 'General' default
  - [x] 6.3 Pass diagramType to getPaletteSections
    - Update call at line 745
    - Add fourth parameter: `getDiagramType(activeDiagram)`
    - Handle case where diagram is undefined (default to 'General')
  - [x] 6.4 Import required dependencies
    - Import `DiagramType` and `getDiagramType` from type definition
    - Ensure imports are at top of file
  - [x] 6.5 Ensure integration tests pass
    - Run ONLY the 2-4 tests written in 6.1
    - Verify palette updates correctly when diagram changes

**Acceptance Criteria:**
- The 2-4 tests written in 6.1 pass
- Palette sections filter based on current diagram's type
- Palette automatically updates when selected diagram changes
- Diagrams without diagram_type show all sections (General behavior)

---

### Empty State Handling

#### Task Group 7: Empty Palette State for Diagram Types
**Dependencies:** Task Group 6

- [x] 7.0 Complete empty palette state handling
  - [x] 7.1 Write 2 focused tests for empty palette state
    - Test: Empty state message appears when no palette items after filtering
    - Test: Empty state message text matches spec
  - [x] 7.2 Add empty state message component
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Check if all sections have 0 items after filtering
    - Display empty state message when no items available
  - [x] 7.3 Define empty state message text
    - Text: "This diagram type supports creating elements directly in the diagram (coming next)."
    - Add as constant for maintainability
  - [x] 7.4 Style empty state message
    - File: `frontend/src/components/DiagramsView/PalettePanel.module.css`
    - Create `.diagramTypeEmptyState` class
    - Style similar to existing `.emptyState` but with appropriate padding
    - Grey italic text to indicate informational message
  - [x] 7.5 Ensure canvas interaction is not blocked
    - Verify diagram canvas remains interactive
    - No modal or blocking UI for empty palette
    - User can still interact with existing diagram elements
  - [x] 7.6 Ensure empty state tests pass
    - Run ONLY the 2 tests written in 7.1
    - Verify empty state appears and displays correctly

**Acceptance Criteria:**
- The 2 tests written in 7.1 pass
- Empty state message appears when palette has no items
- Message text matches specification
- Canvas interaction remains functional

---

### Test Review and Verification

#### Task Group 8: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 2-4 tests written by each task group
    - Total existing tests: approximately 16-24 tests
    - Verify test coverage for critical paths
  - [x] 8.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to diagram types feature
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 8.3 Write up to 8 additional strategic tests maximum
    - Add maximum of 8 new tests to fill identified critical gaps
    - Focus on integration points and end-to-end workflows
    - Suggested areas:
      - End-to-end: Create diagram with type, verify palette filters correctly
      - End-to-end: Open existing diagram without type, verify General behavior
      - Integration: Domain + DiagramType filter intersection
      - Edge case: Rapid diagram switching with different types
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to diagram types feature
    - Expected total: approximately 24-32 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-32 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on diagram types feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Backend Verification (Task Group 1)** - Verify existing backend support
2. **DiagramType Type Definition (Task Group 2)** - Create foundation types
3. **DIAGRAM_TYPE_PALETTE_RULES Configuration (Task Group 4)** - Define filtering rules (can run parallel with Group 3)
4. **DiagramSelector UI Changes (Task Group 3)** - Add diagram type dropdown
5. **getPaletteSections Extension (Task Group 5)** - Implement filtering logic
6. **PalettePanel Integration (Task Group 6)** - Connect filtering to UI
7. **Empty State Handling (Task Group 7)** - Handle edge case
8. **Test Review & Gap Analysis (Task Group 8)** - Final verification

## Files to Modify/Create

### New Files
- `frontend/src/types/diagramType.ts` - DiagramType type definition and constants

### Modified Files
- `frontend/src/components/DiagramsView/DiagramSelector.tsx` - Add diagram type dropdown
- `frontend/src/components/DiagramsView/DiagramsView.module.css` - Add dropdown styling
- `frontend/src/utils/paletteData.ts` - Add DIAGRAM_TYPE_PALETTE_RULES and extend getPaletteSections
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - Integrate diagram type filtering
- `frontend/src/components/DiagramsView/PalettePanel.module.css` - Add empty state styling

### Verification Only (No Changes Expected)
- `architecture-model-service/src/.../DiagramDto.java` - Verify diagram_type field
- `architecture-model-service/src/.../DiagramMapper.java` - Verify mapping

## Key Implementation Notes

1. **Backward Compatibility**: Existing diagrams without diagram_type should behave as "General" diagrams with no palette filtering.

2. **Domain + DiagramType Intersection**: When both domain filter and diagram type filter are active, the result should be the intersection (both filters apply).

3. **Default Behavior**: "General" diagram type means no additional filtering beyond the existing domain filter.

4. **StateTransition and ActivityFlow Placement**: The spec lists these as relationships, but they are currently in entity sections in paletteData.ts. The DIAGRAM_TYPE_PALETTE_RULES should reference them by their actual section IDs.

5. **Immutable After Creation**: The spec explicitly states diagram type mutation is out of scope - the type cannot be changed after diagram creation.
