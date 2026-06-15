package com.example.architecturemodel.model.dto.migration;

import java.util.List;
import java.util.UUID;

/**
 * Response shape for
 * {@code POST /api/projects/{projectId}/missing-input-resolutions}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 4.</p>
 *
 * <p>Carries the newly-created {@link MissingInputResolutionDto} alongside the
 * list of spec-generation ids whose {@code missing_input_keys_json} contains
 * the freshly-resolved key. The frontend uses {@code affectedSpecIds} to
 * refresh the dashboard / drawer "X of Y resolved" badge without a follow-up
 * round-trip.</p>
 *
 * <p>All fields are boxed reference types per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 */
public record CreateResolutionResponse(
    MissingInputResolutionDto resolution,
    List<UUID> affectedSpecIds
) {}
