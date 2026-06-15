# Specification: Fix Packages Audit Columns

## Goal
Resolve the Spring Boot startup failure caused by Hibernate schema validation error for missing `created_at` and `updated_at` columns in the `packages` table by adding a Liquibase migration to align the database schema with the JPA entity.

## User Stories
- As a developer, I want the application to start without schema validation errors so that I can continue development and testing.
- As an operator, I want existing package data to have valid audit timestamps so that data integrity is maintained after the migration.

## Specific Requirements

**Liquibase Migration for Packages Table**
- Create new SQL migration file `019-fix-packages-audit-columns.sql` in `db/changelog/sql/`
- Add `created_at` column as TIMESTAMPTZ with DEFAULT now()
- Add `updated_at` column as TIMESTAMPTZ with DEFAULT now()
- Backfill any existing rows with current timestamp using COALESCE
- Set NOT NULL constraint after backfill to avoid failures on existing data
- Use PostgreSQL `IF NOT EXISTS` pattern for idempotent column addition

**Changelog Master YAML Update**
- Add changeset entry with id `019-fix-packages-audit-columns` to `db.changelog-master.yaml`
- Use precondition to check if `created_at` column already exists on `packages` table
- Follow existing pattern: onFail MARK_RAN, onError HALT

**PackageEntity Verification**
- Verify `@Column(name = "created_at")` mapping exists (already present at line 59)
- Verify `@Column(name = "updated_at")` mapping exists (already present at line 62)
- Note: Entity uses nullable=default (true) which is acceptable since DB enforces NOT NULL
- Entity does NOT use @PrePersist/@PreUpdate - relies on DB defaults (consistent with PackageSetEntity pattern)

**Application Startup Verification**
- Hibernate schema validation must pass without SchemaManagementException
- Application must start successfully with `spring.jpa.hibernate.ddl-auto=validate`

## Existing Code to Leverage

**017-package-sets.sql - Original packages table creation**
- Created `packages` table without audit columns (lines 23-31)
- PackageSetEntity uses same pattern: audit columns exist in entity but DB defaults handle values
- Follow same TIMESTAMPTZ type as used in `model_files` table from schema.sql

**018-package-set-standards-import.sql - Column addition pattern**
- Uses `ALTER TABLE ... ADD COLUMN` pattern (lines 29-30)
- Does not use `IF NOT EXISTS` - the 019 migration should use it for safety

**ModelFileEntity.java - Reference audit column implementation**
- Uses `@Column(name = "created_at", nullable = false)` (line 27)
- Uses `@Column(name = "updated_at", nullable = false)` (line 30)
- Uses @PrePersist/@PreUpdate hooks (lines 39-55) - PackageEntity does NOT use this pattern
- DB schema for model_files uses `TIMESTAMPTZ NOT NULL DEFAULT NOW()` (schema.sql lines 13-14)

**db.changelog-master.yaml - Changeset pattern**
- Uses columnExists precondition for migrations adding columns (e.g., changeset 007, 009, 014, 016)
- Standard author is `architecture-tool`

## Out of Scope
- Adding @PrePersist/@PreUpdate hooks to PackageEntity (rely on DB defaults instead)
- Modifying PackageSetEntity (already has audit columns in DB)
- Changing nullable setting on PackageEntity @Column annotations
- Adding indexes on audit columns
- Frontend changes
- API changes
- Disabling Hibernate schema validation
- Removing audit fields from entities
- Adding audit columns to other tables
- Creating integration tests for this migration
