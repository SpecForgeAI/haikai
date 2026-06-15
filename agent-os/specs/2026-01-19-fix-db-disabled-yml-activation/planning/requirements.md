# Spec Requirements: Fix db-disabled.yml Activation

## Initial Description

Fix db-disabled.yml Activation So JPA Auto-Config Is Only Disabled When include-database=false

Correct the Spring Boot config activation condition for the "db-disabled" configuration so that DB/JPA/Liquibase auto-configuration is excluded ONLY when app.features.include-database is explicitly false. Currently, the db-disabled config is being applied even when include-database=true, preventing entityManagerFactory creation and causing repository wiring failures.

## Requirements Discussion

### First Round Questions

No clarifying questions were needed. The user provided clear requirements along with detailed analysis guidance:

1. **Current db-disabled.yml configuration analysis requested**
2. **Spring Boot config activation syntax research requested**
3. **Current application.yml import mechanism analysis requested**

### Technical Investigation Findings

**Q1:** What is the current db-disabled.yml activation syntax?
**Answer (from code analysis):** The file uses `spring.config.activate.on-property: app.features.include-database:false`

**Q2:** Is this syntax valid for Spring Boot config activation?
**Answer (from Spring Boot documentation):** NO. The `spring.config.activate` mechanism only supports:
- `on-profile` - Profile-based activation
- `on-cloud-platform` - Cloud platform detection

The `on-property` syntax is NOT a supported activation property. This is the root cause of the bug.

**Q3:** How is db-disabled.yml currently imported?
**Answer (from application.yml):** Via `spring.config.import: optional:classpath:db-disabled.yml`

This means the file is ALWAYS imported and processed. Since `on-property` is not a valid activation mechanism, the exclusions in db-disabled.yml are ALWAYS applied, regardless of the `include-database` property value.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: DatabaseAutoConfiguration - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/config/DatabaseAutoConfiguration.java`
  - Already uses `@ConditionalOnProperty` annotation correctly
  - The pattern for conditional configuration based on `app.features.include-database` is established here
- Feature: AppFeaturesProperties - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/config/AppFeaturesProperties.java`
  - Defines the `includeDatabase` property with proper ConfigurationProperties binding

### Follow-up Questions

No follow-up questions were needed. The technical investigation provided complete clarity on the issue and solution approach.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements
- Database auto-configuration exclusions must ONLY apply when `app.features.include-database=false`
- When `app.features.include-database=true` (or not set), full database support must be available:
  - DataSourceAutoConfiguration (Hikari pool)
  - HibernateJpaAutoConfiguration (EntityManagerFactory)
  - LiquibaseAutoConfiguration (migrations)
  - JpaRepositoriesAutoConfiguration (repository scanning)
- Application must start successfully with database when `include-database=true`
- Application must start successfully without database when `include-database=false`

### Technical Findings - Root Cause

The current implementation uses an invalid Spring Boot configuration activation syntax:

```yaml
# INVALID - on-property is not a supported activation property
spring:
  config:
    activate:
      on-property: app.features.include-database:false
```

Spring Boot's `spring.config.activate` only supports:
- `on-profile` - Profile expressions
- `on-cloud-platform` - Cloud platform detection

Since `on-property` is not recognized, the config file is always processed regardless of property value.

### Technical Considerations - Solution Approaches

**Option 1: Profile-Based Activation (Recommended for YAML approach)**
- Change `on-property` to `on-profile: no-db`
- Require users to set `--spring.profiles.active=no-db` instead of property
- Pros: Uses supported Spring Boot mechanism
- Cons: Changes the user interface (profile vs property)

**Option 2: Java Configuration with @ConditionalOnProperty**
- Remove db-disabled.yml entirely
- Create a Java configuration class that excludes auto-configurations when `include-database=false`
- Use `@AutoConfiguration` or modify main application class
- Pros: Uses well-established `@ConditionalOnProperty` pattern already in codebase
- Cons: Requires Java code changes, exclusions must happen very early in startup

**Option 3: EnvironmentPostProcessor**
- Implement custom EnvironmentPostProcessor to conditionally add exclusions
- Runs early enough to affect auto-configuration
- Pros: Preserves property-based interface
- Cons: More complex implementation

**Option 4: Remove db-disabled.yml, use @SpringBootApplication(exclude=...) conditionally**
- May require custom ApplicationContextInitializer
- Complex startup timing requirements

### Scope Boundaries

**In Scope:**
- Fix the activation mechanism so exclusions only apply when include-database=false
- Ensure application starts correctly in both modes
- Update any related configuration files
- Update documentation/comments to reflect working approach

**Out of Scope:**
- Changing the overall feature toggle architecture
- Adding new feature toggles
- Changes to database schema or migrations
- Frontend changes

### Files Requiring Changes

1. `architecture-model-service/src/main/resources/db-disabled.yml` - Fix or remove invalid activation syntax
2. `architecture-model-service/src/main/resources/application.yml` - May need import changes
3. Potentially new/modified Java configuration class if YAML-only approach is not viable
4. `architecture-model-service/src/main/java/com/example/architecturemodel/config/DatabaseAutoConfiguration.java` - May need updates depending on solution approach
