package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for discovery candidate records.
 *
 * Each candidate represents a synthesized meta-model element proposal produced
 * during Phase 1d candidate synthesis. Candidates are scoped to a discovery run
 * and reference the source clusters that contributed to their synthesis.
 *
 * The data field is a JSONB payload with proposed properties (description,
 * tech stack indicators, relationships to other candidates, evidence summary).
 *
 * The sourceClusterIds field is a JSONB array of UUID strings referencing
 * discovery_cluster.id entries that contributed to this candidate's synthesis.
 *
 * The parentCandidateId field is a nullable self-referencing FK to another
 * candidate's ID, enabling parent-child hierarchy (e.g., a service candidate
 * parented under an application candidate). ON DELETE SET NULL at the DB level
 * orphans children when a parent is deleted.
 *
 * Data flow: 1a atoms -> 1b relationships -> 1c clusters -> 1d candidates
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * - Task Group 4: Candidate JPA Stack (1d)
 *
 * Extended: Phase 1d Candidate Generation (Increment 10)
 * - Task Group 6: parentCandidateId column, deleteByRunId
 *
 * Extended: Candidate Review and Approval Workflow (Increment 13)
 * - Task Group 1: reviewStatus, reviewedBy, reviewedAt, previousReviewStatus fields
 *
 * Extended: Log-based Discovery Enrichment (Increment 14)
 * - Task Group 1: logEnrichment JSONB field for log enrichment metadata
 *
 * Extended: Model-Aware Discovery -- Dedup + Enrichment/Link (Spec 2026-05-30)
 * - Task Group 1: operation dimension (create / enrich / link)
 */
@Entity
@Table(
    name = "discovery_candidate",
    indexes = {
        @Index(name = "idx_discovery_candidate_run_id", columnList = "run_id", unique = false),
        @Index(name = "idx_discovery_candidate_run_id_type", columnList = "run_id, candidate_type", unique = false),
        @Index(name = "idx_discovery_candidate_run_id_operation", columnList = "run_id, operation", unique = false),
        @Index(name = "idx_discovery_candidate_run_id_status", columnList = "run_id, status", unique = false),
        @Index(name = "idx_discovery_candidate_run_id_review_status", columnList = "run_id, review_status", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiscoveryCandidateEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Column(name = "candidate_type", nullable = false)
    private String candidateType;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "confidence", nullable = false)
    private double confidence;

    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = "proposed";

    /**
     * Candidate operation dimension: how this candidate relates to the existing
     * model when saved back. NOT a new entity/relationship TYPE -- a dimension on
     * the candidate row, filterable like candidate_type via the
     * (run_id, operation) index.
     *
     * Valid values:
     * - "create" -- propose a brand-new meta-model element (the default).
     * - "enrich" -- add attributes and/or relationships to ONE existing entity
     *               (target referenced by name in {@code data}, resolved late at save-back).
     * - "link"   -- map two EXISTING entities (one logical data entity <-> one
     *               physical data entity) via logical_data_entity_physical_data_entities.
     *
     * NOT NULL DEFAULT 'create' at the DB level (changeset 166); the @Builder.Default
     * here means a null on write coerces to "create" so existing rows and
     * operation-agnostic callers round-trip as create.
     *
     * Spec: Model-Aware Discovery -- Dedup + Enrichment/Link (2026-05-30)
     * - Task Group 1: operation dimension
     */
    @Column(name = "operation")
    @Builder.Default
    private String operation = "create";

    /**
     * JSONB array of UUID strings referencing discovery_cluster.id entries
     * that contributed to this candidate's synthesis.
     */
    @Type(JsonType.class)
    @Column(name = "source_cluster_ids", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<String> sourceClusterIds = new ArrayList<>();

    /**
     * Candidate-specific payload stored as JSONB.
     * Contains proposed properties: description, tech stack indicators,
     * relationships to other candidates, evidence summary, etc.
     */
    @Type(JsonType.class)
    @Column(name = "data", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> data = new HashMap<>();

    /**
     * Optional self-referencing FK to another discovery_candidate.id.
     * Enables parent-child hierarchy between candidates (e.g., a service
     * candidate parented under an application candidate).
     * Nullable for top-level candidates with no parent.
     * ON DELETE SET NULL at the DB level orphans children when parent is deleted.
     *
     * Kept as plain UUID (no @ManyToOne) to match the lightweight FK pattern
     * used elsewhere in the discovery schema.
     *
     * Spec: Phase 1d Candidate Generation (Increment 10)
     * - Task Group 6: parentCandidateId column
     */
    @Column(name = "parent_candidate_id")
    private UUID parentCandidateId;

    @Column(name = "synthesized_at", nullable = false)
    @Builder.Default
    private Instant synthesizedAt = Instant.now();

    /**
     * Review workflow status for user-governed candidate approval.
     * Valid values: pending_review, approved, rejected, deferred.
     * Defaults to "pending_review" for new candidates.
     *
     * Spec: Candidate Review and Approval Workflow (Increment 13)
     * - Task Group 1: review status field
     */
    @Column(name = "review_status")
    @Builder.Default
    private String reviewStatus = "pending_review";

    /**
     * Freeform label identifying who performed the last review action.
     * Examples: "session-abc123", "Alice", "anonymous".
     * Nullable for unreviewed candidates.
     *
     * Spec: Candidate Review and Approval Workflow (Increment 13)
     * - Task Group 1: audit field
     */
    @Column(name = "reviewed_by")
    private String reviewedBy;

    /**
     * Timestamp of when the last review action was performed.
     * Nullable for unreviewed candidates.
     *
     * Spec: Candidate Review and Approval Workflow (Increment 13)
     * - Task Group 1: audit field
     */
    @Column(name = "reviewed_at")
    private Instant reviewedAt;

    /**
     * Captures the review_status value before the most recent review transition.
     * Nullable when no transition has occurred yet.
     * Enables lightweight audit trail for review state changes.
     *
     * Spec: Candidate Review and Approval Workflow (Increment 13)
     * - Task Group 1: audit field
     */
    @Column(name = "previous_review_status")
    private String previousReviewStatus;

    /**
     * JSONB metadata summarizing log enrichment for this candidate.
     * Contains enriched (boolean), logAtomCount (number), signalSummary (string).
     * Nullable for candidates without log enrichment.
     *
     * Spec: Log-based Discovery Enrichment (Increment 14)
     * - Task Group 1: logEnrichment JSONB field
     */
    @Type(JsonType.class)
    @Column(name = "log_enrichment", columnDefinition = "jsonb")
    private Map<String, Object> logEnrichment;

    @PrePersist
    protected void onCreate() {
        if (synthesizedAt == null) {
            synthesizedAt = Instant.now();
        }
        if (operation == null) {
            operation = "create";
        }
    }
}
