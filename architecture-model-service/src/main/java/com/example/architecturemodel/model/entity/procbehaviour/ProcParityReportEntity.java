package com.example.architecturemodel.model.entity.procbehaviour;

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
 * One proc-parity comparator run -- Stored Proc &amp; Function Behaviour
 * Program, Spec 4 (changeset 231, {@code proc_parity_reports}).
 *
 * <p>The DB-native sibling of {@code data_parity_reports}: where that compares
 * TABLE contents, this compares ROUTINE BEHAVIOUR -- per scenario, per
 * dimension (outcome, return status, output params, result sets, messages,
 * state delta, update counts) against the pinned proc behaviour baseline
 * (changeset 230). Three purposes share the table:</p>
 *
 * <ul>
 *   <li>{@code workbench} -- the translation loop's per-attempt reconcile.</li>
 *   <li>{@code execution} -- the migration run's gate check.</li>
 *   <li>{@code manual} -- an operator-triggered run.</li>
 * </ul>
 *
 * <p>The comparator body is stored verbatim in {@link #reportJson}; the
 * summary status / pair / ruleset version are LIFTED onto columns so the
 * latest-per-routine read stays cheap.</p>
 */
@Entity
@Table(
    name = "proc_parity_reports",
    indexes = {
        @Index(
            name = "ix_ppr_arch_routine_created",
            columnList = "architecture_id, routine_id, created_at"
        )
    }
)
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProcParityReportEntity {

    public static final String PURPOSE_WORKBENCH = "workbench";
    public static final String PURPOSE_EXECUTION = "execution";
    public static final String PURPOSE_MANUAL = "manual";

    /** All allowed purposes, mirroring chk_ppr_purpose. */
    public static final Set<String> ALL_PURPOSES = Set.of(
        PURPOSE_WORKBENCH,
        PURPOSE_EXECUTION,
        PURPOSE_MANUAL
    );

    public static final String STATUS_CLEAN = "clean";
    public static final String STATUS_CLEAN_WITH_WAIVERS = "clean_with_waivers";
    public static final String STATUS_DIVERGENT = "divergent";
    public static final String STATUS_UNVERIFIABLE = "unverifiable";

    /** All allowed statuses, mirroring chk_ppr_status. */
    public static final Set<String> ALL_STATUSES = Set.of(
        STATUS_CLEAN,
        STATUS_CLEAN_WITH_WAIVERS,
        STATUS_DIVERGENT,
        STATUS_UNVERIFIABLE
    );

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    /** The pack the workbench run belongs to; null for execution / manual runs. */
    @Column(name = "pack_id")
    private UUID packId;

    @Column(name = "routine_id", nullable = false)
    private UUID routineId;

    /** The pinned proc behaviour baseline the run replayed. */
    @Column(name = "baseline_id")
    private UUID baselineId;

    /** The workbench attempt this report backs; null outside the loop. */
    @Column(name = "translation_attempt_id")
    private UUID translationAttemptId;

    /** One of {@link #ALL_PURPOSES}; chk_ppr_purpose is the source of truth. */
    @Column(name = "purpose", nullable = false, length = 16)
    @Builder.Default
    private String purpose = PURPOSE_WORKBENCH;

    /** One of {@link #ALL_STATUSES}; chk_ppr_status is the source of truth. */
    @Column(name = "status", nullable = false, length = 32)
    @Builder.Default
    private String status = STATUS_UNVERIFIABLE;

    /** The migration pair the ruleset was resolved for (e.g. sybase15 -&gt; postgres18). */
    @Column(name = "migration_pair", length = 64)
    private String migrationPair;

    @Column(name = "ruleset_version")
    private Integer rulesetVersion;

    /** The comparator's summary block (counts, status, failure signatures). */
    @Type(JsonType.class)
    @Column(name = "summary_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> summaryJson = Map.of();

    /** The comparator's full snake_case report body, verbatim (per-scenario results). */
    @Type(JsonType.class)
    @Column(name = "report_json", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> reportJson = Map.of();

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
        if (purpose == null) {
            purpose = PURPOSE_WORKBENCH;
        }
        if (status == null) {
            status = STATUS_UNVERIFIABLE;
        }
        if (summaryJson == null) {
            summaryJson = Map.of();
        }
        if (reportJson == null) {
            reportJson = Map.of();
        }
    }
}
