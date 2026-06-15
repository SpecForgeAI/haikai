package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.entity.UICharacteristicDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for UI Characteristics feature.
 *
 * Spec 2026-01-20: UI Characteristics Entity
 * Task Group 5: Integration Testing and Gap Analysis
 *
 * These tests verify end-to-end scenarios that span multiple layers:
 * - File export/import with ui_characteristics JSON structure
 * - Backward compatibility for models without ui_characteristics
 * - Complete serialization/deserialization round-trips
 */
class UICharacteristicIntegrationTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    // ============================================================================
    // Test 1: File Export - Export model with ui_characteristics JSON structure
    // Verifies that ui_characteristics are correctly included in exported JSON
    // ============================================================================

    @Test
    @DisplayName("File export includes ui_characteristics with correct JSON structure")
    void testFileExportIncludesUICharacteristicsWithCorrectJsonStructure() throws Exception {
        // Given: A model with UI characteristics of different types
        UICharacteristicDto char1 = new UICharacteristicDto(
            "ui-char-1",
            "app-point-123",
            "business_feature",
            "order_management",
            "Order Management Feature",
            "Allows users to create and manage orders",
            "Based on business requirements doc BR-001"
        );

        UICharacteristicDto char2 = new UICharacteristicDto(
            "ui-char-2",
            "app-point-456",
            "ui_capability",
            "search",
            "Advanced Search",
            "Supports full-text search",
            null
        );

        UICharacteristicDto char3 = new UICharacteristicDto(
            "ui-char-3",
            "app-point-789",
            "interaction_complexity",
            "moderate",
            "Moderate Complexity Workflow",
            null,
            null
        );

        UICharacteristicDto char4 = new UICharacteristicDto(
            "ui-char-4",
            "app-point-101",
            "technical_shape",
            "form",
            "Form-Based Entry",
            "Standard data entry form",
            "UI pattern analysis"
        );

        MetaModelEntitiesDto entities = createEntitiesWithUICharacteristics(
            List.of(char1, char2, char3, char4)
        );
        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        ArchitectureModelDto model = new ArchitectureModelDto(metaModel, List.of());

        // When: Serialize the model to JSON (simulating file export)
        String exportedJson = objectMapper.writeValueAsString(model);

        // Then: JSON contains ui_characteristics array with all required fields
        assertThat(exportedJson).contains("\"ui_characteristics\"");

        // Verify all characteristics are present
        assertThat(exportedJson).contains("\"ui-char-1\"");
        assertThat(exportedJson).contains("\"ui-char-2\"");
        assertThat(exportedJson).contains("\"ui-char-3\"");
        assertThat(exportedJson).contains("\"ui-char-4\"");

        // Verify all type values are present
        assertThat(exportedJson).contains("\"business_feature\"");
        assertThat(exportedJson).contains("\"ui_capability\"");
        assertThat(exportedJson).contains("\"interaction_complexity\"");
        assertThat(exportedJson).contains("\"technical_shape\"");

        // Verify JSON uses snake_case for ui_id field
        assertThat(exportedJson).contains("\"ui_id\"");
        assertThat(exportedJson).contains("\"app-point-123\"");
    }

    // ============================================================================
    // Test 2: File Import - Import model with ui_characteristics
    // Verifies that ui_characteristics are correctly parsed from imported JSON
    // ============================================================================

    @Test
    @DisplayName("File import correctly parses ui_characteristics from JSON")
    void testFileImportCorrectlyParsesUICharacteristics() throws Exception {
        // Given: JSON with ui_characteristics (simulating file import)
        String importedJson = """
            {
              "metaModel": {
                "entities": {
                  "business_users": [],
                  "business_processes": [],
                  "process_activities": [],
                  "business_points": [],
                  "applications": [],
                  "app_components": [],
                  "services": [],
                  "interfaces": [],
                  "endpoints": [],
                  "classes": [],
                  "methods": [],
                  "application_points": [],
                  "logical_data_entities": [],
                  "logical_data_attributes": [],
                  "physical_data_entities": [],
                  "physical_data_attributes": [],
                  "data_entity_points": [],
                  "interactions": [],
                  "app_business_points": [],
                  "events": [],
                  "states": [],
                  "state_transitions": [],
                  "activities": [],
                  "activity_flows": [],
                  "activity_partitions": [],
                  "ui_screens": [],
                  "ui_contracts": [],
                  "ui_components": [],
                  "ui_actions": [],
                  "ui_characteristics": [
                    {
                      "id": "imported-char-1",
                      "ui_id": "imported-app-point",
                      "type": "business_feature",
                      "key": "customer_onboarding",
                      "name": "Customer Onboarding",
                      "description": "New customer registration flow",
                      "evidence": "Documented in PRD-2024"
                    },
                    {
                      "id": "imported-char-2",
                      "ui_id": "imported-app-point-2",
                      "type": "technical_shape",
                      "name": "Dashboard View"
                    }
                  ],
                  "business_logics": [],
                  "package_sets": [],
                  "packages": [],
                  "package_set_default_rules": []
                },
                "relationships": {
                  "business_user_business_points": [],
                  "application_point_business_points": [],
                  "logical_data_entity_relationships": [],
                  "logical_data_entity_physical_data_entities": [],
                  "logical_data_attribute_physical_data_attributes": [],
                  "data_movements": [],
                  "interface_logical_entities": [],
                  "ui_workflow_transitions": [],
                  "application_point_business_logics": []
                }
              },
              "diagrams": []
            }
            """;

        // When: Deserialize the JSON (simulating file import)
        ArchitectureModelDto model = objectMapper.readValue(importedJson, ArchitectureModelDto.class);

        // Then: UI characteristics are correctly parsed
        List<UICharacteristicDto> characteristics = model.metaModel().entities().uiCharacteristics();
        assertThat(characteristics).hasSize(2);

        // Verify first characteristic with all fields
        UICharacteristicDto char1 = characteristics.get(0);
        assertThat(char1.id()).isEqualTo("imported-char-1");
        assertThat(char1.uiId()).isEqualTo("imported-app-point");
        assertThat(char1.type()).isEqualTo("business_feature");
        assertThat(char1.key()).isEqualTo("customer_onboarding");
        assertThat(char1.name()).isEqualTo("Customer Onboarding");
        assertThat(char1.description()).isEqualTo("New customer registration flow");
        assertThat(char1.evidence()).isEqualTo("Documented in PRD-2024");

        // Verify second characteristic with minimal fields
        UICharacteristicDto char2 = characteristics.get(1);
        assertThat(char2.id()).isEqualTo("imported-char-2");
        assertThat(char2.uiId()).isEqualTo("imported-app-point-2");
        assertThat(char2.type()).isEqualTo("technical_shape");
        assertThat(char2.key()).isNull();
        assertThat(char2.name()).isEqualTo("Dashboard View");
        assertThat(char2.description()).isNull();
        assertThat(char2.evidence()).isNull();
    }

    // ============================================================================
    // Test 3: Backward Compatibility - Import model without ui_characteristics
    // Verifies that old model files without ui_characteristics still import
    // ============================================================================

    @Test
    @DisplayName("Backward compatibility: Import model without ui_characteristics field")
    void testBackwardCompatibilityImportWithoutUICharacteristics() throws Exception {
        // Given: JSON without ui_characteristics field (older model format)
        String oldFormatJson = """
            {
              "metaModel": {
                "entities": {
                  "business_users": [],
                  "business_processes": [],
                  "process_activities": [],
                  "business_points": [],
                  "applications": [],
                  "app_components": [],
                  "services": [],
                  "interfaces": [],
                  "endpoints": [],
                  "classes": [],
                  "methods": [],
                  "application_points": [],
                  "logical_data_entities": [],
                  "logical_data_attributes": [],
                  "physical_data_entities": [],
                  "physical_data_attributes": [],
                  "data_entity_points": [],
                  "interactions": [],
                  "app_business_points": [],
                  "events": [],
                  "states": [],
                  "state_transitions": [],
                  "activities": [],
                  "activity_flows": [],
                  "activity_partitions": [],
                  "ui_screens": [],
                  "ui_contracts": [],
                  "ui_components": [],
                  "ui_actions": [],
                  "business_logics": [],
                  "package_sets": [],
                  "packages": [],
                  "package_set_default_rules": []
                },
                "relationships": {
                  "business_user_business_points": [],
                  "application_point_business_points": [],
                  "logical_data_entity_relationships": [],
                  "logical_data_entity_physical_data_entities": [],
                  "logical_data_attribute_physical_data_attributes": [],
                  "data_movements": [],
                  "interface_logical_entities": [],
                  "ui_workflow_transitions": [],
                  "application_point_business_logics": []
                }
              },
              "diagrams": []
            }
            """;

        // When: Deserialize the old format JSON
        ArchitectureModelDto model = objectMapper.readValue(oldFormatJson, ArchitectureModelDto.class);

        // Then: Model imports successfully with ui_characteristics as null
        // The service layer handles null by returning empty list
        assertThat(model).isNotNull();
        assertThat(model.metaModel()).isNotNull();
        assertThat(model.metaModel().entities()).isNotNull();
        // JSON field was missing, so it deserializes to null
        assertThat(model.metaModel().entities().uiCharacteristics()).isNull();
    }

    // ============================================================================
    // Test 4: End-to-end Round-trip - Create, save, reload UI Characteristic
    // Verifies complete serialization/deserialization cycle preserves all data
    // ============================================================================

    @Test
    @DisplayName("End-to-end round-trip preserves all UI Characteristic fields")
    void testEndToEndRoundTripPreservesAllFields() throws Exception {
        // Given: A model with UI characteristics representing all type values
        UICharacteristicDto originalChar = new UICharacteristicDto(
            "roundtrip-char-1",
            "roundtrip-app-point",
            "interaction_complexity",
            "complex",
            "Complex Multi-Step Wizard",
            "Wizard with 5+ steps requiring user decisions at each step",
            "Documented in UX research findings UXR-2024-001"
        );

        MetaModelEntitiesDto entities = createEntitiesWithUICharacteristics(List.of(originalChar));
        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        ArchitectureModelDto originalModel = new ArchitectureModelDto(metaModel, List.of());

        // When: Complete round-trip (serialize -> deserialize)
        String json = objectMapper.writeValueAsString(originalModel);
        ArchitectureModelDto restoredModel = objectMapper.readValue(json, ArchitectureModelDto.class);

        // Then: All fields are preserved exactly
        List<UICharacteristicDto> restoredChars = restoredModel.metaModel().entities().uiCharacteristics();
        assertThat(restoredChars).hasSize(1);

        UICharacteristicDto restoredChar = restoredChars.get(0);
        assertThat(restoredChar.id()).isEqualTo(originalChar.id());
        assertThat(restoredChar.uiId()).isEqualTo(originalChar.uiId());
        assertThat(restoredChar.type()).isEqualTo(originalChar.type());
        assertThat(restoredChar.key()).isEqualTo(originalChar.key());
        assertThat(restoredChar.name()).isEqualTo(originalChar.name());
        assertThat(restoredChar.description()).isEqualTo(originalChar.description());
        assertThat(restoredChar.evidence()).isEqualTo(originalChar.evidence());
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private MetaModelEntitiesDto createEntitiesWithUICharacteristics(List<UICharacteristicDto> uiCharacteristics) {
        return new MetaModelEntitiesDto(
            List.of(), // businessUsers
            List.of(), // businessProcesses
            List.of(), // processActivities
            List.of(), // businessPoints
            List.of(), // applications
            List.of(), // appComponents
            List.of(), // services
            List.of(), // interfaces
            List.of(), // endpoints
            List.of(), // classes
            List.of(), // methods
            List.of(), // applicationPoints
            List.of(), // logicalDataEntities
            List.of(), // logicalDataAttributes
            List.of(), // physicalDataEntities
            List.of(), // physicalDataAttributes
            List.of(), // dataEntityPoints
            List.of(), // interactions
            List.of(), // appBusinessPoints
            List.of(), // events
            List.of(), // states
            List.of(), // stateTransitions
            List.of(), // activities
            List.of(), // activityFlows
            List.of(), // activityPartitions
            List.of(), // uiScreens
            List.of(), // uiContracts
            List.of(), // uiComponents
            List.of(), // uiActions
            uiCharacteristics, // uiCharacteristics
            List.of(), // businessLogics
            List.of(), // packageSets
            List.of(), // packages
            List.of(), // packageSetDefaultRules
            List.of(), // userJourneys
            List.of(),  // activitySteps
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
    }

    private MetaModelRelationshipsDto createEmptyRelationships() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyRelationships();
    }
}
