package com.example.architecturemodel.model.entity.apibehaviour;

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
 * Per-baseline frozen capture row.
 *
 * <p>Each row freezes one accepted (capture, operation, scenario) triple as
 * part of a saved baseline. Rather than referencing the live capture row, the
 * request/response bodies are copied into {@code request_json} and
 * {@code response_json} so a baseline remains a stable artefact even if the
 * source session is later deleted.</p>
 *
 * <p>{@code capture_id}, {@code scenario_id}, {@code operation_id} are
 * logical references for traceability only; cascade flows from the parent
 * baseline.</p>
 *
 * <p><b>{@code response_status}</b> is <b>boxed</b> {@link Integer}: the
 * column is {@code NOT NULL} at the DB level (a baseline item only freezes a
 * capture that produced a response) but PATCH on the row should still
 * preserve {@code null} when omitted (see project memory note
 * {@code project_primitive_double_dto_overwrite.md}).</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 1.
 * Extended by Reconcile-Time Determinism &amp; Volatile-Value Handling
 * (2026-06-16) — Task Group 1 (the nullable {@code volatile_paths_json}
 * volatility envelope; changeset 187). Extended by Stateful Sequence Scenarios
 * (2026-06-18) — Task Group 1 (the nullable {@code sequence_json} pinned ordered
 * chain; changeset 192).</p>
 */
@Entity
@Table(
    name = "api_behaviour_baseline_items",
    indexes = {
        @Index(
            name = "idx_api_behaviour_baseline_item_baseline",
            columnList = "baseline_id"
        )
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApiBehaviourBaselineItemEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "baseline_id", nullable = false)
    private UUID baselineId;

    @Column(name = "capture_id", nullable = false)
    private UUID captureId;

    @Column(name = "operation_id", nullable = false)
    private UUID operationId;

    @Column(name = "scenario_id", nullable = false)
    private UUID scenarioId;

    @Column(name = "method", nullable = false)
    private String method;

    @Column(name = "path", nullable = false)
    private String path;

    @Column(name = "scenario_name", nullable = false)
    private String scenarioName;

    /**
     * Pre-redacted request body snapshot copied from the source capture row
     * at save-time.
     */
    @Type(JsonType.class)
    @Column(name = "request_json", columnDefinition = "jsonb", nullable = false)
    private Map<String, Object> requestJson;

    /** NOT NULL at DB level, but boxed {@link Integer} for PATCH safety. */
    @Column(name = "response_status", nullable = false)
    private Integer responseStatus;

    /**
     * Pre-redacted response body snapshot copied from the source capture row
     * at save-time.
     */
    @Type(JsonType.class)
    @Column(name = "response_json", columnDefinition = "jsonb", nullable = false)
    private Map<String, Object> responseJson;

    /**
     * Empirically-measured volatility envelope for this captured scenario,
     * shaped {@code { paths, volatility_source, k }} (the differing
     * JSON-Pointer path list, the {@code volatility_source} taxonomy tag, and
     * the completed-repeat count). Written ONCE by the capture-time volatility
     * probe at pin time and never mutated thereafter, consistent with baseline
     * immutability — it ANNOTATES the pinned oracle, it never changes a
     * captured value. The reconcile diff engine reads it to tolerate volatile
     * VALUES + ORDERING per-path (shape diffs on a volatile path STILL break).
     *
     * <p><b>{@code null} means no volatility recorded</b> and yields strict
     * comparison — the backward-compatible default (today's behaviour) and the
     * state of every already-pinned baseline (NO backfill). It is
     * distinguishable from a probed-but-non-JSON body, which records a non-null
     * envelope tagged {@code volatility_source: "non_json"}.</p>
     *
     * <p>Nullable, boxed reference type, no backfill: existing baseline-item
     * rows are untouched and read back with {@code null}. No
     * {@code @PrePersist} defaulting — {@code null} is the valid empty state.</p>
     *
     * <p>Spec: Reconcile-Time Determinism &amp; Volatile-Value Handling
     * (2026-06-16) — Task Group 1.</p>
     */
    @Type(JsonType.class)
    @Column(name = "volatile_paths_json", columnDefinition = "jsonb")
    private Map<String, Object> volatilePathsJson;

    /**
     * The pinned ordered HTTP chain (setup &rarr; act &rarr; cleanup) when this
     * baseline item is a STATEFUL SEQUENCE scenario; {@code null} for today's
     * single-shot item (zero regression). Shaped (snake_case wire):
     * <pre>{@code
     * { steps: [ { index, role: 'setup'|'act'|'cleanup', kind: 'http',
     *              request: { method, path, query, headers, body },
     *              expected_status,
     *              response_refs: [ { ref: '$<stepIndex>.<jsonpath>', from_step, json_path } ] } ],
     *   act_step_index, cleanup_best_effort: true }
     * }</pre>
     * Exactly one step has {@code role: 'act'} (pointed to by
     * {@code act_step_index}); 0..N {@code setup} steps precede it and 0..N
     * {@code cleanup} steps follow. {@code kind} is present on every step but
     * only {@code 'http'} is implemented now ({@code 'sql'}/{@code 'e2e'} are
     * reserved future values, not built). Inter-step references resolve a value
     * from an EARLIER step's LIVE response at replay.
     *
     * <p>Written ONCE at create time (write-once, no PATCH path), mirroring the
     * {@code volatile_paths_json} posture — it ANNOTATES the pinned oracle, it
     * is never mutated. No {@code @PrePersist} defaulting; {@code null} is the
     * valid empty state and there is NO backfill of existing rows.</p>
     *
     * <p>{@code sequence_json} participates in the content hash
     * ({@link com.example.architecturemodel.util.BaselineContentHashUtil}) when
     * present (tamper-evidence of the pinned chain), but is OMITTED from the
     * canonical form entirely when {@code null} so every existing baseline +
     * single-shot item hashes BYTE-IDENTICAL to today's v1 form.</p>
     *
     * <p>Spec: Stateful Sequence Scenarios (2026-06-18) — Task Group 1
     * (changeset 192).</p>
     */
    @Type(JsonType.class)
    @Column(name = "sequence_json", columnDefinition = "jsonb")
    private Map<String, Object> sequenceJson;

    @Column(name = "business_notes")
    private String businessNotes;

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
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
