package com.example.architecturemodel.model.dto.migration;

import java.time.Instant;
import java.util.UUID;

/**
 * Response DTO for an {@code epic_captured_decisions} row.
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 4.</p>
 *
 * <p>All fields are nullable on the wire to mirror the JPA column nullability
 * exactly. Boxed types throughout -- there are no primitives -- per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <p>JSON naming is governed by the global Jackson {@code SNAKE_CASE} property
 * strategy (see {@code application.yml}); MockMvc standalone tests apply the
 * default camelCase mapping unless an explicit {@code ObjectMapper} override is
 * registered.</p>
 */
public record EpicCapturedDecisionDto(
    UUID id,
    UUID projectId,
    UUID epicWorkItemId,
    String decisionKey,
    String decisionText,
    String source,
    UUID sourceSpecGenerationId,
    String status,
    String lastEditedBy,
    Instant createdAt,
    Instant updatedAt
) {}
