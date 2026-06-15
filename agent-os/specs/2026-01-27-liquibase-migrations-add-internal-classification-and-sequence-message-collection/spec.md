# Specification: Liquibase Migrations - Add Internal Classification and Sequence Message Collection

## Goal
Add four Liquibase database migrations (036-039) to introduce `is_internal` and `tech_type` classification columns to entity tables, and `is_collection` to sequence messages, enabling Hibernate schema validation to pass for the corresponding entity class fields.

## User Stories
- As a system administrator, I want the database schema to match the JPA entity definitions so that the application starts without schema validation errors
- As an architect, I want internal/external classification persisted for applications, components, and services so that this context is available across sessions

## Specific Requirements

**Migration 036: Add is_internal to applications table**
- File: `architecture-model-service/src/main/resources/db/changelog/sql/036-add-internal-classification-applications.sql`
- Single ALTER TABLE statement adding `is_internal BOOLEAN NOT NULL DEFAULT TRUE`
- Precondition checks that `is_internal` column does not already exist on `applications` table
- Author must be `architecture-tool` to match existing convention
- Use `IF NOT EXISTS` clause for idempotency within the SQL

**Migration 037: Add is_internal and tech_type to application_components table**
- File: `architecture-model-service/src/main/resources/db/changelog/sql/037-add-internal-classification-application-components.sql`
- Two columns added in single ALTER TABLE: `is_internal BOOLEAN NOT NULL DEFAULT TRUE` and `tech_type TEXT NOT NULL DEFAULT 'Other'`
- Precondition checks that `is_internal` column does not already exist on `application_components` table
- `tech_type` stored as TEXT (no DB enum type in this increment)

**Migration 038: Add is_internal to services table**
- File: `architecture-model-service/src/main/resources/db/changelog/sql/038-add-internal-classification-services.sql`
- Single ALTER TABLE statement adding `is_internal BOOLEAN NOT NULL DEFAULT TRUE`
- Precondition checks that `is_internal` column does not already exist on `services` table
- Follows same pattern as migration 036

**Migration 039: Add is_collection to sequence_messages table**
- File: `architecture-model-service/src/main/resources/db/changelog/sql/039-add-sequence-messages-is-collection.sql`
- Single ALTER TABLE statement adding `is_collection BOOLEAN NOT NULL DEFAULT FALSE`
- Precondition checks that `is_collection` column does not already exist on `sequence_messages` table
- Default is FALSE (most messages are not collections)

**db.changelog-master.yaml updates**
- Add four new changeSet entries after the existing `035-work-item-implement-context-relationships` entry
- Each changeSet must include: id, author (`architecture-tool`), preConditions block, and sqlFile reference
- preConditions must use `onFail: MARK_RAN` and `onError: HALT` pattern
- sqlFile paths use `relativeToChangelogFile: false` with `db/changelog/sql/` prefix

**Column naming conventions**
- All column names must use snake_case: `is_internal`, `tech_type`, `is_collection`
- Boolean columns use `BOOLEAN` type with explicit `NOT NULL` constraint
- Text columns use `TEXT` type (not VARCHAR)

**SQL file format conventions**
- Include header comment block with migration number, description, and spec reference
- Use `ADD COLUMN IF NOT EXISTS` syntax for PostgreSQL idempotency
- No trailing semicolons after final statement (consistent with existing files)

## Existing Code to Leverage

**db.changelog-master.yaml structure (lines 634-648)**
- Follow exact YAML indentation and structure from existing changeSet entries
- Use the `not: columnExists:` precondition pattern for column additions
- Include `splitStatements: true` and `stripComments: true` in sqlFile block

**Migration 035-work-item-implement-context-relationships.sql**
- Example of multi-column ALTER TABLE with IF NOT EXISTS clause
- Shows JSONB column pattern (though not needed here)
- Demonstrates comment block format for spec reference

**Migration 014-service-core-tech.sql**
- Simple single-column TEXT addition pattern
- Shows header comment block format with spec reference
- Minimal SQL for straightforward column addition

**Migration 027-project-hierarchy.sql**
- Shows VARCHAR column addition with inline comment
- Demonstrates optional index creation (not needed for boolean columns)

## Out of Scope
- No Java Entity class updates (SequenceMessageEntity.isCollection field addition is separate spec)
- No DTO class modifications
- No JPA repository or service layer changes
- No frontend/UI changes
- No DB enum types for tech_type (stored as TEXT)
- No data backfill beyond default values
- No index creation for new columns
- No foreign key constraints on new columns
- No validation constraints beyond NOT NULL
- No rollback scripts (Liquibase handles via changeSet tracking)

---

## Appendix: Implementation Details

### Migration 036: 036-add-internal-classification-applications.sql

```sql
-- ============================================================================
-- Migration 036: Add is_internal column to applications table
-- Spec: Liquibase Migrations - Add Internal Classification and Sequence Message Collection
--
-- Adds is_internal BOOLEAN column to classify applications as internal or external.
-- Default TRUE means existing applications are treated as internal.
-- ============================================================================

ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT TRUE;
```

### Migration 037: 037-add-internal-classification-application-components.sql

```sql
-- ============================================================================
-- Migration 037: Add is_internal and tech_type columns to application_components table
-- Spec: Liquibase Migrations - Add Internal Classification and Sequence Message Collection
--
-- Adds is_internal BOOLEAN column for internal/external classification.
-- Adds tech_type TEXT column for technology type categorization.
-- ============================================================================

ALTER TABLE application_components
    ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS tech_type TEXT NOT NULL DEFAULT 'Other';
```

### Migration 038: 038-add-internal-classification-services.sql

```sql
-- ============================================================================
-- Migration 038: Add is_internal column to services table
-- Spec: Liquibase Migrations - Add Internal Classification and Sequence Message Collection
--
-- Adds is_internal BOOLEAN column to classify services as internal or external.
-- Default TRUE means existing services are treated as internal.
-- ============================================================================

ALTER TABLE services ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT TRUE;
```

### Migration 039: 039-add-sequence-messages-is-collection.sql

```sql
-- ============================================================================
-- Migration 039: Add is_collection column to sequence_messages table
-- Spec: Liquibase Migrations - Add Internal Classification and Sequence Message Collection
--
-- Adds is_collection BOOLEAN column to indicate if a message represents
-- a collection/loop of multiple items. Default FALSE for normal messages.
-- ============================================================================

ALTER TABLE sequence_messages ADD COLUMN IF NOT EXISTS is_collection BOOLEAN NOT NULL DEFAULT FALSE;
```

### db.changelog-master.yaml additions

Add the following YAML after line 648 (after the `035-work-item-implement-context-relationships` changeSet):

```yaml
  # Internal Classification for Applications
  # Spec: Liquibase Migrations - Add Internal Classification and Sequence Message Collection
  # Adds is_internal column to applications table for internal/external classification.
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

  # Internal Classification and Tech Type for Application Components
  # Spec: Liquibase Migrations - Add Internal Classification and Sequence Message Collection
  # Adds is_internal and tech_type columns to application_components table.
  - changeSet:
      id: 037-add-internal-classification-application-components
      author: architecture-tool
      preConditions:
        - onFail: MARK_RAN
        - onError: HALT
        - not:
            columnExists:
              tableName: application_components
              columnName: is_internal
      changes:
        - sqlFile:
            path: db/changelog/sql/037-add-internal-classification-application-components.sql
            relativeToChangelogFile: false
            splitStatements: true
            stripComments: true

  # Internal Classification for Services
  # Spec: Liquibase Migrations - Add Internal Classification and Sequence Message Collection
  # Adds is_internal column to services table for internal/external classification.
  - changeSet:
      id: 038-add-internal-classification-services
      author: architecture-tool
      preConditions:
        - onFail: MARK_RAN
        - onError: HALT
        - not:
            columnExists:
              tableName: services
              columnName: is_internal
      changes:
        - sqlFile:
            path: db/changelog/sql/038-add-internal-classification-services.sql
            relativeToChangelogFile: false
            splitStatements: true
            stripComments: true

  # Is Collection for Sequence Messages
  # Spec: Liquibase Migrations - Add Internal Classification and Sequence Message Collection
  # Adds is_collection column to sequence_messages table for loop/collection indicators.
  - changeSet:
      id: 039-add-sequence-messages-is-collection
      author: architecture-tool
      preConditions:
        - onFail: MARK_RAN
        - onError: HALT
        - not:
            columnExists:
              tableName: sequence_messages
              columnName: is_collection
      changes:
        - sqlFile:
            path: db/changelog/sql/039-add-sequence-messages-is-collection.sql
            relativeToChangelogFile: false
            splitStatements: true
            stripComments: true
```

---

## Acceptance Criteria

1. **Application starts successfully**: `architecture-model-service` starts with `ddl-auto=validate` without Hibernate schema validation errors
2. **Columns exist with correct constraints**:
   - `applications.is_internal` is BOOLEAN, NOT NULL, DEFAULT TRUE
   - `application_components.is_internal` is BOOLEAN, NOT NULL, DEFAULT TRUE
   - `application_components.tech_type` is TEXT, NOT NULL, DEFAULT 'Other'
   - `services.is_internal` is BOOLEAN, NOT NULL, DEFAULT TRUE
   - `sequence_messages.is_collection` is BOOLEAN, NOT NULL, DEFAULT FALSE
3. **Liquibase changelog updated**: DATABASECHANGELOG table contains entries for changeSet IDs 036, 037, 038, and 039
4. **Existing data preserved**: All existing rows in affected tables receive default values and remain accessible
5. **Idempotent execution**: Running migrations on a database where columns already exist results in MARK_RAN status (no errors)

### Verification Commands

```sql
-- Verify columns exist with correct types
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name IN ('applications', 'application_components', 'services', 'sequence_messages')
  AND column_name IN ('is_internal', 'tech_type', 'is_collection')
ORDER BY table_name, column_name;

-- Verify Liquibase changelog entries
SELECT id, author, dateexecuted, exectype
FROM databasechangelog
WHERE id LIKE '036%' OR id LIKE '037%' OR id LIKE '038%' OR id LIKE '039%'
ORDER BY orderexecuted;
```

## Non-Goals

- **No Java entity class updates**: JPA entity changes (including adding `isCollection` to `SequenceMessageEntity`) are handled in a separate specification
- **No DTO modifications**: DTO classes already have the fields; no changes needed
- **No mapper updates**: EntityMapper changes are separate from DB migrations
- **No API changes**: Controller and service layer changes are out of scope
- **No frontend changes**: UI updates for internal/external classification are separate
- **No enum types**: `tech_type` remains as TEXT; enum migration may be considered in future
- **No data transformation**: Only default values applied; no backfill logic
- **No performance optimization**: No indexes added for boolean columns
