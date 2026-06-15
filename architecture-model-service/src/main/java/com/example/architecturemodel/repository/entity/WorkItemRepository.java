package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.WorkItemEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for WorkItemEntity.
 *
 * Provides CRUD operations and custom query methods with deterministic ordering
 * for work items within a project.
 */
@Repository
public interface WorkItemRepository extends JpaRepository<WorkItemEntity, UUID> {

    /**
     * Find all work items for a project with deterministic ordering.
     * Orders by sort_order ASC, created_at ASC, id ASC for consistent results.
     *
     * @param projectId the project UUID
     * @return list of work items in deterministic order
     */
    List<WorkItemEntity> findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(UUID projectId);

    /**
     * Find all work items for a project filtered by type with deterministic ordering.
     *
     * @param projectId the project UUID
     * @param type the work item type (INITIATIVE, EPIC, FEATURE, STORY)
     * @return list of work items in deterministic order
     */
    List<WorkItemEntity> findByProjectIdAndTypeOrderBySortOrderAscCreatedAtAscIdAsc(
        UUID projectId, String type);

    /**
     * Find all work items for a project with a specific parent with deterministic ordering.
     *
     * @param projectId the project UUID
     * @param parentId the parent work item ID
     * @return list of child work items in deterministic order
     */
    List<WorkItemEntity> findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(
        UUID projectId, UUID parentId);

    /**
     * Find all work items for a project with null parent (root items) with deterministic ordering.
     *
     * @param projectId the project UUID
     * @return list of root work items in deterministic order
     */
    List<WorkItemEntity> findByProjectIdAndParentIdIsNullOrderBySortOrderAscCreatedAtAscIdAsc(
        UUID projectId);

    /**
     * Delete all work items for a project.
     *
     * @param projectId the project UUID
     */
    void deleteByProjectId(UUID projectId);

    /**
     * Count work items for a project.
     *
     * @param projectId the project UUID
     * @return count of work items
     */
    long countByProjectId(UUID projectId);

    /**
     * Count work items for a project filtered by type list.
     * Used by roadmap import to check if FEATURE/STORY exist before import.
     *
     * @param projectId the project UUID
     * @param types the collection of types to count
     * @return count of matching work items
     */
    long countByProjectIdAndTypeIn(UUID projectId, Collection<String> types);

    /**
     * Delete all work items for a project filtered by type list.
     * Used by roadmap import to clear existing INITIATIVE/EPIC before re-import.
     *
     * @param projectId the project UUID
     * @param types the collection of types to delete
     */
    @Modifying
    void deleteByProjectIdAndTypeIn(UUID projectId, Collection<String> types);

    // ========================================================================
    // V3 Import Methods - Upsert and Archive/Delete Support
    // ========================================================================

    /**
     * Find a work item by ID scoped to a specific project.
     * Used for safe lookups during upsert operations.
     *
     * @param id the work item ID
     * @param projectId the project UUID
     * @return the work item if found and belongs to project, empty otherwise
     */
    Optional<WorkItemEntity> findByIdAndProjectId(UUID id, UUID projectId);

    // ========================================================================
    // Spec 2026-06-14 D4 -- Carry-over Completeness Gate (Task Group 1):
    // capability-coverage read (work-items-by-source_capability_id)
    // ========================================================================

    /**
     * All work items for a project that CITE a discovery capability, i.e. those
     * whose {@code source_capability_id} column is non-null (changeset 185).
     *
     * <p><b>Coverage-data read for the carry_over completeness gate (D4).</b> The
     * gateway gate derives the set of cited capability ids from these rows so a
     * capability's covered-state is a structured JOIN
     * ({@code work_item.source_capability_id == discovery_capability.id}, D8), not
     * a {@code book_of_work_json} blob re-parse. Ordinary (non-capability) work
     * items -- whose {@code source_capability_id} is null -- are excluded. The
     * rows are exposed to the gateway via the existing {@code GET .../work-items}
     * list (the DTO now carries {@code source_capability_id}); this finder gives
     * AMS callers the same structured slice directly.</p>
     *
     * @param projectId the owning project UUID
     * @return the project's capability-citing work items (possibly empty)
     */
    List<WorkItemEntity> findByProjectIdAndSourceCapabilityIdIsNotNull(UUID projectId);

    /**
     * Find all work items for a project filtered by multiple types.
     * Used to load existing INITIATIVE/EPIC items at start of import.
     *
     * @param projectId the project UUID
     * @param types the collection of types to include
     * @return list of work items matching any of the given types
     */
    List<WorkItemEntity> findByProjectIdAndTypeIn(UUID projectId, Collection<String> types);

    /**
     * Count direct children of a work item within a project.
     * Used to determine if an item can be safely deleted or should be archived.
     *
     * @param projectId the project UUID
     * @param parentId the parent work item ID
     * @return count of child work items
     */
    long countByProjectIdAndParentId(UUID projectId, UUID parentId);

    // ========================================================================
    // Spec 2026-03-04: What's Next v1-C -- Text search for work item picker
    // ========================================================================

    /**
     * Search work items by title or description using PostgreSQL ILIKE for
     * case-insensitive partial matching, filtered by project and type.
     *
     * This is a native query because ILIKE is PostgreSQL-specific.
     * Results are ordered by sort_order ASC, created_at ASC to preserve
     * database ordering for the gateway to re-rank.
     *
     * @param projectId the project UUID
     * @param query the search text (matched against title and description)
     * @param types the list of work item types to include
     * @param limit maximum number of results to return
     * @return list of matching work items in deterministic order
     */
    @Query(value = "SELECT * FROM work_item WHERE project_id = :projectId AND type IN (:types) AND (title ILIKE '%' || :query || '%' OR description ILIKE '%' || :query || '%') ORDER BY sort_order ASC, created_at ASC LIMIT :limit", nativeQuery = true)
    List<WorkItemEntity> searchByTitleOrDescription(
        @Param("projectId") UUID projectId,
        @Param("query") String query,
        @Param("types") List<String> types,
        @Param("limit") int limit
    );

    // ========================================================================
    // Spec 2026-03-06: Dashboard Real Data -- Work Item Stats Queries
    // ========================================================================

    /**
     * Count work items grouped by type and status for a project.
     * Returns rows of [type, status, count] for building the type-status counts map.
     *
     * This is a native query for direct GROUP BY aggregation.
     *
     * @param projectId the project UUID
     * @return list of Object arrays where [0]=type, [1]=status, [2]=count
     */
    @Query(value = "SELECT type, status, COUNT(*) as cnt FROM work_item WHERE project_id = :projectId GROUP BY type, status", nativeQuery = true)
    List<Object[]> countByTypeAndStatus(@Param("projectId") UUID projectId);

    /**
     * Count stories with acceptance criteria (non-null, non-empty description) for a project.
     *
     * This is a native query for a filtered count aggregation.
     *
     * @param projectId the project UUID
     * @return count of STORY work items with non-empty description
     */
    @Query(value = "SELECT COUNT(*) FROM work_item WHERE project_id = :projectId AND type = 'STORY' AND description IS NOT NULL AND description != ''", nativeQuery = true)
    long countStoriesWithAc(@Param("projectId") UUID projectId);
}
