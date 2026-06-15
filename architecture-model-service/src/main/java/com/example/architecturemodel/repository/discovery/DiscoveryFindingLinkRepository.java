package com.example.architecturemodel.repository.discovery;

import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingLinkEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data repository for {@link DiscoveryFindingLinkEntity}.
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 1.</p>
 */
@Repository
public interface DiscoveryFindingLinkRepository
        extends JpaRepository<DiscoveryFindingLinkEntity, UUID> {

    /** All link rows for a given finding (drawer / detail panel). */
    List<DiscoveryFindingLinkEntity> findByFindingId(UUID findingId);

    /** Reverse lookup for "which findings link to this target?". */
    List<DiscoveryFindingLinkEntity> findByTargetTypeAndTargetId(
        String targetType, String targetId);

    /** Dedupe-on-create guard. */
    boolean existsByFindingIdAndTargetTypeAndTargetId(
        UUID findingId, String targetType, String targetId);
}
