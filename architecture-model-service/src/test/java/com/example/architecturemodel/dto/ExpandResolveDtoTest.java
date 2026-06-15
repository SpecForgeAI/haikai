package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.DiagramBundleSelection;
import com.example.architecturemodel.model.dto.EntityBundleSelection;
import com.example.architecturemodel.model.dto.ExpandResolveRequestDto;
import com.example.architecturemodel.model.dto.ExpandResolveResponseDto;
import com.example.architecturemodel.model.dto.diagram.ResolvedDiagramSummary;
import com.example.architecturemodel.model.dto.entity.ResolvedEntitySummary;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for Expand-Resolve DTO serialization with Jackson.
 * Verifies that @JsonProperty annotations produce expected snake_case JSON output.
 *
 * Spec: Context Bundles Backend Expansion - Task Group 1
 */
class ExpandResolveDtoTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    /**
     * Test EntityBundleSelection record serialization with all fields.
     * Verifies snake_case JSON property names.
     */
    @Test
    void entityBundleSelection_serializesWithSnakeCaseProperties() throws Exception {
        // Arrange
        EntityBundleSelection selection = new EntityBundleSelection(
            "interfaces",
            "iface-123",
            "interface_with_endpoints",
            null
        );

        // Act
        String json = objectMapper.writeValueAsString(selection);

        // Assert
        assertTrue(json.contains("\"entity_type\""), "Should contain entity_type with snake_case");
        assertTrue(json.contains("\"entity_id\""), "Should contain entity_id with snake_case");
        assertTrue(json.contains("\"bundle_type\""), "Should contain bundle_type with snake_case");
        assertTrue(json.contains("\"interfaces\""), "Should contain entity_type value");
        assertTrue(json.contains("\"iface-123\""), "Should contain entity_id value");
        assertTrue(json.contains("\"interface_with_endpoints\""), "Should contain bundle_type value");
    }

    /**
     * Test EntityBundleSelection record deserialization from snake_case JSON.
     */
    @Test
    void entityBundleSelection_deserializesFromSnakeCaseJson() throws Exception {
        // Arrange
        String json = """
            {
                "entity_type": "services",
                "entity_id": "svc-456",
                "bundle_type": "service_with_parents_and_children"
            }
            """;

        // Act
        EntityBundleSelection selection = objectMapper.readValue(json, EntityBundleSelection.class);

        // Assert
        assertNotNull(selection);
        assertEquals("services", selection.entityType());
        assertEquals("svc-456", selection.entityId());
        assertEquals("service_with_parents_and_children", selection.bundleType());
    }

    /**
     * Test DiagramBundleSelection record serialization.
     * Verifies snake_case JSON property names.
     */
    @Test
    void diagramBundleSelection_serializesWithSnakeCaseProperties() throws Exception {
        // Arrange
        DiagramBundleSelection selection = new DiagramBundleSelection(
            "diagram-789",
            "diagram_only"
        );

        // Act
        String json = objectMapper.writeValueAsString(selection);

        // Assert
        assertTrue(json.contains("\"diagram_id\""), "Should contain diagram_id with snake_case");
        assertTrue(json.contains("\"bundle_type\""), "Should contain bundle_type with snake_case");
        assertTrue(json.contains("\"diagram-789\""), "Should contain diagram_id value");
        assertTrue(json.contains("\"diagram_only\""), "Should contain bundle_type value");
    }

    /**
     * Test DiagramBundleSelection record deserialization from snake_case JSON.
     */
    @Test
    void diagramBundleSelection_deserializesFromSnakeCaseJson() throws Exception {
        // Arrange
        String json = """
            {
                "diagram_id": "diag-abc",
                "bundle_type": "diagram_only"
            }
            """;

        // Act
        DiagramBundleSelection selection = objectMapper.readValue(json, DiagramBundleSelection.class);

        // Assert
        assertNotNull(selection);
        assertEquals("diag-abc", selection.diagramId());
        assertEquals("diagram_only", selection.bundleType());
    }

    /**
     * Test ExpandResolveRequestDto with mixed entity/diagram selections.
     * Verifies proper serialization with nested selection objects.
     */
    @Test
    void expandResolveRequestDto_serializesWithMixedSelections() throws Exception {
        // Arrange
        List<EntityBundleSelection> entitySelections = List.of(
            new EntityBundleSelection("interfaces", "iface-1", "interface_with_endpoints", null),
            new EntityBundleSelection("services", "svc-1", "service_only", null)
        );
        List<DiagramBundleSelection> diagramSelections = List.of(
            new DiagramBundleSelection("diagram-1", "diagram_only")
        );

        ExpandResolveRequestDto request = new ExpandResolveRequestDto(
            entitySelections,
            diagramSelections
        );

        // Act
        String json = objectMapper.writeValueAsString(request);

        // Assert
        assertTrue(json.contains("\"selected_entities\""), "Should contain selected_entities with snake_case");
        assertTrue(json.contains("\"selected_diagrams\""), "Should contain selected_diagrams with snake_case");
        assertTrue(json.contains("\"entity_type\""), "Should contain nested entity_type");
        assertTrue(json.contains("\"diagram_id\""), "Should contain nested diagram_id");
    }

    /**
     * Test ExpandResolveRequestDto deserialization from snake_case JSON.
     */
    @Test
    void expandResolveRequestDto_deserializesFromSnakeCaseJson() throws Exception {
        // Arrange
        String json = """
            {
                "selected_entities": [
                    {
                        "entity_type": "interfaces",
                        "entity_id": "iface-1",
                        "bundle_type": "interface_with_endpoints_and_schemas"
                    }
                ],
                "selected_diagrams": [
                    {
                        "diagram_id": "diagram-1",
                        "bundle_type": "diagram_only"
                    }
                ]
            }
            """;

        // Act
        ExpandResolveRequestDto request = objectMapper.readValue(json, ExpandResolveRequestDto.class);

        // Assert
        assertNotNull(request);
        assertEquals(1, request.selectedEntities().size());
        assertEquals(1, request.selectedDiagrams().size());
        assertEquals("interfaces", request.selectedEntities().get(0).entityType());
        assertEquals("iface-1", request.selectedEntities().get(0).entityId());
        assertEquals("interface_with_endpoints_and_schemas", request.selectedEntities().get(0).bundleType());
        assertEquals("diagram-1", request.selectedDiagrams().get(0).diagramId());
        assertEquals("diagram_only", request.selectedDiagrams().get(0).bundleType());
    }

    /**
     * Test ExpandResolveResponseDto structure with truncation fields.
     * Verifies all response fields are properly serialized.
     */
    @Test
    void expandResolveResponseDto_serializesWithTruncationFields() throws Exception {
        // Arrange
        List<String> expandedEntityIds = List.of(
            "interfaces::iface-1",
            "endpoints::ep-1",
            "endpoints::ep-2"
        );
        List<String> expandedDiagramIds = List.of("diagram-1");

        ResolvedEntitySummary entitySummary = new ResolvedEntitySummary(
            "iface-1",
            "UserInterface",
            "interfaces",
            "application",
            Map.of("serviceId", "svc-1")
        );
        ResolvedDiagramSummary diagramSummary = new ResolvedDiagramSummary(
            "diagram-1",
            "System Overview",
            "General",
            List.of("interfaces::iface-1")
        );

        ExpandResolveResponseDto response = new ExpandResolveResponseDto(
            expandedEntityIds,
            expandedDiagramIds,
            List.of(entitySummary),
            List.of(diagramSummary),
            true,
            "Exceeded maximum of 250 entities",
            java.util.Collections.emptyList()
        );

        // Act
        String json = objectMapper.writeValueAsString(response);

        // Assert
        assertTrue(json.contains("\"expanded_entity_ids\""), "Should contain expanded_entity_ids with snake_case");
        assertTrue(json.contains("\"expanded_diagram_ids\""), "Should contain expanded_diagram_ids with snake_case");
        assertTrue(json.contains("\"resolved_entities\""), "Should contain resolved_entities with snake_case");
        assertTrue(json.contains("\"resolved_diagrams\""), "Should contain resolved_diagrams with snake_case");
        assertTrue(json.contains("\"truncated\""), "Should contain truncated field");
        assertTrue(json.contains("\"truncation_reason\""), "Should contain truncation_reason with snake_case");
        assertTrue(json.contains("\"interfaces::iface-1\""), "Should contain canonical entity ID");
        assertTrue(json.contains("true"), "Should contain truncated value");
        assertTrue(json.contains("Exceeded maximum of 250 entities"), "Should contain truncation_reason value");
    }

    /**
     * Test ExpandResolveResponseDto with truncated=false and null truncation_reason.
     */
    @Test
    void expandResolveResponseDto_serializesWithNoTruncation() throws Exception {
        // Arrange
        ExpandResolveResponseDto response = new ExpandResolveResponseDto(
            List.of("services::svc-1"),
            List.of("diagram-1"),
            Collections.emptyList(),
            Collections.emptyList(),
            false,
            null,
            Collections.emptyList()
        );

        // Act
        String json = objectMapper.writeValueAsString(response);

        // Assert
        assertTrue(json.contains("\"truncated\":false") || json.contains("\"truncated\": false"),
            "Should contain truncated:false");
        assertTrue(json.contains("\"truncation_reason\":null") || json.contains("\"truncation_reason\": null"),
            "Should contain truncation_reason:null");
    }

    /**
     * Test edge cases: empty arrays in request DTO.
     */
    @Test
    void expandResolveRequestDto_handlesEmptyArrays() throws Exception {
        // Arrange
        ExpandResolveRequestDto request = new ExpandResolveRequestDto(
            Collections.emptyList(),
            Collections.emptyList()
        );

        // Act
        String json = objectMapper.writeValueAsString(request);

        // Assert
        assertTrue(json.contains("\"selected_entities\":[]") || json.contains("\"selected_entities\": []"),
            "Empty selected_entities should serialize as empty array");
        assertTrue(json.contains("\"selected_diagrams\":[]") || json.contains("\"selected_diagrams\": []"),
            "Empty selected_diagrams should serialize as empty array");
    }

    /**
     * Test edge cases: null values in selection fields.
     * Records can have null field values; verify serialization handles them.
     */
    @Test
    void entityBundleSelection_handlesNullBundleType() throws Exception {
        // Arrange
        EntityBundleSelection selection = new EntityBundleSelection(
            "interfaces",
            "iface-1",
            null,
            null
        );

        // Act
        String json = objectMapper.writeValueAsString(selection);

        // Assert
        assertTrue(json.contains("\"bundle_type\":null") || json.contains("\"bundle_type\": null"),
            "Null bundle_type should serialize as null");
        assertTrue(json.contains("\"entity_type\""), "Should still contain entity_type");
        assertTrue(json.contains("\"entity_id\""), "Should still contain entity_id");
    }

    /**
     * Test deserialization with null values in JSON.
     */
    @Test
    void expandResolveRequestDto_deserializesWithNullLists() throws Exception {
        // Arrange
        String json = """
            {
                "selected_entities": null,
                "selected_diagrams": null
            }
            """;

        // Act
        ExpandResolveRequestDto request = objectMapper.readValue(json, ExpandResolveRequestDto.class);

        // Assert
        assertNotNull(request);
        assertNull(request.selectedEntities());
        assertNull(request.selectedDiagrams());
    }
}
