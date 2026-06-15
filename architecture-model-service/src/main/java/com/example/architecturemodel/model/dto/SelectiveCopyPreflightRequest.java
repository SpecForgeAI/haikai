package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.jackson.CamelCaseWire;

import java.util.List;
import java.util.UUID;

/**
 * Request body for the selective-copy preflight endpoint.
 *
 * <p>Marked {@code @CamelCaseWire} because the Selective Copy frontend speaks camelCase.</p>
 *
 * <p>{@code POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/preflight}</p>
 *
 * @param sourceArchitectureId the architecture the user is copying FROM. The
 *                             URL's {@code targetArchitectureId} is the
 *                             architecture being copied INTO.
 * @param elementIds           the user's tick-set from the picker tree.
 *                             Must NOT be null; may be empty (which yields
 *                             an empty preflight summary).
 */
@CamelCaseWire
public record SelectiveCopyPreflightRequest(
    UUID sourceArchitectureId,
    List<UUID> elementIds
) {}
