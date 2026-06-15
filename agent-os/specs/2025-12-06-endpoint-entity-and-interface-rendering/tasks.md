# Task Breakdown: Endpoint Entity and Interface Contract Rendering

## Overview
Total Tasks: 42 (7 task groups with subtasks)

This spec introduces a new meta-model entity **Endpoint** and enhances Interface diagram rendering with a multi-section "contract" layout. Endpoints are children of Interfaces and render as text rows within the Interface contract box, not as standalone diagram nodes.

## Task List

### Task Group 1: Type Definitions Layer

#### Task 1.0: Endpoint Type Definitions in model.ts
**Dependencies:** None
**Files:** `frontend/src/types/model.ts`

- [x] 1.1 Write 4-6 focused tests for Endpoint type definitions
  - Test EndpointType enum values (HTTP_REST, MESSAGE_QUEUE, MESSAGE_TOPIC, FILE_TRANSFER, OTHER)
  - Test EndpointDirection enum values (INBOUND, OUTBOUND, BIDIRECTIONAL)
  - Test EndpointLifecycleStatus enum values (ACTIVE, DEPRECATED, PLANNED, RETIRED)
  - Test ENTITY_TYPES includes ENDPOINT constant
  - Test Endpoint interface has all required fields
  - Test EntityType union includes 'endpoints'

- [x] 1.2 Add EndpointType enum definition
  ```typescript
  export type EndpointType =
    | 'HTTP_REST'
    | 'MESSAGE_QUEUE'
    | 'MESSAGE_TOPIC'
    | 'FILE_TRANSFER'
    | 'OTHER';
  ```

- [x] 1.3 Add EndpointDirection enum definition
  ```typescript
  export type EndpointDirection = 'INBOUND' | 'OUTBOUND' | 'BIDIRECTIONAL';
  ```

- [x] 1.4 Add EndpointLifecycleStatus enum definition
  ```typescript
  export type EndpointLifecycleStatus = 'ACTIVE' | 'DEPRECATED' | 'PLANNED' | 'RETIRED';
  ```

- [x] 1.5 Add Endpoint interface definition
  ```typescript
  export interface Endpoint {
    id: string;
    name: string;
    description: string;
    interface_id: string;  // FK to interfaces
    endpoint_type: EndpointType;
    path_or_address: string;
    protocol?: string;
    operation_verb?: string;  // GET, POST, PUT, DELETE, etc.
    direction: EndpointDirection;
    lifecycle_status: EndpointLifecycleStatus;
    version?: string;
    tags: string;
    valid_from?: string;
    valid_to?: string;
  }
  ```

- [x] 1.6 Add ENDPOINT to ENTITY_TYPES constant
  ```typescript
  ENDPOINT: 'ENDPOINT',
  ```

- [x] 1.7 Update MetaModelEntities interface
  ```typescript
  endpoints: Endpoint[];
  ```

- [x] 1.8 Update EntityType union to include 'endpoints'

- [x] 1.9 Update AnyEntity union to include Endpoint

- [x] 1.10 Ensure type definition tests pass
  - Run ONLY the 4-6 tests written in 1.1
  - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- All Endpoint-related types compile without errors
- ENTITY_TYPES.ENDPOINT is accessible
- MetaModelEntities includes endpoints array


### Task Group 2: Configuration Layer

#### Task 2.0: Configuration Files for Endpoint Entity
**Dependencies:** Task Group 1
**Files:** `frontend/src/config/defaults.ts`, `frontend/src/config/gridConfigs.ts`

- [x] 2.1 Write 4-6 focused tests for configuration layer
  - Test endpointTypeOptions array contains expected values
  - Test endpointDirectionOptions array contains expected values
  - Test endpointLifecycleStatusOptions array contains expected values
  - Test entityColors includes ENDPOINT color definition
  - Test gridConfigs includes 'endpoints' configuration
  - Test tabToEntityType includes 'Endpoints' mapping

- [x] 2.2 Add endpoint option arrays to defaults.ts
  ```typescript
  export const endpointTypeOptions: EndpointType[] = [
    'HTTP_REST',
    'MESSAGE_QUEUE',
    'MESSAGE_TOPIC',
    'FILE_TRANSFER',
    'OTHER',
  ];

  export const endpointDirectionOptions: EndpointDirection[] = [
    'INBOUND',
    'OUTBOUND',
    'BIDIRECTIONAL',
  ];

  export const endpointLifecycleStatusOptions: EndpointLifecycleStatus[] = [
    'ACTIVE',
    'DEPRECATED',
    'PLANNED',
    'RETIRED',
  ];
  ```

- [x] 2.3 Add ENDPOINT color to entityColors in defaults.ts
  ```typescript
  ENDPOINT: { background: '#E1F5FE', border: '#0288D1' },  // Light cyan with deep cyan border
  ```

- [x] 2.4 Update emptyModel in defaults.ts to include endpoints array
  ```typescript
  entities: {
    // ... existing entities
    endpoints: [],
  }
  ```

- [x] 2.5 Add endpoints grid configuration to gridConfigs.ts
  ```typescript
  endpoints: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 150 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 150 },
    { field: 'interface_id', displayName: 'Interface', cellType: 'fk_typeahead', required: true, width: 150, fkTarget: 'interfaces' },
    { field: 'endpoint_type', displayName: 'Type', cellType: 'dropdown', required: true, width: 120, options: endpointTypeOptions },
    { field: 'path_or_address', displayName: 'Path/Address', cellType: 'text', required: true, width: 200 },
    { field: 'protocol', displayName: 'Protocol', cellType: 'text', required: false, width: 80 },
    { field: 'operation_verb', displayName: 'Verb', cellType: 'text', required: false, width: 80 },
    { field: 'direction', displayName: 'Direction', cellType: 'dropdown', required: true, width: 110, options: endpointDirectionOptions },
    { field: 'lifecycle_status', displayName: 'Status', cellType: 'dropdown', required: true, width: 100, options: endpointLifecycleStatusOptions },
    { field: 'version', displayName: 'Version', cellType: 'text', required: false, width: 80 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 100 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  ```

- [x] 2.6 Add 'Endpoints' to tabToEntityType mapping
  ```typescript
  'Endpoints': 'endpoints',
  ```

- [x] 2.7 Add 'Endpoints' to entityTabNames array (after 'Interfaces')

- [x] 2.8 Update domainGroupings to include 'Endpoints' in application section
  ```typescript
  application: ['Applications', 'App Components', 'Services', 'Interfaces', 'Endpoints'],
  ```

- [x] 2.9 Ensure configuration layer tests pass
  - Run ONLY the 4-6 tests written in 2.1
  - Verify all configuration arrays are properly exported

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Endpoint dropdown options are available
- Grid configuration allows CRUD operations on Endpoints
- Tab navigation includes Endpoints in Application Architecture section


### Task Group 3: Palette and Relationship Layer

#### Task 3.0: Palette Data and Advanced Add Relationships
**Dependencies:** Task Group 2
**Files:** `frontend/src/utils/paletteData.ts`, `frontend/src/utils/advancedAddRelationships.ts`, `frontend/src/utils/idGenerator.ts`

- [x] 3.1 Write 4-6 focused tests for palette/relationship layer
  - Test getEntityTypeConstant returns ENTITY_TYPES.ENDPOINT for 'endpoints'
  - Test getPaletteSections includes endpoints section
  - Test EXPANDABLE_RELATIONSHIPS[INTERFACE] includes ENDPOINT child relationship
  - Test getExpandableRelationships(INTERFACE) returns ENDPOINT with actsAsContainment: true
  - Test getEntityPrefix returns 'ep' for 'endpoints'
  - Test generateEntityId('endpoints') produces 'ep-' prefixed ID

- [x] 3.2 Update getEntityTypeConstant in paletteData.ts
  ```typescript
  endpoints: ENTITY_TYPES.ENDPOINT,
  ```

- [x] 3.3 Add endpoints section to getPaletteSections in paletteData.ts
  - Add after interfaces section:
  ```typescript
  {
    id: 'endpoints',
    label: 'Endpoints',
    items: metaModel.entities.endpoints || [],
    type: 'entity' as const,
  },
  ```

- [x] 3.4 Add ENDPOINT child relationship to INTERFACE in advancedAddRelationships.ts
  ```typescript
  [ENTITY_TYPES.INTERFACE]: [
    // Existing LogicalDataEntity relationship...
    {
      targetEntityType: ENTITY_TYPES.ENDPOINT,
      relationshipKind: 'PARENT_CHILD',
      direction: 'CHILD',
      relationshipTableName: 'endpoints',
      foreignKeyField: 'interface_id',
      displayLabel: 'Endpoints',
      actsAsContainment: true,
    },
  ],
  ```

- [x] 3.5 Add 'ep' prefix for endpoints in idGenerator.ts
  ```typescript
  endpoints: 'ep',
  ```

- [x] 3.6 Ensure palette/relationship layer tests pass
  - Run ONLY the 4-6 tests written in 3.1
  - Verify palette includes Endpoints section
  - Verify Interface can expand to Endpoints in Advanced Add

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Endpoints appear in palette after Interfaces
- Interface -> Endpoint relationship is configured for Advanced Add
- Endpoint IDs use 'ep-' prefix


### Task Group 4: Context and State Layer

#### Task 4.0: ArchitectureContext Endpoint Support
**Dependencies:** Task Group 3
**Files:** `frontend/src/contexts/ArchitectureContext.tsx`

- [x] 4.1 Write 2-4 focused tests for context layer
  - Test LOAD_MODEL initializes endpoints array from payload
  - Test LOAD_MODEL defaults endpoints to empty array if missing
  - Test ADD_ENTITY works for 'endpoints' entityType
  - Test DELETE_ENTITY cascades for endpoints (deletes endpoint when Interface deleted)

- [x] 4.2 Update LOAD_MODEL action in ArchitectureContext.tsx
  - Ensure endpoints array is initialized when loading model
  - Handle missing endpoints array for backward compatibility
  ```typescript
  endpoints: action.payload.metaModel.entities.endpoints || [],
  ```

- [x] 4.3 Add cascade delete for endpoints when Interface is deleted
  - In DELETE_ENTITY handler, when entityType is 'interfaces':
  - Delete all endpoints where interface_id matches deleted interface
  ```typescript
  // Filter out endpoints that belong to the deleted interface
  const filteredEndpoints = state.model.metaModel.entities.endpoints.filter(
    ep => ep.interface_id !== action.id
  );
  ```

- [x] 4.4 Ensure context layer tests pass
  - Run ONLY the 2-4 tests written in 4.1
  - Verify endpoints are properly managed in state

**Acceptance Criteria:**
- The 2-4 tests written in 4.1 pass
- Endpoints are loaded and persisted correctly
- Deleting an Interface cascades to delete its Endpoints
- Entity operations (add/update/delete) work for endpoints


### Task Group 5: ERD Utilities and Interface Contract Rendering

#### Task 5.0: Interface Contract Sizing and Formatting
**Dependencies:** Task Group 4
**Files:** `frontend/src/utils/erdUtils.ts`

- [x] 5.1 Write 4-6 focused tests for Interface contract utilities
  - Test formatEndpointRow produces correct format: "[verb] path (direction, status)"
  - Test calculateInterfaceContractSize calculates correct height for endpoints + entities
  - Test getEndpointsForInterface returns endpoints filtered by interface_id
  - Test getLogicalEntitiesForInterface returns entities via interface_logical_entities
  - Test supportsContractRendering returns true for INTERFACE entity type

- [x] 5.2 Add ERDEndpoint interface
  ```typescript
  export interface ERDEndpoint {
    id: string;
    name: string;
    operation_verb?: string;
    path_or_address: string;
    direction: string;
    lifecycle_status: string;
  }
  ```

- [x] 5.3 Add formatEndpointRow function
  ```typescript
  export function formatEndpointRow(endpoint: ERDEndpoint): string {
    const verb = endpoint.operation_verb ? `[${endpoint.operation_verb}] ` : '';
    const dirStatus = `(${endpoint.direction.toLowerCase()}, ${endpoint.lifecycle_status.toLowerCase()})`;
    return `${verb}${endpoint.path_or_address} ${dirStatus}`;
  }
  ```

- [x] 5.4 Add getEndpointsForInterface function
  ```typescript
  export function getEndpointsForInterface(
    metaModel: MetaModel,
    interfaceId: string
  ): ERDEndpoint[] {
    return metaModel.entities.endpoints
      .filter(ep => ep.interface_id === interfaceId)
      .map(ep => ({
        id: ep.id,
        name: ep.name,
        operation_verb: ep.operation_verb,
        path_or_address: ep.path_or_address,
        direction: ep.direction,
        lifecycle_status: ep.lifecycle_status,
      }));
  }
  ```

- [x] 5.5 Add getLogicalEntitiesForInterface function
  ```typescript
  export function getLogicalEntitiesForInterface(
    metaModel: MetaModel,
    interfaceId: string
  ): ERDAttribute[] {
    const entityIds = metaModel.relationships.interface_logical_entities
      .filter(rel => rel.interface_id === interfaceId)
      .map(rel => rel.logical_entity_id);

    return metaModel.entities.logical_data_entities
      .filter(entity => entityIds.includes(entity.id))
      .map(entity => ({
        id: entity.id,
        name: entity.name,
      }));
  }
  ```

- [x] 5.6 Add calculateInterfaceContractSize function
  ```typescript
  export const INTERFACE_CONTRACT_HEADER_HEIGHT = 30;
  export const INTERFACE_CONTRACT_SECTION_HEADER_HEIGHT = 20;
  export const INTERFACE_CONTRACT_ROW_HEIGHT = 18;
  export const INTERFACE_CONTRACT_MIN_WIDTH = 200;
  export const INTERFACE_CONTRACT_PADDING = 10;

  export function calculateInterfaceContractSize(
    interfaceName: string,
    endpoints: ERDEndpoint[],
    entities: Array<{ name: string }>,
    spacingPreset: SpacingPreset = 'normal'
  ): { width: number; height: number } {
    // Calculate width based on longest text
    const headerFontSize = 12;
    const rowFontSize = 11;

    let maxWidth = measureTextWidth(interfaceName, headerFontSize, 'bold');

    // Measure endpoint rows
    for (const ep of endpoints) {
      const rowText = formatEndpointRow(ep);
      const rowWidth = measureTextWidth(rowText, rowFontSize, 'normal');
      maxWidth = Math.max(maxWidth, rowWidth);
    }

    // Measure entity names
    for (const entity of entities) {
      const entityWidth = measureTextWidth(entity.name, rowFontSize, 'normal');
      maxWidth = Math.max(maxWidth, entityWidth);
    }

    const width = Math.max(INTERFACE_CONTRACT_MIN_WIDTH, Math.ceil(maxWidth + 2 * INTERFACE_CONTRACT_PADDING));

    // Calculate height
    let height = INTERFACE_CONTRACT_HEADER_HEIGHT;

    if (endpoints.length > 0) {
      height += INTERFACE_CONTRACT_SECTION_HEADER_HEIGHT; // "Endpoints" label
      height += endpoints.length * INTERFACE_CONTRACT_ROW_HEIGHT;
    }

    if (entities.length > 0) {
      height += INTERFACE_CONTRACT_SECTION_HEADER_HEIGHT; // "Entities" label
      height += entities.length * INTERFACE_CONTRACT_ROW_HEIGHT;
    }

    height += INTERFACE_CONTRACT_PADDING;

    return { width, height };
  }
  ```

- [x] 5.7 Add supportsContractRendering function
  ```typescript
  export function supportsContractRendering(entityType: string): boolean {
    return entityType === ENTITY_TYPES.INTERFACE;
  }
  ```

- [x] 5.8 Ensure ERD utility tests pass
  - Run ONLY the 4-6 tests written in 5.1
  - Verify contract sizing calculates correctly

**Acceptance Criteria:**
- The 4-6 tests written in 5.1 pass
- Endpoint rows format correctly as "[verb] path (direction, status)"
- Interface contract size includes header + endpoints section + entities section
- Utility functions properly query endpoints and entities for an interface


### Task Group 6: Canvas Rendering and Advanced Add Integration

#### Task 6.0: Interface Contract Rendering on Canvas
**Dependencies:** Task Group 5
**Files:** `frontend/src/components/DiagramsView/Canvas.tsx`, `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`, `frontend/src/components/DiagramsView/PalettePanel.tsx`

- [x] 6.1 Write 4-6 focused tests for canvas/UI layer
  - Test Interface with render_style='contract' renders header section
  - Test Interface contract renders endpoints section with formatted rows
  - Test Interface contract renders entities section with ER-style boxes
  - Test PalettePanel skips ENDPOINT entity type for standalone node creation
  - Test AdvancedAddDialog findRelatedEntities handles ENDPOINT as INTERFACE child

- [x] 6.2 Update Canvas.tsx to support Interface contract rendering
  - Add 'contract' to NodeRenderStyle type (or reuse 'erd')
  - Add renderInterfaceContract function:
  ```typescript
  function renderInterfaceContract(
    node: DiagramNode,
    entity: Interface,
    metaModel: MetaModel,
    isSelected: boolean
  ): JSX.Element {
    const endpoints = getEndpointsForInterface(metaModel, entity.id);
    const entities = getLogicalEntitiesForInterface(metaModel, entity.id);

    // Render header with interface name
    // Render "Endpoints" section header + endpoint rows
    // Render "Entities" section header + entity name rows
  }
  ```

- [x] 6.3 Update shouldRenderAsContract helper in Canvas.tsx
  ```typescript
  function shouldRenderAsContract(node: DiagramNode): boolean {
    return (
      node.render_style === 'contract' &&
      node.entity_type === ENTITY_TYPES.INTERFACE
    );
  }
  ```

- [x] 6.4 Update PalettePanel.tsx to skip ENDPOINT for standalone nodes
  - In handleAddToDiagram or node creation logic:
  ```typescript
  // Skip ENDPOINT - endpoints render inside Interface contracts, not as standalone nodes
  if (entityType === ENTITY_TYPES.ENDPOINT) {
    console.warn('Endpoints cannot be added as standalone nodes. Add via Interface.');
    return;
  }
  ```

- [x] 6.5 Update AdvancedAddDialog.tsx findRelatedEntities for ENDPOINT
  - Add case for ENDPOINT as child of INTERFACE:
  ```typescript
  case ENTITY_TYPES.ENDPOINT:
    return metaModel.entities.endpoints
      .filter((ep) => ep.interface_id === rootEntityId)
      .map((ep) => ({ id: ep.id, name: ep.name }));
  ```

- [x] 6.6 Update AdvancedAddDialog.tsx getEntityTypeDisplayName
  ```typescript
  [ENTITY_TYPES.ENDPOINT]: 'Endpoint',
  ```

- [x] 6.7 Ensure canvas/UI layer tests pass
  - Run ONLY the 4-6 tests written in 6.1
  - Verify Interface contract renders correctly

**Acceptance Criteria:**
- The 4-6 tests written in 6.1 pass
- Interface nodes with render_style='contract' show multi-section layout
- Endpoints render as text rows within Interface contract
- Entities render as ER-style boxes within Interface contract
- Endpoints cannot be added as standalone diagram nodes
- Advanced Add shows Endpoints as children of Interfaces


### Task Group 7: RHS Context Menu and Grid Enhancement

#### Task 7.0: Grid Row Context Menu for Interface
**Dependencies:** Task Group 6
**Files:** `frontend/src/components/Grid/Grid.tsx`, `frontend/src/components/Grid/GridRowContextMenu.tsx` (new)

- [x] 7.1 Write 2-4 focused tests for RHS context menu
  - Test right-click on Interface row shows context menu
  - Test context menu includes "Add endpoints and entities/attributes" option
  - Test clicking menu option opens AdvancedAddDialog for Interface
  - Test context menu does not appear for non-Interface entity types

- [x] 7.2 Create GridRowContextMenu.tsx component
  ```typescript
  interface GridRowContextMenuProps {
    isOpen: boolean;
    position: { x: number; y: number };
    entityType: EntityType;
    entityId: string;
    entityName: string;
    onClose: () => void;
    onAddEndpointsAndEntities: () => void;
  }

  export function GridRowContextMenu({...}: GridRowContextMenuProps) {
    if (!isOpen) return null;

    // Only show for interfaces
    if (entityType !== 'interfaces') return null;

    return ReactDOM.createPortal(
      <div className={styles.contextMenu} style={{ left: position.x, top: position.y }}>
        <button onClick={onAddEndpointsAndEntities}>
          Add endpoints and entities/attributes
        </button>
      </div>,
      document.body
    );
  }
  ```

- [x] 7.3 Add context menu state to Grid.tsx
  ```typescript
  const [contextMenuState, setContextMenuState] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    entityId: string | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, entityId: null });
  ```

- [x] 7.4 Add onContextMenu handler to Grid.tsx rows
  ```typescript
  const handleRowContextMenu = (e: React.MouseEvent, entityId: string) => {
    e.preventDefault();
    if (entityType === 'interfaces') {
      setContextMenuState({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        entityId,
      });
    }
  };
  ```

- [x] 7.5 Integrate AdvancedAddDialog into Grid.tsx
  - Add state for dialog visibility
  - Add handler to open dialog with selected Interface
  - Render GridRowContextMenu and AdvancedAddDialog conditionally

- [x] 7.6 Add GridRowContextMenu.module.css styles

- [x] 7.7 Ensure RHS context menu tests pass
  - Run ONLY the 2-4 tests written in 7.1
  - Verify context menu appears and functions correctly

**Acceptance Criteria:**
- The 2-4 tests written in 7.1 pass
- Right-click on Interface row shows context menu
- "Add endpoints and entities/attributes" option opens Advanced Add dialog
- Dialog allows selecting Endpoints and Logical Entities to add
- Context menu only appears for Interface entity type


### Task Group 8: Test Review and Gap Analysis

#### Task 8.0: Review Tests and Fill Critical Gaps
**Dependencies:** Task Groups 1-7

- [x] 8.1 Review existing tests from Task Groups 1-7
  - Review the 4-6 tests from Task 1.1 (type definitions)
  - Review the 4-6 tests from Task 2.1 (configuration)
  - Review the 4-6 tests from Task 3.1 (palette/relationships)
  - Review the 2-4 tests from Task 4.1 (context)
  - Review the 4-6 tests from Task 5.1 (ERD utilities)
  - Review the 4-6 tests from Task 6.1 (canvas/UI)
  - Review the 2-4 tests from Task 7.1 (RHS context menu)
  - Total existing tests: approximately 26-38 tests

- [x] 8.2 Analyze test coverage gaps for THIS feature only
  - Identify critical user workflows lacking coverage
  - Focus ONLY on Endpoint entity and Interface contract rendering features
  - Prioritize end-to-end workflows:
    1. Create Interface -> Add Endpoints via grid -> View contract on canvas
    2. Advanced Add: Interface with Endpoints + Logical Entities
    3. Delete Interface -> Cascade delete Endpoints
  - Do NOT assess entire application test coverage

- [x] 8.3 Write up to 10 additional strategic tests maximum
  - Integration test: Load model with endpoints, verify state
  - E2E test: Create endpoint via grid, verify in state
  - E2E test: Interface contract renders with endpoints
  - E2E test: Interface contract renders with entities
  - E2E test: RHS context menu -> Advanced Add flow
  - Integration test: Cascade delete endpoints when interface deleted
  - Do NOT write exhaustive coverage tests

- [x] 8.4 Run feature-specific tests only
  - Run ONLY tests related to Endpoint entity and Interface contract rendering
  - Expected total: approximately 36-48 tests maximum
  - Do NOT run the entire application test suite
  - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 36-48 tests total)
- Critical user workflows for this feature are covered
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements


## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Definitions Layer** - Foundation types in model.ts
2. **Task Group 2: Configuration Layer** - defaults.ts and gridConfigs.ts
3. **Task Group 3: Palette/Relationship Layer** - paletteData.ts, advancedAddRelationships.ts, idGenerator.ts
4. **Task Group 4: Context/State Layer** - ArchitectureContext.tsx
5. **Task Group 5: ERD Utilities Layer** - erdUtils.ts for Interface contract sizing
6. **Task Group 6: Canvas/UI Layer** - Canvas.tsx, AdvancedAddDialog.tsx, PalettePanel.tsx
7. **Task Group 7: RHS Context Menu Layer** - Grid.tsx, GridRowContextMenu.tsx
8. **Task Group 8: Test Review** - Gap analysis and strategic test additions


## File Change Summary

| File | Changes |
|------|---------|
| `frontend/src/types/model.ts` | Add Endpoint interface, enums, ENTITY_TYPES.ENDPOINT, update MetaModelEntities |
| `frontend/src/config/defaults.ts` | Add endpoint option arrays, entity color, update emptyModel |
| `frontend/src/config/gridConfigs.ts` | Add endpoints grid config, tab mapping, domain groupings |
| `frontend/src/utils/paletteData.ts` | Add Endpoints section to palette, update getEntityTypeConstant |
| `frontend/src/utils/advancedAddRelationships.ts` | Add ENDPOINT to INTERFACE relationships |
| `frontend/src/utils/erdUtils.ts` | Add Interface contract sizing/formatting functions |
| `frontend/src/utils/idGenerator.ts` | Add 'ep' prefix for Endpoint IDs |
| `frontend/src/contexts/ArchitectureContext.tsx` | Initialize endpoints in LOAD_MODEL, cascade delete |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Add Interface contract rendering |
| `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` | Handle ENDPOINT in findRelatedEntities |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Skip standalone Endpoint nodes |
| `frontend/src/components/Grid/Grid.tsx` | Add row context menu handling |
| `frontend/src/components/Grid/GridRowContextMenu.tsx` | New component for row context menu |


## Key Design Decisions

1. **Endpoints are text rows, NOT standalone nodes**: Endpoints render inside Interface contract boxes as formatted text rows. They cannot be dragged to the canvas as independent nodes.

2. **Interface contract style**: Similar to ERD rendering for Logical Data Entities, Interfaces can have a 'contract' render style showing:
   - Header: Interface name (bold, centered)
   - Endpoints section: "[verb] path (direction, status)" rows
   - Entities section: ER-style entity name boxes

3. **Parent-child containment**: Interface -> Endpoint uses actsAsContainment: true, meaning Advanced Add will nest Endpoints within Interface nodes.

4. **Cascade delete**: Deleting an Interface automatically deletes all its Endpoints.

5. **RHS context menu**: Right-clicking an Interface row in the grid provides quick access to add Endpoints and Logical Entities via Advanced Add dialog.
