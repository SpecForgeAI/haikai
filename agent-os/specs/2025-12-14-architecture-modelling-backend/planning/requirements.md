# Requirements: Architecture Modelling Backend

## 1. Functional Requirements

### 1.1 Model File Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | System shall support multiple named model files | Must |
| FR-1.2 | Each model file shall have unique filename | Must |
| FR-1.3 | System shall track creation and update timestamps | Must |
| FR-1.4 | System shall support marking one file as default | Should |
| FR-1.5 | System shall support optional description and tags per file | Should |

### 1.2 Model Loading

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | System shall load complete ArchitectureModel by filename | Must |
| FR-2.2 | Loaded model shall include all meta-model entities | Must |
| FR-2.3 | Loaded model shall include all meta-model relationships | Must |
| FR-2.4 | Loaded model shall include all diagrams with nodes/edges/decorations | Must |
| FR-2.5 | If filename not specified, system shall load default or latest | Should |

### 1.3 Model Saving

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | System shall save complete ArchitectureModel to specified filename | Must |
| FR-3.2 | If filename exists, system shall replace existing model | Must |
| FR-3.3 | If filename doesn't exist, system shall create new model file | Must |
| FR-3.4 | Saved model shall be retrievable with identical structure | Must |
| FR-3.5 | Entity IDs shall be preserved through save/load cycle | Must |

### 1.4 Model Deletion

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | System shall delete model file by filename | Must |
| FR-4.2 | Deletion shall cascade to all associated data | Must |
| FR-4.3 | System shall return error if filename doesn't exist | Should |

### 1.5 Entity Types Support

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | System shall support all 16 meta-model entity types | Must |
| FR-5.2 | System shall support all 7 meta-model relationship types | Must |
| FR-5.3 | System shall support temporal validity fields (valid_from/valid_to) | Must |
| FR-5.4 | System shall preserve all entity properties through save/load | Must |

### 1.6 Diagram Support

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-6.1 | System shall support diagram metadata (name, type, settings) | Must |
| FR-6.2 | System shall support diagram nodes with positioning and styling | Must |
| FR-6.3 | System shall support diagram edges with edge points and styling | Must |
| FR-6.4 | System shall support diagram decorations (shapes and lines) | Must |
| FR-6.5 | System shall support diagram interaction edges | Must |

## 2. Non-Functional Requirements

### 2.1 Performance

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-1.1 | Model load shall complete within 2 seconds for models with < 1000 entities | Should |
| NFR-1.2 | Model save shall complete within 5 seconds for models with < 1000 entities | Should |

### 2.2 Compatibility

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-2.1 | API JSON structure shall match frontend TypeScript types exactly | Must |
| NFR-2.2 | Property names shall use snake_case consistent with frontend | Must |
| NFR-2.3 | IDs shall be strings (TEXT) to match frontend | Must |

### 2.3 Technology Stack

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-3.1 | Backend shall use Java 21 | Must |
| NFR-3.2 | Backend shall use Spring Boot framework | Must |
| NFR-3.3 | Backend shall use Maven for build | Must |
| NFR-3.4 | Database shall be PostgreSQL | Must |

### 2.4 Data Integrity

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-4.1 | Database shall enforce referential integrity via foreign keys | Must |
| NFR-4.2 | All entities shall be associated with a model_file_id | Must |
| NFR-4.3 | Cascade deletes shall be used for model file deletion | Must |

## 3. Entity Type Specifications

### 3.1 Business Domain Entities

| Entity | Required Fields | Optional Fields |
|--------|-----------------|-----------------|
| BusinessUser | id, name | description, tags |
| BusinessProcess | id, name | description, tags, valid_from, valid_to |
| ProcessActivity | id, business_process_id, name, actor_hint, user_interaction_level | description, sequence_order, frequency, tags, valid_from, valid_to |
| BusinessPoint | id, name, kind, business_process_id | description, process_activity_id, tags, valid_from, valid_to |

### 3.2 Application Domain Entities

| Entity | Required Fields | Optional Fields |
|--------|-----------------|-----------------|
| Application | id, name | description, app_type, status, tags, valid_from, valid_to |
| ApplicationComponent | id, application_id, name | description, tags, valid_from, valid_to |
| Service | id, application_id, name | description, app_component_id, service_type, tags, valid_from, valid_to |
| Interface | id, service_id, name | description, interface_type, spec_link, tags, valid_from, valid_to |
| Endpoint | id, interface_id, name | description, endpoint_type, path_or_address, protocol, operation_verb, direction, lifecycle_status, version, tags, valid_from, valid_to |
| ApplicationPoint | id, name, kind, application_id | description, application_component_id, service_id, point_type, tags, valid_from, valid_to |

### 3.3 Data Domain Entities

| Entity | Required Fields | Optional Fields |
|--------|-----------------|-----------------|
| LogicalDataEntity | id, name | description, tags, valid_from, valid_to |
| LogicalDataAttribute | id, logical_entity_id, name, is_primary_key, is_nullable | description, data_type, tags |
| PhysicalDataEntity | id, name | description, physical_type, database_name, tags, valid_from, valid_to |
| PhysicalDataAttribute | id, physical_entity_id, name, is_primary_key, is_nullable | description, data_type, tags |

### 3.4 Interaction Entities

| Entity | Required Fields | Optional Fields |
|--------|-----------------|-----------------|
| AppBusinessPoint | id, name, kind, source_entity_id | tags, valid_from, valid_to |
| Interaction | id, name, primary_app_business_point_id | description, business_user_id, secondary_app_business_point_id |

### 3.5 Relationship Entities

| Relationship | Required Fields | Optional Fields |
|--------------|-----------------|-----------------|
| BusinessUserBusinessPoint | id, business_user_id, business_point_id | description, tags, valid_from, valid_to |
| ApplicationPointBusinessPoint | id, application_point_id, business_point_id | description, tags, valid_from, valid_to |
| LogicalDataEntityRelationship | id, source_entity_id, target_entity_id, relationship_type | description, tags, valid_from, valid_to |
| LogicalDataEntityPhysicalDataEntity | id, logical_entity_id, physical_entity_id | description, tags, valid_from, valid_to |
| LogicalDataAttributePhysicalDataAttribute | id, logical_attribute_id, physical_attribute_id | description, tags, valid_from, valid_to |
| DataMovement | id, source_application_point_id, target_application_point_id | data_entity_id, movement_type, description, tags, valid_from, valid_to |
| InterfaceLogicalEntity | id, interface_id, logical_entity_id | description, tags, valid_from, valid_to |

## 4. Diagram Element Specifications

### 4.1 DiagramNode Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| id | string | Yes | Unique identifier |
| entity_type | string | Yes | Type of entity represented |
| entity_id | string | Yes | ID of the entity |
| pos_x, pos_y | number | Yes | Position coordinates |
| width, height | number | Yes | Dimensions |
| auto_size | boolean | No | Auto-resize enabled |
| z_index | number | No | Layer ordering |
| parent_node_id | string | No | Parent container node |
| style_override | object | No | Custom styling |
| text_h_align, text_v_align | string | No | Text alignment |
| background_color, line_color, text_color | string | No | Colors (hex) |
| render_style | string | No | 'standard', 'erd', 'contract' |
| embedded_attribute_ids | string[] | No | For ERD rendering |
| valid_from, valid_to | string | No | Temporal validity |

### 4.2 DiagramEdge Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| id | string | Yes | Unique identifier |
| relationship_type | string | Yes | Type of relationship |
| relationship_id | string | Yes | ID of the relationship |
| source_node_id | string | Yes | Source node ID |
| target_node_id | string | Yes | Target node ID |
| edge_points | array | Yes | Array of {id, sequence_order, pos_x, pos_y} |
| label_text | string | No | Edge label |
| label_pos_x, label_pos_y | number | No | Label position |
| line_weight, line_type, line_dashes | string | No | Line styling |
| arrow_start, arrow_end | string | No | Arrow types |
| subType | string | No | 'MAIN' or 'USER_LINK' for interactions |
| style_override | object | No | Custom styling |
| valid_from, valid_to | string | No | Temporal validity |

### 4.3 Decoration Properties

#### Shape Decorations
| Property | Type | Required |
|----------|------|----------|
| id | string | Yes |
| type | string | Yes | BOX, OVAL, DIAMOND, etc. |
| pos_x, pos_y | number | Yes |
| width, height | number | Yes |
| text | string | No |
| background_color | string | No |
| text_h_align, text_v_align | string | No |

#### Line Decorations
| Property | Type | Required |
|----------|------|----------|
| id | string | Yes |
| type | string | Yes | LINE, ARROW_SINGLE, ARROW_DOUBLE |
| line_points | array | Yes | Array of {x, y} |
| arrow_start, arrow_end | string | No |

## 5. API Endpoint Specifications

### 5.1 GET /api/model/filenames

**Response:** `200 OK`
```json
[
  {
    "id": "string",
    "filename": "string",
    "description": "string | null",
    "created_at": "ISO8601 timestamp",
    "updated_at": "ISO8601 timestamp",
    "is_default": "boolean",
    "tags": "string | null"
  }
]
```

### 5.2 GET /api/model

**Query Parameters:**
- `filename` (optional): string

**Response:** `200 OK` with `ArchitectureModel`

**Error Response:** `404 Not Found` if filename specified but doesn't exist

### 5.3 PUT /api/model

**Query Parameters:**
- `filename` (required): string

**Request Body:** `ArchitectureModel`

**Response:** `200 OK` with `ModelFileSummary`

### 5.4 DELETE /api/model

**Query Parameters:**
- `filename` (required): string

**Response:** `204 No Content`

**Error Response:** `404 Not Found` if filename doesn't exist

## 6. Database Constraints

### 6.1 Primary Keys
- All tables use TEXT primary key named `id`

### 6.2 Foreign Keys
- All entity/relationship tables have `model_file_id` foreign key to `model_files`
- Cascading delete enabled for `model_file_id`
- Child entities reference parent entities with appropriate foreign keys

### 6.3 Unique Constraints
- `model_files.filename` is unique

### 6.4 Indexes
Required indexes for query performance:
- `business_processes(model_file_id)`
- `applications(model_file_id)`
- `logical_data_entities(model_file_id)`
- `diagrams(model_file_id)`
- `diagram_nodes(diagram_id)`
- `diagram_edges(diagram_id)`
- `diagram_decorations(diagram_id)`
