# Requirements: Add Behavioural Architecture State Modelling

## Title
Add Behavioural Architecture state modelling (State and StateTransition entities)

## Intent
- Introduce state-based behavioural modelling to the architecture meta-model.
- Add two new Behavioural Architecture entities:
  1) State
  2) StateTransition
- Allow StateTransitions to be triggered by:
  - an Event entity
  - a Method entity
  - or free-text label
- Make these entities fully manageable via the Meta-Model view.
- Do not implement state diagram rendering or diagram-specific UI in this spec.

## Scope

### In Scope
- Backend schema and persistence for State and StateTransition
- Backend CRUD APIs
- Frontend Meta-Model tables (Behavioural Architecture domain)

### Out of Scope
- State diagram visualisation
- Diagram palette changes
- Sequence/activity entities
- Gateway/MCP changes

## Acceptance Criteria
- Backend starts without schema or validation errors.
- Users can create, edit, and delete States.
- Users can create, edit, and delete StateTransitions.
- A StateTransition:
  - must reference a source State and target State
  - must have exactly one trigger (Event reference, Method reference, or label text)
  - may optionally have a guard and/or effect
- States and StateTransitions appear only under Behavioural Architecture in the Meta-Model view.
- No regression to existing entities or relationships.

## Data Model

### State (Behavioural Architecture)
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | UUID (PK) | Yes | Auto-generated |
| model_file_id | UUID (FK) | Yes | References model_files |
| name | text | Yes | |
| description | text | No | |
| state_kind | text enum | Yes | Values: Initial, Normal, Final |
| owner_ref_kind | text | No | Polymorphic reference type |
| owner_ref_id | text | No | Polymorphic reference id |
| created_at / updated_at | timestamp | | |

### StateTransition (Behavioural Architecture)
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | UUID (PK) | Yes | Auto-generated |
| model_file_id | UUID (FK) | Yes | References model_files |
| from_state_id | UUID (FK) | Yes | References states.id |
| to_state_id | UUID (FK) | Yes | References states.id |
| trigger_ref_kind | text enum | Conditional | Event or Method |
| trigger_ref_id | text | Conditional | |
| trigger_label_text | text | Conditional | |
| guard_ref_kind | text enum | No | Method |
| guard_ref_id | text | No | |
| guard_expression | text | No | |
| effect_ref_kind | text enum | No | Method |
| effect_ref_id | text | No | |
| effect_label_text | text | No | |
| order_index | int | No | |
| description | text | No | |
| created_at / updated_at | timestamp | | |

### Validation Rules
- from_state_id and to_state_id must belong to the same model_file_id
- Exactly one trigger must be supplied:
  - either (trigger_ref_kind + trigger_ref_id)
  - or trigger_label_text
- Guard must be either:
  - (guard_ref_kind + guard_ref_id)
  - or guard_expression
- Effect must be either:
  - (effect_ref_kind + effect_ref_id)
  - or effect_label_text

## Backend Implementation Steps

### 1) Database Migration (Liquibase)
- Create table: states
- Create table: state_transitions
- Add indexes:
  - states.model_file_id
  - state_transitions.model_file_id
  - state_transitions.from_state_id
  - state_transitions.to_state_id
- Add foreign keys:
  - state_transitions.from_state_id -> states.id
  - state_transitions.to_state_id -> states.id
- Do NOT cascade deletes at DB level.

### 2) JPA Entities
- Implement StateEntity and StateTransitionEntity.
- Map enums as Strings.
- Enforce validation rules in service layer, not via DB constraints.

### 3) Repositories
- StateRepository:
  - findAllByModelFileId(...)
  - existsByIdAndModelFileId(...)
- StateTransitionRepository:
  - findAllByModelFileId(...)
  - existsByFromStateId(...)
  - existsByToStateId(...)

### 4) Services
- On State delete:
  - if any StateTransition references the State as source or target,
    reject delete with a clear error (e.g. HTTP 409).
- On StateTransition create/update:
  - validate trigger, guard, and effect rules.

### 5) Controllers / APIs
- Expose CRUD endpoints:

#### States
```
GET    /api/model-files/{modelFileId}/states
POST   /api/model-files/{modelFileId}/states
PUT    /api/model-files/{modelFileId}/states/{id}
DELETE /api/model-files/{modelFileId}/states/{id}
```

#### StateTransitions
```
GET    /api/model-files/{modelFileId}/state-transitions
POST   /api/model-files/{modelFileId}/state-transitions
PUT    /api/model-files/{modelFileId}/state-transitions/{id}
DELETE /api/model-files/{modelFileId}/state-transitions/{id}
```

## Frontend Implementation Steps

### 1) Types and State
- Add entity keys:
  - states
  - stateTransitions
- Define TS types:
  - StateRow: id, name, description?, stateKind, ownerRefKind?, ownerRefId?
  - StateTransitionRow: id, fromStateId, toStateId, description?, orderIndex?, triggerRefKind?, triggerRefId?, triggerLabelText?, guardRefKind?, guardRefId?, guardExpression?, effectRefKind?, effectRefId?, effectLabelText?

### 2) API Client
- Implement CRUD API calls for states and state transitions.
- Integrate into existing model load/save flows.

### 3) Meta-Model UI (Behavioural Architecture)
- Add two entity tabs:
  - States
  - State Transitions

#### States Grid
- name (required)
- stateKind (required dropdown: Initial | Normal | Final)
- description (optional)
- ownerRefKind (optional)
- ownerRefId (optional)

#### State Transitions Grid
- fromStateId (required FK typeahead -> States)
- toStateId (required FK typeahead -> States)
- description (optional)
- orderIndex (optional)

**Trigger (required):**
- UI mode selector: Event | Method | Text
- Event -> FK typeahead to Events
- Method -> FK typeahead to Methods
- Text -> free text input
- Switching mode clears other trigger fields.

**Guard (optional):**
- UI mode selector: None | Method | Text
- Switching clears other fields.

**Effect (optional):**
- UI mode selector: None | Method | Text
- Switching clears other fields.

### 4) Domain Visibility
- States and State Transitions appear only under Behavioural Architecture.
- No diagram palette changes in this spec.

## Tests

### Backend
- Create State
- Create StateTransition with Event trigger
- Create StateTransition with Method trigger
- Create StateTransition with label trigger
- Reject invalid trigger combinations
- Prevent deleting State referenced by transitions

### Frontend
- Behavioural domain shows States and State Transitions tabs
- Trigger/guard/effect mode switching enforces one-of rules

## Deliverable
- Behavioural Architecture supports persistent state modelling via State and StateTransition.
- Entities are editable in Meta-Model view and ready for future state diagram visualisation.
