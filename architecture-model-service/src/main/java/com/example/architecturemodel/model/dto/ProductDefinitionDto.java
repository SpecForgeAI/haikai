package com.example.architecturemodel.model.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * DTO for ProductDefinition entity.
 *
 * Uses Java record with camelCase field names for API responses.
 * Maps from ProductDefinitionEntity via ProductDefinitionMapper.
 * No @JsonAlias annotations needed -- API returns camelCase natively
 * via Spring Boot default Jackson serialization.
 *
 * Spec: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)
 */
public record ProductDefinitionDto(
    UUID id,
    UUID projectId,
    String productName,
    Instant createdAt,
    Instant updatedAt
) {
}
