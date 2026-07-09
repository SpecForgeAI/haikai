package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.UUID;

/**
 * Wire shape for an {@code api_behaviour_comparison_waivers} row
 * (Spec 2026-07-06-j). Snake_case wire (AMS default — no
 * {@code @CamelCaseWire}).
 */
public record ApiBehaviourComparisonWaiverDto(
    UUID id,
    UUID projectId,
    String scope,
    String dimension,
    String target,
    String reason,
    String author,
    String provenance,
    Instant createdAt
) {}
