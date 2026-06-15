package com.example.architecturemodel.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.junit.jupiter.SpringExtension;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for Feature Toggle functionality.
 *
 * Spec 2026-01-19: Startup Configuration for Feature Toggles
 * Task Group 4.3: Strategic integration tests
 *
 * Tests verify:
 * - Full application startup with no-db profile end-to-end
 * - Property-based no-db config matches profile-based behavior (via DatabaseAutoConfigurationImportFilter)
 * - Backend and frontend defaults align
 */
class FeatureToggleIntegrationTest {

    /**
     * Integration Test 1: Full application startup with --spring.profiles.active=no-db
     *
     * This test verifies that the entire application context loads correctly
     * when using the no-db profile, simulating production startup.
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
    @ActiveProfiles({"test", "no-db"})
    static class FullApplicationStartupNoDbProfileTest {

        @Autowired
        private ApplicationContext applicationContext;

        @Autowired
        private AppFeaturesProperties appFeaturesProperties;

        @Test
        @DisplayName("Full application should start successfully with no-db profile")
        void fullApplicationStartsWithNoDbProfile() {
            // Verify the application context is fully loaded
            assertThat(applicationContext).isNotNull();
            assertThat(applicationContext.getId()).isNotNull();

            // Verify the feature toggle is correctly set
            assertThat(appFeaturesProperties.isIncludeDatabase()).isFalse();
            assertThat(appFeaturesProperties.isIncludeDelivery()).isTrue();

            // Verify no database-related beans are present
            assertThat(applicationContext.containsBean("dataSource")).isFalse();
            assertThat(applicationContext.containsBean("entityManagerFactory")).isFalse();

            // Verify core non-DB configuration is present
            assertThat(applicationContext.containsBean("webConfig")).isTrue();
        }

        @Test
        @DisplayName("Application context should have correct bean count in no-db mode")
        void applicationContextHasExpectedBeans() {
            // Verify we have at least some beans (application loaded)
            String[] beanNames = applicationContext.getBeanDefinitionNames();
            assertThat(beanNames.length).isGreaterThan(10);

            // Verify AppFeaturesProperties is registered
            assertThat(applicationContext.getBeansOfType(AppFeaturesProperties.class))
                .hasSize(1);
        }
    }

    /**
     * Integration Test 2: Property-based no-db config matches profile-based behavior
     *
     * This test verifies that setting app.features.include-database=false via properties
     * results in the same bean configuration as using the no-db profile.
     *
     * The DatabaseAutoConfigurationImportFilter automatically excludes database
     * auto-configurations when the property is false, so no hardcoded excludes
     * are needed in the test annotation.
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "app.features.include-database=false"
        }
    )
    @ActiveProfiles("test")
    static class PropertyBasedMatchesProfileTest {

        @Autowired
        private ApplicationContext applicationContext;

        @Autowired
        private AppFeaturesProperties appFeaturesProperties;

        @Test
        @DisplayName("Property-based no-db config should match profile-based behavior")
        void propertyBasedMatchesProfileBased() {
            // Same assertions as profile-based test - behavior should be identical
            assertThat(applicationContext).isNotNull();
            assertThat(appFeaturesProperties.isIncludeDatabase()).isFalse();
            assertThat(appFeaturesProperties.isIncludeDelivery()).isTrue();

            // Verify no database-related beans are present
            // The DatabaseAutoConfigurationImportFilter excludes these auto-configurations
            // when app.features.include-database=false
            assertThat(applicationContext.containsBean("dataSource")).isFalse();
            assertThat(applicationContext.containsBean("entityManagerFactory")).isFalse();
            assertThat(applicationContext.containsBean("projectRepository")).isFalse();
            assertThat(applicationContext.containsBean("organisationRepository")).isFalse();

            // Verify core non-DB configuration is present
            assertThat(applicationContext.containsBean("webConfig")).isTrue();
        }
    }

    /**
     * Integration Test 3: Verify backend and frontend defaults align
     *
     * This test verifies that the backend defaults match what is documented
     * for the frontend, ensuring consistency between systems.
     *
     * Frontend defaults (from runtime-config.json):
     * - includeDelivery: true
     * - includeDatabase: true
     *
     * Backend defaults should match.
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles("test")
    static class BackendFrontendDefaultsAlignmentTest {

        @Autowired
        private AppFeaturesProperties appFeaturesProperties;

        /**
         * Expected defaults matching frontend runtime-config.json
         */
        private static final boolean FRONTEND_DEFAULT_INCLUDE_DELIVERY = true;
        private static final boolean FRONTEND_DEFAULT_INCLUDE_DATABASE = true;

        @Test
        @DisplayName("Backend defaults should match frontend defaults (includeDelivery=true)")
        void backendDefaultMatchesFrontendIncludeDelivery() {
            // Create a fresh instance to check programmatic defaults
            AppFeaturesProperties freshInstance = new AppFeaturesProperties();

            assertThat(freshInstance.isIncludeDelivery())
                .as("Backend default for includeDelivery should match frontend default")
                .isEqualTo(FRONTEND_DEFAULT_INCLUDE_DELIVERY);
        }

        @Test
        @DisplayName("Backend defaults should match frontend defaults (includeDatabase=true)")
        void backendDefaultMatchesFrontendIncludeDatabase() {
            // Create a fresh instance to check programmatic defaults
            AppFeaturesProperties freshInstance = new AppFeaturesProperties();

            assertThat(freshInstance.isIncludeDatabase())
                .as("Backend default for includeDatabase should match frontend default")
                .isEqualTo(FRONTEND_DEFAULT_INCLUDE_DATABASE);
        }

        @Test
        @DisplayName("Backend context defaults should match frontend defaults")
        void backendContextDefaultsMatchFrontend() {
            // Verify autowired properties also have correct defaults when no override is specified
            // (The test profile doesn't override these values)
            assertThat(appFeaturesProperties.isIncludeDelivery())
                .as("Backend context includeDelivery should match frontend default")
                .isEqualTo(FRONTEND_DEFAULT_INCLUDE_DELIVERY);
            assertThat(appFeaturesProperties.isIncludeDatabase())
                .as("Backend context includeDatabase should match frontend default")
                .isEqualTo(FRONTEND_DEFAULT_INCLUDE_DATABASE);
        }
    }
}
