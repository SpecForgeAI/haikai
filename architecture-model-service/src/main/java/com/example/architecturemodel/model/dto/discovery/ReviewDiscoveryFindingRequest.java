package com.example.architecturemodel.model.dto.discovery;

/**
 * Convenience request body for {@code POST .../findings/{id}/review}.
 *
 * <p>Sets {@code review_status} and optionally {@code reviewer_notes}, and
 * stamps {@code reviewed_at} in one call. {@code review_status} must be a
 * reviewer-valid disposition: {@code approved}, {@code rejected}, or
 * {@code deferred} (candidate-parity vocabulary). Transitions are unrestricted
 * (any-&gt;any); the prior value is captured into {@code previous_review_status}.</p>
 *
 * <p>Serializes snake_case via the global Jackson SNAKE_CASE strategy
 * ({@code reviewStatus} -&gt; {@code review_status}).</p>
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 2; normalized by Normalize Findings Review
 * Actions (Spec F, 2026-06-02).</p>
 */
public record ReviewDiscoveryFindingRequest(
    String reviewStatus,
    String reviewerNotes
) {}
