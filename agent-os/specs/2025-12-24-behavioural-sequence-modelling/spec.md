# Specification: Behavioural Architecture Sequence Modelling

## Goal

Introduce UML-style Sequence Diagram persistence and retrieval to the architecture-model-service backend and frontend types, enabling participants, messages, control fragments, operands, and ordering nodes to be stored, validated, and loaded as part of the Behavioural Architecture domain.

## User Stories

- As an architect, I want to persist sequence diagram definitions with participants referencing meta-model entities so that I can model interaction flows between system components.
- As a developer, I want to retrieve fully-nested SequenceDiagram JSON via a REST endpoint so that the frontend can load and eventually render sequence diagrams.

## Specific Requirements

**SequenceDiagram Root Entity and Table**
- Create `sequence_diagrams` table with columns: id (TEXT PK), model_file_id (TEXT FK to model_files), name (TEXT), type (TEXT default 'Sequence'), created_at (TIMESTAMPTZ), updated_at (TIMESTAMPTZ)
- Follow existing Liquibase migration pattern in `db.changelog-master.yaml` adding a new changeset (e.g., `005-sequence-diagrams.sql`)
- Add foreign key constraint to model_files with ON DELETE CASCADE
- Create index on model_file_id for query performance
- JPA entity `SequenceDiagramEntity` follows existing patterns (Lombok @Builder, @Getter, @Setter)

**SequenceParticipant Entity and Table**
- Create `sequence_participants` table with columns: id (TEXT PK), sequence_diagram_id (TEXT FK), ref_kind (VARCHAR NOT NULL), ref_id (VARCHAR NOT NULL), order_index (INTEGER NOT NULL), created_at, updated_at
- ref_kind allowed values: BusinessUser, Application, ApplicationComponent, Service, Interface, InterfaceEndpoint, Class
- Cascade delete when parent sequence_diagram is deleted
- Create index on sequence_diagram_id
- Validate ref_kind against allowed enum set in service layer

**SequenceMessage Entity and Table**
- Create `sequence_messages` table with columns: id, sequence_diagram_id (FK), exchange_id (VARCHAR NOT NULL), exchange_role (VARCHAR NOT NULL), from_participant_id (FK to sequence_participants), to_participant_id (FK), ref_kind (VARCHAR nullable), ref_id (VARCHAR nullable), label_text (TEXT nullable), created_at, updated_at
- exchange_role enum: Request | Response
- ref_kind allowed values (when present): Method, LogicalEntity, PhysicalEntity, Class, Event
- Enforce one-of constraint: either (ref_kind + ref_id) OR label_text must be present, not both
- Create composite index on (sequence_diagram_id, exchange_id) for exchange pairing queries

**SequenceFragment Entity and Table**
- Create `sequence_fragments` table with columns: id (TEXT PK), sequence_diagram_id (FK), fragment_kind (VARCHAR NOT NULL), label_text (TEXT nullable), created_at, updated_at
- fragment_kind allowed values (full words): Loop, Optional, Alternative
- Cascade delete when parent sequence_diagram is deleted
- Create index on sequence_diagram_id

**SequenceOperand Entity and Table**
- Create `sequence_operands` table with columns: id (TEXT PK), fragment_id (FK to sequence_fragments NOT NULL), guard_expression (TEXT NOT NULL), operand_index (INTEGER NOT NULL), created_at, updated_at
- Cascade delete when parent fragment is deleted
- Recommend unique constraint on (fragment_id, operand_index) to prevent duplicate ordering
- Create index on fragment_id

**SequenceNode Entity and Table (Diagram-Only Ordering)**
- Create `sequence_nodes` table with columns: id (TEXT PK), sequence_diagram_id (FK), node_kind (VARCHAR NOT NULL), message_id (FK nullable), fragment_id (FK nullable), order_index (INTEGER NOT NULL), parent_node_id (FK nullable self-ref), parent_operand_id (FK nullable to sequence_operands), created_at, updated_at
- node_kind enum: Message | Fragment
- When node_kind=Message, message_id is required and fragment_id must be null
- When node_kind=Fragment, fragment_id is required and message_id must be null
- parent_node_id must reference a Fragment-type node if set
- parent_operand_id must belong to the fragment referenced by parent_node_id
- Create composite index on (sequence_diagram_id, parent_node_id) for hierarchy queries

**Backend Controller and DTO Layer**
- Add `SequenceDiagramController` with GET /api/sequence-diagrams/{id} returning SequenceDiagramDto
- SequenceDiagramDto contains nested arrays: participants, messages, fragments, operands, sequenceNodes
- Order participants by orderIndex, operands by operandIndex, nodes by orderIndex within parent scope
- Add optional GET /api/model-files/{modelFileId}/sequence-diagrams for listing (if pattern exists for other diagrams)
- Follow existing DTO record pattern with @JsonProperty annotations

**Backend Service Validation Rules**
- Participants: validate ref_kind in allowed set, ref_id not null
- Messages: validate exchange_role in {Request, Response}, from/to participant exists in same diagram, one-of content rule
- Fragments: validate fragment_kind in {Loop, Optional, Alternative}
- Operands: validate fragment_id exists, operand_index unique per fragment
- Nodes: validate node_kind in {Message, Fragment}, conditional field requirements, parent references valid

**Frontend TypeScript Types**
- Add interfaces in `frontend/src/types/sequenceDiagram.ts`: SequenceDiagram, SequenceParticipant, SequenceMessage, SequenceFragment, SequenceOperand, SequenceNode
- Use string literal union types for enums (e.g., `type ExchangeRole = 'Request' | 'Response'`)
- Export all types for consumption by API client and future rendering components

**Frontend API Client Integration**
- Add `getSequenceDiagram(id: string): Promise<SequenceDiagram>` function in `frontend/src/api/sequenceDiagramApi.ts`
- Follow existing pattern from modelApi.ts (fetch, error handling, JSON parsing)
- Optionally add getSequenceDiagramsByModelFileId if backend supports list endpoint

## Existing Code to Leverage

**Liquibase Migration Pattern (db.changelog-master.yaml)**
- Existing changesets 001-004 demonstrate the SQL file inclusion pattern with preConditions checking tableExists
- Use same structure: new changeset id `005-sequence-diagrams`, reference `db/changelog/sql/005-sequence-diagrams.sql`
- Follow ON DELETE CASCADE pattern from existing tables (e.g., states, state_transitions)

**JPA Entity Pattern (StateTransitionEntity.java)**
- Use @Entity, @Table, @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder annotations
- Column mappings with @Column(name = "snake_case", nullable = true/false)
- String type for IDs and enum-like fields (validated in service layer, not JPA)

**Repository Pattern (StateRepository.java, StateTransitionRepository.java)**
- Extend JpaRepository<EntityClass, String>
- Add findByModelFileId(String modelFileId) and deleteByModelFileId(String modelFileId) methods
- For SequenceParticipant/Message/Fragment/Operand/Node repositories, add findBySequenceDiagramId methods

**DTO Record Pattern (StateTransitionDto.java)**
- Use Java record with @JsonProperty on each field for camelCase JSON naming
- Pass to EntityMapper for entity-to-DTO and DTO-to-entity conversions

**Frontend API Pattern (modelApi.ts)**
- Use fetch with API_BASE from environment variable
- Return Promise with typed response, throw Error on non-ok status
- Export async functions matching backend endpoints

## Out of Scope

- Sequence diagram canvas rendering or visual interaction UI (separate rendering spec)
- State diagram or Activity diagram persistence (separate specs)
- Gateway or MCP server changes
- POST/PUT/DELETE endpoints for sequence diagrams (read-only acceptable for this spec)
- Sequence diagram navigation UI in diagram selector (optional placeholder only)
- Message arrow styling or lifeline visualization
- Real-time collaboration or WebSocket updates
- Validation of ref_id existence against actual meta-model entities (future enhancement)
- Sequence diagram import/export to XMI or other formats
- Integration with existing Diagram entity/table (sequence diagrams are separate root entities)
