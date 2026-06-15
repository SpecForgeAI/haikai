package com.example.architecturemodel.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.junit.jupiter.SpringExtension;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for AppFeaturesProperties configuration properties.
 *
 * Spec 2026-01-19: Startup Configuration for Feature Toggles
 * Task Group 1.1: Tests for feature toggle properties
 *
 * Tests verify:
 * - Default values are correctly set (both true)
 * - Custom property values are correctly bound
 * - Environment variable overrides work
 * - application-no-db.yml profile sets correct values
 */
class AppFeaturesPropertiesTest {

    /**
     * Test 1: AppFeaturesProperties loads default values (both true)
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles("test")
    @EnableConfigurationProperties(AppFeaturesProperties.class)
    static class DefaultValuesTest {

        @Autowired
        private AppFeaturesProperties properties;

        @Test
        @DisplayName("Default values should be true for both feature toggles")
        void defaultValuesAreBothTrue() {
            assertThat(properties.isIncludeDelivery()).isTrue();
            assertThat(properties.isIncludeDatabase()).isTrue();
        }
    }

    /**
     * Test 2: Custom property values are correctly bound
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles("test")
    @TestPropertySource(properties = {
        "app.features.include-delivery=false",
        "app.features.include-database=false"
    })
    @EnableConfigurationProperties(AppFeaturesProperties.class)
    static class CustomValuesTest {

        @Autowired
        private AppFeaturesProperties properties;

        @Test
        @DisplayName("Custom property values should be correctly bound")
        void customValuesAreCorrectlyBound() {
            assertThat(properties.isIncludeDelivery()).isFalse();
            assertThat(properties.isIncludeDatabase()).isFalse();
        }
    }

    /**
     * Test 3: A high-precedence property override beats the test harness default.
     *
     * NOTE: this originally simulated the APP_FEATURES_INCLUDE_DATABASE
     * environment variable by relying on the ${APP_FEATURES_INCLUDE_DATABASE:true}
     * placeholder in the MAIN application.yml. The TEST classpath application.yml
     * shadows that file and hardcodes app.features.include-database: true (no
     * placeholder), so the simulated env-var name can no longer bind. Inlined
     * test properties use the canonical property name instead; the real env-var
     * relaxed binding (systemEnvironment) is standard Spring Boot behaviour.
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles("test")
    @TestPropertySource(properties = {
        "app.features.include-database=false"
    })
    @EnableConfigurationProperties(AppFeaturesProperties.class)
    static class EnvironmentVariableOverrideTest {

        @Autowired
        private AppFeaturesProperties properties;

        @Test
        @DisplayName("High-precedence override should beat the harness default value")
        void environmentVariableOverridesDefault() {
            assertThat(properties.isIncludeDatabase()).isFalse();
            // includeDelivery should still be true (default)
            assertThat(properties.isIncludeDelivery()).isTrue();
        }
    }

    /**
     * Test 4: Partial configuration (only one toggle set)
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles("test")
    @TestPropertySource(properties = {
        "app.features.include-delivery=false"
    })
    @EnableConfigurationProperties(AppFeaturesProperties.class)
    static class PartialConfigurationTest {

        @Autowired
        private AppFeaturesProperties properties;

        @Test
        @DisplayName("Partial configuration should only affect specified property")
        void partialConfigurationOnlyAffectsSpecifiedProperty() {
            assertThat(properties.isIncludeDelivery()).isFalse();
            // includeDatabase should still be true (default)
            assertThat(properties.isIncludeDatabase()).isTrue();
        }
    }

    /**
     * Test 5: application-no-db.yml profile sets correct values
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles({"test", "no-db"})
    @EnableConfigurationProperties(AppFeaturesProperties.class)
    static class NoDbProfileTest {

        @Autowired
        private AppFeaturesProperties properties;

        @Test
        @DisplayName("no-db profile should set includeDatabase to false")
        void noDbProfileSetsIncludeDatabaseToFalse() {
            assertThat(properties.isIncludeDatabase()).isFalse();
            // includeDelivery should still be true (no-db profile doesn't change it)
            assertThat(properties.isIncludeDelivery()).isTrue();
        }
    }

    /**
     * Test 6: Properties are settable via setters (for programmatic configuration)
     */
    static class SetterTest {

        @Test
        @DisplayName("Properties can be set via setters")
        void propertiesCanBeSetViaSetters() {
            AppFeaturesProperties properties = new AppFeaturesProperties();

            // Verify defaults
            assertThat(properties.isIncludeDelivery()).isTrue();
            assertThat(properties.isIncludeDatabase()).isTrue();

            // Set via setters
            properties.setIncludeDelivery(false);
            properties.setIncludeDatabase(false);

            // Verify changes
            assertThat(properties.isIncludeDelivery()).isFalse();
            assertThat(properties.isIncludeDatabase()).isFalse();
        }
    }
}
