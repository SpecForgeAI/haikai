package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.entity.PackageSetStandardsImportResultDto;
import com.example.architecturemodel.model.dto.entity.PackageSetStandardsImportStatusDto;
import com.example.architecturemodel.model.entity.PackageSetStandardsImportStatusEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.service.PackageSetStandardsImporter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

/**
 * Controller for Package Set Standards Import operations.
 *
 * Provides endpoints for:
 * - Importing package set standards from JSON files
 * - Retrieving import status
 *
 * Spec: Package Set Standards Import (Iteration 6)
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/standards/package-sets")
@RequiredArgsConstructor
@Slf4j
public class PackageSetStandardsController {

    private final PackageSetStandardsImporter importer;
    private final ModelFileRepository modelFileRepository;
    private final EntityMapper entityMapper;

    /**
     * POST /api/standards/package-sets/import
     *
     * Imports package set standards from company and/or project-level JSON files.
     * Uses the current active/default model file for import.
     *
     * Company-level path: {projectParentFolder}/standards/package-set-standards.json
     * Project-level path: {projectParentFolder}/{projectName}/standards/package-set-standards.json
     *
     * @return PackageSetStandardsImportResultDto with counts and status
     */
    @PostMapping("/import")
    public ResponseEntity<PackageSetStandardsImportResultDto> importStandards() {
        log.info("POST /api/standards/package-sets/import");

        // Get the current active/default model file ID
        String modelFileId = getActiveModelFileId();

        // Perform import
        PackageSetStandardsImportResultDto result = importer.importStandards(modelFileId);

        if (result.success()) {
            return ResponseEntity.ok(result);
        } else {
            // Return 400 Bad Request if import failed
            return ResponseEntity.badRequest().body(result);
        }
    }

    /**
     * GET /api/standards/package-sets/import-status
     *
     * Retrieves the last import status for the current active model file.
     *
     * @return PackageSetStandardsImportStatusDto or 404 if never imported
     */
    @GetMapping("/import-status")
    public ResponseEntity<PackageSetStandardsImportStatusDto> getImportStatus() {
        log.debug("GET /api/standards/package-sets/import-status");

        // Get the current active/default model file ID
        String modelFileId = getActiveModelFileId();

        // Get last import status
        return importer.getImportStatus(modelFileId)
                .map(status -> ResponseEntity.ok(entityMapper.toDto(status)))
                .orElseThrow(() -> new ResourceNotFoundException(
                        "No import status found for model file: " + modelFileId));
    }

    /**
     * Get the active/default model file ID.
     * Follows the same pattern as ModelService.loadModel() for consistency.
     *
     * @return The model file ID
     * @throws ResourceNotFoundException if no model files exist
     */
    private String getActiveModelFileId() {
        return modelFileRepository.findByIsDefaultTrue()
                .orElseGet(() -> modelFileRepository.findAll().stream()
                        .findFirst()
                        .orElseThrow(() -> new ResourceNotFoundException("No model files exist")))
                .getId();
    }
}
