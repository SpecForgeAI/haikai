# Requirements: Business Logic Entity + ApplicationPoint Join Table (v1)

## Title
Add Business Logic entity + ApplicationPoint<->BusinessLogic join table and persist via model load/save (v1)

## Intent
Introduce a new behavioural architecture concept "Business Logic" that can be stored in the meta-model and persisted in the database, along with a many-to-many join table linking Business Logic to Application Points. This v1 delivers core persistence and "basic CRUD" via the existing whole-model load/save mechanism (/api/model GET/PUT), without adding dedicated UI for managing links yet.

## Scope
- backend (architecture-model-service):
  - DB schema (Liquibase)
  - JPA entities + repositories
  - DTOs + mappers
  - ModelService load/save wiring for entities + relationships
- frontend:
  - model types/defaults updated to include business_logics entity collection and application_point_business_logics relationship collection (empty for now)
  - add "Business Logics" to meta-model grid configuration so users can create/edit/delete rows in-memory and persist via existing File -> Save

## Non-goals (explicitly out of scope)
- UI to attach/detach Business Logic to Application Points (relationship management UX comes in Spec 2)
- Expanding "Application Point" selection to include Class/Method (also Spec 2)
- Templates / type suggestions (Spec 4 / Spec 3)

## Data Model (v1)

### BusinessLogic
| Field | Type | Constraints |
|-------|------|-------------|
| id | string | UUID, Primary Key |
| model_file_id | string | FK to model_files.id, ON DELETE CASCADE |
| name | string | Required |
| type_text | string | Optional, free-text |
| description_md | text | Optional, markdown |
| tags | string | Optional |
| valid_from | string | Optional |
| valid_to | string | Optional |

### ApplicationPointBusinessLogic (join relationship)
| Field | Type | Constraints |
|-------|------|-------------|
| id | string | UUID, Primary Key |
| model_file_id | string | FK to model_files.id, ON DELETE CASCADE |
| application_point_id | string | FK to application_points.id, ON DELETE CASCADE |
| business_logic_id | string | FK to business_logics.id, ON DELETE CASCADE |
| description | string | Optional |
| tags | string | Optional |
| valid_from | string | Optional |
| valid_to | string | Optional |

## Backend Implementation Requirements

### 1) Liquibase
- Add new changelog SQL file: sql/015-business-logic.sql
- Create table business_logics with all columns
- Create table application_point_business_logics with all columns
- Add FKs with ON DELETE CASCADE
- Add indexes on foreign key columns
- Add unique composite constraint to prevent duplicate links

### 2) JPA entities + repositories
- BusinessLogicEntity mapped to "business_logics"
- ApplicationPointBusinessLogicEntity mapped to "application_point_business_logics"
- Follow existing style (String id fields, Lombok @Builder)
- Add Spring Data JPA repositories

### 3) DTOs
- BusinessLogicDto with @JsonProperty for snake_case
- ApplicationPointBusinessLogicDto with @JsonProperty for snake_case

### 4) MetaModel DTO wiring
- Update MetaModelEntitiesDto to include businessLogics
- Update MetaModelRelationshipsDto to include applicationPointBusinessLogics

### 5) Mappers
- Update EntityMapper with toDto/toEntity for both new entities

### 6) ModelService load/save integration
- saveEntities: persist businessLogics
- saveRelationships: persist applicationPointBusinessLogics
- deleteAllDataForModelFile: include new tables
- loadModel: include new entities and relationships

## Frontend Implementation Requirements

### 1) Types (model.ts)
- Add BusinessLogic interface
- Add ApplicationPointBusinessLogic interface
- Extend MetaModelEntities with business_logics
- Extend MetaModelRelationships with application_point_business_logics

### 2) Defaults (defaults.ts)
- Add business_logics: [] to entities defaults
- Add application_point_business_logics: [] to relationships defaults

### 3) Grid config (gridConfigs.ts)
- Add grid config for "business_logics" with columns: name, type_text, description_md, tags, valid_from, valid_to
- Add to Behavioural domain mapping

## Constraints
- Business Logic type is free-text; no enums
- No UI linking/attach workflows in this spec
- No changes to ApplicationPoint schema

## Acceptance Criteria
- Backend migrates and creates both tables
- GET /api/model returns business_logics data
- PUT /api/model persists Business Logic rows
- Users can CRUD Business Logic in MetaModel UI grid
- Model save/load round-trips without errors
