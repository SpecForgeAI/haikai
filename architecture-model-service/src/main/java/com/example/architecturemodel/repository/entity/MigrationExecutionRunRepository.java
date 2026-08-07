package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.MigrationExecutionRunEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link MigrationExecutionRunEntity}.
 *
 * <p>Mirrors the structural pattern of
 * {@link MigrationStorySpecGenerationRepository}: standard CRUD via
 * {@link JpaRepository} plus the focused finders the run-state service /
 * controller need.</p>
 *
 * <p>Finders supplied here:</p>
 * <ul>
 *   <li>{@link #findByBookOfWorkIdOrderByCreatedAtDesc(UUID)} -- the run-state
 *       read for a book of work (most-recent run first; powers the
 *       run-progress view).</li>
 *   <li>{@link #findByProjectId(UUID)} -- project-scoped list (diagnostic /
 *       admin views).</li>
 * </ul>
 *
 * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
 */
@Repository
public interface MigrationExecutionRunRepository
    extends JpaRepository<MigrationExecutionRunEntity, UUID> {

    /**
     * All runs for a given Book of Work, most-recent first. The run-progress
     * view reads the latest run; the list shape preserves prior runs of the
     * same book.
     *
     * @param bookOfWorkId the book-of-work UUID
     * @return list of runs, newest first
     */
    List<MigrationExecutionRunEntity> findByBookOfWorkIdOrderByCreatedAtDesc(UUID bookOfWorkId);

    /**
     * Project-scoped list. Used for diagnostic / admin views.
     *
     * @param projectId the project UUID
     * @return list of runs
     */
    List<MigrationExecutionRunEntity> findByProjectId(UUID projectId);

    /**
     * CROSS-project status-scoped list (changeset 219, 2026-08-07): the
     * gateway boot-recovery sweep discovers every in-flight run
     * ({@code started} / {@code dispatching}) so a gateway restart re-kicks
     * stuck mid-segment items instead of stranding the run forever. Uses the
     * existing {@code idx_mer_status} index.
     *
     * @param statuses the run statuses to match
     * @return matching runs, newest first
     */
    List<MigrationExecutionRunEntity> findByStatusInOrderByCreatedAtDesc(
        java.util.Collection<String> statuses);
}
