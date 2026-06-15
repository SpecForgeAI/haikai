package com.example.architecturemodel.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurationMetadata;
import org.springframework.core.env.Environment;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * Unit tests for DatabaseAutoConfigurationImportFilter.
 *
 * Spec 2026-01-19: Fix db-disabled.yml Activation
 * Task Group 1.1: Unit tests for the AutoConfigurationImportFilter
 *
 * Tests verify:
 * - Filter excludes database auto-configurations when include-database=false
 * - Filter allows all auto-configurations when include-database=true
 * - Filter allows all auto-configurations when property is not set (default behavior)
 * - Filter handles null/empty configuration class names gracefully
 */
class DatabaseAutoConfigurationImportFilterTest {

    private static final String DATA_SOURCE_AUTO_CONFIG =
        "org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration";
    private static final String HIBERNATE_JPA_AUTO_CONFIG =
        "org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration";
    private static final String LIQUIBASE_AUTO_CONFIG =
        "org.springframework.boot.autoconfigure.liquibase.LiquibaseAutoConfiguration";
    private static final String JPA_REPOSITORIES_AUTO_CONFIG =
        "org.springframework.boot.autoconfigure.data.jpa.JpaRepositoriesAutoConfiguration";
    private static final String WEB_MVC_AUTO_CONFIG =
        "org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration";

    @Test
    @DisplayName("Filter should exclude DataSourceAutoConfiguration when include-database=false")
    void filterExcludesDataSourceWhenIncludeDatabaseFalse() {
        // Given
        MockEnvironment environment = new MockEnvironment();
        environment.setProperty("app.features.include-database", "false");

        DatabaseAutoConfigurationImportFilter filter = new DatabaseAutoConfigurationImportFilter();
        filter.setEnvironment(environment);

        String[] autoConfigurations = {DATA_SOURCE_AUTO_CONFIG, WEB_MVC_AUTO_CONFIG};
        AutoConfigurationMetadata metadata = mock(AutoConfigurationMetadata.class);

        // When
        boolean[] matches = filter.match(autoConfigurations, metadata);

        // Then
        assertThat(matches[0]).as("DataSourceAutoConfiguration should be excluded").isFalse();
        assertThat(matches[1]).as("WebMvcAutoConfiguration should be included").isTrue();
    }

    @Test
    @DisplayName("Filter should exclude HibernateJpaAutoConfiguration when include-database=false")
    void filterExcludesHibernateJpaWhenIncludeDatabaseFalse() {
        // Given
        MockEnvironment environment = new MockEnvironment();
        environment.setProperty("app.features.include-database", "false");

        DatabaseAutoConfigurationImportFilter filter = new DatabaseAutoConfigurationImportFilter();
        filter.setEnvironment(environment);

        String[] autoConfigurations = {HIBERNATE_JPA_AUTO_CONFIG, WEB_MVC_AUTO_CONFIG};
        AutoConfigurationMetadata metadata = mock(AutoConfigurationMetadata.class);

        // When
        boolean[] matches = filter.match(autoConfigurations, metadata);

        // Then
        assertThat(matches[0]).as("HibernateJpaAutoConfiguration should be excluded").isFalse();
        assertThat(matches[1]).as("WebMvcAutoConfiguration should be included").isTrue();
    }

    @Test
    @DisplayName("Filter should exclude all database auto-configurations when include-database=false")
    void filterExcludesAllDatabaseAutoConfigsWhenIncludeDatabaseFalse() {
        // Given
        MockEnvironment environment = new MockEnvironment();
        environment.setProperty("app.features.include-database", "false");

        DatabaseAutoConfigurationImportFilter filter = new DatabaseAutoConfigurationImportFilter();
        filter.setEnvironment(environment);

        String[] autoConfigurations = {
            DATA_SOURCE_AUTO_CONFIG,
            HIBERNATE_JPA_AUTO_CONFIG,
            LIQUIBASE_AUTO_CONFIG,
            JPA_REPOSITORIES_AUTO_CONFIG,
            WEB_MVC_AUTO_CONFIG
        };
        AutoConfigurationMetadata metadata = mock(AutoConfigurationMetadata.class);

        // When
        boolean[] matches = filter.match(autoConfigurations, metadata);

        // Then
        assertThat(matches[0]).as("DataSourceAutoConfiguration should be excluded").isFalse();
        assertThat(matches[1]).as("HibernateJpaAutoConfiguration should be excluded").isFalse();
        assertThat(matches[2]).as("LiquibaseAutoConfiguration should be excluded").isFalse();
        assertThat(matches[3]).as("JpaRepositoriesAutoConfiguration should be excluded").isFalse();
        assertThat(matches[4]).as("WebMvcAutoConfiguration should be included").isTrue();
    }

    @Test
    @DisplayName("Filter should allow all auto-configurations when include-database=true")
    void filterAllowsAllWhenIncludeDatabaseTrue() {
        // Given
        MockEnvironment environment = new MockEnvironment();
        environment.setProperty("app.features.include-database", "true");

        DatabaseAutoConfigurationImportFilter filter = new DatabaseAutoConfigurationImportFilter();
        filter.setEnvironment(environment);

        String[] autoConfigurations = {
            DATA_SOURCE_AUTO_CONFIG,
            HIBERNATE_JPA_AUTO_CONFIG,
            LIQUIBASE_AUTO_CONFIG,
            JPA_REPOSITORIES_AUTO_CONFIG,
            WEB_MVC_AUTO_CONFIG
        };
        AutoConfigurationMetadata metadata = mock(AutoConfigurationMetadata.class);

        // When
        boolean[] matches = filter.match(autoConfigurations, metadata);

        // Then
        for (int i = 0; i < matches.length; i++) {
            assertThat(matches[i])
                .as("Auto-configuration " + autoConfigurations[i] + " should be included when include-database=true")
                .isTrue();
        }
    }

    @Test
    @DisplayName("Filter should allow all auto-configurations when property is not set (default behavior)")
    void filterAllowsAllWhenPropertyNotSet() {
        // Given - environment with no property set
        MockEnvironment environment = new MockEnvironment();
        // Not setting app.features.include-database at all

        DatabaseAutoConfigurationImportFilter filter = new DatabaseAutoConfigurationImportFilter();
        filter.setEnvironment(environment);

        String[] autoConfigurations = {
            DATA_SOURCE_AUTO_CONFIG,
            HIBERNATE_JPA_AUTO_CONFIG,
            LIQUIBASE_AUTO_CONFIG,
            JPA_REPOSITORIES_AUTO_CONFIG,
            WEB_MVC_AUTO_CONFIG
        };
        AutoConfigurationMetadata metadata = mock(AutoConfigurationMetadata.class);

        // When
        boolean[] matches = filter.match(autoConfigurations, metadata);

        // Then - all should be included (default is database enabled)
        for (int i = 0; i < matches.length; i++) {
            assertThat(matches[i])
                .as("Auto-configuration " + autoConfigurations[i] + " should be included when property not set")
                .isTrue();
        }
    }

    @Test
    @DisplayName("Filter should handle null and empty configuration class names gracefully")
    void filterHandlesNullAndEmptyClassNamesGracefully() {
        // Given
        MockEnvironment environment = new MockEnvironment();
        environment.setProperty("app.features.include-database", "false");

        DatabaseAutoConfigurationImportFilter filter = new DatabaseAutoConfigurationImportFilter();
        filter.setEnvironment(environment);

        String[] autoConfigurations = {null, "", DATA_SOURCE_AUTO_CONFIG, WEB_MVC_AUTO_CONFIG};
        AutoConfigurationMetadata metadata = mock(AutoConfigurationMetadata.class);

        // When
        boolean[] matches = filter.match(autoConfigurations, metadata);

        // Then - null and empty should be treated as "include" (not filtered out)
        assertThat(matches[0]).as("null should be included (not filtered)").isTrue();
        assertThat(matches[1]).as("empty string should be included (not filtered)").isTrue();
        assertThat(matches[2]).as("DataSourceAutoConfiguration should be excluded").isFalse();
        assertThat(matches[3]).as("WebMvcAutoConfiguration should be included").isTrue();
    }
}
