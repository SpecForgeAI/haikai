package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Response shape for an {@code api_behaviour_capture_sessions} row.
 *
 * <p>JSONB columns are surfaced as {@code Map<String, Object>}; numeric and
 * boolean PATCH-mutable fields are boxed types so {@code null} flows through
 * verbatim (see {@code project_primitive_double_dto_overwrite.md}).</p>
 *
 * <h2>PATCH safety</h2>
 * <p>Boxed types are required for any numeric / boolean field that participates
 * in PATCH semantics (per {@code project_primitive_double_dto_overwrite.md}).
 * The new {@code kind} ({@link String}) and {@code sourceBaselineId}
 * ({@link UUID}) fields added by the API Test Harness — Target-Side Capture
 * spec (2026-05-25) are reference types — no boxed-type audit needed for them.
 * The next maintainer adding fields must apply the same rule: any
 * primitive-numeric / primitive-boolean column-mutable field MUST be its boxed
 * counterpart.</p>
 *
 * <h2>Kind discriminator (Spec: 2026-05-25 API Test Harness — Target-Side Capture)</h2>
 * <p>{@code kind} distinguishes a current-state capture session
 * ({@code "current"}) from a target-side replay session ({@code "target"}).
 * Validated at the service layer.</p>
 *
 * <p>{@code sourceBaselineId} is the FK from a target session at the source
 * current-state baseline it is replaying. Service-layer invariant: target
 * sessions MUST have a non-null source; current sessions MUST have it null.</p>
 *
 * <h2>Coverage summary (Spec: 2026-06-17 Oracle Coverage Scoring)</h2>
 * <p>{@code coverageSummaryJson} carries the whole coverage summary (overall +
 * per-endpoint dimensions, achieved/missed, honest reasons, and the single
 * project-level auth dimension), written on the completion PATCH by the
 * single-source coverage scorer. Snake_case wire (AMS default — NO
 * {@code @CamelCaseWire}). {@code null} = coverage not recorded (legacy /
 * pre-fix sessions). Designed so a later spec (baseline integrity &amp;
 * provenance, Spec C) can read it off the session.</p>
 *
 * <p>A backward-compatible 18-arg constructor delegates to the canonical
 * constructor with {@code kind="current"} and {@code sourceBaselineId=null},
 * so existing call sites compile unchanged (same pattern as
 * {@link com.example.architecturemodel.model.dto.ArchitectureDto}).</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 * <p>Extended: API Test Harness — Target-Side Capture (2026-05-25) — Task Group 2
 * ({@code kind} + {@code sourceBaselineId}).</p>
 * <p>Extended: Oracle Coverage Scoring (2026-06-17) — Task Group 1
 * ({@code coverageSummaryJson}).</p>
 */
public record ApiBehaviourCaptureSessionDto(
    UUID id,
    UUID projectId,
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
    Instant startedAt,
    Instant completedAt,
    String errorMessage,
    String kind,
    UUID sourceBaselineId,
    /**
     * Per-run scenario outcome tallies (changeset 171, misleading-COMPLETED
     * fix). Nullable = "counts not recorded" (legacy rows / pre-fix runners).
     * Boxed {@link Integer} per the PATCH-safety rule above.
     */
    Integer scenariosAttempted,
    Integer scenariosCompleted,
    Integer scenariosErrored,
    /**
     * Persisted interface scope for inventory reconciliation (array of
     * Interface ids); {@code null} = whole-architecture scope. Spec:
     * Model-Seeded Capture Inventory (2026-06-11), changeset 178.
     */
    List<String> scopeInterfaceIdsJson,
    /**
     * Start coverage-override audit trio (justification, unaccounted count
     * at override time, timestamp). All {@code null} = no override. Count is
     * boxed {@link Integer} per the PATCH-safety rule above.
     */
    String coverageOverrideJustification,
    Integer coverageOverrideUnaccountedCount,
    Instant coverageOverrideAt,
    /**
     * Whole coverage summary (Oracle Coverage Scoring, 2026-06-17, changeset
     * 189). {@code null} = coverage not recorded. JSONB; snake_case wire (AMS
     * default — NO {@code @CamelCaseWire}). Designed for Spec C to read.
     */
    Map<String, Object> coverageSummaryJson,
    Instant createdAt,
    Instant updatedAt
) {

    /**
     * Backward-compatible constructor preserving the pre-Oracle-Coverage-Scoring
     * canonical signature (no {@code coverageSummaryJson}). Delegates with a
     * null coverage summary.
     */
    public ApiBehaviourCaptureSessionDto(
            UUID id,
            UUID projectId,
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
            Instant startedAt,
            Instant completedAt,
            String errorMessage,
            String kind,
            UUID sourceBaselineId,
            Integer scenariosAttempted,
            Integer scenariosCompleted,
            Integer scenariosErrored,
            List<String> scopeInterfaceIdsJson,
            String coverageOverrideJustification,
            Integer coverageOverrideUnaccountedCount,
            Instant coverageOverrideAt,
            Instant createdAt,
            Instant updatedAt) {
        this(id, projectId, architectureId, name, status,
            environmentName, apiBaseUrl, authType,
            authConfigRedactedJson, defaultHeadersRedactedJson,
            oasSpecRefsJson, dbConfigRedactedJson, mutatingCallsConfirmed,
            startedAt, completedAt, errorMessage,
            kind, sourceBaselineId,
            scenariosAttempted, scenariosCompleted, scenariosErrored,
            scopeInterfaceIdsJson,
            coverageOverrideJustification, coverageOverrideUnaccountedCount,
            coverageOverrideAt,
            null,
            createdAt, updatedAt);
    }

    /**
     * Backward-compatible 23-arg constructor preserving the
     * pre-Model-Seeded-Capture-Inventory canonical signature. Delegates to
     * the canonical constructor with null scope + override + coverage fields.
     */
    public ApiBehaviourCaptureSessionDto(
            UUID id,
            UUID projectId,
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
            Instant startedAt,
            Instant completedAt,
            String errorMessage,
            String kind,
            UUID sourceBaselineId,
            Integer scenariosAttempted,
            Integer scenariosCompleted,
            Integer scenariosErrored,
            Instant createdAt,
            Instant updatedAt) {
        this(id, projectId, architectureId, name, status,
            environmentName, apiBaseUrl, authType,
            authConfigRedactedJson, defaultHeadersRedactedJson,
            oasSpecRefsJson, dbConfigRedactedJson, mutatingCallsConfirmed,
            startedAt, completedAt, errorMessage,
            kind, sourceBaselineId,
            scenariosAttempted, scenariosCompleted, scenariosErrored,
            null, null, null, null,
            null,
            createdAt, updatedAt);
    }

    /**
     * Backward-compatible 18-arg constructor preserving the pre-Target-Side-
     * Capture signature. Delegates to the canonical constructor with
     * {@code kind="current"}, {@code sourceBaselineId=null}, and null scenario
     * tallies.
     *
     * <p>Same delegating pattern as
     * {@link com.example.architecturemodel.model.dto.ArchitectureDto}. Callers
     * that need to set the new fields use the canonical constructor directly.</p>
     */
    public ApiBehaviourCaptureSessionDto(
            UUID id,
            UUID projectId,
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
            Instant startedAt,
            Instant completedAt,
            String errorMessage,
            Instant createdAt,
            Instant updatedAt) {
        this(id, projectId, architectureId, name, status,
            environmentName, apiBaseUrl, authType,
            authConfigRedactedJson, defaultHeadersRedactedJson,
            oasSpecRefsJson, dbConfigRedactedJson, mutatingCallsConfirmed,
            startedAt, completedAt, errorMessage,
            "current", null,
            null, null, null,
            null, null, null, null,
            null,
            createdAt, updatedAt);
    }

    /**
     * Backward-compatible 20-arg constructor preserving the pre-scenario-
     * tallies signature (kind + sourceBaselineId, no tallies). Delegates to
     * the canonical constructor with null tallies.
     */
    public ApiBehaviourCaptureSessionDto(
            UUID id,
            UUID projectId,
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
            Instant startedAt,
            Instant completedAt,
            String errorMessage,
            String kind,
            UUID sourceBaselineId,
            Instant createdAt,
            Instant updatedAt) {
        this(id, projectId, architectureId, name, status,
            environmentName, apiBaseUrl, authType,
            authConfigRedactedJson, defaultHeadersRedactedJson,
            oasSpecRefsJson, dbConfigRedactedJson, mutatingCallsConfirmed,
            startedAt, completedAt, errorMessage,
            kind, sourceBaselineId,
            null, null, null,
            null, null, null, null,
            null,
            createdAt, updatedAt);
    }
}
