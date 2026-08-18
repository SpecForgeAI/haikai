package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * DTO for one log-replay corpus extraction (Spec 5, 2026-08-18).
 *
 * Wire shape is explicit snake_case per-field {@code @JsonProperty} (the AMS
 * belt-and-braces convention; no {@code @CamelCaseWire}). All fields boxed.
 *
 * @param id Internal database UUID
 * @param projectId Project identifier
 * @param architectureId Architecture identifier
 * @param fileName Source log display filename (null for inline content)
 * @param status Corpus lifecycle status (staged on creation)
 * @param funnelJson Opaque extraction funnel accounting (never parsed by AMS)
 * @param itemCount Number of persisted corpus items (computed on read)
 * @param createdAt ISO-8601 timestamp of creation
 * @param updatedAt ISO-8601 timestamp of last update (null until first update)
 */
public record LogReplayCorpusDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("architecture_id")
    UUID architectureId,

    @JsonProperty("file_name")
    String fileName,

    @JsonProperty("status")
    String status,

    @JsonProperty("funnel_json")
    Map<String, Object> funnelJson,

    @JsonProperty("item_count")
    Long itemCount,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt
) {}
