# Task Breakdown: Time-Based Architecture Views

## Overview
Total Tasks: 7 Task Groups
Feature: Quarter-based temporal navigation with validity periods on entities/relationships

## Task List

### Type Definitions and Data Model

#### Task Group 1: TypeScript Interfaces and Type Definitions
**Dependencies:** None

- [x] 1.0 Complete TypeScript type definitions for temporal fields
  - [x] 1.1 Write 2-8 focused tests for quarter format validation and type checking
    - Test valid quarter string format ("YYYY-Qn")
    - Test null/undefined handling for optional fields
    - Test type validation for new interfaces
  - [x] 1.2 Update entity type interfaces in `types/model.ts`
    - Add `valid_from?: string` to: BusinessProcess, Application, AppComponent, Service, ApplicationPoint, LogicalDataEntity, PhysicalDataEntity
    - Add `valid_to?: string` to same entity types
    - Document format: "YYYY-Qn" (e.g., "2026-Q2")
  - [x] 1.3 Update relationship type interfaces in `types/model.ts`
    - Add `valid_from?: string` to DataMovement (minimum requirement)
    - Optionally add to all relationship types for consistency
    - Add `valid_to?: string` to same relationship types
  - [x] 1.4 Update Diagram interface in `types/model.ts`
    - Add `view_quarter?: string` field
    - Document: stores canonical time state, format "YYYY-Qn"
    - Document: defaults to current quarter or "2026-Q4" if missing
  - [x] 1.5 Ensure type definition tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Verify interfaces compile without errors

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- All entity interfaces include `valid_from` and `valid_to` optional fields
- At minimum DataMovement relationship includes validity fields
- Diagram interface includes `view_quarter` optional field
- TypeScript compilation succeeds with no type errors

### Utility Functions Layer

#### Task Group 2: Quarter Comparison and Visibility Utilities
**Dependencies:** Task Group 1

- [x] 2.0 Complete quarter utility functions
  - [x] 2.1 Write 2-8 focused tests for quarter utilities
    - Test compareQuarters() with various quarter pairs
    - Test isEntityVisibleInPeriod() with null and defined validity
    - Test isRelationshipVisibleInPeriod() edge cases
  - [x] 2.2 Create `compareQuarters(q1: string, q2: string): number` utility
    - Parse "YYYY-Qn" format into {year, quarter}
    - Return -1 if q1 < q2, 0 if equal, 1 if q1 > q2
    - Handle null/undefined gracefully (return consistent ordering)
    - Location: Create new file `utils/quarterUtils.ts`
  - [x] 2.3 Create `isEntityVisibleInPeriod(entity: Entity, viewQuarter: string): boolean`
    - Implement visibility rule: `(valid_from is null OR valid_from <= V) AND (valid_to is null OR valid_to > V)`
    - Use compareQuarters() for chronological comparison
    - Null validity fields mean "always visible" (return true)
    - Handle Entity union type (all 7 entity types)
  - [x] 2.4 Create `isRelationshipVisibleInPeriod(relationship: Relationship, viewQuarter: string): boolean`
    - Apply same visibility rule as entities
    - Use compareQuarters() for chronological comparison
    - Handle Relationship union type
  - [x] 2.5 Create quarter navigation helper functions
    - `addQuarters(quarter: string, delta: number): string` - add/subtract quarters
    - `quarterToHalf(quarter: string): string` - convert to nearest half (Q1/Q2->H1, Q3/Q4->H2)
    - `quarterToYear(quarter: string): string` - convert to year end (always Q4)
  - [x] 2.6 Ensure utility function tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Verify quarter parsing and comparison work correctly
    - Verify visibility logic handles null values properly

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- compareQuarters() correctly orders quarters chronologically
- Visibility functions return true for timeless objects (null validity)
- Visibility functions correctly implement inclusive start, exclusive end semantics
- Navigation helpers correctly calculate quarter arithmetic

### State Management Layer

#### Task Group 3: Reducer Actions and State Updates
**Dependencies:** Task Group 1, Task Group 2

- [x] 3.0 Complete state management for view_quarter
  - [x] 3.1 Write 2-8 focused tests for reducer actions
    - Test UPDATE_DIAGRAM_VIEW_QUARTER action updates correct diagram
    - Test view_quarter defaults on diagram creation
    - Test state immutability
  - [x] 3.2 Add UPDATE_DIAGRAM_VIEW_QUARTER action type
    - Add to ArchitectureAction union in `contexts/ArchitectureContext.tsx`
    - Payload: `{ diagramId: string, view_quarter: string }`
  - [x] 3.3 Implement reducer case for UPDATE_DIAGRAM_VIEW_QUARTER
    - Follow pattern from UPDATE_DIAGRAM_NODE
    - Immutably update view_quarter on correct diagram
    - Preserve all other diagram properties
  - [x] 3.4 Add default view_quarter on diagram creation
    - Update CREATE_DIAGRAM action handler
    - Set default to current quarter or "2026-Q4"
    - Create helper function `getDefaultViewQuarter(): string`
  - [x] 3.5 Update diagram load logic to handle missing view_quarter
    - In JSON load path, check if view_quarter is undefined
    - Apply default value if missing
    - Ensure backwards compatibility with existing JSON files
  - [x] 3.6 Ensure state management tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Verify action updates correct diagram
    - Verify immutability is preserved

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- UPDATE_DIAGRAM_VIEW_QUARTER action correctly updates diagram state
- New diagrams have sensible default view_quarter
- Loading diagrams without view_quarter applies default
- State updates are immutable

### Time Navigation UI Components

#### Task Group 4: Period Controls and Navigation Buttons
**Dependencies:** Task Group 1, Task Group 2, Task Group 3

- [x] 4.0 Complete time navigation UI components
  - [x] 4.1 Write 2-8 focused tests for UI components
    - Test PeriodSelector dropdown renders options
    - Test navigation button clicks dispatch actions
    - Test period label formatting for Quarter/Half/Year
  - [x] 4.2 Create PeriodSelector component
    - Dropdown with options: "Quarter", "Half", "Year"
    - Local state for selected period type (NOT persisted)
    - Reuse styling patterns from DiagramSelector
    - Location: Create new file `components/PeriodSelector.tsx`
  - [x] 4.3 Create TimeNavigationControls component
    - Layout: `[Period Dropdown] [<] [Period Label] [>]`
    - Accept props: currentQuarter, onNavigate(newQuarter)
    - [<] button calls onNavigate with previous period
    - [>] button calls onNavigate with next period
    - Use addQuarters() utility for navigation logic
    - Location: Create new file `components/TimeNavigationControls.tsx`
  - [x] 4.4 Implement period label formatting logic
    - Quarter mode: "End of Q[n] [YYYY]" (e.g., "End of Q1 2027")
    - Half mode: "End of H[1/2] [YYYY]" (e.g., "End of H2 2026")
    - Year mode: "End of [YYYY]" (e.g., "End of 2026")
    - Create helper function `formatPeriodLabel(quarter: string, periodType: string): string`
  - [x] 4.5 Implement period navigation delta calculation
    - Quarter mode: delta = 1 quarter
    - Half mode: delta = 2 quarters
    - Year mode: delta = 4 quarters
    - Use addQuarters() utility with appropriate delta
  - [x] 4.6 Apply styling consistent with existing header bar
    - Follow Button.tsx patterns for [<] and [>] buttons
    - Match dropdown styling from DiagramSelector
    - Use flexbox layout similar to zoom controls
    - Period label styling similar to `.zoomLevel` span
  - [x] 4.7 Ensure UI component tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Verify dropdown renders and changes state
    - Verify buttons trigger navigation callbacks

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- Period dropdown renders three options and tracks selection
- Navigation buttons correctly calculate next/previous periods
- Period label formats correctly for all three modes
- Styling matches existing DiagramsView header patterns

### Canvas Time Filtering

#### Task Group 5: Time-Based Rendering in Canvas
**Dependencies:** Task Group 2, Task Group 3

- [x] 5.0 Complete time-based filtering in canvas rendering
  - [x] 5.1 Write 2-8 focused tests for canvas filtering
    - Test node visibility based on entity validity
    - Test edge visibility requires both relationship and endpoints valid
    - Test timeless objects always render
  - [x] 5.2 Add filtering logic to Canvas component
    - Read diagram.view_quarter from props/state
    - Filter diagram_nodes before rendering
    - For each node: lookup entity, call isEntityVisibleInPeriod()
    - Only render nodes that pass visibility check
    - Location: Update `components/Canvas.tsx`
  - [x] 5.3 Add edge filtering logic with endpoint checking
    - Filter diagram_edges before rendering
    - For each edge: check relationship validity with isRelationshipVisibleInPeriod()
    - Additionally check both source and target nodes are visible
    - Only render edges where relationship AND both endpoints are visible
  - [x] 5.4 Update rendering.ts helper functions
    - Update `getNodesInRenderOrder()` to accept viewQuarter parameter
    - Update `getEdgesForDiagram()` to accept viewQuarter parameter
    - Apply filtering inside these helpers using visibility utilities
    - Return only visible nodes/edges
    - Location: Update `utils/rendering.ts`
  - [x] 5.5 Add view_quarter to Canvas useEffect dependencies
    - Ensure canvas re-renders when view_quarter changes
    - Include diagram.view_quarter in dependency array
    - Verify no unnecessary re-renders
  - [x] 5.6 Ensure canvas filtering tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Verify nodes with valid_to before view_quarter don't render
    - Verify timeless nodes always render

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Nodes filter correctly based on entity validity periods
- Edges only render if relationship valid AND both endpoints visible
- Timeless objects (null validity) always render regardless of view_quarter
- Canvas re-renders when view_quarter changes

### DiagramsView Integration

#### Task Group 6: Integrate Time Controls into DiagramsView Header
**Dependencies:** Task Group 3, Task Group 4

- [x] 6.0 Complete DiagramsView header integration
  - [x] 6.1 Write 2-8 focused tests for header integration
    - Test time controls render between selector and zoom controls
    - Test dispatch call when navigation occurs
    - Test current diagram's view_quarter is displayed
  - [x] 6.2 Import TimeNavigationControls into DiagramsView
    - Add import statement
    - Location: Update `components/DiagramsView.tsx`
  - [x] 6.3 Add time controls to header bar layout
    - Insert between diagram selector section and zoom controls
    - Layout: `Diagram: [...] | Period: [Controls] | [Zoom Controls]`
    - Use flexbox with appropriate spacing
    - Add divider/separator if needed for visual clarity
  - [x] 6.4 Wire up TimeNavigationControls props
    - Pass currentQuarter from selectedDiagram.view_quarter
    - Create onNavigate handler that dispatches UPDATE_DIAGRAM_VIEW_QUARTER
    - Use useArchitectureDispatch() hook
    - Handle case when no diagram selected
  - [x] 6.5 Update DiagramsView CSS for layout
    - Add styles for time controls section
    - Ensure consistent spacing with existing header sections
    - Match existing header bar height and alignment
    - Location: Update `components/DiagramsView.css`
  - [x] 6.6 Ensure integration tests pass
    - Run ONLY the 2-8 tests written in 6.1
    - Verify controls render in correct position
    - Verify navigation updates diagram state

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- Time controls render in header bar between selector and zoom
- Navigation buttons dispatch UPDATE_DIAGRAM_VIEW_QUARTER action
- Current diagram's view_quarter displays correctly
- Layout matches existing header bar styling

### JSON Persistence and Data Grid

#### Task Group 7: Persistence and UI for Validity Fields
**Dependencies:** Task Group 1

- [x] 7.0 Complete JSON persistence and grid display
  - [x] 7.1 Write 2-8 focused tests for persistence
    - Test JSON serialization includes new fields
    - Test JSON deserialization loads new fields
    - Test grid columns display validity fields
  - [x] 7.2 Update JSON save logic
    - Verify valid_from/valid_to serialize for all entities
    - Verify valid_from/valid_to serialize for relationships
    - Verify view_quarter serializes for diagrams
    - Location: Update JSON save function (likely in contexts/ArchitectureContext.tsx)
  - [x] 7.3 Update JSON load logic
    - Parse and load valid_from/valid_to for entities
    - Parse and load valid_from/valid_to for relationships
    - Parse and load view_quarter for diagrams
    - Apply default view_quarter if missing (from Task 3.5)
  - [x] 7.4 Add validity columns to entity grid views
    - Add "Valid From" column for valid_from (editable text)
    - Add "Valid To" column for valid_to (editable text)
    - Apply to grids for: Business Processes, Applications, App Components, Services, Application Points, Logical Data Entities, Physical Data Entities
    - Location: Update grid components (likely in various entity view files)
  - [x] 7.5 Add validity columns to relationship grid view
    - Add "Valid From" and "Valid To" columns to Data Movements grid
    - Optionally add to other relationship grids if validity applied to all
    - Make columns editable text inputs
  - [x] 7.6 Add validation for quarter format in grid inputs
    - Validate "YYYY-Qn" format on input
    - Show error message for invalid formats
    - Allow empty/null values
  - [x] 7.7 Ensure persistence tests pass
    - Run ONLY the 2-8 tests written in 7.1
    - Verify save/load round-trip preserves all new fields
    - Verify grid edits update state correctly

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass
- JSON save includes valid_from, valid_to, and view_quarter
- JSON load correctly parses new fields and applies defaults
- Entity and relationship grids display validity columns
- Grid columns are editable and update state
- Basic format validation prevents invalid quarter codes

### Integration and End-to-End Testing

#### Task Group 8: Integration Testing and Final Verification
**Dependencies:** Task Groups 1-7

- [x] 8.0 Complete integration testing and verification
  - [x] 8.1 Review existing tests from Task Groups 1-7
    - Review tests from type definitions (Task 1.1)
    - Review tests from utility functions (Task 2.1)
    - Review tests from state management (Task 3.1)
    - Review tests from UI components (Task 4.1)
    - Review tests from canvas filtering (Task 5.1)
    - Review tests from DiagramsView integration (Task 6.1)
    - Review tests from persistence (Task 7.1)
    - Total existing tests: approximately 14-56 tests
  - [x] 8.2 Analyze critical integration gaps
    - Identify end-to-end workflows lacking coverage
    - Focus on: navigation changing canvas rendering
    - Focus on: save/load preserving time state
    - Focus on: period type switching maintaining state
    - Do NOT assess entire application coverage
  - [x] 8.3 Write up to 10 additional integration tests
    - Test: Navigate forward/backward updates canvas visibility
    - Test: Entity with valid_to in past doesn't render in current view
    - Test: Edge disappears when endpoint becomes invalid
    - Test: Switching period type (Quarter->Half) updates label
    - Test: Save and reload preserves view_quarter and validity fields
    - Test: Timeless entity always visible regardless of navigation
    - Add maximum 10 tests total for critical gaps
  - [x] 8.4 Manual testing checklist
    - Create entity with validity period in past
    - Navigate to period when entity was valid - verify it appears
    - Navigate to period after valid_to - verify it disappears
    - Test edges disappear when relationships or endpoints invalid
    - Test period dropdown changes label format
    - Test navigation wraps correctly across year boundaries
    - Save diagram, reload, verify view_quarter preserved
  - [x] 8.5 Run feature-specific test suite
    - Run all tests from Tasks 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, and 8.3
    - Expected total: approximately 24-66 tests
    - Verify all critical workflows pass
    - Do NOT run entire application test suite
  - [x] 8.6 Documentation and cleanup
    - Add code comments explaining visibility rule
    - Document quarter format in appropriate files
    - Update any relevant documentation about temporal features

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-66 tests total)
- End-to-end workflows verified: navigation, filtering, persistence
- Manual testing checklist completed successfully
- No more than 10 additional integration tests added
- Code includes clear comments on visibility logic

## Execution Order

Recommended implementation sequence:

1. **Type Definitions and Data Model** (Task Group 1) - COMPLETED
   - Foundation for all other work
   - No dependencies

2. **Utility Functions Layer** (Task Group 2) - COMPLETED
   - Depends on type definitions
   - Provides core logic for filtering and navigation

3. **State Management Layer** (Task Group 3) - COMPLETED
   - Depends on types and utilities
   - Enables state updates for time navigation

4. **Time Navigation UI Components** (Task Group 4) - COMPLETED
   - Depends on types, utilities, and state management
   - Can be developed in parallel with Task Group 5

5. **Canvas Time Filtering** (Task Group 5) - COMPLETED
   - Depends on utilities and state management
   - Can be developed in parallel with Task Group 4

6. **DiagramsView Integration** (Task Group 6) - COMPLETED
   - Depends on state management and UI components
   - Connects navigation controls to canvas

7. **JSON Persistence and Data Grid** (Task Group 7) - COMPLETED
   - Depends only on type definitions
   - Can be developed in parallel with other tasks after Task Group 1

8. **Integration and End-to-End Testing** (Task Group 8) - COMPLETED
   - Depends on all previous task groups
   - Final verification and gap filling

## Notes

- **Focused Testing Approach**: Each task group writes 2-8 tests covering critical behaviors only, not exhaustive coverage
- **Test Verification**: Task groups verify ONLY their own tests, not the entire suite
- **Integration Testing**: Task Group 8 adds maximum 10 tests to fill critical gaps in end-to-end workflows
- **Parallel Development Opportunities**: Task Groups 4, 5, and 7 can be developed in parallel after their dependencies are complete
- **Quarter Format**: Consistent "YYYY-Qn" format throughout (e.g., "2026-Q2", "2027-Q4")
- **Visibility Semantics**: valid_from is inclusive, valid_to is exclusive, null means timeless
- **Period Dropdown**: UI-only state, NOT persisted to JSON (only view_quarter persists)
