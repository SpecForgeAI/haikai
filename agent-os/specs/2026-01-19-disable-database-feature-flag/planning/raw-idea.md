# Raw Idea

## Title
Make include-database=false Fully Disable DB/JPA/Liquibase + Guard MigrationRunner

## Intent
When app.features.include-database=false, the architecture-model-service must start with ZERO database-related initialization. Specifically: no DataSource/Hikari, no Spring Data JPA repository scanning, no Hibernate EntityManagerFactory, and no Liquibase execution. Additionally, any beans that depend on DB-only services must not be created in this mode (including MigrationRunner), preventing UnsatisfiedDependency startup failures.
