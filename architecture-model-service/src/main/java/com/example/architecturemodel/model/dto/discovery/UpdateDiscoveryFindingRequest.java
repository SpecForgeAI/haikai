package com.example.architecturemodel.model.dto.discovery;

import java.util.Map;

/**
 * PATCH body for {@code discovery_findings}.
 *
 * <p>All fields are nullable. A {@code null} field means "leave the persisted
 * value alone" -- the service-layer null-guards every field per
 * {@code project_primitive_double_dto_overwrite.md}. {@code confidence} is
 * boxed {@link Double} for this exact reason.</p>
 *
 * <p>When {@code review_status} is non-null it is validated against the
 * full disposition set ({@code pending_review}, {@code approved},
 * {@code rejected}, {@code deferred}) and applied; transitions are unrestricted
 * (any-&gt;any) and the prior value is captured into
 * {@code previous_review_status}. The convenience {@code POST .../review}
 * endpoint should be preferred for reviewer disposition actions; this PATCH
 * supports general edits + reviewer-notes-only updates.</p>
 *
 * <p>Serializes snake_case via the global Jackson SNAKE_CASE strategy
 * ({@code reviewStatus} -&gt; {@code review_status}).</p>
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 2; normalized by Normalize Findings Review
 * Actions (Spec F, 2026-06-02).</p>
 */
public record UpdateDiscoveryFindingRequest(
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
    String reviewerNotes
) {}
