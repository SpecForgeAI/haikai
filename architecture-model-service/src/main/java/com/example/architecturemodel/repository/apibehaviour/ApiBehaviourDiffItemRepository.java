package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffItemEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data repository for {@link ApiBehaviourDiffItemEntity}.
 *
 * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 1</p>
 */
@Repository
public interface ApiBehaviourDiffItemRepository
        extends JpaRepository<ApiBehaviourDiffItemEntity, UUID> {

    /**
     * Primary listing path for the Drift report tab. Ordered by
     * ({@code method}, {@code path}) so the UI gets deterministic row
     * ordering.
     */
    List<ApiBehaviourDiffItemEntity>
        findByDiffIdOrderByMethodAscPathAsc(UUID diffId);

    /**
     * Wipes all diff_items for a given diff. Used by the recompute flow
     * before inserting newly-computed rows.
     */
    @Transactional
    void deleteByDiffId(UUID diffId);
}
