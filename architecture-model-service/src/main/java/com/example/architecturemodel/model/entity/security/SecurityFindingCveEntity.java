package com.example.architecturemodel.model.entity.security;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.UUID;

/**
 * JPA entity for {@code security_finding_cves} -- the M:N join between a
 * {@link SecurityFindingEntity} and a CVE identifier.
 *
 * <p>Joined BY IDENTIFIER STRING ({@code cve_id}, e.g. {@code CVE-2024-38808}),
 * NOT by {@code cves.id} -- the join row is valid before the {@link CveEntity}
 * stub exists, and multi-CVE file cells need no schema change (one join row per
 * CVE). Unique per {@code (finding_id, cve_id)}.</p>
 *
 * <p>Spec: Security health dashboard (2026-07-19, Spec 1 of 3).</p>
 */
@Entity
@Table(
    name = "security_finding_cves",
    uniqueConstraints = {
        @UniqueConstraint(name = "uq_sec_finding_cve", columnNames = {"finding_id", "cve_id"})
    },
    indexes = {
        @Index(name = "idx_sec_finding_cve_cve_id", columnList = "cve_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SecurityFindingCveEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "finding_id", nullable = false)
    private UUID findingId;

    /** The CVE identifier string (join key against {@code cves.cve_id}). */
    @Column(name = "cve_id", nullable = false)
    private String cveId;
}
