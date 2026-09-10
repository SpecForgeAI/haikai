package com.example.architecturemodel.model.entity;

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
import java.util.Set;
import java.util.UUID;

/**
 * One build of the TARGET database a pack's translation workbench applies
 * drafts against -- Stored Proc &amp; Function Behaviour Program, Spec 4
 * (changeset 231, {@code db_migration_pack_target_builds}).
 *
 * <p>The gateway chains schema-apply (structural) -&gt; data-migration -&gt;
 * schema-apply (post-load) and records progress per phase in
 * {@link #phasesJson} ({@code {schema, data, translations: {status,
 * started_at, ended_at, error}}}). {@code rebuild} = Liquibase drop-all first.
 * {@link #s0FingerprintJson} stamps the loaded S0 so a workbench reconcile can
 * prove it ran against the same state the baseline was captured at.</p>
 *
 * <p>Snake_case wire by the AMS default -- the entity is returned verbatim.
 * {@link #targetBindingJson} carries the REDACTED binding only (never
 * credentials -- those are per-invocation on the gateway side).</p>
 */
@Entity
@Table(
    name = "db_migration_pack_target_builds",
    indexes = {
        @Index(name = "ix_dmptb_pack_started", columnList = "pack_id, started_at")
    }
)
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DbMigrationPackTargetBuildEntity {

    public static final String STATUS_RUNNING = "running";
    public static final String STATUS_SUCCEEDED = "succeeded";
    public static final String STATUS_FAILED = "failed";

    /** All allowed statuses, mirroring chk_dmptb_status. */
    public static final Set<String> ALL_STATUSES = Set.of(
        STATUS_RUNNING,
        STATUS_SUCCEEDED,
        STATUS_FAILED
    );

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "pack_id", nullable = false)
    private UUID packId;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    /** The REDACTED target binding (host / database / schema -- never secrets). */
    @Type(JsonType.class)
    @Column(name = "target_binding_json", columnDefinition = "jsonb")
    private Map<String, Object> targetBindingJson;

    /** One of {@link #ALL_STATUSES}; chk_dmptb_status is the source of truth. */
    @Column(name = "status", nullable = false, length = 16)
    @Builder.Default
    private String status = STATUS_RUNNING;

    /** Per-phase progress: {@code {schema, data, translations}}. */
    @Type(JsonType.class)
    @Column(name = "phases_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> phasesJson = Map.of();

    /** The S0 fingerprint of the loaded target (the reconcile's pin). */
    @Type(JsonType.class)
    @Column(name = "s0_fingerprint_json", columnDefinition = "jsonb")
    private Map<String, Object> s0FingerprintJson;

    @Column(name = "pack_version", length = 64)
    private String packVersion;

    /** Liquibase drop-all before the structural apply. */
    @Column(name = "rebuild", nullable = false)
    @Builder.Default
    private Boolean rebuild = Boolean.FALSE;

    @Column(name = "error", columnDefinition = "TEXT")
    private String error;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(name = "ended_at")
    private Instant endedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        if (startedAt == null) {
            startedAt = now;
        }
        if (status == null) {
            status = STATUS_RUNNING;
        }
        if (phasesJson == null) {
            phasesJson = Map.of();
        }
        if (rebuild == null) {
            rebuild = Boolean.FALSE;
        }
    }
}
