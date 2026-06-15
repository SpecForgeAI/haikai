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
 * JPA entity for {@code discovery_capability} (Liquibase changeset 184).
 *
 * <p>Each row is a synthesised CAPABILITY: a cross-cutting current-state
 * aggregation of related discovery findings / candidates / architecture
 * elements / relationships (e.g. "Daily Risk Hierarchy Load Pipeline"), so the
 * related per-file operational findings become ONE migration story instead of
 * thirty disconnected file findings. This is the single new model concept of the
 * 6-spec discovery-completeness program -- Option A (a findings-side grouping),
 * shaped so it can graduate to a first-class "Discovered Capabilities" output
 * (Option B) later with NO data re-model. Members and outbound
 * architecture-entity links live ONLY in {@link DiscoveryCapabilityMemberEntity},
 * never on this row.</p>
 *
 * <p>Modeled structurally on {@link DiscoveryFindingEntity} +
 * {@code MigrationReconciliationBreakEntity} (changeset 183): same Lombok layout,
 * same {@code @PrePersist} / {@code @PreUpdate} timestamp callbacks, same
 * hypersistence {@link JsonType} JSONB mapping, and the same boxed-reference-type
 * discipline so PATCH semantics preserve {@code null} per
 * {@code project_primitive_double_dto_overwrite.md} -- an omitted DTO field on an
 * update never silently wipes the column. This is load-bearing for
 * {@link #confidence} ({@link Double}: a primitive {@code double} would silently
 * reset the synthesis confidence to {@code 0.0} on an unrelated PATCH).</p>
 *
 * <p><b>String-typed enumish fields:</b> {@code kind}, {@code review_status},
 * {@code source}, {@code created_by_stage} are plain {@link String} (not Java
 * enums), matching the existing discovery family
 * ({@code DiscoveryFindingEntity.reviewStatus}). {@code kind} in particular is
 * free-text / extensible (e.g. {@code batch_pipeline} | {@code monitoring} |
 * {@code ftp_ingestion} | {@code deployment} | {@code housekeeping}) -- new pack
 * values need no DDL or service redeploy.</p>
 *
 * <p><b>Review lifecycle (D6):</b> {@code review_status} mirrors the finding /
 * candidate vocabulary ({@code pending_review} default; {@code approved} /
 * {@code rejected} / {@code deferred}) with a {@link #previousReviewStatus} audit
 * field. Approving / rejecting a capability does NOT cascade to its members in
 * D2 -- members keep independent {@code review_status}; the capability
 * disposition is a separate, additive signal (cascade deferred to the
 * keystone / gate specs).</p>
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1.</p>
 */
@Entity
@Table(
    name = "discovery_capability",
    indexes = {
        @Index(name = "idx_discovery_capability_run_id", columnList = "run_id"),
        @Index(name = "idx_discovery_capability_project_id", columnList = "project_id"),
        @Index(name = "idx_discovery_capability_architecture_id", columnList = "architecture_id"),
        @Index(name = "idx_discovery_capability_review_status", columnList = "review_status")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiscoveryCapabilityEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    /**
     * The discovery_run that synthesised this capability (the read key).
     * Nullable / soft reference (no FK) -- mirrors
     * {@code discovery_findings.run_id}.
     */
    @Column(name = "run_id")
    private UUID runId;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    /**
     * The capability label (e.g. "Daily Risk Hierarchy Load Pipeline"). The LLM
     * is naming-only; it NEVER decides membership.
     */
    @Column(name = "name", nullable = false)
    private String name;

    /**
     * The LLM-classified kind, free-text / extensible, NO DB enum (e.g.
     * {@code batch_pipeline} | {@code monitoring} | {@code ftp_ingestion} |
     * {@code deployment} | {@code housekeeping}). String-as-TEXT per the AMS
     * status-as-TEXT convention.
     */
    @Column(name = "kind")
    private String kind;

    @Column(name = "summary")
    private String summary;

    /**
     * Reviewer disposition (candidate / finding-parity vocabulary). Default
     * {@code pending_review} on emit; reviewer actions drive transitions to
     * {@code approved} / {@code rejected} / {@code deferred}. Transitions are
     * unrestricted (any-&gt;any); {@link #previousReviewStatus} captures the
     * prior value. D2: a capability disposition does NOT cascade to members.
     */
    @Column(name = "review_status", nullable = false)
    @Builder.Default
    private String reviewStatus = "pending_review";

    /**
     * The {@code review_status} value before the most recent review transition
     * (lightweight audit / re-open trail). Nullable when no transition has
     * occurred yet. Mirrors {@code DiscoveryFindingEntity.previousReviewStatus}.
     */
    @Column(name = "previous_review_status")
    private String previousReviewStatus;

    /**
     * The synthesis confidence. BOXED {@link Double} (NOT primitive
     * {@code double}) per {@code project_primitive_double_dto_overwrite.md}: a
     * primitive would silently default to {@code 0.0} on a PATCH that omits the
     * field and could wipe the synthesis confidence. Nullable.
     */
    @Column(name = "confidence")
    private Double confidence;

    /**
     * The structured capability payload (the JIL-DAG topology snapshot, the typed
     * {@code invocations[]} edges, schedule / trigger metadata, external systems,
     * and the aggregated {@code behaviourBearing} hint -- the D4-gate forward
     * seam). Stored as JSONB via Hibernate's {@link JsonType}; read paths see
     * {@code Map}. NULL is the valid empty state. BOXED {@link Map} so a PATCH
     * that omits the field never wipes the column.
     */
    @Type(JsonType.class)
    @Column(name = "detail_json", columnDefinition = "jsonb")
    private Map<String, Object> detailJson;

    /**
     * The synthesis provenance (e.g. {@code jil_dag_closure} |
     * {@code co_location_heuristic}). Nullable; String.
     */
    @Column(name = "source")
    private String source;

    /**
     * The pipeline stage that emitted the capability (e.g.
     * {@code capability_synthesis}). Nullable; String.
     */
    @Column(name = "created_by_stage")
    private String createdByStage;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    protected void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        if (updatedAt == null) {
            updatedAt = now;
        }
        if (reviewStatus == null) {
            reviewStatus = "pending_review";
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
