# Fix Startup Schema Validation Error - Missing Audit Columns in Packages Table

## Title
Fix startup schema validation error by adding missing created_at/updated_at columns to packages table

## Intent
Resolve the Spring Boot startup failure caused by Hibernate schema validation:
```
Schema-validation: missing column [created_at] in table [packages]
```
This indicates the JPA entity for packages expects audit timestamp columns that are not present in the DB schema.

## Scope
- Backend (architecture-model-service) only
- Liquibase migration to align DB schema with JPA entities
- Small verification of entity/table alignment
- No frontend changes

## Non-Goals
- Disabling schema validation
- Removing audit fields from entities
- Changing existing behavior of auditing fields beyond making schema consistent

---

## Requirements

### 1) Database Schema Alignment
- Ensure the table `packages` contains the columns expected by the JPA entity:
  - `created_at` (TIMESTAMPTZ NOT NULL)
  - `updated_at` (TIMESTAMPTZ NOT NULL)
- Columns must be backfilled for existing rows (if any), using current timestamp.
- Provide defaults for new rows (default now()).

### 2) Liquibase Migration
Add a new Liquibase changeset that:
- Adds created_at/updated_at if missing
- Backfills existing rows
- Enforces NOT NULL
- Adds default values (now()) for inserts

### 3) Entity Alignment Check (Code)
Verify PackageEntity mapping:
- `@Column(name="created_at", nullable=false)`
- `@Column(name="updated_at", nullable=false)`

Ensure timestamps are set appropriately on insert/update:
- Either via DB defaults only, OR via @PrePersist/@PreUpdate in entity/base class
- Do not introduce duplicate/conflicting behavior; prefer existing project pattern.

---

## Implementation

### A) Liquibase Migration
Create new SQL changelog file (next sequential id), e.g.:
- `src/main/resources/db/changelog/sql/019-fix-packages-audit-columns.sql`

Add to `db.changelog-master.yaml` with a new changeset id: `019-fix-packages-audit-columns`

SQL (PostgreSQL) must:
1. Add columns if they do not exist:
   ```sql
   ALTER TABLE packages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
   ALTER TABLE packages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
   ```

2. Backfill existing rows:
   ```sql
   UPDATE packages SET created_at = COALESCE(created_at, now());
   UPDATE packages SET updated_at = COALESCE(updated_at, now());
   ```

3. Set defaults:
   ```sql
   ALTER TABLE packages ALTER COLUMN created_at SET DEFAULT now();
   ALTER TABLE packages ALTER COLUMN updated_at SET DEFAULT now();
   ```

4. Enforce NOT NULL:
   ```sql
   ALTER TABLE packages ALTER COLUMN created_at SET NOT NULL;
   ALTER TABLE packages ALTER COLUMN updated_at SET NOT NULL;
   ```

### B) Code Sanity Check
- Inspect PackageEntity to confirm it expects created_at/updated_at.
- If PackageEntity currently extends a base audited entity that defines these columns:
  - Ensure the base class uses correct column names and that packages table uses same names.
- If PackageEntity does NOT currently map created_at/updated_at but Hibernate complains it does:
  - Locate the mapped superclass or embedded audit component that introduces created_at
  - Ensure its column name matches the DB column names added above.

### C) Verification
- After migration, application should start successfully with schema validation enabled.
- Add/adjust a small smoke/integration test (if you have DB integration tests) to ensure packages table contains audit columns.

---

## Acceptance Criteria

1. architecture-model-service starts without SchemaManagementException.
2. Hibernate schema validation passes for table `packages`.
3. Existing rows (if any) have non-null created_at and updated_at.
