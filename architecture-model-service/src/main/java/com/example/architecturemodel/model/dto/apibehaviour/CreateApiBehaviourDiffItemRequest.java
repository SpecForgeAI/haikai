package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.Map;
import java.util.UUID;

/**
 * Request body for creating an {@code api_behaviour_diff_items} row.
 *
 * <p>The validation service's {@code diffRunner.ts} POSTs one of these per
 * scenario it has classified.</p>
 *
 * <h2>PATCH safety on numeric status fields</h2>
 *
 * <p><b>{@link #sourceResponseStatus} and {@link #targetResponseStatus} are
 * boxed {@link Integer}</b> per {@code project_primitive_double_dto_overwrite.md}.
 * Nullable when classification is {@code source_only} / {@code target_only}.</p>
 *
 * <h2>Classification validation (service layer)</h2>
 *
 * <ul>
 *   <li>{@link #statusClassification} MUST be one of {@code status_match} |
 *       {@code status_drift} | {@code source_only} | {@code target_only}.</li>
 *   <li>{@link #bodyClassification} (when present) MUST be one of
 *       {@code body_match} | {@code body_shape_drift} | {@code body_value_drift}
 *       | {@code body_ordering_drift}.</li>
 *   <li>{@link #headerClassification} (when present) MUST be one of
 *       {@code header_match} | {@code header_value_drift} |
 *       {@code header_presence_drift}.</li>
 * </ul>
 *
 * <p>snake_case wire (AMS default -- NO {@code @CamelCaseWire}).</p>
 *
 * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 2</p>
 * <p>Extended: Reconcile Full-Response Fidelity (2026-06-17) — Task Group 1
 * ({@code header_classification}).</p>
 */
public record CreateApiBehaviourDiffItemRequest(
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
    String notes
) {

    /**
     * Backward-compatible constructor preserving the pre-{@code
     * header_classification} component order. Delegates to the canonical
     * constructor with a {@code null} header classification so existing call
     * sites compile unchanged.
     */
    public CreateApiBehaviourDiffItemRequest(
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
        String notes
    ) {
        this(
            diffId, method, path, scenarioName,
            sourceBaselineItemId, targetBaselineItemId,
            statusClassification, bodyClassification, null,
            sourceResponseStatus, targetResponseStatus,
            bodyDiffJson, notes
        );
    }
}
