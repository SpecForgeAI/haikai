# Specification: Standardise Typed Diagrams by Storing Type-Specific Content as JSONB on Diagrams

## Goal

Eliminate the "typed diagram not found" failure class by storing all type-specific content (Sequence, ER, Activity, State) in a JSONB column (`typed_content_json`) on the existing `diagrams` table, replacing the separate aggregate tables pattern currently used only for Sequence diagrams.

## User Stories

- As a developer, I want typed diagrams to always have their type-specific content available so that I never encounter 404 errors when loading a newly created typed diagram.
- As a user, I want to create and edit Sequence diagrams using the generic diagram save/load flow so that the experience is consistent across all diagram types.

## Specific Requirements

**Add typed_content_json column to diagrams table**
- Add Liquibase migration (007-typed-content-json.sql) to ALTER TABLE diagrams ADD COLUMN typed_content_json JSONB NULL
- Add optional GIN index: CREATE INDEX IF NOT EXISTS idx_diagrams_typed_content_json ON diagrams USING gin (typed_content_json)
- Column is nullable because General diagrams have no typed content

**Define typed content JSON envelope structure**
- Envelope schema: `{ "type": "Sequence"|"ER"|"Activity"|"State", "version": 1, "content": {...} }`
- Type field must match the diagram's diagram_type field
- Version field enables future schema evolution
- Content field contains type-specific payload

**Define default typed content per diagram type**
- Sequence default: `{ "participants": [], "messages": [], "fragments": [], "operands": [], "sequenceNodes": [] }`
- ER default: `{ "entityRefs": [], "relationshipRefs": [] }`
- Activity default: `{ "partitions": [], "flows": [] }`
- State default: `{ "states": [], "transitions": [] }`
- General diagrams have typed_content_json = NULL

**Update DiagramEntity with typedContentJson field**
- Add field: `@Type(JsonType.class) @Column(name = "typed_content_json", columnDefinition = "jsonb") private JsonNode typedContentJson;`
- Use Jackson JsonNode for flexible JSON handling
- Follow existing pattern from DiagramEntity.settings field which uses Map with JsonType

**Update DiagramDto to include typedContent**
- Add field: `@JsonProperty("typed_content") Object typedContent` to DiagramDto record
- Object type allows flexible JSON structure per diagram type
- Update DiagramMapper.toDto() to include typedContentJson
- Update DiagramMapper.toEntity() to persist typedContent

**Ensure typed content on diagram creation (server-side)**
- When creating a diagram with diagram_type in {Sequence, ER, Activity, State}, auto-populate typed_content_json with default structure
- When diagram_type is General or null, set typed_content_json to NULL
- This ensures newly created typed diagrams never return with missing typedContent

**Validate typed content on diagram save**
- On PUT/save, validate typedContent.type matches diagram.diagram_type (return 400 if mismatch)
- Validate typedContent.version is present and equals 1
- For Sequence: validate content has required array fields (participants, messages, fragments, operands, sequenceNodes)
- Light validation only - do not deep-validate individual items in arrays

**Migrate existing sequence_* table data to typed_content_json**
- Create Java migration service (TypedContentMigrationService) to run on startup or via command
- For each diagram where diagram_type='Sequence' and typed_content_json IS NULL: load data from sequence_* tables using SequenceDiagramService, build Sequence typedContent JSON, store into diagrams.typed_content_json
- If no matching sequence_diagrams record exists, store default empty Sequence typedContent
- Log migration counts: migrated N diagrams from tables, defaulted M diagrams

**Deprecate sequence-diagrams endpoints (keep temporarily)**
- Keep GET /api/sequence-diagrams/{id} endpoint but reimplement to read from diagrams.typed_content_json
- Load diagram by id, verify diagram_type == 'Sequence', return typed_content_json.content as SequenceDiagram payload
- Keep PUT /api/sequence-diagrams/{id}/content but reimplement to write to diagrams.typed_content_json
- Add deprecation warning headers to these endpoints

**Update frontend Diagram type to include typedContent**
- Extend Diagram interface in model.ts: `typedContent?: { type: string; version: number; content: unknown }`
- Ensure fileOperations.ts parse/serialize handles typedContent field
- typedContent is optional for backward compatibility with General diagrams

**Update Sequence Editor to use diagram typedContent**
- Modify useSequenceDiagram.ts to read from activeDiagram.typedContent.content instead of calling /api/sequence-diagrams/{id}
- Remove getSequenceDiagram() and putSequenceDiagramContent() calls from sequenceDiagramApi.ts usage
- On save, update activeDiagram.typedContent.content and persist via diagram save API
- SequenceEditorPanel.tsx reads participants/messages from typedContent.content

## Existing Code to Leverage

**DiagramEntity.java JSONB pattern**
- Uses `@Type(JsonType.class) @Column(name = "settings", columnDefinition = "jsonb")` for Map-based JSON storage
- Import io.hypersistence.utils.hibernate.type.json.JsonType for Hibernate JSON support
- Same pattern applies for typedContentJson field with JsonNode type

**SequenceDiagramService.java structure**
- Contains complete Sequence diagram DTO assembly logic in assembleSequenceDiagramDto()
- Has validation methods for sequence content (validateParticipantRefKind, validateMessageRefKind, etc.)
- Entity-to-DTO and DTO-to-Entity mappers for all sequence child entities
- Reuse this logic for migration and for deprecated endpoint implementation

**EntityMapper.java mapping patterns**
- Established patterns for mapping between DTOs and entities with modelFileId parameter
- Sequence diagram mappers already exist (toDto/toEntity for SequenceParticipant, SequenceMessage, etc.)
- Follow same style for any new mapping logic

**frontend/src/types/sequenceDiagram.ts**
- Complete TypeScript types for SequenceDiagram, SequenceParticipant, SequenceMessage, SequenceFragment, SequenceOperand, SequenceNode
- Type guards for enum validation (isParticipantRefKind, isMessageRefKind, etc.)
- These types define the content structure for Sequence typedContent

**Liquibase changelog pattern**
- Add new changeset to db.changelog-master.yaml following existing pattern (007-typed-content-json)
- Use preConditions with columnExists check to prevent re-running
- SQL file at db/changelog/sql/007-typed-content-json.sql

## Out of Scope

- Full ER diagram typed editor implementation (beyond default empty typedContent)
- Full Activity diagram typed editor implementation (beyond default empty typedContent)
- Full State diagram typed editor implementation (beyond default empty typedContent)
- Removing the sequence_* tables from the database schema (deprecate only, remove in future increment)
- Removing sequenceDiagramApi.ts file (just stop using it for Sequence Editor)
- Diagram canvas rendering changes
- Adding new typed diagram types beyond the four listed (General, Sequence, ER, Activity, State)
- Versioned schema migration for typedContent (v1 only, evolution deferred)
- Deep validation of sequence content items (participants, messages, etc.) on diagram save
- Frontend display of deprecation warnings for old API usage
