package com.example.architecturemodel.controller;

import com.example.architecturemodel.config.AppFeaturesProperties;
import com.example.architecturemodel.model.dto.BootstrapResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST Controller for Bootstrap configuration endpoint.
 *
 * Exposes feature toggle configuration to the frontend via a public API endpoint.
 * This endpoint must always be available regardless of feature toggle values,
 * therefore DO NOT use @ConditionalOnProperty annotation.
 *
 * No authentication required - endpoint is public.
 *
 * Spec 2026-01-19: Bootstrap Endpoint for Feature Toggles
 * Spec 2026-01-20: UI Characteristics - Added key suggestion lists for autocomplete
 */
@RestController
@RequestMapping("/api/bootstrap")
@Slf4j
public class BootstrapController {

    private final AppFeaturesProperties appFeaturesProperties;

    public BootstrapController(AppFeaturesProperties appFeaturesProperties) {
        this.appFeaturesProperties = appFeaturesProperties;
    }

    /**
     * Returns the application feature toggle configuration.
     *
     * GET /api/bootstrap
     *
     * @return ResponseEntity with BootstrapResponse containing feature toggle values
     *         and UI Characteristics key suggestion lists
     */
    @GetMapping
    public ResponseEntity<BootstrapResponse> getBootstrapConfig() {
        log.debug("GET /api/bootstrap - Returning feature toggle configuration");

        BootstrapResponse response = new BootstrapResponse(
            appFeaturesProperties.isIncludeDelivery(),
            appFeaturesProperties.isIncludeDatabase(),
            appFeaturesProperties.getUiCharacteristicsUiCapabilityKeys(),
            appFeaturesProperties.getUiCharacteristicsInteractionComplexityKeys(),
            appFeaturesProperties.getUiCharacteristicsTechnicalShapeKeys()
        );

        log.info("GET /api/bootstrap isIncludeDelivery=" + appFeaturesProperties.isIncludeDelivery() + ", isIncludeDatabase=" + appFeaturesProperties.isIncludeDatabase());

        return ResponseEntity.ok(response);
    }
}
