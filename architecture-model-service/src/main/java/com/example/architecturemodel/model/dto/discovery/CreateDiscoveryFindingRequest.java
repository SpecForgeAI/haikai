package com.example.architecturemodel.model.dto.discovery;

import java.util.List;
import java.util.Map;

/**
 * Request body for creating a single {@code discovery_findings} row.
 *
 * <p>Scoping ids ({@code runId}, {@code projectId}, {@code architectureId})
 * come from the controller path, not the body. {@code links} on the request
 * are validated per D6 (hard-reject on invalid target) and inserted
 * transactionally with the finding.</p>
 *
 * <p>{@code reviewStatus} is optional on create; when omitted the service
 * applies the {@code pending_review} default. Serializes snake_case via the
 * global Jackson SNAKE_CASE strategy ({@code reviewStatus} -&gt;
 * {@code review_status}).</p>
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 2; normalized by Normalize Findings Review
 * Actions (Spec F, 2026-06-02) -- {@code status} renamed to
 * {@code reviewStatus}.</p>
 */
public record CreateDiscoveryFindingRequest(
    String findingType,
    String category,
    String severity,
    Double confidence,
    String reviewStatus,
    String title,
    String summary,
    Map<String, Object> detailJson,
    String source,
    String createdByStage,
    String reviewerNotes,
    List<CreateDiscoveryFindingLinkRequest> links
) {

    /**
     * Inline shape for link rows submitted with a finding create. Identical
     * field set to the standalone {@code POST .../links} endpoint.
     */
    public record CreateDiscoveryFindingLinkRequest(
        String linkType,
        String targetType,
        String targetId,
        String label
    ) {}
}
