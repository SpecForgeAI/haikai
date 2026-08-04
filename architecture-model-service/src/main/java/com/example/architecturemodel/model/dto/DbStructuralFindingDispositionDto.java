package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/**
 * Wire DTO for one per-project DB structural-finding disposition row.
 * Snake_case wire per the AMS global default (NO {@code @CamelCaseWire} --
 * the gateway disposition routes and the frontend structural-findings panel
 * both speak snake_case).
 *
 * <p>Spec: Structural findings dispositions (2026-08-04) -- Spec 2.</p>
 *
 * @param id Internal database UUID (server-generated).
 * @param projectId Owning project UUID (server-stamped from the path).
 * @param findingKey Stable identity {@code kind:subject}, unique per project.
 * @param kind Finding kind (e.g. {@code no_primary_keys}).
 * @param subject Finding subject (e.g. {@code all_tables}).
 * @param disposition One of {@code accepted | fix_upstream | known_gap}.
 * @param note Rationale; mandatory when disposition is {@code accepted} or
 *     {@code known_gap}.
 * @param createdAt ISO-8601 creation timestamp.
 * @param updatedAt ISO-8601 timestamp of the last upsert of an existing row
 *     (nullable -- {@code null} until first update).
 */
public record DbStructuralFindingDispositionDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("finding_key")
    String findingKey,

    @JsonProperty("kind")
    String kind,

    @JsonProperty("subject")
    String subject,

    @JsonProperty("disposition")
    String disposition,

    @JsonProperty("note")
    String note,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt
) {}
