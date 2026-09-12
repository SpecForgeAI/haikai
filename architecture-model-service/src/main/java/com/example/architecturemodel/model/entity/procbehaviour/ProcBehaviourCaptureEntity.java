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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * One fired attempt -- Stored Proc &amp; Function Behaviour Program, Spec 3
 * (changeset 230, {@code proc_behaviour_captures}).
 *
 * <p>{@code envelopeJson} is the routine call envelope verbatim (result sets,
 * OUT params, return value, messages, error); {@code stateDeltaJson} is the
 * computed before/after difference over the write closure;
 * {@code volatileCellsJson} is the double-fire evidence for routines with
 * volatile functions. {@code bracketOutcome} narrates the derived compensation
 * bracket (clean | compensated | healed | residue) -- a capture is only
 * baseline-eligible when the bracket came back clean or compensated.</p>
 *
 * <p>Snake_case wire by the AMS default.</p>
 */
@Entity
@Table(name = "proc_behaviour_captures")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProcBehaviourCaptureEntity {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    @Column(name = "scenario_id", nullable = false)
    private UUID scenarioId;

    @Column(name = "routine_id", nullable = false)
    private UUID routineId;

    @Column(name = "attempt_number", nullable = false)
    @Builder.Default
    private Integer attemptNumber = 1;

    /** The routine call envelope, verbatim. */
    @Type(JsonType.class)
    @Column(name = "envelope_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> envelopeJson = new LinkedHashMap<>();

    @Type(JsonType.class)
    @Column(name = "state_delta_json", columnDefinition = "jsonb")
    private Map<String, Object> stateDeltaJson;

    /** Cells that differed between the two fires of the same scenario. */
    @Type(JsonType.class)
    @Column(name = "volatile_cells_json", columnDefinition = "jsonb")
    private List<Map<String, Object>> volatileCellsJson;

    /** clean | compensated | healed | residue (derived compensation bracket). */
    @Column(name = "bracket_outcome", length = 32)
    private String bracketOutcome;

    @Column(name = "duration_ms")
    private Long durationMs;

    @Column(name = "error_type", length = 64)
    private String errorType;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    /** True once the capture is the canonical one for its scenario. */
    @Column(name = "accepted", nullable = false)
    @Builder.Default
    private boolean accepted = false;

    @Column(name = "captured_at", nullable = false)
    private Instant capturedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        Instant now = Instant.now();
        if (capturedAt == null) {
            capturedAt = now;
        }
        if (createdAt == null) {
            createdAt = now;
        }
    }
}
