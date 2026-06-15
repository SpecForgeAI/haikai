package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.MissingInputResolutionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for {@link MissingInputResolutionEntity}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 2.</p>
 *
 * <p>Finder shape mirrors the access tuples documented in the spec:</p>
 * <ul>
 *   <li>{@code (projectId, softDeleted=false)} -- list every active resolution
 *       for the project (used by the dashboard list endpoint and as the seed
 *       set for the cross-story matcher).</li>
 *   <li>{@code (projectId, missingInputKey, softDeleted=false)} -- upsert-style
 *       precheck for the create path (the partial unique index
 *       {@code ux_mir_project_key_active} also enforces the constraint at the
 *       DB layer as defence-in-depth).</li>
 *   <li>{@code (projectId, missingInputKey IN ...)} -- the cross-story matcher
 *       intersects this set with a spec's {@code missing_input_keys_json} to
 *       compute "ready-to-retry" (Task Group 3).</li>
 * </ul>
 *
 * <p>{@code findById} is provided by {@link JpaRepository} and is used by the
 * service layer for the soft-delete path (audit-history loads including
 * already-soft-deleted rows).</p>
 *
 * <p>Pattern: mirrors {@link EpicCapturedDecisionRepository} for the scoped-
 * finder shape -- thin JpaRepository surface plus a small set of named queries
 * derived from the canonical access tuples.</p>
 */
@Repository
public interface MissingInputResolutionRepository
    extends JpaRepository<MissingInputResolutionEntity, UUID> {

    /**
     * List active (non-soft-deleted) resolutions for a project. Powers the
     * {@code GET /api/projects/{projectId}/missing-input-resolutions} endpoint
     * (Task Group 4) and seeds the cross-story matcher (Task Group 3).
     *
     * @param projectId  owning project UUID
     * @return           active resolution rows for the project
     */
    List<MissingInputResolutionEntity> findByProjectIdAndSoftDeletedFalse(UUID projectId);

    /**
     * Look up the single active resolution for a {@code (projectId, key)} tuple.
     * Used by the create path as a pre-insert dedupe (the partial unique index
     * also guards against races at the DB layer).
     *
     * @param projectId        owning project UUID
     * @param missingInputKey  stable 16-hex-char key
     * @return                 optional active resolution row
     */
    Optional<MissingInputResolutionEntity> findByProjectIdAndMissingInputKeyAndSoftDeletedFalse(
        UUID projectId, String missingInputKey);

    /**
     * Bulk lookup for the cross-story matcher (Task Group 3). Returns every
     * active resolution whose key is in the supplied collection, scoped to the
     * project. The matcher uses the result to determine which specs are fully
     * resolved (every entry in their {@code missing_input_keys_json} has an
     * active resolution).
     *
     * @param projectId          owning project UUID
     * @param missingInputKeys   keys to intersect with active resolutions
     * @return                   matching active resolution rows
     */
    List<MissingInputResolutionEntity> findByProjectIdAndMissingInputKeyInAndSoftDeletedFalse(
        UUID projectId, Collection<String> missingInputKeys);
}
