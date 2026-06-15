# Requirements: Standardise Typed Diagrams by Storing Type-Specific Content as JSONB on Diagrams

## Intent

- Remove the inconsistent "separate aggregate tables" pattern (currently Sequence-only) and replace it with a single, consistent pattern:
    - All non-General diagram types (ER, Sequence, Activity, State) store their type-specific content in a JSONB column on the generic `diagrams` table.
- Eliminate the "typed diagram not found" failure class by ensuring typed content always exists (or defaults) as part of the diagram record.
- Keep General diagrams unchanged (no typed content required).
- Provide a migration path that preserves existing data where possible.

## Scope

### In Scope

- **architecture-model-service:**
    - Schema: add `typed_content_json` (jsonb) on `diagrams`
    - API: diagram load/save returns and persists typed_content_json
    - Migration: copy existing sequence_diagrams + children into typed_content_json (best-effort)
    - Deprecate sequence_diagrams read endpoint usage (keep endpoint temporarily, but redirect/translate)

- **frontend:**
    - Diagram model updated to include typedContent
    - Sequence Editor and other typed editors read/write typedContent via existing diagram load/save, not /sequence-diagrams/*

### Out of Scope

- Diagram canvas rendering enhancements
- Full ER/State/Activity typed editors (beyond basic create/add already implemented)
- Removing old sequence tables immediately (we will deprecate first, then remove later)

## Acceptance Criteria

- Creating a new diagram of type Sequence/ER/Activity/State never results in a 404 due to missing typed backing record.
- Diagrams of type Sequence/ER/Activity/State always have `typedContent` present (at least an empty default object) when returned to frontend.
- Sequence Editor loads and saves using the generic diagram APIs (no calls to /api/sequence-diagrams/{id}).
- Existing General diagrams still behave exactly as before.
- Existing Sequence diagram data (if any exists in sequence_* tables) is migrated into diagrams.typed_content_json.

---

## BACKEND: DATABASE + API CHANGES

### 1) Schema Migration

**Liquibase:**
- ALTER TABLE diagrams ADD COLUMN typed_content_json JSONB NULL;

**Add GIN index (optional but recommended):**
- CREATE INDEX IF NOT EXISTS idx_diagrams_typed_content_json ON diagrams USING gin (typed_content_json);

### 2) Define Typed Content JSON Structure per diagram_type

Store an object shaped like:
```json
{
  "type": "Sequence" | "ER" | "Activity" | "State",
  "version": 1,
  "content": { ...typeSpecific... }
}
```

**Default typed content (created server-side if missing):**

**Sequence:**
```json
{
  "participants": [],
  "messages": [],
  "fragments": [],
  "operands": [],
  "sequenceNodes": []
}
```

**ER:**
```json
{
  "entityRefs": [],
  "relationshipRefs": []
}
```

**Activity:**
```json
{
  "partitions": [],
  "flows": []
}
```

**State:**
```json
{
  "states": [],
  "transitions": []
}
```

**NOTE:**
- This spec's core requirement is to support SEQUENCE fully in typed_content_json.
- For ER/Activity/State, typed_content_json can be minimal/empty v1 to establish the pattern.
- The actual placement geometry remains in diagram_nodes/edges as today.

### 3) Update DiagramEntity + DTO + Mapper

**Add field on DiagramEntity:**
- typedContentJson: String or JsonNode (preferred)
- map to diagrams.typed_content_json

**Extend DiagramDto to include:**
- typedContent (object, nullable)

**On GET diagram(s):**
- if diagram.type in {ER, Sequence, Activity, State} and typed_content_json is null:
    - set typed_content_json to default for that type (in response)
    - (optional) persist default lazily on read OR persist on creation only; choose persist-on-create for cleanliness.

### 4) Update Diagram Create Flow (server-side)

When creating a diagram:
- if diagram_type == General:
    - typed_content_json = NULL
- else:
    - typed_content_json = defaultTypedContent(diagram_type)

This ensures newly created typed diagrams always have typedContent.

### 5) Update Diagram Save Flow

When saving/updating a diagram:
- Accept typedContent in request body
- Persist to typed_content_json
- Validate typedContent structure based on diagram_type (light validation v1):
    - typedContent.type matches diagram.diagram_type
    - version is present and == 1
    - for Sequence: ensure arrays exist (participants/messages/fragments/operands/sequenceNodes)
- Reject invalid mismatches with 400 Bad Request

### 6) Migration: Move Existing sequence_* Tables into diagrams.typed_content_json

Add a one-time migration routine (implement in Java startup migration or a dedicated command):

For each diagram row where diagram_type='Sequence':
- if typed_content_json is null:
    - attempt to load sequence aggregate from sequence_* tables using id == diagram.id OR match by model_file_id + name (fallback)
    - if found:
        - build Sequence typedContent JSON and store into diagrams.typed_content_json
    - else:
        - store default empty Sequence typedContent JSON

Log counts:
- migrated N sequence diagrams from tables
- defaulted M sequence diagrams

### 7) Deprecate Sequence Diagram Endpoints (do not remove yet)

Keep GET /api/sequence-diagrams/{id} for compatibility, but implement it as:
- Load diagram by id
- Ensure diagram_type == 'Sequence'
- Return typed_content_json.content as the SequenceDiagram payload

This prevents immediate breakage if any callers remain.

---

## FRONTEND CHANGES

### 1) Extend Diagram Model to Carry typedContent

Update Diagram type to include:
- type: 'General'|'ER'|'Sequence'|'Activity'|'State'
- typedContent?: { type: string; version: number; content: any }

Ensure load model parsing reads typedContent from backend.

### 2) Sequence Editor Must Read/Write typedContent from Active Diagram

**Remove calls to GET /api/sequence-diagrams/{id} and replace with:**
- use activeDiagram.typedContent.content for participants/messages/etc.

**When editing sequence:**
- update activeDiagram.typedContent.content in state
- ensure diagram save API persists the whole diagram including typedContent

**On a newly created Sequence diagram:**
- typedContent will exist and contain empty arrays, so no error state / 404.

### 3) Diagram Creation UI Remains Unchanged

- Diagram type dropdown controls diagram.type.
- Backend sets default typedContent for typed diagrams.

### 4) ER/State/Activity

No functional changes required in this spec beyond:
- diagram objects now include typedContent (may be empty)
- existing node/edge palette + create-and-place continues to work.

---

## TESTS / VERIFICATION

### Backend

- Create diagram type=Sequence -> verify diagrams.typed_content_json non-null with default structure.
- Update diagram with modified typedContent -> persists and returns correctly.
- GET /api/sequence-diagrams/{id} (compat endpoint) returns typed content from diagrams table (no sequence_* DB reads).

### Migration

- With existing sequence_* records present:
    - verify migration copies them into diagrams.typed_content_json.
- With none present:
    - verify default typed content created.

### Frontend

- Create new Sequence diagram:
    - Sequence Editor loads without 404 and shows empty Participants/Flow lists.
- Add participant/message (if editor already implemented):
    - save persists through diagram save endpoint.
- Switch away/back, reload -> content retained.

---

## Deliverables

- A consistent storage pattern for typed diagrams using diagrams.typed_content_json (jsonb).
- Sequence diagram no longer requires separate backing records; 404 class eliminated.
- Foundation laid to implement richer typed editors for ER/Activity/State in later increments.
