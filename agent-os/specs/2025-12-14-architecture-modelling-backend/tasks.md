# Task Breakdown: Architecture Modelling Backend

## Overview
Total Tasks: 52
Estimated Complexity: High

## Context

### Current State
- Frontend stores ArchitectureModel in browser localStorage
- No server-side persistence
- No multi-file support

### What Needs to Change
1. Create PostgreSQL database with schema for all entity types
2. Create Java Spring Boot service with HTTP APIs
3. Implement model load/save by filename
4. Create DTOs matching frontend TypeScript types exactly

### Project Location
`architecture-model-service/` at repository root (alongside `frontend/`)

### Save Strategy
Truncate & Insert (delete existing data for model_file_id, insert fresh from payload)

### Frontend Type Reference
- 16 entity types in `MetaModelEntities`
- 7 relationship types in `MetaModelRelationships`
- Diagram with nodes, edges, decorations, interaction_edges
- All IDs are strings, temporal fields use "YYYY-Qn" format

---

## Task List

### Database Layer

#### Task Group 1: PostgreSQL Database Setup
**Dependencies:** None

- [x] 1.0 Complete database setup
  - [x] 1.1 Create database and user
    - Create database `architecture_model`
    - Create user `arch_model_user` with password `arch_model_password`
    - Grant all privileges on database to user
    - Commands:
      ```sql
      CREATE DATABASE architecture_model;
      CREATE USER arch_model_user WITH PASSWORD 'arch_model_password';
      GRANT ALL PRIVILEGES ON DATABASE architecture_model TO arch_model_user;
      ```
  - [x] 1.2 Create schema.sql file
    - File: `architecture-model-service/db/schema.sql`
    - Include all tables from the full schema below
  - [x] 1.3 Execute schema.sql
    - Run SQL against PostgreSQL to create all tables
    - Verify tables created correctly with `\dt` command
  - [x] 1.4 Write 2-4 focused verification queries
    - Query to verify all tables exist
    - Query to verify foreign key constraints
    - Query to verify indexes exist
  - [x] 1.5 Run verification queries
    - Ensure all 27 tables created
    - Ensure all foreign keys and indexes in place

**Acceptance Criteria:**
- Database and user exist with correct permissions
- All 27 tables created with correct columns and constraints
- Foreign keys enforce referential integrity
- Indexes created for performance-critical queries

**Files to Create:**
- `architecture-model-service/db/schema.sql`

**Full Schema Content:**
```sql
-- ============================================================================
-- Schema for Architecture Modelling Tool
-- Supports multiple named "files" via model_files table
-- All IDs are TEXT to match frontend string IDs
-- JSONB used for complex nested objects (styles, edge_points, etc.)
-- ============================================================================

-- Core "file" concept - each model_file is a named container
CREATE TABLE model_files (
  id           TEXT PRIMARY KEY,
  filename     TEXT NOT NULL UNIQUE,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  tags         TEXT
);

-- ============================================================================
-- BUSINESS DOMAIN ENTITIES
-- ============================================================================

CREATE TABLE business_users (
  id             TEXT PRIMARY KEY,
  model_file_id  TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  tags           TEXT
);

CREATE TABLE business_processes (
  id             TEXT PRIMARY KEY,
  model_file_id  TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  tags           TEXT,
  valid_from     TEXT,
  valid_to       TEXT
);

CREATE TABLE process_activities (
  id                     TEXT PRIMARY KEY,
  model_file_id          TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  business_process_id    TEXT NOT NULL REFERENCES business_processes(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  description            TEXT,
  sequence_order         INTEGER,
  frequency              TEXT,
  actor_hint             TEXT NOT NULL,
  user_interaction_level TEXT NOT NULL,
  tags                   TEXT,
  valid_from             TEXT,
  valid_to               TEXT
);

CREATE TABLE business_points (
  id                  TEXT PRIMARY KEY,
  model_file_id       TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT,
  kind                TEXT NOT NULL,
  business_process_id TEXT NOT NULL REFERENCES business_processes(id),
  process_activity_id TEXT REFERENCES process_activities(id),
  tags                TEXT,
  valid_from          TEXT,
  valid_to            TEXT
);

-- ============================================================================
-- APPLICATION DOMAIN ENTITIES
-- ============================================================================

CREATE TABLE applications (
  id             TEXT PRIMARY KEY,
  model_file_id  TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  app_type       TEXT,
  status         TEXT,
  tags           TEXT,
  valid_from     TEXT,
  valid_to       TEXT
);

CREATE TABLE application_components (
  id             TEXT PRIMARY KEY,
  model_file_id  TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  tags           TEXT,
  valid_from     TEXT,
  valid_to       TEXT
);

CREATE TABLE services (
  id                       TEXT PRIMARY KEY,
  model_file_id            TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  application_id           TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  application_component_id TEXT REFERENCES application_components(id),
  name                     TEXT NOT NULL,
  description              TEXT,
  service_type             TEXT,
  tags                     TEXT,
  valid_from               TEXT,
  valid_to                 TEXT
);

CREATE TABLE interfaces (
  id             TEXT PRIMARY KEY,
  model_file_id  TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  service_id     TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  interface_type TEXT,
  spec_link      TEXT,
  tags           TEXT,
  valid_from     TEXT,
  valid_to       TEXT
);

CREATE TABLE endpoints (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  interface_id       TEXT NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT,
  endpoint_type      TEXT,
  path_or_address    TEXT,
  protocol           TEXT,
  operation_verb     TEXT,
  direction          TEXT,
  lifecycle_status   TEXT,
  version            TEXT,
  tags               TEXT,
  valid_from         TEXT,
  valid_to           TEXT
);

CREATE TABLE application_points (
  id                       TEXT PRIMARY KEY,
  model_file_id            TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  description              TEXT,
  kind                     TEXT NOT NULL,
  application_id           TEXT NOT NULL REFERENCES applications(id),
  application_component_id TEXT REFERENCES application_components(id),
  service_id               TEXT REFERENCES services(id),
  interface_id             TEXT REFERENCES interfaces(id),
  point_type               TEXT,
  tags                     TEXT,
  valid_from               TEXT,
  valid_to                 TEXT
);

-- ============================================================================
-- DATA DOMAIN ENTITIES
-- ============================================================================

CREATE TABLE logical_data_entities (
  id             TEXT PRIMARY KEY,
  model_file_id  TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  tags           TEXT,
  valid_from     TEXT,
  valid_to       TEXT
);

CREATE TABLE logical_data_attributes (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  logical_entity_id  TEXT NOT NULL REFERENCES logical_data_entities(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT,
  data_type          TEXT,
  is_primary_key     BOOLEAN NOT NULL DEFAULT FALSE,
  is_nullable        BOOLEAN NOT NULL DEFAULT TRUE,
  tags               TEXT
);

CREATE TABLE physical_data_entities (
  id             TEXT PRIMARY KEY,
  model_file_id  TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  physical_type  TEXT,
  database_name  TEXT,
  tags           TEXT,
  valid_from     TEXT,
  valid_to       TEXT
);

CREATE TABLE physical_data_attributes (
  id                   TEXT PRIMARY KEY,
  model_file_id        TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  physical_entity_id   TEXT NOT NULL REFERENCES physical_data_entities(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT,
  data_type            TEXT,
  is_primary_key       BOOLEAN NOT NULL DEFAULT FALSE,
  is_nullable          BOOLEAN NOT NULL DEFAULT TRUE,
  tags                 TEXT
);

-- ============================================================================
-- INTERACTION DOMAIN ENTITIES
-- ============================================================================

CREATE TABLE app_business_points (
  id               TEXT PRIMARY KEY,
  model_file_id    TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  tags             TEXT,
  valid_from       TEXT,
  valid_to         TEXT
);

CREATE TABLE interactions (
  id                              TEXT PRIMARY KEY,
  model_file_id                   TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                            TEXT NOT NULL,
  description                     TEXT,
  user_id                         TEXT REFERENCES business_users(id),
  primary_app_business_point_id   TEXT NOT NULL REFERENCES app_business_points(id),
  secondary_app_business_point_id TEXT REFERENCES app_business_points(id)
);

-- ============================================================================
-- RELATIONSHIP TABLES
-- ============================================================================

CREATE TABLE business_user_business_points (
  id                TEXT PRIMARY KEY,
  model_file_id     TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  business_user_id  TEXT NOT NULL REFERENCES business_users(id),
  business_point_id TEXT NOT NULL REFERENCES business_points(id),
  description       TEXT,
  tags              TEXT,
  valid_from        TEXT,
  valid_to          TEXT
);

CREATE TABLE application_point_business_points (
  id                   TEXT PRIMARY KEY,
  model_file_id        TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  application_point_id TEXT NOT NULL REFERENCES application_points(id),
  business_point_id    TEXT NOT NULL REFERENCES business_points(id),
  description          TEXT,
  tags                 TEXT,
  valid_from           TEXT,
  valid_to             TEXT
);

CREATE TABLE logical_data_entity_relationships (
  id                TEXT PRIMARY KEY,
  model_file_id     TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  source_entity_id  TEXT NOT NULL REFERENCES logical_data_entities(id),
  target_entity_id  TEXT NOT NULL REFERENCES logical_data_entities(id),
  relationship_type TEXT NOT NULL,
  description       TEXT,
  tags              TEXT,
  valid_from        TEXT,
  valid_to          TEXT
);

CREATE TABLE logical_data_entity_physical_data_entities (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  logical_entity_id  TEXT NOT NULL REFERENCES logical_data_entities(id),
  physical_entity_id TEXT NOT NULL REFERENCES physical_data_entities(id),
  description        TEXT,
  tags               TEXT,
  valid_from         TEXT,
  valid_to           TEXT
);

CREATE TABLE logical_data_attribute_physical_data_attributes (
  id                    TEXT PRIMARY KEY,
  model_file_id         TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  logical_attribute_id  TEXT NOT NULL REFERENCES logical_data_attributes(id),
  physical_attribute_id TEXT NOT NULL REFERENCES physical_data_attributes(id),
  description           TEXT,
  tags                  TEXT,
  valid_from            TEXT,
  valid_to              TEXT
);

CREATE TABLE data_movements (
  id                          TEXT PRIMARY KEY,
  model_file_id               TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  source_application_point_id TEXT NOT NULL REFERENCES application_points(id),
  target_application_point_id TEXT NOT NULL REFERENCES application_points(id),
  data_entity_id              TEXT,
  movement_type               TEXT,
  description                 TEXT,
  tags                        TEXT,
  valid_from                  TEXT,
  valid_to                    TEXT
);

CREATE TABLE interface_logical_entities (
  id                TEXT PRIMARY KEY,
  model_file_id     TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  interface_id      TEXT NOT NULL REFERENCES interfaces(id),
  logical_entity_id TEXT NOT NULL REFERENCES logical_data_entities(id),
  description       TEXT,
  tags              TEXT,
  valid_from        TEXT,
  valid_to          TEXT
);

-- ============================================================================
-- DIAGRAM TABLES
-- ============================================================================

CREATE TABLE diagrams (
  id            TEXT PRIMARY KEY,
  model_file_id TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  diagram_type  TEXT,
  settings      JSONB,
  view_quarter  TEXT
);

CREATE TABLE diagram_nodes (
  id                       TEXT PRIMARY KEY,
  model_file_id            TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  diagram_id               TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  entity_type              TEXT NOT NULL,
  entity_id                TEXT NOT NULL,
  pos_x                    DOUBLE PRECISION NOT NULL,
  pos_y                    DOUBLE PRECISION NOT NULL,
  width                    DOUBLE PRECISION,
  height                   DOUBLE PRECISION,
  auto_size                BOOLEAN DEFAULT TRUE,
  z_index                  INTEGER DEFAULT 0,
  parent_node_id           TEXT,
  style_override           JSONB,
  text_h_align             TEXT,
  text_v_align             TEXT,
  text_area_width          DOUBLE PRECISION,
  text_font_size           TEXT,
  text_font_weight         TEXT,
  text_font_style          TEXT,
  text_text_decoration     TEXT,
  background_color         TEXT,
  line_color               TEXT,
  text_color               TEXT,
  render_style             TEXT,
  embedded_attribute_ids   JSONB,
  selected_attribute_ids   JSONB,
  embedded_endpoint_ids    JSONB,
  embedded_entity_ids      JSONB,
  valid_from               TEXT,
  valid_to                 TEXT
);

CREATE TABLE diagram_edges (
  id                  TEXT PRIMARY KEY,
  model_file_id       TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  diagram_id          TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  relationship_type   TEXT NOT NULL,
  relationship_id     TEXT NOT NULL,
  source_node_id      TEXT NOT NULL,
  target_node_id      TEXT NOT NULL,
  label_text          TEXT,
  label_pos_x         DOUBLE PRECISION,
  label_pos_y         DOUBLE PRECISION,
  line_weight         TEXT,
  line_type           TEXT,
  line_dashes         TEXT,
  arrow_start         TEXT,
  arrow_end           TEXT,
  style_override      JSONB,
  edge_points         JSONB NOT NULL,
  label_font_size     TEXT,
  label_font_weight   TEXT,
  label_font_style    TEXT,
  label_text_decoration TEXT,
  label_h_align       TEXT,
  label_v_align       TEXT,
  line_color          TEXT,
  text_color          TEXT,
  sub_type            TEXT,
  source_label_text   TEXT,
  source_label_pos_x  DOUBLE PRECISION,
  source_label_pos_y  DOUBLE PRECISION,
  target_label_text   TEXT,
  target_label_pos_x  DOUBLE PRECISION,
  target_label_pos_y  DOUBLE PRECISION,
  z_index             INTEGER DEFAULT 110,
  valid_from          TEXT,
  valid_to            TEXT
);

CREATE TABLE diagram_interaction_edges (
  id                     TEXT PRIMARY KEY,
  model_file_id          TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  diagram_id             TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  interaction_id         TEXT NOT NULL REFERENCES interactions(id),
  relationship_type      TEXT NOT NULL DEFAULT 'USER_INTERACTION',
  source_node_id         TEXT NOT NULL,
  target_node_id         TEXT NOT NULL,
  edge_points            JSONB NOT NULL,
  label_text             TEXT,
  label_pos_x            DOUBLE PRECISION,
  label_pos_y            DOUBLE PRECISION,
  user_node_id           TEXT,
  user_link_edge_points  JSONB,
  line_style             TEXT DEFAULT 'dotted'
);

CREATE TABLE diagram_decorations (
  id               TEXT PRIMARY KEY,
  model_file_id    TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  diagram_id       TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  decoration_type  TEXT NOT NULL,
  text             TEXT,
  text_font_size   DOUBLE PRECISION,
  text_font_weight TEXT,
  text_font_style  TEXT,
  text_color       TEXT,
  line_color       TEXT,
  line_style       TEXT,
  line_weight      TEXT,
  z_index          INTEGER DEFAULT 0,
  valid_from       TEXT,
  valid_to         TEXT,
  -- Shape decoration fields
  pos_x            DOUBLE PRECISION,
  pos_y            DOUBLE PRECISION,
  width            DOUBLE PRECISION,
  height           DOUBLE PRECISION,
  text_h_align     TEXT,
  text_v_align     TEXT,
  background_color TEXT,
  auto_size        BOOLEAN,
  -- Line decoration fields
  line_points      JSONB,
  label_pos_x      DOUBLE PRECISION,
  label_pos_y      DOUBLE PRECISION,
  arrow_start      TEXT,
  arrow_end        TEXT
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX idx_business_users_model_file ON business_users(model_file_id);
CREATE INDEX idx_business_processes_model_file ON business_processes(model_file_id);
CREATE INDEX idx_process_activities_model_file ON process_activities(model_file_id);
CREATE INDEX idx_business_points_model_file ON business_points(model_file_id);
CREATE INDEX idx_applications_model_file ON applications(model_file_id);
CREATE INDEX idx_application_components_model_file ON application_components(model_file_id);
CREATE INDEX idx_services_model_file ON services(model_file_id);
CREATE INDEX idx_interfaces_model_file ON interfaces(model_file_id);
CREATE INDEX idx_endpoints_model_file ON endpoints(model_file_id);
CREATE INDEX idx_application_points_model_file ON application_points(model_file_id);
CREATE INDEX idx_logical_data_entities_model_file ON logical_data_entities(model_file_id);
CREATE INDEX idx_logical_data_attributes_model_file ON logical_data_attributes(model_file_id);
CREATE INDEX idx_physical_data_entities_model_file ON physical_data_entities(model_file_id);
CREATE INDEX idx_physical_data_attributes_model_file ON physical_data_attributes(model_file_id);
CREATE INDEX idx_app_business_points_model_file ON app_business_points(model_file_id);
CREATE INDEX idx_interactions_model_file ON interactions(model_file_id);
CREATE INDEX idx_diagrams_model_file ON diagrams(model_file_id);
CREATE INDEX idx_diagram_nodes_diagram ON diagram_nodes(diagram_id);
CREATE INDEX idx_diagram_edges_diagram ON diagram_edges(diagram_id);
CREATE INDEX idx_diagram_interaction_edges_diagram ON diagram_interaction_edges(diagram_id);
CREATE INDEX idx_diagram_decorations_diagram ON diagram_decorations(diagram_id);
```

---

### Spring Boot Project Setup

#### Task Group 2: Maven Project Initialization
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete Maven project setup
  - [x] 2.1 Create project directory structure
    - Create `architecture-model-service/`
    - Create directories: `src/main/java/com/example/architecturemodel/`, `src/main/resources/`, `src/test/java/com/example/architecturemodel/`, `src/test/resources/`, `db/`
  - [x] 2.2 Create pom.xml
    - File: `architecture-model-service/pom.xml`
    - Java 21, Spring Boot 3.2.x
    - Dependencies: spring-boot-starter-web, spring-boot-starter-data-jpa, postgresql, lombok, jackson-databind, hibernate-types, spring-boot-starter-test, h2
  - [x] 2.3 Create application.yml
    - File: `architecture-model-service/src/main/resources/application.yml`
    - Database connection: `jdbc:postgresql://localhost:5432/architecture_model`
    - Username: `arch_model_user`, Password: `arch_model_password`
    - Server port: 8080, JPA settings: `ddl-auto: validate`
  - [x] 2.4 Create main application class
    - File: `src/main/java/com/example/architecturemodel/ArchitectureModelApplication.java`
  - [x] 2.5 Verify project builds with `mvn clean compile`

**Acceptance Criteria:**
- Maven project builds without errors
- All dependencies resolve successfully

**Files to Create:**
- `architecture-model-service/pom.xml`
- `architecture-model-service/src/main/resources/application.yml`
- `architecture-model-service/src/main/java/com/example/architecturemodel/ArchitectureModelApplication.java`

---

### DTO Layer

#### Task Group 3: Core and Container DTOs
**Dependencies:** Task Group 2

- [x] 3.0 Complete core DTOs
  - [x] 3.1 Create ArchitectureModelDto - Fields: `MetaModelDto metaModel`, `List<DiagramDto> diagrams`
  - [x] 3.2 Create MetaModelDto - Fields: `MetaModelEntitiesDto entities`, `MetaModelRelationshipsDto relationships`
  - [x] 3.3 Create MetaModelEntitiesDto - 16 entity list fields matching frontend
  - [x] 3.4 Create MetaModelRelationshipsDto - 7 relationship list fields matching frontend
  - [x] 3.5 Create ModelFileSummaryDto - Fields: id, filename, description, createdAt, updatedAt, isDefault, tags

**Files to Create:** 5 files in `src/main/java/com/example/architecturemodel/model/dto/`

---

#### Task Group 4: Entity DTOs
**Dependencies:** Task Group 3

- [x] 4.0 Complete entity DTOs
  - [x] 4.1 Business domain: BusinessUserDto, BusinessProcessDto, ProcessActivityDto, BusinessPointDto
  - [x] 4.2 Application domain: ApplicationDto, ApplicationComponentDto, ServiceDto, InterfaceDto, EndpointDto, ApplicationPointDto
  - [x] 4.3 Data domain: LogicalDataEntityDto, LogicalDataAttributeDto, PhysicalDataEntityDto, PhysicalDataAttributeDto
  - [x] 4.4 Interaction domain: AppBusinessPointDto, InteractionDto

**Files to Create:** 16 files in `src/main/java/com/example/architecturemodel/model/dto/entity/`

---

#### Task Group 5: Relationship DTOs
**Dependencies:** Task Group 3

- [x] 5.0 Create all 7 relationship DTOs
  - BusinessUserBusinessPointDto, ApplicationPointBusinessPointDto, LogicalDataEntityRelationshipDto, LogicalDataEntityPhysicalDataEntityDto, LogicalDataAttributePhysicalDataAttributeDto, DataMovementDto, InterfaceLogicalEntityDto

**Files to Create:** 7 files in `src/main/java/com/example/architecturemodel/model/dto/relationship/`

---

#### Task Group 6: Diagram DTOs
**Dependencies:** Task Group 3

- [x] 6.0 Complete diagram DTOs
  - [x] 6.1 DiagramDto with nodes, edges, decorations, interaction_edges
  - [x] 6.2 DiagramNodeDto with all styling fields
  - [x] 6.3 DiagramEdgeDto with edge_points JSONB
  - [x] 6.4 EdgePointDto, DiagramInteractionEdgeDto, DecorationDto, LinePointDto

**Files to Create:** 7 files in `src/main/java/com/example/architecturemodel/model/dto/diagram/`

---

### JPA Entity Layer

#### Task Group 7: JPA Entities - Core and Business Domain
**Dependencies:** Task Group 2

- [x] 7.0 Create ModelFileEntity, BusinessUserEntity, BusinessProcessEntity, ProcessActivityEntity, BusinessPointEntity

**Files to Create:** 5 files in `src/main/java/com/example/architecturemodel/model/entity/`

---

#### Task Group 8: JPA Entities - Application and Data Domain
**Dependencies:** Task Group 7

- [x] 8.0 Create Application, Data, and Interaction domain entities (12 total)

**Files to Create:** 12 files

---

#### Task Group 9: JPA Entities - Relationships and Diagrams
**Dependencies:** Task Group 8

- [x] 9.0 Create 7 Relationship entities + 5 Diagram entities with JSONB mappings

**Files to Create:** 12 files

---

### Repository Layer

#### Task Group 10: JPA Repositories
**Dependencies:** Task Group 9

- [x] 10.0 Create all repositories
  - [x] 10.1 ModelFileRepository with findByFilename, findByIsDefaultTrue
  - [x] 10.2 16 entity repositories with findByModelFileId
  - [x] 10.3 7 relationship repositories
  - [x] 10.4 5 diagram repositories with findByDiagramId

**Files to Create:** 29 repository interfaces

---

### Service Layer

#### Task Group 11: Model Service - Load Operations
**Dependencies:** Task Groups 4, 5, 6, 10

- [x] 11.0 Complete model load service
  - [x] 11.1 Write 4-6 focused tests for load operations
  - [x] 11.2 Create ModelService class
  - [x] 11.3 Implement getModelFilenames()
  - [x] 11.4 Implement loadModel(filename)
  - [x] 11.5 Create EntityMapper class
  - [x] 11.6 Create DiagramMapper class
  - [x] 11.7 Ensure load operation tests pass

**Files to Create:** ModelService.java, EntityMapper.java, DiagramMapper.java, ModelServiceLoadTest.java

---

#### Task Group 12: Model Service - Save Operations
**Dependencies:** Task Group 11

- [x] 12.0 Complete model save service
  - [x] 12.1 Write 4-6 focused tests for save operations
  - [x] 12.2 Implement saveModel(filename, model) with Truncate & Insert
  - [x] 12.3 Handle insertion order respecting FK constraints
  - [x] 12.4 Add DTO -> Entity mapper methods
  - [x] 12.5 Implement deleteModel(filename)
  - [x] 12.6 Ensure save operation tests pass

**Files to Create:** ModelServiceSaveTest.java

---

### Controller Layer

#### Task Group 13: REST Controllers
**Dependencies:** Task Groups 11, 12

- [x] 13.0 Complete REST controllers
  - [x] 13.1 Write 4-6 focused tests for endpoints
  - [x] 13.2 Create ModelController with GET/PUT/DELETE endpoints
  - [x] 13.3 Create GlobalExceptionHandler for 404/400/500
  - [x] 13.4 Create CORS configuration for frontend
  - [x] 13.5 Ensure controller tests pass

**Files to Create:** ModelController.java, GlobalExceptionHandler.java, ResourceNotFoundException.java, WebConfig.java, ModelControllerTest.java

---

### Testing Layer

#### Task Group 14: Test Review and Gap Analysis
**Dependencies:** Task Groups 11, 12, 13

- [x] 14.0 Review and fill test gaps
  - [x] 14.1 Review existing 12-18 tests from Task Groups 11-13
  - [x] 14.2 Identify critical gaps (JSONB, temporal fields, polymorphism)
  - [x] 14.3 Write up to 10 additional strategic tests
  - [x] 14.4 Create test-model.json with all entity types
  - [x] 14.5 Run all feature tests (expected ~25 total)

**Files to Create:** test-model.json, additional test files as needed

---

### Final Verification

#### Task Group 15: Integration Verification
**Dependencies:** Task Groups 1-14

- [x] 15.0 Complete final verification
  - [x] 15.1 Start PostgreSQL and execute schema.sql
  - [x] 15.2 Start Spring Boot application
  - [x] 15.3 Manual API testing with curl
  - [x] 15.4 Verify JSON matches frontend types (snake_case)
  - [x] 15.5 Document frontend integration notes

---

## Execution Order

```
Phase 1 (Parallel): Task Groups 1 + 2
Phase 2: Task Group 3 (depends on 2)
Phase 3 (Parallel): Task Groups 4, 5, 6 (depend on 3)
Phase 4 (Sequential): Task Groups 7 -> 8 -> 9 (can parallel with Phase 3)
Phase 5: Task Group 10 (depends on 9)
Phase 6: Task Groups 11 -> 12 (depend on 4-6, 10)
Phase 7: Task Group 13 (depends on 11, 12)
Phase 8: Task Group 14 (depends on 13)
Phase 9: Task Group 15 (depends on all)
```

---

## Key Design Decisions

1. **TEXT IDs**: All primary keys are TEXT to match frontend string IDs
2. **JSONB for complex fields**: style_override, edge_points, settings stored as JSONB
3. **Temporal fields as TEXT**: valid_from/valid_to stored as TEXT in "YYYY-Qn" format
4. **Cascading deletes**: ON DELETE CASCADE from model_files to all child tables
5. **Save strategy**: Truncate & Insert (simpler than upsert)
6. **Property naming**: snake_case in JSON to match frontend
7. **Separate interaction_edges table**: New table for DiagramInteractionEdge

---

## Success Criteria

1. **Database**: All 27 tables created with constraints and indexes
2. **API**: All 4 endpoints (GET filenames, GET/PUT/DELETE model) working
3. **Round-trip**: Model saved via PUT retrievable via GET identically
4. **Compatibility**: JSON matches frontend TypeScript types exactly
5. **Tests**: All ~25 focused tests pass

---

## File Summary

| Directory | Count | Description |
|-----------|-------|-------------|
| `db/` | 1 | schema.sql |
| `model/dto/` | 5 | Core DTOs |
| `model/dto/entity/` | 16 | Entity DTOs |
| `model/dto/relationship/` | 7 | Relationship DTOs |
| `model/dto/diagram/` | 7 | Diagram DTOs |
| `model/entity/` | ~30 | JPA entities |
| `repository/` | ~29 | JPA repositories |
| `service/` + `mapper/` | 3 | Service and mappers |
| `controller/` + `config/` + `exception/` | 4 | Controller layer |
| `src/test/` | ~5 | Test classes |

**Estimated Total: ~105 files**
