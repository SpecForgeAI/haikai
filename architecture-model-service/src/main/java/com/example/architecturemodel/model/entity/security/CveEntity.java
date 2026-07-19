package com.example.architecturemodel.model.entity.security;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Type;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * JPA entity for {@code cves} -- one row per distinct CVE identifier: the
 * WORLD-FACT record under the one-fact-one-home rule.
 *
 * <p>Authority: cve.org / NVD / OSV. Uploaded files NEVER write these columns --
 * ingest only upserts a stub ({@code enrichment_status='pending'}) for each
 * distinct CVE id seen; the gateway OSV bridge fills the record asynchronously
 * via the enrichment endpoint ({@code enriched} / {@code not_found}). Every
 * read surface degrades gracefully to stubs: nothing blocks on enrichment.</p>
 *
 * <p>Findings join here M:N BY IDENTIFIER STRING via
 * {@code security_finding_cves} -- a join row is valid before this record
 * exists, and the same CVE is shared across findings, reports and projects
 * (this table is deliberately UNSCOPED: world facts are global).</p>
 *
 * <p>Spec: Security health dashboard (2026-07-19, Spec 1 of 3). Snake_case
 * wire (AMS default) -- NO {@code @CamelCaseWire}.</p>
 */
@Entity
@Table(
    name = "cves",
    uniqueConstraints = {
        @UniqueConstraint(name = "uq_cves_cve_id", columnNames = "cve_id")
    },
    indexes = {
        @Index(name = "idx_cves_enrichment_status", columnList = "enrichment_status")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CveEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    /** The CVE identifier, e.g. {@code CVE-2024-38808}. Unique natural key. */
    @Column(name = "cve_id", nullable = false)
    private String cveId;

    @Column(name = "summary")
    private String summary;

    @Column(name = "description")
    private String description;

    /** Official CVSS vector, e.g. {@code CVSS:3.1/AV:N/AC:L/...}. */
    @Column(name = "cvss_vector")
    private String cvssVector;

    @Column(name = "cvss_score", precision = 4, scale = 1)
    private BigDecimal cvssScore;

    /**
     * Severity derived from the official score ({@code info..critical} ladder)
     * -- deliberately separate from the finding's severity-as-reported so both
     * lenses coexist.
     */
    @Column(name = "severity_official")
    private String severityOfficial;

    /** Official CWE links (e.g. {@code ["CWE-770"]}), jsonb string-array. */
    @Type(JsonType.class)
    @Column(name = "cwe_ids", columnDefinition = "jsonb")
    @Builder.Default
    private List<String> cweIds = new ArrayList<>();

    /** Alias identifiers naming the same vulnerability (GHSA / OSV ids), jsonb. */
    @Type(JsonType.class)
    @Column(name = "aliases", columnDefinition = "jsonb")
    @Builder.Default
    private List<String> aliases = new ArrayList<>();

    /** Reference URLs, jsonb string-array. */
    @Type(JsonType.class)
    @Column(name = "reference_urls", columnDefinition = "jsonb")
    @Builder.Default
    private List<String> referenceUrls = new ArrayList<>();

    @Column(name = "published_at")
    private Instant publishedAt;

    @Column(name = "modified_at")
    private Instant modifiedAt;

    /** CISA Known-Exploited-Vulnerabilities listing flag. Boxed, nullable = unknown. */
    @Column(name = "kev_listed")
    private Boolean kevListed;

    /** EPSS exploit-prediction score (0..1). Boxed, nullable = unknown. */
    @Column(name = "epss_score", precision = 6, scale = 5)
    private BigDecimal epssScore;

    /** Enrichment provenance. v1 values: {@code osv} | {@code nvd} | {@code manual}. */
    @Column(name = "source")
    private String source;

    @Column(name = "fetched_at")
    private Instant fetchedAt;

    /**
     * Enrichment lifecycle. NOT NULL. v1 values: {@code pending} (stub created
     * at ingest) | {@code enriched} | {@code not_found}. String-typed, no enum.
     */
    @Column(name = "enrichment_status", nullable = false)
    @Builder.Default
    private String enrichmentStatus = "pending";

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (enrichmentStatus == null) {
            enrichmentStatus = "pending";
        }
    }
}
