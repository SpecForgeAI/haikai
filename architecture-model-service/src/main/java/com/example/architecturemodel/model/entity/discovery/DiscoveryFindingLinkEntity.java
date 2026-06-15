package com.example.architecturemodel.model.entity.discovery;

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
 * JPA entity for {@code discovery_finding_links}.
 *
 * <p>Polymorphic link rows tying a {@link DiscoveryFindingEntity} to 0..N
 * supporting (target_type, target_id) entities. Target identity is stored as a
 * stringified discriminator + identifier pair rather than a hard FK per target
 * table, matching the lightweight FK pattern used elsewhere in the discovery
 * schema and preserving pack extensibility.</p>
 *
 * <p>The parent FK to {@code discovery_findings} is declared with
 * {@code ON DELETE CASCADE} in changeset 136 so link rows vanish with their
 * finding (whether deleted directly or transitively via a run cascade).</p>
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 1.</p>
 */
@Entity
@Table(
    name = "discovery_finding_links",
    indexes = {
        @Index(name = "idx_discovery_finding_link_finding_id", columnList = "finding_id"),
        @Index(name = "idx_discovery_finding_link_target", columnList = "target_type, target_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiscoveryFindingLinkEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "finding_id", nullable = false)
    private UUID findingId;

    @Column(name = "link_type", nullable = false)
    private String linkType;

    @Column(name = "target_type", nullable = false)
    private String targetType;

    /**
     * Stringified identifier of the target. UUIDs for {@code discovery_*} and
     * {@code architecture_element} targets; other shapes possible for future
     * polymorphic target types.
     */
    @Column(name = "target_id", nullable = false)
    private String targetId;

    @Column(name = "label")
    private String label;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
