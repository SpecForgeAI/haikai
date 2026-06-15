package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ProjectArtifactDto;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.roadmap.DetailedImportCounts;
import com.example.architecturemodel.model.dto.roadmap.RoadmapImportResultDto;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.parser.EpicNode;
import com.example.architecturemodel.model.parser.InitiativeNode;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.util.RoadmapParser;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Service for importing roadmap.md files from disk.
 *
 * Reads the roadmap markdown file, stores it as a versioned artifact,
 * and parses initiatives/epics into work items.
 *
 * V3 enhancements:
 * - Uses deterministic UUIDs for INITIATIVE/EPIC items based on normalized titles
 * - Upsert logic: updates existing items, inserts new ones
 * - Safe archive/delete: archives items with children, deletes empty items
 * - No longer blocks import when FEATURE/STORY exist (v1 block removed)
 *
 * Spec 2026-01-04: Roadmap Import UX Glue - Detailed counts tracking:
 * - Tracks inserted vs updated counts separately
 * - Tracks archived vs deleted counts separately
 * - Returns all 8 detailed counts in result DTO
 *
 * Spec 2026-01-05: Project Model with Active Project
 * - Resolves roadmap path from active project's parent folder
 * - Path: <project_parent_folder>/agent-os/product/roadmap.md
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@Slf4j
public class RoadmapImportService {

    private final WorkItemRepository workItemRepository;
    private final ProjectArtifactService projectArtifactService;
    private final RoadmapParser roadmapParser;
    private final ProjectService projectService;

    private static final String ROADMAP_RELATIVE_PATH = "agent-os/product/roadmap.md";
    private static final String ARTIFACT_TYPE = "ROADMAP_MD";
    private static final String ARTIFACT_SOURCE = "AGENT_OS";

    private static final String STATUS_PLANNED = "PLANNED";
    private static final String STATUS_ARCHIVED = "ARCHIVED";
    private static final String TYPE_INITIATIVE = "INITIATIVE";
    private static final String TYPE_EPIC = "EPIC";

    public RoadmapImportService(
            WorkItemRepository workItemRepository,
            ProjectArtifactService projectArtifactService,
            RoadmapParser roadmapParser,
            ProjectService projectService
    ) {
        this.workItemRepository = workItemRepository;
        this.projectArtifactService = projectArtifactService;
        this.roadmapParser = roadmapParser;
        this.projectService = projectService;
    }

    /**
     * Import a roadmap.md file from the active project's folder structure.
     *
     * Spec 2026-01-05: Resolves path from active project:
     * - Path: <project_parent_folder>/agent-os/product/roadmap.md
     * - Throws exception with clear message if no active project
     * - Throws exception if parent folder is null or blank
     *
     * V3 behavior:
     * - Uses deterministic IDs based on normalized titles
     * - Updates existing items (upsert), preserving createdAt
     * - Archives removed items with children, deletes those without
     * - Proceeds regardless of existing FEATURE/STORY items
     *
     * Spec 2026-01-04: Returns detailed counts (inserted/updated/archived/deleted).
     *
     * @param projectId the project ID to import into
     * @return result summary with detailed counts of imported items
     * @throws ResourceNotFoundException if no active project or roadmap.md file not found
     */
    @Transactional
    public RoadmapImportResultDto importFromAgentOsFile(UUID projectId) {
        log.info("Starting v3 roadmap import for project: {}", projectId);

        // Spec 2026-01-05: Get active project and resolve path
        ProjectEntity activeProject = projectService.getActiveProjectEntity();

        String parentFolder = activeProject.getProjectParentFolder();
        if (parentFolder == null || parentFolder.isBlank()) {
            throw new ResourceNotFoundException(
                    "Active project has no parent folder configured.");
        }

        // Resolve file path from active project's parent folder
        Path roadmapPath = Path.of(parentFolder).resolve(ROADMAP_RELATIVE_PATH);
        log.debug("Resolved roadmap path from active project: {}", roadmapPath.toAbsolutePath());

        // Read file content
        String markdownContent = readRoadmapFile(roadmapPath);

        // Store as artifact
        ProjectArtifactDto artifact = storeArtifact(projectId, markdownContent);

        // Parse roadmap with deterministic ID computation (v3)
        // Note: parser uses projectId.toString() for deterministic ID generation
        List<InitiativeNode> parsedInitiatives = roadmapParser.parse(markdownContent, projectId.toString());

        // Load existing INITIATIVE/EPIC items for this project
        Map<UUID, WorkItemEntity> existingItemsById = loadExistingItems(projectId);
        log.debug("Loaded {} existing INITIATIVE/EPIC items for project: {}", existingItemsById.size(), projectId);

        // Collect IDs from parsed roadmap
        Set<UUID> parsedIds = collectParsedIds(parsedInitiatives);
        log.debug("Parsed {} initiatives and epics from roadmap", parsedIds.size());

        // Upsert parsed items and track detailed counts
        UpsertResult upsertResult = upsertWorkItems(projectId, parsedInitiatives, existingItemsById);

        // Archive or delete removed items and track counts
        ArchiveDeleteResult archiveDeleteResult = archiveOrDeleteRemovedItems(
                projectId, existingItemsById, parsedIds);

        // Aggregate counts
        DetailedImportCounts initiativeCounts = upsertResult.initiativeCounts()
                .merge(archiveDeleteResult.initiativeCounts());
        DetailedImportCounts epicCounts = upsertResult.epicCounts()
                .merge(archiveDeleteResult.epicCounts());

        log.info("Roadmap import completed for project: {}. " +
                 "Initiatives: {} inserted, {} updated, {} archived, {} deleted. " +
                 "Epics: {} inserted, {} updated, {} archived, {} deleted.",
                projectId,
                initiativeCounts.inserted(), initiativeCounts.updated(),
                initiativeCounts.archived(), initiativeCounts.deleted(),
                epicCounts.inserted(), epicCounts.updated(),
                epicCounts.archived(), epicCounts.deleted());

        return RoadmapImportResultDto.withDetailedCounts(
                projectId,
                artifact.revision(),
                initiativeCounts,
                epicCounts
        );
    }

    /**
     * Read the roadmap file content.
     * Spec 2026-01-05: Error messages include resolved absolute path.
     */
    private String readRoadmapFile(Path roadmapPath) {
        if (!Files.exists(roadmapPath)) {
            throw new ResourceNotFoundException(
                    "Roadmap file not found at: " + roadmapPath.toAbsolutePath());
        }

        try {
            return Files.readString(roadmapPath, StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.error("Failed to read roadmap file at {}: {}", roadmapPath.toAbsolutePath(), e.getMessage(), e);
            throw new RuntimeException("Failed to read roadmap file at " + roadmapPath.toAbsolutePath() + ": " + e.getMessage(), e);
        }
    }

    /**
     * Store the roadmap content as a versioned artifact.
     */
    private ProjectArtifactDto storeArtifact(UUID projectId, String content) {
        ProjectArtifactDto artifactDto = new ProjectArtifactDto(
                null,
                projectId,
                ARTIFACT_TYPE,
                content,
                ARTIFACT_SOURCE,
                null,  // revision will be auto-calculated
                null   // createdAt will be set by service
        );

        return projectArtifactService.createArtifact(projectId, ARTIFACT_TYPE, artifactDto);
    }

    /**
     * Load existing INITIATIVE and EPIC items for the project.
     *
     * @param projectId the project ID
     * @return map of existing items by their ID
     */
    private Map<UUID, WorkItemEntity> loadExistingItems(UUID projectId) {
        List<WorkItemEntity> existingItems = workItemRepository.findByProjectIdAndTypeIn(
                projectId, List.of(TYPE_INITIATIVE, TYPE_EPIC));

        return existingItems.stream()
                .collect(Collectors.toMap(WorkItemEntity::getId, e -> e));
    }

    /**
     * Collect all IDs from the parsed initiatives and epics.
     *
     * @param initiatives the parsed initiatives
     * @return set of computed IDs from the parsed roadmap
     */
    private Set<UUID> collectParsedIds(List<InitiativeNode> initiatives) {
        Set<UUID> ids = new HashSet<>();

        for (InitiativeNode init : initiatives) {
            if (init.getComputedId() != null) {
                ids.add(init.getComputedId());
            }
            for (EpicNode epic : init.getEpics()) {
                if (epic.getComputedId() != null) {
                    ids.add(epic.getComputedId());
                }
            }
        }

        return ids;
    }

    /**
     * Result record for upsert operation with detailed counts.
     */
    private record UpsertResult(
        DetailedImportCounts initiativeCounts,
        DetailedImportCounts epicCounts
    ) {}

    /**
     * Upsert parsed initiatives and epics.
     * Updates if ID exists, inserts if new.
     * Tracks inserted vs updated counts separately.
     *
     * @param projectId the project ID
     * @param initiatives the parsed initiatives
     * @param existingItemsById map of existing items by ID
     * @return UpsertResult with detailed counts for initiatives and epics
     */
    private UpsertResult upsertWorkItems(UUID projectId, List<InitiativeNode> initiatives,
                                          Map<UUID, WorkItemEntity> existingItemsById) {
        DetailedImportCounts.Mutable initiativeCounts = DetailedImportCounts.mutable();
        DetailedImportCounts.Mutable epicCounts = DetailedImportCounts.mutable();

        for (InitiativeNode initNode : initiatives) {
            // Upsert initiative and track count
            boolean isNewInitiative = !existingItemsById.containsKey(initNode.getComputedId());
            WorkItemEntity initiative = upsertInitiative(projectId, initNode, existingItemsById);

            if (isNewInitiative) {
                initiativeCounts.incrementInserted();
            } else {
                initiativeCounts.incrementUpdated();
            }

            // Upsert epics for this initiative
            for (EpicNode epicNode : initNode.getEpics()) {
                boolean isNewEpic = !existingItemsById.containsKey(epicNode.getComputedId());
                upsertEpic(projectId, initiative.getId(), epicNode, existingItemsById);

                if (isNewEpic) {
                    epicCounts.incrementInserted();
                } else {
                    epicCounts.incrementUpdated();
                }
            }
        }

        return new UpsertResult(
            initiativeCounts.toImmutable(),
            epicCounts.toImmutable()
        );
    }

    /**
     * Upsert a single initiative.
     *
     * @param projectId the project ID
     * @param initNode the parsed initiative node
     * @param existingItemsById map of existing items
     * @return the saved initiative entity
     */
    private WorkItemEntity upsertInitiative(UUID projectId, InitiativeNode initNode,
                                             Map<UUID, WorkItemEntity> existingItemsById) {
        UUID computedId = initNode.getComputedId();
        WorkItemEntity existing = existingItemsById.get(computedId);

        if (existing != null) {
            // Update existing initiative
            log.debug("Updating existing initiative: {} (ID: {})", initNode.getTitle(), computedId);
            existing.setTitle(initNode.getTitle());
            existing.setSortOrder(initNode.getSortOrder());
            existing.setStatus(STATUS_PLANNED);  // Un-archive if was archived
            existing.setUpdatedAt(Instant.now());
            // createdAt preserved
            return workItemRepository.save(existing);
        } else {
            // Insert new initiative
            log.debug("Inserting new initiative: {} (ID: {})", initNode.getTitle(), computedId);
            WorkItemEntity newInit = WorkItemEntity.builder()
                    .id(computedId)
                    .projectId(projectId)
                    .type(TYPE_INITIATIVE)
                    .parentId(null)
                    .title(initNode.getTitle())
                    .description(null)
                    .status(STATUS_PLANNED)
                    .sortOrder(initNode.getSortOrder())
                    .createdAt(Instant.now())
                    .updatedAt(Instant.now())
                    .build();
            return workItemRepository.save(newInit);
        }
    }

    /**
     * Upsert a single epic.
     *
     * @param projectId the project ID
     * @param parentId the parent initiative ID
     * @param epicNode the parsed epic node
     * @param existingItemsById map of existing items
     * @return the saved epic entity
     */
    private WorkItemEntity upsertEpic(UUID projectId, UUID parentId, EpicNode epicNode,
                                       Map<UUID, WorkItemEntity> existingItemsById) {
        UUID computedId = epicNode.getComputedId();
        WorkItemEntity existing = existingItemsById.get(computedId);

        if (existing != null) {
            // Update existing epic
            log.debug("Updating existing epic: {} (ID: {})", epicNode.getTitle(), computedId);
            existing.setTitle(epicNode.getTitle());
            existing.setDescription(epicNode.getDescription());
            existing.setSortOrder(epicNode.getSortOrder());
            existing.setParentId(parentId);  // Update parent in case initiative changed
            existing.setStatus(STATUS_PLANNED);  // Un-archive if was archived
            existing.setUpdatedAt(Instant.now());
            // createdAt preserved
            return workItemRepository.save(existing);
        } else {
            // Insert new epic
            log.debug("Inserting new epic: {} (ID: {})", epicNode.getTitle(), computedId);
            WorkItemEntity newEpic = WorkItemEntity.builder()
                    .id(computedId)
                    .projectId(projectId)
                    .type(TYPE_EPIC)
                    .parentId(parentId)
                    .title(epicNode.getTitle())
                    .description(epicNode.getDescription())
                    .status(STATUS_PLANNED)
                    .sortOrder(epicNode.getSortOrder())
                    .createdAt(Instant.now())
                    .updatedAt(Instant.now())
                    .build();
            return workItemRepository.save(newEpic);
        }
    }

    /**
     * Result record for archive/delete operation with detailed counts.
     */
    private record ArchiveDeleteResult(
        DetailedImportCounts initiativeCounts,
        DetailedImportCounts epicCounts
    ) {}

    /**
     * Archive or delete items that are no longer in the parsed roadmap.
     *
     * Process order: epics first, then initiatives (to correctly evaluate children).
     * - If item has children: set status = ARCHIVED
     * - If item has no children: delete
     *
     * Tracks archived vs deleted counts separately.
     *
     * @param projectId the project ID
     * @param existingItemsById map of existing items before upsert
     * @param parsedIds set of IDs that are in the parsed roadmap
     * @return ArchiveDeleteResult with detailed counts for initiatives and epics
     */
    private ArchiveDeleteResult archiveOrDeleteRemovedItems(UUID projectId,
                                                             Map<UUID, WorkItemEntity> existingItemsById,
                                                             Set<UUID> parsedIds) {
        DetailedImportCounts.Mutable initiativeCounts = DetailedImportCounts.mutable();
        DetailedImportCounts.Mutable epicCounts = DetailedImportCounts.mutable();

        // Identify removed items
        List<WorkItemEntity> removedEpics = new ArrayList<>();
        List<WorkItemEntity> removedInitiatives = new ArrayList<>();

        for (Map.Entry<UUID, WorkItemEntity> entry : existingItemsById.entrySet()) {
            if (!parsedIds.contains(entry.getKey())) {
                WorkItemEntity item = entry.getValue();
                if (TYPE_EPIC.equals(item.getType())) {
                    removedEpics.add(item);
                } else if (TYPE_INITIATIVE.equals(item.getType())) {
                    removedInitiatives.add(item);
                }
            }
        }

        log.debug("Found {} removed epics and {} removed initiatives",
                removedEpics.size(), removedInitiatives.size());

        // Process removed epics first
        for (WorkItemEntity epic : removedEpics) {
            boolean wasArchived = archiveOrDeleteItem(projectId, epic);
            if (wasArchived) {
                epicCounts.incrementArchived();
            } else {
                epicCounts.incrementDeleted();
            }
        }

        // Then process removed initiatives
        for (WorkItemEntity initiative : removedInitiatives) {
            boolean wasArchived = archiveOrDeleteItem(projectId, initiative);
            if (wasArchived) {
                initiativeCounts.incrementArchived();
            } else {
                initiativeCounts.incrementDeleted();
            }
        }

        return new ArchiveDeleteResult(
            initiativeCounts.toImmutable(),
            epicCounts.toImmutable()
        );
    }

    /**
     * Archive or delete a single removed item based on child count.
     *
     * @param projectId the project ID
     * @param item the removed item to process
     * @return true if item was archived, false if deleted
     */
    private boolean archiveOrDeleteItem(UUID projectId, WorkItemEntity item) {
        long childCount = workItemRepository.countByProjectIdAndParentId(projectId, item.getId());

        if (childCount > 0) {
            // Archive: has children, cannot delete
            log.debug("Archiving {} with {} children: {} (ID: {})",
                    item.getType(), childCount, item.getTitle(), item.getId());
            item.setStatus(STATUS_ARCHIVED);
            item.setUpdatedAt(Instant.now());
            workItemRepository.save(item);
            return true;
        } else {
            // Delete: no children
            log.debug("Deleting {} with no children: {} (ID: {})",
                    item.getType(), item.getTitle(), item.getId());
            workItemRepository.delete(item);
            return false;
        }
    }
}
