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
import java.util.UUID;

/**
 * JPA entity for {@code security_findings} -- one row per scanner-asserted
 * finding in the department-level security health store.
 *
 * <p><b>One-fact-one-home:</b> every column here is the REPORTED copy -- what
 * the uploaded file (GitLab vulnerability export in v1) asserted, verbatim.
 * World facts (official CVE summary / CVSS / severity, CWE names) live on
 * {@link CveEntity} / {@link CweEntity} and are NEVER written into this row;
 * divergence between reported and official values is signal, not noise.</p>
 *
 * <p>CVE / CWE links are M:N via {@link SecurityFindingCveEntity} /
 * {@link SecurityFindingCweEntity} (joined BY IDENTIFIER STRING, not FK
 * columns here -- a multi-CVE file needs no schema change).</p>
 *
 * <p><b>Attribution</b> ({@link #level}, {@link #applicationId},
 * {@link #matchStatus}) is resolved by the upload wizard's value matcher
 * (exact match -&gt; alias -&gt; manual pick); unmatched rows are KEPT and feed
 * the "Not matched" pseudo-box on the Security Overview diagram.</p>
 *
 * <p>Deliberately ABSENT (user-scoped v1 subset): Tool / Scanner Name /
 * Group Name / Activity / Comments / Dismissal Reason / Tracked Context Name
 * and raw_row. Spec: Security health dashboard (2026-07-19, Spec 1 of 3).
 * Snake_case wire (AMS default) -- NO {@code @CamelCaseWire}.</p>
 */
@Entity
@Table(
    name = "security_findings",
    indexes = {
        @Index(name = "idx_sec_finding_project_id", columnList = "project_id"),
        @Index(name = "idx_sec_finding_architecture_id", columnList = "architecture_id"),
        @Index(name = "idx_sec_finding_report_id", columnList = "report_id"),
        @Index(name = "idx_sec_finding_application_id", columnList = "application_id"),
        @Index(name = "idx_sec_finding_severity", columnList = "severity"),
        @Index(name = "idx_sec_finding_match_status", columnList = "match_status"),
        @Index(name = "idx_sec_finding_source_finding",
            columnList = "report_id, source_finding_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SecurityFindingEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    /** FK-ish ref to the owning {@code security_finding_reports} row. */
    @Column(name = "report_id", nullable = false)
    private UUID reportId;

    @Column(name = "ingested_at", nullable = false, updatable = false)
    private Instant ingestedAt;

    // ------------------------------------------------------------------
    // Attribution (wizard value-matcher output)
    // ------------------------------------------------------------------

    /**
     * The RAW linking-column value from the file (e.g. GitLab "Project Name"),
     * preserved verbatim even when resolved -- the alias trail stays auditable.
     */
    @Column(name = "linking_value", nullable = false)
    private String linkingValue;

    /** Attribution level. v1: {@code application}. String-typed, no enum. */
    @Column(name = "level", nullable = false)
    private String level;

    /**
     * Resolved {@code applications.id} (String id family, matching
     * {@code ApplicationEntity}) when matched; null when
     * {@code match_status='unmatched'}. The application NAME is resolved on
     * read (never denormalized here) so model renames don't drift.
     */
    @Column(name = "application_id")
    private String applicationId;

    /**
     * Resolution outcome. v1 values: {@code auto} (exact/alias match),
     * {@code manual} (user-picked in the wizard), {@code unmatched} (kept --
     * the Not-matched bucket). String-typed, no enum.
     */
    @Column(name = "match_status", nullable = false)
    private String matchStatus;

    // ------------------------------------------------------------------
    // Reported columns (the scanner's asserted copy, verbatim)
    // ------------------------------------------------------------------

    /**
     * Severity normalized to the {@code info..critical} ladder (same ladder as
     * {@code vulnerabilities.severity}); the raw string is preserved in
     * {@link #severityRaw}. This is severity-as-REPORTED -- the official
     * CVE-derived severity lives on {@link CveEntity#getSeverityOfficial()}.
     */
    @Column(name = "severity", nullable = false)
    private String severity;

    @Column(name = "severity_raw")
    private String severityRaw;

    /** GitLab "Vulnerability" column -- the finding title as reported. */
    @Column(name = "title")
    private String title;

    /** GitLab "Details" column. */
    @Column(name = "description")
    private String description;

    /** GitLab "Detected At". */
    @Column(name = "detected_at")
    private Instant detectedAt;

    /**
     * GitLab "Location" -- the file/module coordinate the finding was reported
     * against, normalized from the Ruby-hash export format at the gateway.
     */
    @Column(name = "location")
    private String location;

    /** GitLab "Full Path" -- the scanner-side project path + finding id. */
    @Column(name = "source_path")
    private String sourcePath;

    /** GitLab "CVSS Vectors" as reported (e.g. {@code NVD=CVSS:3.1/...}). */
    @Column(name = "cvss_vector_reported")
    private String cvssVectorReported;

    /** GitLab "Vulnerability ID" -- the scanner's stable per-row id. */
    @Column(name = "source_finding_id")
    private String sourceFindingId;

    /**
     * GitLab "Other Identifiers" (GHSA / Gemnasium / OWASP ids), jsonb
     * string-array. Empty-array default so reads are total.
     */
    @Type(JsonType.class)
    @Column(name = "other_identifiers", columnDefinition = "jsonb")
    @Builder.Default
    private List<String> otherIdentifiers = new ArrayList<>();

    @PrePersist
    protected void onCreate() {
        if (ingestedAt == null) {
            ingestedAt = Instant.now();
        }
    }
}
