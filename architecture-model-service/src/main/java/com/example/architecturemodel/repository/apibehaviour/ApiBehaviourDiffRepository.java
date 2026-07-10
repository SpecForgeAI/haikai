package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for {@link ApiBehaviourDiffEntity}.
 *
 * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 1</p>
 *
 * <p>The UNIQUE constraint on
 * {@code (source_baseline_id, target_baseline_id)} (changeset 158) means a
 * lookup by target baseline returns at most one row -- exposed as
 * {@link #findByTargetBaselineId(UUID)}. The same source baseline can be
 * replayed against multiple targets, so source-side lookups return a list.</p>
 */
@Repository
public interface ApiBehaviourDiffRepository
        extends JpaRepository<ApiBehaviourDiffEntity, UUID> {

    /**
     * Primary UI-lookup path: a target baseline has at most one diff
     * (enforced by the UNIQUE pair constraint, since a target baseline is
     * paired with exactly one source baseline via
     * {@code paired_with_baseline_id}).
     */
    Optional<ApiBehaviourDiffEntity> findByTargetBaselineId(UUID targetBaselineId);

    /**
     * Source-side lookup: a single source baseline can be replayed against
     * multiple target baselines (each replay produces its own pair). v1
     * navigation is target → drift report; this finder exists for the v2
     * reverse-lookup surface and for tests.
     */
    List<ApiBehaviourDiffEntity> findBySourceBaselineId(UUID sourceBaselineId);

    /**
     * Source-side lookup ordered newest-first. Supports the future v2
     * reverse-lookup UI (deferred per accepted Q9; AMS surface is complete).
     */
    List<ApiBehaviourDiffEntity>
        findBySourceBaselineIdOrderByCreatedAtDesc(UUID sourceBaselineId);

    /**
     * Pair lookup used by the diff-creation flow to detect existing diffs
     * (recompute semantics) vs new-diff creation.
     */
    Optional<ApiBehaviourDiffEntity> findBySourceBaselineIdAndTargetBaselineId(
        UUID sourceBaselineId, UUID targetBaselineId);

    /**
     * Project-scoped read (Spec 2026-07-06-f §4, Tier-1 batch): the readiness
     * assessment checks whether ANY scoped-parity revalidation diff exists for
     * the project. `endpoint_scope_json` filtering happens in Java — diffs per
     * project are bounded.
     */
    List<ApiBehaviourDiffEntity> findByProjectId(UUID projectId);
}
