# Requirements: Add Application Architecture entities: Class and Method

## Title
Add Application Architecture entities: Class and Method (frontend + backend meta-model persistence)

## Intent
- Introduce two new Application Architecture meta-model entities:
  1. Class
  2. Method (owned by exactly one Class via FK field on Method)
- Enable CRUD in the Meta-Model UI (tables/grids) and persistence in architecture-model-service
- Keep all "signature-like" fields on Method OPTIONAL (parameters/returns/throws)
- Do NOT add a separate "Class ↔ Method relationship" entity/table; represent ownership via Method.class_id only
- No diagram UI changes in this spec

## Scope

### In Scope
- **architecture-model-service:**
  - DB schema + JPA/entities/repositories/services/controllers for Class + Method
  - Include in model-file scoping consistent with existing entities
- **frontend:**
  - Add Class + Method entity types to model, state, reducers
  - Add meta-model grid configs + columns
  - Add to Application Architecture domain grouping (so they appear under the Application domain in the Meta-Model view)
  - Enable FK typeahead from Method -> Class

### Out of Scope
- Diagram rendering/placement for Class/Method
- Sequence/state/activity entities (handled in later specs)
- Any gateway/MCP changes
- Adding new relationships beyond the Method.classId FK

## Assumptions
- The tool already supports:
  - Model-file scoped entities
  - Standard CRUD endpoints pattern per entity
  - Frontend grid-based editing with fk_typeahead columns
- If the service uses "row tables" + generic controllers, follow the established pattern

---

## Acceptance Criteria

### Backend
- DB contains tables for classes and methods
- Method row has required FK to parent class
- CRUD endpoints exist for listing/creating/updating/deleting Classes and Methods in a model file
- Method optional fields (parameters, returns, throws) may be omitted in requests and stored as null/empty

### Frontend
- Under Application Architecture domain, Meta-Model shows two new tabs: "Classes" and "Methods"
- "Classes" grid supports create/edit/delete:
  - name required
  - description optional
  - namespace optional
  - ownedByRefKind/ownedByRefId optional (polymorphic ownership)
- "Methods" grid supports create/edit/delete:
  - name required
  - classId required (FK typeahead to Classes)
  - description optional
  - parameters optional
  - returns optional
  - throws optional
- No runtime errors; existing entities unaffected

---

## Data Model

### 1) Class Entity (Application Architecture)

**Fields:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | UUID (PK) | Yes | Primary key |
| model_file_id | UUID (FK) | Yes | FK to model file |
| name | text | Yes | |
| description | text | No | |
| namespace | text | No | |
| owned_by_ref_kind | enum/text | No | Application, ApplicationComponent, Service, Interface |
| owned_by_ref_id | text | No | |
| created_at | timestamp | Yes | Follow existing convention |
| updated_at | timestamp | Yes | Follow existing convention |

**owned_by_ref_kind allowed values (string enum in code):**
- Application
- ApplicationComponent
- Service
- Interface

**Notes:**
- ownedBy is optional; if present then ownedByRefId must be present

### 2) Method Entity (Application Architecture)

**Fields:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | UUID (PK) | Yes | Primary key |
| model_file_id | UUID (FK) | Yes | FK to model file |
| class_id | UUID (FK) | Yes | FK to class.id |
| name | text | Yes | |
| description | text | No | |
| parameters_json | jsonb | No | Array of parameter objects |
| returns_json | jsonb | No | Return type object |
| throws_json | jsonb | No | Array of exception strings |
| created_at | timestamp | Yes | |
| updated_at | timestamp | Yes | |

**Method.parameters_json shape (optional):**
```json
[
  {
    "name": "string (required)",
    "refKind": "string enum (optional)",
    "refId": "string (optional)",
    "primitiveType": "string enum (optional)"
  }
]
```

**Method.returns_json shape (optional):**
```json
{
  "refKind": "string (optional)",
  "refId": "string (optional)",
  "primitiveType": "string enum (optional)"
}
```

**Method.throws_json shape (optional):**
```json
["ExceptionType1", "ExceptionType2"]
```

**primitiveType enum values:**
- string
- number
- integer
- boolean
- date
- datetime
- uuid

---

## API Contract (architecture-model-service)

Add endpoints consistent with existing entity style. If you have generic endpoints per entity-type, wire these two into that registry. If you use explicit controllers, add:

### Classes
- `GET    /api/model-files/{modelFileId}/classes`
- `POST   /api/model-files/{modelFileId}/classes`
- `PUT    /api/model-files/{modelFileId}/classes/{id}`
- `DELETE /api/model-files/{modelFileId}/classes/{id}`

### Methods
- `GET    /api/model-files/{modelFileId}/methods`
- `POST   /api/model-files/{modelFileId}/methods`
- `PUT    /api/model-files/{modelFileId}/methods/{id}`
- `DELETE /api/model-files/{modelFileId}/methods/{id}`

### Validation
- POST/PUT Method:
  - class_id must exist AND belong to same model_file_id
- POST/PUT Class:
  - if owned_by_ref_kind set then owned_by_ref_id required
  - owned_by_ref_kind must be one of allowed values

---

## Backend Implementation Steps

### 1) DB Migration
- Create table: `classes`
- Create table: `methods`
- Add indexes:
  - `classes(model_file_id)`
  - `methods(model_file_id)`
  - `methods(class_id)`
- Add FK:
  - `methods.class_id -> classes.id ON DELETE CASCADE` (so deleting a class deletes its methods)
- Add check/enum handling:
  - owned_by_ref_kind stored as VARCHAR with application-level validation

### 2) JPA/Entities
- Create entities:
  - `ClassEntity`
  - `MethodEntity`
- Map jsonb fields:
  - parametersJson / returnsJson / throwsJson
  - Use Jackson + Hibernate Types (or existing JSONB mapping utility)
  - If JSONB mapping isn't present, store as TEXT containing JSON and parse in service layer (fallback)

### 3) Repository + Service + Controller
- Mirror patterns used by existing meta-model entities
- Ensure all queries are scoped by modelFileId
- Enforce cross-scope validation (method.classId belongs to same model file)

---

## Frontend Implementation Steps

### 1) Types + State
- Add entity type keys:
  - `classes`
  - `methods`
- Define TS interfaces:
  - `ClassRow`: id, name, description?, namespace?, ownedByRefKind?, ownedByRefId?
  - `MethodRow`: id, classId, name, description?, parameters?, returns?, throws?
  - `Parameter` type: name, refKind?, refId?, primitiveType?
  - `Return` type: refKind?, refId?, primitiveType?
- Ensure ArchitectureContext initial state includes:
  - `classes: []`
  - `methods: []`

### 2) Grid Configs (Meta-Model Tables)
- Add "Classes" grid:
  - columns:
    - name (required)
    - description (optional)
    - namespace (optional)
    - ownedByRefKind (optional enum dropdown)
    - ownedByRefId (optional text)
- Add "Methods" grid:
  - columns:
    - classId (required, fk_typeahead to classes, display by class.name)
    - name (required)
    - description (optional)
    - parameters (optional, JSON text field v1)
    - returns (optional, JSON text field v1)
    - throws (optional, JSON text field or comma-separated string)

**NOTE:** Keep optional fields editable but do not require structured UI widgets in v1; JSON text area is acceptable for a PoC.

### 3) Domain Grouping + Tabs
- Add two entity tabs under Application Architecture domain:
  - "Classes"
  - "Methods"
- Ensure these appear only when Application domain selected

### 4) API Client Wiring
- Add API functions for classes/methods CRUD matching backend endpoints
- Integrate with existing grid CRUD flows (create/update/delete)
- Ensure Method create requires classId; UI should prevent save if missing

### 5) UX Small Rules
- When deleting a Class:
  - Backend cascades delete Methods
  - Frontend should refresh both classes and methods lists after deletion

---

## Tests

### Backend
- Create class, create method referencing class, list methods, delete class, verify methods deleted
- Validation: creating method with classId from different modelFileId fails

### Frontend
- Rendering: Application domain shows Classes and Methods tabs
- CRUD smoke: create class then method referencing it (if test harness supports)
- Ensure no regression to other domains/tabs

---

## Deliverables
- architecture-model-service supports persistent Class and Method entities (CRUD + DB tables)
- Frontend Meta-Model UI supports Classes and Methods grids under Application Architecture domain
- Method has required classId FK; no separate relationship entity/table is introduced
