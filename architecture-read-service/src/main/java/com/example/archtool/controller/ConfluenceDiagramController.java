package com.example.archtool.controller;

import com.example.archtool.config.ConfluenceProperties;
import com.example.archtool.model.dto.ConfluenceDiagramResponse;
import com.example.archtool.model.dto.ErrorResponse;
import com.example.archtool.service.ConfluenceDiagramService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * REST controller for fetching draw.io diagrams from Confluence pages.
 *
 * <p>This controller provides the main API endpoint for retrieving and parsing
 * draw.io diagrams from Confluence. It supports fetching diagrams from a single
 * page or recursively from a page hierarchy.</p>
 *
 * <p>API Endpoints:</p>
 * <ul>
 *   <li>GET /api/confluence/diagrams - Fetch diagrams from Confluence page(s)</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/confluence")
public class ConfluenceDiagramController {

    private static final Logger log = LoggerFactory.getLogger(ConfluenceDiagramController.class);

    private final ConfluenceDiagramService confluenceDiagramService;
    private final ConfluenceProperties confluenceProperties;

    /**
     * Creates a new ConfluenceDiagramController with the required dependencies.
     *
     * @param confluenceDiagramService the service for fetching and parsing diagrams
     * @param confluenceProperties     the configuration properties for Confluence
     */
    public ConfluenceDiagramController(
            ConfluenceDiagramService confluenceDiagramService,
            ConfluenceProperties confluenceProperties) {
        this.confluenceDiagramService = confluenceDiagramService;
        this.confluenceProperties = confluenceProperties;
    }

    /**
     * Fetches draw.io diagrams from the specified Confluence page.
     *
     * <p>This endpoint retrieves all draw.io diagram attachments from the specified
     * Confluence page, parses them into a neutral graph representation, and returns
     * structured JSON with nodes, edges, geometry, and styles.</p>
     *
     * <p>When {@code includeAllChildPages} is true, the endpoint will also recursively
     * fetch diagrams from child pages up to the specified {@code maxDepth}.</p>
     *
     * @param pageId               the Confluence page ID (required)
     * @param includeAllChildPages whether to include diagrams from descendant pages (default: false)
     * @param maxDepth             maximum depth for child page traversal (optional, uses config default)
     * @return ResponseEntity containing the diagrams response or error
     */
    @GetMapping("/diagrams")
    public ResponseEntity<?> getDiagrams(
            @RequestParam(required = false) String pageId,
            @RequestParam(defaultValue = "false") boolean includeAllChildPages,
            @RequestParam(required = false) Integer maxDepth) {

        // Log incoming request parameters (excluding any sensitive data)
        log.info("Received diagram request: pageId={}, includeAllChildPages={}, maxDepth={}",
            pageId, includeAllChildPages, maxDepth);

        // Validate required pageId parameter
        if (pageId == null || pageId.isBlank()) {
            log.warn("Request rejected: pageId is required");
            ErrorResponse errorResponse = ErrorResponse.of(
                ErrorResponse.BAD_REQUEST,
                "pageId is required"
            );
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorResponse);
        }

        // Validate maxDepth if provided
        if (maxDepth != null && maxDepth <= 0) {
            log.warn("Request rejected: maxDepth must be positive, received: {}", maxDepth);
            ErrorResponse errorResponse = ErrorResponse.of(
                ErrorResponse.BAD_REQUEST,
                "maxDepth must be a positive integer"
            );
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorResponse);
        }

        // Use configuration default for maxDepth if not provided
        int effectiveMaxDepth = maxDepth != null ? maxDepth : confluenceProperties.maxPageDepth();

        log.debug("Processing request with effectiveMaxDepth={}", effectiveMaxDepth);

        // Call the service to fetch diagrams
        ConfluenceDiagramResponse response = confluenceDiagramService.fetchDiagrams(
            pageId,
            includeAllChildPages,
            effectiveMaxDepth
        );

        // Log response status
        log.info("Request completed: pageId={}, pagesProcessed={}, diagramsFound={}",
            pageId,
            response.summary().totalPages(),
            response.summary().totalDiagrams());

        return ResponseEntity.ok(response);
    }
}
