# Specification: Fix Liquibase Changeset 024 Postgres DO Block Parsing

## Goal
Fix application startup failure caused by Liquibase incorrectly splitting Postgres DO $$ blocks at internal semicolons, by splitting changeset 024 into two SQL files with appropriate endDelimiter settings.

## User Stories
- As a developer, I want the architecture-model-service to start successfully so that I can use the application without manual database intervention.
- As an operator, I want database migrations to execute reliably so that deployments complete without Liquibase parsing errors.

## Specific Requirements

**Split SQL file into preconditions and apply files**
- Create `024a-remove-legacy-data-entity-columns-preconditions.sql` containing only the three DO $$ ... $$; blocks
- Create `024b-remove-legacy-data-entity-columns-apply.sql` containing all ALTER/DROP statements
- Delete original `024-remove-legacy-data-entity-columns.sql` to avoid confusion
- Preconditions file must contain exactly three DO blocks that check for NULL values in point-id columns
- Apply file must contain: ALTER COLUMN SET NOT NULL (3x), DROP CONSTRAINT (4x), DROP COLUMN (5x)

**Configure endDelimiter for DO blocks**
- Use `endDelimiter: "$;"` for the preconditions file to prevent splitting on internal semicolons
- Each DO block must end with `$$;` (dollar-quote followed by semicolon) to match the endDelimiter
- Liquibase will treat each complete DO $$ ... $$; as a single statement

**Configure standard delimiter for ALTER/DROP statements**
- Use `endDelimiter: ";"` for the apply file (standard semicolon delimiter)
- All ALTER and DROP statements terminate with standard semicolons
- splitStatements: true enables normal statement-by-statement execution

**Update db.changelog-master.yaml changeset 024**
- Replace single sqlFile change with two sequential sqlFile changes
- First sqlFile: preconditions with `endDelimiter: "$;"`, `splitStatements: true`, `stripComments: true`
- Second sqlFile: apply with `endDelimiter: ";"`, `splitStatements: true`, `stripComments: true`
- Keep existing changeset id `024-remove-legacy-data-entity-columns` unchanged
- Preserve existing preConditions block (onFail: HALT, columnExists check)

**Preserve precondition failure behavior**
- DO blocks must raise exceptions with identical error messages when NULL values exist
- Exception format: `Migration precondition failed: % row(s) in [table] have NULL [column]. Run backfill migration first.`
- Precondition failures must halt the migration before any ALTER/DROP executes

**Add integration test for migration success**
- Follow existing pattern: `@SpringBootTest`, `@ActiveProfiles("test")`, `@Transactional`
- Test verifies Spring context loads successfully (implies Liquibase completes)
- Test can be a simple context startup test or added assertion to existing integration test class

## Existing Code to Leverage

**db.changelog-master.yaml changeset structure**
- Lines 391-405 show existing changeset 024 configuration
- Pattern: id, author, preConditions block, changes with sqlFile
- All existing changesets use `splitStatements: true` and `stripComments: true`
- `relativeToChangelogFile: false` is standard across all changesets

**024-remove-legacy-data-entity-columns.sql content**
- Lines 25-68 contain the three DO $$ blocks to extract for preconditions file
- Lines 75-137 contain all ALTER/DROP statements to extract for apply file
- Header comments (lines 1-20) should be preserved in appropriate split files

**DataEntityPointIntegrationTest.java integration test pattern**
- Uses `@SpringBootTest` annotation for full context loading with Liquibase
- Uses `@ActiveProfiles("test")` for test database configuration
- Lines 40-43 show standard test class annotations
- Context loading implicitly validates all Liquibase migrations succeed

**Existing SQL migration file naming convention**
- Pattern: `NNN-descriptive-name.sql` in `db/changelog/sql/` directory
- Split files should use suffix pattern: `024a-...` and `024b-...` for ordering clarity

## Out of Scope
- Modifying any SQL statement logic or schema changes within the migration
- Adding new database columns, constraints, or tables
- Changing the precondition check queries or exception messages
- Modifying any other changesets (001-023)
- Creating rollback scripts or procedures
- Adding Liquibase contexts or labels
- Changing test database configuration or profiles
- Frontend changes of any kind
- API endpoint changes
- Performance optimization of the migration
