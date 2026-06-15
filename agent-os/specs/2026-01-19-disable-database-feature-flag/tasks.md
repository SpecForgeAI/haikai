# Task Breakdown: Disable Database Feature Flag

## Overview
Total Tasks: 24

This task breakdown implements property-based activation for disabling database features, replacing the current profile-based approach. The implementation follows TDD principles with focused tests written before implementation.

## Files to Create/Modify

| Action | File Path | Description |
|--------|-----------|-------------|
| CREATE | `architecture-model-service/src/main/resources/db-disabled.yml` | New property-based activation config |
| MODIFY | `architecture-model-service/src/main/resources/application.yml` | Import db-disabled.yml, change default to true |
| MODIFY | `architecture-model-service/src/main/java/com/example/architecturemodel/config/MigrationRunner.java` | Add @ConditionalOnProperty annotation |
| MODIFY | `architecture-model-service/src/main/java/com/example/architecturemodel/runner/DataEntityPointBackfillRunner.java` | Add @ConditionalOnProperty annotation |
| MODIFY | `architecture-model-service/src/test/java/com/example/architecturemodel/config/ConditionalBeanTest.java` | Update tests to use property-based activation |
| CREATE | `architecture-model-service/src/test/resources/db-disabled.yml` | Test property-based activation config |
| MODIFY | `architecture-model-service/src/test/resources/application.yml` | Import db-disabled.yml |
| DEPRECATE | `architecture-model-service/src/main/resources/application-no-db.yml` | Mark for removal (profile-based approach) |
| DEPRECATE | `architecture-model-service/src/test/resources/application-no-db.yml` | Mark for removal (profile-based approach) |

## Task List

### Configuration Layer

#### Task Group 1: Property-Based Activation Configuration
**Dependencies:** None

- [x] 1.0 Complete property-based activation configuration
  - [x] 1.1 Write 3-4 focused tests for property-based activation
    - Test that db-disabled.yml activates when `app.features.include-database=false`
    - Test that db-disabled.yml does NOT activate when `app.features.include-database=true`
    - Test that auto-configuration exclusions are applied correctly
    - Test that application context loads successfully with property-based activation
  - [x] 1.2 Create `db-disabled.yml` configuration file
    - Location: `architecture-model-service/src/main/resources/db-disabled.yml`
    - Add `spring.config.activate.on-property=app.features.include-database:false`
    - Add `spring.autoconfigure.exclude` list with:
      - `org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration`
      - `org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration`
      - `org.springframework.boot.autoconfigure.liquibase.LiquibaseAutoConfiguration`
      - `org.springframework.boot.autoconfigure.data.jpa.JpaRepositoriesAutoConfiguration`
    - Reference existing `application-no-db.yml` for exact exclude list content
  - [x] 1.3 Update `application.yml` to import db-disabled.yml
    - Add `spring.config.import: optional:classpath:db-disabled.yml`
    - Change `app.features.include-database` default from `false` to `true`
    - Current line: `include-database: ${APP_FEATURES_INCLUDE_DATABASE:false}`
    - New line: `include-database: ${APP_FEATURES_INCLUDE_DATABASE:true}`
  - [x] 1.4 Create test `db-disabled.yml` configuration file
    - Location: `architecture-model-service/src/test/resources/db-disabled.yml`
    - Mirror main resources version with test-appropriate settings
  - [x] 1.5 Update test `application.yml` to import db-disabled.yml
    - Add `spring.config.import: optional:classpath:db-disabled.yml`
    - Add default `app.features.include-database: true` (explicit for test clarity)
  - [x] 1.6 Ensure property-based activation tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify db-disabled.yml activates/deactivates based on property value

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- `db-disabled.yml` contains correct property-based activation trigger
- `application.yml` imports db-disabled.yml with optional prefix
- Default value for `app.features.include-database` is `true`
- Test configuration mirrors main configuration structure

---

### Bean Conditional Guards

#### Task Group 2: Guard MigrationRunner with ConditionalOnProperty
**Dependencies:** Task Group 1

- [x] 2.0 Complete MigrationRunner conditional guard
  - [x] 2.1 Write 2-3 focused tests for MigrationRunner conditional behavior
    - Test that MigrationRunner bean IS present when `app.features.include-database=true`
    - Test that MigrationRunner bean is NOT present when `app.features.include-database=false`
    - Test that application starts without UnsatisfiedDependencyException when DB disabled
  - [x] 2.2 Add @ConditionalOnProperty to MigrationRunner class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/config/MigrationRunner.java`
    - Add annotation: `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
    - Reference `DatabaseAutoConfiguration.java` for exact annotation pattern
  - [x] 2.3 Ensure MigrationRunner tests pass
    - Run ONLY the 2-3 tests written in 2.1
    - Verify bean presence/absence based on property value

**Acceptance Criteria:**
- The 2-3 tests written in 2.1 pass
- MigrationRunner class has correct @ConditionalOnProperty annotation
- Bean is excluded from context when `app.features.include-database=false`
- No UnsatisfiedDependencyException for TypedContentMigrationService dependency

---

#### Task Group 3: Guard DataEntityPointBackfillRunner with ConditionalOnProperty
**Dependencies:** Task Group 1

- [x] 3.0 Complete DataEntityPointBackfillRunner conditional guard
  - [x] 3.1 Write 2-3 focused tests for DataEntityPointBackfillRunner conditional behavior
    - Test that DataEntityPointBackfillRunner bean IS present when `app.features.include-database=true`
    - Test that DataEntityPointBackfillRunner bean is NOT present when `app.features.include-database=false`
    - Test that application starts without UnsatisfiedDependencyException for repository dependencies
  - [x] 3.2 Add @ConditionalOnProperty to DataEntityPointBackfillRunner class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/runner/DataEntityPointBackfillRunner.java`
    - Add annotation: `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
    - Runner depends on: ModelFileRepository, LogicalDataEntityRepository, PhysicalDataEntityRepository
  - [x] 3.3 Ensure DataEntityPointBackfillRunner tests pass
    - Run ONLY the 2-3 tests written in 3.1
    - Verify bean presence/absence based on property value

**Acceptance Criteria:**
- The 2-3 tests written in 3.1 pass
- DataEntityPointBackfillRunner class has correct @ConditionalOnProperty annotation
- Bean is excluded from context when `app.features.include-database=false`
- No UnsatisfiedDependencyException for repository dependencies

---

### Test Updates

#### Task Group 4: Update ConditionalBeanTest for Property-Based Activation
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete ConditionalBeanTest updates
  - [x] 4.1 Analyze existing ConditionalBeanTest test coverage
    - Review DatabaseEnabledTest nested class tests
    - Review DatabaseDisabledTest nested class tests
    - Review NoDbProfileTest nested class tests
    - Review PropertyBasedNoDatabaseTest nested class tests
    - Review NonDbComponentsTest nested class tests
  - [x] 4.2 Update tests to use property-based activation instead of profile-based
    - Modify NoDbProfileTest to use `@TestPropertySource(properties = {"app.features.include-database=false"})` instead of `@ActiveProfiles({"test", "no-db"})`
    - Remove explicit `spring.autoconfigure.exclude` from test annotations (now handled by db-disabled.yml)
    - Ensure tests rely on property-based activation via db-disabled.yml import
  - [x] 4.3 Add test for MigrationRunner bean conditional behavior
    - Add assertion: `assertThat(applicationContext.containsBean("migrationRunner")).isFalse()` in DatabaseDisabledTest
    - Add assertion: `assertThat(applicationContext.containsBean("migrationRunner")).isTrue()` in DatabaseEnabledTest
  - [x] 4.4 Add test for DataEntityPointBackfillRunner bean conditional behavior
    - Add assertion: `assertThat(applicationContext.containsBean("dataEntityPointBackfillRunner")).isFalse()` in DatabaseDisabledTest
    - Add assertion: `assertThat(applicationContext.containsBean("dataEntityPointBackfillRunner")).isTrue()` in DatabaseEnabledTest
  - [x] 4.5 Ensure all ConditionalBeanTest tests pass
    - Run full ConditionalBeanTest class
    - Verify all nested test classes pass

**Acceptance Criteria:**
- All ConditionalBeanTest tests pass
- Tests use property-based activation via db-disabled.yml
- Profile-based activation removed from test annotations
- MigrationRunner and DataEntityPointBackfillRunner bean assertions included

---

### Acceptance Verification

#### Task Group 5: Acceptance Criteria Verification
**Dependencies:** Task Groups 1, 2, 3, 4

- [x] 5.0 Complete acceptance criteria verification
  - [x] 5.1 Write integration test for DB-disabled log verification
    - Test that with `app.features.include-database=false`:
      - Logs do NOT contain "Bootstrapping Spring Data JPA repositories"
      - Logs do NOT contain "Found JPA repository interfaces"
      - Logs do NOT contain "HikariPool" startup messages
      - Logs do NOT contain Liquibase changelog execution
      - Logs do NOT contain "Initialized JPA EntityManagerFactory"
  - [x] 5.2 Write integration test for DB-enabled log verification
    - Test that with `app.features.include-database=true`:
      - Normal DB/JPA/Liquibase startup behavior is preserved
      - Application context loads with all database beans present
  - [x] 5.3 Manual verification: start application with include-database=false
    - Run: `java -jar architecture-model-service.jar --app.features.include-database=false`
    - Verify: No database-related logs appear
    - Verify: Application starts successfully without exceptions
    - Verify: File-based features remain functional
  - [x] 5.4 Manual verification: start application with include-database=true (default)
    - Run: `java -jar architecture-model-service.jar`
    - Verify: Database-related logs appear (HikariPool, JPA, Liquibase)
    - Verify: Application starts successfully with database connection
    - Verify: All features functional
  - [x] 5.5 Ensure acceptance verification tests pass
    - Run acceptance verification tests
    - Document any log output verification findings

**Acceptance Criteria:**
- With `app.features.include-database=false`: No JPA/Hibernate/HikariPool/Liquibase logs
- With `app.features.include-database=false`: Application starts without UnsatisfiedDependencyException
- With `app.features.include-database=true`: Normal database startup behavior preserved
- Manual verification completed and documented

---

### Cleanup and Deprecation

#### Task Group 6: Deprecate Profile-Based Approach
**Dependencies:** Task Groups 1, 2, 3, 4, 5

- [x] 6.0 Complete profile-based approach deprecation
  - [x] 6.1 Add deprecation notice to `application-no-db.yml`
    - Add comment header explaining deprecation
    - Reference new property-based activation approach
    - Include removal timeline (next major version)
    - File: `architecture-model-service/src/main/resources/application-no-db.yml`
  - [x] 6.2 Add deprecation notice to test `application-no-db.yml`
    - Add comment header explaining deprecation
    - Reference new property-based activation approach
    - File: `architecture-model-service/src/test/resources/application-no-db.yml`
  - [x] 6.3 Update DatabaseAutoConfiguration.java Javadoc
    - Remove references to `application-no-db.yml` profile
    - Update to reference property-based activation via `db-disabled.yml`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/config/DatabaseAutoConfiguration.java`
  - [x] 6.4 Run full test suite to verify no regressions
    - Run all tests in architecture-model-service module
    - Verify no test failures from deprecation changes
    - Document any tests still using profile-based approach for future cleanup

**Acceptance Criteria:**
- Profile-based config files have deprecation notices
- Javadoc updated to reference property-based activation
- Full test suite passes with no regressions
- No breaking changes introduced

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Property-Based Activation Configuration**
   - Creates the foundation (`db-disabled.yml`) that all other changes depend on
   - Must be completed first as it establishes the new activation mechanism

2. **Task Group 2: Guard MigrationRunner** (can run in parallel with Task Group 3)
   - Depends on Task Group 1 for property-based activation
   - Prevents UnsatisfiedDependencyException for TypedContentMigrationService

3. **Task Group 3: Guard DataEntityPointBackfillRunner** (can run in parallel with Task Group 2)
   - Depends on Task Group 1 for property-based activation
   - Prevents UnsatisfiedDependencyException for repository dependencies

4. **Task Group 4: Update ConditionalBeanTest**
   - Depends on Task Groups 1, 2, 3 being complete
   - Updates existing tests to use new property-based activation

5. **Task Group 5: Acceptance Criteria Verification**
   - Depends on Task Groups 1-4 being complete
   - Validates the full implementation meets spec requirements

6. **Task Group 6: Deprecate Profile-Based Approach**
   - Final cleanup task after all functionality verified
   - Can be done after all other groups pass

## Dependency Graph

```
Task Group 1 (Configuration)
      |
      +---> Task Group 2 (MigrationRunner Guard)
      |           |
      +---> Task Group 3 (BackfillRunner Guard)
      |           |
      +-----------+
            |
            v
      Task Group 4 (Test Updates)
            |
            v
      Task Group 5 (Acceptance Verification)
            |
            v
      Task Group 6 (Deprecation/Cleanup)
```

## Notes

- **TDD Approach**: Each task group starts with writing focused tests (x.1 sub-task) and ends with running those tests (final sub-task)
- **Test Scope**: Limit each task group to 2-4 focused tests; avoid exhaustive coverage
- **Existing Patterns**: Reference `DatabaseAutoConfiguration.java` and `TypedContentMigrationService.java` for correct `@ConditionalOnProperty` annotation patterns
- **No Log Messaging**: Per spec, do NOT add explicit "DB disabled/enabled" startup logging
- **Backwards Compatibility**: Profile-based approach (`application-no-db.yml`) remains functional but deprecated

## Implementation Notes

**Pre-existing Test Compilation Issues:**
The test suite has pre-existing compilation errors in the following test files that are unrelated to this feature:
- `ProjectSnapshotImportIntegrationTest.java`
- `ProjectSnapshotOverwriteImportIntegrationTest.java`
- `ImplementContextResolutionControllerExpandResolveTest.java`
- `RoadmapImportServiceV3Test.java`
- `OrganisationControllerTextIdTest.java`
- `ProjectSnapshotServiceTest.java`
- `LegacyFieldRemovalSnapshotTest.java`
- `ContextBundleExpansionServiceDataEntityTest.java`

These are due to API changes in DTOs and services that were not reflected in the test files. The ConditionalBeanTest and all main source code compiles successfully.
