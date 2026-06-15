package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.WorkItemImplementWorkspaceEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for WorkItemImplementWorkspaceEntity.
 *
 * Provides CRUD operations and custom finder methods for work item implement workspace.
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * - Task Group 1: Database Entity and Repository
 */
@Repository
public interface WorkItemImplementWorkspaceRepository extends JpaRepository<WorkItemImplementWorkspaceEntity, UUID> {

    /**
     * Find the implement workspace for a specific work item in a project.
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     * @return the workspace if found, empty Optional otherwise
     */
    Optional<WorkItemImplementWorkspaceEntity> findByProjectIdAndWorkItemId(UUID projectId, UUID workItemId);

    /**
     * Delete the implement workspace for a specific work item in a project.
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     */
    void deleteByProjectIdAndWorkItemId(UUID projectId, UUID workItemId);
}
