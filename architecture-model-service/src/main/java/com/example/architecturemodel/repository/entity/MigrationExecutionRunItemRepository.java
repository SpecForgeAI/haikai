package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.MigrationExecutionRunItemEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
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
 *   <li>{@link #findByJobIdOrderBySequencePositionAsc(String)} -- the
 *       build-results callback correlation key (Group 3); backed by
 *       {@code idx_meri_job_id}. A LIST: batch migrate shares one job across
 *       N items.</li>
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
     * The run-items correlated to an orchestration {@code job_id}, ordered by
     * sequence position. The inbound build-results callback carries the
     * job_id and the driver resolves the run-item to advance from it.
     * Backed by {@code idx_meri_job_id} (changeset 182).
     *
     * <p>{@code job_id} is NOT unique per run-item (2026-09-06). Batch migrate
     * submits N stories as ONE orchestration job (one branch + one MR), so N
     * run-items share the job_id. The previous {@code Optional} finder
     * ("unique per dispatched spec in practice") raised
     * {@code IncorrectResultSizeDataAccessException} on the first batch
     * callback, the door answered 500 (never the 404/200 contract), the
     * gateway retried four times and the run wedged for 13.5h. The driver
     * only needs ONE item to resolve the run, then re-derives the sibling set
     * from the run itself, so the service returns the first by sequence
     * position: deterministic rather than row-order dependent.</p>
     *
     * @param jobId the orchestration job id
     * @return every run-item carrying that job_id, lowest sequence position first
     */
    List<MigrationExecutionRunItemEntity> findByJobIdOrderBySequencePositionAsc(String jobId);
}
