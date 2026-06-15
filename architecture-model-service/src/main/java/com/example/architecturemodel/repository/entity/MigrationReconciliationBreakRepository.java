package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.MigrationReconciliationBreakEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link MigrationReconciliationBreakEntity}.
 *
 * <p>Mirrors the structural pattern of {@link MigrationExecutionRunRepository}:
 * standard CRUD via {@link JpaRepository} plus the focused finders the
 * reconciliation break/disposition service / controller need.</p>
 *
 * <p>Finders supplied here:</p>
 * <ul>
 *   <li>{@link #findByRunIdOrderByCreatedAtAsc(UUID)} -- read all breaks for a
 *       reconcile run, oldest-first (the review-surface list order).</li>
 *   <li>{@link #findByBugId(String)} -- resolve the breaks behind a bug-fix
 *       build-results callback (the {@code bug_id} correlation key, Group 4).</li>
 *   <li>{@link #findBySourceBaselineItemId(UUID)} -- resolve the break(s) for a
 *       replayable source operation (the CD-6 scoped-re-reconcile scope key).</li>
 * </ul>
 *
 * <p>Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) --
 * Task Group 1.</p>
 */
@Repository
public interface MigrationReconciliationBreakRepository
    extends JpaRepository<MigrationReconciliationBreakEntity, UUID> {

    /**
     * All breaks for a reconcile run, oldest-first (creation order). Powers the
     * review-surface list and the run-scoped reads.
     *
     * @param runId the owning reconcile run UUID
     * @return list of breaks, oldest first
     */
    List<MigrationReconciliationBreakEntity> findByRunIdOrderByCreatedAtAsc(UUID runId);

    /**
     * All breaks sent under a given {@code bug_id} (the bug-fix build-results
     * callback correlation key). One bug report covers a batch of breaks
     * (CD-5), so this returns a list. Empty for an unknown {@code bug_id} -- the
     * door maps that to its own no-op.
     *
     * @param bugId the bug-report correlation id
     * @return the breaks linked to that bug, in no particular order
     */
    List<MigrationReconciliationBreakEntity> findByBugId(String bugId);

    /**
     * All breaks whose replayable source operation is the given baseline_item
     * (the CD-6 scoped-re-reconcile resolution key). Used to map a re-reconcile
     * result back onto its break rows.
     *
     * @param sourceBaselineItemId the source baseline_item UUID
     * @return the breaks for that source operation
     */
    List<MigrationReconciliationBreakEntity> findBySourceBaselineItemId(UUID sourceBaselineItemId);
}
