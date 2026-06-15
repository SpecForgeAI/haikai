package com.example.architecturemodel.config;

import com.example.architecturemodel.service.TypedContentMigrationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * Configuration class that runs data migrations on application startup.
 *
 * This runner executes the TypedContentMigrationService to migrate existing
 * sequence_* table data into the diagrams.typed_content_json column.
 *
 * The migration is idempotent - it only processes diagrams with NULL typed_content_json,
 * so it is safe to run multiple times.
 *
 * Migration can be disabled by setting the property:
 * migration.typed-content.enabled=false
 *
 * This entire configuration is only active when database is enabled
 * (app.features.include-database=true or not set). When database is disabled,
 * this bean is not created, preventing UnsatisfiedDependencyException for
 * TypedContentMigrationService dependency.
 *
 * Spec 2026-01-19: Disable Database Feature Flag
 */
@Configuration
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class MigrationRunner {

    private final TypedContentMigrationService typedContentMigrationService;
    private final Environment environment;

    /**
     * CommandLineRunner that executes typed content migration on startup.
     *
     * The migration:
     * - Finds all Sequence diagrams with NULL typed_content_json
     * - Migrates data from sequence_* tables OR creates default empty content
     * - Logs counts of migrated and defaulted diagrams
     *
     * @return CommandLineRunner bean
     */
    @Bean
    public CommandLineRunner typedContentMigrationRunner() {
        return args -> {
            // Check if migration is enabled (default: true)
            String enabledProperty = environment.getProperty("migration.typed-content.enabled", "true");
            boolean migrationEnabled = Boolean.parseBoolean(enabledProperty);

            if (!migrationEnabled) {
                log.info("Typed content migration is disabled via configuration");
                return;
            }

            log.info("Running typed content migration on startup...");

            try {
                TypedContentMigrationService.MigrationResult result =
                    typedContentMigrationService.migrateSequenceDiagrams();

                if (result.totalCount() > 0) {
                    log.info("Typed content migration completed successfully: {} migrated, {} defaulted (total: {})",
                        result.migratedCount(), result.defaultedCount(), result.totalCount());
                } else {
                    log.info("Typed content migration completed: no diagrams needed migration");
                }
            } catch (Exception e) {
                log.error("Typed content migration failed: {}", e.getMessage(), e);
                // Don't fail application startup - migration failure is not fatal
                // The migration can be retried on next startup
            }
        };
    }
}
