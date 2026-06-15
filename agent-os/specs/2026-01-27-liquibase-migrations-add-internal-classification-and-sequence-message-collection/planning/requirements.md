# Spec Requirements: Liquibase Migrations - Add Internal Classification and Sequence Message Collection

## Initial Description
Update the persisted database schema (Liquibase-managed) to match the meta-model and sequence diagram enhancements, so that Hibernate schema validation passes and new UI features can persist/read required attributes.

## Requirements Discussion

### Codebase Analysis Findings

**IMPORTANT: The spec is partially outdated - several fields already exist in both Entity classes and database.**

#### Entity Classes Current State:

| Entity | Field | Already Has Field? | Already in DB Schema? |
|--------|-------|-------------------|----------------------|
| `ApplicationEntity` | `isInternal` | YES (line 43-44) | NO |
| `ApplicationComponentEntity` | `isInternal` | YES (line 40-41) | NO |
| `ApplicationComponentEntity` | `techType` | YES (line 43-44) | NO |
| `ServiceEntity` | `isInternal` | YES (line 52-53) | NO |
| `SequenceMessageEntity` | `isCollection` | NO | NO |

#### DTO Classes Current State:
- `ApplicationDto` - has `isInternal` field
- `ApplicationComponentDto` - has `isInternal` and `techType` fields
- `ServiceDto` - has `isInternal` field
- `SequenceMessageDto` - has `isCollection` field

#### Database Schema (schema.sql - original migration):
- `applications` table: Does NOT have `is_internal` column
- `application_components` table: Does NOT have `is_internal` or `tech_type` columns
- `services` table: Does NOT have `is_internal` column
- `sequence_messages` table: Does NOT have `is_collection` column

### Migration Number Validation

**Current highest migration in db.changelog-master.yaml:** `035-work-item-implement-context-relationships`

**Proposed migrations in spec:**
- `036-add-internal-classification-applications.sql` - for `applications` table
- `037-add-internal-classification-application-components.sql` - for `application_components` table
- `038-add-internal-classification-services.sql` - for `services` table
- `039-add-sequence-messages-is-collection.sql` - for `sequence_messages` table

### Table Name Validation

| Spec Table Name | Actual Table Name | Match? |
|-----------------|-------------------|--------|
| `applications` | `applications` | YES |
| `application_components` | `application_components` | YES |
| `services` | `services` | YES |
| `sequence_messages` | `sequence_messages` | YES |

### Discrepancy Found

**The spec proposes adding `isCollection` to SequenceMessageEntity, but the entity class does NOT have this field yet.**

Current `SequenceMessageEntity.java` fields:
- `id`, `sequenceDiagramId`, `exchangeId`, `exchangeRole`
- `fromParticipantId`, `toParticipantId`
- `refKind`, `refId`, `labelText`
- `createdAt`, `updatedAt`
- **Missing: `isCollection`**

Meanwhile, `SequenceMessageDto` DOES have `isCollection` (line 30-31), indicating the DTO was updated but the Entity was not.

## Clarifying Questions

Based on my analysis, I have the following clarifying questions:

1. **Entity Class Update Required**: The `SequenceMessageEntity` class is missing the `isCollection` field (it exists in the DTO but not the Entity). Should this spec include updating the Entity class to add `@Column(name = "is_collection") private Boolean isCollection;`? Or is that covered by a separate spec?

2. **Author Convention**: The spec proposes `author: agent-os` but existing migrations use `author: architecture-tool`. Should we maintain consistency with existing convention (`architecture-tool`) or use the new author name?

3. **Precondition Strategy**: The spec only checks if `applications.is_internal` column exists as the precondition for migration 036. However, this single migration adds columns to THREE tables. If the migration fails partway through, re-running might skip necessary columns. Would you prefer:
   - (A) Keep single precondition (current approach) - simpler but less robust
   - (B) Split into three separate migrations (036a, 036b, 036c) - more granular preconditions
   - (C) Keep single migration but accept the edge case risk

### User Answers

**Q1: Entity Class Update Required**
**Answer:** NO. This spec is DB/Liquibase-only. JPA entity + DTO updates belong in a separate shape-spec.

**Q2: Author Convention**
**Answer:** Use `architecture-tool`. Reason: matches existing repo convention and avoids changeSet identity issues.

**Q3: Precondition Strategy**
**Answer:** NOT acceptable to gate multiple tables behind one precondition. SHOULD split into separate changeSets (one per table) or use explicit per-column preconditions. Preferred approach: one changeSet per table.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements
- Add `is_internal BOOLEAN NOT NULL DEFAULT TRUE` column to `applications` table
- Add `is_internal BOOLEAN NOT NULL DEFAULT TRUE` column to `application_components` table
- Add `tech_type TEXT NOT NULL DEFAULT 'Other'` column to `application_components` table
- Add `is_internal BOOLEAN NOT NULL DEFAULT TRUE` column to `services` table
- Add `is_collection BOOLEAN NOT NULL DEFAULT FALSE` column to `sequence_messages` table

### Existing Code to Reference
- Migration file structure: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/resources/db/changelog/sql/`
- Master changelog: `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
- Example recent migrations: `034-work-item-implement-workspace.sql`, `035-work-item-implement-context-relationships.sql`
- Entity classes are already updated for all fields EXCEPT `SequenceMessageEntity.isCollection`

### Scope Boundaries

**In Scope:**
- Four new Liquibase SQL migration files (036, 037, 038, 039) - one per table
- Updates to db.changelog-master.yaml with new changeSet entries
- Preconditions on each changeSet checking if the column exists on that specific table

**Out of Scope:**
- No DB enum types for `tech_type` (store as TEXT)
- No data backfill beyond defaults
- **No Java Entity class updates** - this spec is strictly DB migrations only
- **No DTO updates** - JPA entity + DTO updates belong in a separate shape-spec

### Technical Considerations
- Hibernate schema validation (`ddl-auto=validate`) must pass after migrations
- Existing rows will receive default values automatically
- Column naming convention: snake_case (e.g., `is_internal`, `tech_type`, `is_collection`)
- **Author for all changeSets:** `architecture-tool` (matches existing repo convention)
- **Migration structure:** One changeSet per table with its own precondition
  - Migration 036: `applications` table - `is_internal` column
  - Migration 037: `application_components` table - `is_internal` and `tech_type` columns
  - Migration 038: `services` table - `is_internal` column
  - Migration 039: `sequence_messages` table - `is_collection` column
- Each changeSet must have its own precondition checking if the column(s) exist on that specific table
