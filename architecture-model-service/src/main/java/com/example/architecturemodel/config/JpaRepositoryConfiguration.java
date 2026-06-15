package com.example.architecturemodel.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * JPA Repository configuration that is conditionally enabled based on feature toggle.
 *
 * Spec 2026-01-19: Startup Configuration for Feature Toggles
 * Task 2.3: Mark repository beans as conditional
 *
 * This configuration conditionally enables JPA repository scanning only when
 * app.features.include-database=true (or not set, defaulting to true).
 *
 * When includeDatabase=false:
 * - This configuration class is NOT loaded
 * - JPA repositories are NOT scanned or instantiated
 * - No repository beans are registered in the application context
 *
 * This approach is cleaner than annotating each repository interface individually,
 * as repository interfaces cannot have @ConditionalOnProperty annotations.
 */
@Configuration
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@EnableJpaRepositories(basePackages = "com.example.architecturemodel.repository")
public class JpaRepositoryConfiguration {
    // Configuration class for conditional JPA repository scanning
}
