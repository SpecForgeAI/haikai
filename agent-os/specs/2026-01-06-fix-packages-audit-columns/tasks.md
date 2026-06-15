# Task Breakdown: Fix Packages Audit Columns

## Overview
Total Tasks: 7

This is a small backend-only fix to resolve a Spring Boot startup failure caused by missing `created_at` and `updated_at` columns in the `packages` table. The fix involves creating a Liquibase migration and verifying the application starts successfully.

## Task List

### Database Layer

#### Task Group 1: Liquibase Migration
**Dependencies:** None

- [x] 1.0 Complete Liquibase migration for packages audit columns
  - [x] 1.1 Create SQL migration file `019-fix-packages-audit-columns.sql`
    - Location: `architecture-model-service/src/main/resources/db/changelog/sql/019-fix-packages-audit-columns.sql`
    - Add `created_at` column using `ALTER TABLE packages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`
    - Add `updated_at` column using `ALTER TABLE packages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`
    - Backfill existing rows: `UPDATE packages SET created_at = COALESCE(created_at, now())`
    - Backfill existing rows: `UPDATE packages SET updated_at = COALESCE(updated_at, now())`
    - Set defaults: `ALTER TABLE packages ALTER COLUMN created_at SET DEFAULT now()`
    - Set defaults: `ALTER TABLE packages ALTER COLUMN updated_at SET DEFAULT now()`
    - Enforce NOT NULL: `ALTER TABLE packages ALTER COLUMN created_at SET NOT NULL`
    - Enforce NOT NULL: `ALTER TABLE packages ALTER COLUMN updated_at SET NOT NULL`
  - [x] 1.2 Register migration in `db.changelog-master.yaml`
    - Add changeset with id `019-fix-packages-audit-columns`
    - Use precondition: columnExists check on `created_at` column in `packages` table
    - Set onFail: MARK_RAN, onError: HALT
    - Author: `architecture-tool`
    - Reference existing pattern from changesets 007, 009, 014, 016
  - [x] 1.3 Verify PackageEntity has correct @Column mappings
    - Confirm `@Column(name = "created_at")` mapping exists (already present at line 59)
    - Confirm `@Column(name = "updated_at")` mapping exists (already present at line 62)
    - Note: Entity relies on DB defaults, not @PrePersist/@PreUpdate (consistent with PackageSetEntity)

**Acceptance Criteria:**
- SQL migration file created with idempotent column addition using IF NOT EXISTS
- Backfill logic uses COALESCE to handle existing rows
- Defaults and NOT NULL constraints applied after backfill
- Changeset registered in changelog master with appropriate preconditions
- PackageEntity column mappings verified as present

### Verification Layer

#### Task Group 2: Application Startup Verification
**Dependencies:** Task Group 1

- [x] 2.0 Verify application starts without schema validation errors
  - [x] 2.1 Start the application with `spring.jpa.hibernate.ddl-auto=validate`
    - Run `mvn spring-boot:run` or start via IDE
    - Verify no SchemaManagementException is thrown
    - Verify no "missing column [created_at] in table [packages]" error
  - [x] 2.2 Verify Liquibase migration executes successfully
    - Check application logs for successful changeset execution
    - Verify changeset `019-fix-packages-audit-columns` is marked as executed
  - [x] 2.3 Verify database schema alignment
    - Query packages table to confirm created_at and updated_at columns exist
    - Verify columns have correct type (TIMESTAMPTZ), defaults, and NOT NULL constraints
    - If existing rows present, verify they have non-null timestamp values

**Acceptance Criteria:**
- Application starts without SchemaManagementException
- Hibernate schema validation passes for `packages` table
- Liquibase changeset executes successfully (or is marked as ran if columns already exist)
- Existing rows (if any) have non-null created_at and updated_at values

## Execution Order

Recommended implementation sequence:
1. Database Layer - Liquibase Migration (Task Group 1)
2. Verification Layer - Application Startup Verification (Task Group 2)

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `architecture-model-service/src/main/resources/db/changelog/sql/019-fix-packages-audit-columns.sql` | Create | New SQL migration file |
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | Modify | Add changeset entry |

## Reference Files

| File | Purpose |
|------|---------|
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/PackageEntity.java` | Verify @Column mappings (lines 59, 62) |
| `architecture-model-service/src/main/resources/db/changelog/sql/017-package-sets.sql` | Original packages table creation |
| `architecture-model-service/src/main/resources/db/changelog/sql/018-package-set-standards-import.sql` | Reference for ALTER TABLE pattern |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ModelFileEntity.java` | Reference audit column implementation |
