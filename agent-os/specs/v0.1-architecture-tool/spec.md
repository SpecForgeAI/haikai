# Architecture Capture & Diagram Tool v0.1 Specification

## 1. Overview

### 1.1 Project Goal

Build a React/TypeScript single-page web application that enables architects to capture enterprise architecture meta-models through grid-based CRUD interfaces, persist data via JSON file load/save, and render read-only diagrams from the stored model.

### 1.2 Scope

**In Scope (v0.1):**
- Meta-model CRUD for 10 entity types and 6 relationship types
- JSON file load/save with validation
- Tabbed grid interface for data entry
- Read-only diagram rendering with pan/zoom
- Node containment hierarchies
- Polyline edge rendering with waypoints

**Out of Scope (v0.1):**
- Entity palette for drag-and-drop diagram editing
- Properties panel for node/edge editing
- Interactive diagram editing (move, resize, connect)
- Backend persistence
- Multi-user support
- Undo/redo
- Search and filter

### 1.3 Success Criteria

- Users can load an existing JSON architecture file and view it in grids and diagrams
- Users can create/edit/delete meta-model entities through grid interfaces
- Users can save modified architecture to JSON file without data loss
- Diagrams render with correct containment hierarchies and edge routing
- Invalid data (missing FK references, malformed JSON) is rejected with clear error messages

---

## 2. User Interface

### 2.1 Application Layout

```
+------------------------------------------------------------------+
|  [Logo/Title]     [Meta-model | Diagrams]    [Load JSON] [Save]  |
+------------------------------------------------------------------+
|                                                                  |
|                      Main Content Area                           |
|                                                                  |
|    (Either Meta-model View with tabs/grids                       |
|     OR Diagrams View with canvas)                                |
|                                                                  |
+------------------------------------------------------------------+
```

### 2.2 Top Navigation Bar

**Components:**
- **Logo/Title**: "Architecture Tool" (left-aligned)
- **View Toggle**: Two buttons - "Meta-model" and "Diagrams" (center)
  - Active view highlighted with distinct styling
  - Clicking switches the main content area
- **Load JSON Button**: Opens file picker dialog
- **Save JSON Button**: Downloads current model as JSON file
- **File Name Display**: Shows name of currently loaded file (or "Untitled" if new)

**Behavior:**
- Top bar is always visible (fixed position)
- Height: 60px
- Background: White with subtle bottom border

### 2.3 Meta-model View

**Layout:**
- Tab bar at top showing all entity types
- Grid component fills remaining vertical space
- Single grid visible at a time (based on selected tab)

**Tabs (in order):**
1. Users
2. Processes
3. Applications
4. App Components
5. Services
6. Application Points
7. Logical Entities
8. Physical Entities
9. Attributes
10. Relationships

### 2.4 Diagrams View

**Layout:**
- Diagram selector dropdown at top (if multiple diagrams exist)
- Canvas fills remaining space
- Zoom controls overlay (bottom-right corner)

**Diagram Selector:**
- Dropdown showing diagram names
- "No diagrams defined" message if empty
- Selecting diagram renders it on canvas

---

## 3. Data Model

### 3.1 Architecture Model Root

```typescript
interface ArchitectureModel {
  // Meta-model entities
  business_users: BusinessUser[];
  business_processes: BusinessProcess[];
  applications: Application[];
  application_components: ApplicationComponent[];
  services: Service[];
  application_points: ApplicationPoint[];
  logical_data_entities: LogicalDataEntity[];
  physical_data_entities: PhysicalDataEntity[];
  attributes: Attribute[];
  relationships: Relationship[];

  // Diagram structures
  diagrams: Diagram[];
  diagram_nodes: DiagramNode[];
  diagram_edges: DiagramEdge[];
  edge_points: EdgePoint[];
}
```

### 3.2 Business Domain Entities

```typescript
interface BusinessUser {
  id: string;           // Unique identifier (required)
  name: string;         // Display name (required)
  description: string;  // Optional description
  tags: string;         // Comma-separated tags
}

interface BusinessProcess {
  id: string;           // Unique identifier (required)
  name: string;         // Display name (required)
  description: string;  // Optional description
  tags: string;         // Comma-separated tags
}
```

### 3.3 Application Domain Entities

```typescript
interface Application {
  id: string;           // Unique identifier (required)
  name: string;         // Display name (required)
  description: string;  // Optional description
  app_type: string;     // e.g., "Web", "Batch", "API"
  status: string;       // e.g., "Active", "Deprecated", "Planned"
  tags: string;         // Comma-separated tags
}

interface ApplicationComponent {
  id: string;             // Unique identifier (required)
  name: string;           // Display name (required)
  description: string;    // Optional description
  application_id: string; // FK to Application (required)
  tags: string;           // Comma-separated tags
}

interface Service {
  id: string;             // Unique identifier (required)
  name: string;           // Display name (required)
  description: string;    // Optional description
  application_id: string; // FK to Application (required)
  service_type: string;   // e.g., "REST", "SOAP", "gRPC"
  tags: string;           // Comma-separated tags
}

interface ApplicationPoint {
  id: string;             // Unique identifier (required)
  name: string;           // Display name (required)
  description: string;    // Optional description
  application_id: string; // FK to Application (required)
  point_type: string;     // e.g., "UI", "File Drop", "Queue"
  tags: string;           // Comma-separated tags
}
```

### 3.4 Data Domain Entities

```typescript
interface LogicalDataEntity {
  id: string;           // Unique identifier (required)
  name: string;         // Display name (required)
  description: string;  // Optional description
  tags: string;         // Comma-separated tags
}

interface PhysicalDataEntity {
  id: string;                   // Unique identifier (required)
  name: string;                 // Display name (required)
  description: string;          // Optional description
  logical_entity_id: string;    // FK to LogicalDataEntity (required)
  physical_type: string;        // e.g., "Table", "Collection", "File"
  database: string;             // Database/storage location
  tags: string;                 // Comma-separated tags
}

interface Attribute {
  id: string;                   // Unique identifier (required)
  name: string;                 // Display name (required)
  description: string;          // Optional description
  physical_entity_id: string;   // FK to PhysicalDataEntity (required)
  data_type: string;            // e.g., "VARCHAR", "INTEGER", "TIMESTAMP"
  is_primary_key: boolean;      // Primary key indicator
  is_nullable: boolean;         // Nullable indicator
  tags: string;                 // Comma-separated tags
}
```

### 3.5 Relationships

```typescript
type RelationshipType =
  | 'user_uses_process'
  | 'process_uses_application'
  | 'application_owns_component'
  | 'application_exposes_service'
  | 'application_has_point'
  | 'application_stores_data';

interface Relationship {
  id: string;                   // Unique identifier (required)
  relationship_type: RelationshipType; // Type of relationship (required)
  source_entity_id: string;     // FK to source entity (required)
  target_entity_id: string;     // FK to target entity (required)
  description: string;          // Optional description
  tags: string;                 // Comma-separated tags
}
```

**Relationship Type Constraints:**

| Relationship Type | Source Entity Type | Target Entity Type |
|-------------------|--------------------|--------------------|
| user_uses_process | BusinessUser | BusinessProcess |
| process_uses_application | BusinessProcess | Application |
| application_owns_component | Application | ApplicationComponent |
| application_exposes_service | Application | Service |
| application_has_point | Application | ApplicationPoint |
| application_stores_data | Application | PhysicalDataEntity |

### 3.6 Diagram Structures

```typescript
interface Diagram {
  id: string;           // Unique identifier (required)
  name: string;         // Display name (required)
  description: string;  // Optional description
}

interface DiagramNode {
  id: string;           // Unique identifier (required)
  diagram_id: string;   // FK to Diagram (required)
  entity_type: string;  // Type of referenced entity (required)
  entity_id: string;    // FK to actual entity (required)
  x: number;            // X position in pixels (required)
  y: number;            // Y position in pixels (required)
  width: number;        // Width in pixels (required)
  height: number;       // Height in pixels (required)
  parent_node_id: string | null; // FK to parent DiagramNode (optional)
}

interface DiagramEdge {
  id: string;                   // Unique identifier (required)
  diagram_id: string;           // FK to Diagram (required)
  relationship_id: string;      // FK to Relationship (required)
  source_node_id: string;       // FK to source DiagramNode (required)
  target_node_id: string;       // FK to target DiagramNode (required)
}

interface EdgePoint {
  id: string;           // Unique identifier (required)
  edge_id: string;      // FK to DiagramEdge (required)
  sequence: number;     // Order in polyline (required, 0-indexed)
  x: number;            // X position in pixels (required)
  y: number;            // Y position in pixels (required)
}
```

---

## 4. Meta-model View Specification

### 4.1 Grid Component

**General Behavior:**
- Tabular display with fixed column layout
- Inline cell editing on click/double-click
- Row operations: Add new row, Delete selected row
- Column headers are not sortable (v0.1)
- Column widths are fixed (not resizable in v0.1)

**Grid Layout:**
```
+------------------------------------------------------------------+
|  [+ Add Row]                                        [Delete Row]  |
+------------------------------------------------------------------+
|  Column1   |  Column2   |  Column3   |  Column4   |  Column5     |
+------------------------------------------------------------------+
|  value     |  value     |  value     |  value     |  value       |
|  value     |  value     |  value     |  value     |  value       |
|  value     |  value     |  value     |  value     |  value       |
+------------------------------------------------------------------+
```

**Row Selection:**
- Click row to select (single selection)
- Selected row highlighted with background color
- Delete button operates on selected row

**Add Row Behavior:**
- Creates new row with empty values
- Generates unique ID automatically (UUID or incrementing pattern)
- Focus moves to first editable cell

### 4.2 Cell Types

**Text Input:**
- Standard text field for string values
- Press Enter to confirm, Escape to cancel
- Tab moves to next cell

**Tags Input:**
- Comma-separated text input
- Displayed as plain text (no tag chips in v0.1)
- Example: "internal, core, legacy"

**Boolean Toggle:**
- Checkbox for boolean fields
- Click to toggle value

**Dropdown:**
- Select element for enumerated values
- Used for entity type dropdowns, status, etc.

**FK Typeahead:**
- Text input with autocomplete dropdown
- Filters available entities as user types
- Shows entity name, stores entity ID
- Dropdown shows max 10 matching results
- Selecting from dropdown populates the field

### 4.3 Grid Configurations by Entity Type

**Business Users Grid:**
| Column | Field | Type | Required |
|--------|-------|------|----------|
| ID | id | Text (auto-gen) | Yes |
| Name | name | Text | Yes |
| Description | description | Text | No |
| Tags | tags | Tags | No |

**Business Processes Grid:**
| Column | Field | Type | Required |
|--------|-------|------|----------|
| ID | id | Text (auto-gen) | Yes |
| Name | name | Text | Yes |
| Description | description | Text | No |
| Tags | tags | Tags | No |

**Applications Grid:**
| Column | Field | Type | Required |
|--------|-------|------|----------|
| ID | id | Text (auto-gen) | Yes |
| Name | name | Text | Yes |
| Description | description | Text | No |
| Type | app_type | Dropdown | No |
| Status | status | Dropdown | No |
| Tags | tags | Tags | No |

**Application Components Grid:**
| Column | Field | Type | Required |
|--------|-------|------|----------|
| ID | id | Text (auto-gen) | Yes |
| Name | name | Text | Yes |
| Description | description | Text | No |
| Application | application_id | FK Typeahead (Applications) | Yes |
| Tags | tags | Tags | No |

**Services Grid:**
| Column | Field | Type | Required |
|--------|-------|------|----------|
| ID | id | Text (auto-gen) | Yes |
| Name | name | Text | Yes |
| Description | description | Text | No |
| Application | application_id | FK Typeahead (Applications) | Yes |
| Service Type | service_type | Dropdown | No |
| Tags | tags | Tags | No |

**Application Points Grid:**
| Column | Field | Type | Required |
|--------|-------|------|----------|
| ID | id | Text (auto-gen) | Yes |
| Name | name | Text | Yes |
| Description | description | Text | No |
| Application | application_id | FK Typeahead (Applications) | Yes |
| Point Type | point_type | Dropdown | No |
| Tags | tags | Tags | No |

**Logical Data Entities Grid:**
| Column | Field | Type | Required |
|--------|-------|------|----------|
| ID | id | Text (auto-gen) | Yes |
| Name | name | Text | Yes |
| Description | description | Text | No |
| Tags | tags | Tags | No |

**Physical Data Entities Grid:**
| Column | Field | Type | Required |
|--------|-------|------|----------|
| ID | id | Text (auto-gen) | Yes |
| Name | name | Text | Yes |
| Description | description | Text | No |
| Logical Entity | logical_entity_id | FK Typeahead (Logical Entities) | Yes |
| Physical Type | physical_type | Dropdown | No |
| Database | database | Text | No |
| Tags | tags | Tags | No |

**Attributes Grid:**
| Column | Field | Type | Required |
|--------|-------|------|----------|
| ID | id | Text (auto-gen) | Yes |
| Name | name | Text | Yes |
| Description | description | Text | No |
| Physical Entity | physical_entity_id | FK Typeahead (Physical Entities) | Yes |
| Data Type | data_type | Dropdown | No |
| Primary Key | is_primary_key | Boolean | No |
| Nullable | is_nullable | Boolean | No |
| Tags | tags | Tags | No |

**Relationships Grid:**
| Column | Field | Type | Required |
|--------|-------|------|----------|
| ID | id | Text (auto-gen) | Yes |
| Type | relationship_type | Dropdown | Yes |
| Source | source_entity_id | FK Typeahead (filtered by type) | Yes |
| Target | target_entity_id | FK Typeahead (filtered by type) | Yes |
| Description | description | Text | No |
| Tags | tags | Tags | No |

**Relationship Grid Special Behavior:**
- When relationship_type changes, source and target dropdowns update to show only valid entity types
- Source/target typeahead filters to appropriate entity type based on selected relationship type

### 4.4 Validation

**Required Field Validation:**
- Empty required fields highlighted with red border
- Tooltip shows "This field is required"

**FK Reference Validation:**
- Invalid FK references (referencing non-existent entity) highlighted in red
- Tooltip shows "Referenced entity not found"
- **CRITICAL: Prevent save when invalid FK references exist**

**Unique ID Validation:**
- Duplicate IDs within same entity type highlighted in red
- Tooltip shows "Duplicate ID"

**Empty Model State:**
- Show empty grids with column headers
- No placeholder message needed
- "Add Row" button always available

---

## 5. Diagrams View Specification

### 5.1 Canvas Configuration

**Coordinate System:**
- Origin (0,0) at top-left corner
- X increases to the right
- Y increases downward
- Units: pixels

**Default Canvas Size:**
- Width: 2000px
- Height: 2000px
- Configurable via application config (for future needs)

**Canvas Navigation:**
- Scrollable within viewport (scroll bars)
- OR drag-to-pan (click and drag canvas background)
- Both methods acceptable for v0.1

### 5.2 Zoom Controls

**Zoom Levels:**
- Min: 25%
- Max: 200%
- Default: 100%
- Steps: 25%, 50%, 75%, 100%, 125%, 150%, 175%, 200%

**Zoom UI (bottom-right overlay):**
```
+-------------------+
|  [-]  100%  [+]   |
|    [Fit to View]  |
+-------------------+
```

**Controls:**
- [-] Button: Decrease zoom by one step
- [+] Button: Increase zoom by one step
- Zoom level display: Current percentage
- "Fit to View" button: Zoom and pan to show all diagram content

**Mouse Zoom:**
- Scroll wheel zooms in/out
- Zoom centers on mouse cursor position

### 5.3 Node Rendering

**Basic Node Structure:**
```
+---------------------------+
|        [Label]            |
|                           |
|   (Child nodes if any)    |
|                           |
+---------------------------+
```

**Node Visual Properties:**
- Rectangle with rounded corners (4px radius)
- Border: 2px solid
- Label: Centered horizontally, top-aligned with 8px padding
- Font: System sans-serif, 12px
- Minimum size: 60px x 40px

**Entity Type Styling (Default Colors):**

| Entity Type | Background | Border |
|-------------|------------|--------|
| Application | #E3F2FD (light blue) | #1976D2 (dark blue) |
| ApplicationComponent | #E8F5E9 (light green) | #388E3C (dark green) |
| Service | #F3E5F5 (light purple) | #7B1FA2 (dark purple) |
| LogicalDataEntity | #FFF3E0 (light orange) | #F57C00 (dark orange) |
| PhysicalDataEntity | #FFF3E0 (light orange) | #F57C00 (dark orange) |
| BusinessUser | #F5F5F5 (light gray) | #616161 (dark gray) |
| BusinessProcess | #F5F5F5 (light gray) | #616161 (dark gray) |
| ApplicationPoint | #E3F2FD (light blue) | #1976D2 (dark blue) |
| Attribute | #FFF3E0 (light orange) | #F57C00 (dark orange) |

### 5.4 Auto-Size Algorithm

**Purpose:** Calculate minimum size for nodes that contain children, using bottom-up traversal.

**Algorithm:**

```typescript
function calculateNodeSize(node: DiagramNode, allNodes: DiagramNode[]): { width: number, height: number } {
  const children = allNodes.filter(n => n.parent_node_id === node.id);

  // Base case: leaf node
  if (children.length === 0) {
    const labelWidth = measureTextWidth(getEntityLabel(node));
    return {
      width: Math.max(MIN_NODE_WIDTH, labelWidth + LABEL_PADDING * 2),
      height: MIN_NODE_HEIGHT
    };
  }

  // Recursive case: calculate children first (bottom-up)
  const childSizes = children.map(child => calculateNodeSize(child, allNodes));

  // Find bounding box of all children
  const childBounds = calculateChildBounds(children, childSizes);

  // Parent must contain all children plus padding
  const labelWidth = measureTextWidth(getEntityLabel(node));
  const contentWidth = childBounds.maxX - childBounds.minX;
  const contentHeight = childBounds.maxY - childBounds.minY;

  return {
    width: Math.max(labelWidth + LABEL_PADDING * 2, contentWidth + PADDING * 2),
    height: contentHeight + LABEL_HEIGHT + PADDING * 2
  };
}
```

**Constants:**
- MIN_NODE_WIDTH: 60px
- MIN_NODE_HEIGHT: 40px
- PADDING: 10px
- LABEL_PADDING: 8px
- LABEL_HEIGHT: 20px

**Example:**
If "Risk Aggregation" business process node is 200px wide, and it is contained within an Application node:
- Application minimum width = 200px + 10px left padding + 10px right padding = 220px

### 5.5 Containment Rendering

**Visual Hierarchy:**
- Child nodes render inside parent node bounds
- Children positioned relative to parent's coordinate space
- Parent node must be large enough to contain all children

**Rendering Order:**
1. Parent node background and border
2. Parent node label
3. Child nodes (recursively)
4. Edges (on top of all nodes)

**Validation:**
- Child nodes must not extend outside parent bounds
- If they do, show warning but still render (allow manual position adjustment)

### 5.6 Edge Rendering

**Basic Edge:**
- Polyline connecting source node to target node
- Follows edge_points in sequence order
- Line: 2px solid, color based on relationship type

**Edge Points:**
- edge_points define waypoints for polyline
- If no edge_points defined, draw straight line from source to target
- Connection points: center of source/target nodes (or nearest edge point)

**Arrowhead:**
- Triangle arrowhead at target end
- Size: 8px
- Points in direction of final line segment

**Edge Label:**
- Show relationship type abbreviation at midpoint of edge
- Background: white with slight opacity
- Font: 10px

**Relationship Type Colors:**
| Relationship Type | Edge Color |
|-------------------|------------|
| user_uses_process | #616161 |
| process_uses_application | #616161 |
| application_owns_component | #388E3C |
| application_exposes_service | #7B1FA2 |
| application_has_point | #1976D2 |
| application_stores_data | #F57C00 |

### 5.7 Empty/Error States

**No Diagrams Defined:**
- Show message: "No diagrams defined in this model"
- Center of canvas area

**Invalid Entity References:**
- When diagram_node references non-existent entity_id
- Show error dialog: "Error loading diagram: Node [node_id] references non-existent entity [entity_id]"
- **CRITICAL: Prevent diagram load/render**
- User must fix data in Meta-model view before viewing diagram

---

## 6. JSON Load/Save Specification

### 6.1 Load JSON

**Flow:**
1. User clicks "Load JSON" button
2. File picker dialog opens (accept: .json)
3. User selects file
4. Application reads file content
5. Parse JSON
6. Validate structure and references
7. If valid, populate state and update UI
8. If invalid, show error dialog

**Validation Checks:**
1. Valid JSON syntax
2. All required arrays present at root level
3. All required fields present on each entity
4. All FK references resolve to existing entities
5. No duplicate IDs within entity types

**Error Messages:**

| Error Type | Message |
|------------|---------|
| Invalid JSON | "Failed to parse JSON: [parser error message]" |
| Missing array | "Invalid model: Missing required array '[array_name]'" |
| Missing field | "Invalid entity: [entity_type] [id] missing required field '[field]'" |
| Invalid FK | "Invalid reference: [entity_type] [id] references non-existent [target_type] [target_id]" |
| Duplicate ID | "Duplicate ID: [entity_type] already contains entity with ID '[id]'" |

**Error Dialog:**
- Modal dialog with error message
- "OK" button to dismiss
- File is not loaded, previous state preserved

### 6.2 Save JSON

**Flow:**
1. User clicks "Save JSON" button
2. Validate current model (same checks as load)
3. If invalid, show error dialog listing all validation errors
4. If valid, serialize model to JSON
5. Trigger browser download with filename

**Filename:**
- If loaded from file: Use original filename
- If new model: "architecture-model.json"

**JSON Format:**
- Indented with 2 spaces for readability
- UTF-8 encoding
- All arrays included even if empty

**Save Validation Errors:**
- Show modal with list of all errors
- User must fix errors before save completes
- Example: "Cannot save: 3 validation errors found:\n- Component 'comp-1' references non-existent application 'app-999'\n- ..."

### 6.3 Sample JSON Structure

```json
{
  "business_users": [
    {
      "id": "user-1",
      "name": "Trading Desk User",
      "description": "Front office trader",
      "tags": "front-office, trading"
    }
  ],
  "business_processes": [
    {
      "id": "process-1",
      "name": "Risk Aggregation",
      "description": "Aggregate risk across positions",
      "tags": "risk, core"
    }
  ],
  "applications": [
    {
      "id": "app-1",
      "name": "Risk Engine",
      "description": "Core risk calculation system",
      "app_type": "Batch",
      "status": "Active",
      "tags": "risk, core"
    }
  ],
  "application_components": [],
  "services": [],
  "application_points": [],
  "logical_data_entities": [],
  "physical_data_entities": [],
  "attributes": [],
  "relationships": [
    {
      "id": "rel-1",
      "relationship_type": "process_uses_application",
      "source_entity_id": "process-1",
      "target_entity_id": "app-1",
      "description": "",
      "tags": ""
    }
  ],
  "diagrams": [
    {
      "id": "diag-1",
      "name": "Risk Domain Overview",
      "description": "High-level view of risk systems"
    }
  ],
  "diagram_nodes": [
    {
      "id": "node-1",
      "diagram_id": "diag-1",
      "entity_type": "Application",
      "entity_id": "app-1",
      "x": 100,
      "y": 100,
      "width": 150,
      "height": 80,
      "parent_node_id": null
    }
  ],
  "diagram_edges": [],
  "edge_points": []
}
```

---

## 7. Configuration

### 7.1 Application Configuration

```typescript
interface AppConfig {
  canvas: {
    defaultWidth: number;   // Default: 2000
    defaultHeight: number;  // Default: 2000
  };
  zoom: {
    min: number;            // Default: 0.25
    max: number;            // Default: 2.0
    default: number;        // Default: 1.0
    step: number;           // Default: 0.25
  };
  grid: {
    rowHeight: number;      // Default: 36
    headerHeight: number;   // Default: 40
  };
  node: {
    minWidth: number;       // Default: 60
    minHeight: number;      // Default: 40
    padding: number;        // Default: 10
    labelPadding: number;   // Default: 8
    borderRadius: number;   // Default: 4
    borderWidth: number;    // Default: 2
    fontSize: number;       // Default: 12
  };
  edge: {
    lineWidth: number;      // Default: 2
    arrowSize: number;      // Default: 8
    labelFontSize: number;  // Default: 10
  };
}
```

### 7.2 Entity Type Colors

```typescript
const entityColors: Record<string, { background: string; border: string }> = {
  Application: { background: '#E3F2FD', border: '#1976D2' },
  ApplicationComponent: { background: '#E8F5E9', border: '#388E3C' },
  Service: { background: '#F3E5F5', border: '#7B1FA2' },
  LogicalDataEntity: { background: '#FFF3E0', border: '#F57C00' },
  PhysicalDataEntity: { background: '#FFF3E0', border: '#F57C00' },
  BusinessUser: { background: '#F5F5F5', border: '#616161' },
  BusinessProcess: { background: '#F5F5F5', border: '#616161' },
  ApplicationPoint: { background: '#E3F2FD', border: '#1976D2' },
  Attribute: { background: '#FFF3E0', border: '#F57C00' },
};
```

### 7.3 Dropdown Options

```typescript
const appTypeOptions = ['Web', 'Batch', 'API', 'Desktop', 'Mobile'];
const statusOptions = ['Active', 'Deprecated', 'Planned', 'Retired'];
const serviceTypeOptions = ['REST', 'SOAP', 'gRPC', 'GraphQL', 'Message'];
const pointTypeOptions = ['UI', 'File Drop', 'Queue', 'Email', 'API'];
const physicalTypeOptions = ['Table', 'View', 'Collection', 'File', 'Queue'];
const dataTypeOptions = ['VARCHAR', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'TIMESTAMP', 'DATE', 'BLOB', 'JSON'];
```

---

## 8. Acceptance Criteria

### 8.1 Meta-model CRUD

- [ ] Can add new entities of each type via "Add Row" button
- [ ] Can edit any cell by clicking/double-clicking
- [ ] Can delete selected row via "Delete Row" button
- [ ] Auto-generates unique ID for new entities
- [ ] FK typeahead shows filtered results as user types
- [ ] FK typeahead allows selection from dropdown
- [ ] Invalid FK references highlighted in red
- [ ] Cannot save model with invalid FK references
- [ ] Tags stored as comma-separated string
- [ ] Boolean fields display as checkboxes
- [ ] Dropdown fields show configured options

### 8.2 JSON Operations

- [ ] Can load valid JSON file via file picker
- [ ] File name displayed in top bar after load
- [ ] Can save model to JSON file
- [ ] Saved file maintains original filename if loaded
- [ ] All entities and relationships round-trip without data loss
- [ ] Invalid JSON shows clear error message
- [ ] Missing required fields show specific error
- [ ] Invalid FK references prevent load with clear error

### 8.3 Diagram Rendering

- [ ] Can select diagram from dropdown (if multiple exist)
- [ ] Nodes render with correct position and size
- [ ] Nodes styled by entity type (colors, borders)
- [ ] Node labels display entity name
- [ ] Containment hierarchy renders correctly (children inside parents)
- [ ] Edges render as polylines following edge_points
- [ ] Edges show arrowheads at target
- [ ] Edges colored by relationship type
- [ ] Can pan canvas via scroll or drag
- [ ] Can zoom in/out via buttons and scroll wheel
- [ ] "Fit to View" shows all diagram content
- [ ] Invalid entity references prevent diagram load with error

### 8.4 State Management

- [ ] Switching between Meta-model and Diagrams views preserves state
- [ ] Edits in grids immediately available for diagram rendering
- [ ] Empty model shows empty grids (no errors)
- [ ] Empty model shows "No diagrams" message in Diagrams view

---

## 9. Technical Constraints

### 9.1 Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.x | UI framework |
| TypeScript | 5.x | Type safety |
| Vite | 5.x | Build tooling |
| CSS Modules | - | Component styling |

### 9.2 No External Dependencies (Core)

The following should be implemented without external libraries:
- State management (React Context)
- Grid component
- Canvas rendering (HTML5 Canvas or SVG)
- File operations (browser File API)

### 9.3 Browser Support

- Chrome (latest 2 versions)
- Firefox (latest 2 versions)
- Edge (latest 2 versions)
- Safari (latest 2 versions)

### 9.4 No Backend

- All data stored client-side in memory
- JSON files for persistence
- No API calls
- No authentication

---

## 10. File Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── TopBar/
│   │   │   ├── TopBar.tsx
│   │   │   └── TopBar.module.css
│   │   ├── MetaModelView/
│   │   │   ├── MetaModelView.tsx
│   │   │   ├── TabBar.tsx
│   │   │   └── MetaModelView.module.css
│   │   ├── Grid/
│   │   │   ├── Grid.tsx
│   │   │   ├── GridCell.tsx
│   │   │   ├── TypeaheadCell.tsx
│   │   │   └── Grid.module.css
│   │   ├── DiagramsView/
│   │   │   ├── DiagramsView.tsx
│   │   │   ├── DiagramSelector.tsx
│   │   │   ├── Canvas.tsx
│   │   │   ├── ZoomControls.tsx
│   │   │   └── DiagramsView.module.css
│   │   └── common/
│   │       ├── Modal.tsx
│   │       └── Button.tsx
│   ├── contexts/
│   │   └── ArchitectureContext.tsx
│   ├── types/
│   │   ├── model.ts
│   │   └── config.ts
│   ├── utils/
│   │   ├── validation.ts
│   │   ├── fileOperations.ts
│   │   └── rendering.ts
│   ├── config/
│   │   └── defaults.ts
│   ├── App.tsx
│   └── main.tsx
├── public/
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 11. Implementation Notes

### 11.1 State Management Approach

Use React Context with useReducer for centralized state:

```typescript
interface AppState {
  model: ArchitectureModel;
  currentView: 'metamodel' | 'diagrams';
  selectedTab: string;
  selectedDiagramId: string | null;
  loadedFileName: string | null;
  validationErrors: ValidationError[];
}

type AppAction =
  | { type: 'LOAD_MODEL'; payload: ArchitectureModel; fileName: string }
  | { type: 'SET_VIEW'; payload: 'metamodel' | 'diagrams' }
  | { type: 'SELECT_TAB'; payload: string }
  | { type: 'SELECT_DIAGRAM'; payload: string }
  | { type: 'UPDATE_ENTITY'; entityType: string; entity: any }
  | { type: 'ADD_ENTITY'; entityType: string; entity: any }
  | { type: 'DELETE_ENTITY'; entityType: string; id: string }
  | { type: 'SET_VALIDATION_ERRORS'; payload: ValidationError[] };
```

### 11.2 Canvas vs SVG Decision

Both approaches are acceptable for v0.1. Recommendation:

**SVG Pros:**
- Easier hit-testing for future interactivity
- CSS styling works directly
- Better text rendering
- DOM-based debugging

**Canvas Pros:**
- Better performance with many elements
- Simpler zoom implementation
- More control over rendering

For v0.1 read-only rendering, either works. Consider SVG for easier future extension to interactive editing.

### 11.3 Validation Strategy

Run validation:
1. On initial load (prevent invalid files)
2. On every edit (for inline error display)
3. On save attempt (block save if errors)

Cache validation results to avoid redundant computation.

### 11.4 Performance Considerations

For v0.1 (no explicit performance targets):
- Grids may slow with 100+ rows (acceptable)
- Canvas may slow with 100+ nodes (acceptable)
- Optimize in future versions if needed

---

## 12. Future Considerations (Not in v0.1)

These items are explicitly out of scope but documented for future reference:

- Entity palette for drag-and-drop diagram creation
- Interactive node positioning and resizing
- Properties panel for detailed editing
- Polyline edge waypoint editing
- Undo/redo functionality
- Keyboard shortcuts
- Search and filter
- Copy/paste operations
- Grid column sorting and filtering
- Grid column resizing
- Mini-map navigation
- Relationship suggestions
- Backend persistence
- Multi-user collaboration
- Version history
