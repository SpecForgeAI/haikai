# Requirements: Organisations Iteration 1 — Add Organisation Model + Project FK + APIs

## Overview

**Title:** Organisations Iteration 1 — Add Organisation Model + Project FK + APIs (Name Unique, Required)

**Context:** Projects must belong to an Organisation (Organisation 1:M Project). Organisations are selected by a unique organisation name in the UI (autocomplete). This iteration establishes the data model and API support only; UI modal changes are handled in later iterations.

**Goal:** Introduce a new Organisation entity/table and enforce that each Project references exactly one Organisation via a required foreign key. Provide APIs to (a) list organisations by name for autocomplete and (b) associate a project to an organisation during project create/save flows.

## Scope

### In Scope
- Postgres schema + migrations
- architecture-model-service: persistence model updates + endpoints
- gateway: proxy routes as needed to expose model-service APIs to frontend

### Out of Scope
- No UI changes in this iteration

## Data Model

### Organisation Table
- **Table:** `organisations`
- **Columns:**
  - `id`: string/uuid (PK)
  - `name`: string (NOT NULL, UNIQUE)
  - `description`: string (nullable)
- **Constraints:**
  - UNIQUE(name) (case-sensitive unless DB collation makes it otherwise)
  - name must be non-empty

### Project Table Change
- Add column: `organisation_id` (FK -> organisations.id) NOT NULL
- Add FK constraint with ON DELETE RESTRICT (or NO ACTION) to prevent deleting organisations while projects exist
- Ensure existing code paths treat `organisation_id` as required in the Project domain model

### Migration Notes
- This iteration does NOT need to backfill existing projects; user will manually create/link
- If DB requires a NOT NULL column on an existing table, introduce the change in two steps:
  1. Add `organisation_id` nullable
  2. Add API + code support
  3. Provide an admin/manual backfill path
  4. Then enforce NOT NULL in a follow-up migration (or include a temporary default org row)
- Choose the safest approach for the current DB state; avoid breaking existing projects

## API Contracts (architecture-model-service)

### GET /api/v1/organisations
**Purpose:** List organisations for autocomplete

**Response:**
```json
[
  { "id": "string", "name": "string" }
]
```
- Must return unique organisations ordered by name ascending

### GET /api/v1/organisations/by-name/{name}
**Purpose:** Get organisation by exact name

**Response:**
```json
{ "id": "string", "name": "string", "description": "string|null" }
```
- 404 if not found

### POST /api/v1/organisations
**Purpose:** Create a new organisation

**Request:**
```json
{ "name": "string", "description": "string|null" }
```

**Response:**
```json
{ "id": "string", "name": "string", "description": "string|null" }
```
- Must enforce uniqueness: If name already exists, return 409 Conflict with a clear message

### Project Create/Update Support
Update existing Project create and save-as endpoints (or underlying request DTOs) to accept:
- `organisationName`: string (required)
- OR `organisationId`: string (required)

**Preferred for UI:** `organisationName` (since selection is by name)

**Behavior:**
- If `organisationId` provided: validate it exists; link project to it
- If `organisationName` provided:
  - Lookup organisation by exact name
  - If found: link project to it
  - If not found: return 400 with message "Organisation not found" (UI will create organisations separately or in later iteration)
- Do NOT auto-create organisations in this iteration unless already required by current flows

## Validation Rules
- Organisation name must be unique and non-empty
- Project must have an organisation association (`organisation_id`) once the DB constraint is enforced
- API must fail fast and explicitly if an organisation reference is missing/invalid

## Gateway Routes
Add pass-through routes for:
- `GET /api/v1/organisations`
- `GET /api/v1/organisations/by-name/{name}`
- `POST /api/v1/organisations`

Routes should proxy to the architecture-model-service (if the frontend currently uses gateway-only access).

Ensure CORS and auth assumptions remain unchanged (no auth for now, consistent with existing).

## Acceptance Criteria
1. DB has an `organisations` table with (id, name unique, description)
2. Project domain model and persistence support `organisation_id` (FK) and API validation
3. Organisations can be created via API and name uniqueness is enforced (409 on duplicate)
4. Organisations can be listed via API for autocomplete
5. Project create/save flows can link a project to an existing organisation (by id or by name)
6. Existing functionality remains operational during transition (no hard break for existing projects)

## Non-Goals
- No UI modal updates in this iteration
- No automatic backfill of existing projects (user will handle manually)
- No organisation description editing UI
