package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Response shape for an {@code api_behaviour_baseline_items} row.
 *
 * <p>Wire format is snake_case (the AMS default — NO {@code @CamelCaseWire});
 * {@code volatilePathsJson} / {@code sequenceJson} therefore serialise as
 * {@code volatile_paths_json} / {@code sequence_json} over the wire.</p>
 *
 * <p>{@code volatilePathsJson} is the empirically-measured volatility envelope
 * ({@code { paths, volatility_source, k }}) for this captured scenario, written
 * once by the capture-time probe and never mutated thereafter. {@code null}
 * means no volatility recorded (strict comparison — the backward-compatible
 * default and the state of every already-pinned baseline). It round-trips as
 * {@code null}.</p>
 *
 * <p>{@code sequenceJson} is the pinned ordered HTTP chain
 * (setup &rarr; act &rarr; cleanup) when this item is a STATEFUL SEQUENCE
 * scenario; {@code null} = today's single-shot item. Written once at create
 * time, never mutated (write-once, no PATCH path). It round-trips as
 * {@code null} for every single-shot item.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2.
 * Extended by Reconcile-Time Determinism &amp; Volatile-Value Handling
 * (2026-06-16) — Task Group 1 ({@code volatilePathsJson}). Extended by Stateful
 * Sequence Scenarios (2026-06-18) — Task Group 1 ({@code sequenceJson}).</p>
 */
public record ApiBehaviourBaselineItemDto(
    UUID id,
    UUID baselineId,
    UUID captureId,
    UUID operationId,
    UUID scenarioId,
    String method,
    String path,
    String scenarioName,
    Map<String, Object> requestJson,
    Integer responseStatus,
    Map<String, Object> responseJson,
    Map<String, Object> volatilePathsJson,
    Map<String, Object> sequenceJson,
    String responseBodyRaw,
    /** Spec 2026-07-06-n: effect-table state delta; null = not captured. */
    Map<String, Object> stateDeltaJson,
    String businessNotes,
    Instant createdAt,
    Instant updatedAt
) {
    /**
     * Backward-compatible delegating constructor for pre-state-delta call
     * sites (Spec 2026-07-06-n): delegates with {@code stateDeltaJson == null}
     * ("state not captured" — reconcile degrades visibly to
     * {@code state_unverified}).
     */
    public ApiBehaviourBaselineItemDto(
        UUID id,
        UUID baselineId,
        UUID captureId,
        UUID operationId,
        UUID scenarioId,
        String method,
        String path,
        String scenarioName,
        Map<String, Object> requestJson,
        Integer responseStatus,
        Map<String, Object> responseJson,
        Map<String, Object> volatilePathsJson,
        Map<String, Object> sequenceJson,
        String responseBodyRaw,
        String businessNotes,
        Instant createdAt,
        Instant updatedAt
    ) {
        this(
            id, baselineId, captureId, operationId, scenarioId,
            method, path, scenarioName, requestJson, responseStatus,
            responseJson, volatilePathsJson, sequenceJson, responseBodyRaw,
            null, businessNotes, createdAt, updatedAt);
    }

    /**
     * Backward-compatible delegating constructor for pre-raw call sites
     * (Spec 2026-07-06-j): delegates to the canonical constructor with
     * {@code responseBodyRaw == null} ("raw unavailable" — the state of every
     * already-pinned baseline; strict verdicts degrade visibly, never a false
     * exact).
     */
    public ApiBehaviourBaselineItemDto(
        UUID id,
        UUID baselineId,
        UUID captureId,
        UUID operationId,
        UUID scenarioId,
        String method,
        String path,
        String scenarioName,
        Map<String, Object> requestJson,
        Integer responseStatus,
        Map<String, Object> responseJson,
        Map<String, Object> volatilePathsJson,
        Map<String, Object> sequenceJson,
        String businessNotes,
        Instant createdAt,
        Instant updatedAt
    ) {
        this(
            id, baselineId, captureId, operationId, scenarioId,
            method, path, scenarioName, requestJson, responseStatus,
            responseJson, volatilePathsJson, sequenceJson, null, null,
            businessNotes, createdAt, updatedAt);
    }

    /**
     * Backward-compatible delegating constructor for pre-sequence call sites:
     * delegates with {@code sequenceJson == null} (a single-shot item) and
     * {@code responseBodyRaw == null}.
     */
    public ApiBehaviourBaselineItemDto(
        UUID id,
        UUID baselineId,
        UUID captureId,
        UUID operationId,
        UUID scenarioId,
        String method,
        String path,
        String scenarioName,
        Map<String, Object> requestJson,
        Integer responseStatus,
        Map<String, Object> responseJson,
        Map<String, Object> volatilePathsJson,
        String businessNotes,
        Instant createdAt,
        Instant updatedAt
    ) {
        this(
            id, baselineId, captureId, operationId, scenarioId,
            method, path, scenarioName, requestJson, responseStatus,
            responseJson, volatilePathsJson, null, null, null, businessNotes,
            createdAt, updatedAt);
    }
}
