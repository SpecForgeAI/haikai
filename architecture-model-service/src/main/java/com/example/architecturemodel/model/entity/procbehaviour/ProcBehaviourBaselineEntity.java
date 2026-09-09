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
import java.util.UUID;

/**
 * A pinned proc behaviour baseline -- Stored Proc &amp; Function Behaviour
 * Program, Spec 3 (changeset 230, {@code proc_behaviour_baselines}).
 *
 * <p>ONE pinned baseline per (architecture, kind): pinning through
 * {@code ProcBehaviourService#pin} supersedes whatever was pinned for that
 * kind, and leaves the OTHER kind alone. {@code contentHash} is a SHA-256 over
 * the sorted {@code routine_id|scenario_name|expected_envelope_json} strings of
 * the items, so two save-as-baseline calls over the same expectations produce
 * the same hash regardless of item order.</p>
 *
 * <p>Snake_case wire by the AMS default.</p>
 */
@Entity
@Table(name = "proc_behaviour_baselines")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProcBehaviourBaselineEntity {

    public static final String STATUS_DRAFT = "draft";
    public static final String STATUS_PINNED = "pinned";
    public static final String STATUS_SUPERSEDED = "superseded";

    @Id
    @Column(name = "id")
    private UUID id;

    /** The capture session the baseline was saved from (null for imports). */
    @Column(name = "session_id")
    private UUID sessionId;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    @Column(name = "name", nullable = false, length = 255)
    private String name;

    /** draft | pinned | superseded. */
    @Column(name = "status", nullable = false, length = 16)
    @Builder.Default
    private String status = STATUS_DRAFT;

    /** current | target. */
    @Column(name = "kind", nullable = false, length = 16)
    @Builder.Default
    private String kind = ProcBehaviourCaptureSessionEntity.KIND_CURRENT;

    @Type(JsonType.class)
    @Column(name = "s0_fingerprint_json", columnDefinition = "jsonb")
    private Map<String, Object> s0FingerprintJson;

    /** SHA-256 over the sorted item identity strings (see the class javadoc). */
    @Column(name = "content_hash", length = 80)
    private String contentHash;

    @Column(name = "routine_count", nullable = false)
    @Builder.Default
    private Integer routineCount = 0;

    @Column(name = "scenario_count", nullable = false)
    @Builder.Default
    private Integer scenarioCount = 0;

    @Column(name = "pinned_at")
    private Instant pinnedAt;

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
