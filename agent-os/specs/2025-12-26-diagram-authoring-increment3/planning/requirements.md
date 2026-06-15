# Requirements: Diagram Type Authoring (Increment 3) — Sequence Diagram Editor + Enhanced State/Activity Inspectors

## Intent

- Introduce a diagram-native authoring experience for Sequence diagrams:
    - Manage Participants (lifelines), Messages (request/response via exchangeId), Fragments, Operands, and SequenceNodes ordering
    - Support "create & add" inside Diagram View where appropriate (participants/messages), while still referencing meta-model entities for refKind/refId
- Enhance State and Activity diagram authoring with richer inspectors:
    - StateTransition editing (trigger/guard/effect)
    - ActivityFlow editing (trigger + condition + flowKind)
- Keep rendering incremental:
    - Phase 3 focuses on editor UX and correct persistence, not on perfect UML visuals.
    - Canvas representation can be minimal (boxes/lines) as long as ordering is maintained.

## Scope

### In Scope

- **Frontend Diagram View:**
    - Sequence diagram RHS "Sequence Editor" (participants/messages/fragments)
    - Minimal canvas representation for sequence (optional but recommended)
    - Enhanced inspectors for StateTransition + ActivityFlow
    - Create/update flows that persist to backend and update diagram in-memory

- **Backend:**
    - Add write endpoints for SequenceDiagram and its children if not already present
    - Add endpoints for listing sequence diagrams per model file (optional)

### Out of Scope

- Advanced UML rendering polish (activation bars, message arrow styles)
- Complex ref typeahead across all refKinds (can be iterative)
- Importing/exporting sequence diagrams (PlantUML etc.)

## Acceptance Criteria

### Sequence Diagram

- Users can add/remove/reorder Participants.
- Users can add a message exchange (request + optional response) between participants.
- Users can add Loop / Optional / Alternative fragments with operands and guards.
- All of the above persists and reloads correctly (participants/messages/fragments/operands/sequenceNodes).
- "Add existing" vs "Create & add" is supported where relevant:
    - Add participant by selecting refKind/refId from existing meta-model
    - Add message referencing Method / LogicalEntity etc. OR labelText

### State Diagram

- Users can create/edit StateTransitions in Diagram View inspector:
    - fromState/toState
    - trigger (Event|Method|text) required
    - guard (Method|expression) optional
    - effect (Method|text) optional
- Persists and reloads.

### Activity Diagram

- Users can create/edit ActivityFlows in Diagram View inspector:
    - from/to activity
    - flowKind (Control/Data)
    - trigger (Event|Method|text) optional
    - condition (Method|expression) optional
- Persists and reloads.

---

## A) SEQUENCE DIAGRAM — FRONTEND "SEQUENCE EDITOR"

### UX Layout (RHS replaces palette for Sequence diagrams)

When `activeDiagram.type == 'Sequence'`:
- RHS shows a tabbed editor (two tabs):
    1. **Participants**
    2. **Flow** (Messages + Fragments)

- The existing "Add existing palette" list is hidden for Sequence diagrams in this increment.

### Participants Tab

- List view with drag handles (reorder)
- Button: **"+ Add Participant"**
    - Opens drawer:
        - `refKind` dropdown (User/Application/AppComponent/Service/Interface/Endpoint/Class)
        - `refId` selector (typeahead; if not feasible v1, allow raw id + optional search later)
    - On save:
        - Create SequenceParticipant record (backend)
        - Update participants list
        - Reindex orderIndex sequentially

### Flow Tab

- Shows a linear outline of sequenceNodes (tree):
    - Message nodes
    - Fragment nodes containing operands containing child nodes
- Controls:
    - **"+ Add Message Exchange"**
    - **"+ Add Fragment (Loop/Optional/Alternative)"**

#### Message Exchange Create Flow

- Choose fromParticipant, toParticipant
- Request content: (refKind/refId OR labelText) required
- Response content: optional (refKind/refId OR labelText)
- On save:
    - Create two SequenceMessage rows with shared exchangeId:
        - Request
        - Response (if provided)
    - Create two SequenceNode rows at correct position (orderIndex)

#### Fragment Create Flow

- Choose fragmentKind (Loop/Optional/Alternative)
- Create fragment + operand(s):
    - Loop: 1 operand
    - Optional: 1 operand
    - Alternative: 2 operands by default (+ add operand button)
- Each operand requires guardExpression
- Create a Fragment node in sequenceNodes, then allow adding children into specific operand scope

### Ordering / Nesting Rules

- sequenceNodes remain authoritative for visual ordering.
- Provide UI operations:
    - Move node up/down within same parent scope
    - Indent/outdent into fragment operand (drag/drop if feasible; else via "Move into…" action)
- On any reordering, persist updated orderIndex for affected siblings.

### Minimal Canvas (recommended, not perfect UML)

- Render participants as vertical columns with their labels at top.
- Render messages as horizontal lines between columns (ordered by sequenceNodes).
- Render fragments as bordered blocks spanning columns with operand guard labels.
- This can reuse existing diagram canvas primitives; perfection not required.

---

## B) STATE DIAGRAM — ENHANCED INSPECTOR FOR TRANSITIONS

When `activeDiagram.type == 'State'`:
- RHS shows:
    - Create & place (from Increment 2) for States
    - Add existing for States/Transitions
    - **Inspector:**
        - If a StateTransition edge is selected, show editor with:
            - `fromStateId` (FK to States)
            - `toStateId` (FK to States)
            - `trigger` (required): mode event|method|text
            - `guard` (optional): mode none|method|expression
            - `effect` (optional): mode none|method|text
            - description/orderIndex optional
        - Save updates backend via `PUT state-transitions/{id}`
        - Update ArchitectureContext collections immediately

### Create Transition Quick Action

- Button: **"+ New Transition"**
- Flow:
    - Choose from/to states and trigger fields
    - Creates StateTransition (backend)
    - Adds edge on diagram between the selected states (or default if none selected)

---

## C) ACTIVITY DIAGRAM — ENHANCED INSPECTOR FOR FLOWS

When `activeDiagram.type == 'Activity'`:
- RHS shows:
    - Create & place (from Increment 2): Partition, Activity
    - Add existing list
    - **Inspector:**
        - If ActivityFlow edge is selected:
            - `fromActivityId` / `toActivityId`
            - `flowKind` Control/Data
            - `trigger` optional: event|method|text
            - `condition` optional: method|expression
            - description/orderIndex
        - Save via `PUT activity-flows/{id}`
        - Update ArchitectureContext collections

### Create Flow Quick Action

- Button: **"+ New Flow"**
- Flow:
    - Choose from/to activities
    - Choose flowKind and optional trigger/condition
    - Creates ActivityFlow (backend)
    - Adds edge to diagram

---

## BACKEND REQUIREMENTS

### Sequence Diagram Write Endpoints (add if missing)

- `GET  /api/sequence-diagrams/{id}` (already defined in spec #4)
- `POST /api/model-files/{modelFileId}/sequence-diagrams` (create empty diagram shell)
- `PUT  /api/sequence-diagrams/{id}` (update name)

### Child Resource Strategy

**Option A (preferred for speed): "Save whole sequence diagram"**
- `PUT /api/sequence-diagrams/{id}/content`
    - Body: full SequenceDiagram JSON
    - Server replaces children transactionally

**Option B (fine-grained CRUD):**
- `POST /api/sequence-diagrams/{id}/participants`
- `PUT  /api/sequence-diagrams/{id}/participants/{pid}`
- `DELETE ...`
- (and similarly for messages/fragments/operands/nodes)

**Implement Option A for Increment 3 to reduce complexity:**
- Backend validation runs on the whole payload.
- Replace strategy:
    - Delete existing children for diagram id
    - Insert new children
    - Return normalized payload

### State/Activity Endpoints

- Assumed CRUD already exists from specs #3 and #5.
- No schema changes.

---

## FRONTEND DATA INTEGRATION

- Extend diagram persistence to include:
    - `diagram.type` (already Increment 1)
    - `diagram.sequenceDiagramId` OR embedded sequenceDiagram payload (choose one; recommended: store sequenceDiagramId in diagram record)

- For Sequence diagrams:
    - Diagram record references a SequenceDiagram id
    - Sequence editor loads content via `GET /api/sequence-diagrams/{id}`
    - Save button (or auto-save debounce) calls `PUT /api/sequence-diagrams/{id}/content` with full JSON

### Autosave

- Debounce saves by 500–1000ms on changes.
- Show "Saving…" indicator in RHS header.

---

## TESTS / VERIFICATION

### Sequence

- Create a sequence diagram
- Add 3 participants
- Add a request+response message exchange
- Add a Loop fragment with operand guard
- Nest a message under fragment operand
- Reload page and confirm structure is preserved

### State

- Create 2 states + 1 transition with trigger=Event
- Edit transition guard/effect in inspector and persist
- Reload and confirm

### Activity

- Create 2 activities + 1 flow (control) with condition expression
- Edit trigger/condition in inspector and persist
- Reload and confirm

---

## Deliverables

- Sequence diagram diagram-native editor (participants/messages/fragments/operands/nodes) with persistence.
- State and Activity diagram inspectors support editing edges (transitions/flows) with trigger/guard/condition/effect.
- Diagram View becomes a true authoring space for behavioural diagrams.
