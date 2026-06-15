package com.example.architecturemodel.model.dto.discovery;

import java.time.Instant;
import java.util.UUID;

/**
 * Response shape for a {@code discovery_finding_links} row.
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 2.</p>
 */
public record DiscoveryFindingLinkDto(
    UUID id,
    UUID findingId,
    String linkType,
    String targetType,
    String targetId,
    String label,
    Instant createdAt
) {}
