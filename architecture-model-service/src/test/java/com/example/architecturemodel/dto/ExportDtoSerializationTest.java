package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.diagram.DiagramDto;
import com.example.architecturemodel.model.dto.export.CanonicalDiagramExportDto;
import com.example.architecturemodel.model.dto.export.ProjectContextPackageDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for Export DTO serialization with Jackson.
 * Verifies that @JsonProperty annotations produce expected snake_case JSON output.
 */
class ExportDtoSerializationTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
    }

    @Test
    void projectContextPackageDto_serializesWithSnakeCaseProperties() throws Exception {
        // Arrange
        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList()
        );
        MetaModelRelationshipsDto relationships = new MetaModelRelationshipsDto(
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList()
        );
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        List<DiagramDto> diagrams = Collections.emptyList();

        ProjectContextPackageDto dto = new ProjectContextPackageDto(
            "test-project.json",
            metaModel,
            diagrams
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"project_id\""), "Should contain project_id with snake_case");
        assertTrue(json.contains("\"test-project.json\""), "Should contain project_id value");
        assertTrue(json.contains("\"metaModel\"") || json.contains("\"meta_model\""),
            "Should contain metaModel field");
        assertTrue(json.contains("\"diagrams\""), "Should contain diagrams field");
    }

    @Test
    void canonicalDiagramExportDto_serializesWithSnakeCaseProperties() throws Exception {
        // Arrange
        DiagramDto diagram = new DiagramDto(
            "diagram-1", "Test Diagram", "Description", "General",
            null, null, Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), null
        );

        CanonicalDiagramExportDto dto = new CanonicalDiagramExportDto(
            "test-project.json",
            "diagram-1",
            "General",
            diagram
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"project_id\""), "Should contain project_id with snake_case");
        assertTrue(json.contains("\"diagram_id\""), "Should contain diagram_id with snake_case");
        assertTrue(json.contains("\"diagram_type\""), "Should contain diagram_type with snake_case");
        assertTrue(json.contains("\"canonical\""), "Should contain canonical field");
        assertTrue(json.contains("\"test-project.json\""), "Should contain project_id value");
        assertTrue(json.contains("\"diagram-1\""), "Should contain diagram_id value");
        assertTrue(json.contains("\"General\""), "Should contain diagram_type value");
    }

    @Test
    void projectContextPackageDto_handlesNullDiagramsGracefully() throws Exception {
        // Arrange
        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList()
        );
        MetaModelRelationshipsDto relationships = new MetaModelRelationshipsDto(
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList()
        );
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);

        // Create DTO with null diagrams
        ProjectContextPackageDto dto = new ProjectContextPackageDto(
            "test-project.json",
            metaModel,
            null
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"project_id\""), "Should contain project_id");
        assertTrue(json.contains("\"diagrams\":null") || json.contains("\"diagrams\": null"),
            "Should handle null diagrams");
    }

    @Test
    void canonicalDiagramExportDto_handlesNullMetaModelGracefully() throws Exception {
        // Arrange - create DTO with null canonical diagram (edge case)
        CanonicalDiagramExportDto dto = new CanonicalDiagramExportDto(
            "test-project.json",
            "diagram-1",
            "General",
            null
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"project_id\""), "Should contain project_id");
        assertTrue(json.contains("\"diagram_id\""), "Should contain diagram_id");
        assertTrue(json.contains("\"diagram_type\""), "Should contain diagram_type");
        assertTrue(json.contains("\"canonical\":null") || json.contains("\"canonical\": null"),
            "Should handle null canonical gracefully");
    }
}
