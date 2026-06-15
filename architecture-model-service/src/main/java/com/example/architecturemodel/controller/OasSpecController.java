package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.oas.SaveOasSpecRequestDto;
import com.example.architecturemodel.model.dto.oas.SaveOasSpecSummaryDto;
import com.example.architecturemodel.service.OasSpecService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

/**
 * REST Controller for OpenAPI specification operations.
 * Provides endpoint to save OAS specs for interfaces.
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/interfaces")
@RequiredArgsConstructor
@Slf4j
public class OasSpecController {

    private final OasSpecService oasSpecService;

    /**
     * PUT /api/model/interfaces/{id}/oas?filename={filename}
     * Save an OpenAPI specification for the given interface.
     *
     * @param id the interface ID
     * @param filename the architecture filename (required query param)
     * @param request the save request containing format and content
     * @return SaveOasSpecSummaryDto with 201 Created (new file) or 200 OK (overwrite)
     * @throws IllegalArgumentException if validation fails (400)
     * @throws com.example.architecturemodel.exception.ResourceNotFoundException if interface/filename not found (404)
     */
    @PutMapping("/{id}/oas")
    public ResponseEntity<SaveOasSpecSummaryDto> saveOasSpec(
            @PathVariable String id,
            @RequestParam String filename,
            @RequestBody SaveOasSpecRequestDto request) {

        log.debug("PUT /api/model/interfaces/{}/oas?filename={}", id, filename);

        // Validate path variable
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("Interface ID is required");
        }

        // Validate query param
        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Filename is required");
        }

        // Call service
        SaveOasSpecSummaryDto summary = oasSpecService.saveOasSpec(id, filename, request);

        // Return 201 if created, 200 if overwritten
        HttpStatus status = summary.created() ? HttpStatus.CREATED : HttpStatus.OK;
        return ResponseEntity.status(status).body(summary);
    }
}
