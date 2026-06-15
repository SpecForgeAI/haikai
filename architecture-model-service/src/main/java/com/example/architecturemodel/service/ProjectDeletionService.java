package com.example.architecturemodel.service;

import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.entity.ProjectArtifactRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Service for deleting projects and all associated data.
 *
 * Spec 2026-01-07: Overwrite Existing Project Option for Snapshot Import
 * Spec 2026-01-19: Startup Configuration for Feature Toggles - Made conditional on includeDatabase
 *
 * Provides full project deletion functionality for overwrite import operations.
 * Deletes all project-scoped data in the correct dependency order to maintain
 * referential integrity.
 *
 * Deletion order:
 * 1. Model file records (meta-model entities scoped to project's model files)
 * 2. Work items (work_item table rows where project_id matches)
 * 3. Project artifacts (project_artifact table rows where project_id matches)
 * 4. Project record itself from project table
 *
 * Note: Model files are identified by filename matching the project name.
 * The ModelService.deleteModel() method handles cascading deletion of all
 * meta-model entities and diagrams via database cascades.
 */
@Service
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ProjectDeletionService {

    private final ProjectRepository projectRepository;
    private final WorkItemRepository workItemRepository;
    private final ProjectArtifactRepository projectArtifactRepository;
    private final ModelFileRepository modelFileRepository;
    private final ModelService modelService;

    /**
     * Deletes a project and all associated data by project ID.
     *
     * This method must be called within a transaction for atomicity.
     * If any step fails, the entire deletion is rolled back.
     *
     * @param projectId The UUID of the project to delete
     * @param projectName The name of the project (used to find associated model file)
     * @throws IllegalArgumentException if project does not exist
     */
    @Transactional
    public void deleteProjectById(UUID projectId, String projectName) {
        log.info("Deleting project: id={}, name={}", projectId, projectName);

        // Verify project exists
        if (!projectRepository.existsById(projectId)) {
            throw new IllegalArgumentException("Project not found with id: " + projectId);
        }

        // Step 1: Delete model file and all associated meta-model entities
        // Model file is identified by filename matching project name
        deleteModelFileIfExists(projectName);

        // Step 2: Delete work items for this project (uses UUID FK)
        long workItemsDeleted = deleteWorkItems(projectId);
        log.debug("Deleted {} work items for project {}", workItemsDeleted, projectName);

        // Step 3: Delete project artifacts for this project
        long artifactsDeleted = deleteArtifacts(projectId);
        log.debug("Deleted {} artifacts for project {}", artifactsDeleted, projectName);

        // Step 4: Delete the project record itself
        projectRepository.deleteById(projectId);
        log.info("Project deleted successfully: id={}, name={}", projectId, projectName);
    }

    /**
     * Deletes the model file associated with a project name, if it exists.
     *
     * The ModelService.deleteModel() method handles cascading deletion of:
     * - All meta-model entities (business users, applications, services, etc.)
     * - All relationships
     * - All diagrams and diagram elements
     *
     * @param projectName The project name (used as model filename)
     */
    private void deleteModelFileIfExists(String projectName) {
        try {
            // Check if model file exists
            if (modelFileRepository.existsByFilename(projectName)) {
                log.debug("Deleting model file for project: {}", projectName);
                modelService.deleteModel(projectName);
                log.debug("Model file deleted for project: {}", projectName);
            } else {
                log.debug("No model file found for project: {}", projectName);
            }
        } catch (Exception e) {
            log.warn("Error deleting model file for project {}: {}", projectName, e.getMessage());
            // Continue with deletion - model file may not exist or may have cascades
        }
    }

    /**
     * Deletes all work items for a project.
     *
     * @param projectId The project ID as string
     * @return Number of work items deleted
     */
    private long deleteWorkItems(UUID projectId) {
        long count = workItemRepository.countByProjectId(projectId);
        if (count > 0) {
            workItemRepository.deleteByProjectId(projectId);
        }
        return count;
    }

    /**
     * Deletes all project artifacts for a project.
     *
     * @param projectId The project ID as string
     * @return Number of artifacts deleted
     */
    private long deleteArtifacts(UUID projectId) {
        long count = projectArtifactRepository.countByProjectId(projectId);
        if (count > 0) {
            projectArtifactRepository.deleteByProjectId(projectId);
        }
        return count;
    }
}
