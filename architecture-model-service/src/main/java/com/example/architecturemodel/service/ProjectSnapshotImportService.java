package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.model.dto.ProjectArtifactDto;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.WorkItemDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportRequestDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportResultDto;
import com.example.architecturemodel.model.entity.ProjectArtifactEntity;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.entity.ProjectArtifactRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for importing project snapshots.
 *
 * Handles the import of a previously exported Project Snapshot JSON,
 * creating a new project with all persisted state restored (model, work items, artifacts).
 *
 * Spec 2026-01-06: Project Snapshot JSON Import
 * Spec 2026-01-07: Overwrite Existing Project Option for Snapshot Import
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ProjectSnapshotImportService {

    private static final int SUPPORTED_SNAPSHOT_VERSION = 1;

    private final ProjectService projectService;
    private final ModelService modelService;
    private final WorkItemRepository workItemRepository;
    private final ProjectArtifactRepository projectArtifactRepository;
    private final ProjectRepository projectRepository;
    private final ProjectDeletionService projectDeletionService;

    /**
     * Imports a project snapshot and creates a new project with all data restored.
     *
     * This method is transactional - if any step fails, all changes are rolled back.
     * This includes overwrite operations where the delete and import are atomic.
     *
     * Steps:
     * 1. Validate snapshot.meta.snapshot_version == 1 (or accept legacy snapshot without meta)
     * 2. Validate effective project_parent_folder is not blank
     * 3. Determine newProjectName from request
     * 4. Check project name uniqueness:
     *    - If exists and overwrite=false: throw 409 Conflict
     *    - If exists and overwrite=true: delete existing project, then proceed
     * 5. Create new project via ProjectService.createProject()
     * 6. Persist model via ModelService.saveModel(newProjectName, snapshot.model)
     * 7. Persist work items with ID collision detection
     * 8. Persist artifacts with ID collision detection
     * 9. Build and return ProjectSnapshotImportResultDto with counts
     *
     * @param request The import request containing snapshot and import options
     * @return ProjectSnapshotImportResultDto with the created project and import counts
     * @throws IllegalArgumentException for validation errors (400 Bad Request)
     * @throws ConflictException for name collisions (when overwrite=false) or ID collisions (409 Conflict)
     */
    @Transactional
    public ProjectSnapshotImportResultDto importSnapshot(ProjectSnapshotImportRequestDto request) {
        log.info("Importing project snapshot");

        // Step 1: Validate snapshot version
        validateSnapshotVersion(request.snapshot());

        // Debug logging for parent folder values (Spec 2026-01-07: Fix Snapshot Import Parent Folder)
        String snapshotProjectParentFolder = (request.snapshot() != null && request.snapshot().project() != null)
            ? request.snapshot().project().projectParentFolder()
            : null;
        log.debug("Import request - projectParentFolder: '{}', snapshot.project.projectParentFolder: '{}', effective: '{}'",
            request.projectParentFolder(),
            snapshotProjectParentFolder,
            request.effectiveProjectParentFolder());

        // Step 2: Validate effective project_parent_folder
        validateProjectParentFolder(request.effectiveProjectParentFolder());

        // Step 3: Determine new project name
        String newProjectName = request.effectiveProjectName();
        if (newProjectName == null || newProjectName.isBlank()) {
            throw new IllegalArgumentException("Project name is required (either import_as_name or snapshot.project.name)");
        }
        log.debug("Effective project name: {}", newProjectName);

        // Step 4: Check project name uniqueness with overwrite handling
        // Spec 2026-01-07: Overwrite Existing Project Option for Snapshot Import
        Optional<ProjectEntity> existingProject = projectRepository.findByName(newProjectName);
        if (existingProject.isPresent()) {
            if (request.effectiveOverwriteExistingProject()) {
                // Overwrite enabled: delete existing project before importing new one
                log.info("Overwriting existing project: {} (id={})",
                    newProjectName, existingProject.get().getId());
                projectDeletionService.deleteProjectById(
                    existingProject.get().getId(),
                    existingProject.get().getName()
                );
                log.info("Existing project deleted, proceeding with import");
            } else {
                // Overwrite disabled (default): throw conflict exception
                throw new ConflictException("Project name already exists: " + newProjectName);
            }
        }

        // Step 5: Create new project using effective parent folder
        ProjectDto newProject = projectService.createProject(
            newProjectName,
            request.effectiveProjectParentFolder(),
            null, // projectHierarchy - not included in snapshot import
            request.effectiveSetActive()
        );
        log.info("Created new project: {} (id={})", newProject.name(), newProject.id());

        UUID newProjectUuid = newProject.id();

        // Step 6: Persist model
        boolean modelSaved = false;
        if (request.snapshot().model() != null) {
            modelService.saveModel(newProjectName, request.snapshot().model());
            modelSaved = true;
            log.debug("Model saved for project: {}", newProjectName);
        }

        // Step 7: Persist work items (using UUID directly)
        int workItemsInserted = importWorkItems(request.snapshot().workItems(), newProjectUuid);
        log.debug("Inserted {} work items", workItemsInserted);

        // Step 8: Persist artifacts (using UUID directly)
        int artifactsInserted = importArtifacts(request.snapshot().artifacts(), newProjectUuid);
        log.debug("Inserted {} artifacts", artifactsInserted);

        // Step 9: Build and return result
        log.info("Project snapshot import completed successfully: {} work items, {} artifacts",
            workItemsInserted, artifactsInserted);

        return ProjectSnapshotImportResultDto.of(
            newProject,
            modelSaved,
            workItemsInserted,
            artifactsInserted
        );
    }

    /**
     * Validates that the snapshot version is supported.
     *
     * For backward compatibility, legacy snapshots without meta field are accepted
     * and treated as version 1 snapshots with a warning logged.
     *
     * @param snapshot The snapshot to validate
     * @throws IllegalArgumentException if version is unsupported or snapshot is null
     */
    private void validateSnapshotVersion(ProjectSnapshotDto snapshot) {
        if (snapshot == null) {
            throw new IllegalArgumentException("Snapshot is required");
        }
        if (snapshot.meta() == null) {
            log.warn("Importing legacy snapshot without meta");
            return; // Accept as v1 legacy snapshot
        }
        if (snapshot.meta().snapshotVersion() == null) {
            throw new IllegalArgumentException("Snapshot version is required");
        }
        if (snapshot.meta().snapshotVersion() != SUPPORTED_SNAPSHOT_VERSION) {
            throw new IllegalArgumentException(
                "Unsupported snapshot version: " + snapshot.meta().snapshotVersion() +
                ". Supported version: " + SUPPORTED_SNAPSHOT_VERSION
            );
        }
    }

    /**
     * Validates that the project parent folder is provided and not blank.
     *
     * @param projectParentFolder The parent folder path (effective value after fallback)
     * @throws IllegalArgumentException if parent folder is missing or blank
     */
    private void validateProjectParentFolder(String projectParentFolder) {
        if (projectParentFolder == null || projectParentFolder.isBlank()) {
            throw new IllegalArgumentException("Project parent folder is required");
        }
    }

    /**
     * Imports work items with ID collision detection.
     *
     * Preserves original IDs from the snapshot.
     *
     * @param workItems The work items to import
     * @param newProjectId The ID of the new project
     * @return Count of work items inserted
     * @throws ConflictException if any work item ID already exists
     */
    private int importWorkItems(List<WorkItemDto> workItems, UUID newProjectId) {
        if (workItems == null || workItems.isEmpty()) {
            return 0;
        }

        // Check for ID collisions
        for (WorkItemDto dto : workItems) {
            if (dto.id() != null && workItemRepository.existsById(dto.id())) {
                throw new ConflictException("Work item ID already exists: " + dto.id());
            }
        }

        // Map DTOs to entities and save
        List<WorkItemEntity> entities = workItems.stream()
            .map(dto -> mapWorkItemToEntity(dto, newProjectId))
            .collect(Collectors.toList());

        workItemRepository.saveAll(entities);
        return entities.size();
    }

    /**
     * Maps a WorkItemDto to a WorkItemEntity.
     *
     * @param dto The DTO to map
     * @param newProjectId The new project ID
     * @return The mapped entity
     */
    private WorkItemEntity mapWorkItemToEntity(WorkItemDto dto, UUID newProjectId) {
        return WorkItemEntity.builder()
            .id(dto.id() != null ? dto.id() : UUID.randomUUID())
            .projectId(newProjectId)
            .type(dto.type())
            .parentId(dto.parentId())
            .title(dto.title())
            .description(dto.description())
            .status(dto.status() != null ? dto.status() : "PLANNED")
            .sortOrder(dto.sortOrder() != null ? dto.sortOrder() : 0)
            .priority(dto.priority())
            .targetWindow(dto.targetWindow())
            .tagsJson(dto.tags())
            .externalSystem(dto.externalSystem())
            .externalKey(dto.externalKey())
            .createdAt(dto.createdAt() != null ? dto.createdAt() : Instant.now())
            .updatedAt(dto.updatedAt() != null ? dto.updatedAt() : Instant.now())
            .build();
    }

    /**
     * Imports artifacts with ID collision detection.
     *
     * Preserves original IDs, revisions, and timestamps from the snapshot.
     *
     * @param artifacts The artifacts to import
     * @param newProjectId The ID of the new project
     * @return Count of artifacts inserted
     * @throws ConflictException if any artifact ID already exists
     */
    private int importArtifacts(List<ProjectArtifactDto> artifacts, UUID newProjectId) {
        if (artifacts == null || artifacts.isEmpty()) {
            return 0;
        }

        // Check for ID collisions
        for (ProjectArtifactDto dto : artifacts) {
            if (dto.id() != null && projectArtifactRepository.existsById(dto.id())) {
                throw new ConflictException("Artifact ID already exists: " + dto.id());
            }
        }

        // Map DTOs to entities and save
        List<ProjectArtifactEntity> entities = artifacts.stream()
            .map(dto -> mapArtifactToEntity(dto, newProjectId))
            .collect(Collectors.toList());

        projectArtifactRepository.saveAll(entities);
        return entities.size();
    }

    /**
     * Maps a ProjectArtifactDto to a ProjectArtifactEntity.
     *
     * @param dto The DTO to map
     * @param newProjectId The new project ID
     * @return The mapped entity
     */
    private ProjectArtifactEntity mapArtifactToEntity(ProjectArtifactDto dto, UUID newProjectId) {
        return ProjectArtifactEntity.builder()
            .id(dto.id() != null ? dto.id() : UUID.randomUUID())
            .projectId(newProjectId)
            .artifactType(dto.artifactType())
            .content(dto.content())
            .source(dto.source() != null ? dto.source() : "AGENT_OS")
            .revision(dto.revision() != null ? dto.revision() : 1)
            .createdAt(dto.createdAt() != null ? dto.createdAt() : Instant.now())
            .build();
    }
}
