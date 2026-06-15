package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.ProjectArtifactMapper;
import com.example.architecturemodel.mapper.ProjectMapper;
import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.SnapshotMeta;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.entity.ProjectArtifactRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for exporting project snapshots.
 *
 * Aggregates data from multiple services and repositories to produce
 * a complete JSON snapshot of the active project.
 *
 * Spec 2026-01-06: Project Snapshot JSON Export
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ProjectSnapshotService {

    private final ProjectService projectService;
    private final ProjectRepository projectRepository;
    private final ProjectMapper projectMapper;
    private final ModelService modelService;
    private final WorkItemService workItemService;
    private final ProjectArtifactRepository projectArtifactRepository;

    /**
     * Exports a complete snapshot of the active project.
     *
     * Aggregates:
     * - Project identity and configuration
     * - Architecture model (metaModel entities/relationships and diagrams)
     * - Work items (initiatives, epics, features, stories)
     * - Project artifacts (mission.md, roadmap.md, backlog.md)
     *
     * @return ProjectSnapshotDto containing all project data
     * @throws ResourceNotFoundException if no active project exists
     */
    @Transactional(readOnly = true)
    public ProjectSnapshotDto exportActiveProjectSnapshot() {
        log.info("Exporting active project snapshot");

        ProjectDto project = projectService.getActiveProject();
        log.debug("Active project found: {} (id={})", project.name(), project.id());

        return buildSnapshot(project);
    }

    /**
     * Exports a complete snapshot of a specific project by ID.
     *
     * Same aggregation as exportActiveProjectSnapshot but looks up the project
     * by its UUID instead of relying on the is_active flag. This is more robust
     * when the frontend already knows the project ID from its context.
     *
     * @param projectId The UUID of the project to export
     * @return ProjectSnapshotDto containing all project data
     * @throws ResourceNotFoundException if the project does not exist
     */
    @Transactional(readOnly = true)
    public ProjectSnapshotDto exportProjectById(UUID projectId) {
        log.info("Exporting project snapshot by id: {}", projectId);

        ProjectEntity projectEntity = projectRepository.findById(projectId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Project not found with id: " + projectId));

        ProjectDto project = projectMapper.toDto(projectEntity);
        log.debug("Project found: {} (id={})", project.name(), project.id());

        return buildSnapshot(project);
    }

    /**
     * Builds a complete project snapshot from a ProjectDto.
     * Shared logic used by both exportActiveProjectSnapshot and exportProjectById.
     */
    private ProjectSnapshotDto buildSnapshot(ProjectDto project) {
        // Load model using project name as filename
        ArchitectureModelDto model = loadModelOrDefault(project.name());

        // Fetch work items for project (using UUID directly)
        List<WorkItemDto> workItems = workItemService.getWorkItems(
            project.id(), null, null);
        log.debug("Loaded {} work items", workItems.size());

        // Fetch artifacts for project
        List<ProjectArtifactDto> artifacts = projectArtifactRepository
            .findByProjectIdOrderByCreatedAtDesc(project.id())
            .stream()
            .map(ProjectArtifactMapper::toDto)
            .collect(Collectors.toList());
        log.debug("Loaded {} artifacts", artifacts.size());

        // Build snapshot metadata
        SnapshotMeta meta = new SnapshotMeta(
            1,                          // snapshot_version (initial version)
            Instant.now(),              // exported_at (current UTC time)
            "PROJECT_SNAPSHOT"          // export_kind
        );

        // Assemble and return the complete snapshot
        ProjectSnapshotDto snapshot = new ProjectSnapshotDto(
            meta,
            project,
            model,
            workItems,
            artifacts
        );

        log.info("Project snapshot exported successfully for project: {}", project.name());
        return snapshot;
    }

    /**
     * Loads the architecture model for the given filename, or returns an empty default model
     * if the model file is not found.
     *
     * @param filename The model filename (project name)
     * @return The loaded model or an empty default model
     */
    private ArchitectureModelDto loadModelOrDefault(String filename) {
        try {
            ArchitectureModelDto model = modelService.loadModel(filename);
            log.debug("Loaded model for filename: {}", filename);
            return model;
        } catch (ResourceNotFoundException e) {
            log.debug("Model not found for filename: {}, returning empty default model", filename);
            return createEmptyModel();
        }
    }

    /**
     * Creates an empty/default ArchitectureModelDto.
     *
     * Used when no model file exists for the project.
     *
     * @return Empty ArchitectureModelDto with empty entity/relationship lists and no diagrams
     */
    private ArchitectureModelDto createEmptyModel() {
        // Create empty entities DTO with all 36 list fields
        // Note: dataEntityPoints added per Data Entity Point Superclass spec
        // Note: uiCharacteristics added per UI Characteristics spec
        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            List.of(), // businessUsers
            List.of(), // businessProcesses
            List.of(), // processActivities
            List.of(), // businessPoints
            List.of(), // applications
            List.of(), // appComponents
            List.of(), // services
            List.of(), // interfaces
            List.of(), // endpoints
            List.of(), // classes
            List.of(), // methods
            List.of(), // applicationPoints
            List.of(), // logicalDataEntities
            List.of(), // logicalDataAttributes
            List.of(), // physicalDataEntities
            List.of(), // physicalDataAttributes
            List.of(), // dataEntityPoints (Spec: Data Entity Point Superclass)
            List.of(), // interactions
            List.of(), // appBusinessPoints
            List.of(), // events
            List.of(), // states
            List.of(), // stateTransitions
            List.of(), // activities
            List.of(), // activityFlows
            List.of(), // activityPartitions
            List.of(), // uiScreens
            List.of(), // uiContracts
            List.of(), // uiComponents
            List.of(), // uiActions
            List.of(), // uiCharacteristics (Spec: UI Characteristics)
            List.of(), // businessLogics
            List.of(), // packageSets
            List.of(), // packages
            List.of(), // packageSetDefaultRules
            List.of(), // userJourneys
            List.of(), // activitySteps
            List.of(), // environments (Spec: Infrastructure Domain)
            List.of(), // cloudAccounts (Spec: Infrastructure Domain)
            List.of(), // locations (Spec: Infrastructure Domain)
            List.of(), // networks (Spec: Infrastructure Domain)
            List.of(), // subnets (Spec: Infrastructure Domain)
            List.of(), // computeClusters (Spec: Infrastructure Domain)
            List.of(), // computeResources (Spec: Infrastructure Domain)
            List.of(), // deploymentUnits (Spec: Infrastructure Domain)
            List.of(), // loadBalancers (Spec: Infrastructure Domain)
            List.of(), // listeners (Spec: Infrastructure Domain)
            List.of(), // dataStoreInstances (Spec: Infrastructure Domain)
            List.of(), // infrastructureResources (Spec: Infrastructure Domain)
            List.of(), // infrastructurePoints (Spec: Infrastructure Domain)
            List.of(), // iacSources (Spec: Infrastructure Terraform & Discovery Readiness)
            List.of()  // libraries (Spec: Library Backend Foundation)
        );

        // Create empty relationships DTO with all 9 list fields
        MetaModelRelationshipsDto relationships = new MetaModelRelationshipsDto(
            List.of(), // businessUserBusinessPoints
            List.of(), // applicationPointBusinessPoints
            List.of(), // logicalDataEntityRelationships
            List.of(), // logicalDataEntityPhysicalDataEntities
            List.of(), // logicalDataAttributePhysicalDataAttributes
            List.of(), // dataMovements
            List.of(), // interfaceLogicalEntities
            List.of(), // uiWorkflowTransitions
            List.of(), // applicationPointBusinessLogics
            List.of(), // userJourneyLinks
            List.of(), // resourceSubnetHostings (Spec: Infrastructure Domain)
            List.of(), // deploymentUnitComputeResources (Spec: Infrastructure Domain)
            List.of(), // loadBalancerResourceRoutes (Spec: Infrastructure Domain)
            List.of(), // applicationComputeDeployments (Spec: Infra Cross-Domain Integration)
            List.of(), // dataEntityDataStoreHostings (Spec: Infra Cross-Domain Integration)
            List.of(), // applicationInfrastructureResourceUses (Spec: Infra Cross-Domain Integration)
            List.of(), // applicationLoadBalancerExposures (Spec: Infra Cross-Domain Integration)
            List.of(), // iacResourceBindings (Spec: Infrastructure Terraform & Discovery Readiness)
            List.of()  // codeUnitDependencies (Spec: Library Backend Foundation)
        );

        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        return new ArchitectureModelDto(metaModel, List.of());
    }
}
