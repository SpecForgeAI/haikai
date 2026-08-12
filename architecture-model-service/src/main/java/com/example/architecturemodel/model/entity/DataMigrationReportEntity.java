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
 * One data-migration (bulk load) run's persisted report — the parity-report
 * sibling (changeset 222, {@code data_migration_reports}).
 *
 * <p>The AMVS runner posts the full per-table load report; an incomplete
 * load is then diagnosable from the VERBATIM per-table failure reason
 * (driver/Postgres error text) instead of being inferred from row counts.
 * The read is the LATEST row per (project, architecture).</p>
 */
@Entity
@Table(name = "data_migration_reports")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DataMigrationReportEntity {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** clean | divergent | unverifiable | empty (the runner's summary status). */
    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "migration_pair")
    private String migrationPair;

    @Column(name = "ruleset_version")
    private Integer rulesetVersion;

    @Column(name = "tables_total")
    private Integer tablesTotal;

    @Column(name = "tables_loaded")
    private Integer tablesLoaded;

    @Column(name = "tables_mismatched")
    private Integer tablesMismatched;

    @Column(name = "tables_unverifiable")
    private Integer tablesUnverifiable;

    @Column(name = "rows_loaded")
    private Long rowsLoaded;

    /** The runner's full snake_case report body, verbatim. */
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
