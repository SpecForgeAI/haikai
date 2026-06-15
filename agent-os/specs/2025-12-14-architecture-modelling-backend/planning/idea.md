# Idea: Architecture Modelling Backend

## Summary

Add a PostgreSQL database and Java Spring Boot service to persist the Architecture Modelling Tool's meta-model and diagrams. The backend supports multiple named "files" (model_files) and exposes HTTP APIs for loading/saving models by filename, plus future granular CRUD operations.

## Components

### 1. PostgreSQL Database (meta-model-db)
- Database storing multiple ArchitectureModel "files" keyed by filename
- Schema mirrors the frontend TypeScript model types
- Supports all entity types: BusinessUser, Application, Service, Interface, etc.
- Supports all relationship types: BusinessUserBusinessPoint, DataMovement, etc.
- Supports diagram structures: nodes, edges, decorations, interaction edges

### 2. Java Spring Boot Service (architecture-model-service)
- HTTP APIs to load/save ArchitectureModel by filename
- Java DTOs matching frontend TypeScript interfaces
- Conversion between DTOs and relational schema
- Port 8080, base path `/api`

## Key API Endpoints

### File-Level Operations
- `GET /api/model/filenames` - List all saved model files
- `GET /api/model?filename=...` - Load full ArchitectureModel for filename
- `PUT /api/model?filename=...` - Save/replace ArchitectureModel for filename
- `DELETE /api/model?filename=...` - Delete model file and all associated data

### Entity CRUD (Future)
- `GET /api/model/{filename}/meta/entities/{entityType}` - List entities
- `POST /api/model/{filename}/meta/entities/{entityType}` - Create entity
- `GET/PUT/DELETE /api/model/{filename}/meta/entities/{entityType}/{id}`

### Diagram CRUD (Future)
- `GET /api/model/{filename}/diagrams` - List diagrams
- `GET/PUT/DELETE /api/model/{filename}/diagrams/{diagramId}`
- `POST /api/model/{filename}/diagrams` - Create diagram

## Frontend Model Types to Support

### Entities (16 types)
- BusinessUser, BusinessProcess, ProcessActivity, BusinessPoint
- Application, ApplicationComponent, Service, Interface, Endpoint, ApplicationPoint
- LogicalDataEntity, LogicalDataAttribute, PhysicalDataEntity, PhysicalDataAttribute
- Interaction, AppBusinessPoint

### Relationships (7 types)
- BusinessUserBusinessPoint, ApplicationPointBusinessPoint
- LogicalDataEntityRelationship, LogicalDataEntityPhysicalDataEntity
- LogicalDataAttributePhysicalDataAttribute, DataMovement, InterfaceLogicalEntity

### Diagram Elements
- DiagramNode (with styling, positioning, embedded attributes)
- DiagramEdge (with edge points, labels, styling)
- Decoration (ShapeDecoration and LineDecoration)
- DiagramInteractionEdge (for USER_INTERACTION edges)

## Technical Requirements

- Java 21, Maven build
- Spring Boot with Spring Data JPA
- PostgreSQL connection via JDBC
- Jackson for JSON serialization
- IDs as TEXT (strings) to match frontend
- JSONB for flexible styling fields
