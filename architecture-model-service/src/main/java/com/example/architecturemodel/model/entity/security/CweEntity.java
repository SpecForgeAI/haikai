package com.example.architecturemodel.model.entity.security;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA entity for {@code cwes} -- one row per distinct CWE identifier: the
 * WORLD-FACT weakness-taxonomy record under the one-fact-one-home rule.
 *
 * <p>Authority: MITRE (cwe.mitre.org) -- NOT cve.org. The taxonomy is finite
 * (~1000 entries), so changeset {@code 212-cwe-mitre-seed.sql} seeds the full
 * MITRE Research Concepts view (944 rows, retrieved 2026-07-19) up front;
 * ingest creates {@code pending} stubs only for ids outside the seed. This is
 * what makes SAST findings (which carry a CWE but often NO CVE) self-describing
 * on the register from day one.</p>
 *
 * <p>Findings join here M:N by identifier string via
 * {@code security_finding_cwes}. Globally scoped (world facts).</p>
 *
 * <p>Spec: Security health dashboard (2026-07-19, Spec 1 of 3). Snake_case
 * wire (AMS default) -- NO {@code @CamelCaseWire}.</p>
 */
@Entity
@Table(
    name = "cwes",
    uniqueConstraints = {
        @UniqueConstraint(name = "uq_cwes_cwe_id", columnNames = "cwe_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CweEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    /** The CWE identifier, e.g. {@code CWE-89}. Unique natural key. */
    @Column(name = "cwe_id", nullable = false)
    private String cweId;

    /** MITRE weakness name, e.g. "Improper Neutralization of Special Elements...". */
    @Column(name = "name")
    private String name;

    /** MITRE short description (capped at 1000 chars in the seed). */
    @Column(name = "description")
    private String description;

    /** Provenance. v1 values: {@code mitre} (seed) | {@code manual}. */
    @Column(name = "source")
    private String source;

    @Column(name = "fetched_at")
    private Instant fetchedAt;

    /**
     * Enrichment lifecycle. NOT NULL. Seeded rows are {@code enriched};
     * ingest-created stubs for unseen ids are {@code pending}.
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
