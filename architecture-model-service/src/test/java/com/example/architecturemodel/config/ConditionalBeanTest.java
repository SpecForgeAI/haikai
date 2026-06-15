package com.example.architecturemodel.config;

import com.example.architecturemodel.controller.OrganisationController;
import com.example.architecturemodel.controller.ProjectController;
import com.example.architecturemodel.repository.OrganisationRepository;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.service.OrganisationService;
import com.example.architecturemodel.service.ProjectService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.junit.jupiter.SpringExtension;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for conditional bean configuration based on includeDatabase feature toggle.
 *
 * Spec 2026-01-19: Disable Database Feature Flag
 * Task Group 4: Update ConditionalBeanTest for Property-Based Activation
 *
 * Tests verify:
 * - Application starts with includeDatabase=true (all beans present)
 * - Application starts with includeDatabase=false (DB beans absent via DatabaseAutoConfigurationImportFilter)
 * - No DB connection errors when includeDatabase=false
 * - Repository beans are not instantiated in no-db mode
 * - MigrationRunner and DataEntityPointBackfillRunner beans are conditionally loaded
 *
 * This test class uses the DatabaseAutoConfigurationImportFilter which activates
 * when app.features.include-database=false is set. This approach excludes database
 * auto-configurations early in Spring Boot startup, before any beans are created.
 */
class ConditionalBeanTest {

    /**
     * Test 1: Application starts with includeDatabase=true (all beans present)
     * When database is enabled, all repository, service, and controller beans should be present.
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles("test")
    @TestPropertySource(properties = {
        "app.features.include-database=true"
    })
    static class DatabaseEnabledTest {

        @Autowired
        private ApplicationContext applicationContext;

        @Test
        @DisplayName("All DB-related beans should be present when includeDatabase=true")
        void allDbBeansPresent() {
            // Verify repository beans are present
            assertThat(applicationContext.containsBean("projectRepository")).isTrue();
            assertThat(applicationContext.containsBean("organisationRepository")).isTrue();

            // Verify service beans are present
            assertThat(applicationContext.containsBean("projectService")).isTrue();
            assertThat(applicationContext.containsBean("organisationService")).isTrue();

            // Verify controller beans are present
            assertThat(applicationContext.containsBean("projectController")).isTrue();
            assertThat(applicationContext.containsBean("organisationController")).isTrue();
        }

        @Test
        @DisplayName("Repository beans should be autowirable when includeDatabase=true")
        void repositoryBeansAutowirable() {
            ProjectRepository projectRepo = applicationContext.getBean(ProjectRepository.class);
            OrganisationRepository orgRepo = applicationContext.getBean(OrganisationRepository.class);

            assertThat(projectRepo).isNotNull();
            assertThat(orgRepo).isNotNull();
        }

        @Test
        @DisplayName("Service beans should be autowirable when includeDatabase=true")
        void serviceBeansAutowirable() {
            ProjectService projectService = applicationContext.getBean(ProjectService.class);
            OrganisationService orgService = applicationContext.getBean(OrganisationService.class);

            assertThat(projectService).isNotNull();
            assertThat(orgService).isNotNull();
        }

        @Test
        @DisplayName("MigrationRunner bean should be present when includeDatabase=true")
        void migrationRunnerBeanPresent() {
            assertThat(applicationContext.containsBean("migrationRunner")).isTrue();
        }

        @Test
        @DisplayName("DataEntityPointBackfillRunner bean should be present when includeDatabase=true")
        void dataEntityPointBackfillRunnerBeanPresent() {
            assertThat(applicationContext.containsBean("dataEntityPointBackfillRunner")).isTrue();
        }
    }

    /**
     * Test 2: Application starts with includeDatabase=false (DB beans absent)
     * When database is disabled via property-based activation, repository, service,
     * and controller beans should not be present.
     *
     * The DatabaseAutoConfigurationImportFilter detects app.features.include-database=false
     * and excludes all database auto-configurations during the import phase.
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles("test")
    @TestPropertySource(properties = {
        "app.features.include-database=false"
    })
    static class DatabaseDisabledTest {

        @Autowired
        private ApplicationContext applicationContext;

        @Test
        @DisplayName("Application should start successfully with includeDatabase=false")
        void applicationStartsWithoutDatabase() {
            // If we get here, the application started successfully
            assertThat(applicationContext).isNotNull();
        }

        @Test
        @DisplayName("DB-dependent repository beans should NOT be present when includeDatabase=false")
        void repositoryBeansAbsent() {
            // Repository beans should not be registered
            assertThat(applicationContext.containsBean("projectRepository")).isFalse();
            assertThat(applicationContext.containsBean("organisationRepository")).isFalse();
            assertThat(applicationContext.containsBean("modelFileRepository")).isFalse();
        }

        @Test
        @DisplayName("DB-dependent service beans should NOT be present when includeDatabase=false")
        void serviceBeansAbsent() {
            // Service beans that depend on repositories should not be registered
            assertThat(applicationContext.containsBean("projectService")).isFalse();
            assertThat(applicationContext.containsBean("organisationService")).isFalse();
            assertThat(applicationContext.containsBean("projectDeletionService")).isFalse();
        }

        @Test
        @DisplayName("DB-dependent controller beans should NOT be present when includeDatabase=false")
        void controllerBeansAbsent() {
            // Controller beans that depend on DB services should not be registered
            assertThat(applicationContext.containsBean("projectController")).isFalse();
            assertThat(applicationContext.containsBean("organisationController")).isFalse();
        }

        @Test
        @DisplayName("MigrationRunner bean should NOT be present when includeDatabase=false")
        void migrationRunnerBeanAbsent() {
            assertThat(applicationContext.containsBean("migrationRunner")).isFalse();
        }

        @Test
        @DisplayName("DataEntityPointBackfillRunner bean should NOT be present when includeDatabase=false")
        void dataEntityPointBackfillRunnerBeanAbsent() {
            assertThat(applicationContext.containsBean("dataEntityPointBackfillRunner")).isFalse();
        }

        @Test
        @DisplayName("No DataSource bean should be present when includeDatabase=false")
        void noDataSourceBean() {
            assertThat(applicationContext.containsBean("dataSource")).isFalse();
        }
    }

    /**
     * Test 3: No DB connection errors when using property-based activation
     * Using @TestPropertySource with include-database=false should not attempt any database connections.
     *
     * The DatabaseAutoConfigurationImportFilter handles exclusion of database auto-configurations
     * automatically based on the property value.
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles("test")
    @TestPropertySource(properties = {
        "app.features.include-database=false"
    })
    static class PropertyBasedNoDatabaseTest {

        @Autowired
        private ApplicationContext applicationContext;

        @Autowired
        private AppFeaturesProperties appFeaturesProperties;

        @Test
        @DisplayName("Application should start cleanly with property-based activation without DB connection errors")
        void applicationStartsCleanlyWithPropertyActivation() {
            // If we get here without exceptions, no DB connection was attempted
            assertThat(applicationContext).isNotNull();
            assertThat(appFeaturesProperties.isIncludeDatabase()).isFalse();
        }

        @Test
        @DisplayName("No DataSource bean should be present with property-based activation")
        void noDataSourceBean() {
            assertThat(applicationContext.containsBean("dataSource")).isFalse();
        }

        @Test
        @DisplayName("Property-based approach should disable database beans")
        void propertyBasedApproachDisablesDatabase() {
            assertThat(appFeaturesProperties.isIncludeDatabase()).isFalse();
            assertThat(applicationContext.containsBean("projectRepository")).isFalse();
            assertThat(applicationContext.containsBean("projectService")).isFalse();
            assertThat(applicationContext.containsBean("dataSource")).isFalse();
        }
    }

    /**
     * Test 4: Non-DB components remain available when database is disabled
     * Beans that don't depend on database should still be available.
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles("test")
    @TestPropertySource(properties = {
        "app.features.include-database=false"
    })
    static class NonDbComponentsTest {

        @Autowired
        private ApplicationContext applicationContext;

        @Test
        @DisplayName("Non-DB beans should remain available when database is disabled")
        void nonDbBeansAvailable() {
            // Web configuration should still be available
            assertThat(applicationContext.containsBean("webConfig")).isTrue();

            // AppFeaturesProperties should be available
            assertThat(applicationContext.containsBean("app.features-com.example.architecturemodel.config.AppFeaturesProperties")).isTrue();
        }
    }

    /**
     * Test 5: no-db profile still works (backwards compatibility)
     * The no-db profile sets include-database=false which triggers the DatabaseAutoConfigurationImportFilter.
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles({"test", "no-db"})
    static class NoDbProfileTest {

        @Autowired
        private ApplicationContext applicationContext;

        @Autowired
        private AppFeaturesProperties appFeaturesProperties;

        @Test
        @DisplayName("no-db profile should still work for backwards compatibility")
        void noDbProfileStillWorks() {
            // If we get here without exceptions, no DB connection was attempted
            assertThat(applicationContext).isNotNull();
            assertThat(appFeaturesProperties.isIncludeDatabase()).isFalse();
        }

        @Test
        @DisplayName("No DataSource bean should be present with no-db profile")
        void noDataSourceBean() {
            assertThat(applicationContext.containsBean("dataSource")).isFalse();
        }
    }
}
