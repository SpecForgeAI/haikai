package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * DTO for an SCL reachability worklist item.
 *
 * {@code signalsJson} is OPAQUE JSON passed through verbatim (never parsed by
 * AMS). {@code disposition} is the triage verdict ({@code dead_code} |
 * {@code missed_entrypoint} | {@code framework_invoked}) or null while the
 * item is open.
 *
 * Wire shape is explicit snake_case per-field {@code @JsonProperty}; all
 * fields are boxed reference types.
 *
 * Spec: SCL corpus persistence (Structural Contract Language) (2026-08-18).
 *
 * @param id Internal database UUID
 * @param projectId Project identifier (inherited from the owning scan)
 * @param scanId Owning scan UUID
 * @param sourcePath Source file the unproven-reachability location lives in
 * @param symbol Source symbol at the location (nullable)
 * @param signalsJson Opaque JSON: the miner's reachability evidence (nullable)
 * @param disposition Triage verdict (dead_code | missed_entrypoint | framework_invoked) or null (open)
 * @param createdAt ISO-8601 timestamp of creation
 * @param updatedAt ISO-8601 timestamp of last update (null until first update)
 */
public record SclReachabilityItemDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("scan_id")
    UUID scanId,

    @JsonProperty("source_path")
    String sourcePath,

    @JsonProperty("symbol")
    String symbol,

    @JsonProperty("signals_json")
    Map<String, Object> signalsJson,

    @JsonProperty("disposition")
    String disposition,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt
) {}
