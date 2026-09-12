package com.example.architecturemodel.model.entity.procbehaviour;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * One replayable expectation -- Stored Proc &amp; Function Behaviour Program,
 * Spec 3 (changeset 230, {@code proc_behaviour_baseline_items}).
 *
 * <p>Inputs (or a sequence) in, expected envelope + state delta out, carried
 * with the {@code routineBodyHash} that produced them. When the routine body
 * later changes, {@code ProcBehaviourService#markItemsStale} flips
 * {@code stale} with {@code stale_reason = body_changed} -- the expectation is
 * kept and shown with a badge rather than silently deleted, because a stale
 * expectation is evidence, not noise.</p>
 *
 * <p>Snake_case wire by the AMS default.</p>
 */
@Entity
@Table(name = "proc_behaviour_baseline_items")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProcBehaviourBaselineItemEntity {

    public static final String STALE_REASON_BODY_CHANGED = "body_changed";

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "baseline_id", nullable = false)
    private UUID baselineId;

    @Column(name = "routine_id", nullable = false)
    private UUID routineId;

    /** {@code db_routines.body_hash} at the moment the expectation was captured. */
    @Column(name = "routine_body_hash", length = 80)
    private String routineBodyHash;

    /** The capture-session scenario the item was saved from (null for imports). */
    @Column(name = "scenario_id")
    private UUID scenarioId;

    @Column(name = "scenario_name", nullable = false, length = 255)
    private String scenarioName;

    @Column(name = "scenario_type", nullable = false, length = 32)
    private String scenarioType;

    /** success | return:&lt;n&gt; | error:&lt;n&gt;. */
    @Column(name = "exit_outcome", length = 64)
    private String exitOutcome;

    @Type(JsonType.class)
    @Column(name = "inputs_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<Map<String, Object>> inputsJson = new ArrayList<>();

    @Type(JsonType.class)
    @Column(name = "sequence_json", columnDefinition = "jsonb")
    private List<Map<String, Object>> sequenceJson;

    @Type(JsonType.class)
    @Column(name = "expected_envelope_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> expectedEnvelopeJson = new LinkedHashMap<>();

    @Type(JsonType.class)
    @Column(name = "state_delta_json", columnDefinition = "jsonb")
    private Map<String, Object> stateDeltaJson;

    @Type(JsonType.class)
    @Column(name = "volatile_cells_json", columnDefinition = "jsonb")
    private List<Map<String, Object>> volatileCellsJson;

    @Column(name = "business_notes", columnDefinition = "TEXT")
    private String businessNotes;

    @Column(name = "stale", nullable = false)
    @Builder.Default
    private boolean stale = false;

    /** body_changed (the only reason today). */
    @Column(name = "stale_reason", length = 64)
    private String staleReason;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
