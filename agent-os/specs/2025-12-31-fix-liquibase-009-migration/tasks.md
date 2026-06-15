# Task Breakdown: Fix Liquibase 009 Migration Failure

## Overview
Total Tasks: 5
Scope: SQL migration file modification only (no Java, no frontend, no tests)

## File to Modify
`architecture-model-service/src/main/resources/db/changelog/sql/009-logical-er-polymorphic-endpoints.sql`

## Task List

### SQL Migration Fix

#### Task Group 1: Reorder DROP NOT NULL and Add Normalization
**Dependencies:** None

- [x] 1.0 Complete SQL migration fix
  - [x] 1.1 Insert DROP NOT NULL immediately after STEP 1 (line 12)
    - After line 12 (`ALTER TABLE logical_data_entity_relationships RENAME COLUMN relationship_type TO cardinality;`)
    - Insert blank line and new statement:
      ```sql
      ALTER TABLE logical_data_entity_relationships ALTER COLUMN cardinality DROP NOT NULL;
      ```
    - This allows subsequent UPDATE to set NULL values before CHECK constraints are added
  - [x] 1.2 Insert cardinality normalization UPDATE statement after DROP NOT NULL
    - Add a new STEP comment header (e.g., "STEP 1b: Normalize legacy cardinality values")
    - Insert the normalization UPDATE with CASE statement to map legacy values:
      ```sql
      UPDATE logical_data_entity_relationships
      SET cardinality =
        CASE
          WHEN cardinality IS NULL THEN NULL
          WHEN UPPER(TRIM(cardinality)) IN ('ONE_TO_ONE','ONE-TO-ONE','ONE TO ONE','1:1','1-1','1..1') THEN 'ONE_TO_ONE'
          WHEN UPPER(TRIM(cardinality)) IN ('ONE_TO_MANY','ONE-TO-MANY','ONE TO MANY','1:M','1..*','1..N','ONE_TO_MANY ') THEN 'ONE_TO_MANY'
          WHEN UPPER(TRIM(cardinality)) IN ('MANY_TO_ONE','MANY-TO-ONE','MANY TO ONE','M:1','*..1','N..1') THEN 'MANY_TO_ONE'
          WHEN UPPER(TRIM(cardinality)) IN ('MANY_TO_MANY','MANY-TO-MANY','MANY TO MANY','M:M','*..*','N..N') THEN 'MANY_TO_MANY'
          ELSE NULL
        END;
      ```
    - Unknown legacy values become NULL to satisfy CHECK constraint
  - [x] 1.3 Remove STEP 8 entirely (current lines 90-97)
    - Delete the entire STEP 8 block including:
      - Comment header (lines 90-94)
      - The duplicate `ALTER TABLE ... ALTER COLUMN cardinality DROP NOT NULL;` (line 96)
      - Trailing blank line (line 97)
    - This eliminates redundancy since DROP NOT NULL is now performed after STEP 1
  - [x] 1.4 Verify final SQL structure is correct
    - STEP 1: RENAME COLUMN (unchanged)
    - NEW: DROP NOT NULL (moved from STEP 8)
    - NEW: Normalize cardinality values (new UPDATE)
    - STEP 2: Add new columns (unchanged, lines 14-22)
    - STEP 3: Migrate to polymorphic refs (unchanged, lines 24-34)
    - STEP 4: Drop legacy FK constraints (unchanged, lines 36-42)
    - STEP 5: Drop legacy columns (unchanged, lines 44-49)
    - STEP 6: Add CHECK constraints (unchanged, lines 51-73)
    - STEP 7: Add pairwise null CHECK constraints (unchanged, lines 75-88)
    - STEP 8: REMOVED
  - [x] 1.5 Validate SQL syntax (visual review)
    - Ensure all semicolons are present
    - Ensure CASE statement syntax is correct
    - Ensure no duplicate DROP NOT NULL statements remain

**Acceptance Criteria:**
- DROP NOT NULL appears immediately after RENAME COLUMN (before any CHECK constraints)
- Normalization UPDATE appears before STEP 6 (chk_cardinality_enum constraint)
- STEP 8 is completely removed
- All CHECK constraints (STEP 6-7) remain unchanged
- SQL is syntactically valid

### Validation

#### Task Group 2: Manual Validation via Docker Compose
**Dependencies:** Task Group 1

- [x] 2.0 Validate migration success
  - [x] 2.1 Run docker compose to start the stack
    - Execute: `docker compose up` (or equivalent for this project)
    - Observe architecture-model-service logs
  - [x] 2.2 Confirm Liquibase changeset 009 applies successfully
    - No constraint violation errors in logs
    - Service starts without Liquibase exceptions
  - [x] 2.3 (Optional) Verify cardinality values in database
    - Connect to PostgreSQL database
    - Run: `SELECT DISTINCT cardinality FROM logical_data_entity_relationships;`
    - Confirm values are either NULL or one of: 'ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'

**Acceptance Criteria:**
- architecture-model-service starts successfully
- Liquibase changeset 009 completes without errors
- No chk_cardinality_enum constraint violations
- Legacy cardinality values are normalized or NULL

## Execution Order

1. SQL Migration Fix (Task Group 1) - Modify the 009 SQL file
2. Manual Validation (Task Group 2) - Verify via docker compose

## Notes

- **No automated tests required**: This is a database migration fix validated manually via docker compose
- **Safe to edit in-place**: Changeset 009 failed, so it is not recorded in DATABASECHANGELOG and will re-run from scratch
- **No rollback logic needed**: Per spec, rollback is out of scope
- **No Java changes**: All changes are confined to the SQL migration file
