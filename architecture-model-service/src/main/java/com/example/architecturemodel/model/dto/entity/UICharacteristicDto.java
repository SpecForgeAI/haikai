package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO for UI Characteristic entity.
 *
 * Captures business features and UI/UX/technical characteristics associated
 * with frontend UIs, linked to Application Points.
 *
 * Spec: UI Characteristics
 */
public record UICharacteristicDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("ui_id")
    String uiId,

    @JsonProperty("type")
    String type,

    @JsonProperty("key")
    String key,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("evidence")
    String evidence
) {}
