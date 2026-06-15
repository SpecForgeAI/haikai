package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.Map;
import java.util.UUID;

/**
 * Request body for {@code POST /api/projects/{projectId}/api-behaviour/capture-sessions}.
 *
 * <p>{@code projectId} comes from the path; {@code id}, {@code createdAt},
 * {@code updatedAt}, {@code startedAt}, {@code completedAt}, and
 * {@code errorMessage} are server-set. Initial {@code status} defaults to
 * {@code draft} unless explicitly provided (only {@code draft} is accepted on
 * create).</p>
 *
 * <p>{@code kind} (one of {@code "current"} | {@code "target"}, defaults to
 * {@code "current"} at the service layer when omitted) and
 * {@code sourceBaselineId} (required when {@code kind="target"}, MUST be null
 * when {@code kind="current"}) are validated by
 * {@link com.example.architecturemodel.service.apibehaviour.ApiBehaviourCaptureSessionService}.</p>
 *
 * <p>A backward-compatible 11-arg constructor delegates to the canonical
 * 13-arg constructor with {@code kind=null} and {@code sourceBaselineId=null}.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 * <p>Extended: API Test Harness — Target-Side Capture (2026-05-25) — Task Group 2
 * ({@code kind} + {@code sourceBaselineId}).</p>
 */
public record CreateApiBehaviourCaptureSessionRequest(
    UUID architectureId,
    String name,
    String status,
    String environmentName,
    String apiBaseUrl,
    String authType,
    Map<String, Object> authConfigRedactedJson,
    Map<String, Object> defaultHeadersRedactedJson,
    Map<String, Object> oasSpecRefsJson,
    Map<String, Object> dbConfigRedactedJson,
    Boolean mutatingCallsConfirmed,
    String kind,
    UUID sourceBaselineId
) {

    /**
     * Backward-compatible 11-arg constructor preserving the pre-Target-Side-
     * Capture signature. Delegates to the canonical 13-arg constructor with
     * {@code kind=null} (defaults to {@code "current"} at the service layer)
     * and {@code sourceBaselineId=null}.
     */
    public CreateApiBehaviourCaptureSessionRequest(
            UUID architectureId,
            String name,
            String status,
            String environmentName,
            String apiBaseUrl,
            String authType,
            Map<String, Object> authConfigRedactedJson,
            Map<String, Object> defaultHeadersRedactedJson,
            Map<String, Object> oasSpecRefsJson,
            Map<String, Object> dbConfigRedactedJson,
            Boolean mutatingCallsConfirmed) {
        this(architectureId, name, status, environmentName, apiBaseUrl, authType,
            authConfigRedactedJson, defaultHeadersRedactedJson,
            oasSpecRefsJson, dbConfigRedactedJson, mutatingCallsConfirmed,
            null, null);
    }
}
