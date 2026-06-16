package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Response shape for an {@code api_behaviour_baseline_items} row.
 *
 * <p>Wire format is snake_case (the AMS default — NO {@code @CamelCaseWire});
 * {@code volatile_paths_json} therefore serialises as {@code volatile_paths_json}
 * over the wire.</p>
 *
 * <p>{@code volatilePathsJson} is the empirically-measured volatility envelope
 * ({@code { paths, volatility_source, k }}) for this captured scenario, written
 * once by the capture-time probe and never mutated thereafter. {@code null}
 * means no volatility recorded (strict comparison — the backward-compatible
 * default and the state of every already-pinned baseline). It round-trips as
 * {@code null}.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2.
 * Extended by Reconcile-Time Determinism &amp; Volatile-Value Handling
 * (2026-06-16) — Task Group 1 ({@code volatilePathsJson}).</p>
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
    String businessNotes,
    Instant createdAt,
    Instant updatedAt
) {}
