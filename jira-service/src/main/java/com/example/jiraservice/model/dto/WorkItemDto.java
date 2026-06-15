package com.example.jiraservice.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Data Transfer Object for work items.
 *
 * Uses Java record with @JsonProperty annotations for snake_case JSON serialization.
 * Represents hierarchical work items (Initiative, Epic, Feature, Story).
 *
 * <p>This is a duplicate of the WorkItemDto from architecture-model-service,
 * with identical fields, types, and @JsonProperty annotations.</p>
 */
public record WorkItemDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    String projectId,

    @JsonProperty("type")
    String type,

    @JsonProperty("parent_id")
    UUID parentId,

    @JsonProperty("title")
    String title,

    @JsonProperty("description")
    String description,

    @JsonProperty("status")
    String status,

    @JsonProperty("sort_order")
    Integer sortOrder,

    @JsonProperty("priority")
    Integer priority,

    @JsonProperty("target_window")
    String targetWindow,

    @JsonProperty("tags")
    Map<String, Object> tags,

    @JsonProperty("external_system")
    String externalSystem,

    @JsonProperty("external_key")
    String externalKey,

    @JsonProperty("created_at")
    Instant createdAt,

    @JsonProperty("updated_at")
    Instant updatedAt
) {}
