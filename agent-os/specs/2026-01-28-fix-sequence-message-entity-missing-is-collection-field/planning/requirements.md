# Spec Requirements: fix-sequence-message-entity-missing-is-collection-field

## Initial Description
Fix a bug where the "Collection<EntityName>" label never renders in sequence diagrams because SequenceMessageEntity.java is missing the isCollection field. Migration 039 added the is_collection column to the sequence_messages DB table, and SequenceMessageDto already has the isCollection field, but the Entity class was never updated. EntityMapper.toDto() hardcodes null for isCollection, so the frontend never receives the true value.

## Requirements Discussion

### Codebase Validation (In Lieu of Clarifying Questions)

This is a straightforward 3-line bugfix. Rather than clarifying questions, the codebase was directly validated to confirm the root cause and exact fix locations.

**Confirmation 1: SequenceMessageEntity.java is missing isCollection**
- File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/SequenceMessageEntity.java`
- Confirmed: The entity has fields through line 61 (updatedAt) with NO isCollection field present. The field must be added after labelText (line 43) or before showEndpointName (line 45) to match DTO field ordering.
- The class uses Lombok @Getter/@Setter/@Builder so no manual accessors are needed.

**Confirmation 2: SequenceMessageDto already has isCollection**
- File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/SequenceMessageDto.java`
- Confirmed: Lines 30-31 declare `@JsonProperty("is_collection") Boolean isCollection` in the record.

**Confirmation 3: EntityMapper.toDto() hardcodes null at line 1184**
- File: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
- Confirmed: Line 1184 reads `null,  // isCollection - Entity doesn't have this field yet, frontend treats null as false`
- The comment even documents this as a known gap.
- Fix: Replace `null` with `entity.getIsCollection()`.

**Confirmation 4: EntityMapper.toEntity() omits isCollection**
- Same file, lines 1198-1216. The builder call maps all DTO fields to entity fields but does NOT include `.isCollection(dto.isCollection())`.
- Fix: Add `.isCollection(dto.isCollection())` to the builder, logically after `.labelText(dto.labelText())` (after line 1208).

**Confirmation 5: Migration 039 already added the DB column**
- File: `architecture-model-service/src/main/resources/db/changelog/sql/039-add-sequence-messages-is-collection.sql`
- Confirmed: `ALTER TABLE sequence_messages ADD COLUMN IF NOT EXISTS is_collection BOOLEAN NOT NULL DEFAULT FALSE;`

### Existing Code to Reference
No similar existing features need referencing. The fix follows the exact same pattern used by every other Boolean field in the entity/mapper (e.g., showEndpointName at entity line 45-46, mapper lines 1185/1209).

### Follow-up Questions
None required. The root cause and fix are fully validated.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements
- SequenceMessageEntity must declare an isCollection field mapped to the is_collection DB column
- EntityMapper.toDto() must read isCollection from the entity instead of hardcoding null
- EntityMapper.toEntity() must write isCollection from DTO to entity via the builder

### Exact Changes Required

**Change 1 - SequenceMessageEntity.java (add after line 44, i.e., after the labelText field):**
```java
@Column(name = "is_collection")
private Boolean isCollection;
```

**Change 2 - EntityMapper.java line 1184 (toDto method):**
Replace `null,  // isCollection - Entity doesn't have this field yet...` with `entity.getIsCollection(),`

**Change 3 - EntityMapper.java (toEntity method, add after line 1208 i.e., after .labelText):**
Add `.isCollection(dto.isCollection())` to the builder chain.

### Reusability Opportunities
Not applicable for a bugfix of this scope.

### Scope Boundaries
**In Scope:**
- Add isCollection field to SequenceMessageEntity.java
- Fix EntityMapper.toDto() to read from entity
- Fix EntityMapper.toEntity() to write from DTO

**Out of Scope:**
- No DB migration needed (column exists)
- No DTO changes needed (field exists)
- No frontend changes needed (already handles is_collection)

### Technical Considerations
- The DB column has `NOT NULL DEFAULT FALSE`, but the entity field should be `Boolean` (nullable) to match the DTO pattern and because JPA will read the DB default correctly.
- Lombok @Getter/@Setter/@Builder on the entity class means no manual accessor methods are needed.
- The existing comment block on toDto (lines 1164-1172) referencing "Entity does not have an isCollection field yet" should be removed or updated as part of the fix.
