package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.entity.SequenceDiagramDto;
import com.example.architecturemodel.service.SequenceDiagramService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * REST Controller for Sequence Diagram endpoints.
 * Provides CRUD access to sequence diagrams with fully-nested DTOs.
 *
 * DEPRECATED: These endpoints are deprecated and will be removed in a future version.
 * Use the generic diagram API with typed_content instead:
 * - GET /api/model?filename={filename} - returns diagrams with typed_content
 * - PUT /api/model?filename={filename} - saves diagrams with typed_content
 *
 * These deprecated endpoints now read/write from diagrams.typed_content_json instead
 * of the sequence_* tables.
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/sequence-diagrams")
@RequiredArgsConstructor
@Slf4j
public class SequenceDiagramController {

    private final SequenceDiagramService sequenceDiagramService;

    /**
     * Deprecation date for these endpoints.
     * Using a future date to signal planned removal.
     */
    private static final String SUNSET_DATE = "Sat, 01 Mar 2025 00:00:00 GMT";

    /**
     * GET /api/sequence-diagrams/{id}
     * Retrieve a fully-nested SequenceDiagramDto by ID.
     *
     * DEPRECATED: This endpoint is deprecated. Use the generic diagram API instead.
     * The diagram content is now read from diagrams.typed_content_json.
     *
     * @param id The diagram ID (same as the diagram ID in the diagrams table)
     * @return ResponseEntity containing the SequenceDiagramDto with deprecation headers
     * @throws IllegalArgumentException if id is blank or diagram is not a Sequence type
     * @throws ResourceNotFoundException if diagram not found (handled by GlobalExceptionHandler)
     */
    @GetMapping("/{id}")
    public ResponseEntity<SequenceDiagramDto> getSequenceDiagram(@PathVariable String id) {
        log.debug("GET /api/sequence-diagrams/{} (deprecated endpoint)", id);

        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("Sequence diagram ID cannot be blank");
        }

        SequenceDiagramDto diagram = sequenceDiagramService.getSequenceDiagram(id);

        return ResponseEntity.ok()
            .headers(createDeprecationHeaders())
            .body(diagram);
    }

    /**
     * GET /api/sequence-diagrams?model_file_id={modelFileId}
     * List all sequence diagrams for a given model file.
     *
     * DEPRECATED: This endpoint is deprecated. Use the generic diagram API instead.
     *
     * @param modelFileId The model file ID to filter by
     * @return ResponseEntity containing a list of SequenceDiagramDto with deprecation headers
     * @throws IllegalArgumentException if modelFileId is blank
     */
    @GetMapping
    public ResponseEntity<List<SequenceDiagramDto>> getSequenceDiagramsByModelFileId(
            @RequestParam(name = "model_file_id") String modelFileId) {
        log.debug("GET /api/sequence-diagrams?model_file_id={} (deprecated endpoint)", modelFileId);

        if (modelFileId == null || modelFileId.isBlank()) {
            throw new IllegalArgumentException("Model file ID cannot be blank");
        }

        List<SequenceDiagramDto> diagrams = sequenceDiagramService.getSequenceDiagramsByModelFileId(modelFileId);

        return ResponseEntity.ok()
            .headers(createDeprecationHeaders())
            .body(diagrams);
    }

    /**
     * PUT /api/sequence-diagrams/{id}/content
     * Save the full content of a sequence diagram.
     *
     * DEPRECATED: This endpoint is deprecated. Use the generic diagram API instead.
     * The diagram content is now written to diagrams.typed_content_json.
     *
     * This endpoint wraps the incoming content in a typed_content envelope and
     * writes it to the diagrams table.
     *
     * @param id The diagram ID (same as the diagram ID in the diagrams table)
     * @param diagramDto The full SequenceDiagramDto with all children (participants, messages, fragments, operands, sequence_nodes)
     * @return ResponseEntity containing the updated SequenceDiagramDto with deprecation headers
     * @throws IllegalArgumentException if id is blank, validation fails, or diagram is not a Sequence type
     * @throws ResourceNotFoundException if diagram not found (handled by GlobalExceptionHandler)
     */
    @PutMapping("/{id}/content")
    public ResponseEntity<SequenceDiagramDto> saveSequenceDiagramContent(
            @PathVariable String id,
            @RequestBody SequenceDiagramDto diagramDto) {
        log.debug("PUT /api/sequence-diagrams/{}/content (deprecated endpoint)", id);

        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("Sequence diagram ID cannot be blank");
        }

        if (diagramDto == null) {
            throw new IllegalArgumentException("Request body cannot be null");
        }

        SequenceDiagramDto result = sequenceDiagramService.saveSequenceDiagramContent(id, diagramDto);

        return ResponseEntity.ok()
            .headers(createDeprecationHeaders())
            .body(result);
    }

    /**
     * Creates HTTP headers indicating that the endpoint is deprecated.
     *
     * @return HttpHeaders with Deprecation and Sunset headers
     */
    private HttpHeaders createDeprecationHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Deprecation", "true");
        headers.set("Sunset", SUNSET_DATE);
        headers.set("Link", "</api/model>; rel=\"successor-version\"");
        return headers;
    }
}
