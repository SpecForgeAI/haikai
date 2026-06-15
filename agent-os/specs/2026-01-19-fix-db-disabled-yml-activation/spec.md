# Specification: Fix db-disabled.yml Activation

## Goal
Fix the broken Spring Boot config activation in db-disabled.yml so that database auto-configuration exclusions only apply when `app.features.include-database=false`, enabling the application to start correctly with database when the property is true.

## User Stories
- As a developer, I want the application to start with full database support when `include-database=true` so that JPA repositories and EntityManagerFactory are available
- As an operator, I want to run the application without a database by setting `include-database=false` so that no database connection is attempted

## Specific Requirements

**Remove invalid db-disabled.yml activation mechanism**
- The current `spring.config.activate.on-property` syntax is NOT valid in Spring Boot
- Spring Boot only supports `on-profile` and `on-cloud-platform` for config activation
- The file is currently imported unconditionally via `optional:classpath:db-disabled.yml`
- This causes exclusions to always apply regardless of property value
- Delete the db-disabled.yml file entirely as YAML-based property activation is not possible

**Create Java-based AutoConfigurationImportFilter for conditional exclusions**
- Implement a class that implements `AutoConfigurationImportFilter` interface
- Filter out database auto-configurations when `app.features.include-database=false`
- Auto-configurations to exclude: DataSourceAutoConfiguration, HibernateJpaAutoConfiguration, LiquibaseAutoConfiguration, JpaRepositoriesAutoConfiguration
- This runs early enough in Spring Boot startup to prevent auto-config classes from loading
- Register via `META-INF/spring.factories` under `AutoConfigurationImportFilter` key

**Remove db-disabled.yml import from application.yml files**
- Remove `spring.config.import: optional:classpath:db-disabled.yml` from main application.yml
- Remove the same import from test application.yml
- The Java-based filter will handle exclusions, making the YAML import unnecessary

**Update application-no-db.yml profile to use filter**
- Remove the `spring.autoconfigure.exclude` section from application-no-db.yml
- Keep only the `app.features.include-database: false` property setting
- The Java filter will detect this property and apply exclusions automatically
- Same change for test application-no-db.yml

**Update DatabaseAutoConfiguration class documentation**
- Remove references to the invalid "property-based activation mechanism in db-disabled.yml"
- Update Javadoc to describe the new AutoConfigurationImportFilter approach
- Keep the existing `@ConditionalOnProperty` annotation as it serves as a marker bean

**Update FeatureToggleIntegrationTest**
- Remove the hardcoded `spring.autoconfigure.exclude` from PropertyBasedMatchesProfileTest
- The test should rely on the new AutoConfigurationImportFilter to apply exclusions
- Verify property-based approach now works identically to profile-based approach

**Ensure backward compatibility with no-db profile**
- Users activating `--spring.profiles.active=no-db` must continue to work
- The profile sets `include-database=false` which triggers the filter
- No changes to user-facing behavior for profile-based activation

**Delete db-disabled.yml files**
- Remove `src/main/resources/db-disabled.yml`
- Remove `src/test/resources/db-disabled.yml`
- These files used an invalid Spring Boot feature and serve no purpose

## Existing Code to Leverage

**DatabaseAutoConfiguration.java**
- Already uses `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
- Demonstrates the correct pattern for conditional configuration based on the include-database property
- Can serve as a reference for the havingValue and matchIfMissing settings

**JpaRepositoryConfiguration.java**
- Uses the same `@ConditionalOnProperty` pattern for conditional JPA repository scanning
- Shows established convention for feature toggle property naming: `app.features.include-database`
- Confirms the repository scanning is already conditional and works correctly

**AppFeaturesProperties.java**
- Defines the `includeDatabase` property with ConfigurationProperties binding
- Property path: `app.features` prefix, `include-database` property
- Default value is true (database enabled by default)

**application-no-db.yml profile files**
- Already contain the correct list of auto-configurations to exclude
- Can copy the exclusion list for the new AutoConfigurationImportFilter
- Shows the pattern working correctly when applied via profile activation

**FeatureToggleIntegrationTest.java**
- Contains tests for both profile-based and property-based no-db modes
- PropertyBasedMatchesProfileTest shows the workaround using hardcoded excludes in test annotation
- Once fixed, this test should pass without the hardcoded excludes

## Out of Scope
- Changing the overall feature toggle architecture or property naming
- Adding new feature toggles beyond include-database
- Changes to database schema, migrations, or Liquibase configuration
- Frontend changes or UI modifications
- Modifying the default values of include-database (remains true)
- Creating new Spring profiles or changing profile naming conventions
- Changes to any service, repository, or controller classes
- Modifying DataSourceAutoConfiguration or other Spring Boot internal classes
- Adding database connection pooling configuration
- Performance optimization of application startup
