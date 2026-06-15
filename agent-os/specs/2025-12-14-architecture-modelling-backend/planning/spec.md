# Specification: Architecture Modelling Backend

## 1. Overview

### 1.1 Problem Statement

The Architecture Modelling Tool frontend currently stores models in browser localStorage. This limits:
- Persistence across devices/browsers
- Collaboration between users
- Data integrity and backup
- Model file management

### 1.2 Solution

Implement a backend consisting of:
1. **PostgreSQL database** storing multiple ArchitectureModel "files" with all entities, relationships, and diagrams
2. **Java Spring Boot service** exposing HTTP APIs for loading/saving models by filename

### 1.3 Goals

1. Persist ArchitectureModel (meta-model + diagrams) to PostgreSQL
2. Support multiple named model files via `model_files` table
3. Provide HTTP APIs matching frontend data structures exactly
4. Enable future granular CRUD operations per entity/relationship/diagram

### 1.4 Non-Goals

- User authentication/authorization (future enhancement)
- Real-time collaboration (future enhancement)
- Version history/audit logging (future enhancement)
- Model validation beyond referential integrity

## 2. Technical Architecture

### 2.1 Component Overview

```
┌─────────────────────┐     HTTP      ┌──────────────────────────┐     JDBC     ┌─────────────────┐
│  Frontend (React)   │ ◄──────────► │  architecture-model-     │ ◄──────────► │   PostgreSQL    │
│                     │    JSON       │  service (Spring Boot)   │              │  (meta-model-db)│
└─────────────────────┘               └──────────────────────────┘              └─────────────────┘
```

### 2.2 Database Configuration

| Property | Value |
|----------|-------|
| Database Name | `architecture_model` |
| Username | `arch_model_user` |
| Password | `arch_model_password` |
| Host | `localhost` |
| Port | `5432` |

### 2.3 Service Configuration

| Property | Value |
|----------|-------|
| Java Version | 21 |
| Build Tool | Maven |
| Package | `com.example.architecturemodel` |
| Port | 8080 |
| Base Path | `/api` |

## 3. Database Schema

### 3.1 Core Tables

#### model_files
Primary table for storing named model "files".

```sql
CREATE TABLE model_files (
  id           TEXT PRIMARY KEY,
  filename     TEXT NOT NULL UNIQUE,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  tags         TEXT
);
```

### 3.2 Business Domain Tables

| Table | Description | Foreign Keys |
|-------|-------------|--------------|
| `business_users` | Business users/actors | `model_file_id` |
| `business_processes` | Business processes | `model_file_id` |
| `process_activities` | Activities within processes | `model_file_id`, `business_process_id` |
| `business_points` | Supertype for BP/PA | `model_file_id`, `business_process_id`, `process_activity_id` |

### 3.3 Application Domain Tables

| Table | Description | Foreign Keys |
|-------|-------------|--------------|
| `applications` | Application systems | `model_file_id` |
| `application_components` | Components within apps | `model_file_id`, `application_id` |
| `services` | Services within apps/components | `model_file_id`, `application_id`, `application_component_id` |
| `interfaces` | Service interfaces | `model_file_id`, `service_id` |
| `endpoints` | Interface endpoints | `model_file_id`, `interface_id` |
| `application_points` | Supertype for App/Component/Service/Interface | `model_file_id`, references to underlying entities |

### 3.4 Data Domain Tables

| Table | Description | Foreign Keys |
|-------|-------------|--------------|
| `logical_data_entities` | Logical data entities | `model_file_id` |
| `logical_data_attributes` | Attributes of logical entities | `model_file_id`, `logical_entity_id` |
| `physical_data_entities` | Physical data entities | `model_file_id` |
| `physical_data_attributes` | Attributes of physical entities | `model_file_id`, `physical_entity_id` |

### 3.5 Interaction Tables

| Table | Description | Foreign Keys |
|-------|-------------|--------------|
| `app_business_points` | Supertype for interaction endpoints | `model_file_id` |
| `interactions` | User interactions | `model_file_id`, `business_user_id`, `primary/secondary_app_business_point_id` |

### 3.6 Relationship Tables

| Table | Description | Foreign Keys |
|-------|-------------|--------------|
| `business_user_business_points` | User-to-BusinessPoint links | `business_user_id`, `business_point_id` |
| `application_point_business_points` | AppPoint-to-BusinessPoint links | `application_point_id`, `business_point_id` |
| `logical_data_entity_relationships` | Logical entity relationships | `source_entity_id`, `target_entity_id` |
| `logical_data_entity_physical_data_entities` | Logical-to-Physical mappings | `logical_entity_id`, `physical_entity_id` |
| `logical_data_attribute_physical_data_attributes` | Attribute mappings | `logical_attribute_id`, `physical_attribute_id` |
| `data_movements` | Data flow between app points | `source/target_application_point_id` |
| `interface_logical_entities` | Interface-to-LogicalEntity links | `interface_id`, `logical_entity_id` |

### 3.7 Diagram Tables

| Table | Description | Key Fields |
|-------|-------------|------------|
| `diagrams` | Diagram metadata | `settings JSONB`, `view_quarter` |
| `diagram_nodes` | Nodes on diagrams | `pos_x/y`, `width/height`, `style JSONB` |
| `diagram_edges` | Edges on diagrams | `edge_points JSONB`, `style JSONB` |
| `diagram_interaction_edges` | USER_INTERACTION edges | `edge_points JSONB`, `user_link_edge_points JSONB` |
| `diagram_decorations` | Visual decorations | Shape and line properties |

### 3.8 Design Decisions

1. **TEXT IDs**: All primary keys are TEXT to match frontend string IDs
2. **JSONB for flexibility**: Style properties, edge points stored as JSONB
3. **Temporal fields**: `valid_from`/`valid_to` as TEXT (format: "YYYY-Qn")
4. **Cascading deletes**: `ON DELETE CASCADE` for model_file_id foreign keys

## 4. HTTP API Design

### 4.1 File-Level Operations

#### GET /api/model/filenames
List all saved model files.

**Response:** `ModelFileSummary[]`
```json
[
  {
    "id": "mf_123",
    "filename": "my-architecture",
    "description": "Main architecture model",
    "createdAt": "2025-01-15T10:30:00Z",
    "updatedAt": "2025-01-20T14:45:00Z",
    "isDefault": true,
    "tags": "production,v2"
  }
]
```

#### GET /api/model?filename={filename}
Load full ArchitectureModel for the given filename.

**Query Parameters:**
- `filename` (optional): Name of file to load. If omitted, loads default or latest.

**Response:** `ArchitectureModel`
```json
{
  "metaModel": {
    "entities": {
      "business_users": [...],
      "applications": [...],
      ...
    },
    "relationships": {
      "business_user_business_points": [...],
      ...
    }
  },
  "diagrams": [...]
}
```

#### PUT /api/model?filename={filename}
Save or replace ArchitectureModel for the given filename.

**Query Parameters:**
- `filename` (required): Name of file to save into. Created if doesn't exist.

**Request Body:** `ArchitectureModel`

**Response:** `ModelFileSummary`

#### DELETE /api/model?filename={filename}
Delete model file and all associated data.

**Query Parameters:**
- `filename` (required): Name of file to delete.

### 4.2 Entity CRUD Operations (Future)

#### GET /api/model/{filename}/meta/entities/{entityType}
List entities of a given type.

**Path Parameters:**
- `filename`: Model filename
- `entityType`: One of: `business_users`, `business_processes`, `applications`, etc.

**Query Parameters:**
- `valid_in` (optional): Quarter filter (YYYY-Qn)

#### POST /api/model/{filename}/meta/entities/{entityType}
Create new entity.

#### GET/PUT/DELETE /api/model/{filename}/meta/entities/{entityType}/{id}
Read/Update/Delete specific entity.

### 4.3 Diagram CRUD Operations (Future)

#### GET /api/model/{filename}/diagrams
List diagrams for a given file.

#### GET/PUT/DELETE /api/model/{filename}/diagrams/{diagramId}
Read/Update/Delete specific diagram.

#### POST /api/model/{filename}/diagrams
Create new diagram.

## 5. Java Implementation

### 5.1 Package Structure

```
com.example.architecturemodel/
├── controller/
│   ├── ModelController.java          # File-level endpoints
│   ├── EntityController.java         # Entity CRUD endpoints
│   └── DiagramController.java        # Diagram CRUD endpoints
├── service/
│   ├── ModelService.java             # Business logic for model operations
│   ├── EntityService.java            # Entity operations
│   └── DiagramService.java           # Diagram operations
├── repository/
│   ├── ModelFileRepository.java
│   ├── entity/                       # Entity repositories
│   │   ├── BusinessUserRepository.java
│   │   ├── ApplicationRepository.java
│   │   └── ...
│   ├── relationship/                 # Relationship repositories
│   │   ├── BusinessUserBusinessPointRepository.java
│   │   └── ...
│   └── diagram/                      # Diagram repositories
│       ├── DiagramRepository.java
│       ├── DiagramNodeRepository.java
│       └── ...
├── model/
│   ├── dto/                          # API DTOs (match frontend types)
│   │   ├── ArchitectureModelDto.java
│   │   ├── MetaModelDto.java
│   │   ├── DiagramDto.java
│   │   └── entity/
│   │       ├── BusinessUserDto.java
│   │       └── ...
│   └── entity/                       # JPA entities (match DB schema)
│       ├── ModelFileEntity.java
│       ├── BusinessUserEntity.java
│       └── ...
├── mapper/
│   ├── EntityMapper.java             # DTO <-> Entity conversion
│   └── DiagramMapper.java
└── config/
    └── DatabaseConfig.java
```

### 5.2 Key DTOs (Matching Frontend Types)

```java
// ArchitectureModelDto.java
public record ArchitectureModelDto(
    MetaModelDto metaModel,
    List<DiagramDto> diagrams
) {}

// MetaModelDto.java
public record MetaModelDto(
    MetaModelEntitiesDto entities,
    MetaModelRelationshipsDto relationships
) {}

// BusinessUserDto.java
public record BusinessUserDto(
    String id,
    String name,
    String description,
    String tags
) {}

// DiagramNodeDto.java
public record DiagramNodeDto(
    String id,
    String entityType,
    String entityId,
    double posX,
    double posY,
    double width,
    double height,
    Boolean autoSize,
    Integer zIndex,
    String parentNodeId,
    Map<String, Object> styleOverride,
    // ... additional styling fields
    String validFrom,
    String validTo
) {}
```

### 5.3 Data Conversion Strategy

**Loading (GET /api/model):**
1. Resolve `filename` → `model_file_id`
2. Query all entity tables for that `model_file_id`
3. Query all relationship tables
4. Query diagrams with nodes/edges/decorations
5. Assemble into `ArchitectureModelDto`

**Saving (PUT /api/model):**
1. Resolve or create `model_files` row for filename
2. Strategy options:
   - **Truncate and insert**: Delete all data for `model_file_id`, re-insert from payload
   - **Upsert**: Merge entities/relationships/diagrams (more complex but preserves IDs)
3. Initial implementation: Truncate and insert (simpler)

### 5.4 JSONB Field Handling

Use Jackson's `JsonNode` or `Map<String, Object>` for JSONB columns:

```java
@Entity
@Table(name = "diagram_nodes")
public class DiagramNodeEntity {
    // ...

    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> style;

    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private List<EdgePointDto> edgePoints;
}
```

## 6. Acceptance Criteria

### AC1 - Database Schema
- All tables created matching the provided schema
- Foreign key constraints enforce referential integrity
- Indexes created for common queries

### AC2 - Model File Operations
- `GET /api/model/filenames` returns list of all model files
- `GET /api/model?filename=X` returns complete ArchitectureModel
- `PUT /api/model?filename=X` saves/replaces model
- `DELETE /api/model?filename=X` removes model and all data

### AC3 - Data Integrity
- Model saved via PUT can be retrieved via GET with identical structure
- Deleting model file cascades to all related data
- IDs preserved through save/load cycle

### AC4 - Frontend Compatibility
- JSON structure matches frontend TypeScript types exactly
- Property names use snake_case to match frontend
- All entity types, relationships, and diagram elements supported

## 7. Implementation Phases

### Phase 1: Database Setup
- Create PostgreSQL database and user
- Execute schema.sql to create tables
- Verify table structure and constraints

### Phase 2: Spring Boot Project Setup
- Initialize Maven project with dependencies
- Configure database connection
- Set up package structure

### Phase 3: Core API Implementation
- Implement file-level endpoints (GET/PUT/DELETE /api/model)
- Create DTOs matching frontend types
- Implement model assembly/disassembly logic

### Phase 4: Testing
- Integration tests for API endpoints
- Data round-trip verification
- Edge case handling

### Phase 5: Future Enhancements
- Entity CRUD endpoints
- Diagram CRUD endpoints
- Temporal filtering (valid_in query parameter)

## 8. Files Summary

### Project Location
`architecture-model-service/` at repository root (alongside `frontend/`)

### Save Strategy
**Truncate & Insert**: On PUT /api/model, delete all existing data for the model file, then insert fresh from payload. This is simpler and safer than upsert/merge.

### Files to Create

| File | Description |
|------|-------------|
| `architecture-model-service/db/schema.sql` | PostgreSQL schema DDL |
| `architecture-model-service/pom.xml` | Maven project configuration |
| `architecture-model-service/src/main/java/.../controller/*.java` | REST controllers |
| `architecture-model-service/src/main/java/.../service/*.java` | Business logic |
| `architecture-model-service/src/main/java/.../repository/*.java` | JPA repositories |
| `architecture-model-service/src/main/java/.../model/dto/*.java` | API DTOs |
| `architecture-model-service/src/main/java/.../model/entity/*.java` | JPA entities |
| `architecture-model-service/src/main/resources/application.yml` | Spring configuration |

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| DTO/frontend type mismatch | Medium | High | Generate DTOs from TypeScript types or test extensively |
| Large model performance | Medium | Medium | Use batch inserts, optimize queries |
| Data migration complexity | Low | Medium | Start with truncate/insert strategy |
| JSONB query complexity | Low | Low | Use simple JSONB operations initially |
