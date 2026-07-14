package com.example.architecturemodel.model.entity;

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
 * One data-parity run's persisted report — Spec P of the Data-Tier Oracle
 * Program (changeset 210, {@code data_parity_reports}).
 *
 * <p>The AMVS comparator posts the full per-table verdict report; the
 * migrate gate reads the LATEST row per (project, architecture) FAIL-CLOSED
 * — no report means {@code data_parity_unverified} blocks execution.</p>
 */
@Entity
@Table(name = "data_parity_reports")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DataParityReportEntity {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** clean | divergent | unverifiable | empty (the comparator's summary status). */
    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "migration_pair")
    private String migrationPair;

    @Column(name = "ruleset_version")
    private Integer rulesetVersion;

    /** The comparator's full snake_case report body, verbatim. */
    @Type(JsonType.class)
    @Column(name = "report_json", columnDefinition = "jsonb", nullable = false)
    private Map<String, Object> reportJson;

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
