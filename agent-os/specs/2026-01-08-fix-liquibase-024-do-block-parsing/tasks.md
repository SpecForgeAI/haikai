# Task Breakdown: Fix Liquibase Changeset 024 Postgres DO $ Parsing

## Overview
Total Tasks: 10

This task breakdown addresses the Liquibase parsing error where Postgres DO $ blocks in changeset 024 are incorrectly split by Liquibase's statement parser. The fix involves splitting the original SQL file into two separate files with appropriate endDelimiter settings.

## Task List

### SQL Migration Layer

#### Task Group 1: Create Split SQL Files
**Dependencies:** None

- [x] 1.0 Complete SQL file splitting
  - [x] 1.1 Create `024a-remove-legacy-data-entity-columns-preconditions.sql`
    - Extract DO $ blocks from original file (lines 25-68)
    - Include header comments explaining precondition checks
    - Contains 3 DO $ blocks checking for NULL values in:
      - `from_data_entity_point_id` in `logical_data_entity_relationships`
      - `to_data_entity_point_id` in `logical_data_entity_relationships`
      - `data_entity_point_id` in `data_movements`
    - Each DO $ block must end with `$;` delimiter (replace `$$;` with `$;`)
    - Location: `architecture-model-service/src/main/resources/db/changelog/sql/024a-remove-legacy-data-entity-columns-preconditions.sql`
  - [x] 1.2 Create `024b-remove-legacy-data-entity-columns-apply.sql`
    - Extract ALTER TABLE and DROP statements from original file (lines 71-138)
    - Include header comments explaining schema modifications
    - Contains:
      - ALTER COLUMN SET NOT NULL statements (3 statements)
      - DROP CONSTRAINT statements for legacy pairwise checks (2 statements)
      - DROP CONSTRAINT statements for legacy enum checks (2 statements)
      - DROP COLUMN statements for legacy columns (4 columns from `logical_data_entity_relationships`)
      - DROP CONSTRAINT for legacy FK from `data_movements` (1 statement)
      - DROP COLUMN for legacy column from `data_movements` (1 statement)
    - Uses standard semicolon delimiter
    - Location: `architecture-model-service/src/main/resources/db/changelog/sql/024b-remove-legacy-data-entity-columns-apply.sql`
  - [x] 1.3 Archive or delete original `024-remove-legacy-data-entity-columns.sql`
    - Option A: Rename to `024-remove-legacy-data-entity-columns.sql.bak`
    - Option B: Delete file entirely (changelog no longer references it)
    - Recommended: Delete to avoid confusion

**Acceptance Criteria:**
- 024a file contains only DO $ block precondition checks with `$;` delimiters
- 024b file contains only ALTER/DROP statements with standard `;` delimiters
- Combined content of 024a + 024b matches original 024 file intent
- Original 024 file is removed or archived

### Liquibase Configuration Layer

#### Task Group 2: Update Changelog Master File
**Dependencies:** Task Group 1

- [x] 2.0 Complete changelog configuration update
  - [x] 2.1 Remove existing changeset entry for `024-remove-legacy-data-entity-columns`
    - Location: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Lines ~386-405 in current file
  - [x] 2.2 Add changeset entry for `024a-remove-legacy-data-entity-columns-preconditions`
    - Use id: `024a-remove-legacy-data-entity-columns-preconditions`
    - Set `endDelimiter: "$;"`
    - Set `splitStatements: true`
    - Set `stripComments: false` (preserve DO block structure)
    - Maintain same preConditions checking for `from_ref_kind` column existence
    - Path: `db/changelog/sql/024a-remove-legacy-data-entity-columns-preconditions.sql`
  - [x] 2.3 Add changeset entry for `024b-remove-legacy-data-entity-columns-apply`
    - Use id: `024b-remove-legacy-data-entity-columns-apply`
    - Use default `endDelimiter: ";"` (or omit for default)
    - Set `splitStatements: true`
    - Set `stripComments: true`
    - No preConditions needed (024a handles validation)
    - Path: `db/changelog/sql/024b-remove-legacy-data-entity-columns-apply.sql`
  - [x] 2.4 Verify YAML syntax and ordering
    - Ensure 024a entry appears before 024b entry
    - Validate YAML indentation matches existing entries
    - Confirm no trailing whitespace issues

**Acceptance Criteria:**
- Changelog contains two sequential entries for 024a and 024b
- 024a uses `endDelimiter: "$;"` configuration
- 024b uses standard delimiter configuration
- YAML syntax is valid
- Ordering preserves migration sequence (024a before 024b)

### Validation Layer

#### Task Group 3: Verification and Testing
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Complete verification
  - [x] 3.1 Verify SQL file content integrity
    - Confirm 024a contains exactly 3 DO $ blocks
    - Confirm 024b contains all 13 ALTER/DROP statements
    - Verify no SQL logic was changed, only file organization
  - [x] 3.2 Validate Liquibase changelog parsing
    - Run `mvn liquibase:validate` or equivalent validation command
    - Ensure no parsing errors in changelog
    - Verify changesets are recognized in correct order
  - [ ] 3.3 Test migration execution (if test database available)
    - Run migration against test database
    - Verify precondition checks execute without parsing errors
    - Verify schema modifications apply correctly
    - Confirm migration is idempotent (can be marked as run)

**Acceptance Criteria:**
- SQL files pass manual content review
- Liquibase validates changelog without errors
- Migration executes successfully on test database (if available)
- No regression in migration behavior

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Create Split SQL Files** - Create the two new SQL files and handle the original
2. **Task Group 2: Update Changelog Master File** - Configure Liquibase to use the new files
3. **Task Group 3: Verification and Testing** - Validate the changes work correctly

## File Reference Summary

| File | Action | Location |
|------|--------|----------|
| `024-remove-legacy-data-entity-columns.sql` | DELETE | `architecture-model-service/src/main/resources/db/changelog/sql/` |
| `024a-remove-legacy-data-entity-columns-preconditions.sql` | CREATE | `architecture-model-service/src/main/resources/db/changelog/sql/` |
| `024b-remove-legacy-data-entity-columns-apply.sql` | CREATE | `architecture-model-service/src/main/resources/db/changelog/sql/` |
| `db.changelog-master.yaml` | MODIFY | `architecture-model-service/src/main/resources/db/changelog/` |

## Technical Notes

### EndDelimiter Configuration
- The `endDelimiter: "$;"` setting tells Liquibase to split statements on `$;` instead of `;`
- This prevents the parser from splitting the DO $ block at internal semicolons
- The 024b file uses default `;` delimiter since it contains standard SQL statements

### Precondition Preservation
- The changelog preConditions checking for `from_ref_kind` column should be preserved
- This ensures the migration only runs if the legacy columns still exist
- Both 024a and 024b can share this precondition or only 024a can have it

### StripComments Consideration
- For 024a, consider `stripComments: false` to preserve DO block structure
- For 024b, `stripComments: true` is safe for standard ALTER/DROP statements
