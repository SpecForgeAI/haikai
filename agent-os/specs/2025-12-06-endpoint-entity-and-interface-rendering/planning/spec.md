# Add Endpoint Meta-Model Entity + Interface Contract Rendering

## Overview

This specification introduces a new meta-model entity **Endpoint** representing operations/endpoints of an Interface (REST paths, message queues/topics, file transfer locations, etc.). Endpoints are direct children of Interface entities.

The specification also enhances Interface diagram rendering to display a multi-section layout containing:
1. Interface header (name)
2. Endpoint rows (text format)
3. Logical Entity ER-style boxes (with attributes)

---

## Current State Analysis

### Existing Entity Hierarchy

**File:** `frontend/src/types/model.ts`

Current Application Architecture hierarchy:
```
Application (lines 154-164)
  └── ApplicationComponent (lines 166-175) via application_id FK
  └── Service (lines 177-188) via application_id or app_component_id FK
        └── Interface (lines 190-205) via service_id FK
              └── (NO CHILDREN CURRENTLY)
```

### Existing Interface Entity

**File:** `frontend/src/types/model.ts` (lines 190-205)

```typescript
export interface Interface {
  id: string;
  name: string;
  description: string;
  service_id: string;  // FK to services
  interface_type: InterfaceType;
  spec_link?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
}
```

### Existing Palette Structure

**File:** `frontend/src/utils/paletteData.ts` (lines 52-113)

Current entity sections include:
- Applications
- App Components
- Services
- Interfaces
- Logical Entities
- Physical Entities

Endpoint needs to be inserted after Interfaces.

### Existing Parent-Child Relationships

**File:** `frontend/src/utils/advancedAddRelationships.ts` (lines 73-320)

Current INTERFACE expandable relationships (lines 309-319):
```typescript
INTERFACE: [
  {
    targetEntityType: 'LOGICAL_DATA_ENTITY',
    relationshipKind: 'ASSOCIATION',
    direction: 'ASSOCIATION',
    relationshipTableName: 'interface_logical_entities',
    foreignKeyField: 'interface_id',
    displayLabel: 'Logical Entities',
    actsAsContainment: true,
  },
],
```

---

## Specification

### 1. New Entity Type: Endpoint

#### 1.1 TypeScript Interface Definition

**File to modify:** `frontend/src/types/model.ts`

Add after Interface definition (~line 205):

```typescript
// Endpoint type enums
export type EndpointType =
  | 'HTTP_REST'
  | 'MESSAGE_QUEUE'
  | 'MESSAGE_TOPIC'
  | 'FILE_TRANSFER'
  | 'OTHER';

export type EndpointProtocol =
  | 'HTTP'
  | 'HTTPS'
  | 'AMQP'
  | 'JMS'
  | 'KAFKA'
  | 'FTP'
  | 'SFTP'
  | 'FILE'
  | 'OTHER';

export type EndpointDirection =
  | 'INBOUND'
  | 'OUTBOUND'
  | 'BIDIRECTIONAL';

export type EndpointLifecycleStatus =
  | 'PLANNED'
  | 'ACTIVE'
  | 'DEPRECATED'
  | 'RETIRED';

export interface Endpoint {
  id: string;
  name: string;
  description: string;

  // Foreign key to parent Interface
  interface_id: string;

  // Endpoint classification
  endpoint_type: EndpointType;

  // Path or address (e.g., "/customers/{id}", "CustomerEventsQueue")
  path_or_address: string;

  // Protocol used
  protocol: EndpointProtocol;

  // Operation verb (GET, POST, PUBLISH, CONSUME, SEND, RECEIVE, etc.)
  operation_verb: string;

  // Direction of data flow
  direction: EndpointDirection;

  // Lifecycle status
  lifecycle_status: EndpointLifecycleStatus;

  // Version (optional)
  version?: string;

  // Standard fields
  tags: string;
  valid_from?: string;
  valid_to?: string;
}
```

#### 1.2 Add to ENTITY_TYPES Constant

**File to modify:** `frontend/src/types/model.ts` (lines 403-420)

Add `ENDPOINT: 'ENDPOINT'` after INTERFACE:

```typescript
export const ENTITY_TYPES = {
  APPLICATION: 'APPLICATION',
  APP_COMPONENT: 'APP_COMPONENT',
  SERVICE: 'SERVICE',
  INTERFACE: 'INTERFACE',
  ENDPOINT: 'ENDPOINT',  // NEW
  // ... rest of types
} as const;
```

#### 1.3 Add to MetaModelEntities Interface

**File to modify:** `frontend/src/types/model.ts` (lines 755-769)

Add `endpoints: Endpoint[]` after `interfaces`:

```typescript
export interface MetaModelEntities {
  // ... existing fields
  interfaces: Interface[];
  endpoints: Endpoint[];  // NEW
  // ... rest of fields
}
```

---

### 2. Configuration Updates

#### 2.1 Grid Configuration

**File to modify:** `frontend/src/config/gridConfigs.ts`

Add after interfaces configuration (~line 87):

```typescript
endpoints: [
  { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
  { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 150 },
  { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 150 },
  { field: 'interface_id', displayName: 'Interface', cellType: 'fk_typeahead', required: true, width: 150, fkTarget: 'interfaces' },
  { field: 'endpoint_type', displayName: 'Type', cellType: 'dropdown', required: true, width: 120, options: endpointTypeOptions },
  { field: 'path_or_address', displayName: 'Path/Address', cellType: 'text', required: false, width: 200 },
  { field: 'protocol', displayName: 'Protocol', cellType: 'dropdown', required: true, width: 100, options: endpointProtocolOptions },
  { field: 'operation_verb', displayName: 'Verb', cellType: 'text', required: false, width: 80 },
  { field: 'direction', displayName: 'Direction', cellType: 'dropdown', required: true, width: 120, options: endpointDirectionOptions },
  { field: 'lifecycle_status', displayName: 'Status', cellType: 'dropdown', required: true, width: 100, options: endpointLifecycleStatusOptions },
  { field: 'version', displayName: 'Version', cellType: 'text', required: false, width: 80 },
  { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 100 },
  { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
  { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
],
```

#### 2.2 Dropdown Options

**File to modify:** `frontend/src/config/defaults.ts`

Add new option arrays:

```typescript
export const endpointTypeOptions: EndpointType[] = [
  'HTTP_REST',
  'MESSAGE_QUEUE',
  'MESSAGE_TOPIC',
  'FILE_TRANSFER',
  'OTHER',
];

export const endpointProtocolOptions: EndpointProtocol[] = [
  'HTTP',
  'HTTPS',
  'AMQP',
  'JMS',
  'KAFKA',
  'FTP',
  'SFTP',
  'FILE',
  'OTHER',
];

export const endpointDirectionOptions: EndpointDirection[] = [
  'INBOUND',
  'OUTBOUND',
  'BIDIRECTIONAL',
];

export const endpointLifecycleStatusOptions: EndpointLifecycleStatus[] = [
  'PLANNED',
  'ACTIVE',
  'DEPRECATED',
  'RETIRED',
];
```

#### 2.3 Entity Colors

**File to modify:** `frontend/src/config/defaults.ts` (lines 391-403)

Add color for Endpoint:

```typescript
export const entityColors: Record<string, EntityColors> = {
  // ... existing colors
  ENDPOINT: { background: '#E0E7FF', border: '#4F46E5' },  // Indigo variant
};
```

#### 2.4 Tab Mapping

**File to modify:** `frontend/src/config/gridConfigs.ts` (lines 236-248)

Add to `tabToEntityType`:

```typescript
export const tabToEntityType: Record<string, string> = {
  // ... existing mappings
  'Endpoints': 'endpoints',
};
```

---

### 3. Palette/Top Bar Update

#### 3.1 Add Endpoint Section to Palette Data

**File to modify:** `frontend/src/utils/paletteData.ts`

Add Endpoint section after Interfaces (~line 85):

```typescript
{
  id: 'endpoints',
  title: 'Endpoints',
  entityType: 'endpoints',
  items: [], // Populated from model
},
```

#### 3.2 Update Entity Type Constants

**File to modify:** `frontend/src/utils/paletteData.ts`

Ensure `getEntityTypeConstant()` handles 'endpoints':

```typescript
case 'endpoints':
  return ENTITY_TYPES.ENDPOINT;
```

---

### 4. Parent-Child Relationship: Interface → Endpoint

#### 4.1 Update EXPANDABLE_RELATIONSHIPS

**File to modify:** `frontend/src/utils/advancedAddRelationships.ts`

Update INTERFACE relationships to include ENDPOINT as child (before LOGICAL_DATA_ENTITY):

```typescript
INTERFACE: [
  {
    targetEntityType: 'ENDPOINT',
    relationshipKind: 'PARENT_CHILD',
    direction: 'CHILD',
    relationshipTableName: 'endpoints',  // Direct FK relationship
    foreignKeyField: 'interface_id',
    displayLabel: 'Endpoints',
    actsAsContainment: true,  // Endpoints render inside Interface
  },
  {
    targetEntityType: 'LOGICAL_DATA_ENTITY',
    relationshipKind: 'ASSOCIATION',
    direction: 'ASSOCIATION',
    relationshipTableName: 'interface_logical_entities',
    foreignKeyField: 'interface_id',
    displayLabel: 'Logical Entities',
    actsAsContainment: true,
  },
],
```

#### 4.2 Add ENDPOINT to Container Types

**File to modify:** `frontend/src/components/DiagramsView/PalettePanel.tsx` (lines 74-82)

Add INTERFACE to CONTAINER_ENTITY_TYPES if not already present (it should be):

```typescript
const CONTAINER_ENTITY_TYPES: Set<string> = new Set([
  ENTITY_TYPES.APPLICATION,
  ENTITY_TYPES.APP_COMPONENT,
  ENTITY_TYPES.SERVICE,
  ENTITY_TYPES.INTERFACE,  // Ensure this is present
  ENTITY_TYPES.BUSINESS_PROCESS,
  ENTITY_TYPES.LOGICAL_DATA_ENTITY,
  ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
]);
```

---

### 5. ArchitectureContext Reducer Updates

**File to modify:** `frontend/src/contexts/ArchitectureContext.tsx`

#### 5.1 Initialize endpoints in LOAD_MODEL

In the LOAD_MODEL case (~line 189-227), ensure endpoints array is initialized:

```typescript
metaModel: {
  entities: {
    // ... existing entities
    endpoints: payload.metaModel?.entities?.endpoints || [],
  },
  // ... relationships
},
```

#### 5.2 Handle ADD_ENTITY for endpoints

The generic ADD_ENTITY handler (lines 330-392) should work automatically since endpoints don't require AP/BP synchronization.

#### 5.3 Handle UPDATE_ENTITY and DELETE_ENTITY

Generic handlers should work; verify endpoints are covered.

---

### 6. Enhanced Interface Rendering

#### 6.1 New Rendering Constants

**File to modify:** `frontend/src/utils/erdUtils.ts`

Add constants for Interface multi-section rendering:

```typescript
// Interface section rendering constants
export const INTERFACE_HEADER_HEIGHT = 30;
export const INTERFACE_ENDPOINT_ROW_HEIGHT = 20;
export const INTERFACE_SECTION_GAP = 10;
export const INTERFACE_MIN_WIDTH = 200;
```

#### 6.2 New Rendering Detection Function

**File to modify:** `frontend/src/utils/erdUtils.ts`

Add function to detect Interface contract rendering:

```typescript
/**
 * Determines if an Interface node should render with contract sections
 * (endpoints and/or logical entities).
 */
export function shouldRenderAsInterfaceContract(
  node: DiagramNode,
  metaModel: MetaModelEntities
): boolean {
  if (node.entity_type !== ENTITY_TYPES.INTERFACE) {
    return false;
  }

  // Check if Interface has endpoints
  const hasEndpoints = metaModel.endpoints.some(
    ep => ep.interface_id === node.entity_id
  );

  // Check if Interface has child nodes (Logical Entities)
  // This would be detected via embedded_attribute_ids or child node lookup
  const hasEmbeddedEntities = node.embedded_attribute_ids &&
    node.embedded_attribute_ids.length > 0;

  return hasEndpoints || hasEmbeddedEntities;
}
```

#### 6.3 Format Endpoint for Display

**File to modify:** `frontend/src/utils/erdUtils.ts`

Add function to format endpoint display:

```typescript
/**
 * Formats an Endpoint for display as a text row.
 * Format: "[verb] [path] ([direction], [status])"
 * Example: "GET /customers/{id} (INBOUND, ACTIVE)"
 */
export function formatEndpoint(endpoint: Endpoint): string {
  const verb = endpoint.operation_verb || '';
  const path = endpoint.path_or_address || '';
  const direction = endpoint.direction || '';
  const status = endpoint.lifecycle_status || '';

  const mainPart = [verb, path].filter(Boolean).join(' ');
  const metaPart = [direction, status].filter(Boolean).join(', ');

  if (metaPart) {
    return `${mainPart} (${metaPart})`;
  }
  return mainPart;
}
```

#### 6.4 Calculate Interface Contract Size

**File to modify:** `frontend/src/utils/erdUtils.ts`

Add function to calculate size for Interface with sections:

```typescript
/**
 * Calculates the size of an Interface node with contract sections.
 */
export function calculateInterfaceContractSize(
  interfaceName: string,
  endpoints: Endpoint[],
  logicalEntities: Array<{ name: string; attributes: Array<{ name: string; data_type?: string }> }>,
  spacingPreset: SpacingPreset
): { width: number; height: number } {
  const padding = getSpacingValues(spacingPreset);

  // Calculate header width
  const headerWidth = measureText(interfaceName, 'bold 12px sans-serif') + padding.horizontal * 2;

  // Calculate endpoint row widths
  let maxEndpointWidth = 0;
  for (const ep of endpoints) {
    const formatted = formatEndpoint(ep);
    const width = measureText(formatted, '11px sans-serif') + padding.horizontal * 2;
    maxEndpointWidth = Math.max(maxEndpointWidth, width);
  }

  // Calculate entity section widths (using existing ERD sizing)
  let maxEntityWidth = 0;
  for (const entity of logicalEntities) {
    const erdSize = calculateERDNodeSize(entity.name, entity.attributes, spacingPreset);
    maxEntityWidth = Math.max(maxEntityWidth, erdSize.width);
  }

  // Final width is max of all sections
  const width = Math.max(
    INTERFACE_MIN_WIDTH,
    headerWidth,
    maxEndpointWidth,
    maxEntityWidth + padding.horizontal * 2
  );

  // Calculate height
  let height = INTERFACE_HEADER_HEIGHT;

  // Endpoints section
  if (endpoints.length > 0) {
    height += endpoints.length * INTERFACE_ENDPOINT_ROW_HEIGHT;
    height += INTERFACE_SECTION_GAP;
  }

  // Entities section
  for (const entity of logicalEntities) {
    const erdSize = calculateERDNodeSize(entity.name, entity.attributes, spacingPreset);
    height += erdSize.height + padding.vertical;
  }

  height += padding.vertical; // Bottom padding

  return { width, height };
}
```

#### 6.5 Canvas Rendering Update

**File to modify:** `frontend/src/components/DiagramsView/Canvas.tsx`

In the node rendering section (~lines 2320-2539), add handling for Interface contract rendering:

```typescript
// After ERD check (line 2492), before default rendering
if (shouldRenderAsInterfaceContract(node, metaModel)) {
  return renderInterfaceContract(node, nodeData, colors);
}
```

Add new rendering function:

```typescript
const renderInterfaceContract = (
  node: DiagramNode,
  nodeData: DiagramNode,
  colors: EntityColors
) => {
  const endpoints = metaModel.endpoints.filter(
    ep => ep.interface_id === node.entity_id
  );

  // Get embedded logical entities (similar to ERD handling)
  const embeddedEntityIds = node.embedded_attribute_ids || [];
  const logicalEntities = embeddedEntityIds
    .map(id => metaModel.logical_data_entities.find(e => e.id === id))
    .filter(Boolean);

  const interfaceName = getEntityLabel(node);

  let currentY = node.pos_y;

  return (
    <g key={node.id}>
      {/* Outer rectangle */}
      <rect
        x={node.pos_x}
        y={node.pos_y}
        width={node.width}
        height={node.height}
        fill={colors.background}
        stroke={isSelected ? '#2563EB' : colors.border}
        strokeWidth={isSelected ? 2 : 1}
      />

      {/* Header section */}
      <text
        x={node.pos_x + node.width / 2}
        y={node.pos_y + INTERFACE_HEADER_HEIGHT / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontWeight="bold"
        fontSize={12}
      >
        {interfaceName}
      </text>

      {/* Header divider */}
      <line
        x1={node.pos_x}
        y1={node.pos_y + INTERFACE_HEADER_HEIGHT}
        x2={node.pos_x + node.width}
        y2={node.pos_y + INTERFACE_HEADER_HEIGHT}
        stroke={colors.border}
      />

      {currentY = node.pos_y + INTERFACE_HEADER_HEIGHT}

      {/* Endpoints section */}
      {endpoints.map((endpoint, index) => {
        const rowY = currentY + index * INTERFACE_ENDPOINT_ROW_HEIGHT;
        return (
          <text
            key={endpoint.id}
            x={node.pos_x + 8}
            y={rowY + INTERFACE_ENDPOINT_ROW_HEIGHT / 2}
            dominantBaseline="middle"
            fontSize={11}
          >
            {formatEndpoint(endpoint)}
          </text>
        );
      })}

      {/* Section divider before entities (if both exist) */}
      {endpoints.length > 0 && logicalEntities.length > 0 && (
        <line
          x1={node.pos_x}
          y1={currentY + endpoints.length * INTERFACE_ENDPOINT_ROW_HEIGHT}
          x2={node.pos_x + node.width}
          y2={currentY + endpoints.length * INTERFACE_ENDPOINT_ROW_HEIGHT}
          stroke={colors.border}
          strokeDasharray="4,2"
        />
      )}

      {/* Logical Entity ER boxes (rendered as nested ERD nodes) */}
      {/* Position calculated based on endpoints section height */}
    </g>
  );
};
```

---

### 7. RHS Context Menu: "Add endpoints and entities/attributes"

#### 7.1 Add Context Menu State to Grid

**File to modify:** `frontend/src/components/Grid/Grid.tsx`

Add context menu handling:

```typescript
// State for row context menu
const [rowContextMenu, setRowContextMenu] = useState<{
  visible: boolean;
  x: number;
  y: number;
  entity: AnyEntity;
} | null>(null);

// Handler for right-click
const handleRowContextMenu = (e: React.MouseEvent, entity: AnyEntity) => {
  e.preventDefault();
  setRowContextMenu({
    visible: true,
    x: e.clientX,
    y: e.clientY,
    entity,
  });
};
```

#### 7.2 Create GridRowContextMenu Component

**New file:** `frontend/src/components/Grid/GridRowContextMenu.tsx`

```typescript
interface GridRowContextMenuProps {
  x: number;
  y: number;
  entity: AnyEntity;
  entityType: string;
  onClose: () => void;
  onAddToDiagram: (entity: AnyEntity) => void;
  onAddWithEndpointsAndEntities?: (interfaceEntity: Interface) => void;
}

export const GridRowContextMenu: React.FC<GridRowContextMenuProps> = ({
  x, y, entity, entityType, onClose,
  onAddToDiagram, onAddWithEndpointsAndEntities
}) => {
  const showEndpointsOption = entityType === 'interfaces';

  return createPortal(
    <div className={styles.menu} style={{ left: x, top: y }}>
      <div className={styles.menuItem} onClick={() => onAddToDiagram(entity)}>
        Add to diagram
      </div>

      {showEndpointsOption && onAddWithEndpointsAndEntities && (
        <div
          className={styles.menuItem}
          onClick={() => onAddWithEndpointsAndEntities(entity as Interface)}
        >
          Add endpoints and entities/attributes
        </div>
      )}
    </div>,
    document.body
  );
};
```

#### 7.3 Implement Add With Endpoints And Entities Handler

**File to modify:** `frontend/src/components/DiagramsView/DiagramsView.tsx` (or appropriate parent)

```typescript
const handleAddInterfaceWithEndpointsAndEntities = useCallback((
  interfaceEntity: Interface
) => {
  if (!selectedDiagramId) return;

  // Get all endpoints for this interface
  const endpoints = model.metaModel.entities.endpoints.filter(
    ep => ep.interface_id === interfaceEntity.id
  );

  // Get all logical entities linked to this interface
  const linkedEntityIds = model.metaModel.relationships.interface_logical_entities
    .filter(rel => rel.interface_id === interfaceEntity.id)
    .map(rel => rel.logical_entity_id);

  const logicalEntities = model.metaModel.entities.logical_data_entities
    .filter(e => linkedEntityIds.includes(e.id));

  // Get attributes for each logical entity
  const entityWithAttributes = logicalEntities.map(entity => ({
    entity,
    attributes: model.metaModel.entities.logical_data_attributes
      .filter(attr => attr.logical_entity_id === entity.id)
  }));

  // Calculate size for Interface contract rendering
  const size = calculateInterfaceContractSize(
    interfaceEntity.name,
    endpoints,
    entityWithAttributes.map(e => ({
      name: e.entity.name,
      attributes: e.attributes
    })),
    spacingPreset
  );

  // Create Interface node with embedded data
  const interfaceNode: DiagramNode = {
    id: generateId(),
    entity_type: ENTITY_TYPES.INTERFACE,
    entity_id: interfaceEntity.id,
    pos_x: viewportCenter.x - size.width / 2,
    pos_y: viewportCenter.y - size.height / 2,
    width: size.width,
    height: size.height,
    parent_node_id: null,
    embedded_attribute_ids: logicalEntities.map(e => e.id),
    render_style: 'contract',  // New render style for Interface contracts
    // ... other styling
  };

  dispatch({
    type: 'ADD_DIAGRAM_NODE',
    diagramId: selectedDiagramId,
    node: interfaceNode,
  });
}, [model, selectedDiagramId, spacingPreset, viewportCenter, dispatch]);
```

---

### 8. Advanced Add Integration

#### 8.1 Update findRelatedEntities for ENDPOINT

**File to modify:** `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`

In `findRelatedEntities()` function (~lines 183-432), add handling for ENDPOINT:

```typescript
case 'ENDPOINT': {
  // Endpoints are children of interfaces via interface_id FK
  if (direction === 'CHILD') {
    const endpoints = metaModel.entities.endpoints.filter(
      ep => ep.interface_id === parentEntityId
    );
    return endpoints.map(ep => ({
      entity: ep,
      entityType: 'ENDPOINT',
    }));
  }
  break;
}
```

#### 8.2 Update Tree Building to Include Endpoints

The existing tree building logic should work automatically once EXPANDABLE_RELATIONSHIPS is updated, since it iterates through relationships and calls `findRelatedEntities()`.

#### 8.3 Endpoint Rendering in Advanced Add Result

When the Advanced Add dialog creates nodes, Endpoints should NOT create separate diagram nodes. Instead, they should be tracked as embedded children of the Interface node.

**File to modify:** `frontend/src/components/DiagramsView/PalettePanel.tsx`

In `handleAdvancedAddConfirm()` or equivalent, when processing the selection tree:

```typescript
// Skip creating standalone nodes for Endpoints
// They are rendered as text rows inside their parent Interface
if (treeNode.entityType === 'ENDPOINT') {
  // Add to parent Interface's embedded endpoint list instead
  continue;
}
```

---

### 9. DiagramNode Extensions

#### 9.1 Add Embedded Endpoint IDs

**File to modify:** `frontend/src/types/model.ts` (DiagramNode interface)

Add field to track embedded endpoints:

```typescript
export interface DiagramNode {
  // ... existing fields

  // Embedded child IDs for contract-style rendering
  embedded_attribute_ids?: string[];  // For Logical Entity attributes
  embedded_endpoint_ids?: string[];   // NEW: For Interface endpoints

  // Render style indicator
  render_style?: 'standard' | 'erd' | 'contract';  // Add 'contract'
}
```

---

### 10. Files Summary

| File | Changes |
|------|---------|
| `frontend/src/types/model.ts` | Add Endpoint interface, enums, ENTITY_TYPES, MetaModelEntities |
| `frontend/src/config/defaults.ts` | Add endpoint option arrays, entity color |
| `frontend/src/config/gridConfigs.ts` | Add endpoints grid config, tab mapping |
| `frontend/src/utils/paletteData.ts` | Add Endpoints section to palette |
| `frontend/src/utils/advancedAddRelationships.ts` | Add ENDPOINT to INTERFACE relationships |
| `frontend/src/utils/erdUtils.ts` | Add Interface contract sizing/formatting functions |
| `frontend/src/contexts/ArchitectureContext.tsx` | Initialize endpoints in LOAD_MODEL |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Add Interface contract rendering |
| `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` | Handle ENDPOINT in findRelatedEntities |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Skip standalone Endpoint nodes |
| `frontend/src/components/Grid/Grid.tsx` | Add row context menu handling |
| `frontend/src/components/Grid/GridRowContextMenu.tsx` | New component for row context menu |

---

### 11. Acceptance Criteria

1. **Meta-model ribbon** displays `[Endpoint]` in the Application Architecture section, after Interface.

2. **RHS Tables** allow creating/editing Endpoints with all specified fields:
   - id, name, description
   - interface_id (FK typeahead)
   - endpoint_type, protocol, operation_verb, direction, lifecycle_status
   - version, tags, valid_from, valid_to

3. **Right-click on Interface row** shows "Add endpoints and entities/attributes" menu item.
   - Clicking adds Interface to diagram with:
     - Interface header
     - All Endpoints as text rows
     - All linked Logical Entities as ER-style boxes

4. **Advanced Add** dialog:
   - Shows Endpoints as children of Interfaces
   - Selecting Interface + Endpoints + Logical Entities produces contract-style rendering
   - Endpoints do NOT create standalone diagram nodes

5. **Diagram rendering**:
   - Interface with endpoints/entities shows multi-section layout
   - Endpoint rows format: `[verb] [path] ([direction], [status])`
   - Entity section shows ER-style boxes below endpoints
   - Box resizes to fit all content

6. **Parent-child containment**:
   - Endpoints follow Interface in containment hierarchy
   - Wrapped correctly in Advanced Add selections

7. **No standalone Endpoint boxes**:
   - Endpoints only render as text rows inside Interface contracts

---

### 12. Implementation Notes

1. **Endpoint Display Format**: Use `formatEndpoint()` utility for consistent formatting across all views.

2. **Size Calculation**: `calculateInterfaceContractSize()` must account for:
   - Header height
   - Number of endpoints × row height
   - Section gaps
   - Nested entity ERD boxes

3. **Temporal Filtering**: Endpoints respect `valid_from`/`valid_to` fields for time-based diagram filtering.

4. **Z-Index Handling**: Interface contract nodes follow standard z-index rules; internal sections don't have separate z-indices.

5. **Selection Behavior**: Clicking inside an Interface contract selects the entire Interface node, not individual endpoints/entities.

6. **ID Generation**: Use prefix `ep-` for Endpoint IDs (add to `idGenerator.ts`).
