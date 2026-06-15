package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.jackson.CamelCaseWire;

import java.time.Instant;
import java.util.UUID;

/**
 * Response shape for an architecture-element mapping row.
 *
 * <p>Marked {@code @CamelCaseWire} because the Selective Copy frontend speaks camelCase.</p>
 *
 * <p>The {@code confidence} field is boxed {@link Double} (NOT primitive) so
 * {@code null} can flow through verbatim — primitive numerics silently default
 * to {@code 0.0} during Jackson deserialisation, which would corrupt PATCH
 * semantics. See project memory note
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 */
@CamelCaseWire
public record ArchitectureElementMappingDto(
    UUID id,
    UUID projectId,
    UUID sourceArchitectureId,
    UUID targetArchitectureId,
    String sourceElementType,
    String sourceElementId,
    String targetElementType,
    String targetElementId,
    String mappingType,
    String status,
    String createdByTask,
    Instant createdAt,
    Instant updatedAt,
    String notes,
    Double confidence
) {}
