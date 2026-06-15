package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.diagram.DiagramDto;
import com.example.architecturemodel.service.export.DiagramCanonicalizer;
import com.example.architecturemodel.service.export.DiagramSvgRenderer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Service for exporting diagrams to SVG format.
 *
 * Handles:
 * - Single diagram export to SVG file
 * - All diagrams export to ZIP archive containing SVG files
 * - File path construction based on project parent folder
 * - Filename normalization (whitespace to hyphen)
 *
 * Spec: Export Diagrams as SVG
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiagramExportService {

    private final ModelService modelService;
    private final ProjectService projectService;
    private final DiagramCanonicalizer diagramCanonicalizer;
    private final DiagramSvgRenderer diagramSvgRenderer;

    private static final DateTimeFormatter TIMESTAMP_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");
    private static final String EXPORTS_SUBDIR = "exports";
    private static final String DIAGRAMS_SUBDIR = "diagrams";

    /**
     * Result record for single diagram export.
     *
     * @param path The path where the SVG file was written
     * @param downloadFileName The suggested download filename
     */
    public record SingleDiagramExportResult(Path path, String downloadFileName) {}

    /**
     * Result record for all diagrams ZIP export.
     *
     * @param zipBytes The ZIP archive content as byte array
     * @param downloadFileName The suggested download filename for the ZIP
     */
    public record AllDiagramsExportResult(byte[] zipBytes, String downloadFileName) {}

    /**
     * Exports a single diagram to SVG file.
     *
     * Steps:
     * 1. Load active project via ProjectService.getActiveProject()
     * 2. Load model via ModelService.loadModel(filename)
     * 3. Find diagram by id; throw ResourceNotFoundException if not found
     * 4. Canonicalize diagram via DiagramCanonicalizer.canonicalize()
     * 5. Render SVG via DiagramSvgRenderer.renderToSvg()
     * 6. Write to [projectParentFolder]/exports/diagrams/
     * 7. Filename pattern: {projectNameNorm}_{diagramNameNorm}_{timestamp}.svg
     *
     * @param filename The model filename
     * @param diagramId The ID of the diagram to export
     * @return SingleDiagramExportResult containing path and download filename
     * @throws ResourceNotFoundException if diagram not found
     * @throws IllegalArgumentException if parameters are invalid
     */
    public SingleDiagramExportResult exportSingleDiagramSvg(String filename, String diagramId) {
        log.info("Exporting single diagram to SVG: filename={}, diagramId={}", filename, diagramId);

        // Validate parameters
        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Filename is required");
        }
        if (diagramId == null || diagramId.isBlank()) {
            throw new IllegalArgumentException("Diagram ID is required");
        }

        // Load active project
        ProjectDto project = projectService.getActiveProject();
        String projectParentFolder = project.projectParentFolder();
        String projectName = project.name();

        // Load model
        ArchitectureModelDto model = modelService.loadModel(filename);

        // Find diagram by id
        DiagramDto diagram = model.diagrams().stream()
            .filter(d -> diagramId.equals(d.id()))
            .findFirst()
            .orElseThrow(() -> new ResourceNotFoundException("Diagram not found: " + diagramId));

        // Canonicalize diagram
        DiagramDto canonicalDiagram = diagramCanonicalizer.canonicalize(diagram);

        // Render to SVG
        String svgContent = diagramSvgRenderer.renderToSvg(canonicalDiagram);

        // Build export path
        Path exportDir = getExportDirectory(projectParentFolder);
        String timestamp = LocalDateTime.now().format(TIMESTAMP_FORMAT);
        String normalizedProjectName = normalizeName(projectName);
        String normalizedDiagramName = normalizeName(diagram.name());
        String svgFilename = String.format("%s_%s_%s.svg",
            normalizedProjectName, normalizedDiagramName, timestamp);

        Path svgPath = exportDir.resolve(svgFilename);

        // Write SVG file
        try {
            Files.writeString(svgPath, svgContent, StandardCharsets.UTF_8);
            log.info("Wrote SVG to: {}", svgPath);
        } catch (IOException e) {
            log.error("Failed to write SVG file: {}", svgPath, e);
            throw new RuntimeException("Failed to write SVG file: " + e.getMessage(), e);
        }

        return new SingleDiagramExportResult(svgPath, svgFilename);
    }

    /**
     * Exports all diagrams in the model to a ZIP archive containing SVG files.
     *
     * Steps:
     * 1. Load active project via ProjectService.getActiveProject()
     * 2. Load model via ModelService.loadModel(filename)
     * 3. For each diagram: canonicalize and render to SVG
     * 4. Write individual SVG files to disk
     * 5. Build ZIP in-memory containing all SVG files
     * 6. ZIP filename pattern: {projectNameNorm}_all-diagrams_{timestamp}.zip
     *
     * @param filename The model filename
     * @return AllDiagramsExportResult containing ZIP bytes and download filename
     * @throws IllegalArgumentException if parameters are invalid
     */
    public AllDiagramsExportResult exportAllDiagramsAsZip(String filename) {
        log.info("Exporting all diagrams to ZIP: filename={}", filename);

        // Validate parameters
        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Filename is required");
        }

        // Load active project
        ProjectDto project = projectService.getActiveProject();
        String projectParentFolder = project.projectParentFolder();
        String projectName = project.name();

        // Load model
        ArchitectureModelDto model = modelService.loadModel(filename);
        List<DiagramDto> diagrams = model.diagrams();

        if (diagrams == null || diagrams.isEmpty()) {
            log.info("No diagrams to export");
            // Return empty ZIP
            return createEmptyZip(projectName);
        }

        // Build export path
        Path exportDir = getExportDirectory(projectParentFolder);
        String timestamp = LocalDateTime.now().format(TIMESTAMP_FORMAT);
        String normalizedProjectName = normalizeName(projectName);

        // Create ZIP in memory
        ByteArrayOutputStream baos = new ByteArrayOutputStream();

        try (ZipOutputStream zos = new ZipOutputStream(baos)) {
            int index = 1;
            for (DiagramDto diagram : diagrams) {
                // Canonicalize diagram
                DiagramDto canonicalDiagram = diagramCanonicalizer.canonicalize(diagram);

                // Render to SVG
                String svgContent = diagramSvgRenderer.renderToSvg(canonicalDiagram);

                // Create SVG filename for this diagram
                String normalizedDiagramName = normalizeName(diagram.name());
                String svgFilename = String.format("%s_%s_%s.svg",
                    normalizedProjectName, normalizedDiagramName, timestamp);

                // Write SVG file to disk
                Path svgPath = exportDir.resolve(svgFilename);
                Files.writeString(svgPath, svgContent, StandardCharsets.UTF_8);
                log.debug("Wrote SVG to: {}", svgPath);

                // Add to ZIP
                ZipEntry entry = new ZipEntry(svgFilename);
                zos.putNextEntry(entry);
                zos.write(svgContent.getBytes(StandardCharsets.UTF_8));
                zos.closeEntry();

                index++;
            }
        } catch (IOException e) {
            log.error("Failed to create ZIP archive", e);
            throw new RuntimeException("Failed to create ZIP archive: " + e.getMessage(), e);
        }

        String zipFilename = String.format("%s_all-diagrams_%s.zip",
            normalizedProjectName, timestamp);

        log.info("Created ZIP with {} diagrams: {}", diagrams.size(), zipFilename);

        return new AllDiagramsExportResult(baos.toByteArray(), zipFilename);
    }

    /**
     * Gets or creates the export directory.
     *
     * Path: [projectParentFolder]/exports/diagrams/
     *
     * @param projectParentFolder The project's parent folder
     * @return Path to the export directory
     */
    private Path getExportDirectory(String projectParentFolder) {
        Path exportDir = Paths.get(projectParentFolder, EXPORTS_SUBDIR, DIAGRAMS_SUBDIR);

        try {
            if (!Files.exists(exportDir)) {
                Files.createDirectories(exportDir);
                log.info("Created export directory: {}", exportDir);
            }
        } catch (IOException e) {
            log.error("Failed to create export directory: {}", exportDir, e);
            throw new RuntimeException("Failed to create export directory: " + e.getMessage(), e);
        }

        return exportDir;
    }

    /**
     * Normalizes a name for use in filenames.
     *
     * Replaces whitespace with hyphens, removes special characters.
     *
     * @param name The name to normalize
     * @return Normalized name suitable for filenames
     */
    private String normalizeName(String name) {
        if (name == null || name.isBlank()) {
            return "unnamed";
        }
        return name.trim()
            .replaceAll("\\s+", "-")        // Replace whitespace with hyphens
            .replaceAll("[^a-zA-Z0-9\\-_]", "") // Remove special characters
            .toLowerCase();
    }

    /**
     * Creates an empty ZIP for when there are no diagrams.
     */
    private AllDiagramsExportResult createEmptyZip(String projectName) {
        String timestamp = LocalDateTime.now().format(TIMESTAMP_FORMAT);
        String normalizedProjectName = normalizeName(projectName);
        String zipFilename = String.format("%s_all-diagrams_%s.zip",
            normalizedProjectName, timestamp);

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(baos)) {
            // Create an empty ZIP by just closing the stream
        } catch (IOException e) {
            throw new RuntimeException("Failed to create empty ZIP", e);
        }

        return new AllDiagramsExportResult(baos.toByteArray(), zipFilename);
    }
}
