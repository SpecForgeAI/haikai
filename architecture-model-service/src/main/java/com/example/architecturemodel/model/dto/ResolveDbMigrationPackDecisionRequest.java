package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/**
 * Request body for resolving ONE pack decision:
 * {@code POST .../db-migration-packs/{packId}/decisions/{decisionId}/resolve}.
 *
 * <p>{@code resolution_json} is required (400 when absent/empty). Resolving
 * flips the decision {@code open -> resolved}, stamps {@code resolved_at},
 * persists the resolution payload, and marks the owning pack {@code stale}
 * so the explicit Regenerate action lights up (NEVER auto-regenerates).</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 *
 * @param resolutionJson The chosen resolution payload (required).
 */
public record ResolveDbMigrationPackDecisionRequest(
    @JsonProperty("resolution_json")
    Map<String, Object> resolutionJson
) {}
