# Raw Idea

**Name:** fix-sequence-message-entity-missing-is-collection-field
**Scope:** backend
**Type:** bugfix
**Date:** 2026-01-28

## Description

```
intent:
  Fix a bug where the "Collection<EntityName>" label never renders in sequence diagrams
  because SequenceMessageEntity.java is missing the isCollection field. Migration 039 added
  the is_collection column to the sequence_messages DB table, and SequenceMessageDto already
  has the isCollection field, but the Entity class was never updated. EntityMapper.toDto()
  hardcodes null for isCollection, so the frontend never receives the true value.

root_cause:
  - SequenceMessageEntity.java does NOT have an isCollection field
  - EntityMapper.java line 1184 hardcodes null for isCollection in toDto()
  - EntityMapper.java toEntity() does not map isCollection from DTO to entity builder
  - The DB column exists (migration 039), the DTO has the field, but the entity/mapper bridge is broken

fix_required:
  files_to_change:
    - architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/SequenceMessageEntity.java:
        - Add: @Column(name = "is_collection") private Boolean isCollection; (with getter/setter or Lombok)
    - architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java:
        - toDto(): Replace null with entity.getIsCollection() at line ~1184
        - toEntity(): Add .isCollection(dto.isCollection()) to the builder

constraints:
  - No DB migration needed (column already exists from migration 039)
  - No DTO changes needed (field already exists on SequenceMessageDto)
  - No frontend changes needed (formatEntityLabel/resolveMessageLabel already handle is_collection correctly)
  - Only backend entity + mapper need fixing

acceptance_criteria:
  - SequenceMessageEntity has isCollection field mapped to is_collection column
  - EntityMapper.toDto() reads isCollection from entity (not hardcoded null)
  - EntityMapper.toEntity() writes isCollection from DTO to entity
  - Collection<EntityName> renders in sequence diagram when checkbox is checked
  - architecture-model-service starts with ddl-auto=validate (column already exists)
```
