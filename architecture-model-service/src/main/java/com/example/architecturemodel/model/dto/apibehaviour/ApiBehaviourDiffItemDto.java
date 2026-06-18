package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Response shape for an {@code api_behaviour_diff_items} row.
 *
 * <h2>PATCH safety</h2>
 *
 * <p><b>{@link #sourceResponseStatus} and {@link #targetResponseStatus} are
 * boxed {@link Integer} -- never primitive {@code int}.</b> Per
 * {@code project_primitive_double_dto_overwrite.md}, any field that
 * participates in PATCH semantics must be a boxed type so a missing JSON field
 * does NOT silently wipe to {@code 0}. They are also nullable in the schema
 * (NULL on {@code target_only} / {@code source_only} rows where one side has
 * no response).</p>
 *
 * <p>{@link #bodyDiffJson} is typed as {@code Map<String, Object>} to mirror
 * the entity's JSONB mapping. NULL when no pair (source_only / target_only).</p>
 *
 * <h2>Classification taxonomy</h2>
 *
 * <p>{@link #statusClassification}: {@code status_match} | {@code status_drift}
 * | {@code source_only} | {@code target_only}.</p>
 *
 * <p>{@link #bodyClassification} (NULL on source_only / target_only):
 * {@code body_match} | {@code body_shape_drift} | {@code body_value_drift} |
 * {@code body_ordering_drift}.</p>
 *
 * <p>{@link #headerClassification} (NULL on source_only / target_only, or when
 * the header dimension is skipped because a side lacks the {@code {headers,
 * body\}} response wrapper): {@code header_match} | {@code header_value_drift}
 * | {@code header_presence_drift}.</p>
 *
 * <p>snake_case wire (AMS default -- NO {@code @CamelCaseWire}).</p>
 *
 * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 2</p>
 * <p>Extended: Reconcile Full-Response Fidelity (2026-06-17) — Task Group 1
 * ({@code header_classification}).</p>
 */
public record ApiBehaviourDiffItemDto(
    UUID id,
    UUID diffId,
    String method,
    String path,
    String scenarioName,
    UUID sourceBaselineItemId,
    UUID targetBaselineItemId,
    String statusClassification,
    String bodyClassification,
    String headerClassification,
    Integer sourceResponseStatus,
    Integer targetResponseStatus,
    Map<String, Object> bodyDiffJson,
    String notes,
    Instant createdAt
) {

    /**
     * Backward-compatible constructor preserving the pre-{@code
     * header_classification} component order. Delegates to the canonical
     * constructor with a {@code null} header classification so existing call
     * sites compile unchanged.
     */
    public ApiBehaviourDiffItemDto(
        UUID id,
        UUID diffId,
        String method,
        String path,
        String scenarioName,
        UUID sourceBaselineItemId,
        UUID targetBaselineItemId,
        String statusClassification,
        String bodyClassification,
        Integer sourceResponseStatus,
        Integer targetResponseStatus,
        Map<String, Object> bodyDiffJson,
        String notes,
        Instant createdAt
    ) {
        this(
            id, diffId, method, path, scenarioName,
            sourceBaselineItemId, targetBaselineItemId,
            statusClassification, bodyClassification, null,
            sourceResponseStatus, targetResponseStatus,
            bodyDiffJson, notes, createdAt
        );
    }
}
