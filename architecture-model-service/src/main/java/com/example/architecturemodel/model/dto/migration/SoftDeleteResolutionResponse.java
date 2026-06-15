package com.example.architecturemodel.model.dto.migration;

import java.util.List;
import java.util.UUID;

/**
 * Response shape for
 * {@code DELETE /api/projects/{projectId}/missing-input-resolutions/{id}}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 4.</p>
 *
 * <p>Carries the audited (soft-deleted) {@link MissingInputResolutionDto}
 * snapshot, the integer count of cascaded specs, and the affected spec ids so
 * the frontend can refresh badges in one round-trip. The cascade rule is owned
 * by {@code MissingInputResolutionCascadeService}: every spec whose
 * {@code missing_input_keys_json} contains the soft-deleted key is flipped back
 * to {@code insufficient_context} (when previously {@code generated} or
 * {@code generated_with_warnings}) and stamped
 * {@code stale=true, staleReason='resolution_reset'}.</p>
 *
 * <p>All fields are boxed reference types per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 */
public record SoftDeleteResolutionResponse(
    MissingInputResolutionDto deletedResolution,
    Integer affectedSpecCount,
    List<UUID> affectedSpecIds
) {}
