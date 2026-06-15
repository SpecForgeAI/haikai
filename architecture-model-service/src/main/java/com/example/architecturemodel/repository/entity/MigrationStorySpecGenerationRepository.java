package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link MigrationStorySpecGenerationEntity}.
 *
 * <p>Mirrors the structural pattern of
 * {@link GeneratedMigrationBookOfWorkRepository} (Spec 1): standard CRUD via
 * {@link JpaRepository} plus the small handful of focused finders the
 * service / controller layer needs.</p>
 *
 * <p>Finders supplied here:</p>
 * <ul>
 *   <li>{@link #findByBookOfWorkId(UUID)}             -- list-per-book endpoint (Group 8).</li>
 *   <li>{@link #findByBookOfWorkIdAndStatusIn(UUID, Collection)} -- status-filtered list-per-book.</li>
 *   <li>{@link #findByWorkItemId(UUID)}               -- WorkItem Implement-tab chip lookup (R-9).</li>
 *   <li>{@link #findByProjectId(UUID)}                -- project-scoped list.</li>
 *   <li>{@link #countByBookOfWorkId(UUID)}            -- summary endpoint "attempted" count (A-6).</li>
 *   <li>{@link #countByBookOfWorkIdAndStatus(UUID, String)} -- summary endpoint per-status counts.</li>
 *   <li>{@link #findByProjectIdAndStaleTrue(UUID)}    -- migration delivery dashboard stale-spec
 *       indicator + "Regenerate stale" target list (spec: Target Architecture
 *       Authoring Flow, Task Group 9).</li>
 * </ul>
 *
 * <p>Composite index {@code idx_msg_book_status} on
 * {@code (book_of_work_id, status)} (Liquibase changeset 140) backs
 * {@link #findByBookOfWorkIdAndStatusIn(UUID, Collection)} and the per-status
 * count queries.</p>
 *
 * <p>Composite index {@code idx_msg_project_stale} on
 * {@code (project_id, stale)} (Liquibase changeset 146) backs
 * {@link #findByProjectIdAndStaleTrue(UUID)} -- the dashboard's stale-spec
 * count query path. The Boolean.TRUE filter is the explicit form (NULL is
 * treated as "not stale" by the dashboard).</p>
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 1.</p>
 * <p>Extended: Target Architecture Authoring Flow (2026-05-20) -- Task Group 9.</p>
 */
@Repository
public interface MigrationStorySpecGenerationRepository
    extends JpaRepository<MigrationStorySpecGenerationEntity, UUID> {

    /**
     * Find all spec-generation rows for a given Book of Work, in creation
     * order (oldest first). Powers the list-per-book endpoint (Group 8) and
     * the cross-WorkItem summary computation (A-6).
     *
     * @param bookOfWorkId the originating BoW UUID
     * @return list of spec-generation entities, oldest first
     */
    List<MigrationStorySpecGenerationEntity> findByBookOfWorkIdOrderByCreatedAtAsc(UUID bookOfWorkId);

    /**
     * Convenience alias for {@link #findByBookOfWorkIdOrderByCreatedAtAsc(UUID)}
     * with no ordering guarantee. Used by simpler test fixtures.
     *
     * @param bookOfWorkId the originating BoW UUID
     * @return list of matching entities
     */
    List<MigrationStorySpecGenerationEntity> findByBookOfWorkId(UUID bookOfWorkId);

    /**
     * Status-filtered list-per-book lookup. Backed by composite index
     * {@code idx_msg_book_status}.
     *
     * @param bookOfWorkId the originating BoW UUID
     * @param statuses     the statuses to admit
     * @return list of matching entities
     */
    List<MigrationStorySpecGenerationEntity> findByBookOfWorkIdAndStatusIn(
        UUID bookOfWorkId, Collection<String> statuses);

    /**
     * Find all spec-generation rows for a single WorkItem. Used by:
     * <ul>
     *   <li>the WorkItem Implement-tab chip lookup (R-9), and</li>
     *   <li>the list-per-WorkItem endpoint (Group 8) -- future-proofs
     *       regeneration history (multiple rows per WorkItem).</li>
     * </ul>
     *
     * <p>In the lazy single-row model the list has at most one element; the
     * service layer is responsible for the upsert-by-{@code work_item_id}
     * invariant. The list shape leaves the door open for preserving prior
     * generation attempts in a future spec.</p>
     *
     * @param workItemId the saved-story WorkItem UUID
     * @return list of spec-generation entities (0 or 1 in lazy model)
     */
    List<MigrationStorySpecGenerationEntity> findByWorkItemId(UUID workItemId);

    /**
     * Project-scoped list. Used for diagnostic / admin views.
     *
     * @param projectId the project UUID
     * @return list of entities
     */
    List<MigrationStorySpecGenerationEntity> findByProjectId(UUID projectId);

    /**
     * Count of all attempted spec-generations for a given Book of Work.
     * Used by the summary endpoint to compute lazy {@code not_attempted}
     * count (A-6): {@code notAttempted = totalSavedStories - attempted}.
     *
     * @param bookOfWorkId the originating BoW UUID
     * @return the row count for this book
     */
    long countByBookOfWorkId(UUID bookOfWorkId);

    /**
     * Per-status count for a given Book of Work. Used by the summary
     * endpoint's by-status totals.
     *
     * @param bookOfWorkId the originating BoW UUID
     * @param status       the status to count
     * @return the row count for this book-and-status
     */
    long countByBookOfWorkIdAndStatus(UUID bookOfWorkId, String status);

    /**
     * Project-scoped list of spec-generation rows currently marked stale.
     * Backed by composite index {@code idx_msg_project_stale} on
     * {@code (project_id, stale)} (Liquibase changeset 146).
     *
     * <p>Used by the Migration Delivery Dashboard's "Stale specs" indicator
     * (Target Architecture Authoring Flow spec, Task Group 9) -- the count
     * surfaces in a summary card and the WorkItem ids fuel the
     * "Regenerate stale" action which forwards them to the gateway batch
     * regeneration endpoint as {@code targetWorkItemIds} with
     * {@code regenerateAll=true}.</p>
     *
     * <p>NULL stale values are NOT returned -- only {@code stale=true} rows.
     * On successful regeneration the persist path clears {@code stale=false}
     * and {@code staleMarkedAt=null} so the count drops to zero.</p>
     *
     * @param projectId the project UUID
     * @return list of rows where {@code stale=true} (never null)
     */
    List<MigrationStorySpecGenerationEntity> findByProjectIdAndStaleTrue(UUID projectId);
}
