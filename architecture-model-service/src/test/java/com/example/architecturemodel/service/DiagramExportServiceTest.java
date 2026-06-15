package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.diagram.DiagramDto;
import com.example.architecturemodel.model.dto.diagram.DiagramNodeDto;
import com.example.architecturemodel.service.export.DiagramCanonicalizer;
import com.example.architecturemodel.service.export.DiagramSvgRenderer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.nio.file.Path;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for DiagramExportService.
 * Spec: Export Diagrams as SVG - Task Group 2
 *
 * Tests the diagram export functionality including:
 * - Single diagram SVG export
 * - All diagrams ZIP export
 * - Filename normalization
 * - Error handling for non-existent diagrams
 */
@ExtendWith(MockitoExtension.class)
class DiagramExportServiceTest {

    @Mock
    private ModelService modelService;

    @Mock
    private ProjectService projectService;

    @Mock
    private DiagramCanonicalizer diagramCanonicalizer;

    @Mock
    private DiagramSvgRenderer diagramSvgRenderer;

    @TempDir
    Path tempDir;

    private DiagramExportService exportService;

    @BeforeEach
    void setUp() {
        exportService = new DiagramExportService(
            modelService, projectService, diagramCanonicalizer, diagramSvgRenderer
        );
    }

    @Test
    void exportSingleDiagramSvg_writesSvgFileAndReturnsResult() throws Exception {
        // Arrange
        String filename = "test-model";
        String diagramId = "diagram-1";
        String svgContent = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";

        ProjectDto project = createTestProject("Test Project", tempDir.toString());
        ArchitectureModelDto model = createModelWithDiagram(diagramId, "Architecture Diagram");
        DiagramDto diagram = model.diagrams().get(0);

        when(projectService.getActiveProject()).thenReturn(project);
        when(modelService.loadModel(filename)).thenReturn(model);
        when(diagramCanonicalizer.canonicalize(any(DiagramDto.class))).thenReturn(diagram);
        when(diagramSvgRenderer.renderToSvg(any(DiagramDto.class))).thenReturn(svgContent);

        // Act
        DiagramExportService.SingleDiagramExportResult result =
            exportService.exportSingleDiagramSvg(filename, diagramId);

        // Assert
        assertNotNull(result);
        assertNotNull(result.path());
        assertTrue(result.path().toString().contains("exports"));
        assertTrue(result.path().toString().contains("diagrams"));
        assertTrue(result.downloadFileName().endsWith(".svg"));
        assertTrue(result.downloadFileName().contains("test-project"));
        assertTrue(result.downloadFileName().contains("architecture-diagram"));
    }

    @Test
    void exportSingleDiagramSvg_throwsResourceNotFoundForNonExistentDiagram() {
        // Arrange
        String filename = "test-model";
        String nonExistentDiagramId = "non-existent-diagram";

        ProjectDto project = createTestProject("Test Project", tempDir.toString());
        ArchitectureModelDto model = createModelWithDiagram("diagram-1", "Test Diagram");

        when(projectService.getActiveProject()).thenReturn(project);
        when(modelService.loadModel(filename)).thenReturn(model);

        // Act & Assert
        ResourceNotFoundException exception = assertThrows(
            ResourceNotFoundException.class,
            () -> exportService.exportSingleDiagramSvg(filename, nonExistentDiagramId)
        );

        assertTrue(exception.getMessage().contains(nonExistentDiagramId));
    }

    @Test
    void exportAllDiagramsAsZip_createsZipWithAllDiagrams() throws Exception {
        // Arrange
        String filename = "test-model";
        String svgContent = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";

        ProjectDto project = createTestProject("Test Project", tempDir.toString());
        ArchitectureModelDto model = createModelWithMultipleDiagrams();

        when(projectService.getActiveProject()).thenReturn(project);
        when(modelService.loadModel(filename)).thenReturn(model);
        when(diagramCanonicalizer.canonicalize(any(DiagramDto.class))).thenAnswer(
            invocation -> invocation.getArgument(0)
        );
        when(diagramSvgRenderer.renderToSvg(any(DiagramDto.class))).thenReturn(svgContent);

        // Act
        DiagramExportService.AllDiagramsExportResult result =
            exportService.exportAllDiagramsAsZip(filename);

        // Assert
        assertNotNull(result);
        assertNotNull(result.zipBytes());
        assertTrue(result.zipBytes().length > 0);
        assertTrue(result.downloadFileName().endsWith(".zip"));
        assertTrue(result.downloadFileName().contains("all-diagrams"));

        // Verify ZIP contains expected entries
        List<String> zipEntries = getZipEntryNames(result.zipBytes());
        assertEquals(2, zipEntries.size(), "ZIP should contain 2 SVG files");
        assertTrue(zipEntries.stream().allMatch(name -> name.endsWith(".svg")),
            "All entries should be SVG files");
    }

    @Test
    void exportSingleDiagramSvg_normalizesFilenameWithWhitespace() throws Exception {
        // Arrange
        String filename = "test-model";
        String diagramId = "diagram-1";
        String svgContent = "<svg></svg>";

        // Project and diagram names with whitespace
        ProjectDto project = createTestProject("My Test Project", tempDir.toString());
        ArchitectureModelDto model = createModelWithDiagram(diagramId, "Application Architecture Overview");
        DiagramDto diagram = model.diagrams().get(0);

        when(projectService.getActiveProject()).thenReturn(project);
        when(modelService.loadModel(filename)).thenReturn(model);
        when(diagramCanonicalizer.canonicalize(any(DiagramDto.class))).thenReturn(diagram);
        when(diagramSvgRenderer.renderToSvg(any(DiagramDto.class))).thenReturn(svgContent);

        // Act
        DiagramExportService.SingleDiagramExportResult result =
            exportService.exportSingleDiagramSvg(filename, diagramId);

        // Assert - whitespace should be replaced with hyphens
        assertTrue(result.downloadFileName().contains("my-test-project"),
            "Project name whitespace should be replaced with hyphens");
        assertTrue(result.downloadFileName().contains("application-architecture-overview"),
            "Diagram name whitespace should be replaced with hyphens");
        assertFalse(result.downloadFileName().contains(" "),
            "Filename should not contain spaces");
    }

    @Test
    void exportSingleDiagramSvg_filenameContainsTimestamp() throws Exception {
        // Arrange
        String filename = "test-model";
        String diagramId = "diagram-1";
        String svgContent = "<svg></svg>";

        ProjectDto project = createTestProject("Project", tempDir.toString());
        ArchitectureModelDto model = createModelWithDiagram(diagramId, "Diagram");
        DiagramDto diagram = model.diagrams().get(0);

        when(projectService.getActiveProject()).thenReturn(project);
        when(modelService.loadModel(filename)).thenReturn(model);
        when(diagramCanonicalizer.canonicalize(any(DiagramDto.class))).thenReturn(diagram);
        when(diagramSvgRenderer.renderToSvg(any(DiagramDto.class))).thenReturn(svgContent);

        // Act
        DiagramExportService.SingleDiagramExportResult result =
            exportService.exportSingleDiagramSvg(filename, diagramId);

        // Assert - filename should contain timestamp in yyyyMMdd-HHmmss format
        // The pattern is: {projectName}_{diagramName}_{timestamp}.svg
        String downloadFileName = result.downloadFileName();
        // Extract timestamp part (should be between last _ and .svg)
        int lastUnderscore = downloadFileName.lastIndexOf('_');
        int dotSvg = downloadFileName.lastIndexOf(".svg");
        String timestamp = downloadFileName.substring(lastUnderscore + 1, dotSvg);

        // Timestamp format: yyyyMMdd-HHmmss (15 characters)
        assertEquals(15, timestamp.length(), "Timestamp should be 15 characters");
        assertTrue(timestamp.matches("\\d{8}-\\d{6}"),
            "Timestamp should match yyyyMMdd-HHmmss format");
    }

    @Test
    void exportSingleDiagramSvg_throwsIllegalArgumentForBlankFilename() {
        // Act & Assert
        assertThrows(IllegalArgumentException.class,
            () -> exportService.exportSingleDiagramSvg("", "diagram-1"));
        assertThrows(IllegalArgumentException.class,
            () -> exportService.exportSingleDiagramSvg(null, "diagram-1"));
    }

    @Test
    void exportSingleDiagramSvg_throwsIllegalArgumentForBlankDiagramId() {
        // Act & Assert
        assertThrows(IllegalArgumentException.class,
            () -> exportService.exportSingleDiagramSvg("test-model", ""));
        assertThrows(IllegalArgumentException.class,
            () -> exportService.exportSingleDiagramSvg("test-model", null));
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private ProjectDto createTestProject(String name, String parentFolder) {
        return new ProjectDto(
            UUID.randomUUID(),  // id
            name,               // name
            parentFolder,       // projectParentFolder
            null,               // projectHierarchy
            null,               // organisationId
            null,               // repoUrl
            true,               // isActive
            null,               // createdAt
            null                // updatedAt
        );
    }

    private ArchitectureModelDto createModelWithDiagram(String diagramId, String diagramName) {
        DiagramNodeDto node = new DiagramNodeDto(
            "node-1", "Application", "app-1",
            100.0, 100.0, 150.0, 75.0,
            false, 0, null, null, null, null, null,
            null, null, null, null,
            null, null, null, null, null, null, null, null, null, null,
            null, null
        );
        DiagramDto diagram = new DiagramDto(
            diagramId, diagramName, null, "General", null, null,
            List.of(node),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            null
        );

        return new ArchitectureModelDto(createEmptyMetaModel(), List.of(diagram));
    }

    private ArchitectureModelDto createModelWithMultipleDiagrams() {
        DiagramDto diagram1 = new DiagramDto(
            "diagram-1", "First Diagram", null, "General", null, null,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            null
        );
        DiagramDto diagram2 = new DiagramDto(
            "diagram-2", "Second Diagram", null, "General", null, null,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            null
        );

        return new ArchitectureModelDto(createEmptyMetaModel(), List.of(diagram1, diagram2));
    }

    private MetaModelDto createEmptyMetaModel() {
        // MetaModelEntitiesDto has 33 fields total
        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            Collections.emptyList(), // businessUsers
            Collections.emptyList(), // businessProcesses
            Collections.emptyList(), // processActivities
            Collections.emptyList(), // businessPoints
            Collections.emptyList(), // applications
            Collections.emptyList(), // appComponents
            Collections.emptyList(), // services
            Collections.emptyList(), // interfaces
            Collections.emptyList(), // endpoints
            Collections.emptyList(), // classes
            Collections.emptyList(), // methods
            Collections.emptyList(), // applicationPoints
            Collections.emptyList(), // logicalDataEntities
            Collections.emptyList(), // logicalDataAttributes
            Collections.emptyList(), // physicalDataEntities
            Collections.emptyList(), // physicalDataAttributes
            Collections.emptyList(), // dataEntityPoints
            Collections.emptyList(), // interactions
            Collections.emptyList(), // appBusinessPoints
            Collections.emptyList(), // events
            Collections.emptyList(), // states
            Collections.emptyList(), // stateTransitions
            Collections.emptyList(), // activities
            Collections.emptyList(), // activityFlows
            Collections.emptyList(), // activityPartitions
            Collections.emptyList(), // uiScreens
            Collections.emptyList(), // uiContracts
            Collections.emptyList(), // uiComponents
            Collections.emptyList(), // uiActions
            Collections.emptyList(), // businessLogics
            Collections.emptyList(), // packageSets
            Collections.emptyList(), // packages
            Collections.emptyList(), // packageSetDefaultRules
            Collections.emptyList(), // userJourneys
            Collections.emptyList(),  // activitySteps
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
        MetaModelRelationshipsDto relationships = new MetaModelRelationshipsDto(
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
            Collections.emptyList(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
        return new MetaModelDto(entities, relationships);
    }

    private List<String> getZipEntryNames(byte[] zipBytes) throws Exception {
        List<String> entries = new ArrayList<>();
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                entries.add(entry.getName());
            }
        }
        return entries;
    }
}
