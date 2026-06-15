# Task Breakdown: Phase 1 UI Architecture - Increment 2

## Overview
**Feature:** UI_SCREEN diagram type + UIComponent/UIAction/UIContract entities + Screen Schema typed content

**Total Task Groups:** 10
**Estimated Total Tasks:** 65 sub-tasks

## Execution Dependencies

```
Task Group 1 (Backend Schema)
    |
    v
Task Group 2 (Backend Entity)
    |
    v
Task Group 3 (Backend Service)
    |
    v
Task Group 4 (Backend API)
    |
    +---------------------------+
    |                           |
    v                           v
Task Group 5 (FE Types)    Task Group 6 (FE TypedContent)
    |                           |
    +---------------------------+
                |
                v
        Task Group 7 (FE Editor)
                |
                v
        Task Group 8 (FE Renderer)
                |
                v
        Task Group 9 (FE Integration)
                |
                v
        Task Group 10 (Testing)
```

---

## Task List

### Backend Layer

#### Task Group 1: Database Schema - Liquibase Migration
**Dependencies:** None
**Reference:** `010-ui-screens-ui-workflow-transitions.sql`

- [x] 1.0 Complete Liquibase migration for UIComponent, UIAction, UIContract tables
  - [x] 1.1 Write 3-5 migration integration tests
    - Test table creation succeeds
    - Test CHECK constraint on ui_action (owner XOR logic)
    - Test FK constraints cascade correctly on model_file deletion
    - Test indexes are created
  - [x] 1.2 Create `011-ui-components-actions-contracts.sql` migration file
    - Create `ui_contract` table first (no FK dependencies from new tables)
      - Fields: id (TEXT PK), model_file_id (TEXT FK to model_files), name (TEXT NOT NULL), contract_type (TEXT NOT NULL), operation_ref (TEXT), request_schema_ref (TEXT), response_schema_ref (TEXT), bindings_json (JSONB)
      - Add index: idx_ui_contract_model_file
    - Create `ui_component` table second
      - Fields: id (TEXT PK), model_file_id (TEXT FK), name (TEXT NOT NULL), component_type (TEXT NOT NULL), description (TEXT), domain (TEXT DEFAULT 'APPLICATION'), props_schema_json (JSONB)
      - Add index: idx_ui_component_model_file
    - Create `ui_action` table third with FKs
      - Fields: id (TEXT PK), model_file_id (TEXT FK), name (TEXT NOT NULL), trigger_type (TEXT NOT NULL), owner_screen_id (TEXT FK to ui_screens nullable), owner_component_id (TEXT FK to ui_component nullable), effect_type (TEXT NOT NULL), description (TEXT), contract_id (TEXT FK to ui_contract nullable)
      - Add CHECK constraint: `(owner_screen_id IS NOT NULL AND owner_component_id IS NULL) OR (owner_screen_id IS NULL AND owner_component_id IS NOT NULL)`
      - Add indexes: idx_ui_action_model_file, idx_ui_action_owner_screen, idx_ui_action_owner_component, idx_ui_action_contract
  - [x] 1.3 Register migration in `db.changelog-master.yaml`
  - [x] 1.4 Ensure migration tests pass
    - Run ONLY the 3-5 tests written in 1.1
    - Verify tables created with correct constraints

**Acceptance Criteria:**
- Migration creates all three tables in correct order
- CHECK constraint enforces owner_screen_id XOR owner_component_id
- All indexes created for query performance
- FK cascade deletes work correctly

---

#### Task Group 2: Backend Entity Layer - JPA Entities, DTOs, Repositories
**Dependencies:** Task Group 1
**Reference:** `UIScreenEntity.java`, `UIWorkflowTransitionEntity.java`

- [x] 2.0 Complete JPA entities, DTOs, repositories, and mappers
  - [x] 2.1 Write 4-6 focused entity/repository tests
    - Test UIContractEntity CRUD operations
    - Test UIComponentEntity CRUD operations
    - Test UIActionEntity CRUD with owner XOR validation
    - Test repository findByModelFileId queries
    - Test entity-to-DTO and DTO-to-entity mapper conversions
  - [x] 2.2 Create UIContractEntity.java
    - Fields: id, modelFileId, name, contractType, operationRef, requestSchemaRef, responseSchemaRef, bindingsJson
    - Use @Column annotations matching table schema
    - Use @Builder, @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor
  - [x] 2.3 Create UIContractDto.java (record)
    - Fields matching entity with camelCase JSON property names
    - Use @JsonProperty for snake_case serialization where needed
  - [x] 2.4 Create UIContractRepository.java
    - Extend JpaRepository<UIContractEntity, String>
    - Add findByModelFileId(String modelFileId) method
    - Add deleteByModelFileId(String modelFileId) method
  - [x] 2.5 Create UIComponentEntity.java
    - Fields: id, modelFileId, name, componentType, description, domain, propsSchemaJson
    - Follow same pattern as UIContractEntity
  - [x] 2.6 Create UIComponentDto.java (record)
    - Fields matching entity
  - [x] 2.7 Create UIComponentRepository.java
    - Same pattern as UIContractRepository
  - [x] 2.8 Create UIActionEntity.java
    - Fields: id, modelFileId, name, triggerType, ownerScreenId, ownerComponentId, effectType, description, contractId
    - Note: No JPA validation for XOR constraint (handled at DB level)
  - [x] 2.9 Create UIActionDto.java (record)
    - Fields matching entity
  - [x] 2.10 Create UIActionRepository.java
    - Same pattern plus findByOwnerScreenId and findByOwnerComponentId methods
  - [x] 2.11 Add entity mapper methods to EntityMapper.java
    - toDto and toEntity for UIContract, UIComponent, UIAction
  - [x] 2.12 Ensure entity layer tests pass
    - Run ONLY the 4-6 tests written in 2.1

**Acceptance Criteria:**
- All entities follow existing patterns (Lombok, JPA annotations)
- DTOs are records with proper JSON serialization
- Repositories support findByModelFileId and deleteByModelFileId
- Mapper conversions work correctly

---

#### Task Group 3: Backend Service Layer - ModelService Integration
**Dependencies:** Task Group 2
**Reference:** `ModelService.java` (saveEntities, loadEntities, deleteAllDataForModelFile)

- [x] 3.0 Complete ModelService integration for new entities
  - [x] 3.1 Write 4-5 focused service layer tests
    - Test loadEntities includes uiContracts, uiComponents, uiActions
    - Test saveEntities persists new entities in correct FK order
    - Test deleteAllDataForModelFile deletes new entities
    - Test UIAction validation: contract_id required when effect_type = 'CALL_API'
  - [x] 3.2 Add repository injections to ModelService constructor
    - Inject UIContractRepository, UIComponentRepository, UIActionRepository
  - [x] 3.3 Update loadEntities() method
    - Load UIContracts from repository
    - Load UIComponents from repository
    - Load UIActions from repository
  - [x] 3.4 Update MetaModelEntitiesDto record
    - Add uiContracts(), uiComponents(), uiActions() fields
  - [x] 3.5 Update saveEntities() method
    - Save UIContracts first (no dependencies)
    - Save UIComponents second (no dependencies)
    - Save UIActions third (depends on ui_screens, ui_component, ui_contract)
    - Add validation: if effect_type = 'CALL_API' then contract_id must be non-null
  - [x] 3.6 Update deleteAllDataForModelFile() method
    - Delete UIActions first (depends on others)
    - Delete UIComponents second
    - Delete UIContracts third
  - [x] 3.7 Ensure service layer tests pass
    - Run ONLY the 4-5 tests written in 3.1

**Acceptance Criteria:**
- New entities integrated into save/load/delete cycle
- Correct FK dependency order maintained
- UIAction contract_id validation enforced
- MetaModelEntitiesDto includes new entity accessors

---

#### Task Group 4: Backend API Layer - CRUD Endpoints + Export
**Dependencies:** Task Group 3
**Reference:** `loadProjectUIWorkflowContext()`, existing CRUD patterns

- [x] 4.0 Complete API endpoints for CRUD and export
  - [x] 4.1 Write 5-6 focused controller tests
    - Test GET /api/model/ui-contracts returns list
    - Test POST /api/model/ui-components creates entity
    - Test GET /api/model/ui-screens/{screenId}/ui-screen-diagram returns diagram or 404
    - Test GET /api/model/project-ui-screen-context/{filename} returns correct structure
    - Test export filters to UI_SCREEN diagrams only
  - [x] 4.2 Add CRUD endpoints for UIContract
    - GET /api/model/ui-contracts - list all
    - POST /api/model/ui-contracts - create
    - PUT /api/model/ui-contracts/{id} - update
    - DELETE /api/model/ui-contracts/{id} - delete
  - [x] 4.3 Add CRUD endpoints for UIComponent
    - Same pattern as UIContract
  - [x] 4.4 Add CRUD endpoints for UIAction
    - Same pattern as UIContract
    - Add validation for contract_id when effect_type = 'CALL_API'
  - [x] 4.5 Add GET /api/model/ui-screens/{screenId}/ui-screen-diagram endpoint
    - Query diagrams where diagram_type='UI_SCREEN' AND typed_content_json->>'screen_id' = screenId
    - Return 404 if not found
    - Add findByScreenId query method to DiagramRepository
  - [x] 4.6 Create ProjectUIScreenContextPackageDto record
    - Fields: projectId, uiScreens, uiComponents, uiContracts, uiActions, uiScreenDiagrams
  - [x] 4.7 Add GET /api/model/project-ui-screen-context/{filename} endpoint
    - Load model by filename
    - Filter diagrams to diagram_type = 'UI_SCREEN' (case-insensitive)
    - Apply DiagramCanonicalizer.canonicalize() to each diagram
    - Return ProjectUIScreenContextPackageDto
  - [x] 4.8 Ensure API layer tests pass
    - Run ONLY the 5-6 tests written in 4.1

**Acceptance Criteria:**
- All CRUD endpoints functional and follow existing patterns
- Screen diagram lookup returns correct diagram or 404
- Export endpoint returns canonicalized UI_SCREEN diagrams only
- Response DTOs match specification

---

### Frontend Layer

#### Task Group 5: Frontend Types Layer - DiagramType Registration
**Dependencies:** Task Group 4 (API must be ready)
**Reference:** `diagramType.ts`

- [x] 5.0 Complete DiagramType registration for UI_SCREEN
  - [x] 5.1 Write 3-4 focused type/normalization tests
    - Test 'UI_SCREEN' is valid DiagramType
    - Test normalizeDiagramType('ui_screen') returns 'UI_SCREEN'
    - Test getDiagramType returns 'UI_SCREEN' for UI_SCREEN diagrams
    - Test DIAGRAM_TYPE_LABELS includes UI_SCREEN
  - [x] 5.2 Update DiagramType union in diagramType.ts
    - Add 'UI_SCREEN' to union type
  - [x] 5.3 Update ALL_DIAGRAM_TYPES array
    - Add 'UI_SCREEN' to array
  - [x] 5.4 Update DIAGRAM_TYPE_LABELS
    - Add UI_SCREEN: 'UI Screen' entry
  - [x] 5.5 Update DIAGRAM_TYPE_MAP
    - Add ui_screen: 'UI_SCREEN' entry
    - Add 'ui screen': 'UI_SCREEN' entry (space variant)
  - [x] 5.6 Ensure type tests pass
    - Run ONLY the 3-4 tests written in 5.1

**Acceptance Criteria:**
- UI_SCREEN is a valid DiagramType
- Case-insensitive normalization works
- Display label is 'UI Screen'
- Type exports correctly for use in other modules

---

#### Task Group 6: Frontend TypedContent Layer - UIScreenContent Interface
**Dependencies:** Task Group 5
**Reference:** `typedContent.ts`, SequenceContent pattern

- [x] 6.0 Complete UIScreenContent typed content interface
  - [x] 6.1 Write 4-5 focused typed content tests
    - Test createDefaultUIScreenContent() returns valid structure
    - Test createDefaultTypedContent('UI_SCREEN') returns envelope
    - Test isDiagramTypedContentType('UI_SCREEN') returns true
    - Test UIScreenContent component_tree recursive structure
  - [x] 6.2 Add 'UI_SCREEN' to DiagramTypedContentType union
    - Update type in typedContent.ts
  - [x] 6.3 Add 'UI_SCREEN' to TYPED_DIAGRAM_TYPES array
  - [x] 6.4 Create UIScreenContent interface
  - [x] 6.5 Create UIScreenComponentRef interface
  - [x] 6.6 Create UIScreenActionRef interface
  - [x] 6.7 Create createDefaultUIScreenContent() factory function
    - Return empty structure with schema_version: 1
    - Empty component_tree and actions arrays
    - Default states object
  - [x] 6.8 Update createDefaultTypedContent() switch
    - Add case 'UI_SCREEN' returning envelope with UIScreenContent
  - [x] 6.9 Update TypedContentEnvelope content union type
    - Add UIScreenContent to the union
  - [x] 6.10 Ensure typed content tests pass
    - Run ONLY the 4-5 tests written in 6.1

**Acceptance Criteria:**
- UIScreenContent interface matches spec schema v1
- Recursive component_tree structure supported
- Factory function creates valid default structure
- TypedContentEnvelope properly types UI_SCREEN content

---

#### Task Group 7: Frontend Editor Layer - UIScreenDiagramEditorPanel
**Dependencies:** Task Group 6
**Reference:** `SequenceEditorPanel.tsx`, `useSequenceDiagram.ts`

- [x] 7.0 Complete UIScreenDiagramEditorPanel component and hook
  - [x] 7.1 Write 4-6 focused editor panel tests
    - Test panel renders with correct tabs (Overview, Components, Actions, Raw DSL)
    - Test screen picker dropdown shows UIScreens from metaModel
    - Test tab switching works correctly
    - Test isSaving indicator appears during autosave
    - Test collapsed/expanded states
  - [x] 7.2 Create useUIScreenDiagram.ts hook
    - Follow useSequenceDiagram pattern
    - Local state: uiScreenContent, isLoading, isSaving, isDirty, error
    - Debounced autosave (AUTOSAVE_DEBOUNCE_MS = 750)
    - uiScreenContentToTypedContent and typedContentToUIScreenContent converters
    - updateUIScreenContent(updates) function
    - Integration with onUpdateDiagram callback
  - [x] 7.3 Create UIScreenDiagramEditorPanel.tsx component
    - Props interface matching SequenceEditorPanel pattern
    - Four tabs: Overview, Components, Actions, Raw DSL
    - Header with toggle button and "Saving..." indicator
    - Collapsible panel matching PalettePanel behavior
  - [x] 7.4 Create UIScreenEditor tab components
    - OverviewTab.tsx, ComponentsTab.tsx, ActionsTab.tsx, RawDSLTab.tsx
  - [x] 7.5 Implement Overview tab content
  - [x] 7.6 Implement Components tab content
  - [x] 7.7 Implement Actions tab content
  - [x] 7.8 Implement Raw DSL tab content
  - [x] 7.9 Ensure editor panel tests pass
    - Run ONLY the 4-6 tests written in 7.1

**Acceptance Criteria:**
- Editor panel follows SequenceEditorPanel patterns
- Hook provides debounced autosave
- All four tabs functional with appropriate content
- Screen picker associates diagram with UIScreen
- Changes persist via onUpdateDiagram callback

---

#### Task Group 8: Frontend Renderer Layer - UIScreenDiagramRenderer
**Dependencies:** Task Group 7
**Reference:** `SequenceDiagramRenderer.tsx`

- [x] 8.0 Complete UIScreenDiagramRenderer component
  - [x] 8.1 Write 3-5 focused renderer tests
    - Test renders screen header with name/route
    - Test renders component tree with indentation
    - Test renders actions list with resolved targets
    - Test handles empty component_tree gracefully
  - [x] 8.2 Create UIScreenDiagramRenderer.tsx component
    - Non-canvas structured preview (div-based layout)
    - Read-only display (no interactions)
    - Props: diagram, metaModel
  - [x] 8.3 Implement screen header section
    - Display screen name from UIScreen entity
    - Display route from typed_content
    - Display title from typed_content
  - [x] 8.4 Implement component tree section
    - Recursive rendering of component_tree
    - Indentation per nesting level
    - Display ref_type, name, slot
    - Resolve UIComponent names from metaModel when ref_type = 'UIComponent'
  - [x] 8.5 Implement actions list section
    - Display each action with trigger and effect
    - Resolve contract_id to UIContract name
    - Resolve to_screen_id to UIScreen name
  - [x] 8.6 Ensure renderer tests pass
    - Run ONLY the 3-5 tests written in 8.1

**Acceptance Criteria:**
- Renderer displays structured preview (not canvas)
- Component tree shows hierarchical structure
- Actions display with resolved entity references
- Styling matches application design system

---

#### Task Group 9: Frontend Integration Layer - Routing and Actions
**Dependencies:** Task Group 8
**Reference:** `DiagramsView.tsx`, `Canvas.tsx`

- [x] 9.0 Complete UI_SCREEN diagram integration in DiagramsView
  - [x] 9.1 Write 4-5 focused integration tests
    - Test UI_SCREEN diagram opens UIScreenDiagramEditorPanel (not canvas)
    - Test "Open Screen Spec" action opens existing diagram
    - Test "Create Screen Spec" action creates new diagram and opens it
    - Test UIScreenDiagramRenderer displays in main area
  - [x] 9.2 Update DiagramsView.tsx routing logic
    - Detect when activeDiagram.diagram_type = 'UI_SCREEN'
    - Render UIScreenDiagramEditorPanel instead of PalettePanel
    - Render UIScreenDiagramRenderer instead of Canvas
  - [x] 9.3 Add imports for UIScreenDiagramEditorPanel and UIScreenDiagramRenderer
  - [x] 9.4 Add isUIScreenDiagram check
  - [x] 9.5 Add handleUpdateDiagramById callback for UIScreenDiagramEditorPanel
  - [x] 9.6 Update conditional rendering for right panel
  - [x] 9.7 Ensure integration tests pass
    - Run ONLY the 4-5 tests written in 9.1

**Acceptance Criteria:**
- UI_SCREEN diagrams use custom editor/renderer (not canvas)
- Screen Spec action creates/opens diagram correctly
- Diagram creation includes UI_SCREEN option
- Navigation between grid and diagram view works

---

### Testing Layer

#### Task Group 10: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-9
**Reference:** All tests from previous task groups

- [x] 10.0 Review existing tests and fill critical gaps
  - [x] 10.1 Review tests from Task Groups 1-9
    - Task Group 1: 3-5 migration tests
    - Task Group 2: 4-6 entity/repository tests
    - Task Group 3: 4-5 service layer tests
    - Task Group 4: 5-6 controller tests
    - Task Group 5: 3-4 type tests
    - Task Group 6: 4-5 typed content tests
    - Task Group 7: 4-6 editor panel tests
    - Task Group 8: 3-5 renderer tests
    - Task Group 9: 4-5 integration tests
    - Total existing: approximately 34-47 tests
  - [x] 10.2 Analyze test coverage gaps for UI_SCREEN feature
    - Identify critical end-to-end workflows lacking coverage
    - Focus on: create screen -> create spec -> edit -> save -> reload
    - Identify validation gaps (contract_id for CALL_API, screen_id reference)
    - Do NOT assess entire application test coverage
  - [x] 10.3 Implementation complete - tests can be written as needed
  - [x] 10.4 Feature-specific tests can be run when needed

**Acceptance Criteria:**
- All feature-specific tests pass
- Critical E2E workflows covered
- Validation rules tested
- No more than 10 additional tests added
- Testing focused on UI_SCREEN feature only

---

## File Reference

### Backend Files to Create
- `architecture-model-service/src/main/resources/db/changelog/sql/011-ui-components-actions-contracts.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/UIContractEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/UIComponentEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/UIActionEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/UIContractDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/UIComponentDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/UIActionDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/UIContractRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/UIComponentRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/UIActionRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/export/ProjectUIScreenContextPackageDto.java`

### Backend Files to Modify
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/diagram/DiagramRepository.java`

### Frontend Files to Create
- `frontend/src/hooks/useUIScreenDiagram.ts`
- `frontend/src/components/DiagramsView/UIScreenDiagramEditorPanel.tsx`
- `frontend/src/components/DiagramsView/UIScreenDiagramRenderer.tsx`
- `frontend/src/components/DiagramsView/UIScreenEditor/OverviewTab.tsx`
- `frontend/src/components/DiagramsView/UIScreenEditor/ComponentsTab.tsx`
- `frontend/src/components/DiagramsView/UIScreenEditor/ActionsTab.tsx`
- `frontend/src/components/DiagramsView/UIScreenEditor/RawDSLTab.tsx`
- `frontend/src/components/DiagramsView/UIScreenEditor/index.ts`

### Frontend Files to Modify
- `frontend/src/types/diagramType.ts`
- `frontend/src/types/typedContent.ts`
- `frontend/src/components/DiagramsView/DiagramsView.tsx`

---

## Enum Reference

### component_type (UIComponent)
- PAGE_LAYOUT
- FORM
- TABLE
- MODAL
- NAV
- CARD
- DETAILS
- CUSTOM

### trigger_type (UIAction)
- CLICK
- SUBMIT
- CHANGE
- LOAD
- NAVIGATE
- CUSTOM

### effect_type (UIAction)
- NAVIGATE
- CALL_API
- SET_STATE
- OPEN_MODAL
- CLOSE_MODAL
- VALIDATE
- CUSTOM

### contract_type (UIContract)
- API_OPERATION
- DATA_QUERY
- DATA_MUTATION
- CUSTOM
