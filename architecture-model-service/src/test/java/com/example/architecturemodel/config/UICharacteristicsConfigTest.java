package com.example.architecturemodel.config;

import com.example.architecturemodel.controller.BootstrapController;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.junit.jupiter.SpringExtension;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for UI Characteristics configuration properties and bootstrap endpoint.
 *
 * Spec 2026-01-20: UI Characteristics
 * Task Group 3: Bootstrap Configuration
 *
 * Tests verify:
 * - AppFeaturesProperties parses uiCharacteristicsUiCapabilityKeys property
 * - AppFeaturesProperties parses uiCharacteristicsInteractionComplexityKeys property
 * - AppFeaturesProperties parses uiCharacteristicsTechnicalShapeKeys property
 * - BootstrapController includes key suggestion lists in response
 */
class UICharacteristicsConfigTest {

    /**
     * Test 1: AppFeaturesProperties parses uiCharacteristicsUiCapabilityKeys property
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles("test")
    @TestPropertySource(properties = {
        "app.features.ui-characteristics-ui-capability-keys=Search|Filter|Sort|Pagination"
    })
    @EnableConfigurationProperties(AppFeaturesProperties.class)
    static class UiCapabilityKeysParsingTest {

        @Autowired
        private AppFeaturesProperties properties;

        @Test
        @DisplayName("AppFeaturesProperties parses uiCharacteristicsUiCapabilityKeys property")
        void parsesUiCapabilityKeysProperty() {
            assertThat(properties.getUiCharacteristicsUiCapabilityKeys())
                .isEqualTo("Search|Filter|Sort|Pagination");
        }
    }

    /**
     * Test 2: AppFeaturesProperties parses uiCharacteristicsInteractionComplexityKeys property
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles("test")
    @TestPropertySource(properties = {
        "app.features.ui-characteristics-interaction-complexity-keys=Simple|Moderate|Complex|Expert"
    })
    @EnableConfigurationProperties(AppFeaturesProperties.class)
    static class InteractionComplexityKeysParsingTest {

        @Autowired
        private AppFeaturesProperties properties;

        @Test
        @DisplayName("AppFeaturesProperties parses uiCharacteristicsInteractionComplexityKeys property")
        void parsesInteractionComplexityKeysProperty() {
            assertThat(properties.getUiCharacteristicsInteractionComplexityKeys())
                .isEqualTo("Simple|Moderate|Complex|Expert");
        }
    }

    /**
     * Test 3: AppFeaturesProperties parses uiCharacteristicsTechnicalShapeKeys property
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles("test")
    @TestPropertySource(properties = {
        "app.features.ui-characteristics-technical-shape-keys=SPA|MPA|PWA|Hybrid"
    })
    @EnableConfigurationProperties(AppFeaturesProperties.class)
    static class TechnicalShapeKeysParsingTest {

        @Autowired
        private AppFeaturesProperties properties;

        @Test
        @DisplayName("AppFeaturesProperties parses uiCharacteristicsTechnicalShapeKeys property")
        void parsesTechnicalShapeKeysProperty() {
            assertThat(properties.getUiCharacteristicsTechnicalShapeKeys())
                .isEqualTo("SPA|MPA|PWA|Hybrid");
        }
    }

    /**
     * Test 4: BootstrapController includes key suggestion lists in response
     */
    @WebMvcTest(BootstrapController.class)
    static class BootstrapControllerKeySuggestionsTest {

        @Autowired
        private MockMvc mockMvc;

        @MockBean
        private AppFeaturesProperties appFeaturesProperties;

        @Test
        @DisplayName("GET /api/bootstrap returns UI Characteristics key suggestion lists")
        void bootstrapEndpointIncludesKeySuggestionLists() throws Exception {
            when(appFeaturesProperties.isIncludeDelivery()).thenReturn(true);
            when(appFeaturesProperties.isIncludeDatabase()).thenReturn(true);
            when(appFeaturesProperties.getUiCharacteristicsUiCapabilityKeys())
                .thenReturn("Search|Filter|Sort");
            when(appFeaturesProperties.getUiCharacteristicsInteractionComplexityKeys())
                .thenReturn("Simple|Moderate|Complex");
            when(appFeaturesProperties.getUiCharacteristicsTechnicalShapeKeys())
                .thenReturn("SPA|MPA|PWA");

            mockMvc.perform(get("/api/bootstrap")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.ui_characteristics_ui_capability_keys").value("Search|Filter|Sort"))
                .andExpect(jsonPath("$.ui_characteristics_interaction_complexity_keys").value("Simple|Moderate|Complex"))
                .andExpect(jsonPath("$.ui_characteristics_technical_shape_keys").value("SPA|MPA|PWA"));
        }

        @Test
        @DisplayName("GET /api/bootstrap returns empty strings for unconfigured key suggestions")
        void bootstrapEndpointReturnsEmptyStringsForUnconfiguredKeys() throws Exception {
            when(appFeaturesProperties.isIncludeDelivery()).thenReturn(true);
            when(appFeaturesProperties.isIncludeDatabase()).thenReturn(true);
            when(appFeaturesProperties.getUiCharacteristicsUiCapabilityKeys()).thenReturn("");
            when(appFeaturesProperties.getUiCharacteristicsInteractionComplexityKeys()).thenReturn("");
            when(appFeaturesProperties.getUiCharacteristicsTechnicalShapeKeys()).thenReturn("");

            mockMvc.perform(get("/api/bootstrap")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.ui_characteristics_ui_capability_keys").value(""))
                .andExpect(jsonPath("$.ui_characteristics_interaction_complexity_keys").value(""))
                .andExpect(jsonPath("$.ui_characteristics_technical_shape_keys").value(""));
        }
    }

    /**
     * Test 5: Properties have default empty string values
     */
    static class DefaultValuesTest {

        @Test
        @DisplayName("UI Characteristics key properties default to empty strings")
        void propertiesDefaultToEmptyStrings() {
            AppFeaturesProperties properties = new AppFeaturesProperties();

            assertThat(properties.getUiCharacteristicsUiCapabilityKeys()).isEqualTo("");
            assertThat(properties.getUiCharacteristicsInteractionComplexityKeys()).isEqualTo("");
            assertThat(properties.getUiCharacteristicsTechnicalShapeKeys()).isEqualTo("");
        }

        @Test
        @DisplayName("UI Characteristics key properties can be set via setters")
        void propertiesCanBeSetViaSetters() {
            AppFeaturesProperties properties = new AppFeaturesProperties();

            properties.setUiCharacteristicsUiCapabilityKeys("Search|Filter");
            properties.setUiCharacteristicsInteractionComplexityKeys("Simple|Complex");
            properties.setUiCharacteristicsTechnicalShapeKeys("SPA|MPA");

            assertThat(properties.getUiCharacteristicsUiCapabilityKeys()).isEqualTo("Search|Filter");
            assertThat(properties.getUiCharacteristicsInteractionComplexityKeys()).isEqualTo("Simple|Complex");
            assertThat(properties.getUiCharacteristicsTechnicalShapeKeys()).isEqualTo("SPA|MPA");
        }
    }
}
