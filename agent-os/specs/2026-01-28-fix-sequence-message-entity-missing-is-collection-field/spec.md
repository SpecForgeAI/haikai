# Specification: Fix SequenceMessage Entity Missing isCollection Field

## Goal
Fix a bug where "Collection<EntityName>" labels never render in sequence diagrams because the isCollection field is missing from SequenceMessageEntity and the EntityMapper hardcodes null instead of reading the DB value.

## User Stories
- As a user viewing a sequence diagram, I want messages marked as collections to display "Collection<EntityName>" so that I can see the correct data cardinality on diagram arrows.

## Specific Requirements

**Add isCollection field to SequenceMessageEntity**
- Add `@Column(name = "is_collection") private Boolean isCollection;` to `SequenceMessageEntity.java` after line 43 (the `labelText` field)
- The class already uses Lombok `@Getter/@Setter/@Builder`, so no manual accessors are needed
- The DB column already exists via migration 039 with `BOOLEAN NOT NULL DEFAULT FALSE`
- No new migration is required

**Fix EntityMapper.toDto() to read isCollection from entity**
- In `EntityMapper.java` line 1184, replace `null,  // isCollection - Entity doesn't have this field yet, frontend treats null as false` with `entity.getIsCollection(),`
- Update or remove the Javadoc comment block at lines 1164-1172 that documents isCollection as a known gap

**Fix EntityMapper.toEntity() to write isCollection from DTO**
- In `EntityMapper.java` toEntity method (lines 1198-1216), add `.isCollection(dto.isCollection())` to the builder chain after `.labelText(dto.labelText())` (after line 1208)

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**SequenceMessageDto (already has isCollection)**
- File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/SequenceMessageDto.java`
- Lines 30-31 already declare `@JsonProperty("is_collection") Boolean isCollection`
- No changes needed to this file

**showEndpointName Boolean field pattern in SequenceMessageEntity**
- File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/SequenceMessageEntity.java`
- Lines 45-46 show the exact pattern to follow: `@Column(name = "show_endpoint_name") private Boolean showEndpointName;`
- The new isCollection field should use the identical `@Column` + `private Boolean` pattern

**Migration 039 (DB column already exists)**
- File: `architecture-model-service/src/main/resources/db/changelog/sql/039-add-sequence-messages-is-collection.sql`
- Column `is_collection BOOLEAN NOT NULL DEFAULT FALSE` already exists on `sequence_messages` table
- No migration work needed; Hibernate `ddl-auto=validate` will pass once the entity field is added

## Out of Scope
- No new DB migration (column already exists from migration 039)
- No changes to SequenceMessageDto (field already exists)
- No frontend changes (formatEntityLabel/resolveMessageLabel already handle is_collection correctly)
- No changes to SequenceDiagramService or any other service class
- No changes to any controller class
- No changes to any test files beyond verifying the fix works
