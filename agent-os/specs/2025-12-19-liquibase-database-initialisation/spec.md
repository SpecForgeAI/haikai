# Specification: Liquibase Database Initialisation

## Goal
Integrate Liquibase into the architecture-model-service to manage PostgreSQL schema creation on first startup, while keeping Hibernate strictly in validate mode to ensure schema consistency without Hibernate-managed DDL.

## User Stories
- As a developer, I want the database schema to be automatically created on first startup so that I do not need to manually run SQL scripts.
- As a DevOps engineer, I want schema changes tracked via Liquibase changelogs so that database migrations are versioned and auditable.

## Specific Requirements

**Add Liquibase Maven dependency**
- Add `org.liquibase:liquibase-core` dependency to `architecture-model-service/pom.xml`
- No version specification required as Spring Boot parent BOM manages the version
- No exclusions required
- Do NOT remove or modify existing JPA/Hibernate dependencies

**Create Liquibase directory structure**
- Create directory: `src/main/resources/db/changelog/sql/`
- This follows the conventional Liquibase directory structure for Spring Boot applications
- The `sql/` subfolder will hold raw SQL files referenced by changelogs

**Move existing schema.sql to Liquibase-managed location**
- Move file from: `architecture-model-service/db/schema.sql`
- Move file to: `architecture-model-service/src/main/resources/db/changelog/sql/schema.sql`
- Do NOT modify the SQL content; it has been verified to work against an empty database
- The original `db/` folder at the module root can be deleted after migration

**Create Liquibase master changelog file**
- Create file: `src/main/resources/db/changelog/db.changelog-master.yaml`
- Use YAML format (not XML) for readability and consistency
- Define a single changeSet with id `001-initial-schema` and author `architecture-tool`
- Use the `sqlFile` change type to reference `db/changelog/sql/schema.sql`
- Set `relativeToChangelogFile: false` so path is resolved from classpath root
- Set `splitStatements: true` and `stripComments: true` for proper SQL parsing

**Configure Spring Boot Liquibase integration**
- Update `src/main/resources/application.yml` with Liquibase configuration
- Set `spring.liquibase.enabled: true`
- Set `spring.liquibase.change-log: classpath:db/changelog/db.changelog-master.yaml`
- Confirm `spring.jpa.hibernate.ddl-auto` remains `validate` (do NOT change)
- Do NOT add any `spring.sql.init.*` properties; Liquibase replaces Spring SQL init

**Ensure correct startup order**
- Spring Boot auto-configuration ensures Liquibase runs before Hibernate validation
- No explicit configuration needed for ordering; the `liquibase-core` dependency triggers auto-config
- Liquibase will create tables before Hibernate attempts schema validation

**Handle Docker volume scenarios**
- On empty volume: Liquibase creates schema, records execution in `databasechangelog` table
- On existing volume: Liquibase detects prior execution via `databasechangelog`, skips schema creation
- Liquibase tracking tables (`databasechangelog`, `databasechangeloglock`) are auto-created
- To force reinitialisation in dev: `docker compose down --volumes && docker compose up --build`

**Test configuration considerations**
- The test `application.yml` uses H2 with `ddl-auto: create-drop`; this should remain unchanged
- Liquibase is not required for unit tests as H2 creates schema from JPA entities
- Optionally add `spring.liquibase.enabled: false` to test profile to prevent Liquibase running against H2

## Existing Code to Leverage

**architecture-model-service/pom.xml**
- Spring Boot 3.2.5 parent provides managed version for `liquibase-core`
- Existing Spring Data JPA and PostgreSQL dependencies remain untouched
- Add Liquibase dependency in the same dependencies section after database-related deps

**architecture-model-service/src/main/resources/application.yml**
- Already has correct `spring.jpa.hibernate.ddl-auto: validate` setting
- Already has correct PostgreSQL datasource configuration
- Add Liquibase config under `spring:` section alongside existing JPA config

**architecture-model-service/db/schema.sql**
- Complete working schema with 29 tables, indexes, and foreign key relationships
- Uses TEXT for IDs (matching frontend string IDs), JSONB for complex objects
- Includes proper semicolons between statements for Liquibase parsing
- Move file as-is without modification

**docker-compose.yml**
- Already provides datasource environment variables (SPRING_DATASOURCE_*)
- Postgres container has healthcheck ensuring DB is ready before app starts
- Named volume `postgres_data` persists between restarts for Liquibase tracking

**JPA Entity classes (e.g., ModelFileEntity.java)**
- Entities use `@Table(name = "...")` matching schema.sql table names
- Column mappings use `@Column(name = "...")` matching schema.sql columns
- Hibernate validate mode will verify entity-to-table alignment after Liquibase runs

## Out of Scope
- Flyway integration (Liquibase is the chosen tool)
- Hibernate ddl-auto modes other than validate (create, update, create-drop)
- Schema generation from JPA entities
- Modification of existing schema.sql content
- Changes to docker-compose.yml structure or Postgres container config
- Liquibase rollback scripts for initial schema
- Liquibase contexts or labels for environment-specific deployments
- Database refactoring changelogs (future migrations are a separate concern)
- H2 test database Liquibase integration
- Liquibase Maven plugin configuration (using Spring Boot auto-config only)
