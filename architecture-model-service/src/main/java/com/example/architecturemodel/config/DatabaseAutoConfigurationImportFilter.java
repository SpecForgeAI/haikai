package com.example.architecturemodel.config;

import org.springframework.boot.autoconfigure.AutoConfigurationImportFilter;
import org.springframework.boot.autoconfigure.AutoConfigurationMetadata;
import org.springframework.context.EnvironmentAware;
import org.springframework.core.env.Environment;

import java.util.Set;

/**
 * Filter that conditionally excludes database auto-configurations based on a property.
 *
 * <p>This filter implements the {@link AutoConfigurationImportFilter} interface to
 * exclude database-related auto-configurations early in the Spring Boot startup process,
 * before any beans are created. This is more effective than using
 * {@code spring.autoconfigure.exclude} in YAML because it runs during the auto-configuration
 * import phase.</p>
 *
 * <h2>Property</h2>
 * <p>The filter reads the {@code app.features.include-database} property:</p>
 * <ul>
 *   <li>{@code false} - Excludes all database auto-configurations</li>
 *   <li>{@code true} or not set - Allows all auto-configurations (database enabled)</li>
 * </ul>
 *
 * <h2>Excluded Auto-Configurations</h2>
 * <p>When {@code app.features.include-database=false}, the following are excluded:</p>
 * <ul>
 *   <li>{@code DataSourceAutoConfiguration} - JDBC DataSource (Hikari pool)</li>
 *   <li>{@code HibernateJpaAutoConfiguration} - JPA/Hibernate and EntityManagerFactory</li>
 *   <li>{@code LiquibaseAutoConfiguration} - Database migration</li>
 *   <li>{@code JpaRepositoriesAutoConfiguration} - Spring Data JPA repository scanning</li>
 * </ul>
 *
 * <h2>Registration</h2>
 * <p>This filter is registered in {@code META-INF/spring.factories} under the
 * {@code AutoConfigurationImportFilter} key.</p>
 *
 * <h2>Usage</h2>
 * <pre>
 * # Command line
 * java -jar architecture-model-service.jar --app.features.include-database=false
 *
 * # Environment variable
 * APP_FEATURES_INCLUDE_DATABASE=false
 *
 * # Spring profile (sets the property)
 * java -jar architecture-model-service.jar --spring.profiles.active=no-db
 * </pre>
 *
 * @see DatabaseAutoConfiguration
 * @see AppFeaturesProperties
 */
public class DatabaseAutoConfigurationImportFilter implements AutoConfigurationImportFilter, EnvironmentAware {

    private static final String PROPERTY_NAME = "app.features.include-database";

    /**
     * Set of fully-qualified class names for database auto-configurations to exclude
     * when the include-database property is false.
     */
    private static final Set<String> DATABASE_AUTO_CONFIGURATIONS = Set.of(
        "org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration",
        "org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration",
        "org.springframework.boot.autoconfigure.liquibase.LiquibaseAutoConfiguration",
        "org.springframework.boot.autoconfigure.data.jpa.JpaRepositoriesAutoConfiguration"
    );

    private Environment environment;

    @Override
    public void setEnvironment(Environment environment) {
        this.environment = environment;
    }

    /**
     * Determines which auto-configurations should be included.
     *
     * <p>When {@code app.features.include-database=false}, database auto-configurations
     * are filtered out (return false). When the property is true or not set,
     * all auto-configurations are included (return true).</p>
     *
     * @param autoConfigurationClasses the auto-configuration class names to evaluate
     * @param autoConfigurationMetadata metadata for the auto-configurations
     * @return an array of booleans indicating whether each auto-configuration should be included
     */
    @Override
    public boolean[] match(String[] autoConfigurationClasses, AutoConfigurationMetadata autoConfigurationMetadata) {
        boolean[] matches = new boolean[autoConfigurationClasses.length];

        // Check if database should be included (default: true)
        boolean includeDatabaseEnabled = isIncludeDatabaseEnabled();

        for (int i = 0; i < autoConfigurationClasses.length; i++) {
            String className = autoConfigurationClasses[i];

            if (includeDatabaseEnabled) {
                // Database is enabled, include all auto-configurations
                matches[i] = true;
            } else {
                // Database is disabled, exclude database auto-configurations
                matches[i] = !shouldExclude(className);
            }
        }

        return matches;
    }

    /**
     * Checks if the include-database feature is enabled.
     *
     * @return true if include-database is true or not set (default), false otherwise
     */
    private boolean isIncludeDatabaseEnabled() {
        if (environment == null) {
            return true; // Default to enabled if environment not available
        }

        String propertyValue = environment.getProperty(PROPERTY_NAME);

        // If property is not set, default to true (database enabled)
        if (propertyValue == null) {
            return true;
        }

        // Only disable database when explicitly set to "false"
        return !"false".equalsIgnoreCase(propertyValue.trim());
    }

    /**
     * Determines if the given auto-configuration class should be excluded.
     *
     * @param className the fully-qualified class name of the auto-configuration
     * @return true if the class should be excluded, false otherwise
     */
    private boolean shouldExclude(String className) {
        if (className == null || className.isEmpty()) {
            return false; // Don't exclude null or empty class names
        }
        return DATABASE_AUTO_CONFIGURATIONS.contains(className);
    }
}
