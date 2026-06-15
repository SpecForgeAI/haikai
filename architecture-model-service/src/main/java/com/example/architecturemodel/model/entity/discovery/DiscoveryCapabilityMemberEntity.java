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
 * JPA entity for {@code discovery_capability_member} (Liquibase changeset 184).
 *
 * <p>Each row is a POLYMORPHIC membership edge from a
 * {@link DiscoveryCapabilityEntity} to one referenced member. The
 * {@code member_type} discriminator indicates the target table for
 * {@code member_id}:</p>
 * <ul>
 *   <li>{@code discovery_finding}</li>
 *   <li>{@code discovery_candidate}</li>
 *   <li>{@code architecture_element}</li>
 *   <li>{@code discovery_relationship}</li>
 * </ul>
 *
 * <p>Referential integrity for {@code member_id} is enforced at the application
 * layer because the target table varies based on {@code member_type}
 * (polymorphic reference) -- the established precedent on
 * {@code DiscoveryClusterMemberEntity}. This entity has no separate REST
 * controller; members are managed through the capability service's create /
 * bulk-create / read operations.</p>
 *
 * <p><b>Distinct mechanism:</b> {@code discovery_finding} is a valid
 * {@code member_type} HERE, but this is a DIFFERENT mechanism from
 * {@code DiscoveryFindingLink} -- {@code discovery_finding} deliberately stays
 * OUT of {@code DiscoveryFindingService.ALLOWED_LINK_TARGET_TYPES}; that
 * finding-link whitelist is untouched by D2.</p>
 *
 * <p>The FK {@code capability_id} -&gt; {@code discovery_capability(id)} is ON
 * DELETE CASCADE (a member only exists in the context of its capability).</p>
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1.</p>
 */
@Entity
@Table(
    name = "discovery_capability_member",
    indexes = {
        @Index(name = "idx_discovery_capability_member_capability_id", columnList = "capability_id"),
        @Index(name = "idx_discovery_capability_member_member", columnList = "member_type, member_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiscoveryCapabilityMemberEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    /**
     * The owning capability. FK -&gt; {@code discovery_capability(id)} ON DELETE
     * CASCADE (a member only exists in the context of its capability).
     */
    @Column(name = "capability_id", nullable = false)
    private UUID capabilityId;

    /**
     * The polymorphic discriminator for {@link #memberId}:
     * {@code discovery_finding} | {@code discovery_candidate} |
     * {@code architecture_element} | {@code discovery_relationship}. Free-text
     * String per the AMS status-as-TEXT convention; the service layer validates
     * the value set.
     */
    @Column(name = "member_type", nullable = false)
    private String memberType;

    /** The referenced member's id (its meaning varies by {@link #memberType}). */
    @Column(name = "member_id", nullable = false)
    private UUID memberId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
