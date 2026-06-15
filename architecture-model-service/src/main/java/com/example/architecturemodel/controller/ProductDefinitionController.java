package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ProductDefinitionDto;
import com.example.architecturemodel.service.ProductDefinitionService;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST Controller for ProductDefinition operations.
 *
 * Provides GET and PUT endpoints for retrieving and upserting
 * a product definition per project.
 *
 * Spec: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)
 */
@RestController
@RequestMapping("/api/projects/{projectId}/product")
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ProductDefinitionController {

    private final ProductDefinitionService productDefinitionService;

    public ProductDefinitionController(ProductDefinitionService productDefinitionService) {
        this.productDefinitionService = productDefinitionService;
    }

    /**
     * Request body for saving a product definition.
     */
    public record SaveProductDefinitionRequest(
        @JsonProperty("productName") String productName
    ) {}

    /**
     * Gets the product definition for a project.
     *
     * GET /api/projects/{projectId}/product
     *
     * @param projectId The project UUID (path variable)
     * @return ProductDefinitionDto with HTTP 200 if found, or 404 if not found
     */
    @GetMapping
    public ResponseEntity<ProductDefinitionDto> getProductDefinition(@PathVariable UUID projectId) {
        log.debug("GET /api/projects/{}/product - Getting product definition", projectId);
        return productDefinitionService.getByProjectId(projectId)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Creates or updates the product definition for a project.
     *
     * PUT /api/projects/{projectId}/product
     * Body: { "productName": "..." }
     *
     * @param projectId The project UUID (path variable)
     * @param request The save product definition request
     * @return ProductDefinitionDto with HTTP 200 on success
     *         HTTP 400 if productName is blank
     */
    @PutMapping
    public ResponseEntity<ProductDefinitionDto> saveProductDefinition(
            @PathVariable UUID projectId,
            @RequestBody SaveProductDefinitionRequest request) {
        log.info("PUT /api/projects/{}/product - Saving product definition: productName='{}'",
            projectId, request.productName());
        ProductDefinitionDto saved = productDefinitionService.upsert(projectId, request.productName());
        return ResponseEntity.ok(saved);
    }
}
