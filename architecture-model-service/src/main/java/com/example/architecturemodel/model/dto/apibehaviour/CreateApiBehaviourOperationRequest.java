package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.Map;
import java.util.UUID;

/**
 * Request body for
 * {@code POST /api/projects/{projectId}/api-behaviour/capture-sessions/{sessionId}/operations}.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
public record CreateApiBehaviourOperationRequest(
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
     * Reason for an explicit exclude-with-reason accounting row
     * ({@code included = false}); {@code null} for ordinary rows. Spec:
     * Model-Seeded Capture Inventory (2026-06-11), changeset 178.
     */
    String exclusionReason
) {

    /**
     * Backward-compatible 11-arg constructor preserving the
     * pre-Model-Seeded-Capture-Inventory signature ({@code exclusionReason}
     * defaults to null).
     */
    public CreateApiBehaviourOperationRequest(
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
            Map<String, Object> oasOperationJson) {
        this(sessionId, operationId, method, path, summary, description,
            included, safeToExecute, requestSchemaJson, responseSchemaJson,
            oasOperationJson, null);
    }
}
