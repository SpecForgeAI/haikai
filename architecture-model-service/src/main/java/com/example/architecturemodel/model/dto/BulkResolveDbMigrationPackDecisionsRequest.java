package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Request body for bulk-resolving pack decisions with the SAME resolution:
 * {@code POST .../db-migration-packs/{packId}/decisions/resolve-bulk}
 * (the FindingsTab-style bulk action in the decision queue UI).
 *
 * <p>{@code decision_ids} must be non-empty and every id must belong to the
 * addressed pack (400 otherwise -- the whole bulk is rejected atomically, no
 * partial resolution). {@code resolution_json} is required, exactly as in the
 * single-resolve case. The owning pack is marked {@code stale} once.</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 *
 * @param decisionIds The decisions to resolve (required, non-empty).
 * @param resolutionJson The shared resolution payload (required).
 */
public record BulkResolveDbMigrationPackDecisionsRequest(
    @JsonProperty("decision_ids")
    List<UUID> decisionIds,

    @JsonProperty("resolution_json")
    Map<String, Object> resolutionJson
) {}
