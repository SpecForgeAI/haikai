package com.example.architecturemodel.model.entity.security;

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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * JPA entity for {@code security_finding_reports} -- one row per
 * security-findings upload in the department-level security health store.
 *
 * <p>A multi-file upload is appended into ONE report (each file parsed
 * independently at the gateway; normalized rows appended). Snapshot-list
 * lifecycle: every upload inserts a new {@link #isLatest}{@code =true} row and
 * demotes the prior latest for the same {@code (project_id, architecture_id)};
 * history is RETAINED (no deletes) so trend-over-time reads stay possible.</p>
 *
 * <p>The report carries the per-upload wizard answers: {@link #associationLevel}
 * (which hierarchy level the file's linking column binds to -- {@code application}
 * in v1) and the user-confirmed {@link #columnMapping} (file column -&gt; generic
 * attribute; the audit trail of how the file was interpreted AND the prefill
 * source for the next upload's column matcher).</p>
 *
 * <p>Distinct from and untouching the migration-workflow
 * {@code vulnerability_reports} store. String-typed enumish fields ({@code source},
 * {@code association_level}) per the discovery-family convention -- documented
 * values live in the changeset {@code COMMENT ON COLUMN} blocks
 * ({@code 211-security-health-foundation.sql}).</p>
 *
 * <p>Spec: Security health dashboard (2026-07-19, Spec 1 of 3). Snake_case wire
 * (AMS default) -- NO {@code @CamelCaseWire}.</p>
 */
@Entity
@Table(
    name = "security_finding_reports",
    indexes = {
        @Index(name = "idx_sec_finding_report_project_id", columnList = "project_id"),
        @Index(name = "idx_sec_finding_report_architecture_id", columnList = "architecture_id"),
        @Index(name = "idx_sec_finding_report_is_latest", columnList = "is_latest")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SecurityFindingReportEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    /** Producer label. v1 value: {@code gitlab_export}. String-typed, no enum. */
    @Column(name = "source", nullable = false)
    private String source;

    /**
     * The hierarchy level the file's linking column binds findings to.
     * v1 value: {@code application} ({@code service} / {@code application_component}
     * reserved for later specs). String-typed, no enum.
     */
    @Column(name = "association_level", nullable = false)
    private String associationLevel;

    /**
     * Names of ALL files appended into this report (multi-file upload), jsonb
     * string-array. Empty-array default so reads are total.
     */
    @Type(JsonType.class)
    @Column(name = "original_filenames", columnDefinition = "jsonb")
    @Builder.Default
    private List<String> originalFilenames = new ArrayList<>();

    /**
     * The user-confirmed column mapping (file column header -&gt; generic
     * attribute name), jsonb object. Audit trail + next-upload prefill.
     */
    @Type(JsonType.class)
    @Column(name = "column_mapping", columnDefinition = "jsonb")
    private Map<String, String> columnMapping;

    @Column(name = "uploaded_at", nullable = false, updatable = false)
    private Instant uploadedAt;

    /**
     * Snapshot-list lifecycle flag: exactly one report per
     * {@code (project_id, architecture_id)} carries {@code true} at a time;
     * a new upload demotes the prior latest. Never deleted.
     */
    @Column(name = "is_latest", nullable = false)
    @Builder.Default
    private Boolean isLatest = Boolean.TRUE;

    /** Count of {@code security_findings} rows persisted from this upload. Boxed. */
    @Column(name = "row_count_ingested")
    private Integer rowCountIngested;

    /** Count of rows dropped (unparseable / literal duplicates). Boxed; summarized in {@link #notes}. */
    @Column(name = "row_count_dropped")
    private Integer rowCountDropped;

    /** Free-text no-silent-drop summary + ingest notes. Nullable. */
    @Column(name = "notes")
    private String notes;

    @PrePersist
    protected void onCreate() {
        if (uploadedAt == null) {
            uploadedAt = Instant.now();
        }
    }
}
