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
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * One intended routine call -- Stored Proc &amp; Function Behaviour Program,
 * Spec 3 (changeset 230, {@code proc_behaviour_scenarios}).
 *
 * <p>Recorded BEFORE the fire (record-then-fire, as the API scenario loop
 * does): deterministic {@code db_seed} rows from the profiler plus the LLM's
 * generated / refined ones. Unique per (session, routine, scenario_name) so a
 * retry re-uses the row rather than duplicating it.</p>
 *
 * <p>{@code sequenceJson} carries {@code steps[] {routine_id, inputs_json}}
 * for multi-call scenarios; the whole sequence fires inside ONE compensation
 * bracket. Snake_case wire by the AMS default.</p>
 */
@Entity
@Table(name = "proc_behaviour_scenarios")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProcBehaviourScenarioEntity {

    public static final String STATUS_PROPOSED = "proposed";
    public static final String STATUS_FIRED = "fired";
    public static final String STATUS_EXCLUDED = "excluded";

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    /** {@code db_routines.id} the scenario targets. */
    @Column(name = "routine_id", nullable = false)
    private UUID routineId;

    @Column(name = "scenario_name", nullable = false, length = 255)
    private String scenarioName;

    /**
     * happy_path | error_path | zero_rows | boundary | null_param |
     * default_param | business_edge | sequence.
     */
    @Column(name = "scenario_type", nullable = false, length = 32)
    private String scenarioType;

    /** db_seed | llm_generated | llm_refined. */
    @Column(name = "generation_source", nullable = false, length = 32)
    private String generationSource;

    /** [{name, value, is_null}] -- the parameter binding for the call. */
    @Type(JsonType.class)
    @Column(name = "inputs_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<Map<String, Object>> inputsJson = new ArrayList<>();

    /** {steps: [{routine_id, inputs_json}]} for sequence scenarios, else null. */
    @Type(JsonType.class)
    @Column(name = "sequence_json", columnDefinition = "jsonb")
    private List<Map<String, Object>> sequenceJson;

    /** proposed | fired | excluded. */
    @Column(name = "status", nullable = false, length = 16)
    @Builder.Default
    private String status = STATUS_PROPOSED;

    @Column(name = "exclusion_reason", columnDefinition = "TEXT")
    private String exclusionReason;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;

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
