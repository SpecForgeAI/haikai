package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.UUID;

/**
 * Lightweight metadata DTO for project artifacts.
 *
 * Spec 2026-01-04: Roadmap Import UX Glue - Persisted Status + Detailed Counts + Error UX
 * Task Group 2: Latest-Metadata Endpoint for Artifact Status.
 *
 * Contains artifact metadata without the content field.
 * Used by the latest-metadata endpoint for efficient status checks.
 *
 * Uses @JsonProperty for snake_case JSON serialization.
 */
public record ProjectArtifactMetadataDto(
    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("artifact_type")
    String artifactType,

    @JsonProperty("revision")
    Integer revision,

    @JsonProperty("created_at")
    Instant createdAt,

    @JsonProperty("source")
    String source
) {}
