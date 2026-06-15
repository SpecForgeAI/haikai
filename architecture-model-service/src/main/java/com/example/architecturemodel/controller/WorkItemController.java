package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.WorkItemDto;
import com.example.architecturemodel.model.dto.WorkItemStatsDto;
import com.example.architecturemodel.service.WorkItemService;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * REST Controller for Work Item endpoints.
 *
 * Provides CRUD access to hierarchical work items (Initiative, Epic, Feature, Story)
 * within a project.
 *
 * Base path: /api/model/projects/{projectId}/work-items
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/work-items")
@RequiredArgsConstructor
@Slf4j
public class WorkItemController {

    private final WorkItemService workItemService;

    /**
     * Valid work item types for search endpoint validation.
     * Spec 2026-03-04: What's Next v1-C -- Work item picker search.
     */
    private static final Set<String> VALID_SEARCH_TYPES = Set.of(
        "INITIATIVE", "EPIC", "FEATURE", "STORY"
    );

    /**
     * Request body for the defer-toggle endpoint. snake_case wire (the global
     * AMS default); a single boxed {@link Boolean} so an absent value is a
     * client error rather than a silent default.
     *
     * Spec: Migrate Button + Migration Execution Driver (2026-06-14, Spec 3 of 4) -- TG1.
     */
    public record SetDeferredRequest(
        @JsonProperty("deferred")
        Boolean deferred
    ) {}

    /**
     * GET /api/model/projects/{projectId}/work-items
     *
     * List all work items for a project with optional filtering.
     * Results are returned in deterministic order (sort_order, created_at, id).
     *
     * @param projectId the project ID
     * @param type optional filter by type (INITIATIVE, EPIC, FEATURE, STORY)
     * @param parentId optional filter by parent ID
     * @return list of work items
     */
    @GetMapping
    public ResponseEntity<List<WorkItemDto>> listWorkItems(
            @PathVariable UUID projectId,
            @RequestParam(name = "type", required = false) String type,
            @RequestParam(name = "parent_id", required = false) UUID parentId) {
        log.debug("GET /api/model/projects/{}/work-items?type={}&parent_id={}",
            projectId, type, parentId);

        List<WorkItemDto> workItems = workItemService.getWorkItems(projectId, type, parentId);
        return ResponseEntity.ok(workItems);
    }

    /**
     * GET /api/model/projects/{projectId}/work-items/search
     *
     * Search work items by title or description using case-insensitive partial matching.
     * Spec 2026-03-04: What's Next v1-C -- Work item picker search.
     *
     * @param projectId the project ID
     * @param q the search query (must be non-blank)
     * @param types the list of work item types to search within (must be valid types)
     * @param limit maximum number of results (1-50, defaults to 10)
     * @return list of matching work items
     */
    @GetMapping("/search")
    public ResponseEntity<?> searchWorkItems(
            @PathVariable UUID projectId,
            @RequestParam String q,
            @RequestParam List<String> types,
            @RequestParam(defaultValue = "10") int limit) {
        log.debug("GET /api/model/projects/{}/work-items/search?q={}&types={}&limit={}",
            projectId, q, types, limit);

        // Validate: q must be non-blank
        if (q == null || q.isBlank()) {
            return ResponseEntity.badRequest().body("Query parameter 'q' must be non-blank");
        }

        // Validate: types must only contain valid values
        for (String type : types) {
            if (!VALID_SEARCH_TYPES.contains(type)) {
                return ResponseEntity.badRequest().body(
                    "Invalid type: " + type + ". Allowed values: " + VALID_SEARCH_TYPES);
            }
        }

        // Validate: limit must be between 1 and 50
        if (limit < 1 || limit > 50) {
            return ResponseEntity.badRequest().body(
                "Parameter 'limit' must be between 1 and 50");
        }

        List<WorkItemDto> results = workItemService.searchWorkItems(projectId, q, types, limit);
        return ResponseEntity.ok(results);
    }

    /**
     * GET /api/model/projects/{projectId}/work-items/stats
     *
     * Get work item statistics for a project.
     * Returns counts grouped by type and status, plus a count of stories with
     * acceptance criteria (non-empty description).
     *
     * Spec 2026-03-06: Dashboard Real Data -- Work Item Stats Endpoint.
     *
     * @param projectId the project ID
     * @return the work item statistics
     */
    @GetMapping("/stats")
    public ResponseEntity<WorkItemStatsDto> getStats(
            @PathVariable UUID projectId) {
        log.debug("GET /api/model/projects/{}/work-items/stats", projectId);

        WorkItemStatsDto stats = workItemService.getWorkItemStats(projectId);
        return ResponseEntity.ok(stats);
    }

    /**
     * GET /api/model/projects/{projectId}/work-items/{id}
     *
     * Get a single work item by ID.
     *
     * @param projectId the project ID
     * @param id the work item ID
     * @return the work item
     */
    @GetMapping("/{id}")
    public ResponseEntity<WorkItemDto> getWorkItem(
            @PathVariable UUID projectId,
            @PathVariable UUID id) {
        log.debug("GET /api/model/projects/{}/work-items/{}", projectId, id);

        WorkItemDto workItem = workItemService.getWorkItem(id);
        return ResponseEntity.ok(workItem);
    }

    /**
     * POST /api/model/projects/{projectId}/work-items
     *
     * Create a new work item.
     *
     * @param projectId the project ID
     * @param dto the work item to create
     * @return the created work item with 201 Created status
     */
    @PostMapping
    public ResponseEntity<WorkItemDto> createWorkItem(
            @PathVariable UUID projectId,
            @RequestBody WorkItemDto dto) {
        log.debug("POST /api/model/projects/{}/work-items", projectId);

        WorkItemDto created = workItemService.createWorkItem(projectId, dto);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /**
     * PUT /api/model/projects/{projectId}/work-items/{id}
     *
     * Update an existing work item.
     *
     * @param projectId the project ID
     * @param id the work item ID
     * @param dto the updated work item
     * @return the updated work item
     */
    @PutMapping("/{id}")
    public ResponseEntity<WorkItemDto> updateWorkItem(
            @PathVariable UUID projectId,
            @PathVariable UUID id,
            @RequestBody WorkItemDto dto) {
        log.debug("PUT /api/model/projects/{}/work-items/{}", projectId, id);

        WorkItemDto updated = workItemService.updateWorkItem(id, dto);
        return ResponseEntity.ok(updated);
    }

    /**
     * PATCH /api/model/projects/{projectId}/work-items/{id}/deferred
     *
     * Set or clear the {@code deferred} flag on a work item (CD-7). This is the
     * focused, explicit toggle the frontend "defer this story" / "un-defer"
     * action calls and the value the Migrate readiness predicate + the gateway
     * run-sequence builder read. Defer = implementation-EXCLUSION ONLY; it never
     * removes the story from reconciliation scope (Spec 4).
     *
     * <p>Body: {@code { "deferred": true | false }} (snake_case wire). A missing
     * {@code deferred} value is a 400 (do not silently default a toggle).</p>
     *
     * <p>Spec: Migrate Button + Migration Execution Driver (2026-06-14, Spec 3
     * of 4) -- Task Group 1.</p>
     *
     * @param projectId the project ID
     * @param id the work item ID
     * @param request the defer toggle body
     * @return the updated work item
     */
    @PatchMapping("/{id}/deferred")
    public ResponseEntity<?> setDeferred(
            @PathVariable UUID projectId,
            @PathVariable UUID id,
            @RequestBody SetDeferredRequest request) {
        log.debug("PATCH /api/model/projects/{}/work-items/{}/deferred deferred={}",
            projectId, id, request == null ? null : request.deferred());

        if (request == null || request.deferred() == null) {
            return ResponseEntity.badRequest().body("Field 'deferred' is required");
        }

        WorkItemDto updated = workItemService.setDeferred(id, request.deferred());
        return ResponseEntity.ok(updated);
    }

    /**
     * DELETE /api/model/projects/{projectId}/work-items/{id}
     *
     * Delete a work item. Children are deleted via ON DELETE CASCADE in the database.
     *
     * @param projectId the project ID
     * @param id the work item ID
     * @return 204 No Content on success
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteWorkItem(
            @PathVariable UUID projectId,
            @PathVariable UUID id) {
        log.debug("DELETE /api/model/projects/{}/work-items/{}", projectId, id);

        workItemService.deleteWorkItem(id);
        return ResponseEntity.noContent().build();
    }
}
