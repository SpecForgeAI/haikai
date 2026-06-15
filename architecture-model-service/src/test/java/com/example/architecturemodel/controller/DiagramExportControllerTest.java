package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.service.DiagramExportService;
import com.example.architecturemodel.service.ModelService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Unit tests for diagram export endpoints in ModelController.
 * Spec: Export Diagrams as SVG - Task Group 3
 *
 * Tests the HTTP endpoints for:
 * - GET /api/model/diagrams/{diagramId}/export-svg
 * - GET /api/model/diagrams/export-all-svg
 */
@ExtendWith(MockitoExtension.class)
class DiagramExportControllerTest {

    @Mock
    private ModelService modelService;

    @Mock
    private DiagramExportService diagramExportService;

    @TempDir
    Path tempDir;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        ModelController controller = new ModelController(modelService, diagramExportService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    @Test
    void exportDiagramAsSvg_returnsSvgWithCorrectHeaders() throws Exception {
        // Arrange
        String diagramId = "diagram-1";
        String filename = "test-model";
        String downloadFileName = "project_diagram_20240109-120000.svg";

        // Create a temporary SVG file
        Path svgFile = tempDir.resolve(downloadFileName);
        String svgContent = "<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        Files.writeString(svgFile, svgContent);

        DiagramExportService.SingleDiagramExportResult result =
            new DiagramExportService.SingleDiagramExportResult(svgFile, downloadFileName);

        when(diagramExportService.exportSingleDiagramSvg(filename, diagramId)).thenReturn(result);

        // Act & Assert
        mockMvc.perform(get("/api/model/diagrams/{diagramId}/export-svg", diagramId)
                .param("filename", filename))
            .andExpect(status().isOk())
            .andExpect(content().contentType("image/svg+xml"))
            .andExpect(header().string("Content-Disposition",
                "attachment; filename=\"" + downloadFileName + "\""));
    }

    @Test
    void exportAllDiagramsAsSvg_returnsZipWithCorrectHeaders() throws Exception {
        // Arrange
        String filename = "test-model";
        String downloadFileName = "project_all-diagrams_20240109-120000.zip";
        byte[] zipBytes = new byte[]{0x50, 0x4B, 0x03, 0x04}; // ZIP magic bytes

        DiagramExportService.AllDiagramsExportResult result =
            new DiagramExportService.AllDiagramsExportResult(zipBytes, downloadFileName);

        when(diagramExportService.exportAllDiagramsAsZip(filename)).thenReturn(result);

        // Act & Assert
        mockMvc.perform(get("/api/model/diagrams/export-all-svg")
                .param("filename", filename))
            .andExpect(status().isOk())
            .andExpect(content().contentType("application/zip"))
            .andExpect(header().string("Content-Disposition",
                "attachment; filename=\"" + downloadFileName + "\""));
    }

    @Test
    void exportDiagramAsSvg_missingFilename_returns400() throws Exception {
        // Act & Assert
        mockMvc.perform(get("/api/model/diagrams/{diagramId}/export-svg", "diagram-1"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void exportDiagramAsSvg_blankFilename_returns400() throws Exception {
        // Act & Assert
        mockMvc.perform(get("/api/model/diagrams/{diagramId}/export-svg", "diagram-1")
                .param("filename", ""))
            .andExpect(status().isBadRequest());
    }

    @Test
    void exportAllDiagramsAsSvg_missingFilename_returns400() throws Exception {
        // Act & Assert
        mockMvc.perform(get("/api/model/diagrams/export-all-svg"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void exportDiagramAsSvg_nonExistentDiagram_returns404() throws Exception {
        // Arrange
        String diagramId = "non-existent";
        String filename = "test-model";

        when(diagramExportService.exportSingleDiagramSvg(filename, diagramId))
            .thenThrow(new ResourceNotFoundException("Diagram not found: " + diagramId));

        // Act & Assert
        mockMvc.perform(get("/api/model/diagrams/{diagramId}/export-svg", diagramId)
                .param("filename", filename))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value("Diagram not found: " + diagramId));
    }

    @Test
    void exportDiagramAsSvg_contentDispositionContainsCorrectFilename() throws Exception {
        // Arrange
        String diagramId = "diagram-1";
        String filename = "test-model";
        String expectedDownloadName = "my-project_architecture-overview_20240109-153045.svg";

        Path svgFile = tempDir.resolve(expectedDownloadName);
        Files.writeString(svgFile, "<svg></svg>");

        DiagramExportService.SingleDiagramExportResult result =
            new DiagramExportService.SingleDiagramExportResult(svgFile, expectedDownloadName);

        when(diagramExportService.exportSingleDiagramSvg(filename, diagramId)).thenReturn(result);

        // Act & Assert
        mockMvc.perform(get("/api/model/diagrams/{diagramId}/export-svg", diagramId)
                .param("filename", filename))
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Disposition",
                org.hamcrest.Matchers.containsString(expectedDownloadName)));
    }
}
