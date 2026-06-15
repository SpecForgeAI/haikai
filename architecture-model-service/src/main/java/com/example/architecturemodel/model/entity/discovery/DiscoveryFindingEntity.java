package com.example.architecturemodel.model.entity.discovery;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * JPA entity for {@code discovery_findings}.
 *
 * <p>Each row is a durable, reviewable migration-intelligence record emitted
 * either by the discovery pipeline ({@link #runId} set) OR by the
 * api-behaviour diff runner ({@link #apiBehaviourDiffId} set). Exactly one
 * origin column MUST be non-null; the DB-level
 * {@code discovery_finding_exactly_one_origin} CHECK constraint (changeset
 * 160) enforces this invariant. The service layer mirrors the check for
 * fail-fast error messages.</p>
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 1; extended by API Test Harness — Findings
 * Integration (2026-05-25) Task Group 1 to add the api-behaviour-diff origin;
 * normalized by Normalize Findings Review Actions (Spec F, 2026-06-02) Task
 * Group 1 -- {@code status} renamed to {@code reviewStatus} (candidate-parity
 * disposition vocabulary) plus a {@code previousReviewStatus} audit trail.</p>
 *
 * <p><b>Boxed types for PATCH safety:</b> {@code confidence} is {@link Double}
 * (NOT primitive {@code double}). The PATCH-style update endpoint must be able
 * to distinguish "field omitted" from "field set to 0.0". See project memory
 * note {@code project_primitive_double_dto_overwrite.md}. The new
 * {@link #apiBehaviourDiffId} is reference-typed ({@link UUID}); no
 * primitive-drift risk.</p>
 *
 * <p><b>String-typed enumish fields:</b> {@code finding_type}, {@code category},
 * {@code severity}, {@code review_status}, {@code source},
 * {@code created_by_stage} are plain {@link String} (not Java enums). This
 * matches the existing discovery family ({@code DiscoveryCandidateEntity.reviewStatus},
 * {@code DiscoveryEvidenceEntity.type}) and preserves extensibility for pack
 * values without DDL or service redeploys.</p>
 */
@Entity
@Table(
    name = "discovery_findings",
    indexes = {
        @Index(name = "idx_discovery_finding_run_id", columnList = "run_id"),
        @Index(name = "idx_discovery_finding_project_id", columnList = "project_id"),
        @Index(name = "idx_discovery_finding_architecture_id", columnList = "architecture_id"),
        @Index(name = "idx_discovery_finding_review_status", columnList = "review_status"),
        @Index(name = "idx_discovery_finding_category", columnList = "category"),
        @Index(name = "idx_discovery_finding_severity", columnList = "severity"),
        @Index(name = "idx_discovery_finding_finding_type", columnList = "finding_type"),
        @Index(name = "idx_discovery_finding_source", columnList = "source"),
        @Index(name = "idx_discovery_finding_api_behaviour_diff_id", columnList = "api_behaviour_diff_id"),
        @Index(name = "idx_discovery_finding_api_behaviour_capture_session_id", columnList = "api_behaviour_capture_session_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiscoveryFindingEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    /**
     * Origin: the discovery_run that produced this finding. Nullable as of
     * changeset 160 (was NOT NULL prior). Exactly one of {@link #runId} /
     * {@link #apiBehaviourDiffId} MUST be non-null -- enforced at the DB
     * via the {@code discovery_finding_exactly_one_origin} CHECK and at
     * the service layer in {@code DiscoveryFindingService.createFinding}.
     */
    @Column(name = "run_id")
    private UUID runId;

    /**
     * Origin: the api_behaviour_diff that produced this finding. Nullable;
     * mutually exclusive with {@link #runId} (see Javadoc on {@link #runId}).
     * CASCADE deletes findings when the source diff is deleted (changeset
     * 160). Recompute, however, keeps the diff row alive while replacing
     * diff_items; {@code diffRunner.ts} MUST explicitly call
     * {@code deleteFindingsByApiBehaviourDiffId(diffId)} BEFORE re-emit
     * (load-bearing, NOT defensive -- accepted Q6).
     */
    @Column(name = "api_behaviour_diff_id")
    private UUID apiBehaviourDiffId;

    /**
     * Origin: the api_behaviour_capture_session whose inventory
     * reconciliation produced this finding (THIRD origin, changeset 179 --
     * Spec: Model-Seeded Capture Inventory, 2026-06-11). Nullable; mutually
     * exclusive with {@link #runId} / {@link #apiBehaviourDiffId} via the
     * re-created three-way {@code discovery_finding_exactly_one_origin}
     * CHECK. CASCADE deletes findings when the session is deleted; a
     * reconciliation RE-RUN keeps the session row alive, so the AMS
     * reconciliation endpoint MUST call
     * {@code deleteFindingsByCaptureSessionId(sessionId)} BEFORE re-emit
     * (load-bearing, NOT defensive -- diffRunner Q6 precedent).
     */
    @Column(name = "api_behaviour_capture_session_id")
    private UUID apiBehaviourCaptureSessionId;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    @Column(name = "finding_type", nullable = false)
    private String findingType;

    @Column(name = "category", nullable = false)
    private String category;

    @Column(name = "severity", nullable = false)
    private String severity;

    /** Boxed {@link Double} so PATCH preserves {@code null}. */
    @Column(name = "confidence")
    private Double confidence;

    /**
     * Reviewer disposition (candidate-parity vocabulary). Default
     * {@code pending_review} on emit; reviewer actions drive transitions to
     * {@code approved} / {@code rejected} / {@code deferred}. Renamed from
     * {@code status} by Spec F (2026-06-02). Transitions are unrestricted
     * (any-&gt;any); {@link #previousReviewStatus} captures the prior value.
     */
    @Column(name = "review_status", nullable = false)
    @Builder.Default
    private String reviewStatus = "pending_review";

    /**
     * Captures the {@code review_status} value before the most recent review
     * transition. Nullable when no transition has occurred yet. Mirrors
     * {@code DiscoveryCandidateEntity.previousReviewStatus} -- lightweight
     * audit / re-open trail. Spec F (2026-06-02).
     */
    @Column(name = "previous_review_status")
    private String previousReviewStatus;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "summary")
    private String summary;

    /**
     * Optional finding-type-specific structured payload. Stored as JSONB
     * (via Hypersistence {@link JsonType}); read paths see {@code Map}.
     */
    @Type(JsonType.class)
    @Column(name = "detail_json", columnDefinition = "jsonb")
    private Map<String, Object> detailJson;

    @Column(name = "source")
    private String source;

    @Column(name = "created_by_stage")
    private String createdByStage;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "reviewed_at")
    private Instant reviewedAt;

    @Column(name = "reviewer_notes")
    private String reviewerNotes;

    @PrePersist
    protected void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        if (updatedAt == null) {
            updatedAt = now;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
