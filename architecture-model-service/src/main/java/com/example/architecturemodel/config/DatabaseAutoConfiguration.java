package com.example.architecturemodel.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.data.jpa.JpaRepositoriesAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.liquibase.LiquibaseAutoConfiguration;
import org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration;
import org.springframework.context.annotation.Configuration;

/**
 * Database auto-configuration that is conditionally enabled based on feature toggle.
 *
 * <p>Spec 2026-01-19: Disable Database Feature Flag</p>
 *
 * <p>This configuration is only active when {@code app.features.include-database=true}
 * (or not set, as the default is true). When the property is false, Spring Boot's
 * database auto-configurations are excluded by the {@link DatabaseAutoConfigurationImportFilter}
 * early in the startup process, before any beans are created.</p>
 *
 * <h2>How It Works</h2>
 * <p>
 * The {@link DatabaseAutoConfigurationImportFilter} runs during Spring Boot's
 * auto-configuration import phase and conditionally excludes these auto-configurations
 * when {@code app.features.include-database=false}:
 * </p>
 * <ul>
 *   <li>{@link DataSourceAutoConfiguration} - JDBC DataSource (Hikari pool)</li>
 *   <li>{@link HibernateJpaAutoConfiguration} - JPA/Hibernate and EntityManagerFactory</li>
 *   <li>{@link LiquibaseAutoConfiguration} - Database migration</li>
 *   <li>{@link JpaRepositoriesAutoConfiguration} - Spring Data JPA repository scanning</li>
 * </ul>
 *
 * <h2>Usage</h2>
 * <pre>
 * # Command line property
 * java -jar architecture-model-service.jar --app.features.include-database=false
 *
 * # Environment variable
 * APP_FEATURES_INCLUDE_DATABASE=false
 *
 * # Spring profile (sets the property via application-no-db.yml)
 * java -jar architecture-model-service.jar --spring.profiles.active=no-db
 * </pre>
 *
 * <h2>Default Behavior</h2>
 * <p>
 * When the property is true or not set (default), this configuration class is active
 * and all database auto-configurations run normally, enabling full database connectivity.
 * </p>
 *
 * @see DatabaseAutoConfigurationImportFilter
 * @see AppFeaturesProperties
 */
@Configuration
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class DatabaseAutoConfiguration {

    /**
     * This configuration class serves as a marker bean to indicate database is enabled.
     *
     * <p>When this configuration is active ({@code includeDatabase=true}), all standard
     * Spring Boot database auto-configurations will run normally.</p>
     *
     * <p>When this configuration is NOT active ({@code includeDatabase=false}), the
     * {@link DatabaseAutoConfigurationImportFilter} excludes the following auto-configurations
     * during the import phase:</p>
     * <ul>
     *   <li>DataSourceAutoConfiguration</li>
     *   <li>HibernateJpaAutoConfiguration</li>
     *   <li>LiquibaseAutoConfiguration</li>
     *   <li>JpaRepositoriesAutoConfiguration</li>
     * </ul>
     *
     * <p>This ensures no database connections are attempted in no-db mode.</p>
     */
}
