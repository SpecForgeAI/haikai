package com.example.architecturemodel.controller;

import com.example.architecturemodel.config.AppFeaturesProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for BootstrapController.
 *
 * Spec 2026-01-19: Bootstrap Endpoint for Feature Toggles
 * Spec 2026-01-20: UI Characteristics Key Suggestions
 *
 * Note: JSON property names use snake_case due to Jackson SNAKE_CASE naming strategy
 * configured in application.yml. Test assertions must match the actual runtime JSON structure.
 */
@WebMvcTest(BootstrapController.class)
class BootstrapControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private AppFeaturesProperties appFeaturesProperties;

    /**
     * Helper method to set up default mock values for all AppFeaturesProperties getters.
     * This ensures tests don't fail due to missing mock configurations for new properties.
     */
    private void setupDefaultMocks() {
        when(appFeaturesProperties.isIncludeDelivery()).thenReturn(true);
        when(appFeaturesProperties.isIncludeDatabase()).thenReturn(true);
        when(appFeaturesProperties.getUiCharacteristicsUiCapabilityKeys()).thenReturn("");
        when(appFeaturesProperties.getUiCharacteristicsInteractionComplexityKeys()).thenReturn("");
        when(appFeaturesProperties.getUiCharacteristicsTechnicalShapeKeys()).thenReturn("");
    }

    @Test
    @DisplayName("GET /api/bootstrap returns 200 OK with correct JSON structure")
    void testBootstrapEndpointReturns200WithCorrectStructure() throws Exception {
        setupDefaultMocks();

        mockMvc.perform(get("/api/bootstrap")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.include_delivery").exists())
            .andExpect(jsonPath("$.include_database").exists())
            .andExpect(jsonPath("$.include_delivery").isBoolean())
            .andExpect(jsonPath("$.include_database").isBoolean());
    }

    @Test
    @DisplayName("GET /api/bootstrap returns correct includeDelivery value from AppFeaturesProperties")
    void testBootstrapEndpointReturnsCorrectIncludeDeliveryValue() throws Exception {
        // Test with includeDelivery = false
        setupDefaultMocks();
        when(appFeaturesProperties.isIncludeDelivery()).thenReturn(false);

        mockMvc.perform(get("/api/bootstrap")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.include_delivery").value(false))
            .andExpect(jsonPath("$.include_database").value(true));

        // Test with includeDelivery = true
        when(appFeaturesProperties.isIncludeDelivery()).thenReturn(true);

        mockMvc.perform(get("/api/bootstrap")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.include_delivery").value(true));
    }

    @Test
    @DisplayName("GET /api/bootstrap returns correct includeDatabase value from AppFeaturesProperties")
    void testBootstrapEndpointReturnsCorrectIncludeDatabaseValue() throws Exception {
        // Test with includeDatabase = false
        setupDefaultMocks();
        when(appFeaturesProperties.isIncludeDatabase()).thenReturn(false);

        mockMvc.perform(get("/api/bootstrap")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.include_delivery").value(true))
            .andExpect(jsonPath("$.include_database").value(false));

        // Test with includeDatabase = true
        when(appFeaturesProperties.isIncludeDatabase()).thenReturn(true);

        mockMvc.perform(get("/api/bootstrap")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.include_database").value(true));
    }

    @Test
    @DisplayName("GET /api/bootstrap is accessible without authentication")
    void testBootstrapEndpointIsAccessibleWithoutAuth() throws Exception {
        setupDefaultMocks();

        // Simply making a request without any auth headers should succeed
        mockMvc.perform(get("/api/bootstrap"))
            .andExpect(status().isOk());
    }

    // ============================================================================
    // Spec 2026-01-20: UI Characteristics Key Suggestions Tests (Task Group 2.1)
    // ============================================================================

    @Test
    @DisplayName("GET /api/bootstrap returns uiCharacteristicsUiCapabilityKeys with default values")
    void testBootstrapEndpointReturnsUiCapabilityKeysDefaults() throws Exception {
        // Setup mocks with the expected default pipe-delimited values
        setupDefaultMocks();
        String defaultUiCapabilityKeys = "search|filter|sort|pagination|export|import|bulk_action|create|edit|delete|view|download";
        when(appFeaturesProperties.getUiCharacteristicsUiCapabilityKeys()).thenReturn(defaultUiCapabilityKeys);

        mockMvc.perform(get("/api/bootstrap")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.ui_characteristics_ui_capability_keys").exists())
            .andExpect(jsonPath("$.ui_characteristics_ui_capability_keys").isString())
            .andExpect(jsonPath("$.ui_characteristics_ui_capability_keys").value(defaultUiCapabilityKeys));
    }

    @Test
    @DisplayName("GET /api/bootstrap returns uiCharacteristicsInteractionComplexityKeys with default values")
    void testBootstrapEndpointReturnsInteractionComplexityKeysDefaults() throws Exception {
        // Setup mocks with the expected default pipe-delimited values
        setupDefaultMocks();
        String defaultInteractionComplexityKeys = "simple|moderate|complex|expert";
        when(appFeaturesProperties.getUiCharacteristicsInteractionComplexityKeys()).thenReturn(defaultInteractionComplexityKeys);

        mockMvc.perform(get("/api/bootstrap")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.ui_characteristics_interaction_complexity_keys").exists())
            .andExpect(jsonPath("$.ui_characteristics_interaction_complexity_keys").isString())
            .andExpect(jsonPath("$.ui_characteristics_interaction_complexity_keys").value(defaultInteractionComplexityKeys));
    }

    @Test
    @DisplayName("GET /api/bootstrap returns uiCharacteristicsTechnicalShapeKeys with default values")
    void testBootstrapEndpointReturnsTechnicalShapeKeysDefaults() throws Exception {
        // Setup mocks with the expected default pipe-delimited values
        setupDefaultMocks();
        String defaultTechnicalShapeKeys = "form|table|dashboard|wizard|modal|drawer|list|card|chart|report";
        when(appFeaturesProperties.getUiCharacteristicsTechnicalShapeKeys()).thenReturn(defaultTechnicalShapeKeys);

        mockMvc.perform(get("/api/bootstrap")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.ui_characteristics_technical_shape_keys").exists())
            .andExpect(jsonPath("$.ui_characteristics_technical_shape_keys").isString())
            .andExpect(jsonPath("$.ui_characteristics_technical_shape_keys").value(defaultTechnicalShapeKeys));
    }
}
