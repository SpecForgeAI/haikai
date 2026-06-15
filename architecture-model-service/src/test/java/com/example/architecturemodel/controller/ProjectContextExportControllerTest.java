package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.diagram.DiagramDto;
import com.example.architecturemodel.model.dto.export.CanonicalDiagramExportDto;
import com.example.architecturemodel.model.dto.export.ProjectContextPackageDto;
import com.example.architecturemodel.service.ModelService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Collections;
import java.util.List;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for Project Context Export endpoints.
 *
 * Tests:
 * 1. GET /api/model/project-context/{filename} - success
 * 2. GET /api/model/project-context/{filename} - 404 when file not found
 * 3. GET /api/model/diagrams/{diagramId}/canonical - success
 * 4. GET /api/model/diagrams/{diagramId}/canonical - 404 when diagram not found
 * 5. GET /api/model/diagrams/{diagramId}/canonical - 400 when filename missing
 * 6. GET /api/model/project-context/{filename} - response contains expected fields
 */
@WebMvcTest(ModelController.class)
class ProjectContextExportControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ModelService modelService;

    @MockBean
    private com.example.architecturemodel.service.DiagramExportService diagramExportService;

    // ============================================================================
    // getProjectContext Tests
    // ============================================================================

    @Test
    void getProjectContext_returnsProjectContextPackage() throws Exception {
        // Arrange
        String filename = "test-project.json";
        MetaModelEntitiesDto entities = createEmptyEntities();
        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);

        DiagramDto diagram = new DiagramDto(
            "diagram-1", "Test Diagram", null, "General",
            null, null, Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), null
        );

        ProjectContextPackageDto response = new ProjectContextPackageDto(
            filename, metaModel, List.of(diagram)
        );

        when(modelService.loadProjectContext(filename)).thenReturn(response);

        // Act & Assert
        mockMvc.perform(get("/api/model/project-context/{filename}", filename)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.project_id").value(filename))
            .andExpect(jsonPath("$.metaModel").exists())
            .andExpect(jsonPath("$.diagrams").isArray())
            .andExpect(jsonPath("$.diagrams[0].id").value("diagram-1"));

        verify(modelService).loadProjectContext(filename);
    }

    @Test
    void getProjectContext_returns404_whenFileNotFound() throws Exception {
        // Arrange
        String filename = "nonexistent.json";
        when(modelService.loadProjectContext(filename))
            .thenThrow(new ResourceNotFoundException("Model file not found: " + filename));

        // Act & Assert
        mockMvc.perform(get("/api/model/project-context/{filename}", filename)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound());

        verify(modelService).loadProjectContext(filename);
    }

    @Test
    void getProjectContext_returnsEmptyDiagramsArray_whenNoGeneralDiagrams() throws Exception {
        // Arrange
        String filename = "test-project.json";
        MetaModelEntitiesDto entities = createEmptyEntities();
        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);

        ProjectContextPackageDto response = new ProjectContextPackageDto(
            filename, metaModel, Collections.emptyList()
        );

        when(modelService.loadProjectContext(filename)).thenReturn(response);

        // Act & Assert
        mockMvc.perform(get("/api/model/project-context/{filename}", filename)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.diagrams").isArray())
            .andExpect(jsonPath("$.diagrams").isEmpty());
    }

    // ============================================================================
    // getCanonicalDiagram Tests
    // ============================================================================

    @Test
    void getCanonicalDiagram_returnsCanonicalDiagramExport() throws Exception {
        // Arrange
        String filename = "test-project.json";
        String diagramId = "diagram-1";

        DiagramDto canonicalDiagram = new DiagramDto(
            diagramId, "Test Diagram", null, "General",
            null, null, Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), null
        );

        CanonicalDiagramExportDto response = new CanonicalDiagramExportDto(
            filename, diagramId, "General", canonicalDiagram
        );

        when(modelService.exportCanonicalDiagram(filename, diagramId)).thenReturn(response);

        // Act & Assert
        mockMvc.perform(get("/api/model/diagrams/{diagramId}/canonical", diagramId)
                .param("filename", filename)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.project_id").value(filename))
            .andExpect(jsonPath("$.diagram_id").value(diagramId))
            .andExpect(jsonPath("$.diagram_type").value("General"))
            .andExpect(jsonPath("$.canonical").exists())
            .andExpect(jsonPath("$.canonical.id").value(diagramId));

        verify(modelService).exportCanonicalDiagram(filename, diagramId);
    }

    @Test
    void getCanonicalDiagram_returns404_whenDiagramNotFound() throws Exception {
        // Arrange
        String filename = "test-project.json";
        String diagramId = "nonexistent-diagram";

        when(modelService.exportCanonicalDiagram(filename, diagramId))
            .thenThrow(new ResourceNotFoundException("Diagram not found: " + diagramId));

        // Act & Assert
        mockMvc.perform(get("/api/model/diagrams/{diagramId}/canonical", diagramId)
                .param("filename", filename)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound());

        verify(modelService).exportCanonicalDiagram(filename, diagramId);
    }

    @Test
    void getCanonicalDiagram_returns400_whenFilenameMissing() throws Exception {
        // Arrange
        String diagramId = "diagram-1";

        // Act & Assert - missing required filename parameter
        mockMvc.perform(get("/api/model/diagrams/{diagramId}/canonical", diagramId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isBadRequest());

        verify(modelService, never()).exportCanonicalDiagram(anyString(), anyString());
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private MetaModelEntitiesDto createEmptyEntities() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyEntities();
    }

    private MetaModelRelationshipsDto createEmptyRelationships() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyRelationships();
    }
}
