package com.example.architecturemodel.model.dto.migration;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Response DTO for a {@code missing_input_resolutions} row.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 2.</p>
 *
 * <p>All fields are boxed reference types so a PATCH (or partial-update) that
 * omits a field is never confused with a "wipe to zero" -- per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <p>The {@code resolutionPayloadJson} field carries the type-specific payload
 * shape documented on {@link com.example.architecturemodel.model.entity.MissingInputResolutionEntity}:
 * </p>
 * <ul>
 *   <li>{@code api_contract}   -- {@code { contractBlobId, filename, format, operationsCount }}</li>
 *   <li>{@code mapping}        -- {@code { sourceElementId, targetElementId, mappingRefId }}</li>
 *   <li>{@code target_element} -- {@code { targetElementId }}</li>
 * </ul>
 *
 * <p>Soft-delete audit fields ({@code softDeleted}, {@code softDeletedAt},
 * {@code softDeletedBy}) are surfaced so the controller's DELETE response can
 * return the audited snapshot at reset time without an additional fetch.</p>
 */
public record MissingInputResolutionDto(
    UUID id,
    UUID projectId,
    String missingInputKey,
    String missingInputType,
    Map<String, Object> resolutionPayloadJson,
    Instant resolvedAt,
    String resolvedBy,
    Boolean softDeleted,
    Instant softDeletedAt,
    String softDeletedBy,
    Instant createdAt,
    Instant updatedAt
) {}
