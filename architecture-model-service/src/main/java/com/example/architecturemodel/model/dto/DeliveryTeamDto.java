package com.example.architecturemodel.model.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * DTO for DeliveryTeam entity.
 *
 * Uses Java record with camelCase field names for API responses.
 * Maps from DeliveryTeamEntity via DeliveryTeamMapper.
 * No @JsonProperty annotations needed -- relies on global Jackson SNAKE_CASE
 * property naming strategy.
 *
 * Spec: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)
 */
public record DeliveryTeamDto(
    UUID id,
    UUID projectId,
    String name,
    String type,
    String description,
    Instant createdAt,
    Instant updatedAt
) {
}
