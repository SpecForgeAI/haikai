package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.ImplementContextResolveRequestDto;
import com.example.architecturemodel.model.dto.ResolvedImplementContextDto;
import com.example.architecturemodel.model.dto.diagram.ResolvedDiagramSummary;
import com.example.architecturemodel.model.dto.entity.ResolvedEntitySummary;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for Resolved Implement Context DTO serialization with Jackson.
 * Verifies that @JsonProperty annotations produce expected snake_case JSON output.
 *
 * Spec: Implement Context Resolution - Iteration 3
 */
class ResolvedImplementContextDtoTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    @Test
    void resolvedImplementContextDto_serializesWithSnakeCaseProperties() throws Exception {
        // Arrange
        Map<String, Object> relevantFields = new HashMap<>();
        relevantFields.put("applicationId", "app-1");
        relevantFields.put("namespace", "com.example.service");

        ResolvedEntitySummary entitySummary = new ResolvedEntitySummary(
            "svc-123",
            "UserService",
            "services",
            "application",
            relevantFields
        );

        ResolvedDiagramSummary diagramSummary = new ResolvedDiagramSummary(
            "diagram-1",
            "System Overview",
            "General",
            List.of("services::svc-123", "applications::app-1")
        );

        ResolvedImplementContextDto dto = new ResolvedImplementContextDto(
            List.of(entitySummary),
            List.of(diagramSummary)
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"resolved_entities\""), "Should contain resolved_entities with snake_case");
        assertTrue(json.contains("\"resolved_diagrams\""), "Should contain resolved_diagrams with snake_case");
    }

    @Test
    void resolvedEntitySummary_serializesWithSnakeCaseProperties() throws Exception {
        // Arrange
        Map<String, Object> relevantFields = new HashMap<>();
        relevantFields.put("applicationId", "app-1");
        relevantFields.put("namespace", "com.example.service");

        ResolvedEntitySummary dto = new ResolvedEntitySummary(
            "svc-123",
            "UserService",
            "services",
            "application",
            relevantFields
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"id\""), "Should contain id field");
        assertTrue(json.contains("\"name\""), "Should contain name field");
        assertTrue(json.contains("\"entity_type\""), "Should contain entity_type with snake_case");
        assertTrue(json.contains("\"category\""), "Should contain category field");
        assertTrue(json.contains("\"relevant_fields\""), "Should contain relevant_fields with snake_case");
        assertTrue(json.contains("\"svc-123\""), "Should contain id value");
        assertTrue(json.contains("\"UserService\""), "Should contain name value");
        assertTrue(json.contains("\"services\""), "Should contain entity_type value");
        assertTrue(json.contains("\"application\""), "Should contain category value");
    }

    @Test
    void resolvedDiagramSummary_serializesWithSnakeCaseProperties() throws Exception {
        // Arrange
        ResolvedDiagramSummary dto = new ResolvedDiagramSummary(
            "diagram-1",
            "System Overview",
            "General",
            List.of("services::svc-123", "applications::app-1")
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"id\""), "Should contain id field");
        assertTrue(json.contains("\"name\""), "Should contain name field");
        assertTrue(json.contains("\"diagram_type\""), "Should contain diagram_type with snake_case");
        assertTrue(json.contains("\"referenced_entity_ids\""), "Should contain referenced_entity_ids with snake_case");
        assertTrue(json.contains("\"diagram-1\""), "Should contain id value");
        assertTrue(json.contains("\"System Overview\""), "Should contain name value");
        assertTrue(json.contains("\"General\""), "Should contain diagram_type value");
    }

    @Test
    void emptyLists_serializeAsEmptyArraysNotNull() throws Exception {
        // Arrange
        ResolvedImplementContextDto dto = new ResolvedImplementContextDto(
            Collections.emptyList(),
            Collections.emptyList()
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"resolved_entities\":[]") || json.contains("\"resolved_entities\": []"),
            "Empty resolved_entities should serialize as empty array");
        assertTrue(json.contains("\"resolved_diagrams\":[]") || json.contains("\"resolved_diagrams\": []"),
            "Empty resolved_diagrams should serialize as empty array");
        assertFalse(json.contains("null"), "Should not contain null values for empty lists");
    }

    @Test
    void relevantFieldsMap_serializesCorrectly() throws Exception {
        // Arrange
        Map<String, Object> relevantFields = new HashMap<>();
        relevantFields.put("applicationId", "app-1");
        relevantFields.put("namespace", "com.example.service");
        relevantFields.put("port", 8080);
        relevantFields.put("enabled", true);

        ResolvedEntitySummary dto = new ResolvedEntitySummary(
            "svc-123",
            "UserService",
            "services",
            "application",
            relevantFields
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"relevant_fields\""), "Should contain relevant_fields");
        assertTrue(json.contains("\"applicationId\""), "Should contain applicationId in relevant_fields");
        assertTrue(json.contains("\"namespace\""), "Should contain namespace in relevant_fields");
        assertTrue(json.contains("\"app-1\""), "Should contain applicationId value");
        assertTrue(json.contains("\"com.example.service\""), "Should contain namespace value");
        assertTrue(json.contains("8080"), "Should contain port value");
        assertTrue(json.contains("true"), "Should contain enabled value");
    }

    @Test
    void implementContextResolveRequestDto_serializesWithSnakeCaseProperties() throws Exception {
        // Arrange
        ImplementContextResolveRequestDto dto = new ImplementContextResolveRequestDto(
            List.of("services::svc-123", "classes::cls-456"),
            List.of("diagram-1", "diagram-2")
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"selected_entity_ids\""), "Should contain selected_entity_ids with snake_case");
        assertTrue(json.contains("\"selected_diagram_ids\""), "Should contain selected_diagram_ids with snake_case");
        assertTrue(json.contains("\"services::svc-123\""), "Should contain entity ID value");
        assertTrue(json.contains("\"diagram-1\""), "Should contain diagram ID value");
    }
}
