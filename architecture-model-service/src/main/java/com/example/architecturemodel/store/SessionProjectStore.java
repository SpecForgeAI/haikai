package com.example.architecturemodel.store;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.SnapshotMeta;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * In-memory session store for active project and snapshot.
 *
 * Spec 2026-01-22: Session-Backed Active Project
 *
 * This component provides a thread-safe singleton store that holds the active project
 * and its snapshot when the application is running in no-database mode.
 *
 * When include-database is false, the three core project endpoints delegate to this store:
 * - GET /api/projects/active -> getActiveProject()
 * - GET /api/projects/active/export -> getActiveSnapshot()
 * - POST /api/projects/import -> setActiveProject()
 *
 * Spec 2026-01-22: File Mode Blank Start UX
 * - Added ensureActiveProject() and ensureActiveSnapshot() methods
 * - Auto-initializes blank project and snapshot when none exists
 * - Enables immediate export without requiring import first
 *
 * Thread-safety: All public methods are synchronized to ensure safe concurrent access.
 * This is a simple approach suitable for a single-user local application.
 */
@Component
public class SessionProjectStore {

    private ProjectDto activeProject;
    private ProjectSnapshotDto activeSnapshot;

    /**
     * Sets both the active project and its snapshot.
     *
     * This method replaces any existing project and snapshot.
     *
     * @param project The project DTO to store
     * @param snapshot The project snapshot DTO to store
     */
    public synchronized void setActiveProject(ProjectDto project, ProjectSnapshotDto snapshot) {
        this.activeProject = project;
        this.activeSnapshot = snapshot;
    }

    /**
     * Gets the active project if one is set.
     *
     * @return Optional containing the active ProjectDto, or empty if none is set
     */
    public synchronized Optional<ProjectDto> getActiveProject() {
        return Optional.ofNullable(activeProject);
    }

    /**
     * Gets the active snapshot if one is set.
     *
     * @return Optional containing the active ProjectSnapshotDto, or empty if none is set
     */
    public synchronized Optional<ProjectSnapshotDto> getActiveSnapshot() {
        return Optional.ofNullable(activeSnapshot);
    }

    /**
     * Clears both the active project and snapshot.
     *
     * After calling this method, both getActiveProject() and getActiveSnapshot()
     * will return Optional.empty().
     */
    public synchronized void clear() {
        this.activeProject = null;
        this.activeSnapshot = null;
    }

    /**
     * Ensures a session project exists, creating a blank one if needed.
     *
     * Spec 2026-01-22: File Mode Blank Start UX
     *
     * If no active project exists, this method creates a blank "Untitled" project
     * and its corresponding blank snapshot. This enables the app to start in File Mode
     * with a valid project immediately available.
     *
     * @return The current active project (creating if necessary)
     */
    public synchronized ProjectDto ensureActiveProject() {
        if (activeProject == null) {
            activeProject = createBlankProject();
            activeSnapshot = createBlankSnapshot(activeProject);
        }
        return activeProject;
    }

    /**
     * Ensures a session snapshot exists, creating a blank one if needed.
     *
     * Spec 2026-01-22: File Mode Blank Start UX
     *
     * If no active snapshot exists, this method ensures a project exists (which
     * also creates the snapshot). This enables immediate export in File Mode.
     *
     * @return The current active snapshot (creating if necessary)
     */
    public synchronized ProjectSnapshotDto ensureActiveSnapshot() {
        if (activeSnapshot == null) {
            ensureActiveProject();
        }
        return activeSnapshot;
    }

    /**
     * Creates a blank project DTO with default values.
     *
     * Spec 2026-01-22: File Mode Blank Start UX
     *
     * @return A new ProjectDto with name="Untitled" and isActive=true
     */
    private ProjectDto createBlankProject() {
        return new ProjectDto(
            UUID.randomUUID(),
            "Untitled",           // Default name
            null,                 // projectParentFolder
            null,                 // projectHierarchy
            null,                 // organisationId
            null,                 // repoUrl
            true,                 // isActive
            Instant.now(),
            Instant.now()
        );
    }

    /**
     * Creates a blank snapshot DTO for the given project.
     *
     * Spec 2026-01-22: File Mode Blank Start UX
     *
     * The blank snapshot contains:
     * - Version 1 meta with "session" export kind
     * - The provided project
     * - Empty model (empty entities and relationships)
     * - Empty work items list
     * - Empty artifacts list
     *
     * @param project The project to associate with the snapshot
     * @return A new ProjectSnapshotDto with empty content
     */
    private ProjectSnapshotDto createBlankSnapshot(ProjectDto project) {
        // Create empty meta-model entities - 36 fields total
        MetaModelEntitiesDto emptyEntities = new MetaModelEntitiesDto(
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
            List.of(), // dataEntityPoints
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
            List.of(), // uiCharacteristics
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

        // Create empty meta-model relationships - 9 fields total
        MetaModelRelationshipsDto emptyRelationships = new MetaModelRelationshipsDto(
            List.of(), // businessUserToBusinessProcess
            List.of(), // businessProcessToApplication
            List.of(), // businessProcessToProcessActivity
            List.of(), // applicationToApplicationComponent
            List.of(), // applicationComponentToService
            List.of(), // serviceToInterface
            List.of(), // serviceToLogicalDataEntity
            List.of(), // serviceToPackage
            List.of(), // interfaceToEndpoint
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

        MetaModelDto emptyMetaModel = new MetaModelDto(emptyEntities, emptyRelationships);
        ArchitectureModelDto emptyModel = new ArchitectureModelDto(emptyMetaModel, List.of());

        SnapshotMeta meta = new SnapshotMeta(1, Instant.now(), "session");

        return new ProjectSnapshotDto(
            meta,
            project,
            emptyModel,
            List.of(),  // workItems
            List.of()   // artifacts
        );
    }
}
