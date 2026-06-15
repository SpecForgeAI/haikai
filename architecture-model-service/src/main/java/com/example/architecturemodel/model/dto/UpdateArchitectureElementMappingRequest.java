package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.jackson.CamelCaseWire;

/**
 * Request body for {@code PUT /api/projects/{projectId}/architecture-mappings/{mappingId}}.
 *
 * <p>Marked {@code @CamelCaseWire} because the Selective Copy frontend speaks camelCase.</p>
 *
 * <p>Only {@code mappingType}, {@code status}, {@code notes}, and
 * {@code confidence} are mutable on update. {@code created_by_task} is set
 * server-side to {@code "mapping-review-modal-edit"} on every PATCH.
 * {@code created_at} stays put; {@code updated_at} is bumped via
 * {@code @PreUpdate}.</p>
 *
 * <p>All fields are boxed types so PATCH semantics preserve {@code null}
 * when the client omits a field — primitive numerics silently default to
 * {@code 0.0} on missing JSON, which would corrupt the column. See
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 */
@CamelCaseWire
public record UpdateArchitectureElementMappingRequest(
    String mappingType,
    String status,
    String notes,
    Double confidence
) {}
