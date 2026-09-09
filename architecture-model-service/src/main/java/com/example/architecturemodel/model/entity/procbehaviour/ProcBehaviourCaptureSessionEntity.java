package com.example.architecturemodel.model.entity.procbehaviour;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * One proc behaviour capture run -- Stored Proc &amp; Function Behaviour
 * Program, Spec 3 (changeset 230, {@code proc_behaviour_capture_sessions}).
 *
 * <p>DB-native sibling of the API capture session: a scope of routines, the
 * redacted DB config, the session profile the adapter fires with, tuning, the
 * coverage roll-up and the S0 fingerprint the run was pinned against. No base
 * URL and no API auth -- this kind never talks HTTP.</p>
 *
 * <p>Status walks the state machine enforced by
 * {@code ProcBehaviourService#patchSession}: draft -&gt; configured -&gt;
 * running -&gt; (completed | completed_with_findings | failed | cancelled),
 * with configured -&gt; draft allowed for re-scoping.</p>
 *
 * <p>Snake_case wire by the AMS default -- Jackson renders
 * {@code scopeRoutineIdsJson} as {@code scope_routine_ids_json}.</p>
 */
@Entity
@Table(name = "proc_behaviour_capture_sessions")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProcBehaviourCaptureSessionEntity {

    public static final String STATUS_DRAFT = "draft";
    public static final String STATUS_CONFIGURED = "configured";
    public static final String STATUS_RUNNING = "running";
    public static final String STATUS_COMPLETED = "completed";
    public static final String STATUS_COMPLETED_WITH_FINDINGS = "completed_with_findings";
    public static final String STATUS_FAILED = "failed";
    public static final String STATUS_CANCELLED = "cancelled";

    public static final String KIND_CURRENT = "current";
    public static final String KIND_TARGET = "target";

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    @Column(name = "name", nullable = false, length = 255)
    private String name;

    /** draft | configured | running | completed | completed_with_findings | failed | cancelled. */
    @Column(name = "status", nullable = false, length = 32)
    @Builder.Default
    private String status = STATUS_DRAFT;

    /** current | target. */
    @Column(name = "kind", nullable = false, length = 16)
    @Builder.Default
    private String kind = KIND_CURRENT;

    /** The in-scope {@code db_routines.id} values, as uuid strings. */
    @Type(JsonType.class)
    @Column(name = "scope_routine_ids_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private List<String> scopeRoutineIdsJson = new ArrayList<>();

    /** DB connection block with every secret already redacted. */
    @Type(JsonType.class)
    @Column(name = "db_config_redacted_json", columnDefinition = "jsonb")
    private Map<String, Object> dbConfigRedactedJson;

    /** SET options / isolation the adapter applies before every call. */
    @Type(JsonType.class)
    @Column(name = "session_profile_json", columnDefinition = "jsonb")
    private Map<String, Object> sessionProfileJson;

    /** Attempts per routine, result-set caps, budgets. */
    @Type(JsonType.class)
    @Column(name = "capture_tuning_json", columnDefinition = "jsonb")
    private Map<String, Object> captureTuningJson;

    /** Routine coverage floor roll-up written at the end of the job. */
    @Type(JsonType.class)
    @Column(name = "coverage_summary_json", columnDefinition = "jsonb")
    private Map<String, Object> coverageSummaryJson;

    /** The S0 snapshot fingerprint this run was pinned against. */
    @Type(JsonType.class)
    @Column(name = "s0_fingerprint_json", columnDefinition = "jsonb")
    private Map<String, Object> s0FingerprintJson;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
