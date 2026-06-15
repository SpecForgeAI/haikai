package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.WorkItemImplementContextEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for WorkItemImplementContextEntity.
 *
 * Provides CRUD operations and custom finder methods for work item implement context.
 */
@Repository
public interface WorkItemImplementContextRepository extends JpaRepository<WorkItemImplementContextEntity, UUID> {

    /**
     * Find the implement context for a specific work item in a project.
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     * @return the context if found, empty Optional otherwise
     */
    Optional<WorkItemImplementContextEntity> findByProjectIdAndWorkItemId(UUID projectId, UUID workItemId);

    /**
     * Delete the implement context for a specific work item in a project.
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     */
    void deleteByProjectIdAndWorkItemId(UUID projectId, UUID workItemId);
}
