# Task Breakdown: Liquibase Migrations - Add Internal Classification and Sequence Message Collection

## Overview
Total Tasks: 15
Total Task Groups: 3

This spec adds four Liquibase database migrations (036-039) to introduce `is_internal` and `tech_type` classification columns to entity tables, and `is_collection` to sequence messages.

## Task List

### Database Migration Layer

#### Task Group 1: SQL Migration Files
**Dependencies:** None

- [x] 1.0 Complete SQL migration files
  - [x] 1.1 Create migration 036: Add is_internal to applications table
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/036-add-internal-classification-applications.sql`
    - Single ALTER TABLE statement adding `is_internal BOOLEAN NOT NULL DEFAULT TRUE`
    - Use `ADD COLUMN IF NOT EXISTS` syntax for PostgreSQL idempotency
    - Include header comment block with migration number, description, and spec reference
    - Follow pattern from existing migration 014-service-core-tech.sql
  - [x] 1.2 Create migration 037: Add is_internal and tech_type to application_components table
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/037-add-internal-classification-application-components.sql`
    - Two columns in single ALTER TABLE: `is_internal BOOLEAN NOT NULL DEFAULT TRUE` and `tech_type TEXT NOT NULL DEFAULT 'Other'`
    - Use `ADD COLUMN IF NOT EXISTS` for each column
    - Include header comment block with spec reference
    - Follow multi-column pattern from existing migration 035
  - [x] 1.3 Create migration 038: Add is_internal to services table
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/038-add-internal-classification-services.sql`
    - Single ALTER TABLE statement adding `is_internal BOOLEAN NOT NULL DEFAULT TRUE`
    - Pattern mirrors migration 036
    - Include header comment block with spec reference
  - [x] 1.4 Create migration 039: Add is_collection to sequence_messages table
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/039-add-sequence-messages-is-collection.sql`
    - Single ALTER TABLE statement adding `is_collection BOOLEAN NOT NULL DEFAULT FALSE`
    - Note: Default is FALSE (most messages are not collections)
    - Include header comment block with spec reference

**Acceptance Criteria:**
- All four SQL files exist in `db/changelog/sql/` directory
- Each file has proper header comment block referencing the spec
- All use `ADD COLUMN IF NOT EXISTS` for idempotency
- Column names use snake_case: `is_internal`, `tech_type`, `is_collection`
- Boolean columns use `BOOLEAN NOT NULL` with appropriate defaults
- Text columns use `TEXT NOT NULL` (not VARCHAR)

**Implementation Notes:**
```
SQL file format conventions:
- Include header comment block with migration number, description, and spec reference
- Use `ADD COLUMN IF NOT EXISTS` syntax for PostgreSQL idempotency
- No trailing semicolons after final statement (consistent with existing files)
```

---

#### Task Group 2: Changelog Master Configuration
**Dependencies:** Task Group 1

- [x] 2.0 Complete db.changelog-master.yaml updates
  - [x] 2.1 Add changeSet entry for migration 036 (applications.is_internal)
    - id: `036-add-internal-classification-applications`
    - author: `architecture-tool` (matches existing convention)
    - preConditions: `not: columnExists:` check for `applications.is_internal`
    - Use `onFail: MARK_RAN` and `onError: HALT` pattern
    - sqlFile path: `db/changelog/sql/036-add-internal-classification-applications.sql`
    - Include `relativeToChangelogFile: false`, `splitStatements: true`, `stripComments: true`
  - [x] 2.2 Add changeSet entry for migration 037 (application_components.is_internal, tech_type)
    - id: `037-add-internal-classification-application-components`
    - author: `architecture-tool`
    - preConditions: `not: columnExists:` check for `application_components.is_internal`
    - Follow same YAML structure as 2.1
  - [x] 2.3 Add changeSet entry for migration 038 (services.is_internal)
    - id: `038-add-internal-classification-services`
    - author: `architecture-tool`
    - preConditions: `not: columnExists:` check for `services.is_internal`
    - Follow same YAML structure as 2.1
  - [x] 2.4 Add changeSet entry for migration 039 (sequence_messages.is_collection)
    - id: `039-add-sequence-messages-is-collection`
    - author: `architecture-tool`
    - preConditions: `not: columnExists:` check for `sequence_messages.is_collection`
    - Follow same YAML structure as 2.1
  - [x] 2.5 Verify YAML syntax and indentation
    - Ensure consistent 2-space indentation throughout
    - Add comment block above each changeSet referencing the spec
    - Position all four entries after line 648 (after migration 035)

**Acceptance Criteria:**
- Four new changeSet entries added to db.changelog-master.yaml
- Each changeSet has proper id, author (`architecture-tool`), preConditions, and sqlFile reference
- YAML indentation matches existing file structure (2-space)
- All preConditions use `onFail: MARK_RAN` and `onError: HALT`
- Comment blocks reference the spec name

**Reference Structure:**
```yaml
  # Internal Classification for Applications
  # Spec: Liquibase Migrations - Add Internal Classification and Sequence Message Collection
  - changeSet:
      id: 036-add-internal-classification-applications
      author: architecture-tool
      preConditions:
        - onFail: MARK_RAN
        - onError: HALT
        - not:
            columnExists:
              tableName: applications
              columnName: is_internal
      changes:
        - sqlFile:
            path: db/changelog/sql/036-add-internal-classification-applications.sql
            relativeToChangelogFile: false
            splitStatements: true
            stripComments: true
```

---

### Verification Layer

#### Task Group 3: Migration Verification
**Dependencies:** Task Groups 1 and 2

- [ ] 3.0 Complete migration verification
  - [ ] 3.1 Start architecture-model-service and verify Hibernate schema validation passes
    - Application should start without schema validation errors
    - Check logs for successful Liquibase migration execution
    - Confirm `ddl-auto=validate` does not throw exceptions
  - [ ] 3.2 Verify columns exist with correct types using SQL query
    - Run verification query against database:
    ```sql
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name IN ('applications', 'application_components', 'services', 'sequence_messages')
      AND column_name IN ('is_internal', 'tech_type', 'is_collection')
    ORDER BY table_name, column_name;
    ```
    - Expected results:
      - `applications.is_internal`: BOOLEAN, NOT NULL, DEFAULT TRUE
      - `application_components.is_internal`: BOOLEAN, NOT NULL, DEFAULT TRUE
      - `application_components.tech_type`: TEXT, NOT NULL, DEFAULT 'Other'
      - `services.is_internal`: BOOLEAN, NOT NULL, DEFAULT TRUE
      - `sequence_messages.is_collection`: BOOLEAN, NOT NULL, DEFAULT FALSE
  - [ ] 3.3 Verify Liquibase changelog entries
    - Run verification query:
    ```sql
    SELECT id, author, dateexecuted, exectype
    FROM databasechangelog
    WHERE id LIKE '036%' OR id LIKE '037%' OR id LIKE '038%' OR id LIKE '039%'
    ORDER BY orderexecuted;
    ```
    - Confirm all four migrations show as EXECUTED
  - [ ] 3.4 Verify existing data preserved with default values
    - Query existing rows in each affected table
    - Confirm `is_internal` columns have TRUE for existing applications, components, services
    - Confirm `is_collection` has FALSE for existing sequence messages
  - [ ] 3.5 Test idempotent execution
    - Restart application or manually trigger Liquibase update
    - Verify migrations show MARK_RAN status on second run (not re-executed)
    - Confirm no errors from attempted duplicate column additions

**Acceptance Criteria:**
- Application starts successfully with `ddl-auto=validate`
- All five new columns exist with correct types and constraints
- DATABASECHANGELOG contains entries for changeSet IDs 036, 037, 038, and 039
- Existing rows have appropriate default values applied
- Re-running migrations results in MARK_RAN status (idempotent)

**Note:** Task Group 3 (Migration Verification) requires a running database and cannot be verified programmatically. These tasks should be manually verified when the architecture-model-service is started against a PostgreSQL database.

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: SQL Migration Files** - Create all four SQL files first
   - No dependencies
   - Can reference spec appendix for exact SQL content

2. **Task Group 2: Changelog Master Configuration** - Update YAML after SQL files exist
   - Depends on Task Group 1 (file paths must exist)
   - Add all four changeSets in order (036-039)

3. **Task Group 3: Migration Verification** - Validate after both previous groups complete
   - Depends on Task Groups 1 and 2
   - Requires running application against database

---

## File Paths Summary

| File | Purpose |
|------|---------|
| `architecture-model-service/src/main/resources/db/changelog/sql/036-add-internal-classification-applications.sql` | Migration 036 SQL |
| `architecture-model-service/src/main/resources/db/changelog/sql/037-add-internal-classification-application-components.sql` | Migration 037 SQL |
| `architecture-model-service/src/main/resources/db/changelog/sql/038-add-internal-classification-services.sql` | Migration 038 SQL |
| `architecture-model-service/src/main/resources/db/changelog/sql/039-add-sequence-messages-is-collection.sql` | Migration 039 SQL |
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | Master changelog (update) |

---

## Important Notes for Implementers

1. **Author Convention**: Use `architecture-tool` for all changeSets to match existing repo convention
2. **One ChangeSet Per Table**: Each migration targets a single table with its own precondition
3. **Spec Appendix Contains Exact SQL**: The spec.md appendix has copy-ready SQL and YAML blocks
4. **No Java Changes Required**: This spec is DB-only; Entity class updates are in a separate spec
5. **Idempotency**: Both SQL (`IF NOT EXISTS`) and Liquibase preconditions ensure safe re-runs
