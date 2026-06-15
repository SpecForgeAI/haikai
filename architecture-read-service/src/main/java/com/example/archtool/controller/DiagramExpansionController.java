package com.example.archtool.controller;

import com.example.archtool.model.dto.ErrorResponse;
import com.example.archtool.model.dto.diagram.AdvancedAddRequest;
import com.example.archtool.model.dto.diagram.AdvancedAddResponse;
import com.example.archtool.service.DiagramExpansionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * REST controller for diagram expansion operations.
 *
 * <p>This controller provides the API endpoint for the Advanced Add feature,
 * which allows users to add a root entity along with its related entities
 * in a single operation.</p>
 *
 * <p>API Endpoints:</p>
 * <ul>
 *   <li>POST /api/diagram/advanced-add-expansion - Compute nodes/edges for Advanced Add</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/diagram")
public class DiagramExpansionController {

    private static final Logger log = LoggerFactory.getLogger(DiagramExpansionController.class);

    private final DiagramExpansionService diagramExpansionService;

    /**
     * Creates a new DiagramExpansionController with the required dependencies.
     *
     * @param diagramExpansionService the service for computing diagram expansions
     */
    public DiagramExpansionController(DiagramExpansionService diagramExpansionService) {
        this.diagramExpansionService = diagramExpansionService;
    }

    /**
     * Computes the nodes and edges to add for an Advanced Add operation.
     *
     * <p>This endpoint takes the root entity type and ID, along with the user's
     * relationship selections from the Advanced Add dialog, and returns a list
     * of nodes and edges that should be added to the diagram.</p>
     *
     * <p>The response includes flags indicating which entities/edges already
     * exist on the diagram, allowing the frontend to avoid duplicates.</p>
     *
     * <p>Request body example:</p>
     * <pre>
     * {
     *   "rootEntityType": "APPLICATION",
     *   "rootEntityId": "app-123",
     *   "diagramId": "diag-456",
     *   "selections": [
     *     {
     *       "relationshipType": "app_components",
     *       "direction": "CHILD",
     *       "depth": 1,
     *       "selectedEntityIds": ["ac-1", "ac-2"]
     *     }
     *   ]
     * }
     * </pre>
     *
     * <p>Response example:</p>
     * <pre>
     * {
     *   "nodes": [
     *     {
     *       "entityType": "APPLICATION",
     *       "entityId": "app-123",
     *       "entityName": "My Application",
     *       "alreadyOnDiagram": false,
     *       "parentEntityId": null
     *     },
     *     {
     *       "entityType": "APP_COMPONENT",
     *       "entityId": "ac-1",
     *       "entityName": "Component 1",
     *       "alreadyOnDiagram": false,
     *       "parentEntityId": "app-123"
     *     }
     *   ],
     *   "edges": []
     * }
     * </pre>
     *
     * @param request the Advanced Add request containing root entity and selections
     * @param metaModel the meta-model data (passed as request body alongside request)
     * @param diagramData the current diagram state (passed as request body)
     * @return ResponseEntity containing the expansion response or error
     */
    @PostMapping("/advanced-add-expansion")
    public ResponseEntity<?> computeAdvancedAddExpansion(
        @RequestBody AdvancedAddExpansionRequestBody requestBody
    ) {
        log.info("Received advanced-add-expansion request: rootEntityType={}, rootEntityId={}, diagramId={}",
            requestBody.request().rootEntityType(),
            requestBody.request().rootEntityId(),
            requestBody.request().diagramId());

        try {
            // Validate the request
            if (requestBody.request() == null) {
                return badRequest("request is required");
            }

            requestBody.request().validate();

            if (requestBody.metaModel() == null) {
                return badRequest("metaModel is required");
            }

            if (requestBody.diagramData() == null) {
                return badRequest("diagramData is required");
            }

            // Compute the expansion
            AdvancedAddResponse response = diagramExpansionService.computeExpansion(
                requestBody.request(),
                requestBody.metaModel(),
                requestBody.diagramData()
            );

            log.info("Expansion computed successfully: {} nodes, {} edges (new: {}, {})",
                response.nodes().size(),
                response.edges().size(),
                response.newNodeCount(),
                response.newEdgeCount());

            return ResponseEntity.ok(response);

        } catch (IllegalArgumentException e) {
            log.warn("Invalid request: {}", e.getMessage());
            return badRequest(e.getMessage());

        } catch (Exception e) {
            log.error("Error computing expansion", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ErrorResponse.of(ErrorResponse.INTERNAL_ERROR, "Failed to compute expansion: " + e.getMessage()));
        }
    }

    /**
     * Creates a bad request response with the given message.
     */
    private ResponseEntity<?> badRequest(String message) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ErrorResponse.of(ErrorResponse.BAD_REQUEST, message));
    }

    /**
     * Request body for the advanced-add-expansion endpoint.
     *
     * <p>Combines the AdvancedAddRequest with the meta-model and diagram data
     * needed to compute the expansion.</p>
     *
     * @param request The Advanced Add request parameters
     * @param metaModel The meta-model containing entities and relationships
     * @param diagramData The current diagram state with existing nodes/edges
     */
    public record AdvancedAddExpansionRequestBody(
        AdvancedAddRequest request,
        Map<String, Object> metaModel,
        Map<String, Object> diagramData
    ) {}
}
