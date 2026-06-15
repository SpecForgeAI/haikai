package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.Map;

/**
 * PATCH body for {@code api_behaviour_operations}. All fields boxed/reference
 * types so the service can null-guard each one on update.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
public record UpdateApiBehaviourOperationRequest(
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
     * Exclusion reason (see {@code ApiBehaviourOperationDto}); {@code null}
     * = field omitted (PATCH-no-op). Spec: Model-Seeded Capture Inventory
     * (2026-06-11), changeset 178.
     */
    String exclusionReason
) {

    /**
     * Backward-compatible 10-arg constructor preserving the
     * pre-Model-Seeded-Capture-Inventory signature ({@code exclusionReason}
     * omitted = PATCH-no-op).
     */
    public UpdateApiBehaviourOperationRequest(
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
        this(operationId, method, path, summary, description, included,
            safeToExecute, requestSchemaJson, responseSchemaJson,
            oasOperationJson, null);
    }
}
