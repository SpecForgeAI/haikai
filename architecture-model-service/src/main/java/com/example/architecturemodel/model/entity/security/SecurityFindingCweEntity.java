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
 * JPA entity for {@code security_finding_cwes} -- the M:N join between a
 * {@link SecurityFindingEntity} and a CWE identifier.
 *
 * <p>Joined by identifier string ({@code cwe_id}, e.g. {@code CWE-89}) against
 * {@code cwes.cwe_id}, mirroring {@link SecurityFindingCveEntity}. Unique per
 * {@code (finding_id, cwe_id)}.</p>
 *
 * <p>Spec: Security health dashboard (2026-07-19, Spec 1 of 3).</p>
 */
@Entity
@Table(
    name = "security_finding_cwes",
    uniqueConstraints = {
        @UniqueConstraint(name = "uq_sec_finding_cwe", columnNames = {"finding_id", "cwe_id"})
    },
    indexes = {
        @Index(name = "idx_sec_finding_cwe_cwe_id", columnList = "cwe_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SecurityFindingCweEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "finding_id", nullable = false)
    private UUID findingId;

    /** The CWE identifier string (join key against {@code cwes.cwe_id}). */
    @Column(name = "cwe_id", nullable = false)
    private String cweId;
}
