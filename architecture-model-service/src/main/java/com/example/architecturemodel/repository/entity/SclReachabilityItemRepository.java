package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.SclReachabilityItemEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link SclReachabilityItemEntity}.
 *
 * The worklist is replace-on-write per scan: the service deletes the scan's
 * items via {@link #deleteByScanId(UUID)} and inserts the fresh batch inside
 * one transaction. Backed by the {@code idx_scl_reachability_item_scan} index
 * from changeset 224.
 *
 * Spec: SCL corpus persistence (Structural Contract Language) (2026-08-18).
 */
@Repository
public interface SclReachabilityItemRepository
    extends JpaRepository<SclReachabilityItemEntity, UUID> {

    /**
     * Every reachability item for a scan, ordered by source path.
     *
     * @param scanId the owning scan UUID
     * @return the scan's items ordered by sourcePath ascending
     */
    List<SclReachabilityItemEntity> findByScanIdOrderBySourcePathAsc(UUID scanId);

    /**
     * Delete every reachability item for a scan (the replace-on-write step).
     * Must run inside a transaction (the service's {@code @Transactional}).
     *
     * @param scanId the owning scan UUID
     * @return the number of deleted rows
     */
    long deleteByScanId(UUID scanId);
}
