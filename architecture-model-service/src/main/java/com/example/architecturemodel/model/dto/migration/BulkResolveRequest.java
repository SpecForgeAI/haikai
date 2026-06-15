package com.example.architecturemodel.model.dto.migration;

import java.util.List;
import java.util.Map;

/**
 * POST body for the bulk-resolve endpoint
 * {@code POST /api/projects/{projectId}/missing-input-resolutions/bulk}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 4.</p>
 *
 * <p>Carries an enumerated list of {@link BulkResolveItem}s plus the
 * {@code commit} flag. When {@code commit=false} (or omitted) the request is
 * preview-only: AMS hashes each item, intersects with the project's active
 * missing keys, and returns the would-be {@code affectedSpecIds} per key
 * without writing anything. When {@code commit=true} the same intersection is
 * computed and each surviving row is inserted in a single transaction.</p>
 *
 * <p>{@code resolvedBy} is required only when {@code commit=true}. The service
 * layer raises {@link IllegalArgumentException} (mapped to HTTP 400) if it is
 * missing on a commit request.</p>
 *
 * <p>Boxed reference types throughout per
 * {@code project_primitive_double_dto_overwrite.md}: an omitted JSON key
 * arrives as {@code null} rather than a primitive default.</p>
 */
public record BulkResolveRequest(
    List<BulkResolveItem> items,
    Boolean commit,
    String resolvedBy
) {

    /**
     * One enumerated bulk-resolve item, mirroring
     * {@code MissingInputResolutionBulkService.BulkResolveItem}. The controller
     * unwraps this into the service-layer record so the service does not need
     * to depend on web-tier types.
     */
    public record BulkResolveItem(
        String type,
        String serviceName,
        String operationName,
        String sourceElementId,
        String targetElementId,
        String targetElementLogicalName,
        Map<String, Object> payload
    ) {}
}
