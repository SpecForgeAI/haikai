# Specification: Fix UI_SCREEN Entity Type Registration

## Goal
Register UI_SCREEN as a known entity type in the diagram system so that UI_WORKFLOW diagrams containing UIScreen nodes load and validate successfully without "unknown entity type" errors.

## User Stories
- As an architect, I want to create UIScreen entities and add them to UI_WORKFLOW diagrams so that I can model user interface workflows
- As an architect, I want UIScreen nodes to display their correct name when viewing diagrams so that I can understand the workflow

## Specific Requirements

**Add UI_SCREEN to DIAGRAM_NODE_ENTITY_TYPE_MAP**
- Add entry `UI_SCREEN: 'ui_screens'` to the centralized entity type registry
- Place under a new "UI Architecture Domain" section comment for organization
- This is the single source of truth used by rendering.ts and validation.ts
- Location: `frontend/src/utils/entityTypeRegistry.ts` line ~107

**Ensure ENTITY_TYPES constant includes UI_SCREEN**
- Verify `ENTITY_TYPES.UI_SCREEN = 'UI_SCREEN'` exists in types/model.ts
- Already present at line 991 - no changes needed
- Used for type safety when referencing entity types in code

**Ensure MetaModelEntities includes ui_screens**
- Verify `ui_screens: UIScreen[]` exists in MetaModelEntities interface
- Already present at line 1736 - no changes needed
- Required for the registry mapping to resolve correctly

**Verify ENTITY_TYPE_DISPLAY_NAMES includes UI_SCREEN**
- Entry `'ui_screens': 'UI_SCREEN'` already present at line 57 in validation.ts
- No changes needed - used for validation error messages

**Update validateDiagramNodes to recognize UI_SCREEN**
- No direct changes needed - uses entityTypeMap which references DIAGRAM_NODE_ENTITY_TYPE_MAP
- Adding UI_SCREEN to registry will automatically enable validation
- Location: `frontend/src/utils/rendering.ts` line 1151-1183

**Verify getEntityLabel resolves UI_SCREEN node labels**
- No special handling needed - standard name resolution will work
- UIScreen entities have a `name` field that will be returned
- Uses entityTypeMap which will include UI_SCREEN after registry update

**Update test count in behavioural-entity-type-registration.test.ts**
- Current test expects 19 entity types (line 74)
- After adding UI_SCREEN, update to expect 20 entity types
- Add UI_SCREEN to expectedEntityTypes array for coverage

**Add UI_SCREEN specific unit tests**
- Create new test file: `frontend/src/__tests__/ui-screen-entity-type-registration.test.ts`
- Test that DIAGRAM_NODE_ENTITY_TYPE_MAP contains UI_SCREEN
- Test that validateDiagramNodes passes for diagram with UI_SCREEN node
- Test that getEntityLabel returns UIScreen.name for UI_SCREEN nodes
- Follow pattern from endpoint-entity-type-registration.test.ts

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**`frontend/src/utils/entityTypeRegistry.ts`**
- Centralized DIAGRAM_NODE_ENTITY_TYPE_MAP that maps entity types to MetaModel keys
- getKnownEntityTypes() function used for error messages
- Add UI_SCREEN entry following existing pattern (e.g., ACTIVITY_FLOW at line 106)

**`frontend/src/types/model.ts`**
- UIScreen interface already defined at line 615 with id, name, route, description fields
- ENTITY_TYPES.UI_SCREEN already defined at line 991
- MetaModelEntities.ui_screens already defined at line 1736

**`frontend/src/utils/validation.ts`**
- ENTITY_TYPE_DISPLAY_NAMES already includes ui_screens at line 57
- validateModel already includes 'ui_screens' in entityTypes array at line 935
- validateJsonStructure already includes 'ui_screens' at line 1157

**`frontend/src/__tests__/endpoint-entity-type-registration.test.ts`**
- Template for UI_SCREEN registration tests
- Uses createTestDiagramNode(), createModelWithEndpoints() helpers
- Tests getEntityLabel, validateDiagramNodes, and ENTITY_TYPE_DISPLAY_NAMES

**`frontend/src/__tests__/behavioural-entity-type-registration.test.ts`**
- Tests DIAGRAM_NODE_ENTITY_TYPE_MAP completeness
- Update expected count from 19 to 20 after adding UI_SCREEN
- Add UI_SCREEN to expectedEntityTypes array

## Out of Scope
- No backend changes required
- No new UI components or screens
- No changes to UIScreen entity creation flow
- No changes to palette or diagram editing functionality
- No changes to UI_WORKFLOW_TRANSITION handling
- No changes to edge rendering or relationship handling
- No changes to diagram type configuration
- No changes to canvas rendering logic
- No migration scripts or database changes
- No changes to API contracts or DTOs
