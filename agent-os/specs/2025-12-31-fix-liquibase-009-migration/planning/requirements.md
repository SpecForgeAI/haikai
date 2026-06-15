# Requirements: Fix Liquibase 009 Migration Failure

## Title
Fix Liquibase 009 migration failure by normalizing legacy cardinality values before adding enum CHECK constraint

## Context
- Service fails to start because changeset 009 adds CHECK constraint chk_cardinality_enum on logical_data_entity_relationships.cardinality, but existing rows contain values outside:
    ('ONE_TO_ONE','ONE_TO_MANY','MANY_TO_ONE','MANY_TO_MANY')
- In schema.sql, the legacy column relationship_type was a free-text NOT NULL field, so historic data can contain arbitrary strings.
- In 009 SQL, you rename relationship_type -> cardinality and only drop NOT NULL at the end, *after* adding constraints, which also prevents cleansing invalid values to NULL before constraint creation.

## Goal
Make changeset 009 succeed on existing databases by:
1. Dropping NOT NULL immediately after rename
2. Normalizing legacy cardinality values to the canonical enum strings
3. Nulling any non-mappable values (so they pass the CHECK as NULL)
4. Only then adding chk_cardinality_enum and other CHECK constraints

## Scope
- architecture-model-service Liquibase only
- no Java code changes required

## Files to Change
- src/main/resources/db/changelog/sql/009-logical-er-polymorphic-endpoints.sql

## Implementation

### 1) Reorder and modify 009 SQL to drop NOT NULL earlier
Immediately after:
```sql
ALTER TABLE logical_data_entity_relationships RENAME COLUMN relationship_type TO cardinality;
```
add:
```sql
ALTER TABLE logical_data_entity_relationships ALTER COLUMN cardinality DROP NOT NULL;
```

### 2) Normalize existing cardinality values BEFORE adding chk_cardinality_enum
Insert a normalization UPDATE after the DROP NOT NULL and before adding constraints.
Use a robust mapping that handles common legacy formats (case, hyphen, spaces, punctuation).
Example canonicalization (must be included verbatim in the SQL file):

```sql
UPDATE logical_data_entity_relationships
SET cardinality =
  CASE
    WHEN cardinality IS NULL THEN NULL

    -- ONE_TO_ONE
    WHEN UPPER(TRIM(cardinality)) IN ('ONE_TO_ONE','ONE-TO-ONE','ONE TO ONE','1:1','1-1','1..1') THEN 'ONE_TO_ONE'

    -- ONE_TO_MANY
    WHEN UPPER(TRIM(cardinality)) IN ('ONE_TO_MANY','ONE-TO-MANY','ONE TO MANY','1:M','1..*','1..N','ONE_TO_MANY ') THEN 'ONE_TO_MANY'

    -- MANY_TO_ONE
    WHEN UPPER(TRIM(cardinality)) IN ('MANY_TO_ONE','MANY-TO-ONE','MANY TO ONE','M:1','*..1','N..1') THEN 'MANY_TO_ONE'

    -- MANY_TO_MANY
    WHEN UPPER(TRIM(cardinality)) IN ('MANY_TO_MANY','MANY-TO-MANY','MANY TO MANY','M:M','*..*','N..N') THEN 'MANY_TO_MANY'

    -- unknown legacy values -> NULL (so CHECK passes)
    ELSE NULL
  END;
```

NOTE: Do not attempt to preserve unknown strings; set them to NULL to unblock startup.

### 3) Keep the rest of the migration, but remove the now-duplicated "drop NOT NULL" at the end
In 009 SQL, you currently have "STEP 8 ... DROP NOT NULL".
Remove STEP 8 entirely (since you moved DROP NOT NULL right after rename).

### 4) Ensure constraints are added after normalization (no other changes)
The ADD CONSTRAINT chk_cardinality_enum and all other CHECK constraints remain as-is, but must appear *after* the normalization UPDATE.

### 5) Safety/Idempotence notes
This changeset is safe to edit in-place because:
- It failed, so it will not be recorded in DATABASECHANGELOG.
- Liquibase will re-run it from scratch after you fix the SQL.

## Validation Steps
- Re-run docker compose for the stack
- Confirm architecture-model-service starts and Liquibase completes.
- (Optional) Verify values:
    SELECT DISTINCT cardinality FROM logical_data_entity_relationships;

## Definition of Done
- Service starts successfully.
- Liquibase changeset 009 applies without violating chk_cardinality_enum.
- Any non-mappable legacy cardinality values are NULL (allowed), and valid ones are canonical enum strings.
