# Task Breakdown: Behavioural Architecture Sequence Modelling

## Overview
Total Tasks: 49 sub-tasks across 9 task groups

This spec introduces UML-style Sequence Diagram persistence and retrieval to the architecture-model-service backend and frontend types. The implementation covers 6 database tables, 6 JPA entities, 7 DTOs, 6 repositories, service layer validation, REST controller, frontend TypeScript types, and API client integration.

## Task List

### Database Layer

#### Task Group 1: Database Migration (Liquibase)
**Dependencies:** None
**Specialist:** database-engineer

- [x] 1.0 Complete database migration for sequence diagram tables
  - [x] 1.1 Write 4-6 focused tests for database schema validation
    - Test that sequence_diagrams table exists with correct columns
    - Test foreign key constraint from sequence_diagrams to model_files
    - Test cascade delete behavior (delete sequence_diagram cascades to children)
    - Test index existence on key lookup columns
    - Test unique constraint on (fragment_id, operand_index) for sequence_operands
  - [x] 1.2 Update db.changelog-master.yaml with new changeset
    - Add changeset id `005-sequence-diagrams`
    - Reference `db/changelog/sql/005-sequence-diagrams.sql`
    - Add preConditions checking `tableExists: sequence_diagrams` with `onFail: MARK_RAN`
    - Follow existing pattern from changesets 001-004
  - [x] 1.3 Create sequence_diagrams table
    - Columns: id (TEXT PK), model_file_id (TEXT FK), name (TEXT), type (TEXT DEFAULT 'Sequence'), created_at (TIMESTAMPTZ), updated_at (TIMESTAMPTZ)
    - Foreign key to model_files(id) with ON DELETE CASCADE
    - Create index idx_sequence_diagrams_model_file on model_file_id
  - [x] 1.4 Create sequence_participants table
    - Columns: id (TEXT PK), sequence_diagram_id (TEXT FK), ref_kind (VARCHAR NOT NULL), ref_id (VARCHAR NOT NULL), order_index (INTEGER NOT NULL), created_at, updated_at
    - Foreign key to sequence_diagrams(id) with ON DELETE CASCADE
    - Create index idx_sequence_participants_diagram on sequence_diagram_id
  - [x] 1.5 Create sequence_messages table
    - Columns: id (TEXT PK), sequence_diagram_id (TEXT FK), exchange_id (VARCHAR NOT NULL), exchange_role (VARCHAR NOT NULL), from_participant_id (TEXT FK), to_participant_id (TEXT FK), ref_kind (VARCHAR), ref_id (VARCHAR), label_text (TEXT), created_at, updated_at
    - Foreign keys to sequence_participants(id) for from/to participant
    - Create composite index idx_sequence_messages_exchange on (sequence_diagram_id, exchange_id)
  - [x] 1.6 Create sequence_fragments table
    - Columns: id (TEXT PK), sequence_diagram_id (TEXT FK), fragment_kind (VARCHAR NOT NULL), label_text (TEXT), created_at, updated_at
    - Foreign key to sequence_diagrams(id) with ON DELETE CASCADE
    - Create index idx_sequence_fragments_diagram on sequence_diagram_id
  - [x] 1.7 Create sequence_operands table
    - Columns: id (TEXT PK), fragment_id (TEXT FK NOT NULL), guard_expression (TEXT NOT NULL), operand_index (INTEGER NOT NULL), created_at, updated_at
    - Foreign key to sequence_fragments(id) with ON DELETE CASCADE
    - Add UNIQUE constraint on (fragment_id, operand_index)
    - Create index idx_sequence_operands_fragment on fragment_id
  - [x] 1.8 Create sequence_nodes table
    - Columns: id (TEXT PK), sequence_diagram_id (TEXT FK), node_kind (VARCHAR NOT NULL), message_id (TEXT FK nullable), fragment_id (TEXT FK nullable), order_index (INTEGER NOT NULL), parent_node_id (TEXT FK nullable self-ref), parent_operand_id (TEXT FK nullable), created_at, updated_at
    - Foreign keys: sequence_diagram_id to sequence_diagrams, message_id to sequence_messages, fragment_id to sequence_fragments, parent_node_id self-reference, parent_operand_id to sequence_operands
    - Create composite index idx_sequence_nodes_hierarchy on (sequence_diagram_id, parent_node_id)
  - [x] 1.9 Ensure database migration tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify migration runs successfully in test environment
    - Confirm all tables, indexes, and constraints created correctly

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Migration file 005-sequence-diagrams.sql created and referenced in changelog
- All 6 tables created with correct columns and data types
- Foreign key constraints with ON DELETE CASCADE configured
- Indexes created for query performance
- Unique constraint on (fragment_id, operand_index) enforced

---

### Backend JPA Layer

#### Task Group 2: JPA Entities
**Dependencies:** Task Group 1
**Specialist:** backend-engineer

- [x] 2.0 Complete JPA entities for sequence diagram domain
  - [x] 2.1 Write 4-6 focused tests for JPA entity mappings
    - Test SequenceDiagramEntity persistence and retrieval
    - Test SequenceParticipantEntity with parent relationship
    - Test SequenceMessageEntity with participant foreign keys
    - Test SequenceNodeEntity with conditional message_id/fragment_id fields
    - Test cascade delete from diagram to children
  - [x] 2.2 Create SequenceDiagramEntity
    - Package: `com.example.architecturemodel.model.entity`
    - Annotations: @Entity, @Table(name = "sequence_diagrams"), @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder
    - Fields: id, modelFileId, name, type, createdAt, updatedAt
    - Column mappings with @Column(name = "snake_case")
  - [x] 2.3 Create SequenceParticipantEntity
    - Package: `com.example.architecturemodel.model.entity`
    - Fields: id, sequenceDiagramId, refKind, refId, orderIndex, createdAt, updatedAt
    - All field annotations following existing EventEntity pattern
  - [x] 2.4 Create SequenceMessageEntity
    - Fields: id, sequenceDiagramId, exchangeId, exchangeRole, fromParticipantId, toParticipantId, refKind, refId, labelText, createdAt, updatedAt
    - Nullable fields: refKind, refId, labelText
  - [x] 2.5 Create SequenceFragmentEntity
    - Fields: id, sequenceDiagramId, fragmentKind, labelText, createdAt, updatedAt
    - Nullable field: labelText
  - [x] 2.6 Create SequenceOperandEntity
    - Fields: id, fragmentId, guardExpression, operandIndex, createdAt, updatedAt
    - All fields required (nullable = false except timestamps)
  - [x] 2.7 Create SequenceNodeEntity
    - Fields: id, sequenceDiagramId, nodeKind, messageId, fragmentId, orderIndex, parentNodeId, parentOperandId, createdAt, updatedAt
    - Nullable fields: messageId, fragmentId, parentNodeId, parentOperandId
  - [x] 2.8 Ensure JPA entity tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify entities persist and retrieve correctly
    - Confirm field mappings match database columns

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- All 6 entity classes created with correct annotations
- Field names map correctly to database columns
- Builder pattern available for all entities
- Entities follow existing codebase patterns (EventEntity, etc.)

---

#### Task Group 3: Repositories
**Dependencies:** Task Group 2
**Specialist:** backend-engineer

- [x] 3.0 Complete repository interfaces for sequence diagram entities
  - [x] 3.1 Write 4-6 focused tests for repository methods
    - Test findByModelFileId for SequenceDiagramRepository
    - Test findBySequenceDiagramId for child repositories
    - Test findByFragmentId for SequenceOperandRepository
    - Test deleteByModelFileId cascade behavior
  - [x] 3.2 Create SequenceDiagramRepository
    - Package: `com.example.architecturemodel.repository.entity`
    - Extend JpaRepository<SequenceDiagramEntity, String>
    - Methods: findByModelFileId(String modelFileId), deleteByModelFileId(String modelFileId)
  - [x] 3.3 Create SequenceParticipantRepository
    - Extend JpaRepository<SequenceParticipantEntity, String>
    - Methods: findBySequenceDiagramId(String diagramId), deleteBySequenceDiagramId(String diagramId)
  - [x] 3.4 Create SequenceMessageRepository
    - Extend JpaRepository<SequenceMessageEntity, String>
    - Methods: findBySequenceDiagramId(String diagramId), deleteBySequenceDiagramId(String diagramId)
  - [x] 3.5 Create SequenceFragmentRepository
    - Extend JpaRepository<SequenceFragmentEntity, String>
    - Methods: findBySequenceDiagramId(String diagramId), deleteBySequenceDiagramId(String diagramId)
  - [x] 3.6 Create SequenceOperandRepository
    - Extend JpaRepository<SequenceOperandEntity, String>
    - Methods: findByFragmentId(String fragmentId), deleteByFragmentId(String fragmentId)
  - [x] 3.7 Create SequenceNodeRepository
    - Extend JpaRepository<SequenceNodeEntity, String>
    - Methods: findBySequenceDiagramId(String diagramId), findBySequenceDiagramIdAndParentNodeId(String diagramId, String parentNodeId), deleteBySequenceDiagramId(String diagramId)
  - [x] 3.8 Ensure repository tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify query methods return correct data
    - Confirm delete methods cascade correctly

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- All 6 repository interfaces created with @Repository annotation
- Query methods follow Spring Data JPA naming conventions
- Methods match patterns from existing repositories (EventRepository)

---

### Backend DTO Layer

#### Task Group 4: DTOs
**Dependencies:** Task Group 2
**Specialist:** backend-engineer

- [x] 4.0 Complete DTO records for sequence diagram API responses
  - [x] 4.1 Write 3-5 focused tests for DTO serialization
    - Test SequenceDiagramDto JSON serialization with nested arrays
    - Test @JsonProperty annotations produce correct snake_case output
    - Test null handling for optional fields
  - [x] 4.2 Create SequenceParticipantDto
    - Package: `com.example.architecturemodel.model.dto.entity`
    - Java record with @JsonProperty annotations
    - Fields: id, refKind, refId, orderIndex
    - JSON names: id, ref_kind, ref_id, order_index
  - [x] 4.3 Create SequenceMessageDto
    - Fields: id, exchangeId, exchangeRole, fromParticipantId, toParticipantId, refKind, refId, labelText
    - JSON names: id, exchange_id, exchange_role, from_participant_id, to_participant_id, ref_kind, ref_id, label_text
  - [x] 4.4 Create SequenceFragmentDto
    - Fields: id, fragmentKind, labelText
    - JSON names: id, fragment_kind, label_text
  - [x] 4.5 Create SequenceOperandDto
    - Fields: id, fragmentId, guardExpression, operandIndex
    - JSON names: id, fragment_id, guard_expression, operand_index
  - [x] 4.6 Create SequenceNodeDto
    - Fields: id, nodeKind, messageId, fragmentId, orderIndex, parentNodeId, parentOperandId
    - JSON names: id, node_kind, message_id, fragment_id, order_index, parent_node_id, parent_operand_id
  - [x] 4.7 Create SequenceDiagramDto (root aggregate)
    - Package: `com.example.architecturemodel.model.dto.entity`
    - Fields: id, modelFileId, name, type, participants (List<SequenceParticipantDto>), messages (List<SequenceMessageDto>), fragments (List<SequenceFragmentDto>), operands (List<SequenceOperandDto>), sequenceNodes (List<SequenceNodeDto>)
    - JSON names follow snake_case pattern
  - [x] 4.8 Ensure DTO serialization tests pass
    - Run ONLY the 3-5 tests written in 4.1
    - Verify JSON output matches expected format
    - Confirm nested arrays serialize correctly

**Acceptance Criteria:**
- The 3-5 tests written in 4.1 pass
- All 7 DTO records created (6 child + 1 aggregate)
- JSON property names use snake_case
- Follows existing StateDto/StateTransitionDto patterns

---

### Backend Service Layer

#### Task Group 5: Service Layer with Validation
**Dependencies:** Task Groups 3, 4
**Specialist:** backend-engineer

- [x] 5.0 Complete service layer for sequence diagram operations
  - [x] 5.1 Write 6-8 focused tests for service validation rules
    - Test participant ref_kind validation (allowed values only)
    - Test message exchange_role validation (Request/Response only)
    - Test message one-of constraint (ref_kind+ref_id OR label_text)
    - Test fragment fragment_kind validation (Loop/Optional/Alternative)
    - Test node node_kind validation with conditional field requirements
    - Test getSequenceDiagram returns correctly nested DTO
  - [x] 5.2 Create SequenceDiagramService class
    - Package: `com.example.architecturemodel.service`
    - Inject all 6 repositories
    - Annotations: @Service, @RequiredArgsConstructor, @Slf4j
  - [x] 5.3 Implement getSequenceDiagram(String id) method
    - Retrieve SequenceDiagramEntity by id
    - Fetch all child entities: participants, messages, fragments, operands, nodes
    - Sort participants by orderIndex
    - Sort operands by operandIndex
    - Sort nodes by orderIndex within parent scope
    - Map to SequenceDiagramDto with nested arrays
    - Throw ResourceNotFoundException if not found
  - [x] 5.4 Implement getSequenceDiagramsByModelFileId(String modelFileId) method
    - Return List<SequenceDiagramDto> for listing endpoint
    - Minimal data (id, name, type) for list view
  - [x] 5.5 Implement validation helper methods
    - validateParticipantRefKind(String refKind): allowed values [BusinessUser, Application, ApplicationComponent, Service, Interface, InterfaceEndpoint, Class]
    - validateMessageExchangeRole(String role): allowed values [Request, Response]
    - validateMessageContentOneOf(String refKind, String refId, String labelText): enforce one-of rule
    - validateFragmentKind(String kind): allowed values [Loop, Optional, Alternative]
    - validateNodeKind(String kind, String messageId, String fragmentId): enforce conditional requirements
  - [x] 5.6 Implement EntityMapper extensions
    - Add toDto methods for all 6 sequence entities
    - Add toEntity methods if needed for future write operations
    - Follow existing mapper patterns in EntityMapper.java
  - [x] 5.7 Ensure service layer tests pass
    - Run ONLY the 6-8 tests written in 5.1
    - Verify validation rejects invalid values
    - Confirm nested DTO assembly is correct

**Acceptance Criteria:**
- The 6-8 tests written in 5.1 pass
- Service class implements all validation rules from spec
- getSequenceDiagram returns properly nested DTO
- Validation throws appropriate exceptions for invalid data
- Logging added for debug traceability

---

### Backend Controller Layer

#### Task Group 6: REST Controller
**Dependencies:** Task Group 5
**Specialist:** backend-engineer

- [x] 6.0 Complete REST controller for sequence diagram endpoints
  - [x] 6.1 Write 4-6 focused tests for controller endpoints
    - Test GET /api/sequence-diagrams/{id} returns 200 with valid DTO
    - Test GET /api/sequence-diagrams/{id} returns 404 for unknown id
    - Test GET /api/model-files/{modelFileId}/sequence-diagrams returns list
    - Test invalid id parameter returns 400
  - [x] 6.2 Create SequenceDiagramController
    - Package: `com.example.architecturemodel.controller`
    - Annotations: @RestController, @RequestMapping("/api/sequence-diagrams"), @RequiredArgsConstructor, @Slf4j
    - Inject SequenceDiagramService
  - [x] 6.3 Implement GET /api/sequence-diagrams/{id} endpoint
    - @GetMapping("/{id}")
    - Return ResponseEntity<SequenceDiagramDto>
    - Validate id is not blank
    - Call service.getSequenceDiagram(id)
    - Log request at debug level
  - [x] 6.4 Implement GET /api/model-files/{modelFileId}/sequence-diagrams endpoint
    - Consider adding to ModelController or creating separate endpoint
    - @GetMapping path: /api/model-files/{modelFileId}/sequence-diagrams
    - Return ResponseEntity<List<SequenceDiagramDto>>
    - For listing all sequence diagrams under a model file
  - [x] 6.5 Add error handling
    - ResourceNotFoundException returns 404
    - IllegalArgumentException returns 400
    - Follow GlobalExceptionHandler patterns
  - [x] 6.6 Ensure controller tests pass
    - Run ONLY the 4-6 tests written in 6.1
    - Verify HTTP status codes are correct
    - Confirm response body matches expected DTO structure

**Acceptance Criteria:**
- The 4-6 tests written in 6.1 pass
- GET endpoint returns fully-nested SequenceDiagramDto
- 404 returned for unknown sequence diagram id
- 400 returned for invalid/blank id parameter
- Follows existing controller patterns (ModelInterfacesController)

---

### Frontend Type Layer

#### Task Group 7: Frontend TypeScript Types
**Dependencies:** None (can run parallel to backend tasks)
**Specialist:** frontend-engineer

- [x] 7.0 Complete TypeScript type definitions for sequence diagrams
  - [x] 7.1 Write 3-5 focused tests for type validation
    - Test type guard functions for enum validation
    - Test SequenceDiagram interface matches expected structure
    - Test union types accept valid values and reject invalid
  - [x] 7.2 Create sequenceDiagram.ts type file
    - Location: `frontend/src/types/sequenceDiagram.ts`
    - Export all interfaces and types
  - [x] 7.3 Define enum union types
    - ParticipantRefKind: 'BusinessUser' | 'Application' | 'ApplicationComponent' | 'Service' | 'Interface' | 'InterfaceEndpoint' | 'Class'
    - ExchangeRole: 'Request' | 'Response'
    - MessageRefKind: 'Method' | 'LogicalEntity' | 'PhysicalEntity' | 'Class' | 'Event'
    - FragmentKind: 'Loop' | 'Optional' | 'Alternative'
    - NodeKind: 'Message' | 'Fragment'
  - [x] 7.4 Define SequenceParticipant interface
    - Fields: id, ref_kind (ParticipantRefKind), ref_id, order_index
    - Use snake_case to match JSON from backend
  - [x] 7.5 Define SequenceMessage interface
    - Fields: id, exchange_id, exchange_role (ExchangeRole), from_participant_id, to_participant_id, ref_kind?, ref_id?, label_text?
    - Optional fields for one-of content
  - [x] 7.6 Define SequenceFragment interface
    - Fields: id, fragment_kind (FragmentKind), label_text?
  - [x] 7.7 Define SequenceOperand interface
    - Fields: id, fragment_id, guard_expression, operand_index
  - [x] 7.8 Define SequenceNode interface
    - Fields: id, node_kind (NodeKind), message_id?, fragment_id?, order_index, parent_node_id?, parent_operand_id?
    - Conditional optional fields based on node_kind
  - [x] 7.9 Define SequenceDiagram interface (root)
    - Fields: id, model_file_id, name, type, participants, messages, fragments, operands, sequence_nodes
    - Array types for nested collections
  - [x] 7.10 Ensure frontend type tests pass
    - Run ONLY the 3-5 tests written in 7.1
    - Verify type guards work correctly
    - Confirm interfaces match backend DTO structure

**Acceptance Criteria:**
- The 3-5 tests written in 7.1 pass
- All interfaces exported from sequenceDiagram.ts
- Union types enforce valid enum values
- Field names match JSON property names from backend
- Follows existing frontend type patterns (model.ts)

---

### Frontend API Client Layer

#### Task Group 8: Frontend API Client
**Dependencies:** Task Group 7
**Specialist:** frontend-engineer

- [x] 8.0 Complete API client for sequence diagram endpoints
  - [x] 8.1 Write 2-4 focused tests for API client functions
    - Test getSequenceDiagram makes correct fetch call
    - Test getSequenceDiagram throws on non-ok response
    - Test getSequenceDiagramsByModelFileId returns array
  - [x] 8.2 Create sequenceDiagramApi.ts
    - Location: `frontend/src/api/sequenceDiagramApi.ts`
    - Import SequenceDiagram type
    - Use API_BASE from environment variable pattern
  - [x] 8.3 Implement getSequenceDiagram function
    - Signature: `async function getSequenceDiagram(id: string): Promise<SequenceDiagram>`
    - Fetch from `${API_BASE}/api/sequence-diagrams/${id}`
    - Throw Error on non-ok response with status code
    - Return parsed JSON as SequenceDiagram
  - [x] 8.4 Implement getSequenceDiagramsByModelFileId function
    - Signature: `async function getSequenceDiagramsByModelFileId(modelFileId: string): Promise<SequenceDiagram[]>`
    - Fetch from `${API_BASE}/api/model-files/${modelFileId}/sequence-diagrams`
    - Return array of sequence diagram summaries
  - [x] 8.5 Ensure API client tests pass
    - Run ONLY the 2-4 tests written in 8.1
    - Verify fetch URLs are correct
    - Confirm error handling works

**Acceptance Criteria:**
- The 2-4 tests written in 8.1 pass
- API functions exported and typed correctly
- Error handling matches existing modelApi.ts pattern
- Functions ready for consumption by future rendering components

---

### Verification Layer

#### Task Group 9: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-8
**Specialist:** test-engineer

- [x] 9.0 Review existing tests and fill critical gaps only
  - [x] 9.1 Review tests from Task Groups 1-8
    - Database tests (4-6 from Task 1.1)
    - JPA entity tests (4-6 from Task 2.1)
    - Repository tests (4-6 from Task 3.1)
    - DTO serialization tests (3-5 from Task 4.1)
    - Service validation tests (6-8 from Task 5.1)
    - Controller endpoint tests (4-6 from Task 6.1)
    - Frontend type tests (3-5 from Task 7.1)
    - API client tests (2-4 from Task 8.1)
    - Total existing tests: approximately 30-46 tests
  - [x] 9.2 Analyze test coverage gaps for sequence diagram feature
    - Identify critical end-to-end workflows lacking coverage
    - Focus on integration between layers (controller -> service -> repository)
    - Check validation edge cases not covered
    - Verify frontend API client integrates with backend correctly
  - [x] 9.3 Write up to 8 additional strategic tests maximum
    - Integration test: Full flow from controller to database
    - Test cascade delete behavior end-to-end
    - Test complex nested DTO assembly with multiple fragments/operands
    - Test validation error responses through controller layer
    - Frontend: Test API client with mocked responses
  - [x] 9.4 Run feature-specific tests only
    - Run ONLY tests related to sequence diagram feature
    - Expected total: approximately 38-54 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 38-54 tests total)
- Critical integration workflows covered
- No more than 8 additional tests added
- Testing focused exclusively on sequence diagram feature requirements

---

## Execution Order

Recommended implementation sequence with parallel execution opportunities:

### Phase 1: Foundation (Parallel)
- **Task Group 1** (Database Migration) - database-engineer
- **Task Group 7** (Frontend Types) - frontend-engineer

### Phase 2: Backend Core (Sequential)
- **Task Group 2** (JPA Entities) - backend-engineer
- **Task Group 3** (Repositories) - backend-engineer
- **Task Group 4** (DTOs) - backend-engineer

### Phase 3: Backend Logic (Sequential)
- **Task Group 5** (Service Layer) - backend-engineer
- **Task Group 6** (Controller) - backend-engineer

### Phase 4: Frontend Integration (After Phase 1)
- **Task Group 8** (API Client) - frontend-engineer

### Phase 5: Verification (After All)
- **Task Group 9** (Test Review) - test-engineer

---

## File Locations Summary

### Backend Files to Create
```
architecture-model-service/src/main/resources/db/changelog/sql/005-sequence-diagrams.sql
architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/SequenceDiagramEntity.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/SequenceParticipantEntity.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/SequenceMessageEntity.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/SequenceFragmentEntity.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/SequenceOperandEntity.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/SequenceNodeEntity.java
architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/SequenceDiagramRepository.java
architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/SequenceParticipantRepository.java
architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/SequenceMessageRepository.java
architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/SequenceFragmentRepository.java
architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/SequenceOperandRepository.java
architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/SequenceNodeRepository.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/SequenceDiagramDto.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/SequenceParticipantDto.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/SequenceMessageDto.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/SequenceFragmentDto.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/SequenceOperandDto.java
architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/SequenceNodeDto.java
architecture-model-service/src/main/java/com/example/architecturemodel/service/SequenceDiagramService.java
architecture-model-service/src/main/java/com/example/architecturemodel/controller/SequenceDiagramController.java
```

### Backend Files to Modify
```
architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml
architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java
```

### Frontend Files to Create
```
frontend/src/types/sequenceDiagram.ts
frontend/src/api/sequenceDiagramApi.ts
```

---

## Validation Rules Summary

| Entity | Field | Allowed Values |
|--------|-------|----------------|
| SequenceParticipant | ref_kind | BusinessUser, Application, ApplicationComponent, Service, Interface, InterfaceEndpoint, Class |
| SequenceMessage | exchange_role | Request, Response |
| SequenceMessage | ref_kind | Method, LogicalEntity, PhysicalEntity, Class, Event |
| SequenceMessage | content | One-of: (ref_kind + ref_id) OR label_text |
| SequenceFragment | fragment_kind | Loop, Optional, Alternative |
| SequenceNode | node_kind | Message, Fragment |
| SequenceNode | message_id | Required when node_kind=Message |
| SequenceNode | fragment_id | Required when node_kind=Fragment |
