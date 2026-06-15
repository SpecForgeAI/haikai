package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ProductSummaryDto;
import com.example.architecturemodel.service.ProductSummaryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST Controller for Product Summary endpoint.
 *
 * Provides a GET endpoint that returns a condensed hierarchical summary
 * of the Product Book of Work (Initiatives > Epics > Features) for a project.
 *
 * This endpoint is used by the Gateway during the Implementation Assistant
 * bootstrap phase to provide rich product context to the LLM.
 *
 * Base path: /api/projects/{projectId}/product-summary
 *
 * Spec: Implement Assistant Stage 3 - Bootstrap Phase
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/product-summary")
@RequiredArgsConstructor
@Slf4j
public class ProductSummaryController {

    private final ProductSummaryService productSummaryService;

    /**
     * GET /api/projects/{projectId}/product-summary
     *
     * Returns a condensed hierarchical summary of the Product Book of Work.
     * Structure: Initiatives > Epics > Features (Stories and detailed specs excluded).
     *
     * @param projectId the project ID (filename)
     * @return ProductSummaryDto with hierarchical work item structure
     * @throws IllegalArgumentException if projectId is blank
     */
    @GetMapping
    public ResponseEntity<ProductSummaryDto> getProductSummary(@PathVariable UUID projectId) {
        log.debug("GET /api/projects/{}/product-summary", projectId);

        ProductSummaryDto result = productSummaryService.getProductSummary(projectId);

        log.debug("Returning product summary with {} initiatives for project {}",
            result.initiatives() != null ? result.initiatives().size() : 0,
            projectId);

        return ResponseEntity.ok(result);
    }
}
