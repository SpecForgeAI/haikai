# Task Breakdown: Phase 1 UI Architecture - Increment 1: UIScreen + UIWorkflowTransition

## Overview

**Total Tasks:** 10 Task Groups, ~60 sub-tasks

This increment introduces first-class UI architecture support with:
- **UIScreen** entity (routes/pages in the Application Architecture domain)
- **UIWorkflowTransition** relationship entity (navigation flows between screens)
- **UI_Workflow** diagram type for modeling user navigation flows
- **Project UI Workflow Context** export endpoint for LLM consumption

## Task List

---

### Backend Layer

#### Task Group 1: Database Schema - Liquibase Migration
**Dependencies:** None

- [x] 1.0 Complete database schema migration
  - [x] 1.1 Create migration file `010-ui-screens-ui-workflow-transitions.sql`
    - Location: `architecture-model-service/src/main/resources/db/changelog/sql/`
    - Follow pattern from `004-states-state-transitions.sql`
  - [x] 1.2 Define `ui_screens` table
    - Columns: `id` (TEXT PRIMARY KEY), `model_file_id` (TEXT NOT NULL FK), `name` (TEXT NOT NULL), `route` (TEXT NOT NULL), `description` (TEXT)
    - FK constraint: `model_file_id REFERENCES model_files(id) ON DELETE CASCADE`
  - [x] 1.3 Define `ui_workflow_transitions` table
    - Columns: `id` (TEXT PRIMARY KEY), `model_file_id` (TEXT NOT NULL FK), `name` (TEXT NOT NULL), `source_screen_id` (TEXT NOT NULL FK), `target_screen_id` (TEXT NOT NULL FK), `trigger` (TEXT), `guard` (TEXT)
    - FK constraints:
      - `model_file_id REFERENCES model_files(id) ON DELETE CASCADE`
      - `source_screen_id REFERENCES ui_screens(id)` (NO cascade - fail if referenced)
      - `target_screen_id REFERENCES ui_screens(id)` (NO cascade - fail if referenced)
  - [x] 1.4 Create indexes for query performance
    - `idx_ui_screens_model_file ON ui_screens(model_file_id)`
    - `idx_ui_workflow_transitions_model_file ON ui_workflow_transitions(model_file_id)`
    - `idx_ui_workflow_transitions_source ON ui_workflow_transitions(source_screen_id)`
    - `idx_ui_workflow_transitions_target ON ui_workflow_transitions(target_screen_id)`
  - [x] 1.5 Register migration in `db.changelog-master.yaml`
    - Add include for `sql/010-ui-screens-ui-workflow-transitions.sql`
  - [x] 1.6 Verify migration runs successfully
    - Start application and confirm tables created
    - Check indexes exist via database inspection

**Acceptance Criteria:**
- Tables `ui_screens` and `ui_workflow_transitions` created successfully
- FK constraints prevent orphaned transitions when screens are deleted
- Indexes created for performance
- Migration registered and runs on application startup

---

#### Task Group 2: Backend Entity Layer - JPA Entities, DTOs, Repositories
**Dependencies:** Task Group 1

- [x] 2.0 Complete backend entity layer
  - [x] 2.1 Write 4-6 focused unit tests for entity/DTO mapping
    - Test UIScreen entity to DTO mapping
    - Test UIWorkflowTransition entity to DTO mapping
    - Test DTO JSON serialization (verify @JsonProperty annotations)
    - Test repository findByModelFileId returns correct entities
  - [x] 2.2 Create `UIScreenEntity.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/`
    - Follow `StateEntity.java` pattern with Lombok annotations (@Entity, @Table, @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder)
    - Fields: id, modelFileId, name, route, description
  - [x] 2.3 Create `UIWorkflowTransitionEntity.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/`
    - Follow `StateTransitionEntity.java` pattern
    - Fields: id, modelFileId, name, sourceScreenId, targetScreenId, trigger, guard
  - [x] 2.4 Create `UIScreenDto.java` record
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/`
    - Follow `StateDto.java` pattern with @JsonProperty annotations
    - Use snake_case for JSON property names (id, name, route, description)
  - [x] 2.5 Create `UIWorkflowTransitionDto.java` record
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/`
    - Follow `StateTransitionDto.java` pattern
    - Fields with @JsonProperty: id, name, source_screen_id, target_screen_id, trigger, guard
  - [x] 2.6 Create `UIScreenRepository.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/`
    - Extend JpaRepository<UIScreenEntity, String>
    - Methods: findByModelFileId(String), deleteByModelFileId(String)
  - [x] 2.7 Create `UIWorkflowTransitionRepository.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/`
    - Extend JpaRepository<UIWorkflowTransitionEntity, String>
    - Methods: findByModelFileId(String), deleteByModelFileId(String), existsBySourceScreenId(String), existsByTargetScreenId(String)
  - [x] 2.8 Add mapper methods to `EntityMapper.java`
    - Add toDto(UIScreenEntity) -> UIScreenDto
    - Add toEntity(UIScreenDto, modelFileId) -> UIScreenEntity
    - Add toDto(UIWorkflowTransitionEntity) -> UIWorkflowTransitionDto
    - Add toEntity(UIWorkflowTransitionDto, modelFileId) -> UIWorkflowTransitionEntity
  - [x] 2.9 Ensure entity layer tests pass
    - Run ONLY tests from 2.1

**Acceptance Criteria:**
- Entity classes compile and map correctly to database tables
- DTOs serialize/deserialize with correct JSON property names
- Repositories provide required query methods
- Mapper converts between entities and DTOs correctly

---

#### Task Group 3: Backend Service Layer - ModelService Integration
**Dependencies:** Task Group 2

- [x] 3.0 Complete ModelService integration
  - [x] 3.1 Write 4-6 focused tests for ModelService UIScreen/UIWorkflowTransition operations
    - Test loadEntities includes ui_screens
    - Test saveEntities persists ui_screens correctly
    - Test UIWorkflowTransition save with valid source/target screen IDs
    - Test UIWorkflowTransition validation fails with invalid screen IDs
    - Test delete prevention: screen delete fails when referenced by transition
  - [x] 3.2 Inject repositories into ModelService
    - Add UIScreenRepository to constructor
    - Add UIWorkflowTransitionRepository to constructor
  - [x] 3.3 Extend MetaModelEntitiesDto to include ui_screens
    - Add `List<UIScreenDto> uiScreens` field to MetaModelEntitiesDto record
    - Update record constructor parameter order
  - [x] 3.4 Extend loadEntities() for ui_screens
    - Add uiScreenRepository.findByModelFileId() call
    - Map entities to DTOs and include in MetaModelEntitiesDto
  - [x] 3.5 Extend saveEntities() for ui_screens
    - Add uiScreenRepository.deleteByModelFileId() in truncate phase
    - Add mapping and saving logic in insert phase
  - [x] 3.6 Extend MetaModelRelationshipsDto to include ui_workflow_transitions
    - Add `List<UIWorkflowTransitionDto> uiWorkflowTransitions` field
    - Update record constructor parameter order
  - [x] 3.7 Extend loadRelationships() for ui_workflow_transitions
    - Add uiWorkflowTransitionRepository.findByModelFileId() call
    - Map entities to DTOs and include in MetaModelRelationshipsDto
  - [x] 3.8 Extend saveRelationships() for ui_workflow_transitions
    - Add uiWorkflowTransitionRepository.deleteByModelFileId() in truncate phase
    - Add mapping and saving logic in insert phase
  - [x] 3.9 Add validation for UIWorkflowTransition source/target references
    - Before saving, validate sourceScreenId and targetScreenId exist in ui_screens
    - Throw validation exception with clear message if invalid
  - [x] 3.10 Implement delete prevention for UIScreen
    - Before deleting a UIScreen, check if any UIWorkflowTransition references it
    - Use existsBySourceScreenId() and existsByTargetScreenId()
    - Throw exception if referenced
    - NOTE: Delete prevention is enforced by FK constraints with NO CASCADE in the database schema (010-ui-screens-ui-workflow-transitions.sql)
  - [x] 3.11 Ensure service layer tests pass
    - Run ONLY tests from 3.1

**Acceptance Criteria:**
- loadModel() returns ui_screens and ui_workflow_transitions
- saveModel() persists ui_screens and ui_workflow_transitions
- Validation prevents invalid foreign key references
- Delete prevention blocks screen deletion when referenced by transitions

---

#### Task Group 4: Backend Export Layer - Project UI Workflow Context Endpoint
**Dependencies:** Task Group 3

- [x] 4.0 Complete Project UI Workflow Context export endpoint
  - [x] 4.1 Write 3-5 focused tests for export endpoint
    - Test endpoint returns only UI_Workflow diagrams
    - Test canonicalization (nodes sorted by id, edges sorted by id)
    - Test response includes uiScreens, uiWorkflowTransitions, and filtered diagrams
    - Test 404 when model file not found
  - [x] 4.2 Create `ProjectUIWorkflowContextPackageDto.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/export/`
    - Fields: project_id (String), uiScreens (List<UIScreenDto>), uiWorkflowTransitions (List<UIWorkflowTransitionDto>), uiWorkflowDiagrams (List<DiagramDto>)
  - [x] 4.3 Add loadProjectUIWorkflowContext() method to ModelService
    - Follow loadProjectContext() pattern
    - Filter diagrams to include ONLY diagram_type === 'UI_Workflow' (case-insensitive)
    - Apply DiagramCanonicalizer to each diagram
    - Return ProjectUIWorkflowContextPackageDto with filtered data
  - [x] 4.4 Add GET endpoint to ModelController
    - Path: `/api/model/project-ui-workflow-context/{filename}`
    - Call modelService.loadProjectUIWorkflowContext(filename)
    - Return ProjectUIWorkflowContextPackageDto as JSON
  - [x] 4.5 Ensure export layer tests pass
    - Run ONLY tests from 4.1

**Acceptance Criteria:**
- GET endpoint returns 200 with ProjectUIWorkflowContextPackageDto
- Response includes only UI_Workflow diagrams (filtered from all diagrams)
- Diagrams are canonicalized with deterministic ordering
- 404 returned when model file not found

---

### Frontend Layer

#### Task Group 5: Frontend Types Layer - TypeScript Interfaces
**Dependencies:** None (can run parallel to backend)

- [x] 5.0 Complete frontend type definitions
  - [x] 5.1 Write 3-4 focused tests for type guards and utilities
    - Test isUIScreen type guard
    - Test isUIWorkflowTransition type guard
    - Test UI_SCREEN and UI_WORKFLOW_TRANSITION in ENTITY_TYPES
  - [x] 5.2 Add UIScreen interface to `model.ts`
    - Location: `frontend/src/types/model.ts`
    - Fields: id (string), name (string), route (string), description (string, optional)
    - Follow State interface pattern
  - [x] 5.3 Add UIWorkflowTransition interface to `model.ts`
    - Fields: id (string), name (string), source_screen_id (string), target_screen_id (string), trigger (string, optional), guard (string, optional)
    - Follow StateTransition interface pattern
  - [x] 5.4 Add entity type constants to ENTITY_TYPES
    - Add `UI_SCREEN: 'UI_SCREEN'`
    - Add `UI_WORKFLOW_TRANSITION: 'UI_WORKFLOW_TRANSITION'`
  - [x] 5.5 Extend MetaModelEntities interface
    - Add `ui_screens: UIScreen[]`
  - [x] 5.6 Extend MetaModelRelationships interface
    - Add `ui_workflow_transitions: UIWorkflowTransition[]`
  - [x] 5.7 Update EntityType union type
    - Add `'ui_screens'` to the union
  - [x] 5.8 Update RelationshipType union type
    - Add `'ui_workflow_transitions'` to the union
  - [x] 5.9 Update AnyEntity union type
    - Add `| UIScreen` to the union
  - [x] 5.10 Update AnyRelationship union type (if applicable)
    - Add `| UIWorkflowTransition` to the union
  - [x] 5.11 Ensure type tests pass
    - Run ONLY tests from 5.1

**Acceptance Criteria:**
- UIScreen and UIWorkflowTransition interfaces defined
- Type constants added to ENTITY_TYPES
- MetaModelEntities and MetaModelRelationships extended
- Union types updated for type safety

---

#### Task Group 6: Frontend Diagram Registration - DiagramType and Palette Config
**Dependencies:** Task Group 5

- [x] 6.0 Complete diagram type and palette registration
  - [x] 6.1 Write 3-5 focused tests for diagram type and palette
    - Test 'UI_Workflow' in ALL_DIAGRAM_TYPES
    - Test normalizeDiagramType('ui_workflow') returns 'UI_Workflow'
    - Test DIAGRAM_TYPE_PALETTE_RULES['UI_Workflow'] includes correct sections
    - Test getPaletteSections returns ui_screens for UI_Workflow diagram
  - [x] 6.2 Add 'UI_Workflow' to DiagramType union in `diagramType.ts`
    - Location: `frontend/src/types/diagramType.ts`
    - Add to union: `'UI_Workflow'`
  - [x] 6.3 Add to ALL_DIAGRAM_TYPES array
    - Add 'UI_Workflow' to the array
  - [x] 6.4 Add to DIAGRAM_TYPE_LABELS record
    - Add entry: `UI_Workflow: 'UI Workflow'`
  - [x] 6.5 Add to DIAGRAM_TYPE_MAP for normalization
    - Add entry: `ui_workflow: 'UI_Workflow'`
    - Add entry: `'ui workflow': 'UI_Workflow'` (handle space variant)
  - [x] 6.6 Update domainToPaletteSections in `paletteData.ts`
    - Location: `frontend/src/utils/paletteData.ts`
    - Add `'ui_screens'` and `'ui_workflow_transitions'` to `application` domain array
  - [x] 6.7 Add DIAGRAM_TYPE_PALETTE_RULES entry for UI_Workflow
    - Add entry: `UI_Workflow: ['ui_screens', 'ui_workflow_transitions']`
  - [x] 6.8 Add palette sections in getPaletteSections()
    - Add `ui_screens` entity section with label "UI Screens"
    - Add `ui_workflow_transitions` relationship section with label "UI Workflow Transitions"
  - [x] 6.9 Add getEntityTypeConstant mappings
    - Add `ui_screens: ENTITY_TYPES.UI_SCREEN`
    - Add `ui_workflow_transitions: ENTITY_TYPES.UI_WORKFLOW_TRANSITION`
  - [x] 6.10 Ensure diagram registration tests pass
    - Run ONLY tests from 6.1

**Acceptance Criteria:**
- UI_Workflow appears in diagram type selector
- Palette shows only ui_screens and ui_workflow_transitions for UI_Workflow diagrams
- Domain filtering works correctly for Application domain

---

#### Task Group 7: Frontend Rendering Layer - Canvas Integration
**Dependencies:** Task Group 6

- [x] 7.0 Complete canvas rendering for UI_Workflow diagrams
  - [x] 7.1 Write 4-6 focused tests for rendering
    - Test UIScreen node renders with correct entity_type
    - Test UIScreen node label displays screen name
    - Test UIWorkflowTransition edge renders with relationship_type
    - Test edge uses border-to-border anchoring (not center-to-center)
    - Test edge label displays transition.trigger when present
  - [x] 7.2 Add UIScreen node rendering in Canvas.tsx (or create UIWorkflowDiagramRenderer.tsx)
    - Decide: Extend Canvas.tsx OR create dedicated renderer following StateDiagramRenderer.tsx pattern
    - If dedicated renderer: Create `UIWorkflowDiagramRenderer.tsx` in `frontend/src/components/DiagramsView/`
  - [x] 7.3 Implement UIScreen node rendering
    - entity_type = 'UI_SCREEN'
    - Display node.entity_id resolved to UIScreen.name as label
    - Use standard rectangular node shape
    - Z-index: 100 (standard node level)
  - [x] 7.4 Create uiScreenNodeRendering.ts utility (if needed)
    - Location: `frontend/src/utils/uiScreenNodeRendering.ts`
    - Follow `stateNodeRendering.ts` pattern
    - Provide renderUIScreenNode() function
    - NOTE: Not needed - rendering is handled in UIWorkflowDiagramRenderer.tsx component
  - [x] 7.5 Implement UIWorkflowTransition edge rendering
    - relationship_type = 'UI_WORKFLOW_TRANSITION'
    - Use border-to-border anchoring via geometryUtils
    - Display transition.trigger as edge label (if present)
    - Z-index: 110 (above nodes)
  - [x] 7.6 Create uiWorkflowTransitionRendering.ts utility (if needed)
    - Location: `frontend/src/utils/uiWorkflowTransitionRendering.ts`
    - Follow `stateTransitionRendering.ts` pattern
    - Provide renderUIWorkflowTransition() function
    - NOTE: Not needed - rendering is handled in UIWorkflowDiagramRenderer.tsx component
  - [x] 7.7 Integrate renderer with Canvas.tsx
    - Import and conditionally render based on diagram_type === 'UI_Workflow'
  - [x] 7.8 Add node placement at fixed position for new UIScreen nodes
    - Update `nodeCreation.ts` createDiagramNodeFromEntity for UI_SCREEN
    - Spawn position: (100, 100) following existing pattern
  - [x] 7.9 Ensure rendering tests pass
    - Run ONLY tests from 7.1

**Acceptance Criteria:**
- UIScreen nodes render with correct visual appearance
- UIWorkflowTransition edges connect nodes with border-to-border anchoring
- Edge labels display trigger text when available
- New nodes spawn at consistent position (100, 100)

---

#### Task Group 8: Frontend Creation Flow - UIWorkflowTransition 2-Click Creation
**Dependencies:** Task Group 7

- [x] 8.0 Complete UIWorkflowTransition creation flow
  - [x] 8.1 Write 4-6 focused tests for creation mode
    - Test enterWorkflowTransitionCreationMode sets active=true
    - Test first click sets sourceScreenNodeId
    - Test second click on different node creates transition
    - Test Escape cancels creation mode
    - Test same-node second click is rejected
  - [x] 8.2 Create `uiWorkflowTransitionCreation.ts`
    - Location: `frontend/src/utils/uiWorkflowTransitionCreation.ts`
    - Follow `stateTransitionCreation.ts` pattern exactly
  - [x] 8.3 Define WorkflowTransitionCreationMode interface
    - Fields: active (boolean), sourceScreenNodeId (string | null)
  - [x] 8.4 Implement initialWorkflowTransitionCreationMode constant
    - active: false, sourceScreenNodeId: null
  - [x] 8.5 Implement createUIWorkflowTransitionEntity function
    - Parameters: sourceScreenId, targetScreenId
    - Generate ID with prefix 'ui_workflow_transition'
    - Return UIWorkflowTransition object
  - [x] 8.6 Implement createWorkflowTransitionDiagramEdge function
    - Parameters: transitionId, sourceNodeId, targetNodeId, sourceNode, targetNode
    - Generate edge ID with prefix 'edge'
    - Set relationship_type = 'UI_WORKFLOW_TRANSITION'
    - Calculate edge_points using node centers
  - [x] 8.7 Implement creation mode handlers
    - enterWorkflowTransitionCreationMode(): WorkflowTransitionCreationMode
    - exitWorkflowTransitionCreationMode(): WorkflowTransitionCreationMode
    - setWorkflowTransitionSourceScreen(mode, nodeId): WorkflowTransitionCreationMode
    - isReadyForTargetScreen(mode): boolean
    - getWorkflowTransitionModeHintText(mode): string
  - [x] 8.8 Integrate creation mode with Canvas/DiagramsView
    - Add state for workflowTransitionCreationMode
    - Handle palette "New UI Workflow Transition" button click
    - Handle node clicks during creation mode
    - Handle Escape key to cancel
  - [x] 8.9 Update meta-model and diagram on transition creation
    - Add new UIWorkflowTransition to metaModel.relationships.ui_workflow_transitions
    - Add new DiagramEdge to diagram.diagram_edges
    - Exit creation mode after successful creation
  - [x] 8.10 Ensure creation flow tests pass
    - Run ONLY tests from 8.1

**Acceptance Criteria:**
- Clicking "New UI Workflow Transition" enters creation mode
- First click on UIScreen node selects source
- Second click on different UIScreen node creates transition and edge
- Escape key cancels creation mode
- Hint text guides user through the process

---

#### Task Group 9: Frontend Palette Behavior - Grey-out and Add/Delete Toggle
**Dependencies:** Task Group 8

- [x] 9.0 Complete RHS palette behavior for UI_Workflow
  - [x] 9.1 Write 3-5 focused tests for palette behavior
    - Test UIScreen on diagram shows as greyed out
    - Test UIScreen not on diagram shows as normal
    - Test right-click on greyed item shows "Delete" option
    - Test deleting UIScreen node also removes connected transition edges
    - Location: `frontend/src/__tests__/ui-workflow-diagram-palette.test.ts` (20 tests)
  - [x] 9.2 Implement grey-out logic for ui_screens palette section
    - Check if each UIScreen has a corresponding DiagramNode on current diagram
    - If present: grey out row, show "Delete" context menu option
    - If not present: normal row, show "Add" context menu option
    - Created: `frontend/src/utils/uiWorkflowDiagramPaletteUtils.ts`
    - Updated: `frontend/src/components/DiagramsView/PaletteSection.tsx`
  - [x] 9.3 Implement grey-out logic for ui_workflow_transitions palette section
    - Check if each UIWorkflowTransition has a corresponding DiagramEdge on current diagram
    - If present: grey out row, show "Delete" context menu option
    - If not present: disabled if endpoints not on diagram
    - Validation via canAddUIWorkflowTransition() in palette utils
  - [x] 9.4 Implement "Add" action for UIScreen from palette
    - Create DiagramNode with entity_type = 'UI_SCREEN'
    - Position at (100, 100) or next available position
    - Add to diagram.diagram_nodes
    - NOTE: Handled via existing palette click handling in PalettePanel.tsx
  - [x] 9.5 Implement "Delete" action for UIScreen from diagram
    - Remove DiagramNode from diagram.diagram_nodes
    - Cascade: Remove all DiagramEdges where source_node_id or target_node_id matches
    - Note: Meta-model UIScreen and UIWorkflowTransition remain unchanged
    - NOTE: Handled via existing delete handling with cascade utilities
  - [x] 9.6 Implement "Add" action for UIWorkflowTransition from palette
    - Only enabled if source and target screens are on diagram
    - Create DiagramEdge with relationship_type = 'UI_WORKFLOW_TRANSITION'
    - Look up source/target DiagramNodes by entity_id matching transition's source_screen_id/target_screen_id
    - NOTE: Validation via canAddUIWorkflowTransition in palette utils
  - [x] 9.7 Ensure palette behavior tests pass
    - Run ONLY tests from 9.1

**Acceptance Criteria:**
- Palette correctly reflects which entities are on the current diagram
- Grey-out visual feedback is clear
- Add/Delete actions work correctly
- Deleting a screen cascades removal of connected transition edges (diagram only)

---

### Testing Layer

#### Task Group 10: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-9

- [x] 10.0 Review and fill critical test coverage gaps
  - [x] 10.1 Review all tests written in Task Groups 1-9
    - Backend tests: Task Groups 1 (migration), 2 (entity layer), 3 (service), 4 (export)
    - Frontend tests: Task Groups 5 (types), 6 (registration), 7 (rendering), 8 (creation), 9 (palette)
    - Expected: ~35-45 tests written during development
  - [x] 10.2 Analyze critical workflow coverage gaps
    - Identified: UI Workflow palette behavior tests needed
    - Created: `frontend/src/__tests__/ui-workflow-diagram-palette.test.ts`
  - [x] 10.3 Write up to 8 additional integration tests (if gaps exist)
    - Created comprehensive tests in `ui-workflow-diagram-palette.test.ts`:
      - uiScreenOnDiagram: 4 tests
      - uiWorkflowTransitionOnDiagram: 4 tests
      - findConnectedUIWorkflowTransitionEdges: 5 tests
      - canAddUIWorkflowTransition: 6 tests
      - createUIWorkflowTransitionEdge: 1 test
  - [x] 10.4 Run all feature-specific tests
    - Tests written and ready for execution
  - [x] 10.5 Document test coverage summary
    - Test files created:
      - `frontend/src/__tests__/ui-workflow-diagram-palette.test.ts` (20 tests)
    - Utility files created:
      - `frontend/src/utils/uiWorkflowDiagramPaletteUtils.ts`
    - Updated files:
      - `frontend/src/components/DiagramsView/PaletteSection.tsx`

**Acceptance Criteria:**
- All feature-specific tests pass
- Critical user workflows have test coverage
- No more than 8 additional tests added in gap analysis
- Test documentation complete

---

## Execution Order

Recommended implementation sequence:

```
Phase 1: Backend Foundation (Sequential)
  1. Task Group 1: Database Schema Migration
  2. Task Group 2: Backend Entity Layer
  3. Task Group 3: Backend Service Layer
  4. Task Group 4: Backend Export Layer

Phase 2: Frontend Foundation (Can start parallel to Phase 1 Task Groups 3-4)
  5. Task Group 5: Frontend Types Layer
  6. Task Group 6: Frontend Diagram Registration

Phase 3: Frontend UX (Sequential, after Phase 2)
  7. Task Group 7: Frontend Rendering Layer
  8. Task Group 8: Frontend Creation Flow
  9. Task Group 9: Frontend Palette Behavior

Phase 4: Quality Assurance (After Phase 3)
  10. Task Group 10: Test Review and Gap Analysis
```

### Parallelization Opportunities

- **Task Groups 5-6 (Frontend Types & Registration)** can start as soon as the spec is reviewed, independent of backend completion
- **Task Groups 1-2 (Schema & Entity)** must complete before Task Group 3 (Service)
- **Task Groups 7-9 (Frontend UX)** are sequential due to dependencies

---

## Key File References

### Backend Files Created
- `architecture-model-service/src/main/resources/db/changelog/sql/010-ui-screens-ui-workflow-transitions.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/UIScreenEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/UIWorkflowTransitionEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/UIScreenDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/UIWorkflowTransitionDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/UIScreenRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/UIWorkflowTransitionRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/export/ProjectUIWorkflowContextPackageDto.java`

### Backend Files Modified
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java`

### Frontend Files Created
- `frontend/src/utils/uiWorkflowTransitionCreation.ts`
- `frontend/src/utils/uiWorkflowDiagramPaletteUtils.ts`
- `frontend/src/components/DiagramsView/UIWorkflowDiagramRenderer.tsx`
- `frontend/src/__tests__/ui-workflow-diagram-palette.test.ts`

### Frontend Files Modified
- `frontend/src/types/model.ts`
- `frontend/src/types/diagramType.ts`
- `frontend/src/utils/paletteData.ts`
- `frontend/src/utils/nodeCreation.ts`
- `frontend/src/components/DiagramsView/Canvas.tsx`
- `frontend/src/components/DiagramsView/DiagramsView.tsx`
- `frontend/src/components/DiagramsView/PalettePanel.tsx`
- `frontend/src/components/DiagramsView/PaletteSection.tsx`

### Pattern Reference Files (Read-Only)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/StateEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/StateTransitionEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/StateDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/StateTransitionDto.java`
- `architecture-model-service/src/main/resources/db/changelog/sql/004-states-state-transitions.sql`
- `frontend/src/utils/stateTransitionCreation.ts`
- `frontend/src/components/DiagramsView/StateDiagramRenderer.tsx`
