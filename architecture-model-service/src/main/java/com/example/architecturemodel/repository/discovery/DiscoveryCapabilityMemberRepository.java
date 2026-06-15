package com.example.architecturemodel.repository.discovery;

import com.example.architecturemodel.model.entity.discovery.DiscoveryCapabilityMemberEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA repository for {@link DiscoveryCapabilityMemberEntity}
 * (Liquibase changeset 184).
 *
 * <p>Finders:</p>
 * <ul>
 *   <li>{@link #findByCapabilityIdOrderByCreatedAtAsc(UUID)} -- read a
 *       capability's members (oldest-first) for the get-with-members read.</li>
 *   <li>{@link #findByCapabilityIdIn(List)} -- batch-read members for many
 *       capabilities (the list read, to avoid an N+1).</li>
 *   <li>{@link #findByMemberTypeAndMemberId(String, UUID)} -- the reverse
 *       lookup: which capabilities reference a given member (keyed on the
 *       {@code (member_type, member_id)} index).</li>
 * </ul>
 *
 * <p>Mirrors the polymorphic-member precedent
 * {@code DiscoveryClusterMemberRepository} (members managed via the parent
 * service, no separate REST controller).</p>
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1.</p>
 */
@Repository
public interface DiscoveryCapabilityMemberRepository
    extends JpaRepository<DiscoveryCapabilityMemberEntity, UUID> {

    /**
     * All members of a capability, oldest-first (creation order).
     *
     * @param capabilityId the owning capability UUID
     * @return the capability's members, oldest first
     */
    List<DiscoveryCapabilityMemberEntity> findByCapabilityIdOrderByCreatedAtAsc(UUID capabilityId);

    /**
     * All members for the given set of capabilities (batch read for the list
     * endpoint, avoiding an N+1 per capability).
     *
     * @param capabilityIds the capability UUIDs
     * @return the members across those capabilities
     */
    List<DiscoveryCapabilityMemberEntity> findByCapabilityIdIn(List<UUID> capabilityIds);

    /**
     * The reverse lookup: all membership edges referencing a given member
     * (keyed on the {@code (member_type, member_id)} index). Used by future
     * consumers that need "which capabilities contain this finding/candidate".
     *
     * @param memberType the polymorphic discriminator
     * @param memberId   the referenced member's id
     * @return the membership edges referencing that member
     */
    List<DiscoveryCapabilityMemberEntity> findByMemberTypeAndMemberId(
        String memberType, UUID memberId);
}
