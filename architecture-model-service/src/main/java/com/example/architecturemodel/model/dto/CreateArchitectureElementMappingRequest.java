package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.jackson.CamelCaseWire;

import java.util.UUID;

/**
 * Request body for {@code POST /api/projects/{projectId}/architecture-mappings}.
 *
 * <p>Marked {@code @CamelCaseWire} because the Selective Copy frontend speaks camelCase.</p>
 *
 * <p>The {@code id}, {@code createdAt}, {@code updatedAt}, and
 * {@code createdByTask} fields are server-set (the controller / service set
 * {@code created_by_task = "mapping-review-modal-add"} for this entry point).
 * The {@code projectId} comes from the path variable, NOT the body.</p>
 *
 * <p>{@code confidence} is boxed {@link Double} so {@code null} flows through
 * verbatim (the v1 manual-add path defaults to {@code null} unless the user
 * supplies a value — {@code 1.0} is reserved for auto-mapped rows from the
 * selective-copy + auto-map workflow). See
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 */
@CamelCaseWire
public record CreateArchitectureElementMappingRequest(
    UUID sourceArchitectureId,
    UUID targetArchitectureId,
    String sourceElementType,
    String sourceElementId,
    String targetElementType,
    String targetElementId,
    String mappingType,
    String status,
    String notes,
    Double confidence
) {}
