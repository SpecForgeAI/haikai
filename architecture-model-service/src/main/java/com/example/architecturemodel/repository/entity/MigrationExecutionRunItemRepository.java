package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.MigrationExecutionRunItemEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link MigrationExecutionRunItemEntity}.
 *
 * <p>Mirrors the structural pattern of
 * {@link MigrationStorySpecGenerationRepository}. The {@code job_id} finder is
 * the load-bearing one: the inbound build-results callback (Group 3) correlates
 * on {@code job_id} to find the run-item to advance, and the
 * {@code idx_meri_job_id} index (changeset 182) backs it.</p>
 *
 * <p>Finders supplied here:</p>
 * <ul>
 *   <li>{@link #findByRunIdOrderBySequencePositionAsc(UUID)} -- the ordered
 *       per-spec items for a run (the run-progress view + the advance walk).</li>
 *   <li>{@link #findByJobId(String)} -- the build-results callback correlation
 *       key (Group 3); backed by {@code idx_meri_job_id}.</li>
 * </ul>
 *
 * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
 */
@Repository
public interface MigrationExecutionRunItemRepository
    extends JpaRepository<MigrationExecutionRunItemEntity, UUID> {

    /**
     * The ordered per-spec run-items for a run, by sequence position (the
     * (depth, sequenceOrder) walk order from CD-5). Powers the run-progress
     * view and the Driver's advance walk. Backed by {@code idx_meri_run_sequence}.
     *
     * @param runId the owning run UUID
     * @return run-items ordered by sequence position ascending
     */
    List<MigrationExecutionRunItemEntity> findByRunIdOrderBySequencePositionAsc(UUID runId);

    /**
     * The run-item correlated to an orchestration {@code job_id}. The inbound
     * build-results callback (Group 3) uses this to find the item to advance.
     * Backed by {@code idx_meri_job_id} (changeset 182).
     *
     * <p>{@code job_id} is unique per dispatched spec in practice (one
     * orchestration job per spec); the {@link Optional} return models the
     * unknown-{@code job_id} -&gt; {@code 404} path on the callback door.</p>
     *
     * @param jobId the orchestration job id
     * @return the matching run-item, or empty if no item carries that job_id
     */
    Optional<MigrationExecutionRunItemEntity> findByJobId(String jobId);
}
