package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Request body for
 * {@code PATCH /api/projects/{projectId}/api-behaviour/capture-sessions/{id}}.
 *
 * <p>Every field is a boxed/reference type so PATCH semantics preserve
 * {@code null} when the client omits the field — primitive numerics/booleans
 * silently default and would corrupt the column. The service-layer
 * {@code update} method null-guards every field in turn (see project memory
 * note {@code project_primitive_double_dto_overwrite.md}).</p>
 *
 * <p>{@code architectureId}, {@code projectId}, {@code id} and timestamps are
 * NOT updatable through PATCH — they are missing from this DTO by design
 * (architecture is bound at create-time for life, mirroring the discovery
 * pattern).</p>
 *
 * <p>{@code kind} and {@code sourceBaselineId} are optional PATCH fields; the
 * service layer null-guards them and validates the FK-pairing invariant
 * (target → non-null source; current → null source) whenever either field is
 * present in the body.</p>
 *
 * <p>A backward-compatible 13-arg constructor delegates to the canonical
 * 15-arg constructor with {@code kind=null} and {@code sourceBaselineId=null}.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 * <p>Extended: API Test Harness — Target-Side Capture (2026-05-25) — Task Group 2
 * ({@code kind} + {@code sourceBaselineId}).</p>
 */
public record UpdateApiBehaviourCaptureSessionRequest(
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
    Instant startedAt,
    Instant completedAt,
    String errorMessage,
    String kind,
    UUID sourceBaselineId,
    /**
     * Per-run scenario outcome tallies (changeset 171, misleading-COMPLETED
     * fix) — sent by the capture orchestrator on the completion PATCH. Boxed
     * {@link Integer} + null-guarded in the service update per the PATCH rule
     * above.
     */
    Integer scenariosAttempted,
    Integer scenariosCompleted,
    Integer scenariosErrored,
    /**
     * Persisted interface scope for inventory reconciliation; {@code null}
     * means "field omitted" (PATCH-no-op), never "clear the scope". Spec:
     * Model-Seeded Capture Inventory (2026-06-11), changeset 178.
     */
    List<String> scopeInterfaceIdsJson,
    /**
     * Start coverage-override audit trio -- PATCHed by the validation
     * service's {@code /start} override path. Boxed {@link Integer} +
     * null-guarded in the service update per the PATCH rule above.
     */
    String coverageOverrideJustification,
    Integer coverageOverrideUnaccountedCount,
    Instant coverageOverrideAt
) {

    /**
     * Backward-compatible 18-arg constructor preserving the
     * pre-Model-Seeded-Capture-Inventory canonical signature. Delegates with
     * null scope + override fields (PATCH-no-op).
     */
    public UpdateApiBehaviourCaptureSessionRequest(
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
            Instant startedAt,
            Instant completedAt,
            String errorMessage,
            String kind,
            UUID sourceBaselineId,
            Integer scenariosAttempted,
            Integer scenariosCompleted,
            Integer scenariosErrored) {
        this(name, status, environmentName, apiBaseUrl, authType,
            authConfigRedactedJson, defaultHeadersRedactedJson,
            oasSpecRefsJson, dbConfigRedactedJson, mutatingCallsConfirmed,
            startedAt, completedAt, errorMessage,
            kind, sourceBaselineId,
            scenariosAttempted, scenariosCompleted, scenariosErrored,
            null, null, null, null);
    }

    /**
     * Backward-compatible 13-arg constructor preserving the pre-Target-Side-
     * Capture signature. Delegates to the canonical constructor with
     * {@code kind=null}, {@code sourceBaselineId=null}, and null scenario
     * tallies (PATCH-no-op for those fields).
     */
    public UpdateApiBehaviourCaptureSessionRequest(
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
            Instant startedAt,
            Instant completedAt,
            String errorMessage) {
        this(name, status, environmentName, apiBaseUrl, authType,
            authConfigRedactedJson, defaultHeadersRedactedJson,
            oasSpecRefsJson, dbConfigRedactedJson, mutatingCallsConfirmed,
            startedAt, completedAt, errorMessage,
            null, null, null, null, null);
    }

    /**
     * Backward-compatible 15-arg constructor preserving the pre-scenario-
     * tallies signature. Delegates to the canonical constructor with null
     * tallies (PATCH-no-op).
     */
    public UpdateApiBehaviourCaptureSessionRequest(
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
            Instant startedAt,
            Instant completedAt,
            String errorMessage,
            String kind,
            UUID sourceBaselineId) {
        this(name, status, environmentName, apiBaseUrl, authType,
            authConfigRedactedJson, defaultHeadersRedactedJson,
            oasSpecRefsJson, dbConfigRedactedJson, mutatingCallsConfirmed,
            startedAt, completedAt, errorMessage,
            kind, sourceBaselineId,
            null, null, null);
    }
}
