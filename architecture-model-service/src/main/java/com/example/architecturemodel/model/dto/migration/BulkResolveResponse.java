package com.example.architecturemodel.model.dto.migration;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Response shape for
 * {@code POST /api/projects/{projectId}/missing-input-resolutions/bulk}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 4.</p>
 *
 * <p>Carries the preview rows (one per stable 16-hex-char key that intersects
 * with the project's active missing keys) plus a {@code previewOnly} flag and a
 * convenience {@code totalSpecsAffected} integer (the sum of unique spec ids
 * across all preview rows; the frontend uses it to render the
 * "N specs will be affected" banner in the bulk-resolve modal).</p>
 *
 * <p>When the request carried {@code commit=true}, {@code previewOnly} is
 * {@code false} and {@code committed} is {@code true}: the preview rows
 * describe what WAS inserted. On {@code commit=false} both flags are mirrored
 * accordingly.</p>
 *
 * <p>All fields are boxed reference types so an omitted JSON key arrives as
 * {@code null} rather than a primitive default -- per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 */
public record BulkResolveResponse(
    List<BulkResolveRow> resolutions,
    Boolean previewOnly,
    Boolean committed,
    Integer totalSpecsAffected
) {

    /**
     * One preview row keyed by the stable 16-hex-char missing-input key, with
     * the resolved type, a human-readable descriptor, and the list of spec-
     * generation ids the resolution would affect.
     */
    public record BulkResolveRow(
        String key,
        String missingInputType,
        String descriptor,
        List<UUID> affectedSpecIds,
        Map<String, Object> resolutionPayload
    ) {}
}
