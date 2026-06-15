package com.example.architecturemodel.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Configuration properties for application feature toggles.
 *
 * Spec 2026-01-19: Startup Configuration for Feature Toggles
 *
 * These properties allow the application to run in different modes:
 * - Full mode (default): both toggles true
 * - Architecture-only mode: includeDelivery = false
 * - File-only mode: includeDatabase = false
 *
 * Spec 2026-01-20: UI Characteristics
 * - uiCharacteristicsUiCapabilityKeys: pipe-delimited autocomplete suggestions for UI Capability type
 * - uiCharacteristicsInteractionComplexityKeys: pipe-delimited autocomplete suggestions for Interaction Complexity type
 * - uiCharacteristicsTechnicalShapeKeys: pipe-delimited autocomplete suggestions for Technical Shape type
 *
 * Properties can be configured via:
 * - application.yml
 * - Environment variables (APP_FEATURES_INCLUDE_DELIVERY, APP_FEATURES_INCLUDE_DATABASE)
 * - Command-line arguments (--app.features.include-delivery=false)
 * - Spring profiles (--spring.profiles.active=no-db)
 */
@ConfigurationProperties(prefix = "app.features")
@Validated
public class AppFeaturesProperties {

    /**
     * Whether to include delivery features (roadmap, backlog, work items).
     * Default: true
     */
    private boolean includeDelivery = true;

    /**
     * Whether to include database connectivity.
     * When false, the application runs in file-only mode without requiring PostgreSQL.
     * Default: true
     */
    private boolean includeDatabase = true;

    /**
     * Pipe-delimited autocomplete suggestions for UI Characteristics with type 'ui_capability'.
     * Example: "Search|Filter|Sort|Pagination"
     * Default: empty string (no suggestions)
     *
     * Spec 2026-01-20: UI Characteristics
     */
    private String uiCharacteristicsUiCapabilityKeys = "";

    /**
     * Pipe-delimited autocomplete suggestions for UI Characteristics with type 'interaction_complexity'.
     * Example: "Simple|Moderate|Complex|Expert"
     * Default: empty string (no suggestions)
     *
     * Spec 2026-01-20: UI Characteristics
     */
    private String uiCharacteristicsInteractionComplexityKeys = "";

    /**
     * Pipe-delimited autocomplete suggestions for UI Characteristics with type 'technical_shape'.
     * Example: "SPA|MPA|PWA|Hybrid"
     * Default: empty string (no suggestions)
     *
     * Spec 2026-01-20: UI Characteristics
     */
    private String uiCharacteristicsTechnicalShapeKeys = "";

    public boolean isIncludeDelivery() {
        return includeDelivery;
    }

    public void setIncludeDelivery(boolean includeDelivery) {
        this.includeDelivery = includeDelivery;
    }

    public boolean isIncludeDatabase() {
        return includeDatabase;
    }

    public void setIncludeDatabase(boolean includeDatabase) {
        this.includeDatabase = includeDatabase;
    }

    public String getUiCharacteristicsUiCapabilityKeys() {
        return uiCharacteristicsUiCapabilityKeys;
    }

    public void setUiCharacteristicsUiCapabilityKeys(String uiCharacteristicsUiCapabilityKeys) {
        this.uiCharacteristicsUiCapabilityKeys = uiCharacteristicsUiCapabilityKeys;
    }

    public String getUiCharacteristicsInteractionComplexityKeys() {
        return uiCharacteristicsInteractionComplexityKeys;
    }

    public void setUiCharacteristicsInteractionComplexityKeys(String uiCharacteristicsInteractionComplexityKeys) {
        this.uiCharacteristicsInteractionComplexityKeys = uiCharacteristicsInteractionComplexityKeys;
    }

    public String getUiCharacteristicsTechnicalShapeKeys() {
        return uiCharacteristicsTechnicalShapeKeys;
    }

    public void setUiCharacteristicsTechnicalShapeKeys(String uiCharacteristicsTechnicalShapeKeys) {
        this.uiCharacteristicsTechnicalShapeKeys = uiCharacteristicsTechnicalShapeKeys;
    }
}
