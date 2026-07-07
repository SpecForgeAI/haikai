package com.example.architecturemodel.model.entity.apibehaviour;

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

import java.time.Instant;
import java.util.UUID;

/**
 * Durable, reasoned comparison-tolerance record consumed by the reconcile
 * comparator (Spec 2026-07-06-j — Parity Exactness &amp; First-Class SOAP,
 * changeset 206).
 *
 * <p>An "exact" strict verdict is exact-modulo-THESE-ROWS, and the rows are
 * visible, editable data — replacing the comparator's fixed in-code header
 * allowlist (the 16 legacy names are seeded as {@code scope='global'} rows
 * with {@code provenance='seed:legacy-allowlist'}).</p>
 *
 * <p>{@code dimension} values: {@code header} | {@code body_path} |
 * {@code xml_xpath} | {@code ordering_path} | {@code break_fingerprint}
 * (Spec I's interim per-break waivers ride the same table). DB CHECK
 * enforces.</p>
 */
@Entity
@Table(
    name = "api_behaviour_comparison_waivers",
    indexes = {
        @Index(name = "idx_abcw_project", columnList = "project_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApiBehaviourComparisonWaiverEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    /** Null for {@code scope='global'} rows (the seeded legacy allowlist). */
    @Column(name = "project_id")
    private UUID projectId;

    @Column(name = "scope", nullable = false)
    private String scope;

    @Column(name = "dimension", nullable = false)
    private String dimension;

    /** The waived name/path/pointer/fingerprint (header names lowercase). */
    @Column(name = "target", nullable = false)
    private String target;

    @Column(name = "reason", nullable = false)
    private String reason;

    @Column(name = "author")
    private String author;

    @Column(name = "provenance")
    private String provenance;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
