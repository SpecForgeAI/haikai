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
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Loud narration of a routine or scenario that did NOT make the baseline --
 * Stored Proc &amp; Function Behaviour Program, Spec 3 (changeset 230,
 * {@code proc_behaviour_diagnostics}).
 *
 * <p>Every skip, refusal, residue and unmet floor lands here. Silence is never
 * an outcome: a routine either has scenarios with envelopes meeting the floor,
 * or a diagnostic naming why not.</p>
 *
 * <p>Snake_case wire by the AMS default.</p>
 */
@Entity
@Table(name = "proc_behaviour_diagnostics")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProcBehaviourDiagnosticEntity {

    /** The chk_pbd_type allowlist, mirrored for validation before the insert. */
    public static final Set<String> TYPES = Set.of(
        "routine_skipped",
        "non_compensatable",
        "bracket_residue",
        "coverage_floor_unmet",
        "excluded_by_user",
        "not_possible",
        "captured_as_error",
        "result_set_truncated",
        "login_dependent");

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    /** Null for session-level diagnostics (e.g. a scope that resolved empty). */
    @Column(name = "routine_id")
    private UUID routineId;

    @Column(name = "diagnostic_type", nullable = false, length = 48)
    private String diagnosticType;

    @Column(name = "message", columnDefinition = "TEXT")
    private String message;

    @Type(JsonType.class)
    @Column(name = "detail_json", columnDefinition = "jsonb")
    private Map<String, Object> detailJson;

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
