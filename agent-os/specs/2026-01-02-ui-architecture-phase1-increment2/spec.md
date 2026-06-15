# Specification: Phase 1 UI Architecture - Increment 2: UI_SCREEN Diagram Type + UIComponent/UIAction/UIContract + Screen Schema Typed Content

## Goal
Extend Phase 1 UI support from workflows (Increment 1) into screen-level solution intent by adding three new UI meta-model entities (UIComponent, UIAction, UIContract), a first-class UI_SCREEN diagram type with a custom Sequence-style editor/renderer, and a deterministic "Screen Schema" DSL stored as typed content for LLM-consumable UI specification export.

## User Stories
- As an architect, I want to define UI components, actions, and API contracts so that I can capture enough screen composition detail to generate React+TS scaffolds.
- As a developer, I want to associate a UI screen with a structured UI_SCREEN diagram so that the screen's layout, component tree, and action bindings are documented in a deterministic, exportable format.

## Specific Requirements

**UIComponent Entity (Backend)**
- Add `ui_component` table with fields: id (UUID PK), model_file_id (FK), name (TEXT NOT NULL), component_type (TEXT NOT NULL), description (TEXT), domain (TEXT DEFAULT 'APPLICATION'), props_schema_json (JSONB)
- component_type enum values: PAGE_LAYOUT, FORM, TABLE, MODAL, NAV, CARD, DETAILS, CUSTOM
- Add UIComponentEntity, UIComponentDto, repository, and mapper following existing patterns (e.g., UIScreenEntity)
- Integrate into ModelService saveEntities/loadEntities flow
- Add to MetaModelEntitiesDto with `uiComponents()` accessor

**UIAction Entity (Backend)**
- Add `ui_action` table with fields: id (UUID PK), model_file_id (FK), name (TEXT NOT NULL), trigger_type (TEXT NOT NULL), owner_screen_id (TEXT nullable FK to ui_screens), owner_component_id (TEXT nullable FK to ui_component), effect_type (TEXT NOT NULL), description (TEXT), contract_id (TEXT nullable FK to ui_contract)
- trigger_type enum: CLICK, SUBMIT, CHANGE, LOAD, NAVIGATE, CUSTOM
- effect_type enum: NAVIGATE, CALL_API, SET_STATE, OPEN_MODAL, CLOSE_MODAL, VALIDATE, CUSTOM
- Add CHECK constraint: exactly one of owner_screen_id or owner_component_id must be non-null (XOR constraint)
- Add validation: if effect_type = 'CALL_API' then contract_id must be non-null

**UIContract Entity (Backend)**
- Add `ui_contract` table with fields: id (UUID PK), model_file_id (FK), name (TEXT NOT NULL), contract_type (TEXT NOT NULL), operation_ref (TEXT), request_schema_ref (TEXT), response_schema_ref (TEXT), bindings_json (JSONB)
- contract_type enum: API_OPERATION, DATA_QUERY, DATA_MUTATION, CUSTOM
- operation_ref stores OpenAPI operationId or fallback "METHOD /path" format
- bindings_json stores deterministic mapping hints, e.g., {"response.saveAs":"trades","request.from":{"tradeId":"$form.tradeId"}}

**Liquibase Migration 011-ui-components-actions-contracts.sql**
- Create ui_contract table first (no FK dependencies from new tables)
- Create ui_component table second
- Create ui_action table third with FKs to ui_screens, ui_component, ui_contract
- Add CHECK constraint for owner XOR logic on ui_action
- Add indexes on model_file_id and FK columns

**Backend CRUD Endpoints**
- Add /api/model/ui-components (GET list, POST create, PUT update, DELETE)
- Add /api/model/ui-actions (GET list, POST create, PUT update, DELETE)
- Add /api/model/ui-contracts (GET list, POST create, PUT update, DELETE)
- Add GET /api/model/ui-screens/{screenId}/ui-screen-diagram that queries diagrams where diagram_type='UI_SCREEN' AND typed_content_json->>'screen_id' = screenId; return 404 if not found

**Project UI Screen Context Export Endpoint**
- Add GET /api/model/project-ui-screen-context/{filename} returning ProjectUIScreenContextPackageDto
- Response includes: project_id, uiScreens[], uiComponents[], uiContracts[], uiActions[], uiScreenDiagrams[] (UI_SCREEN only, canonicalized)
- Filter diagrams to only those with diagram_type = 'UI_SCREEN'
- Apply existing DiagramCanonicalizer.canonicalize() to ensure deterministic JSON output

**UI_SCREEN Diagram Type (Frontend)**
- Add 'UI_SCREEN' to DiagramType union and ALL_DIAGRAM_TYPES array in diagramType.ts
- Add DIAGRAM_TYPE_LABELS entry: UI_SCREEN -> 'UI Screen'
- Add case-insensitive mapping in DIAGRAM_TYPE_MAP: ui_screen -> 'UI_SCREEN'
- UI_SCREEN diagrams open UIScreenDiagramEditorPanel (not standard canvas)

**UI_SCREEN TypedContent Schema v1**
- Add UIScreenContent interface to typedContent.ts with fields: schema_version (1), screen_id (UUID), route (string optional), title (string optional), states (object with loading/error/empty), layout (object with type/notes), component_tree (array of component refs), actions (array of action refs)
- component_tree items: {id, ref_type, name, slot, props, children[]} with recursive children support
- actions items: {id, name, trigger, owner:{type,id}, effect:{type,contract_id,to_screen_id}, notes}
- Add createDefaultUIScreenContent() factory function

**UIScreenDiagramEditorPanel Component**
- Create UIScreenDiagramEditorPanel.tsx following SequenceEditorPanel.tsx patterns
- Four tabs: Overview (route/title/states), Components (tree editor), Actions (list editor), Raw DSL (JSON editor)
- Use useUIScreenDiagram hook (similar to useSequenceDiagram) for local state + debounced autosave
- Screen picker dropdown to select/set typed_content.screen_id (required association)
- Changes update diagram.typedContent and persist via onUpdateDiagram callback

**UIScreenDiagramRenderer Component**
- Create UIScreenDiagramRenderer.tsx as non-canvas structured preview
- Display: screen header (name/route), component tree (indented list), actions list (with resolved contract/navigation targets)
- Render in DiagramsView main area when UI_SCREEN diagram is active
- No drag/drop canvas interactions; read-only structured preview

**Create/Open Screen Spec Action**
- In UIScreens grid or RHS panel, add "Open Screen Spec" / "Create Screen Spec" action
- If UI_SCREEN diagram exists for UIScreen (query by typed_content.screen_id), open it
- If no diagram exists, create new UI_SCREEN diagram with typed_content.screen_id pre-set, then open

**Validation on Save**
- screen_id must reference an existing UIScreen
- Any UIAction id in typed_content.actions must exist in meta-model
- Any contract_id in action.effect must exist when effect.type = 'CALL_API'
- Any to_screen_id in action.effect for NAVIGATE must reference existing UIScreen
- Block save and show toast with actionable message on validation failure

## Visual Design
No visual mockups provided for this specification.

## Existing Code to Leverage

**SequenceEditorPanel.tsx Pattern**
- Use same collapsible panel structure with toggle button and header
- Reuse tab navigation pattern with activeTab state and handleTabClick callback
- Leverage isSaving indicator pattern for autosave feedback
- Follow same props interface pattern: activeDiagram, onUpdateDiagram, isCollapsed, onToggleCollapse, metaModel

**useSequenceDiagram.ts Hook Pattern**
- Reuse debounced autosave pattern (AUTOSAVE_DEBOUNCE_MS = 750)
- Use same state structure: localDiagram, isLoading, isSaving, isDirty, error
- Follow sequenceContentToSequenceDiagram/sequenceDiagramToSequenceContent conversion pattern for UI_SCREEN content
- Leverage getDiagramType() for case-insensitive diagram_type comparison

**typedContent.ts Structure**
- Add 'UI_SCREEN' to DiagramTypedContentType union
- Follow TypedContentEnvelope pattern: {type, version, content}
- Add UIScreenContent interface matching existing SequenceContent/ERContent patterns
- Implement createDefaultUIScreenContent() following createDefaultSequenceContent() pattern

**ModelService.java Integration**
- Add UIComponentRepository, UIActionRepository, UIContractRepository to ModelService constructor injection
- Integrate into saveEntities/loadEntities/deleteAllDataForModelFile following existing entity patterns
- Add project-ui-screen-context export following loadProjectUIWorkflowContext() pattern

**Liquibase Migration Pattern**
- Follow 010-ui-screens-ui-workflow-transitions.sql structure for table creation
- Use same index naming convention: idx_{table}_{column}
- Use TEXT PRIMARY KEY, model_file_id FK with ON DELETE CASCADE pattern

## Out of Scope
- No Figma integration (deferred to Phase 2)
- No pixel-perfect layout or visual designer capabilities
- No code generation orchestration (Gateway/MCP generation flows are deferred)
- No full state machine modeling; only basic screen states (loading/error/empty) supported in this increment
- No visual canvas interactions for UI_SCREEN diagrams (non-canvas editor only)
- No drag-and-drop component tree editing (list-based editing only)
- No live preview of UI component rendering
- No UIWorkflowTransition integration with UI_SCREEN diagram (separate diagram types)
- No automatic synchronization between UIAction changes and UI_SCREEN typed content
- No OpenAPI spec parsing or automatic contract population from spec files
