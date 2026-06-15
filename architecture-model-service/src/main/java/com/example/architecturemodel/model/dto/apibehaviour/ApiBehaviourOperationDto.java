package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Response shape for an {@code api_behaviour_operations} row.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
public record ApiBehaviourOperationDto(
    UUID id,
    UUID sessionId,
    String operationId,
    String method,
    String path,
    String summary,
    String description,
    Boolean included,
    Boolean safeToExecute,
    Map<String, Object> requestSchemaJson,
    Map<String, Object> responseSchemaJson,
    Map<String, Object> oasOperationJson,
    /**
     * Reason the row was created as an explicit EXCLUSION of a committed
     * model endpoint ({@code included = false}); {@code null} for ordinary
     * rows. Spec: Model-Seeded Capture Inventory (2026-06-11), changeset 178.
     */
    String exclusionReason,
    Instant createdAt,
    Instant updatedAt
) {

    /**
     * Backward-compatible 14-arg constructor preserving the
     * pre-Model-Seeded-Capture-Inventory signature. Delegates with a null
     * {@code exclusionReason}.
     */
    public ApiBehaviourOperationDto(
            UUID id,
            UUID sessionId,
            String operationId,
            String method,
            String path,
            String summary,
            String description,
            Boolean included,
            Boolean safeToExecute,
            Map<String, Object> requestSchemaJson,
            Map<String, Object> responseSchemaJson,
            Map<String, Object> oasOperationJson,
            Instant createdAt,
            Instant updatedAt) {
        this(id, sessionId, operationId, method, path, summary, description,
            included, safeToExecute, requestSchemaJson, responseSchemaJson,
            oasOperationJson, null, createdAt, updatedAt);
    }
}
