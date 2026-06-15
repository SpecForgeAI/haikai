# Requirements: Database Initialisation with Liquibase

## Project
architecture-model-service

## Goal
Initialise the PostgreSQL database schema automatically on first application startup
using Liquibase, while keeping Hibernate strictly in `ddl-auto=validate` mode.
Reuse the existing, already-working `schema.sql` without rewriting it into entities
or Hibernate-managed DDL.

## Scope
- architecture-model-service only
- No changes to docker-compose.yml structure
- No changes to Hibernate validation mode
- No changes to Postgres container behaviour
- Liquibase runs as part of Spring Boot startup

## Out of Scope
- Flyway
- Hibernate auto-DDL (create/update)
- Any schema generation outside Liquibase

---

## 1) Add Liquibase dependency

### 1.1 Update `architecture-model-service/pom.xml`
- Add the following dependency:

```xml
<dependency>
  <groupId>org.liquibase</groupId>
  <artifactId>liquibase-core</artifactId>
</dependency>
```

- No exclusions required.
- Do NOT remove existing JPA / Hibernate dependencies.

---

## 2) Move existing schema.sql into Liquibase-managed resources

### 2.1 Create directory structure:

```
src/main/resources/db/changelog/sql/
```

### 2.2 Move the existing, working `schema.sql` into:

```
src/main/resources/db/changelog/sql/schema.sql
```

Notes:
- Do not rename tables or modify SQL unless strictly required.
- Ensure the SQL runs cleanly when executed against an empty database
  (this has already been verified by the user).
- Semicolons must be present between statements.

---

## 3) Create Liquibase master changelog (YAML-based)

### 3.1 Create file:

```
src/main/resources/db/changelog/db.changelog-master.yaml
```

### 3.2 Contents:

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

Notes:
- Liquibase will record execution in `databasechangelog` tables.
- The schema.sql will run exactly once per database instance.

---

## 4) Configure Spring Boot to run Liquibase before Hibernate

### 4.1 Update `application.yml` (or application-dev.yml if used):

```yaml
spring:
  liquibase:
    enabled: true
    change-log: classpath:db/changelog/db.changelog-master.yaml

  jpa:
    hibernate:
      ddl-auto: validate
```

Explicitly confirm:
- `ddl-auto` remains `validate`
- No Spring SQL init (`spring.sql.init.*`) is enabled

---

## 5) Docker considerations (important)

### 5.1 Liquibase will execute against the database defined by:
- SPRING_DATASOURCE_URL
- SPRING_DATASOURCE_USERNAME
- SPRING_DATASOURCE_PASSWORD

(Already provided via docker-compose.yml.)

### 5.2 Behaviour with volumes:
- If the Postgres volume is empty:
    - Liquibase creates the schema
    - Hibernate validates
    - Application starts successfully
- If the Postgres volume already exists:
    - Liquibase detects prior execution
    - Does NOT re-run schema.sql
    - Hibernate validates against existing schema

### 5.3 To force a full reinitialisation (DEV ONLY):
```bash
docker compose down --volumes
docker compose up --build
```

---

## 6) Acceptance Criteria

- On a fresh Docker volume:
    - architecture-model-service starts without schema validation errors
    - Liquibase tables (`databasechangelog`, `databasechangeloglock`) exist
    - All expected domain tables (e.g. app_business_points) exist

- On subsequent restarts:
    - Liquibase does not reapply schema.sql
    - Hibernate validation passes
    - No schema is modified implicitly

---

## 7) Non-Goals / Explicit Constraints

- Do NOT change Hibernate to create/update
- Do NOT rely on schema.sql auto-execution by Spring
- Do NOT duplicate schema logic in JPA entities
- Liquibase is the single source of truth for schema creation
