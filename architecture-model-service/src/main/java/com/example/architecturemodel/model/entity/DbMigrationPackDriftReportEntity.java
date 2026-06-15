package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for one schema verification (drift) run against the target
 * Postgres database (Liquibase changeset 175). APPEND-ONLY history: rows are
 * never updated or overwritten (audit trail, settled Q6); per-area
 * re-verifications append additional rows scoped by {@link #scanScopeJson}.
 *
 * <p>The DB sibling of the API drift report. Summary counts are boxed
 * {@link Integer} per {@code project_primitive_double_dto_overwrite.md}.
 * {@link #source} is free text ({@code in_tool} now) so a future external
 * implementation+verification service callback can append per-area runs
 * without schema change (integration itself out of scope).</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 */
@Entity
@Table(
    name = "db_migration_pack_drift_reports",
    indexes = {
        @Index(name = "idx_dmpdr_pack_created", columnList = "pack_id, created_at", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DbMigrationPackDriftReportEntity {

    /** Default producer tag for verify runs from inside the tool. */
    public static final String SOURCE_IN_TOOL = "in_tool";

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "pack_id", nullable = false)
    private UUID packId;

    /** The area filter for the run (schemas/tables); null = full scope. */
    @Type(JsonType.class)
    @Column(name = "scan_scope_json", columnDefinition = "jsonb")
    private Map<String, Object> scanScopeJson;

    /** Objects classified {@code match}. Boxed Integer -- PATCH-safe. */
    @Column(name = "match_count")
    private Integer matchCount;

    /** Objects classified {@code missing} (expected, absent in target). Boxed. */
    @Column(name = "missing_count")
    private Integer missingCount;

    /** Objects classified {@code mismatch} (present but differing). Boxed. */
    @Column(name = "mismatch_count")
    private Integer mismatchCount;

    /**
     * The full per-object classification report including mismatch property
     * detail and the informational {@code unexpected_in_target} section.
     */
    @Type(JsonType.class)
    @Column(name = "report_json", columnDefinition = "jsonb")
    private Map<String, Object> reportJson;

    /** Free-text producer tag; {@code in_tool} for gateway verify runs. */
    @Column(name = "source", columnDefinition = "TEXT")
    private String source;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (source == null) {
            source = SOURCE_IN_TOOL;
        }
    }
}
