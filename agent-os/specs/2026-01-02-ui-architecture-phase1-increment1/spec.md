# Specification: Phase 1 UI Architecture - Increment 1: UIScreen + UIWorkflowTransition Meta-Model and UI_WORKFLOW Diagram Type

## Goal

Introduce first-class UI architecture support by enabling users to define UIScreen entities (routes/pages), UIWorkflowTransition entities (navigation relationships), and model user navigation flows using a new UI_WORKFLOW diagram type with deterministic export for LLM consumption.

## User Stories

- As an architect, I want to define UI screens as meta-model entities so that I can document the frontend routes/pages in my application architecture.
- As an architect, I want to model navigation flows between screens using UIWorkflowTransition relationships so that I can visualize and communicate user journey paths.

## Specific Requirements

**UIScreen Entity Definition**
- Add UIScreen as a new meta-model entity in the Application Architecture domain
- Required fields: id (UUID), name (string), route (string, e.g., "/trades/:id")
- Optional fields: description (string)
- Domain defaults to APPLICATION (follow existing ArchitectureDomain pattern from `architectureDomain.ts`)
- Follow existing entity patterns from State/Activity entities for structure consistency

**UIWorkflowTransition Entity Definition**
- Add UIWorkflowTransition as a new meta-model relationship entity
- Required fields: id (UUID), name (string), sourceScreenId (UUID FK), targetScreenId (UUID FK)
- Optional fields: trigger (string, e.g., "Submit Login"), guard (string, free-text condition)
- sourceScreenId and targetScreenId must reference valid UIScreen ids (validation required)
- Follow StateTransition entity pattern: `from_state_id` / `to_state_id` becomes `source_screen_id` / `target_screen_id`

**Backend Persistence - Liquibase Migration**
- Create new migration file: `010-ui-screens-ui-workflow-transitions.sql`
- Add `ui_screens` table with columns: id, model_file_id, name, route, description
- Add `ui_workflow_transitions` table with columns: id, model_file_id, name, source_screen_id, target_screen_id, trigger, guard
- Add FK constraints: `source_screen_id` and `target_screen_id` reference `ui_screens.id` (NO cascade delete - fail if referenced)
- Follow existing column conventions from `004-states-state-transitions.sql`
- Add indexes on model_file_id, source_screen_id, target_screen_id

**Backend Entity/DTO/Repository Layer**
- Create `UIScreenEntity.java` following `StateEntity.java` pattern with Lombok annotations
- Create `UIWorkflowTransitionEntity.java` following `StateTransitionEntity.java` pattern
- Create `UIScreenDto.java` record with @JsonProperty annotations following `StateDto.java` pattern
- Create `UIWorkflowTransitionDto.java` record following `StateTransitionDto.java` pattern
- Create `UIScreenRepository.java` with `findByModelFileId`, `deleteByModelFileId` methods
- Create `UIWorkflowTransitionRepository.java` with `existsBySourceScreenId`, `existsByTargetScreenId` for delete prevention

**Backend ModelService Integration**
- Add UIScreenRepository and UIWorkflowTransitionRepository to ModelService constructor injection
- Extend `loadEntities()` to load ui_screens from repository
- Extend `saveEntities()` to persist ui_screens with truncate-insert pattern
- Add ui_workflow_transitions to MetaModelRelationships (as it references UIScreen entities)
- Validate UIWorkflowTransition source/target references before save
- Implement delete prevention: deleting UIScreen fails if referenced by UIWorkflowTransition

**Frontend Type Definitions**
- Add UIScreen interface to `model.ts` following existing entity patterns
- Add UIWorkflowTransition interface to `model.ts` following StateTransition pattern
- Add `UI_SCREEN` and `UI_WORKFLOW_TRANSITION` to ENTITY_TYPES constant
- Extend MetaModelEntities with `ui_screens: UIScreen[]`
- Extend MetaModelRelationships with `ui_workflow_transitions: UIWorkflowTransition[]`
- Update EntityType and AnyEntity union types to include new types

**UI_WORKFLOW Diagram Type Registration**
- Add `'UI_Workflow'` to DiagramType union in `diagramType.ts`
- Add to ALL_DIAGRAM_TYPES array and DIAGRAM_TYPE_LABELS record
- Add DIAGRAM_TYPE_MAP entry for case-insensitive normalization
- Diagram type appears in diagram type selector alongside General, ER, Sequence, Activity, State

**Palette Configuration for UI_WORKFLOW**
- Add `'ui_screens'` and `'ui_workflow_transitions'` to domainToPaletteSections under `application` domain
- Add new DIAGRAM_TYPE_PALETTE_RULES entry for UI_Workflow: `['ui_screens', 'ui_workflow_transitions']`
- Add palette sections in `getPaletteSections()` for ui_screens (entity) and ui_workflow_transitions (relationship)
- Add `ui_screens` and `ui_workflow_transitions` entries to getEntityTypeConstant mapping

**Canvas Behavior for UI_WORKFLOW**
- UIScreen nodes use generic node placement at fixed position (100,100) following `createDiagramNodeFromEntity` pattern
- DiagramNode for UIScreen: entity_type = 'UI_SCREEN', entity_id = UIScreen.id
- Node label displays UIScreen.name
- UIWorkflowTransition edges use border-to-border anchoring following State diagram edge rendering pattern
- DiagramEdge for transition: relationship_type = 'UI_WORKFLOW_TRANSITION', relationship_id = UIWorkflowTransition.id
- Edge label displays transition.trigger if present (optional)

**UIWorkflowTransition Creation Flow**
- Create `uiWorkflowTransitionCreation.ts` following `stateTransitionCreation.ts` pattern
- Implement WorkflowTransitionCreationMode interface with active flag and sourceScreenNodeId
- User clicks "New UI Workflow Transition" in palette to enter creation mode
- First click on UIScreen node sets source; second click on different UIScreen node sets target
- Create UIWorkflowTransition entity in meta-model and DiagramEdge on diagram
- Press Escape to cancel creation mode

**RHS Palette Grey-out and Add/Delete Behavior**
- UIScreens section lists all UIScreen entities filtered by domain
- If UIScreen already on current diagram: row greyed out, right-click shows "Delete" option
- If UIScreen not on diagram: normal row, right-click shows "Add" option
- Same grey-out behavior for UIWorkflowTransition section
- Deleting UIScreen from diagram also removes all UIWorkflowTransition edges referencing it (diagram-only, meta-model unchanged)

**Project UI Workflow Context Export Endpoint**
- Add GET `/api/model/project-ui-workflow-context/{filename}` endpoint
- Return ProjectUIWorkflowContextPackage DTO with: project_id, uiScreens[], uiWorkflowTransitions[], uiWorkflowDiagrams[]
- Filter diagrams to include ONLY diagram_type === 'UI_Workflow'
- Apply canonicalization: nodes sorted by id, edges sorted by id, map keys sorted recursively
- Follow existing `loadProjectContext` pattern in ModelService for deterministic JSON output

**Backend Tests**
- Test UIScreen CRUD operations via save/load model cycle
- Test UIWorkflowTransition creation with valid source/target screen references
- Test validation: UIWorkflowTransition with invalid screen IDs should fail
- Test delete prevention: UIScreen delete fails when referenced by UIWorkflowTransition
- Test project-ui-workflow-context export returns only UI_WORKFLOW diagrams with canonical ordering

**Frontend Tests**
- Test UI_WORKFLOW diagram creation via diagram selector
- Test adding UIScreen nodes via palette (verify node spawns at 100,100)
- Test UIWorkflowTransition creation via click-source-then-target flow
- Test edge renders with border-to-border anchoring (not center-to-center)
- Test palette grey-out toggles correctly when node added/removed
- Test deleting screen node cascades removal of connected transition edges from diagram

## Existing Code to Leverage

**State/StateTransition Entity Pattern (Backend)**
- `StateEntity.java`, `StateTransitionEntity.java` provide exact structural template for UIScreen/UIWorkflowTransition entities
- `StateDto.java`, `StateTransitionDto.java` provide DTO record patterns with @JsonProperty annotations
- `StateRepository.java`, `StateTransitionRepository.java` provide repository interface patterns with delete prevention methods
- `004-states-state-transitions.sql` provides Liquibase migration template with FK constraints and indexes

**StateDiagramRenderer Pattern (Frontend)**
- `StateDiagramRenderer.tsx` provides the exact rendering architecture to replicate for UI_WORKFLOW diagrams
- Uses z-index layering (nodes at 100, edges at 110), entity lookup helpers, and boundary anchoring
- `stateTransitionCreation.ts` provides the creation mode state machine pattern for edge creation flow
- `stateNodeRendering.ts` and `stateTransitionRendering.ts` provide rendering utility patterns

**Palette and Type System (Frontend)**
- `diagramType.ts` provides DiagramType union pattern and normalization functions
- `paletteData.ts` provides domainToPaletteSections, DIAGRAM_TYPE_PALETTE_RULES, and getPaletteSections patterns
- `nodeCreation.ts` provides createDiagramNodeFromEntity with fixed spawn position logic
- `model.ts` provides entity interface patterns, ENTITY_TYPES constant, and type union patterns

**ModelService Export Pattern (Backend)**
- `loadProjectContext()` method provides pattern for filtered diagram export with canonicalization
- `DiagramCanonicalizer` service provides deterministic JSON ordering for LLM-friendly output
- `ProjectContextPackageDto` provides DTO structure pattern for export response

## Out of Scope

- UIScreen composition/editor (screen internals, layout, child components) - deferred to Increment 2
- UIComponent, UIAction, or UIContract entities - not part of Increment 1
- Pixel-level or layout modeling for screens
- Figma integration or design system imports
- Any backend schema migrations beyond UIScreen and UIWorkflowTransition tables
- Screen preview or prototype rendering
- Animation or transition effects visualization
- Mobile vs desktop screen variants
- Screen versioning or A/B testing support
- Integration with external wireframing tools
