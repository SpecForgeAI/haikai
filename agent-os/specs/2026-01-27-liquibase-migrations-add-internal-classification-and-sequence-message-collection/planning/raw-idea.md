# Raw Idea

## Spec Metadata
- Name: liquibase-migrations-add-internal-classification-and-sequence-message-collection
- Scope: architecture-model-service
- Type: database-migration
- Date: 2026-01-27

## Description

```
intent:
  Update the persisted database schema (Liquibase-managed) to match the meta-model and sequence
  diagram enhancements introduced in this thread, so that Hibernate schema validation passes and
  new UI features can persist/read required attributes.

assumptions:
  - Liquibase is the schema management mechanism for architecture-model-service.
  - Hibernate is configured to validate schema at startup (ddl-auto=validate), so missing columns
    must be added via migrations.

required_db_changes:
  tables_and_columns:
    applications:
      - add column is_internal BOOLEAN NOT NULL DEFAULT TRUE
    application_components:
      - add column is_internal BOOLEAN NOT NULL DEFAULT TRUE
      - add column tech_type TEXT NOT NULL DEFAULT 'Other'
    services:
      - add column is_internal BOOLEAN NOT NULL DEFAULT TRUE
    sequence_messages:
      - add column is_collection BOOLEAN NOT NULL DEFAULT FALSE

liquibase_changes:
  add_new_migration_files:
    - file: db/changelog/sql/036-add-internal-classification-fields.sql
      statements:
        - ALTER TABLE applications ADD COLUMN is_internal BOOLEAN NOT NULL DEFAULT TRUE;
        - ALTER TABLE application_components ADD COLUMN is_internal BOOLEAN NOT NULL DEFAULT TRUE;
        - ALTER TABLE application_components ADD COLUMN tech_type TEXT NOT NULL DEFAULT 'Other';
        - ALTER TABLE services ADD COLUMN is_internal BOOLEAN NOT NULL DEFAULT TRUE;

    - file: db/changelog/sql/037-add-sequence-messages-is-collection.sql
      statements:
        - ALTER TABLE sequence_messages ADD COLUMN is_collection BOOLEAN NOT NULL DEFAULT FALSE;

  update_master_changelog:
    file: db/changelog/db.changelog-master.yaml
    add_changesets_in_order:
      - id: 036-add-internal-classification-fields
        author: agent-os
        preconditions:
          onFail: MARK_RAN
          conditions:
            - not:
                columnExists:
                  tableName: applications
                  columnName: is_internal
        changes:
          - sqlFile:
              path: db/changelog/sql/036-add-internal-classification-fields.sql
              relativeToChangelogFile: false

      - id: 037-add-sequence-messages-is-collection
        author: agent-os
        preconditions:
          onFail: MARK_RAN
          conditions:
            - not:
                columnExists:
                  tableName: sequence_messages
                  columnName: is_collection
        changes:
          - sqlFile:
              path: db/changelog/sql/037-add-sequence-messages-is-collection.sql
              relativeToChangelogFile: false

compatibility_requirements:
  - Use snake_case column names exactly: is_internal, tech_type, is_collection
  - Ensure defaults are set so existing rows are immediately valid
  - Migrations must be safe to apply on existing databases (idempotent via preconditions)

non_goals:
  - No DB enum types introduced for tech_type in this increment (store as TEXT).
  - No data backfill beyond defaults is required.

acceptance_criteria:
  - architecture-model-service starts successfully with ddl-auto=validate after migrations applied.
  - Tables contain the new columns with correct NOT NULL + DEFAULT constraints.
  - Liquibase reports the new changeSets as executed in DATABASECHANGELOG.
```
