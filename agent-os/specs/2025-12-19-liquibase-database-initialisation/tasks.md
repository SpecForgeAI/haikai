# Task Breakdown: Liquibase Database Initialisation

## Overview
Total Tasks: 15
Estimated Complexity: Low-Medium

This task list implements Liquibase integration for automatic PostgreSQL schema creation in the architecture-model-service, while maintaining Hibernate in validate mode.

## Task List

### Phase 1: Maven Dependency Setup

#### Task Group 1: Add Liquibase Dependency
**Dependencies:** None

- [x] 1.0 Complete Liquibase dependency setup
  - [x] 1.1 Open `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/pom.xml`
  - [x] 1.2 Add Liquibase dependency after the PostgreSQL driver dependency (around line 59):
    ```xml
    <!-- Liquibase for database migrations -->
    <dependency>
        <groupId>org.liquibase</groupId>
        <artifactId>liquibase-core</artifactId>
    </dependency>
    ```
  - [x] 1.3 Verify no version is specified (Spring Boot BOM manages version)
  - [x] 1.4 Verify existing JPA/Hibernate dependencies are unchanged
  - [x] 1.5 Run `mvn dependency:resolve` from architecture-model-service directory to verify dependency resolution

**Acceptance Criteria:**
- Liquibase dependency added without version specification
- Maven resolves dependencies successfully
- No changes to existing dependencies

---

### Phase 2: Liquibase File Structure

#### Task Group 2: Create Directory Structure and Move Schema
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete Liquibase file structure setup
  - [x] 2.1 Create directory structure:
    ```
    C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/resources/db/changelog/sql/
    ```
  - [x] 2.2 Copy schema.sql from:
    ```
    C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/db/schema.sql
    ```
    to:
    ```
    C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/resources/db/changelog/sql/schema.sql
    ```
  - [x] 2.3 Verify the copied schema.sql content is identical (no modifications)
  - [x] 2.4 Verify semicolons are present between all SQL statements
  - [x] 2.5 Delete the original db/ folder after confirming successful copy:
    ```
    C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/db/
    ```

**Acceptance Criteria:**
- Directory structure `src/main/resources/db/changelog/sql/` exists
- schema.sql is in the new location
- Original db/ folder is removed
- SQL content is unchanged

---

#### Task Group 3: Create Master Changelog
**Dependencies:** Task Group 2

- [x] 3.0 Complete master changelog creation
  - [x] 3.1 Create file:
    ```
    C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml
    ```
  - [x] 3.2 Add the following content:
    ```yaml
    databaseChangeLog:
      - changeSet:
          id: 001-initial-schema
          author: architecture-tool
          changes:
            - sqlFile:
                path: db/changelog/sql/schema.sql
                relativeToChangelogFile: false
                splitStatements: true
                stripComments: true
    ```
  - [x] 3.3 Verify YAML syntax is valid (proper indentation with spaces, not tabs)
  - [x] 3.4 Verify `relativeToChangelogFile: false` is set (path resolves from classpath root)

**Acceptance Criteria:**
- db.changelog-master.yaml exists with correct content
- YAML syntax is valid
- changeSet id is `001-initial-schema`
- author is `architecture-tool`

---

### Phase 3: Application Configuration

#### Task Group 4: Configure Spring Boot Liquibase Integration
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete Spring Boot Liquibase configuration
  - [x] 4.1 Open `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/resources/application.yml`
  - [x] 4.2 Add Liquibase configuration under the `spring:` section (after `datasource:` block, before `jpa:`):
    ```yaml
      liquibase:
        enabled: true
        change-log: classpath:db/changelog/db.changelog-master.yaml
    ```
  - [x] 4.3 Verify `spring.jpa.hibernate.ddl-auto` remains `validate` (do NOT change)
  - [x] 4.4 Verify NO `spring.sql.init.*` properties exist
  - [x] 4.5 Verify YAML indentation is correct (liquibase at same level as datasource and jpa)

**Acceptance Criteria:**
- Liquibase configuration added to application.yml
- `ddl-auto` remains `validate`
- No spring.sql.init properties present
- YAML is valid

---

#### Task Group 5: Configure Test Profile
**Dependencies:** Task Group 4

- [x] 5.0 Complete test configuration update
  - [x] 5.1 Open `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/test/resources/application.yml`
  - [x] 5.2 Add Liquibase disabled configuration under `spring:` section:
    ```yaml
      liquibase:
        enabled: false
    ```
  - [x] 5.3 Verify `ddl-auto: create-drop` remains for H2 test database
  - [x] 5.4 Verify H2 datasource configuration is unchanged

**Acceptance Criteria:**
- Liquibase disabled in test configuration
- H2 with create-drop mode unchanged
- Tests will continue to use Hibernate DDL for schema

---

### Phase 4: Verification

#### Task Group 6: Local Build Verification
**Dependencies:** Task Groups 1-5

- [x] 6.0 Complete local build verification
  - [x] 6.1 Run Maven build from architecture-model-service directory:
    ```bash
    cd C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service
    mvn clean compile
    ```
  - [x] 6.2 Verify compilation succeeds
  - [x] 6.3 Verify resources are copied to target:
    - `target/classes/db/changelog/db.changelog-master.yaml`
    - `target/classes/db/changelog/sql/schema.sql`
  - [x] 6.4 Run existing unit tests:
    ```bash
    mvn test
    ```
  - [x] 6.5 Verify all existing tests pass (Liquibase disabled in test profile)

**Acceptance Criteria:**
- Maven build succeeds
- Liquibase resources present in target/classes
- All existing unit tests pass

---

#### Task Group 7: Docker Integration Testing
**Dependencies:** Task Group 6

- [x] 7.0 Complete Docker integration verification
  - [x] 7.1 Stop any running containers and remove volumes:
    ```bash
    cd C:/Workspaces/SSD/architecture-store-and-diagrams
    docker compose down --volumes
    ```
  - [x] 7.2 Rebuild and start containers:
    ```bash
    docker compose up --build
    ```
  - [x] 7.3 Verify architecture-model-service starts without errors
  - [x] 7.4 Check logs for Liquibase execution messages:
    - Look for: `Liquibase: Successfully acquired change log lock`
    - Look for: `Liquibase: changeSet ... executed successfully`
  - [x] 7.5 Verify Hibernate validation passes (no schema mismatch errors)
  - [x] 7.6 Connect to PostgreSQL and verify tables exist:
    ```bash
    docker exec -it <postgres-container> psql -U postgres -d architecture_model -c "\dt"
    ```
  - [x] 7.7 Verify Liquibase tracking tables exist:
    - `databasechangelog`
    - `databasechangeloglock`
  - [x] 7.8 Verify domain tables exist (e.g., `model_files`, `applications`, `diagrams`)

**Acceptance Criteria:**
- Application starts successfully in Docker
- Liquibase executes schema creation
- Hibernate validation passes
- All 29 domain tables exist
- Liquibase tracking tables exist

---

#### Task Group 8: Idempotency Verification
**Dependencies:** Task Group 7

- [x] 8.0 Complete idempotency verification
  - [x] 8.1 Restart the architecture-model-service container:
    ```bash
    docker compose restart architecture-model-service
    ```
  - [x] 8.2 Verify application starts without errors
  - [x] 8.3 Check logs confirm Liquibase skips already-executed changeset:
    - Look for: `changeSet ... was previously executed`
    - Or absence of schema creation SQL in logs
  - [x] 8.4 Verify no duplicate table errors
  - [x] 8.5 Verify Hibernate validation passes on restart

**Acceptance Criteria:**
- Service restarts successfully
- Liquibase does NOT re-run schema.sql
- No schema modification occurs
- Application functions normally

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** (Maven dependency) - Can start immediately
2. **Task Group 2** (File structure) - Can run in parallel with Group 1
3. **Task Group 3** (Master changelog) - Requires Group 2
4. **Task Group 4** (Application config) - Requires Groups 1, 2, 3
5. **Task Group 5** (Test config) - Requires Group 4
6. **Task Group 6** (Build verification) - Requires Groups 1-5
7. **Task Group 7** (Docker testing) - Requires Group 6
8. **Task Group 8** (Idempotency) - Requires Group 7

---

## File Changes Summary

| File | Action |
|------|--------|
| `architecture-model-service/pom.xml` | Add Liquibase dependency |
| `architecture-model-service/db/schema.sql` | DELETE (after moving) |
| `architecture-model-service/src/main/resources/db/changelog/sql/schema.sql` | CREATE (moved from db/) |
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | CREATE |
| `architecture-model-service/src/main/resources/application.yml` | MODIFY (add Liquibase config) |
| `architecture-model-service/src/test/resources/application.yml` | MODIFY (disable Liquibase) |

---

## Rollback Procedure

If issues arise during implementation:

1. Remove Liquibase dependency from pom.xml
2. Remove Liquibase configuration from application.yml
3. Remove Liquibase configuration from test application.yml
4. Delete `src/main/resources/db/changelog/` directory
5. Restore `db/schema.sql` from git if needed
6. Run `docker compose down --volumes` to reset database

---

## Notes

- Spring Boot auto-configuration ensures Liquibase runs before Hibernate validation
- No explicit ordering configuration is required
- The schema.sql has 29 tables, indexes, and foreign keys
- Liquibase tracking tables are auto-created by Liquibase
- To force full reinitialisation in dev: `docker compose down --volumes && docker compose up --build`
