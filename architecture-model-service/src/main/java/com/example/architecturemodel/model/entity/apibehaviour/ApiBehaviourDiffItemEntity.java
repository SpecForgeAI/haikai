package com.example.architecturemodel.model.entity.apibehaviour;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
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
 * Per-scenario diff classification row produced by {@code diffRunner.ts}
 * (in {@code api-migration-validation-service}) and persisted via the diff
 * service.
 *
 * <p>Each row captures one ({@code method}, {@code path},
 * {@code scenario_name}) comparison between the source and target
 * baselines.</p>
 *
 * <h2>Classification taxonomy</h2>
 *
 * <p>{@code statusClassification} (NOT NULL):
 * {@code status_match} | {@code status_drift} | {@code source_only} |
 * {@code target_only}.</p>
 *
 * <p>{@code bodyClassification} (NULL when source_only / target_only -- no
 * pair to body-compare): {@code body_match} | {@code body_shape_drift} |
 * {@code body_value_drift} | {@code body_ordering_drift}. The
 * {@code body_ordering_drift} value (added by Reconcile Full-Response
 * Fidelity, 2026-06-17) tags a non-volatile array reorder as its own
 * dimension instead of a {@code body_value_drift} cascade -- no schema
 * change, service-layer validation only.</p>
 *
 * <p>{@code headerClassification} (NULL when source_only / target_only, or
 * when EITHER side lacks a {@code {headers, body\}} response wrapper so the
 * header dimension is skipped -- no header pair to compare):
 * {@code header_match} | {@code header_value_drift} |
 * {@code header_presence_drift}. Mirrors {@code bodyClassification}; added by
 * Reconcile Full-Response Fidelity (2026-06-17) so a Content-Type flip, a
 * dropped/added header, or a non-allowlisted header value change surfaces as
 * its own typed dimension instead of being silently discarded.</p>
 *
 * <p>Validated at the service layer (no DB enum, matches existing AMS
 * convention for status discriminators).</p>
 *
 * <h2>PATCH safety on numeric status fields</h2>
 *
 * <p><b>{@link #sourceResponseStatus} and {@link #targetResponseStatus} are
 * BOXED {@link Integer} -- never primitive {@code int}.</b> Per
 * {@code project_primitive_double_dto_overwrite.md}, any field that
 * participates in PATCH semantics must be a boxed type so a missing JSON
 * field does NOT silently wipe to {@code 0}. They are also nullable in
 * the schema (when classification is {@code source_only} / {@code target_only}
 * one of the two sides has no response).</p>
 *
 * <h2>Logical references</h2>
 *
 * <p>{@link #sourceBaselineItemId} and {@link #targetBaselineItemId} are
 * LOGICAL references at {@code api_behaviour_baseline_items} (no FK
 * constraint). The diff_item outlives item-level edits; this matches the
 * existing soft-reference pattern used by
 * {@link ApiBehaviourBaselineItemEntity} for {@code captureId},
 * {@code operationId}, and {@code scenarioId}.</p>
 *
 * <h2>Cascade behaviour</h2>
 *
 * <p>ON DELETE CASCADE on {@code diff_id} closes the cleanup loop: deleting
 * the parent diff (which CASCADEs from baseline-deletion) removes all
 * diff_items.</p>
 *
 * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 1</p>
 * <p>Extended: Reconcile Full-Response Fidelity &amp; Distinct Break Types
 * (2026-06-17) — Task Group 1 ({@code headerClassification} column +
 * {@code body_ordering_drift} body sub-classification value).</p>
 */
@Entity
@Table(
    name = "api_behaviour_diff_items",
    indexes = {
        @Index(
            name = "api_behaviour_diff_items_diff_idx",
            columnList = "diff_id"
        ),
        @Index(
            name = "api_behaviour_diff_items_method_path_idx",
            columnList = "diff_id, method, path"
        )
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApiBehaviourDiffItemEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "diff_id", nullable = false)
    private UUID diffId;

    @Column(name = "method", nullable = false)
    private String method;

    @Column(name = "path", nullable = false)
    private String path;

    @Column(name = "scenario_name", nullable = false)
    private String scenarioName;

    /**
     * Logical reference (no FK) at {@code api_behaviour_baseline_items}.
     * NULL on {@code target_only} rows.
     */
    @Column(name = "source_baseline_item_id")
    private UUID sourceBaselineItemId;

    /**
     * Logical reference (no FK) at {@code api_behaviour_baseline_items}.
     * NULL on {@code source_only} rows.
     */
    @Column(name = "target_baseline_item_id")
    private UUID targetBaselineItemId;

    /**
     * Discrete bucket. Valid values: {@code status_match} |
     * {@code status_drift} | {@code source_only} | {@code target_only}.
     * Validated at the service layer.
     */
    @Column(name = "status_classification", nullable = false)
    private String statusClassification;

    /**
     * Discrete bucket. Valid values: {@code body_match} |
     * {@code body_shape_drift} | {@code body_value_drift} |
     * {@code body_ordering_drift}. NULL when {@link #statusClassification} is
     * {@code source_only} / {@code target_only}. Validated at the service
     * layer.
     */
    @Column(name = "body_classification")
    private String bodyClassification;

    /**
     * Discrete bucket for the response-HEADER dimension. Valid values:
     * {@code header_match} | {@code header_value_drift} |
     * {@code header_presence_drift}. NULL when {@link #statusClassification}
     * is {@code source_only} / {@code target_only} (no pair), OR when either
     * side lacks a {@code {headers, body\}} response wrapper so the header
     * dimension is skipped (graceful degrade -- no false header break).
     * Validated at the service layer (no DB enum, mirrors
     * {@link #bodyClassification}).
     *
     * <p>Spec: Reconcile Full-Response Fidelity (2026-06-17) — Task Group 1.</p>
     */
    @Column(name = "header_classification")
    private String headerClassification;

    /**
     * HTTP response status from the source baseline item.
     *
     * <p>Boxed {@link Integer} required for PATCH safety -- primitive
     * {@code int} would silently wipe to 0 on missing JSON per
     * {@code project_primitive_double_dto_overwrite.md}. Also nullable
     * (NULL on {@code target_only} rows where the source had no response).</p>
     */
    @Column(name = "source_response_status")
    private Integer sourceResponseStatus;

    /**
     * HTTP response status from the target baseline item.
     *
     * <p>Boxed {@link Integer} required for PATCH safety -- see
     * {@link #sourceResponseStatus}.</p>
     */
    @Column(name = "target_response_status")
    private Integer targetResponseStatus;

    /**
     * Flat JSON-pointer-keyed annotation map produced by
     * {@code jsonShapeComparator.ts}. NULL when no pair (source_only /
     * target_only).
     *
     * <p>Persisted as JSONB; mapped via the established
     * {@code @Type(JsonType.class)} hypersistence pattern used by
     * {@link ApiBehaviourBaselineItemEntity#getRequestJson()} /
     * {@link ApiBehaviourBaselineItemEntity#getResponseJson()}.</p>
     */
    @Type(JsonType.class)
    @Column(name = "body_diff_json", columnDefinition = "jsonb")
    private Map<String, Object> bodyDiffJson;

    /**
     * Free-text reason carried on source_only / target_only rows. Common
     * values: {@code mutating_skipped} | {@code transport_failure} |
     * {@code no_paired_target}.
     */
    @Column(name = "notes")
    private String notes;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
