package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.UUID;

/**
 * Data Transfer Object for project artifacts.
 *
 * Uses Java record with @JsonProperty annotations for snake_case JSON serialization.
 * Represents versioned markdown artifacts (mission.md, roadmap.md, backlog.md).
 */
public record ProjectArtifactDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("artifact_type")
    String artifactType,

    @JsonProperty("content")
    String content,

    @JsonProperty("source")
    String source,

    @JsonProperty("revision")
    Integer revision,

    @JsonProperty("created_at")
    Instant createdAt
) {}
