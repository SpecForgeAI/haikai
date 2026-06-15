package com.example.architecturemodel.model.dto;

/**
 * Response DTO for bootstrap endpoint.
 *
 * Returns feature toggle configuration to the frontend.
 * Uses Java record for immutable, clean data transfer.
 *
 * Spec 2026-01-19: Bootstrap Endpoint for Feature Toggles
 * Spec 2026-01-20: UI Characteristics - Added key suggestion lists for autocomplete
 */
public record BootstrapResponse(
    boolean includeDelivery,
    boolean includeDatabase,
    String uiCharacteristicsUiCapabilityKeys,
    String uiCharacteristicsInteractionComplexityKeys,
    String uiCharacteristicsTechnicalShapeKeys
) {
}
