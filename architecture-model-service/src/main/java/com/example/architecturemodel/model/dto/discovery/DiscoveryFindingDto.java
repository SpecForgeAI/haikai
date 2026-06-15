package com.example.architecturemodel.model.dto.discovery;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Response shape for a {@code discovery_findings} row, with embedded links.
 *
 * <p>Numeric fields participating in PATCH semantics are boxed
 * ({@link Double} for {@code confidence}) per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <p>Serializes snake_case via the global Jackson
 * {@code spring.jackson.property-naming-strategy: SNAKE_CASE} strategy (no
 * {@code @CamelCaseWire}); {@code reviewStatus} -&gt; {@code review_status},
 * {@code previousReviewStatus} -&gt; {@code previous_review_status}.</p>
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 2; extended by API Test Harness — Findings
 * Integration (2026-05-25) Task Group 1 to add the optional
 * {@code apiBehaviourDiffId} origin field; normalized by Normalize Findings
 * Review Actions (Spec F, 2026-06-02) -- {@code status} renamed to
 * {@code reviewStatus} (candidate-parity disposition vocabulary) plus a
 * {@code previousReviewStatus} audit field.</p>
 *
 * <h2>Origin invariant</h2>
 *
 * <p>Exactly one of {@code runId} / {@code apiBehaviourDiffId} MUST be
 * non-null. Enforced at the DB layer by the
 * {@code discovery_finding_exactly_one_origin} CHECK (changeset 160) and at
 * the service layer in {@code DiscoveryFindingService.createFinding}.</p>
 *
 * <h2>Boxed-type rule for future maintainers</h2>
 *
 * <p>All fields on this DTO are reference types ({@link UUID}, {@link Instant},
 * {@link String}, {@link Double} for {@code confidence}). No primitive-drift
 * risk per {@code project_primitive_double_dto_overwrite.md}. Future
 * maintainers adding numeric fields MUST use boxed types ({@link Integer},
 * {@link Long}, {@link Double}, {@link Boolean}) -- primitives silently wipe
 * to 0 / false on missing JSON during PATCH.</p>
 */
public record DiscoveryFindingDto(
    UUID id,
    UUID runId,
    UUID apiBehaviourDiffId,
    UUID apiBehaviourCaptureSessionId,
    UUID projectId,
    UUID architectureId,
    String findingType,
    String category,
    String severity,
    Double confidence,
    String reviewStatus,
    String previousReviewStatus,
    String title,
    String summary,
    Map<String, Object> detailJson,
    String source,
    String createdByStage,
    Instant createdAt,
    Instant updatedAt,
    Instant reviewedAt,
    String reviewerNotes,
    List<DiscoveryFindingLinkDto> links
) {

    /**
     * Backward-compatible delegating constructor matching the pre-2026-05-25
     * arity (single {@code runId} origin, pre-Spec-F field shape). Defaults
     * {@code apiBehaviourDiffId} to {@code null} and {@code previousReviewStatus}
     * to {@code null} so callers built against the previous shape (mappers,
     * downstream services, existing tests) compile and behave unchanged.
     *
     * <p>NEW callers should use the canonical record constructor and pass
     * either a {@code runId} OR an {@code apiBehaviourDiffId} (never both,
     * never neither -- see the origin invariant above).</p>
     */
    /**
     * Backward-compatible 21-arg constructor preserving the pre-2026-06-11
     * (two-origin) canonical signature. Defaults
     * {@code apiBehaviourCaptureSessionId} to {@code null}.
     */
    public DiscoveryFindingDto(
            UUID id,
            UUID runId,
            UUID apiBehaviourDiffId,
            UUID projectId,
            UUID architectureId,
            String findingType,
            String category,
            String severity,
            Double confidence,
            String reviewStatus,
            String previousReviewStatus,
            String title,
            String summary,
            Map<String, Object> detailJson,
            String source,
            String createdByStage,
            Instant createdAt,
            Instant updatedAt,
            Instant reviewedAt,
            String reviewerNotes,
            List<DiscoveryFindingLinkDto> links) {
        this(
            id,
            runId,
            apiBehaviourDiffId,
            null, // apiBehaviourCaptureSessionId defaulted for backward compatibility
            projectId,
            architectureId,
            findingType,
            category,
            severity,
            confidence,
            reviewStatus,
            previousReviewStatus,
            title,
            summary,
            detailJson,
            source,
            createdByStage,
            createdAt,
            updatedAt,
            reviewedAt,
            reviewerNotes,
            links
        );
    }

    public DiscoveryFindingDto(
            UUID id,
            UUID runId,
            UUID projectId,
            UUID architectureId,
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
            Instant createdAt,
            Instant updatedAt,
            Instant reviewedAt,
            String reviewerNotes,
            List<DiscoveryFindingLinkDto> links) {
        this(
            id,
            runId,
            null, // apiBehaviourDiffId defaulted for backward compatibility
            projectId,
            architectureId,
            findingType,
            category,
            severity,
            confidence,
            reviewStatus,
            null, // previousReviewStatus defaulted for backward compatibility
            title,
            summary,
            detailJson,
            source,
            createdByStage,
            createdAt,
            updatedAt,
            reviewedAt,
            reviewerNotes,
            links
        );
    }
}
