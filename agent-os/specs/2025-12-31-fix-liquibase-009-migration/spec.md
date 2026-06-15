# Specification: Fix Liquibase 009 Migration Failure

## Goal
Fix the failing Liquibase changeset 009 by reordering operations to drop NOT NULL immediately after column rename, normalize legacy cardinality values to canonical enum strings, and remove the duplicate DROP NOT NULL at the end.

## User Stories
- As a developer, I want the architecture-model-service to start successfully so that I can use the application with existing data.
- As an operator, I want legacy cardinality values automatically normalized during migration so that existing databases are upgraded without manual intervention.

## Specific Requirements

**Drop NOT NULL immediately after column rename**
- Move the DROP NOT NULL statement from STEP 8 to immediately after STEP 1 (the RENAME COLUMN)
- This allows subsequent UPDATE statements to set NULL values before constraints are added
- Insert after line 12: `ALTER TABLE logical_data_entity_relationships ALTER COLUMN cardinality DROP NOT NULL;`

**Add cardinality normalization UPDATE statement**
- Insert a new STEP between the DROP NOT NULL and STEP 2 (Add new columns)
- Use a CASE statement to map legacy values to canonical enum strings
- Handle variations: underscores, hyphens, spaces, numeric notation (1:1, 1:M, M:1, M:M), UML notation (1..*, *..*), mixed case
- Set any unmappable values to NULL to satisfy the CHECK constraint

**Remove duplicate STEP 8**
- Delete STEP 8 entirely (lines 90-96) since DROP NOT NULL is now performed earlier
- This eliminates redundancy and prevents potential issues with re-running the statement

**Preserve all CHECK constraints in STEP 6**
- Keep chk_cardinality_enum constraint unchanged: `CHECK (cardinality IS NULL OR cardinality IN ('ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'))`
- The constraint allows NULL values, which is why unknown legacy values are set to NULL

**Maintain migration order for other operations**
- STEP 2 (Add new columns) remains unchanged
- STEP 3 (Migrate to polymorphic refs) remains unchanged
- STEP 4-5 (Drop legacy constraints and columns) remain unchanged
- STEP 6-7 (Add CHECK constraints) remain unchanged but now execute after normalization

## Existing Code to Leverage

**Current 009 SQL structure (lines 1-97)**
- STEP 1 (line 12): Renames relationship_type to cardinality - keep as-is
- STEP 2-7 (lines 14-88): Add columns, migrate data, drop old columns, add constraints - keep as-is
- STEP 8 (lines 90-96): DROP NOT NULL - remove entirely, move logic to after STEP 1

**Existing CHECK constraint pattern**
- Pattern: `CHECK (column IS NULL OR column IN ('VALUE1', 'VALUE2', ...))`
- This pattern allows NULL values, which is critical for the normalization approach
- No changes needed to constraint syntax

**Existing UPDATE pattern from STEP 3 (lines 30-34)**
- Shows how to write UPDATE statements in this migration
- Follow same formatting style for the new normalization UPDATE

## Out of Scope
- Java code changes in architecture-model-service
- Changes to other Liquibase changesets (001-008, 010+)
- Adding new columns or constraints beyond what is already in 009
- Creating a new changeset file (edit 009 in place since it failed and was not recorded)
- Preserving unknown legacy cardinality values (they must become NULL)
- Adding rollback logic to the changeset
- Modifying the Liquibase changelog master file
- Changes to frontend code
- Database backup or restore procedures
- Adding logging or audit trail for normalized values
