# Specification: Fix Liquibase 024a DO Block Syntax

## Goal
Fix architecture-model-service startup failure caused by invalid Postgres DO block syntax (`DO $ ... END $;`) in changeset 024a by correcting to valid dollar-quoting (`DO $$ ... END $$;`) and aligning the Liquibase endDelimiter.

## User Stories
- As a developer, I want the service to start successfully so that Liquibase migrations execute without syntax errors
- As a DBA, I want precondition checks to fail only on data issues, not SQL parsing bugs, so that I can diagnose migration problems accurately

## Specific Requirements

**Fix SQL dollar-quoting in 024a precondition file**
- Locate file: `architecture-model-service/src/main/resources/db/changelog/sql/024a-remove-legacy-data-entity-columns-preconditions.sql`
- Replace all `DO $` occurrences with `DO $$`
- Replace all `END $;` occurrences with `END $$;`
- File currently has 3 DO blocks (lines 26, 42, 58) that all need correction
- Each block must follow pattern: `DO $$ DECLARE ... BEGIN ... END $$;`
- PostgreSQL requires matching dollar-quote tags; single `$` is invalid syntax
- Do NOT use alternative forms like `DO $$;` or `DO $do$`

**Update Liquibase YAML endDelimiter for 024a changeset**
- Locate: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
- Find changeSet id: `024a-remove-legacy-data-entity-columns-preconditions` (around line 391)
- Change `endDelimiter: "$;"` to `endDelimiter: "$$;"`
- Preserve existing settings: `splitStatements: true`, `stripComments: false`
- The endDelimiter must match the DO block terminator to prevent splitting on internal semicolons

**Verify 024b changeset remains unchanged**
- ChangeSet id: `024b-remove-legacy-data-entity-columns-apply` (around line 413)
- Confirm endDelimiter remains `;` (or absent, which defaults to `;`)
- 024b contains standard ALTER TABLE statements, not DO blocks
- Do NOT add `endDelimiter: "$$;"` to 024b

**Update misleading comments in 024a SQL file**
- Line 17-18 currently states: "uses $; as the statement delimiter"
- Replace with: "Uses DO $$ ... END $$; and Liquibase endDelimiter $$; to avoid splitting DO blocks"
- This prevents regression and documents the correct pattern

**Update misleading comments in YAML changelog**
- Line 389 currently states: `Uses endDelimiter: "$;"`
- Update to reflect the corrected `$$;` delimiter
- Keep comment concise and accurate

## Existing Code to Leverage

**024a-remove-legacy-data-entity-columns-preconditions.sql (lines 26-69)**
- Contains 3 DO blocks performing NULL count checks on point-id columns
- Each block raises an exception if NULL values found
- Logic is correct; only dollar-quoting syntax needs correction
- Preserve all DECLARE, SELECT, IF, and RAISE EXCEPTION statements

**024b-remove-legacy-data-entity-columns-apply.sql**
- Contains standard ALTER TABLE statements (NOT NULL constraints, DROP COLUMN)
- Uses normal semicolon delimiters
- No changes required to this file

**db.changelog-master.yaml changeset pattern (lines 391-406)**
- Current 024a changeset structure is correct except for endDelimiter value
- Already has `splitStatements: true` and `stripComments: false`
- Only the endDelimiter value needs to change from `"$;"` to `"$$;"`

## Out of Scope
- Java code changes
- Changes to the precondition check logic (same NULL count checks and exception messages)
- Changes to 024b schema modifications (same NOT NULL and DROP COLUMN statements)
- Changes to any migration files other than 024a SQL and the YAML changelog entries for 024a
- Adding new precondition checks
- Frontend changes
- Adding new migrations
- Changing the order of migrations
- Modifying database tables or columns
- Changes to other Liquibase changesets
