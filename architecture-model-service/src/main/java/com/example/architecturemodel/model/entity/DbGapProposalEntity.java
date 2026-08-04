package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * JPA Entity for one per-project DB gap-proposal row (Liquibase changeset
 * 216). One row per LLM- (or manually-) proposed fix for a DB structural
 * finding: a missing FK join ({@code kind=fk_join}) or a missing primary key
 * ({@code kind=primary_key}).
 *
 * <p>Proposal rows are NOT pack rows -- packs are wholesale delete+insert on
 * regeneration, while this table is the review-queue DURABILITY mechanism:
 * rows are keyed by {@code project_id} + the stable {@link #proposalKey}
 * identity ({@code fk--<relationship_id>} / {@code pk--<table>}, unique per
 * project via {@code uq_dgp_project_proposal_key}), so a re-proposed gap
 * re-links to its existing row. Refresh upserts only touch rows still
 * {@code unreviewed} (service-enforced): approved / rejected / needs_rework
 * rows are human state and are left verbatim.</p>
 *
 * <p>{@link #payloadJson} is kind-shaped: {@code fk_join} carries
 * {@code {relationship_id, from_table, join_columns[], to_table,
 * referenced_columns[]}}; {@code primary_key} carries
 * {@code {table, entity_id, columns[]}}.</p>
 *
 * <p>Spec: LLM gap-proposal queue (2026-08-04) -- Spec 4.</p>
 */
@Entity
@Table(
    name = "db_gap_proposals",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uq_dgp_project_proposal_key",
            columnNames = {"project_id", "proposal_key"}
        )
    },
    indexes = {
        @Index(name = "idx_dgp_project", columnList = "project_id", unique = false),
        @Index(name = "idx_dgp_project_finding",
            columnList = "project_id, finding_key", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DbGapProposalEntity {

    public static final String KIND_FK_JOIN = "fk_join";
    public static final String KIND_PRIMARY_KEY = "primary_key";

    /** All allowed proposal kinds, mirroring chk_dgp_kind. */
    public static final Set<String> ALL_KINDS = Set.of(
        KIND_FK_JOIN,
        KIND_PRIMARY_KEY
    );

    public static final String CONFIDENCE_HIGH = "high";
    public static final String CONFIDENCE_MEDIUM = "medium";
    public static final String CONFIDENCE_LOW = "low";

    /** All allowed confidences, mirroring chk_dgp_confidence (NULL also allowed). */
    public static final Set<String> ALL_CONFIDENCES = Set.of(
        CONFIDENCE_HIGH,
        CONFIDENCE_MEDIUM,
        CONFIDENCE_LOW
    );

    public static final String ORIGIN_LLM = "llm";
    public static final String ORIGIN_MANUAL = "manual";

    /** All allowed origins, mirroring chk_dgp_origin. */
    public static final Set<String> ALL_ORIGINS = Set.of(
        ORIGIN_LLM,
        ORIGIN_MANUAL
    );

    public static final String REVIEW_UNREVIEWED = "unreviewed";
    public static final String REVIEW_APPROVED = "approved";
    public static final String REVIEW_REJECTED = "rejected";
    public static final String REVIEW_NEEDS_REWORK = "needs_rework";

    /** All allowed review statuses, mirroring chk_dgp_review_status. */
    public static final Set<String> ALL_REVIEW_STATUSES = Set.of(
        REVIEW_UNREVIEWED,
        REVIEW_APPROVED,
        REVIEW_REJECTED,
        REVIEW_NEEDS_REWORK
    );

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /**
     * Stable identity {@code fk--<relationship_id>} / {@code pk--<table>}.
     * Unique per project so re-proposal re-links instead of duplicating.
     */
    @Column(name = "proposal_key", nullable = false, columnDefinition = "TEXT")
    private String proposalKey;

    /** The structural finding this proposal addresses. */
    @Column(name = "finding_key", nullable = false, columnDefinition = "TEXT")
    private String findingKey;

    /** One of {@link #ALL_KINDS}; chk_dgp_kind is the source of truth. */
    @Column(name = "kind", nullable = false, columnDefinition = "TEXT")
    private String kind;

    /**
     * The kind-shaped proposed change. {@code fk_join}: {@code
     * {relationship_id, from_table, join_columns[], to_table,
     * referenced_columns[]}}; {@code primary_key}: {@code {table, entity_id,
     * columns[]}}.
     */
    @Type(JsonType.class)
    @Column(name = "payload_json", nullable = false, columnDefinition = "jsonb")
    private Map<String, Object> payloadJson;

    /** The proposer's reasoning (free text). */
    @Column(name = "rationale", columnDefinition = "TEXT")
    private String rationale;

    /** One of {@link #ALL_CONFIDENCES} or {@code null}; chk_dgp_confidence. */
    @Column(name = "confidence", columnDefinition = "TEXT")
    private String confidence;

    /** One of {@link #ALL_ORIGINS}; chk_dgp_origin is the source of truth. */
    @Column(name = "origin", nullable = false, columnDefinition = "TEXT")
    @Builder.Default
    private String origin = ORIGIN_LLM;

    /** One of {@link #ALL_REVIEW_STATUSES}; chk_dgp_review_status is the source of truth. */
    @Column(name = "review_status", nullable = false, columnDefinition = "TEXT")
    @Builder.Default
    private String reviewStatus = REVIEW_UNREVIEWED;

    @Column(name = "reviewer_notes", columnDefinition = "TEXT")
    private String reviewerNotes;

    /** Stamped when the model write-back for an approved proposal succeeded. */
    @Column(name = "applied_at")
    private Instant appliedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    /** Stamped when a review action is persisted. */
    @Column(name = "reviewed_at")
    private Instant reviewedAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (origin == null) {
            origin = ORIGIN_LLM;
        }
        if (reviewStatus == null) {
            reviewStatus = REVIEW_UNREVIEWED;
        }
    }
}
