package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * DTO for discovery configuration.
 *
 * Represents a discovery config persisted via the REST API, including
 * the full config payload (JSONB), lifecycle status, and metadata timestamps.
 *
 * Spec: Phase 0 Persistence Contract (Increment 2)
 * Task Group 2: JPA Entity, DTO, and Repository
 *
 * @param id Internal database UUID
 * @param projectId Project identifier
 * @param configPayload Structured discovery config JSON payload
 * @param status Lifecycle status (DRAFT, COMPLETE)
 * @param createdAt ISO-8601 timestamp of creation
 * @param updatedAt ISO-8601 timestamp of last update
 */
public record DiscoveryConfigDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("config_payload")
    Map<String, Object> configPayload,

    @JsonProperty("status")
    String status,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt
) {}
