package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.WorkItemMapper;
import com.example.architecturemodel.model.dto.WorkItemDto;
import com.example.architecturemodel.model.dto.WorkItemStatsDto;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for managing Work Items with validation logic.
 *
 * Validates that {@code type} is one of the allowed values and that
 * {@code status} is one of the allowed values. Parent-type relationships
 * are NOT enforced here — callers are responsible for setting a sensible
 * {@code parent_id}. The conventional hierarchy is:
 *   INITIATIVE > EPIC > FEATURE > STORY > (TASK | BUG | TEST)
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class WorkItemService {

    private final WorkItemRepository workItemRepository;

    // ============================================================================
    // Allowed enum values for validation
    // ============================================================================

    private static final Set<String> ALLOWED_TYPES = Set.of(
        "INITIATIVE", "EPIC", "FEATURE", "STORY", "TASK", "BUG", "TEST"
    );

    private static final Set<String> ALLOWED_STATUSES = Set.of(
        "PLANNED", "IN_PROGRESS", "DEV_COMPLETE", "COMPLETED", "CANCELLED"
    );

    // ============================================================================
    // Public API Methods
    // ============================================================================

    /**
     * Get all work items for a project with optional filtering.
     *
     * @param projectId the project ID
     * @param type optional type filter
     * @param parentId optional parent ID filter
     * @return list of work items with deterministic ordering
     */
    @Transactional(readOnly = true)
    public List<WorkItemDto> getWorkItems(UUID projectId, String type, UUID parentId) {
        log.debug("Getting work items for project: {}, type: {}, parentId: {}", projectId, type, parentId);

        List<WorkItemEntity> entities;

        if (type != null && !type.isBlank()) {
            entities = workItemRepository.findByProjectIdAndTypeOrderBySortOrderAscCreatedAtAscIdAsc(
                projectId, type);
        } else if (parentId != null) {
            entities = workItemRepository.findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(
                projectId, parentId);
        } else {
            entities = workItemRepository.findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(projectId);
        }

        return entities.stream()
            .map(WorkItemMapper::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Get a single work item by ID.
     *
     * @param id the work item ID
     * @return the work item DTO
     * @throws ResourceNotFoundException if not found
     */
    @Transactional(readOnly = true)
    public WorkItemDto getWorkItem(UUID id) {
        log.debug("Getting work item with id: {}", id);

        WorkItemEntity entity = workItemRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Work item not found: " + id));

        return WorkItemMapper.toDto(entity);
    }

    /**
     * Search work items by title or description using case-insensitive partial matching.
     *
     * Spec 2026-03-04: What's Next v1-C -- Work item picker search.
     * Delegates to the repository's native PostgreSQL ILIKE query and maps
     * the results to DTOs using the existing WorkItemMapper.
     *
     * @param projectId the project ID
     * @param query the search text
     * @param types the list of work item types to search within
     * @param limit maximum number of results to return
     * @return list of matching work items as DTOs
     */
    @Transactional(readOnly = true)
    public List<WorkItemDto> searchWorkItems(UUID projectId, String query, List<String> types, int limit) {
        log.debug("Searching work items for project: {}, query: '{}', types: {}, limit: {}",
            projectId, query, types, limit);

        List<WorkItemEntity> entities = workItemRepository.searchByTitleOrDescription(
            projectId, query, types, limit);

        return entities.stream()
            .map(WorkItemMapper::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Get work item statistics for a project.
     *
     * Spec 2026-03-06: Dashboard Real Data -- Work Item Stats Endpoint.
     * Executes two repository queries and assembles the WorkItemStatsDto:
     * 1. Type-status counts: groups work items by type and status
     * 2. Stories with AC: counts STORYs with non-empty description
     *
     * @param projectId the project ID
     * @return the work item statistics DTO
     */
    @Transactional(readOnly = true)
    public WorkItemStatsDto getWorkItemStats(UUID projectId) {
        log.debug("Getting work item stats for project: {}", projectId);

        // Query 1: Get type-status counts
        List<Object[]> rows = workItemRepository.countByTypeAndStatus(projectId);

        // Transform rows into nested map: { type: { status: count } }
        Map<String, Map<String, Long>> typeCounts = new HashMap<>();
        for (Object[] row : rows) {
            String type = (String) row[0];
            String status = (String) row[1];
            long count = ((Number) row[2]).longValue();

            typeCounts.computeIfAbsent(type, k -> new HashMap<>())
                .put(status, count);
        }

        // Query 2: Get stories with AC count
        long storiesWithAcCount = workItemRepository.countStoriesWithAc(projectId);

        return new WorkItemStatsDto(typeCounts, storiesWithAcCount);
    }

    /**
     * Create a new work item.
     *
     * @param projectId the project ID
     * @param dto the work item DTO
     * @return the created work item DTO
     * @throws IllegalArgumentException if validation fails
     */
    @Transactional
    public WorkItemDto createWorkItem(UUID projectId, WorkItemDto dto) {
        log.debug("Creating work item in project: {}, type: {}", projectId, dto.type());

        // Validate the work item
        validateWorkItem(projectId, dto, null);

        // Convert to entity and save
        WorkItemEntity entity = WorkItemMapper.toEntity(dto, projectId);
        if (entity.getId() == null) {
            entity.setId(UUID.randomUUID());
        }

        WorkItemEntity saved = workItemRepository.save(entity);
        log.debug("Created work item with id: {}", saved.getId());

        return WorkItemMapper.toDto(saved);
    }

    /**
     * Update an existing work item.
     *
     * Spec 2026-01-18: Fix Feature Edit 400 Error
     * Uses patch semantics - null values in DTO mean "keep existing value":
     * - If dto.type() is null/blank, use entity.getType()
     * - If dto.parentId() is null, use entity.getParentId()
     *
     * @param id the work item ID
     * @param dto the updated work item DTO
     * @return the updated work item DTO
     * @throws ResourceNotFoundException if not found
     * @throws IllegalArgumentException if validation fails
     */
    @Transactional
    public WorkItemDto updateWorkItem(UUID id, WorkItemDto dto) {
        log.debug("Updating work item with id: {}", id);

        WorkItemEntity entity = workItemRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Work item not found: " + id));

        // Spec 2026-01-18: Derive effective values for patch semantics
        // If DTO value is null/blank, use existing entity value
        String effectiveType = (dto.type() != null && !dto.type().isBlank())
            ? dto.type()
            : entity.getType();
        UUID effectiveParentId = dto.parentId() != null
            ? dto.parentId()
            : entity.getParentId();

        // Validate the update using effective values
        validateWorkItemForUpdate(entity.getProjectId(), dto, id, effectiveType, effectiveParentId);

        // Update entity from DTO (mapper handles conditional updates)
        WorkItemMapper.updateEntityFromDto(entity, dto);

        WorkItemEntity saved = workItemRepository.save(entity);
        log.debug("Updated work item with id: {}", saved.getId());

        return WorkItemMapper.toDto(saved);
    }

    /**
     * Set or clear the {@code deferred} flag on a single work item (CD-7).
     *
     * <p>Defer = implementation-EXCLUSION ONLY: a deferred story drops out of
     * the Migrate hard-block in-scope set and is NOT sent for implementation in
     * the run, but it is NEVER removed from reconciliation scope (Spec 4
     * reconciles the full pinned baseline, so a deferred story correctly
     * surfaces there as a break). This is the explicit, visible toggle the
     * frontend "defer this story" / "un-defer" action calls, and the value the
     * Migrate readiness predicate + the gateway run-sequence builder read.</p>
     *
     * <p>A focused single-field write: it does NOT run the full work-item
     * validation (type / title / parent), which is irrelevant to a defer toggle
     * and would reject an otherwise-valid story that is mid-authoring. The
     * boxed {@link Boolean} entity field + the DB {@code NOT NULL DEFAULT false}
     * column keep the column safe.</p>
     *
     * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
     * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
     *
     * @param id       the work item ID
     * @param deferred {@code true} to defer (exclude from implementation),
     *                 {@code false} to un-defer
     * @return the updated work item DTO
     * @throws ResourceNotFoundException if not found
     */
    @Transactional
    public WorkItemDto setDeferred(UUID id, boolean deferred) {
        log.debug("Setting deferred={} on work item id: {}", deferred, id);

        WorkItemEntity entity = workItemRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Work item not found: " + id));

        entity.setDeferred(deferred);
        WorkItemEntity saved = workItemRepository.save(entity);
        log.debug("Set deferred={} on work item id: {}", deferred, saved.getId());

        return WorkItemMapper.toDto(saved);
    }

    /**
     * Delete a work item.
     * Children are deleted via ON DELETE CASCADE in the database.
     *
     * @param id the work item ID
     * @throws ResourceNotFoundException if not found
     */
    @Transactional
    public void deleteWorkItem(UUID id) {
        log.debug("Deleting work item with id: {}", id);

        if (!workItemRepository.existsById(id)) {
            throw new ResourceNotFoundException("Work item not found: " + id);
        }

        workItemRepository.deleteById(id);
        log.debug("Deleted work item with id: {}", id);
    }

    // ============================================================================
    // Validation Methods
    // ============================================================================

    /**
     * Validate a work item before create or update.
     *
     * @param projectId the project ID
     * @param dto the work item DTO to validate
     * @param existingId the existing work item ID (for updates), or null for creates
     * @throws IllegalArgumentException if validation fails
     */
    private void validateWorkItem(UUID projectId, WorkItemDto dto, UUID existingId) {
        // Validate required fields
        if (dto.type() == null || dto.type().isBlank()) {
            throw new IllegalArgumentException("Work item type is required");
        }
        if (dto.title() == null || dto.title().isBlank()) {
            throw new IllegalArgumentException("Work item title is required");
        }

        // Validate type is allowed
        validateType(dto.type());

        // Validate status if provided
        if (dto.status() != null && !dto.status().isBlank()) {
            validateStatus(dto.status());
        }

        // Validate self-parent constraint
        if (existingId != null && dto.parentId() != null && dto.parentId().equals(existingId)) {
            throw new IllegalArgumentException(
                "Work item cannot be its own parent. Self-referential parent_id is not allowed.");
        }

        // Validate parent relationship
        validateParentRelationship(projectId, dto.type(), dto.parentId());
    }

    /**
     * Validate a work item for update using effective values (patch semantics).
     *
     * Spec 2026-01-18: Fix Feature Edit 400 Error
     * This method uses effective values derived from both DTO and existing entity,
     * allowing null values in DTO to mean "keep existing value".
     *
     * @param projectId the project ID
     * @param dto the work item DTO to validate
     * @param existingId the existing work item ID
     * @param effectiveType the effective type (from DTO or existing entity)
     * @param effectiveParentId the effective parent ID (from DTO or existing entity)
     * @throws IllegalArgumentException if validation fails
     */
    private void validateWorkItemForUpdate(UUID projectId, WorkItemDto dto, UUID existingId,
                                           String effectiveType, UUID effectiveParentId) {
        // Title is still required
        if (dto.title() == null || dto.title().isBlank()) {
            throw new IllegalArgumentException("Work item title is required");
        }

        // Validate effective type is allowed
        validateType(effectiveType);

        // Validate status if provided
        if (dto.status() != null && !dto.status().isBlank()) {
            validateStatus(dto.status());
        }

        // Validate self-parent constraint using effective parentId
        if (effectiveParentId != null && effectiveParentId.equals(existingId)) {
            throw new IllegalArgumentException(
                "Work item cannot be its own parent. Self-referential parent_id is not allowed.");
        }

        // Validate parent relationship using effective values
        validateParentRelationship(projectId, effectiveType, effectiveParentId);
    }

    /**
     * Validate that the type is an allowed value.
     *
     * @param type the type to validate
     * @throws IllegalArgumentException if invalid
     */
    private void validateType(String type) {
        if (!ALLOWED_TYPES.contains(type)) {
            throw new IllegalArgumentException(
                "Invalid work item type: " + type + ". Allowed values: " + ALLOWED_TYPES);
        }
    }

    /**
     * Validate that the status is an allowed value.
     *
     * @param status the status to validate
     * @throws IllegalArgumentException if invalid
     */
    private void validateStatus(String status) {
        if (!ALLOWED_STATUSES.contains(status)) {
            throw new IllegalArgumentException(
                "Invalid work item status: " + status + ". Allowed values: " + ALLOWED_STATUSES);
        }
    }

    /**
     * Validate the parent relationship based on type hierarchy rules.
     *
     * Rules:
     * - INITIATIVE: parent must be NULL
     * - EPIC: parent must be INITIATIVE
     * - FEATURE: parent must be EPIC
     * - STORY: parent must be FEATURE
     *
     * @param projectId the project ID
     * @param type the work item type
     * @param parentId the parent ID
     * @throws IllegalArgumentException if validation fails
     */
    private void validateParentRelationship(UUID projectId, String type, UUID parentId) {
        // Loose hierarchy: parent-type relationships are intentionally NOT enforced.
        // Callers (UI, importers, sync) are responsible for setting a sensible parent.
        // The only invariants kept here are existence and project-membership, so we
        // can never end up with dangling parent_id references or cross-project leaks.
        if (parentId == null) {
            return;
        }
        WorkItemEntity parent = workItemRepository.findById(parentId)
            .orElseThrow(() -> new IllegalArgumentException(
                "Parent work item not found: " + parentId));
        if (!parent.getProjectId().equals(projectId)) {
            throw new IllegalArgumentException(
                "Parent work item must be in the same project. " +
                "Parent is in project '" + parent.getProjectId() +
                "' but child is in project '" + projectId + "'.");
        }
    }

}
