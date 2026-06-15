# Specification: Disable Database Feature Flag

## Goal
Enable the application to start cleanly with zero database initialization when `app.features.include-database=false`, using property-based activation as the single mechanism and deprecating the profile-based no-db approach.

## User Stories
- As a developer, I want to run the application without a database connection so that I can develop and test file-only features without requiring PostgreSQL
- As an operator, I want to disable database features via a single property so that I can deploy the application in environments without database infrastructure

## Specific Requirements

**Property-based activation mechanism**
- Create `db-disabled.yml` configuration file that activates via `spring.config.activate.on-property=app.features.include-database:false`
- This file contains `spring.autoconfigure.exclude` list for: DataSourceAutoConfiguration, HibernateJpaAutoConfiguration, LiquibaseAutoConfiguration, JpaRepositoriesAutoConfiguration
- Import this file from main `application.yml` via `spring.config.import: optional:classpath:db-disabled.yml`
- Deprecate/remove the existing `application-no-db.yml` profile-based approach
- Update test configuration similarly to use property-based activation

**Default database enabled**
- Set default value `app.features.include-database: true` in `application.yml`
- No-db mode requires explicit opt-out via `app.features.include-database=false`
- Update `AppFeaturesProperties` default value documentation to reflect this is the production default
- Current `application.yml` has default=false; this must be changed to default=true

**Guard MigrationRunner with ConditionalOnProperty**
- Add `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)` to MigrationRunner class
- This prevents bean instantiation and avoids UnsatisfiedDependencyException when DB is disabled
- MigrationRunner depends on TypedContentMigrationService which is already conditionally guarded

**Guard DataEntityPointBackfillRunner with ConditionalOnProperty**
- Add `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)` to DataEntityPointBackfillRunner class
- This runner depends on ModelFileRepository, LogicalDataEntityRepository, PhysicalDataEntityRepository
- Without the guard, it will cause UnsatisfiedDependencyException when DB is disabled

**No startup banner or log messaging**
- Do NOT add explicit "DB disabled" or "DB enabled" logging on startup
- The absence of database-related startup logs (HikariPool, JPA, Liquibase) is sufficient indication
- Keep existing application startup flow clean and unchanged

**Acceptance criteria verification**
- With `app.features.include-database=false`: logs must NOT show "Bootstrapping Spring Data JPA repositories", "Found JPA repository interfaces", "HikariPool" startup, Liquibase changelog execution, "Initialized JPA EntityManagerFactory"
- With `app.features.include-database=false`: application context must start successfully without UnsatisfiedDependencyException
- With `app.features.include-database=true`: current DB/JPA/Liquibase behaviour remains intact
- Add or update integration tests to verify both modes work correctly

## Existing Code to Leverage

**application-no-db.yml (to be replaced)**
- Contains the exact `spring.autoconfigure.exclude` list needed: DataSourceAutoConfiguration, HibernateJpaAutoConfiguration, LiquibaseAutoConfiguration, JpaRepositoriesAutoConfiguration
- This content will be moved to the new `db-disabled.yml` with property-based activation
- Located at `architecture-model-service/src/main/resources/application-no-db.yml`

**DatabaseAutoConfiguration.java**
- Already has correct `@ConditionalOnProperty` pattern with `matchIfMissing = true`
- Use this as the template for guarding MigrationRunner and DataEntityPointBackfillRunner
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/config/DatabaseAutoConfiguration.java`

**ConditionalBeanTest.java**
- Contains comprehensive tests for both includeDatabase=true and includeDatabase=false scenarios
- Tests verify repository, service, and controller beans are absent when DB disabled
- Adapt these tests to use property-based activation instead of profile-based
- Located at `architecture-model-service/src/test/java/com/example/architecturemodel/config/ConditionalBeanTest.java`

**TypedContentMigrationService.java**
- Already has `@ConditionalOnProperty` annotation - MigrationRunner depends on this service
- Demonstrates the correct pattern for conditionally disabling DB-dependent services
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/TypedContentMigrationService.java`

**JpaRepositoryConfiguration.java**
- Already conditionally enables JPA repository scanning based on include-database property
- No changes needed; just ensure it works with the new property-based activation mechanism
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/config/JpaRepositoryConfiguration.java`

## Out of Scope
- Build profiles or Maven/Gradle profile-based dependency exclusion
- Removing database dependencies from the classpath or build configuration
- Persistence layer refactors or alternative storage implementations
- Endpoint behaviour changes (returning 404/503 when DB disabled)
- UI changes or frontend modifications
- Runtime toggling of database feature after application startup
- "Full file-only mode" completeness or ensuring all features work without DB
- Broad audit or refactor of all DB-dependent beans beyond boot-time failures
- Changes to architecture-read-service or other modules
- Documentation or README updates
