package com.example.architecturemodel.model.dto.discovery;

import java.util.List;

/**
 * Request body for {@code POST .../findings/bulk}.
 *
 * <p>Bulk-create entry point used by the discovery-service
 * {@code FindingEmitter} after merge. Service-layer enforces a per-request
 * cap (see {@code DiscoveryFindingService.MAX_BULK_FINDINGS}); requests over
 * the cap are rejected with 400 rather than truncated.</p>
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 2.</p>
 */
public record BulkCreateDiscoveryFindingsRequest(
    List<CreateDiscoveryFindingRequest> findings
) {}
