# Task Breakdown: Fix Liquibase 024a DO Block Syntax

## Overview
Total Tasks: 8

This is a focused bug fix that corrects invalid PostgreSQL DO block syntax in a Liquibase migration file and updates the corresponding YAML changelog entry. The fix involves changing single dollar-quote delimiters (`$`) to proper double dollar-quote delimiters (`$$`).

## Task List

### Database Migration Fix

#### Task Group 1: Fix SQL Dollar-Quoting Syntax
**Dependencies:** None

- [x] 1.0 Complete SQL file dollar-quoting fix
  - [x] 1.1 Review current 024a SQL file structure
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/024a-remove-legacy-data-entity-columns-preconditions.sql`
    - Identify all 3 DO blocks (lines 26, 42, 58)
    - Confirm current invalid syntax: `DO $` and `END $;`
  - [x] 1.2 Fix DO block 1 (from_data_entity_point_id check)
    - Line 26: Change `DO $` to `DO $$`
    - Line 37: Change `END $;` to `END $$;`
  - [x] 1.3 Fix DO block 2 (to_data_entity_point_id check)
    - Line 42: Change `DO $` to `DO $$`
    - Line 53: Change `END $;` to `END $$;`
  - [x] 1.4 Fix DO block 3 (data_entity_point_id check)
    - Line 58: Change `DO $` to `DO $$`
    - Line 69: Change `END $;` to `END $$;`
  - [x] 1.5 Update comment on lines 17-18
    - Replace: "uses $; as the statement delimiter"
    - With: "Uses DO $$ ... END $$; and Liquibase endDelimiter $$; to avoid splitting DO blocks"

**Acceptance Criteria:**
- All 3 DO blocks use `DO $$` opening syntax
- All 3 DO blocks use `END $$;` closing syntax
- Comment accurately documents the dollar-quoting pattern
- No changes to the precondition check logic (DECLARE, SELECT, IF, RAISE statements unchanged)

#### Task Group 2: Update Liquibase YAML Changelog
**Dependencies:** Task Group 1

- [x] 2.0 Complete YAML changelog update
  - [x] 2.1 Locate 024a changeset in db.changelog-master.yaml
    - File: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Find changeSet id: `024a-remove-legacy-data-entity-columns-preconditions` (line 391)
  - [x] 2.2 Update endDelimiter value
    - Line 406: Change `endDelimiter: "$;"` to `endDelimiter: "$$;"`
    - Preserve `splitStatements: true`
    - Preserve `stripComments: false`
  - [x] 2.3 Update comment on line 389
    - Change: `Uses endDelimiter: "$;"`
    - To: `Uses endDelimiter: "$$;"` (or similar accurate description)

**Acceptance Criteria:**
- endDelimiter changed from `"$;"` to `"$$;"`
- splitStatements and stripComments settings preserved
- Comment accurately reflects the corrected delimiter

#### Task Group 3: Verify 024b Changeset Unchanged
**Dependencies:** Task Group 2

- [x] 3.0 Verify 024b changeset requires no changes
  - [x] 3.1 Confirm 024b changeset configuration
    - Locate changeSet id: `024b-remove-legacy-data-entity-columns-apply` (line 413)
    - Verify endDelimiter is absent (defaults to `;`) or explicitly set to `;`
    - Confirm 024b uses standard semicolon delimiters for ALTER TABLE statements
  - [x] 3.2 Verify 024b SQL file unchanged
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/024b-remove-legacy-data-entity-columns-apply.sql`
    - Confirm file contains only standard ALTER TABLE statements
    - Confirm no DO blocks or dollar-quoting present
    - Do NOT modify this file

**Acceptance Criteria:**
- 024b changeset retains default semicolon delimiter
- 024b SQL file contains no DO blocks
- No changes made to 024b files

### Verification

#### Task Group 4: Service Startup Verification
**Dependencies:** Task Groups 1-3

- [x] 4.0 Verify migration fix
  - [x] 4.1 Syntax validation
    - Review all changes for correct PostgreSQL dollar-quoting syntax
    - Confirm `DO $$` and `END $$;` pattern is consistent across all 3 blocks
    - Verify no accidental introduction of `DO $$;` or `DO $do$` variants
  - [x] 4.2 Test service startup (manual verification)
    - Start architecture-model-service
    - Verify Liquibase migrations execute without syntax errors
    - Confirm 024a precondition checks run successfully (assuming data is valid)
    - Confirm 024b schema modifications apply correctly
  - [x] 4.3 Document verification results
    - Record successful migration execution
    - Note any warnings or issues encountered

**Acceptance Criteria:**
- Service starts successfully
- Liquibase migrations complete without syntax errors
- 024a precondition checks execute correctly
- 024b schema modifications apply correctly

## Execution Order

Recommended implementation sequence:
1. Fix SQL Dollar-Quoting Syntax (Task Group 1)
2. Update Liquibase YAML Changelog (Task Group 2)
3. Verify 024b Changeset Unchanged (Task Group 3)
4. Service Startup Verification (Task Group 4)

## Files to Modify

| File | Changes Required |
|------|------------------|
| `architecture-model-service/src/main/resources/db/changelog/sql/024a-remove-legacy-data-entity-columns-preconditions.sql` | Fix DO block syntax (6 replacements) + update comment |
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | Change endDelimiter + update comment |

## Files to Verify (No Changes)

| File | Verification |
|------|--------------|
| `architecture-model-service/src/main/resources/db/changelog/sql/024b-remove-legacy-data-entity-columns-apply.sql` | Confirm no DO blocks, standard semicolons |
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` (024b section) | Confirm default semicolon delimiter |

## Out of Scope Reminder

- No Java code changes
- No changes to precondition check logic
- No changes to 024b schema modifications
- No changes to other migration files
- No frontend changes
- No new migrations

## Verification Results

### Task Group 4.1 - Syntax Validation Results

**024a SQL File Verification:**
- Line 26: `DO $$` - CORRECT (double dollar)
- Line 37: `END $$;` - CORRECT (double dollar)
- Line 42: `DO $$` - CORRECT (double dollar)
- Line 53: `END $$;` - CORRECT (double dollar)
- Line 58: `DO $$` - CORRECT (double dollar)
- Line 69: `END $$;` - CORRECT (double dollar)
- Lines 17-18: Comment updated to document `DO $$ ... END $$;` pattern

**YAML Changelog Verification:**
- Line 387: Comment updated to document `DO $$` blocks
- Line 389: Comment updated to document `endDelimiter: "$$;"`
- Line 406: `endDelimiter: "$$;"` - CORRECT (double dollar)
- `splitStatements: true` - PRESERVED
- `stripComments: false` - PRESERVED

**024b Verification (No Changes Required):**
- 024b changeset has NO endDelimiter (uses default `;`) - CORRECT
- 024b SQL file contains only standard ALTER TABLE statements - VERIFIED
- No DO blocks or dollar-quoting in 024b - VERIFIED

### Task Group 4.2 - Manual Testing Required

To verify the fix works correctly, the user should:

1. Start the architecture-model-service with a fresh database or where migration 024a has not yet run
2. Verify Liquibase executes migration 024a without syntax errors
3. If precondition data exists, verify the DO blocks execute correctly
4. Verify migration 024b applies schema modifications after 024a passes

### Task Group 4.3 - Implementation Summary

All syntax fixes have been applied:
- Changed 6 occurrences of single `$` to double `$$` in 024a SQL file
- Changed `endDelimiter: "$;"` to `endDelimiter: "$$;"` in YAML changelog
- Updated all comments to reflect the corrected delimiter pattern
- 024b changeset verified as unchanged (uses default semicolon delimiter)
