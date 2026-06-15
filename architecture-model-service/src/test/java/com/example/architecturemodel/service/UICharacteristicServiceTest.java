package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.entity.UICharacteristicDto;
import com.example.architecturemodel.model.entity.UICharacteristicEntity;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for UI Characteristics service layer integration.
 *
 * Tests that ui_characteristics are correctly serialized/deserialized in the model JSON
 * and that DTO/Entity mappings work correctly.
 *
 * Spec: UI Characteristics
 * Task Group 2: Service and Controller Layer
 */
class UICharacteristicServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    // ============================================================================
    // Test 1: Export includes ui_characteristics array in JSON
    // ============================================================================

    @Test
    @DisplayName("Export includes ui_characteristics array in JSON")
    void testExportIncludesUICharacteristicsArrayInJson() throws Exception {
        // Given: MetaModelEntitiesDto with ui_characteristics
        UICharacteristicDto char1 = new UICharacteristicDto(
            "ui-char-1",
            "app-point-1",
            "business_feature",
            "customer_management",
            "Customer Management",
            "Allows users to manage customer records",
            "Based on user story US-123"
        );

        UICharacteristicDto char2 = new UICharacteristicDto(
            "ui-char-2",
            "app-point-2",
            "ui_capability",
            "responsive_layout",
            "Responsive Layout",
            null,
            null
        );

        MetaModelEntitiesDto entities = createEntitiesWithUICharacteristics(List.of(char1, char2));
        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        ArchitectureModelDto model = new ArchitectureModelDto(metaModel, List.of());

        // When: Serialize to JSON
        String json = objectMapper.writeValueAsString(model);

        // Then: JSON contains ui_characteristics array with all fields
        assertThat(json).contains("\"ui_characteristics\"");
        assertThat(json).contains("\"ui-char-1\"");
        assertThat(json).contains("\"ui-char-2\"");
        assertThat(json).contains("\"business_feature\"");
        assertThat(json).contains("\"ui_capability\"");
        assertThat(json).contains("\"customer_management\"");
        assertThat(json).contains("\"responsive_layout\"");
        assertThat(json).contains("\"ui_id\"");
    }

    // ============================================================================
    // Test 2: Import restores ui_characteristics from snapshot
    // ============================================================================

    @Test
    @DisplayName("Import restores ui_characteristics from snapshot JSON")
    void testImportRestoresUICharacteristicsFromSnapshot() throws Exception {
        // Given: JSON snapshot with ui_characteristics
        String json = """
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
                      "id": "ui-char-imported",
                      "ui_id": "app-point-imported",
                      "type": "interaction_complexity",
                      "key": "high",
                      "name": "High Complexity Interaction",
                      "description": "Complex multi-step workflow",
                      "evidence": "User testing revealed this"
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

        // When: Deserialize from JSON
        ArchitectureModelDto model = objectMapper.readValue(json, ArchitectureModelDto.class);

        // Then: ui_characteristics are restored
        assertThat(model.metaModel().entities().uiCharacteristics()).hasSize(1);
        UICharacteristicDto dto = model.metaModel().entities().uiCharacteristics().get(0);
        assertThat(dto.id()).isEqualTo("ui-char-imported");
        assertThat(dto.uiId()).isEqualTo("app-point-imported");
        assertThat(dto.type()).isEqualTo("interaction_complexity");
        assertThat(dto.key()).isEqualTo("high");
        assertThat(dto.name()).isEqualTo("High Complexity Interaction");
        assertThat(dto.description()).isEqualTo("Complex multi-step workflow");
        assertThat(dto.evidence()).isEqualTo("User testing revealed this");
    }

    // ============================================================================
    // Test 3: Backward compatibility - loading model without ui_characteristics
    // ============================================================================

    @Test
    @DisplayName("Import handles missing ui_characteristics gracefully (backward compatibility)")
    void testBackwardCompatibility_missingUICharacteristics_returnsNull() throws Exception {
        // Given: JSON snapshot WITHOUT ui_characteristics field (older format)
        String json = """
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

        // When: Deserialize from JSON
        ArchitectureModelDto model = objectMapper.readValue(json, ArchitectureModelDto.class);

        // Then: ui_characteristics is null (JSON field was missing)
        // The service layer should handle this by returning empty list
        assertThat(model.metaModel().entities().uiCharacteristics()).isNull();
    }

    // ============================================================================
    // Test 4: Round-trip serialization preserves all fields
    // ============================================================================

    @Test
    @DisplayName("Round-trip serialization preserves all ui_characteristic fields")
    void testRoundTripSerializationPreservesAllFields() throws Exception {
        // Given: Original model with ui_characteristics having all fields
        UICharacteristicDto original = new UICharacteristicDto(
            "ui-char-roundtrip",
            "app-point-roundtrip",
            "technical_shape",
            "spa_architecture",
            "SPA Architecture",
            "Single Page Application with React",
            "Technical decision documented in ADR-005"
        );

        MetaModelEntitiesDto entities = createEntitiesWithUICharacteristics(List.of(original));
        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        ArchitectureModelDto model = new ArchitectureModelDto(metaModel, List.of());

        // When: Serialize and deserialize
        String json = objectMapper.writeValueAsString(model);
        ArchitectureModelDto restored = objectMapper.readValue(json, ArchitectureModelDto.class);

        // Then: All fields are preserved
        assertThat(restored.metaModel().entities().uiCharacteristics()).hasSize(1);
        UICharacteristicDto restoredDto = restored.metaModel().entities().uiCharacteristics().get(0);

        assertThat(restoredDto.id()).isEqualTo(original.id());
        assertThat(restoredDto.uiId()).isEqualTo(original.uiId());
        assertThat(restoredDto.type()).isEqualTo(original.type());
        assertThat(restoredDto.key()).isEqualTo(original.key());
        assertThat(restoredDto.name()).isEqualTo(original.name());
        assertThat(restoredDto.description()).isEqualTo(original.description());
        assertThat(restoredDto.evidence()).isEqualTo(original.evidence());
    }

    // ============================================================================
    // Test 5: DTO to Entity mapping works correctly
    // ============================================================================

    @Test
    @DisplayName("DTO to Entity mapping preserves all fields")
    void testDtoToEntityMapping() {
        // Given: A DTO with all fields
        UICharacteristicDto dto = new UICharacteristicDto(
            "ui-char-1",
            "app-point-1",
            "business_feature",
            "customer_onboarding",
            "Customer Onboarding",
            "Flow for new customer registration",
            "Defined in PRD-2024-001"
        );

        String modelFileId = "model-123";

        // When: Map DTO to Entity (following ModelService pattern)
        UICharacteristicEntity entity = UICharacteristicEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .uiId(dto.uiId())
            .type(dto.type())
            .key(dto.key())
            .name(dto.name())
            .description(dto.description())
            .evidence(dto.evidence())
            .build();

        // Then: All fields are mapped correctly
        assertThat(entity.getId()).isEqualTo("ui-char-1");
        assertThat(entity.getModelFileId()).isEqualTo(modelFileId);
        assertThat(entity.getUiId()).isEqualTo("app-point-1");
        assertThat(entity.getType()).isEqualTo("business_feature");
        assertThat(entity.getKey()).isEqualTo("customer_onboarding");
        assertThat(entity.getName()).isEqualTo("Customer Onboarding");
        assertThat(entity.getDescription()).isEqualTo("Flow for new customer registration");
        assertThat(entity.getEvidence()).isEqualTo("Defined in PRD-2024-001");
    }

    // ============================================================================
    // Test 6: Entity to DTO mapping works correctly
    // ============================================================================

    @Test
    @DisplayName("Entity to DTO mapping preserves all fields")
    void testEntityToDtoMapping() {
        // Given: An Entity with all fields
        UICharacteristicEntity entity = UICharacteristicEntity.builder()
            .id("ui-char-entity")
            .modelFileId("model-456")
            .uiId("app-point-entity")
            .type("ui_capability")
            .key("dark_mode")
            .name("Dark Mode Support")
            .description("UI supports dark mode theme")
            .evidence("UX requirement REQ-789")
            .build();

        // When: Map Entity to DTO (following ModelService loadEntities pattern)
        UICharacteristicDto dto = new UICharacteristicDto(
            entity.getId(),
            entity.getUiId(),
            entity.getType(),
            entity.getKey(),
            entity.getName(),
            entity.getDescription(),
            entity.getEvidence()
        );

        // Then: All fields are mapped correctly (modelFileId is not in DTO)
        assertThat(dto.id()).isEqualTo("ui-char-entity");
        assertThat(dto.uiId()).isEqualTo("app-point-entity");
        assertThat(dto.type()).isEqualTo("ui_capability");
        assertThat(dto.key()).isEqualTo("dark_mode");
        assertThat(dto.name()).isEqualTo("Dark Mode Support");
        assertThat(dto.description()).isEqualTo("UI supports dark mode theme");
        assertThat(dto.evidence()).isEqualTo("UX requirement REQ-789");
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
