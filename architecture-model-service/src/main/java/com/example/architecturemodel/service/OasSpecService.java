package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.oas.SaveOasSpecRequestDto;
import com.example.architecturemodel.model.dto.oas.SaveOasSpecSummaryDto;
import com.example.architecturemodel.model.entity.InterfaceEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.InterfaceRepository;
import com.example.architecturemodel.util.FilenameSanitizer;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.error.YAMLException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;

/**
 * Service for saving OpenAPI specifications to disk and updating interface records.
 * Handles validation, sanitization, atomic file writes, and database updates.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@Slf4j
public class OasSpecService {

    private final InterfaceRepository interfaceRepository;
    private final ModelFileRepository modelFileRepository;
    private final ObjectMapper objectMapper;
    private final Yaml yaml;
    private final Path parentFolder;
    private final long maxBytes;

    public OasSpecService(
            InterfaceRepository interfaceRepository,
            ModelFileRepository modelFileRepository,
            ObjectMapper objectMapper,
            @Value("${architectureModel.oas.parentFolder:./oas-specs}") String parentFolder,
            @Value("${architectureModel.oas.maxBytes:2097152}") long maxBytes
    ) {
        this.interfaceRepository = interfaceRepository;
        this.modelFileRepository = modelFileRepository;
        this.objectMapper = objectMapper;
        this.yaml = new Yaml();
        this.parentFolder = Path.of(parentFolder);
        this.maxBytes = maxBytes;
    }

    /**
     * Saves an OpenAPI specification to disk and updates the interface's spec_link.
     *
     * @param interfaceId the interface ID to save the spec for
     * @param filename the architecture filename (used as folder name)
     * @param request the save request containing format and content
     * @return summary of the save operation
     * @throws IllegalArgumentException if validation fails (400)
     * @throws ResourceNotFoundException if interface or filename not found (404)
     * @throws RuntimeException if IO errors occur (500)
     */
    @Transactional
    public SaveOasSpecSummaryDto saveOasSpec(String interfaceId, String filename, SaveOasSpecRequestDto request) {
        log.debug("Saving OAS spec for interfaceId={}, filename={}, format={}",
                interfaceId, filename, request.format());

        // Validate required fields
        validateRequest(request);

        // Validate format
        String format = request.format().toLowerCase();
        if (!format.equals("yaml") && !format.equals("json")) {
            throw new IllegalArgumentException("Format must be 'yaml' or 'json'");
        }

        // Validate content size
        byte[] contentBytes = request.contents().getBytes(StandardCharsets.UTF_8);
        if (contentBytes.length > maxBytes) {
            throw new IllegalArgumentException(
                    String.format("Content exceeds maximum allowed size of %d bytes", maxBytes));
        }

        // Validate content syntax
        validateContentSyntax(format, request.contents());

        // Find the interface
        InterfaceEntity interfaceEntity = interfaceRepository.findById(interfaceId)
                .orElseThrow(() -> new ResourceNotFoundException("Interface not found: " + interfaceId));

        // Validate filename exists in model_files
        ModelFileEntity modelFile = modelFileRepository.findByFilename(filename)
                .orElseThrow(() -> new ResourceNotFoundException("Model file not found: " + filename));

        // Sanitize paths
        String sanitizedFilename = FilenameSanitizer.sanitize(filename);
        String sanitizedInterfaceName = FilenameSanitizer.sanitize(interfaceEntity.getName());

        // Determine extension
        String extension = format.equals("yaml") ? ".yml" : ".json";

        // Construct path
        Path targetDir = parentFolder.resolve(sanitizedFilename);
        Path targetFile = targetDir.resolve(sanitizedInterfaceName + extension);

        // Validate path traversal
        FilenameSanitizer.validateNoPathTraversal(parentFolder, targetFile);

        // Check if file exists (for 200 vs 201 response)
        boolean fileExisted = Files.exists(targetFile);

        // Perform atomic write
        writeFileAtomically(targetDir, targetFile, contentBytes);

        // Get absolute path for spec_link
        String absolutePath = targetFile.toAbsolutePath().normalize().toString();

        // Update interface spec_link
        interfaceEntity.setSpecLink(absolutePath);
        interfaceRepository.save(interfaceEntity);

        log.info("Saved OAS spec for interface {} to {}, created={}",
                interfaceId, absolutePath, !fileExisted);

        return new SaveOasSpecSummaryDto(
                interfaceEntity.getId(),
                interfaceEntity.getName(),
                filename,
                format,
                absolutePath,
                absolutePath,
                Instant.now(),
                !fileExisted
        );
    }

    /**
     * Validates the request fields.
     */
    private void validateRequest(SaveOasSpecRequestDto request) {
        if (request.format() == null || request.format().isBlank()) {
            throw new IllegalArgumentException("Format is required");
        }
        if (request.contents() == null || request.contents().isBlank()) {
            throw new IllegalArgumentException("Contents is required");
        }
    }

    /**
     * Validates the content syntax based on format.
     */
    private void validateContentSyntax(String format, String contents) {
        if (format.equals("yaml")) {
            try {
                yaml.load(contents);
            } catch (YAMLException e) {
                throw new IllegalArgumentException("Invalid YAML syntax: " + e.getMessage());
            }
        } else if (format.equals("json")) {
            try {
                objectMapper.readTree(contents);
            } catch (Exception e) {
                throw new IllegalArgumentException("Invalid JSON syntax: " + e.getMessage());
            }
        }
    }

    /**
     * Writes content to file atomically using temp file and move.
     */
    private void writeFileAtomically(Path targetDir, Path targetFile, byte[] content) {
        try {
            // Create directories if needed
            Files.createDirectories(targetDir);

            // Write to temp file
            Path tempFile = targetDir.resolve(targetFile.getFileName().toString() + ".tmp");
            Files.write(tempFile, content, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);

            // Atomic move (with fallback)
            try {
                Files.move(tempFile, targetFile,
                        StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                // Fall back to non-atomic replace
                log.warn("Atomic move not supported, falling back to replace: {}", e.getMessage());
                Files.move(tempFile, targetFile, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            log.error("Failed to write OAS spec file: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to save OAS spec file: " + e.getMessage(), e);
        }
    }
}
