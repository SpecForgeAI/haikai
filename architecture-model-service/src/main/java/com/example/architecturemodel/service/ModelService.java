package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.exception.ValidationException;
import com.example.architecturemodel.mapper.DiagramMapper;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.dto.entity.*;
import com.example.architecturemodel.model.dto.export.CanonicalDiagramExportDto;
import com.example.architecturemodel.model.dto.export.ProjectContextPackageDto;
import com.example.architecturemodel.model.dto.export.ProjectUIWorkflowContextPackageDto;
import com.example.architecturemodel.model.dto.export.ProjectUIScreenContextPackageDto;
import com.example.architecturemodel.model.dto.relationship.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.*;
import com.example.architecturemodel.repository.diagram.*;
import com.example.architecturemodel.repository.entity.*;
import com.example.architecturemodel.repository.relationship.*;
import com.example.architecturemodel.repository.targetmanifest.TargetManifestArtifactRepository;
import com.example.architecturemodel.mapper.discovery.EndpointDataEffectMapper;
import com.example.architecturemodel.model.dto.discovery.EndpointDataEffectDto;
import com.example.architecturemodel.repository.discovery.EndpointDataEffectRepository;
import com.example.architecturemodel.service.export.DiagramCanonicalizer;
import com.example.architecturemodel.service.export.DiagramSvgRenderer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ModelService {

    private final ModelFileRepository modelFileRepository;
    private final ProjectRepository projectRepository;
    private final ArchitectureRepository architectureRepository;

    // Entity repositories
    private final BusinessUserRepository businessUserRepository;
    private final BusinessProcessRepository businessProcessRepository;
    private final ProcessActivityRepository processActivityRepository;
    private final BusinessPointRepository businessPointRepository;
    private final ApplicationRepository applicationRepository;
    private final ApplicationComponentRepository applicationComponentRepository;
    private final ServiceRepository serviceRepository;
    // Target Manifest -> Service Association (Spec 2026-06-26, Task Group 2):
    // logical FK cleanup when a target-state services element is removed.
    private final TargetManifestArtifactRepository targetManifestArtifactRepository;
    private final InterfaceRepository interfaceRepository;
    private final EndpointRepository endpointRepository;
    private final ClassRepository classRepository;
    private final MethodRepository methodRepository;
    private final ApplicationPointRepository applicationPointRepository;
    private final LogicalDataEntityRepository logicalDataEntityRepository;
    private final LogicalDataAttributeRepository logicalDataAttributeRepository;
    private final PhysicalDataEntityRepository physicalDataEntityRepository;
    private final PhysicalDataAttributeRepository physicalDataAttributeRepository;
    private final AppBusinessPointRepository appBusinessPointRepository;
    private final InteractionRepository interactionRepository;
    private final EventRepository eventRepository;
    private final StateRepository stateRepository;
    private final StateTransitionRepository stateTransitionRepository;
    private final ActivityRepository activityRepository;
    private final ActivityFlowRepository activityFlowRepository;
    private final ActivityPartitionRepository activityPartitionRepository;
    private final UIScreenRepository uiScreenRepository;
    private final UIWorkflowTransitionRepository uiWorkflowTransitionRepository;
    // UI Architecture Increment 2 repositories
    private final UIContractRepository uiContractRepository;
    private final UIComponentRepository uiComponentRepository;
    private final UIActionRepository uiActionRepository;
    // UI Characteristics repository (Spec: UI Characteristics)
    private final UICharacteristicRepository uiCharacteristicRepository;
    // Behavioural domain - BusinessLogic entity
    private final BusinessLogicRepository businessLogicRepository;
    // PackageSet and Package repositories
    private final PackageSetRepository packageSetRepository;
    private final PackageRepository packageRepository;
    // Package Set Standards Import - Default Rules repository
    private final PackageSetDefaultRuleRepository packageSetDefaultRuleRepository;
    // Data Entity Point Superclass - repository for polymorphic entity wrappers
    private final DataEntityPointRepository dataEntityPointRepository;
    // User Journey Meta-Model Foundation - entity repositories
    private final UserJourneyRepository userJourneyRepository;
    private final ActivityStepRepository activityStepRepository;

    // Infrastructure Domain - entity repositories (Spec: 2026-05-04-infrastructure-domain-backend-foundation)
    // 12 typed entity repos + 1 polymorphic InfrastructurePoint repo. Additive: do not reorder existing fields above.
    private final EnvironmentRepository environmentRepository;
    private final CloudAccountRepository cloudAccountRepository;
    private final LocationRepository locationRepository;
    private final NetworkRepository networkRepository;
    private final SubnetRepository subnetRepository;
    private final ComputeClusterRepository computeClusterRepository;
    private final ComputeResourceRepository computeResourceRepository;
    private final DeploymentUnitRepository deploymentUnitRepository;
    private final LoadBalancerRepository loadBalancerRepository;
    private final ListenerRepository listenerRepository;
    private final DataStoreInstanceRepository dataStoreInstanceRepository;
    private final InfrastructureResourceRepository infrastructureResourceRepository;
    private final InfrastructurePointRepository infrastructurePointRepository;

    // Relationship repositories
    private final BusinessUserBusinessPointRepository businessUserBusinessPointRepository;
    private final ApplicationPointBusinessPointRepository applicationPointBusinessPointRepository;
    private final LogicalDataEntityRelationshipRepository logicalDataEntityRelationshipRepository;
    private final LogicalDataEntityPhysicalDataEntityRepository logicalDataEntityPhysicalDataEntityRepository;
    private final LogicalDataAttributePhysicalDataAttributeRepository logicalDataAttributePhysicalDataAttributeRepository;
    private final DataMovementRepository dataMovementRepository;
    private final InterfaceLogicalEntityRepository interfaceLogicalEntityRepository;
    // Endpoint->Data-Effect Call Graph for Discovery (Spec: 2026-05-29) -- Task Group 1
    private final EndpointDataEffectRepository endpointDataEffectRepository;
    // ApplicationPoint to BusinessLogic join table
    private final ApplicationPointBusinessLogicRepository applicationPointBusinessLogicRepository;
    // User Journey Links Meta-Model Foundation - relationship repository
    private final UserJourneyLinkRepository userJourneyLinkRepository;

    // Infrastructure Domain - relationship repositories (Spec: 2026-05-04-infrastructure-domain-backend-foundation)
    private final ResourceSubnetHostingRepository resourceSubnetHostingRepository;
    private final DeploymentUnitComputeResourceRepository deploymentUnitComputeResourceRepository;
    private final LoadBalancerResourceRouteRepository loadBalancerResourceRouteRepository;

    // Infrastructure Cross-Domain Relationships (Spec: 2026-05-05-infrastructure-cross-domain-integration)
    private final ApplicationComputeDeploymentRepository applicationComputeDeploymentRepository;
    private final DataEntityDataStoreHostingRepository dataEntityDataStoreHostingRepository;
    private final ApplicationInfrastructureResourceUseRepository applicationInfrastructureResourceUseRepository;
    private final ApplicationLoadBalancerExposureRepository applicationLoadBalancerExposureRepository;

    // Infrastructure Terraform & Discovery Readiness (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
    private final IaCSourceRepository iacSourceRepository;
    private final IaCResourceBindingRepository iacResourceBindingRepository;

    // Library Backend Foundation (Spec: 2026-05-05-library-backend-foundation)
    private final LibraryRepository libraryRepository;
    private final CodeUnitDependencyRepository codeUnitDependencyRepository;

    // Discovery Run hotfix companion (changeset 126): used by
    // saveModelInternal to capture-and-restore discovery_run.service_id
    // across the services delete-and-re-insert cycle so the "Service deleted"
    // chip predicate doesn't trip on every Save All Candidates.
    private final DiscoveryRunRepository discoveryRunRepository;

    // Diagram repositories
    private final DiagramRepository diagramRepository;
    private final DiagramNodeRepository diagramNodeRepository;
    private final DiagramEdgeRepository diagramEdgeRepository;
    private final DiagramInteractionEdgeRepository diagramInteractionEdgeRepository;
    private final DiagramDecorationRepository diagramDecorationRepository;

    // Mappers
    private final EntityMapper entityMapper;
    private final DiagramMapper diagramMapper;

    // Export utilities
    private final DiagramCanonicalizer diagramCanonicalizer;
    private final DiagramSvgRenderer diagramSvgRenderer;

    // Project service for export operations
    private final ProjectService projectService;

    // Data Entity Point Superclass - ensure service for automatic point creation
    private final DataEntityPointEnsureService dataEntityPointEnsureService;

    // ============================================================================
    // File-Level Operations
    // ============================================================================

    @Transactional(readOnly = true)
    public List<ModelFileSummaryDto> getModelFilenames() {
        return modelFileRepository.findAll().stream()
            .map(this::toSummaryDto)
            .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public ArchitectureModelDto loadModel(String filename) {
        ModelFileEntity modelFile;

        if (filename != null && !filename.isBlank()) {
            modelFile = modelFileRepository.findByFilenameIgnoreCase(filename)
                .orElseThrow(() -> new ResourceNotFoundException("Model file not found: " + filename));
        } else {
            // Try to find default, otherwise get the first one
            modelFile = modelFileRepository.findByIsDefaultTrue()
                .orElseGet(() -> modelFileRepository.findAll().stream()
                    .findFirst()
                    .orElseThrow(() -> new ResourceNotFoundException("No model files exist")));
        }

        return loadModelByFileId(modelFile.getId());
    }

    /**
     * Load a model by (project UUID, architecture UUID).
     *
     * Uses the (project_id, architecture_id) pair on model_files to find the
     * associated model file, then loads the full architecture model from that
     * file. If no model file exists yet for the requested pair (e.g. a newly
     * created project with no saved architecture data), returns an empty default
     * model instead of failing -- this preserves the pre-spec contract for
     * brand-new projects.
     *
     * Spec: Multi-Architecture Plumbing (Spec #1).
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @return the full architecture model, or an empty default model if none exists
     */
    @Transactional(readOnly = true)
    public ArchitectureModelDto loadModelByProjectIdAndArchitectureId(UUID projectId,
                                                                      UUID architectureId) {
        return modelFileRepository.findByProjectIdAndArchitectureId(projectId, architectureId)
            .map(modelFile -> loadModelByFileId(modelFile.getId()))
            .orElseGet(() -> {
                log.info("No model file found for project {} architecture {} - returning empty default model",
                    projectId, architectureId);
                return createEmptyModel();
            });
    }

    /**
     * Create an empty default ArchitectureModelDto with all entity and relationship
     * lists initialized to empty. Used as a fallback when a project has no saved
     * model data yet.
     */
    private ArchitectureModelDto createEmptyModel() {
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

    /**
     * Save a model by filename only (legacy entry point).
     *
     * <p>This is the legacy single-architecture save path used by callers
     * that do NOT have an architecture context (notably the
     * {@code PUT /api/model?filename=...} controller route and
     * {@code ProjectSnapshotImportService}). Internally it resolves the
     * (projectId, architectureId) pair to use as follows:</p>
     *
     * <ol>
     *   <li>Look up the active project via
     *       {@code projectRepository.findByIsActiveTrue()}.</li>
     *   <li>If an active project is present, look up its oldest non-archived
     *       architecture via
     *       {@link ArchitectureRepository#findFirstByProjectIdAndArchivedFalseOrderByCreatedAtAsc}
     *       (the canonical "Default" per spec #1 decision #6).</li>
     *   <li>If both are present, delegate to
     *       {@link #saveModel(String, UUID, UUID, ArchitectureModelDto)} so
     *       the architecture-scoped lookup picks the correct row even if
     *       multiple model_files rows share the filename across architectures
     *       (post-clone scenario from spec #6 / changeset 096).</li>
     *   <li>If no active project or no architecture is resolvable, fall back
     *       to the legacy global {@code findByFilename} lookup -- this
     *       preserves the pre-multi-architecture behaviour for tests and
     *       File-mode callers.</li>
     * </ol>
     *
     * <p>Spec: Cross-Architecture Save Bug Fix (Spec 2026-05-01).
     * Without this disambiguation, after a clone two model_files rows share
     * the same filename and {@code findByFilename(filename)} non-deterministically
     * returns one of them -- the resulting save corrupts whichever architecture
     * happens to be on the wrong side of that lookup.</p>
     */
    @Transactional
    public ModelFileSummaryDto saveModel(String filename, ArchitectureModelDto model) {
        UUID projectId = projectRepository.findByIsActiveTrue()
            .map(ProjectEntity::getId)
            .orElse(null);
        UUID architectureId = null;
        if (projectId != null) {
            architectureId = architectureRepository
                .findFirstByProjectIdAndArchivedFalseOrderByCreatedAtAsc(projectId)
                .map(ArchitectureEntity::getId)
                .orElse(null);
        }
        if (projectId != null && architectureId != null) {
            return saveModel(filename, projectId, architectureId, model);
        }
        // Legacy fallback: no active project or no architecture row resolvable
        // (e.g. unit tests that mock projectRepository.findByIsActiveTrue() ->
        // empty). Use the global findByFilename path; this is non-deterministic
        // post-clone but matches pre-multi-architecture behaviour.
        return saveModelInternal(filename, projectId, architectureId,
            modelFileRepository.findByFilename(filename), model);
    }

    /**
     * Save a model by (filename, projectId, architectureId) triple.
     *
     * <p>Architecture-aware save path. Uses
     * {@link ModelFileRepository#findByFilenameAndArchitectureId(String, UUID)}
     * so post-clone duplicates are disambiguated correctly. New rows are
     * created with the supplied {@code projectId} and {@code architectureId}
     * already populated (no need for the post-save self-healing branch).</p>
     *
     * <p>Spec: Cross-Architecture Save Bug Fix (Spec 2026-05-01).</p>
     *
     * @param filename       the filename to save under
     * @param projectId      the owning project UUID (non-null)
     * @param architectureId the owning architecture UUID (non-null)
     * @param model          the model payload
     * @return summary DTO for the saved model file
     */
    @Transactional
    public ModelFileSummaryDto saveModel(String filename,
                                         UUID projectId,
                                         UUID architectureId,
                                         ArchitectureModelDto model) {
        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("filename is required");
        }
        if (projectId == null) {
            throw new IllegalArgumentException("projectId is required");
        }
        if (architectureId == null) {
            throw new IllegalArgumentException("architectureId is required");
        }
        Optional<ModelFileEntity> existing = modelFileRepository
            .findByFilenameAndArchitectureId(filename, architectureId);
        return saveModelInternal(filename, projectId, architectureId, existing, model);
    }

    /**
     * Internal save implementation shared by both the legacy and the
     * architecture-aware entry points. The {@code existing} parameter is the
     * already-resolved row (or empty if a fresh row should be created); the
     * caller is responsible for the architecture-aware lookup so this method
     * never has to choose between {@code findByFilename} and
     * {@code findByFilenameAndArchitectureId}.
     *
     * <p>When the caller supplies non-null {@code projectId} /
     * {@code architectureId}, those are stamped onto a freshly-created row;
     * existing rows are also self-healed if their values disagree (which
     * should not happen post-spec #6 but is defensive).</p>
     */
    private ModelFileSummaryDto saveModelInternal(String filename,
                                                  UUID projectId,
                                                  UUID architectureId,
                                                  Optional<ModelFileEntity> existing,
                                                  ArchitectureModelDto model) {
        // Find or create the model file
        ModelFileEntity modelFile = existing.orElseGet(() -> {
            ModelFileEntity newFile = ModelFileEntity.builder()
                .id(UUID.randomUUID().toString())
                .filename(filename)
                .projectId(projectId)
                .architectureId(architectureId)
                .isDefault(false)
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();
            return modelFileRepository.save(newFile);
        });

        String modelFileId = modelFile.getId();

        // Capture discovery_run.service_id pairs before the services
        // delete-and-re-insert cycle. The FK constraint
        // `discovery_run_service_id_fkey` is ON DELETE SET NULL (changeset
        // 126); Postgres fires the referential action immediately at DELETE
        // time even with DEFERRABLE INITIALLY DEFERRED (which only defers the
        // *check*, not the *action*). Without this capture-and-restore, every
        // Save All Candidates orphans every service-scoped run -- the
        // frontend's "Service deleted" chip predicate then trips on the
        // nulled FK even though the service was immediately re-inserted with
        // the same id.
        Map<UUID, String> runServiceIdsToRestore =
            captureDiscoveryRunServiceFKs(modelFileId);

        // Snapshot every service id present BEFORE the delete-and-re-insert
        // cycle so we can detect which services this save REMOVED and null
        // their dependent target-manifest logical FKs (Spec 2026-06-26 Task
        // Group 2, FR6 -- there is no physical FK, so cleanup is applied here).
        Set<String> preSaveServiceIds = serviceRepository.findByModelFileId(modelFileId)
            .stream()
            .map(ServiceEntity::getId)
            .filter(java.util.Objects::nonNull)
            .collect(Collectors.toSet());

        // Truncate & Insert strategy: Delete all existing data for this model file
        deleteAllDataForModelFile(modelFileId);

        // Self-heal project / architecture linkage on every save (preserves the
        // pre-spec contract for legacy rows that may have null FK columns).
        if (projectId != null
                && (modelFile.getProjectId() == null || !modelFile.getProjectId().equals(projectId))) {
            modelFile.setProjectId(projectId);
            log.debug("Linked model file '{}' to project {}", filename, projectId);
        } else if (projectId == null) {
            // Legacy fallback path -- preserve old behaviour (look up active project).
            projectRepository.findByIsActiveTrue().ifPresent(activeProject -> {
                if (modelFile.getProjectId() == null
                        || !modelFile.getProjectId().equals(activeProject.getId())) {
                    modelFile.setProjectId(activeProject.getId());
                    log.debug("Linked model file '{}' to project {} ({})",
                        filename, activeProject.getName(), activeProject.getId());
                }
            });
        }
        if (architectureId != null
                && (modelFile.getArchitectureId() == null
                    || !modelFile.getArchitectureId().equals(architectureId))) {
            modelFile.setArchitectureId(architectureId);
            log.debug("Linked model file '{}' to architecture {}", filename, architectureId);
        }

        // Update timestamp
        modelFile.setUpdatedAt(OffsetDateTime.now());
        modelFileRepository.save(modelFile);

        // Insert all entities, relationships, and diagrams
        MetaModelEntitiesDto entities = model.metaModel().entities();
        log.debug("saveModel '{}': saving entities - applications={}, appComponents={}, services={}, interfaces={}, endpoints={}, logicalDataEntities={}, physicalDataEntities={}, businessLogics={}",
            filename,
            entities.applications() != null ? entities.applications().size() : 0,
            entities.appComponents() != null ? entities.appComponents().size() : 0,
            entities.services() != null ? entities.services().size() : 0,
            entities.interfaces() != null ? entities.interfaces().size() : 0,
            entities.endpoints() != null ? entities.endpoints().size() : 0,
            entities.logicalDataEntities() != null ? entities.logicalDataEntities().size() : 0,
            entities.physicalDataEntities() != null ? entities.physicalDataEntities().size() : 0,
            entities.businessLogics() != null ? entities.businessLogics().size() : 0);
        saveEntities(entities, modelFileId);

        // Restore captured discovery_run.service_id pairs now that the
        // services table has been re-populated. The FK check is deferred to
        // commit (DEFERRABLE INITIALLY DEFERRED) so we only restore for
        // service IDs that still exist in the inbound model -- a service
        // genuinely removed from the model has no row now, and the run stays
        // orphaned (the chip's "Service deleted" state is then correct).
        Set<String> survivingServiceIds = entities.services() != null
            ? entities.services().stream()
                .map(s -> s.id())
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toSet())
            : Set.of();
        restoreDiscoveryRunServiceFKs(runServiceIdsToRestore, survivingServiceIds);

        // Logical FK cleanup: any service present before this save but no
        // longer surviving was removed (archived) -- null its dependent
        // target-manifest FKs so they never dangle.
        nullManifestFksForRemovedServices(preSaveServiceIds, survivingServiceIds);

        MetaModelRelationshipsDto relationships = model.metaModel().relationships();
        log.debug("saveModel '{}': saving relationships - dataMovements={}",
            filename,
            relationships != null && relationships.dataMovements() != null ? relationships.dataMovements().size() : 0);
        saveRelationships(relationships, modelFileId);
        saveDiagrams(model.diagrams(), modelFileId);

        log.debug("saveModel '{}': save completed for modelFileId={}", filename, modelFileId);
        return toSummaryDto(modelFile);
    }

    @Transactional
    public void deleteModel(String filename) {
        ModelFileEntity modelFile = modelFileRepository.findByFilename(filename)
            .orElseThrow(() -> new ResourceNotFoundException("Model file not found: " + filename));

        // Due to ON DELETE CASCADE, deleting the model file will cascade to all related data
        modelFileRepository.delete(modelFile);
    }

    // ============================================================================
    // Export Operations
    // ============================================================================

    /**
     * Loads project context for Agent OS consumption.
     *
     * Returns a ProjectContextPackageDto containing:
     * - project_id: the filename
     * - metaModel: full meta-model data
     * - diagrams: only "General" diagrams (case-insensitive), each canonicalized
     *
     * @param filename The model file to load
     * @return ProjectContextPackageDto with filtered and canonicalized diagrams
     * @throws IllegalArgumentException if filename is blank
     * @throws ResourceNotFoundException if model file not found
     */
    @Transactional(readOnly = true)
    public ProjectContextPackageDto loadProjectContext(String filename) {
        log.debug("Loading project context for: {}", filename);

        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Filename is required");
        }

        ArchitectureModelDto model = loadModel(filename);

        // Filter to only "General" diagrams (case-insensitive)
        List<DiagramDto> generalDiagrams = model.diagrams().stream()
            .filter(d -> d.diagramType() != null && d.diagramType().equalsIgnoreCase("General"))
            .map(diagramCanonicalizer::canonicalize)
            .collect(Collectors.toList());

        log.debug("Filtered {} General diagrams from {} total diagrams",
            generalDiagrams.size(), model.diagrams().size());

        return new ProjectContextPackageDto(
            filename,
            model.metaModel(),
            generalDiagrams
        );
    }

    /**
     * Loads UI workflow context for Agent OS consumption.
     *
     * Returns a ProjectUIWorkflowContextPackageDto containing:
     * - project_id: the filename
     * - ui_screens: all UIScreen entities
     * - ui_workflow_transitions: all UIWorkflowTransition relationships
     * - diagrams: only "UI_Workflow" diagrams (case-insensitive), each canonicalized
     *
     * @param filename The model file to load
     * @return ProjectUIWorkflowContextPackageDto with filtered and canonicalized diagrams
     * @throws IllegalArgumentException if filename is blank
     * @throws ResourceNotFoundException if model file not found
     */
    @Transactional(readOnly = true)
    public ProjectUIWorkflowContextPackageDto loadProjectUIWorkflowContext(String filename) {
        log.debug("Loading UI workflow context for: {}", filename);

        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Filename is required");
        }

        ArchitectureModelDto model = loadModel(filename);

        // Filter to only "UI_Workflow" diagrams (case-insensitive)
        List<DiagramDto> uiWorkflowDiagrams = model.diagrams().stream()
            .filter(d -> d.diagramType() != null && d.diagramType().equalsIgnoreCase("UI_Workflow"))
            .map(diagramCanonicalizer::canonicalize)
            .collect(Collectors.toList());

        log.debug("Filtered {} UI_Workflow diagrams from {} total diagrams",
            uiWorkflowDiagrams.size(), model.diagrams().size());

        // Get UI screens and workflow transitions from the meta-model
        List<UIScreenDto> uiScreens = model.metaModel().entities().uiScreens() != null
            ? model.metaModel().entities().uiScreens()
            : List.of();

        List<UIWorkflowTransitionDto> uiWorkflowTransitions = model.metaModel().relationships().uiWorkflowTransitions() != null
            ? model.metaModel().relationships().uiWorkflowTransitions()
            : List.of();

        return new ProjectUIWorkflowContextPackageDto(
            filename,
            uiScreens,
            uiWorkflowTransitions,
            uiWorkflowDiagrams
        );
    }

    /**
     * Loads UI screen context for Agent OS consumption.
     *
     * Returns a ProjectUIScreenContextPackageDto containing:
     * - project_id: the filename
     * - ui_screens: all UIScreen entities
     * - ui_components: all UIComponent entities
     * - ui_actions: all UIAction entities
     * - ui_contracts: all UIContract entities
     * - diagrams: only "UI_SCREEN" diagrams (case-insensitive), each canonicalized
     *
     * @param filename The model file to load
     * @return ProjectUIScreenContextPackageDto with filtered and canonicalized diagrams
     * @throws IllegalArgumentException if filename is blank
     * @throws ResourceNotFoundException if model file not found
     */
    @Transactional(readOnly = true)
    public ProjectUIScreenContextPackageDto loadProjectUIScreenContext(String filename) {
        log.debug("Loading UI screen context for: {}", filename);

        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Filename is required");
        }

        ArchitectureModelDto model = loadModel(filename);

        // Filter to only "UI_SCREEN" diagrams (case-insensitive)
        List<DiagramDto> uiScreenDiagrams = model.diagrams().stream()
            .filter(d -> d.diagramType() != null && d.diagramType().equalsIgnoreCase("UI_SCREEN"))
            .map(diagramCanonicalizer::canonicalize)
            .collect(Collectors.toList());

        log.debug("Filtered {} UI_SCREEN diagrams from {} total diagrams",
            uiScreenDiagrams.size(), model.diagrams().size());

        // Get UI entities from the meta-model
        List<UIScreenDto> uiScreens = model.metaModel().entities().uiScreens() != null
            ? model.metaModel().entities().uiScreens()
            : List.of();

        List<UIComponentDto> uiComponents = model.metaModel().entities().uiComponents() != null
            ? model.metaModel().entities().uiComponents()
            : List.of();

        List<UIActionDto> uiActions = model.metaModel().entities().uiActions() != null
            ? model.metaModel().entities().uiActions()
            : List.of();

        List<UIContractDto> uiContracts = model.metaModel().entities().uiContracts() != null
            ? model.metaModel().entities().uiContracts()
            : List.of();

        return new ProjectUIScreenContextPackageDto(
            filename,
            uiScreens,
            uiComponents,
            uiActions,
            uiContracts,
            uiScreenDiagrams
        );
    }

    /**
     * Exports a single diagram in canonical JSON format.
     *
     * Returns a CanonicalDiagramExportDto containing:
     * - project_id: the filename
     * - diagram_id: the requested diagram id
     * - diagram_type: the type of the diagram
     * - canonical: the canonicalized diagram DTO
     *
     * @param filename The model file containing the diagram
     * @param diagramId The id of the diagram to export
     * @return CanonicalDiagramExportDto with canonicalized diagram
     * @throws IllegalArgumentException if filename or diagramId is blank
     * @throws ResourceNotFoundException if model file or diagram not found
     */
    @Transactional(readOnly = true)
    public CanonicalDiagramExportDto exportCanonicalDiagram(String filename, String diagramId) {
        log.debug("Exporting canonical diagram {} from {}", diagramId, filename);

        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Filename is required");
        }
        if (diagramId == null || diagramId.isBlank()) {
            throw new IllegalArgumentException("Diagram ID is required");
        }

        ArchitectureModelDto model = loadModel(filename);

        // Find diagram by id
        DiagramDto diagram = model.diagrams().stream()
            .filter(d -> diagramId.equals(d.id()))
            .findFirst()
            .orElseThrow(() -> new ResourceNotFoundException("Diagram not found: " + diagramId));

        // Canonicalize the diagram
        DiagramDto canonicalDiagram = diagramCanonicalizer.canonicalize(diagram);

        return new CanonicalDiagramExportDto(
            filename,
            diagramId,
            diagram.diagramType(),
            canonicalDiagram
        );
    }

    // ============================================================================
    // Diagram SVG Export Operations
    // Spec: Export Diagrams as SVG
    // ============================================================================

    /**
     * Exports a single diagram as an SVG file.
     *
     * Writes the SVG to [projectParentFolder]/exports/diagrams/ with filename pattern:
     * {projectNameNorm}_{diagramNameNorm}_{timestamp}.svg
     *
     * @param filename The model file containing the diagram
     * @param diagramId The id of the diagram to export
     * @return Path to the written SVG file
     * @throws IOException if file operations fail
     */
    @Transactional(readOnly = true)
    public Path exportDiagramAsSvg(String filename, String diagramId) throws IOException {
        log.debug("Exporting diagram {} as SVG from {}", diagramId, filename);

        CanonicalDiagramExportDto canonical = exportCanonicalDiagram(filename, diagramId);

        ProjectDto project = projectService.getActiveProject();
        String projectName = normalizeName(project.name());
        String diagramName = normalizeName(canonical.canonical().name());
        String timestamp = LocalDateTime.now()
            .format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"));

        String svgFileName = projectName + "_" + diagramName + "_" + timestamp + ".svg";

        Path exportDir = Paths.get(project.projectParentFolder())
            .resolve("exports")
            .resolve("diagrams");
        Files.createDirectories(exportDir);

        Path svgPath = exportDir.resolve(svgFileName);
        String svg = diagramSvgRenderer.renderToSvg(canonical.canonical());
        Files.writeString(svgPath, svg);

        log.info("Exported diagram SVG to: {}", svgPath);
        return svgPath;
    }

    /**
     * Result record for exporting all diagrams as a ZIP.
     */
    public record ExportAllDiagramsZip(byte[] zipBytes, String downloadFileName) {}

    /**
     * Exports all diagrams from a model as SVG files in a ZIP archive.
     *
     * Writes individual SVG files to [projectParentFolder]/exports/diagrams/ and
     * returns a ZIP containing all the SVGs.
     *
     * @param filename The model file containing the diagrams
     * @return ExportAllDiagramsZip with ZIP bytes and download filename
     * @throws IOException if file operations fail
     */
    @Transactional(readOnly = true)
    public ExportAllDiagramsZip exportAllDiagramsToZip(String filename) throws IOException {
        log.debug("Exporting all diagrams as ZIP from {}", filename);

        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Filename is required");
        }

        ArchitectureModelDto model = loadModel(filename);
        ProjectDto project = projectService.getActiveProject();
        String projectName = normalizeName(project.name());
        String timestamp = LocalDateTime.now()
            .format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"));
        String zipName = projectName + "_all-diagrams_" + timestamp + ".zip";

        Path exportDir = Paths.get(project.projectParentFolder())
            .resolve("exports")
            .resolve("diagrams");
        Files.createDirectories(exportDir);

        byte[] zipBytes;
        try (ByteArrayOutputStream baos = new ByteArrayOutputStream();
             ZipOutputStream zos = new ZipOutputStream(baos)) {

            for (DiagramDto diagram : model.diagrams()) {
                DiagramDto canonical = diagramCanonicalizer.canonicalize(diagram);
                String diagramName = normalizeName(canonical.name());
                String svgFileName = projectName + "_" + diagramName + "_" + timestamp + ".svg";

                String svg = diagramSvgRenderer.renderToSvg(canonical);

                // Write to disk
                Path svgPath = exportDir.resolve(svgFileName);
                Files.writeString(svgPath, svg);
                log.debug("Wrote SVG to: {}", svgPath);

                // Add to ZIP
                ZipEntry entry = new ZipEntry(svgFileName);
                zos.putNextEntry(entry);
                byte[] svgByteArray = svg.getBytes(StandardCharsets.UTF_8);
                zos.write(svgByteArray);
                zos.closeEntry();
            }

            zos.finish();
            zipBytes = baos.toByteArray();
        }

        log.info("Exported {} diagrams as ZIP: {}", model.diagrams().size(), zipName);
        return new ExportAllDiagramsZip(zipBytes, zipName);
    }

    /**
     * Normalizes a name for use in filenames.
     * Replaces whitespace with hyphens.
     */
    private String normalizeName(String name) {
        if (name == null) return "unnamed";
        return name.trim().replaceAll("\\s+", "-");
    }

    /**
     * Retrieves the UI_SCREEN diagram associated with a given UIScreen.
     *
     * Searches for a diagram where:
     * - diagramType is "UI_SCREEN" (case-insensitive)
     * - typedContent.screen_id matches the provided screenId
     *
     * @param filename The model file to search
     * @param screenId The UIScreen entity ID
     * @return The matching DiagramDto
     * @throws IllegalArgumentException if filename or screenId is blank
     * @throws ResourceNotFoundException if no matching diagram found
     */
    @Transactional(readOnly = true)
    public DiagramDto getUIScreenDiagram(String filename, String screenId) {
        log.debug("Getting UI_SCREEN diagram for screen {} from {}", screenId, filename);

        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Filename is required");
        }
        if (screenId == null || screenId.isBlank()) {
            throw new IllegalArgumentException("Screen ID is required");
        }

        ArchitectureModelDto model = loadModel(filename);

        // Find diagram by diagramType="UI_SCREEN" and typedContent.screen_id=screenId
        return model.diagrams().stream()
            .filter(d -> d.diagramType() != null && d.diagramType().equalsIgnoreCase("UI_SCREEN"))
            .filter(d -> {
                Map<String, Object> typedContent = d.typedContent();
                if (typedContent == null) return false;
                Object contentScreenId = typedContent.get("screen_id");
                return screenId.equals(contentScreenId);
            })
            .findFirst()
            .orElseThrow(() -> new ResourceNotFoundException(
                "No UI_SCREEN diagram found for screen: " + screenId));
    }

    // ============================================================================
    // Helper Methods - Load
    // ============================================================================

    private ArchitectureModelDto loadModelByFileId(String modelFileId) {
        MetaModelEntitiesDto entities = loadEntities(modelFileId);
        MetaModelRelationshipsDto relationships = loadRelationships(modelFileId);
        List<DiagramDto> diagrams = loadDiagrams(modelFileId);

        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        return new ArchitectureModelDto(metaModel, diagrams);
    }

    private MetaModelEntitiesDto loadEntities(String modelFileId) {
        return new MetaModelEntitiesDto(
            businessUserRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            businessProcessRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            processActivityRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            businessPointRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            applicationRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            applicationComponentRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            serviceRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            interfaceRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            endpointRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            classRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            methodRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            applicationPointRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            logicalDataEntityRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            logicalDataAttributeRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            physicalDataEntityRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            physicalDataAttributeRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // Data Entity Point Superclass - load data entity points
            // Spec: Data Entity Point Superclass
            dataEntityPointRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            interactionRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            appBusinessPointRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            eventRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            stateRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            stateTransitionRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            activityRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            activityFlowRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            activityPartitionRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            uiScreenRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // UI Architecture Increment 2 entities
            uiContractRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            uiComponentRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            uiActionRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // UI Characteristics - load characteristics (Spec: UI Characteristics)
            uiCharacteristicRepository.findByModelFileId(modelFileId).stream()
                .map(e -> new UICharacteristicDto(
                    e.getId(),
                    e.getUiId(),
                    e.getType(),
                    e.getKey(),
                    e.getName(),
                    e.getDescription(),
                    e.getEvidence()
                )).collect(Collectors.toList()),
            // Behavioural domain - BusinessLogic entities
            businessLogicRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // PackageSet and Package entities
            packageSetRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            packageRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // Package Set Standards Import - Default Rules (Spec: Iteration 6)
            // Loaded ordered by priority descending for correct rule matching
            packageSetDefaultRuleRepository.findByModelFileIdOrderByPriorityDesc(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // User Journey Meta-Model Foundation - load user journeys and activity steps
            userJourneyRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            activityStepRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // Infrastructure Domain (Spec: 2026-05-04-infrastructure-domain-backend-foundation)
            // Task Group 7: real repository.findByModelFileId calls replacing placeholders.
            environmentRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            cloudAccountRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            locationRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            networkRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            subnetRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            computeClusterRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            computeResourceRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            deploymentUnitRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            loadBalancerRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            listenerRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            dataStoreInstanceRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            infrastructureResourceRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            infrastructurePointRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // Infrastructure Terraform & Discovery Readiness (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
            iacSourceRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // Library Backend Foundation (Spec: 2026-05-05-library-backend-foundation)
            libraryRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList())
        );
    }

    private MetaModelRelationshipsDto loadRelationships(String modelFileId) {
        return new MetaModelRelationshipsDto(
            businessUserBusinessPointRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            applicationPointBusinessPointRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            logicalDataEntityRelationshipRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            logicalDataEntityPhysicalDataEntityRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            logicalDataAttributePhysicalDataAttributeRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            dataMovementRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            interfaceLogicalEntityRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            uiWorkflowTransitionRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // ApplicationPoint to BusinessLogic join table
            applicationPointBusinessLogicRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // User Journey Links Meta-Model Foundation
            userJourneyLinkRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // Infrastructure Domain Relationships (Spec: 2026-05-04-infrastructure-domain-backend-foundation)
            // Task Group 7: real repository.findByModelFileId calls replacing placeholders.
            resourceSubnetHostingRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            deploymentUnitComputeResourceRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            loadBalancerResourceRouteRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // Infrastructure Cross-Domain Relationships (Spec: 2026-05-05-infrastructure-cross-domain-integration)
            applicationComputeDeploymentRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            dataEntityDataStoreHostingRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            applicationInfrastructureResourceUseRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            applicationLoadBalancerExposureRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // Infrastructure Terraform & Discovery Readiness (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
            iacResourceBindingRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // Library Backend Foundation (Spec: 2026-05-05-library-backend-foundation)
            codeUnitDependencyRepository.findByModelFileId(modelFileId).stream()
                .map(entityMapper::toDto).collect(Collectors.toList()),
            // Endpoint->Data-Effect Call Graph for Discovery (Spec: 2026-05-29) -- Task Group 1
            endpointDataEffectRepository.findByModelFileId(modelFileId).stream()
                .map(EndpointDataEffectMapper::toDto).collect(Collectors.toList())
        );
    }

    private List<DiagramDto> loadDiagrams(String modelFileId) {
        List<DiagramEntity> diagrams = diagramRepository.findByModelFileId(modelFileId);
        List<DiagramDto> result = new ArrayList<>();

        for (DiagramEntity diagram : diagrams) {
            List<DiagramNodeDto> nodes = diagramNodeRepository.findByDiagramId(diagram.getId()).stream()
                .map(diagramMapper::toDto).collect(Collectors.toList());

            List<DiagramEdgeDto> edges = diagramEdgeRepository.findByDiagramId(diagram.getId()).stream()
                .map(diagramMapper::toDto).collect(Collectors.toList());

            List<DecorationDto> decorations = diagramDecorationRepository.findByDiagramId(diagram.getId()).stream()
                .map(diagramMapper::toDto).collect(Collectors.toList());

            List<DiagramInteractionEdgeDto> interactionEdges = diagramInteractionEdgeRepository
                .findByDiagramId(diagram.getId()).stream()
                .map(diagramMapper::toDto).collect(Collectors.toList());

            result.add(diagramMapper.toDto(diagram, nodes, edges, decorations, interactionEdges));
        }

        return result;
    }

    // ============================================================================
    // Helper Methods - Save
    // ============================================================================

    /**
     * Snapshot {@code (run.id -> run.service_id)} for every discovery run whose
     * service binding points at a service in this model file. Returned map is
     * empty when the model file has no services or none of its services are
     * referenced by any run -- the caller treats an empty map as a no-op.
     *
     * Companion to changeset 126's {@code ON DELETE SET NULL} action: see
     * {@code saveModelInternal} for the full rationale.
     */
    private Map<UUID, String> captureDiscoveryRunServiceFKs(String modelFileId) {
        Set<String> serviceIds = serviceRepository.findByModelFileId(modelFileId)
            .stream()
            .map(ServiceEntity::getId)
            .collect(Collectors.toSet());
        if (serviceIds.isEmpty()) {
            return Map.of();
        }
        List<Object[]> snapshots =
            discoveryRunRepository.findIdAndServiceIdByServiceIdIn(serviceIds);
        Map<UUID, String> result = new HashMap<>(snapshots.size());
        for (Object[] row : snapshots) {
            result.put((UUID) row[0], (String) row[1]);
        }
        return result;
    }

    /**
     * Restore the captured {@code discovery_run.service_id} values after the
     * services delete-and-re-insert cycle. Only restores entries whose
     * serviceId is still present in {@code survivingServiceIds} -- a service
     * removed from the model legitimately becomes a "deleted" reference, and
     * the chip predicate on the frontend will correctly fire for it.
     */
    private void restoreDiscoveryRunServiceFKs(Map<UUID, String> snapshots,
                                               Set<String> survivingServiceIds) {
        if (snapshots.isEmpty()) {
            return;
        }
        for (Map.Entry<UUID, String> entry : snapshots.entrySet()) {
            if (survivingServiceIds.contains(entry.getValue())) {
                discoveryRunRepository.restoreServiceId(entry.getKey(), entry.getValue());
            }
        }
    }

    /**
     * Logical FK cleanup companion to FR6 of the Target Manifest -> Service
     * Association spec (2026-06-26). A target-state {@code services} element is
     * "archived" by removal from the model (the whole-model save deletes and
     * re-inserts the surviving services); any id present before the save but
     * absent from {@code survivingServiceIds} was removed, so its dependent
     * {@code target_manifest_artifacts.target_service_element_id} rows are
     * nulled here. Non-UUID legacy ids can never be a service-element FK (those
     * are UUIDs) and are skipped.
     */
    private void nullManifestFksForRemovedServices(Set<String> preSaveServiceIds,
                                                   Set<String> survivingServiceIds) {
        if (preSaveServiceIds.isEmpty()) {
            return;
        }
        List<UUID> removed = new ArrayList<>();
        for (String id : preSaveServiceIds) {
            if (id != null && !survivingServiceIds.contains(id)) {
                try {
                    removed.add(UUID.fromString(id));
                } catch (IllegalArgumentException ignored) {
                    // Non-UUID service id -- cannot be a target_service_element_id.
                }
            }
        }
        if (!removed.isEmpty()) {
            int cleared = targetManifestArtifactRepository.clearTargetServiceElementIdIn(removed);
            if (cleared > 0) {
                log.debug("saveModel: nulled target_service_element_id on {} manifest "
                    + "row(s) for {} removed service element(s)", cleared, removed.size());
            }
        }
    }

    private void deleteAllDataForModelFile(String modelFileId) {
        // Library Backend Foundation (Spec: 2026-05-05-library-backend-foundation)
        // Delete code_unit_dependencies first -- references application_points
        // (deleted below). Libraries themselves are deleted near the end
        // (after services) because nothing depends on libraries.
        codeUnitDependencyRepository.deleteByModelFileId(modelFileId);

        // Infrastructure Terraform & Discovery Readiness (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
        // Delete iac_resource_bindings FIRST -- depends on iac_sources AND
        // infrastructure_points (both deleted further below).
        iacResourceBindingRepository.deleteByModelFileId(modelFileId);

        // Infrastructure Cross-Domain Relationships (Spec: 2026-05-05-infrastructure-cross-domain-integration)
        // Delete the 4 cross-domain relationships FIRST -- they reference
        // application_points, data_entity_points, and Infrastructure entity
        // tables (compute_resources, deployment_units, data_store_instances,
        // infrastructure_resources, load_balancers, listeners, environments)
        // that follow below. No FK ordering between the 4 cross-domain
        // relationships themselves is required (they are siblings).
        applicationLoadBalancerExposureRepository.deleteByModelFileId(modelFileId);
        applicationInfrastructureResourceUseRepository.deleteByModelFileId(modelFileId);
        dataEntityDataStoreHostingRepository.deleteByModelFileId(modelFileId);
        applicationComputeDeploymentRepository.deleteByModelFileId(modelFileId);

        // Infrastructure Domain (Spec: 2026-05-04-infrastructure-domain-backend-foundation)
        // Task Group 7 - delete in dependency-safe order:
        //   1. Relationships first (load_balancer_resource_routes, deployment_unit_compute_resources, resource_subnet_hostings)
        //   2. infrastructure_points (referenced by the 3 relationships above)
        //   3. 12 entity tables in reverse-dependency order
        loadBalancerResourceRouteRepository.deleteByModelFileId(modelFileId);
        deploymentUnitComputeResourceRepository.deleteByModelFileId(modelFileId);
        resourceSubnetHostingRepository.deleteByModelFileId(modelFileId);
        infrastructurePointRepository.deleteByModelFileId(modelFileId);
        // Infrastructure Terraform & Discovery Readiness -- iac_sources references
        // environments (deleted below) and model_files; delete after the infra
        // relationships and before the entity tables it depends on.
        iacSourceRepository.deleteByModelFileId(modelFileId);
        infrastructureResourceRepository.deleteByModelFileId(modelFileId);
        dataStoreInstanceRepository.deleteByModelFileId(modelFileId);
        listenerRepository.deleteByModelFileId(modelFileId);
        loadBalancerRepository.deleteByModelFileId(modelFileId);
        deploymentUnitRepository.deleteByModelFileId(modelFileId);
        computeResourceRepository.deleteByModelFileId(modelFileId);
        computeClusterRepository.deleteByModelFileId(modelFileId);
        subnetRepository.deleteByModelFileId(modelFileId);
        networkRepository.deleteByModelFileId(modelFileId);
        locationRepository.deleteByModelFileId(modelFileId);
        cloudAccountRepository.deleteByModelFileId(modelFileId);
        environmentRepository.deleteByModelFileId(modelFileId);

        // Delete in reverse dependency order
        // Diagram elements first
        diagramDecorationRepository.deleteByModelFileId(modelFileId);
        diagramInteractionEdgeRepository.deleteByModelFileId(modelFileId);
        diagramEdgeRepository.deleteByModelFileId(modelFileId);
        diagramNodeRepository.deleteByModelFileId(modelFileId);
        diagramRepository.deleteByModelFileId(modelFileId);

        // UI Architecture Increment 2 - UIActions before UIScreens/UIComponents (FK dependency)
        uiActionRepository.deleteByModelFileId(modelFileId);
        // UICharacteristics have no FK dependencies from other tables (Spec: UI Characteristics)
        uiCharacteristicRepository.deleteByModelFileId(modelFileId);
        // UIContracts have no FK dependencies from other tables in this increment
        uiContractRepository.deleteByModelFileId(modelFileId);
        // UIComponents have no FK dependencies from other new tables (UIActions already deleted)
        uiComponentRepository.deleteByModelFileId(modelFileId);

        // Relationships - ui_workflow_transitions before ui_screens
        uiWorkflowTransitionRepository.deleteByModelFileId(modelFileId);
        // Endpoint->Data-Effect Call Graph for Discovery (Spec: 2026-05-29) -- Task Group 1.
        // Relationship row: deleted with the other relationships, before the
        // endpoints / data-entity-points it references are deleted below.
        endpointDataEffectRepository.deleteByModelFileId(modelFileId);
        interfaceLogicalEntityRepository.deleteByModelFileId(modelFileId);
        dataMovementRepository.deleteByModelFileId(modelFileId);
        logicalDataAttributePhysicalDataAttributeRepository.deleteByModelFileId(modelFileId);
        logicalDataEntityPhysicalDataEntityRepository.deleteByModelFileId(modelFileId);
        logicalDataEntityRelationshipRepository.deleteByModelFileId(modelFileId);
        applicationPointBusinessPointRepository.deleteByModelFileId(modelFileId);
        businessUserBusinessPointRepository.deleteByModelFileId(modelFileId);
        // ApplicationPoint to BusinessLogic join table (must be deleted before business_logics and application_points)
        applicationPointBusinessLogicRepository.deleteByModelFileId(modelFileId);

        // Entities - in reverse dependency order
        // UI domain: ui_screens last (after transitions and actions deleted)
        uiScreenRepository.deleteByModelFileId(modelFileId);
        // Behavioural domain: ActivityFlows before Activities (FK dependency)
        activityFlowRepository.deleteByModelFileId(modelFileId);
        activityRepository.deleteByModelFileId(modelFileId);
        activityPartitionRepository.deleteByModelFileId(modelFileId);
        // Behavioural domain: StateTransitions before States (FK dependency)
        stateTransitionRepository.deleteByModelFileId(modelFileId);
        stateRepository.deleteByModelFileId(modelFileId);
        eventRepository.deleteByModelFileId(modelFileId);
        // Behavioural domain: BusinessLogic (no FK dependencies to other entities)
        businessLogicRepository.deleteByModelFileId(modelFileId);
        interactionRepository.deleteByModelFileId(modelFileId);
        appBusinessPointRepository.deleteByModelFileId(modelFileId);

        // Data Entity Point Superclass - delete data entity points BEFORE logical/physical entities
        // Points have FK dependencies to logical_data_entities and physical_data_entities
        // Spec: Data Entity Point Superclass
        dataEntityPointRepository.deleteByModelFileId(modelFileId);

        physicalDataAttributeRepository.deleteByModelFileId(modelFileId);
        physicalDataEntityRepository.deleteByModelFileId(modelFileId);
        logicalDataAttributeRepository.deleteByModelFileId(modelFileId);
        logicalDataEntityRepository.deleteByModelFileId(modelFileId);
        applicationPointRepository.deleteByModelFileId(modelFileId);
        // Methods before Classes due to FK constraint
        methodRepository.deleteByModelFileId(modelFileId);
        classRepository.deleteByModelFileId(modelFileId);
        endpointRepository.deleteByModelFileId(modelFileId);
        interfaceRepository.deleteByModelFileId(modelFileId);
        // Services reference package_sets, so delete services before package_sets
        serviceRepository.deleteByModelFileId(modelFileId);
        // Library Backend Foundation: delete libraries after services. Libraries
        // also reference package_sets (ON DELETE SET NULL); nothing depends on
        // libraries except code_unit_dependencies (already deleted above).
        libraryRepository.deleteByModelFileId(modelFileId);
        // Delete packages before package_sets (FK dependency)
        packageRepository.deleteByModelFileId(modelFileId);
        packageSetRepository.deleteByModelFileId(modelFileId);
        applicationComponentRepository.deleteByModelFileId(modelFileId);
        businessPointRepository.deleteByModelFileId(modelFileId);
        // User Journey Links Meta-Model Foundation - delete user_journey_links before user_journeys (FK: source/target reference user_journeys)
        userJourneyLinkRepository.deleteByModelFileId(modelFileId);
        // User Journey Meta-Model Foundation - delete activity_steps first (FKs to user_journeys, process_activities, business_users, applications)
        activityStepRepository.deleteByModelFileId(modelFileId);
        userJourneyRepository.deleteByModelFileId(modelFileId);
        applicationRepository.deleteByModelFileId(modelFileId);
        processActivityRepository.deleteByModelFileId(modelFileId);
        businessProcessRepository.deleteByModelFileId(modelFileId);
        businessUserRepository.deleteByModelFileId(modelFileId);

        // Note: package_set_default_rules are NOT deleted on model save
        // They are managed by the PackageSetStandardsImporter service
        // and persist across model saves (imported from external JSON files)
    }

    private void saveEntities(MetaModelEntitiesDto entities, String modelFileId) {
        // Save in FK dependency order

        // Business domain - independent entities first
        if (entities.businessUsers() != null) {
            businessUserRepository.saveAll(entities.businessUsers().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        if (entities.businessProcesses() != null) {
            businessProcessRepository.saveAll(entities.businessProcesses().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Process activities depend on business processes
        if (entities.processActivities() != null) {
            processActivityRepository.saveAll(entities.processActivities().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Business points depend on business processes and optionally process activities
        if (entities.businessPoints() != null) {
            businessPointRepository.saveAll(entities.businessPoints().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Application domain
        if (entities.applications() != null) {
            applicationRepository.saveAll(entities.applications().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        if (entities.appComponents() != null) {
            applicationComponentRepository.saveAll(entities.appComponents().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // PackageSets must be saved before Services and Packages (FK dependency)
        if (entities.packageSets() != null) {
            for (PackageSetDto dto : entities.packageSets()) {
                validatePackageSet(dto);
            }
            packageSetRepository.saveAll(entities.packageSets().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Packages must be saved after PackageSets (FK dependency)
        if (entities.packages() != null) {
            for (PackageDto dto : entities.packages()) {
                validatePackage(dto);
            }
            packageRepository.saveAll(entities.packages().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Services can now reference package_sets
        if (entities.services() != null) {
            serviceRepository.saveAll(entities.services().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Library Backend Foundation (Spec: 2026-05-05-library-backend-foundation)
        // Libraries are saved immediately after services. Like services they
        // reference package_sets; nothing else depends on them.
        if (entities.libraries() != null) {
            libraryRepository.saveAll(entities.libraries().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        if (entities.interfaces() != null) {
            interfaceRepository.saveAll(entities.interfaces().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Endpoints are saved AFTER ensureDataEntityPoints (below) because
        // endpoints may reference data_entity_points via request/response FK columns.

        // Classes must be saved before Methods (FK constraint)
        if (entities.classes() != null) {
            classRepository.saveAll(entities.classes().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        if (entities.methods() != null) {
            methodRepository.saveAll(entities.methods().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Validate ApplicationPoint targets before saving
        if (entities.applicationPoints() != null) {
            validateApplicationPointTargets(entities.applicationPoints(), entities);
            applicationPointRepository.saveAll(entities.applicationPoints().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Data domain - logical/physical entities must be saved before data entity points
        List<LogicalDataEntityDto> savedLogicalEntities = null;
        List<PhysicalDataEntityDto> savedPhysicalEntities = null;

        if (entities.logicalDataEntities() != null) {
            logicalDataEntityRepository.saveAll(entities.logicalDataEntities().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
            savedLogicalEntities = entities.logicalDataEntities();
        }

        if (entities.logicalDataAttributes() != null) {
            logicalDataAttributeRepository.saveAll(entities.logicalDataAttributes().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        if (entities.physicalDataEntities() != null) {
            physicalDataEntityRepository.saveAll(entities.physicalDataEntities().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
            savedPhysicalEntities = entities.physicalDataEntities();
        }

        if (entities.physicalDataAttributes() != null) {
            physicalDataAttributeRepository.saveAll(entities.physicalDataAttributes().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Data Entity Point Superclass - ensure points exist for all logical/physical entities
        // This runs AFTER logical/physical entities are saved (FK dependency)
        // Spec: Data Entity Point Superclass
        dataEntityPointEnsureService.ensureDataEntityPoints(
            modelFileId,
            savedLogicalEntities,
            savedPhysicalEntities
        );

        // Endpoints saved here — after data_entity_points exist (FK on request/response columns)
        if (entities.endpoints() != null) {
            endpointRepository.saveAll(entities.endpoints().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Interaction domain - app business points must be saved before interactions
        if (entities.appBusinessPoints() != null) {
            appBusinessPointRepository.saveAll(entities.appBusinessPoints().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        if (entities.interactions() != null) {
            interactionRepository.saveAll(entities.interactions().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Behavioural domain - Events have no FK dependencies
        if (entities.events() != null) {
            eventRepository.saveAll(entities.events().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Behavioural domain - States must be saved before StateTransitions (FK dependency)
        if (entities.states() != null) {
            stateRepository.saveAll(entities.states().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        if (entities.stateTransitions() != null) {
            stateTransitionRepository.saveAll(entities.stateTransitions().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Behavioural domain - Activities must be saved before ActivityFlows (FK dependency)
        if (entities.activities() != null) {
            activityRepository.saveAll(entities.activities().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        if (entities.activityFlows() != null) {
            activityFlowRepository.saveAll(entities.activityFlows().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // ActivityPartitions have no FK dependencies to other new entities
        if (entities.activityPartitions() != null) {
            activityPartitionRepository.saveAll(entities.activityPartitions().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Behavioural domain - BusinessLogic entities (no FK dependencies)
        if (entities.businessLogics() != null) {
            businessLogicRepository.saveAll(entities.businessLogics().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // User Journey Meta-Model Foundation - save user journeys and activity steps
        // UserJourneys depend on business_users and business_processes (FK dependencies)
        if (entities.userJourneys() != null) {
            userJourneyRepository.saveAll(entities.userJourneys().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // ActivitySteps depend on user_journeys, process_activities, business_users, and applications
        if (entities.activitySteps() != null) {
            activityStepRepository.saveAll(entities.activitySteps().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // UI domain - UIScreens must be saved before UIWorkflowTransitions and UIActions (FK dependency)
        if (entities.uiScreens() != null) {
            uiScreenRepository.saveAll(entities.uiScreens().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // UI Architecture Increment 2 entities
        // UIContracts have no FK dependencies
        if (entities.uiContracts() != null) {
            uiContractRepository.saveAll(entities.uiContracts().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // UIComponents have no FK dependencies
        if (entities.uiComponents() != null) {
            uiComponentRepository.saveAll(entities.uiComponents().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // UIActions depend on UIScreens, UIComponents, and UIContracts
        if (entities.uiActions() != null) {
            for (UIActionDto dto : entities.uiActions()) {
                validateUIAction(dto);
            }
            uiActionRepository.saveAll(entities.uiActions().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // UI Characteristics (no FK dependencies) - Spec: UI Characteristics
        if (entities.uiCharacteristics() != null) {
            uiCharacteristicRepository.saveAll(entities.uiCharacteristics().stream()
                .map(dto -> UICharacteristicEntity.builder()
                    .id(dto.id())
                    .modelFileId(modelFileId)
                    .uiId(dto.uiId())
                    .type(dto.type())
                    .key(dto.key())
                    .name(dto.name())
                    .description(dto.description())
                    .evidence(dto.evidence())
                    .build())
                .collect(Collectors.toList()));
        }

        // Note: packageSetDefaultRules are NOT saved during model save
        // They are managed by the PackageSetStandardsImporter service

        // ====================================================================
        // Infrastructure Domain (Spec: 2026-05-04-infrastructure-domain-backend-foundation)
        // Save in parents-first FK-dependency order: environments -> cloud_accounts ->
        //   locations -> networks -> subnets -> compute_clusters -> compute_resources ->
        //   deployment_units -> load_balancers -> listeners -> data_store_instances ->
        //   infrastructure_resources -> infrastructure_points.
        // Additive: existing per-domain saves above are not modified.
        // ====================================================================
        if (entities.environments() != null) {
            environmentRepository.saveAll(entities.environments().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (entities.cloudAccounts() != null) {
            cloudAccountRepository.saveAll(entities.cloudAccounts().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (entities.locations() != null) {
            locationRepository.saveAll(entities.locations().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (entities.networks() != null) {
            networkRepository.saveAll(entities.networks().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (entities.subnets() != null) {
            subnetRepository.saveAll(entities.subnets().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (entities.computeClusters() != null) {
            computeClusterRepository.saveAll(entities.computeClusters().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (entities.computeResources() != null) {
            computeResourceRepository.saveAll(entities.computeResources().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (entities.deploymentUnits() != null) {
            deploymentUnitRepository.saveAll(entities.deploymentUnits().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (entities.loadBalancers() != null) {
            loadBalancerRepository.saveAll(entities.loadBalancers().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (entities.listeners() != null) {
            listenerRepository.saveAll(entities.listeners().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (entities.dataStoreInstances() != null) {
            dataStoreInstanceRepository.saveAll(entities.dataStoreInstances().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (entities.infrastructureResources() != null) {
            infrastructureResourceRepository.saveAll(entities.infrastructureResources().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (entities.infrastructurePoints() != null) {
            infrastructurePointRepository.saveAll(entities.infrastructurePoints().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // ====================================================================
        // Infrastructure Terraform & Discovery Readiness (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
        // Save iac_sources after the 13 spec-1/2 Infra entity tables. iac_sources
        // depends only on environments (nullable FK) and model_files.
        // ====================================================================
        if (entities.iacSources() != null) {
            iacSourceRepository.saveAll(entities.iacSources().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
    }

    /**
     * Saves relationships with point-id validation.
     *
     * For LogicalDataEntityRelationship:
     * - Validates that fromDataEntityPointId and toDataEntityPointId are set
     *
     * For DataMovement:
     * - Validates that dataEntityPointId is set
     *
     * Spec: Remove Legacy Data Entity Relationship Columns
     */
    private void saveRelationships(MetaModelRelationshipsDto relationships, String modelFileId) {
        if (relationships.businessUserBusinessPoints() != null) {
            businessUserBusinessPointRepository.saveAll(relationships.businessUserBusinessPoints().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        if (relationships.applicationPointBusinessPoints() != null) {
            applicationPointBusinessPointRepository.saveAll(relationships.applicationPointBusinessPoints().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        if (relationships.logicalDataEntityRelationships() != null) {
            // Validate point-id fields before saving
            // Spec: Remove Legacy Data Entity Relationship Columns
            for (LogicalDataEntityRelationshipDto dto : relationships.logicalDataEntityRelationships()) {
                validateLogicalDataEntityRelationshipPointIds(dto);
            }
            logicalDataEntityRelationshipRepository.saveAll(relationships.logicalDataEntityRelationships().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        if (relationships.logicalDataEntityPhysicalDataEntities() != null) {
            logicalDataEntityPhysicalDataEntityRepository.saveAll(relationships.logicalDataEntityPhysicalDataEntities().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        if (relationships.logicalDataAttributePhysicalDataAttributes() != null) {
            logicalDataAttributePhysicalDataAttributeRepository.saveAll(relationships.logicalDataAttributePhysicalDataAttributes().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        if (relationships.dataMovements() != null) {
            // Validate point-id field before saving
            // Spec: Remove Legacy Data Entity Relationship Columns
            for (DataMovementDto dto : relationships.dataMovements()) {
                validateDataMovementPointId(dto);
            }
            dataMovementRepository.saveAll(relationships.dataMovements().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        if (relationships.interfaceLogicalEntities() != null) {
            interfaceLogicalEntityRepository.saveAll(relationships.interfaceLogicalEntities().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // Endpoint->Data-Effect Call Graph for Discovery (Spec: 2026-05-29) -- Task Group 1.
        // Re-INSERT after endpoints + data-entity-points exist (saveEntities ran
        // first); references the data entity via the dep_log_/dep_phy_ point id.
        if (relationships.endpointDataEffects() != null) {
            endpointDataEffectRepository.saveAll(relationships.endpointDataEffects().stream()
                .map(dto -> EndpointDataEffectMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // UI domain - UIWorkflowTransitions with validation
        if (relationships.uiWorkflowTransitions() != null) {
            for (UIWorkflowTransitionDto dto : relationships.uiWorkflowTransitions()) {
                validateUIWorkflowTransition(dto);
            }
            uiWorkflowTransitionRepository.saveAll(relationships.uiWorkflowTransitions().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // ApplicationPoint to BusinessLogic join table
        if (relationships.applicationPointBusinessLogics() != null) {
            applicationPointBusinessLogicRepository.saveAll(relationships.applicationPointBusinessLogics().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // User Journey Links Meta-Model Foundation
        if (relationships.userJourneyLinks() != null) {
            var allowedTypes = java.util.Set.of("RELATES_TO", "PRECEDES", "DEPENDS_ON", "OPTIONALLY_LEADS_TO", "TRIGGERS");
            for (UserJourneyLinkDto dto : relationships.userJourneyLinks()) {
                if (!allowedTypes.contains(dto.relationshipType())) {
                    throw new ValidationException(
                        "user_journey_links",
                        "invalid_relationship_type",
                        "relationship_type",
                        dto.id(),
                        null,
                        "Invalid relationship_type '" + dto.relationshipType() + "'" +
                        " for user_journey_link '" + dto.id() + "'." +
                        " Allowed values: " + allowedTypes);
                }
            }
            userJourneyLinkRepository.saveAll(relationships.userJourneyLinks().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // ====================================================================
        // Infrastructure Domain Relationships (Spec: 2026-05-04-infrastructure-domain-backend-foundation)
        // Save the 3 new relationship lists. Additive: existing per-domain saves above are not modified.
        // ====================================================================
        if (relationships.resourceSubnetHostings() != null) {
            resourceSubnetHostingRepository.saveAll(relationships.resourceSubnetHostings().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (relationships.deploymentUnitComputeResources() != null) {
            deploymentUnitComputeResourceRepository.saveAll(relationships.deploymentUnitComputeResources().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (relationships.loadBalancerResourceRoutes() != null) {
            loadBalancerResourceRouteRepository.saveAll(relationships.loadBalancerResourceRoutes().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // ====================================================================
        // Infrastructure Cross-Domain Relationships (Spec: 2026-05-05-infrastructure-cross-domain-integration)
        // Save the 4 new cross-domain relationship lists. Additive: existing
        // per-domain saves above are not modified.
        // ====================================================================
        if (relationships.applicationComputeDeployments() != null) {
            applicationComputeDeploymentRepository.saveAll(relationships.applicationComputeDeployments().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (relationships.dataEntityDataStoreHostings() != null) {
            dataEntityDataStoreHostingRepository.saveAll(relationships.dataEntityDataStoreHostings().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (relationships.applicationInfrastructureResourceUses() != null) {
            applicationInfrastructureResourceUseRepository.saveAll(relationships.applicationInfrastructureResourceUses().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
        if (relationships.applicationLoadBalancerExposures() != null) {
            applicationLoadBalancerExposureRepository.saveAll(relationships.applicationLoadBalancerExposures().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // ====================================================================
        // Infrastructure Terraform & Discovery Readiness (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
        // Save iac_resource_bindings LAST -- depends on iac_sources (saved above
        // in saveEntities) AND infrastructure_points.
        // ====================================================================
        if (relationships.iacResourceBindings() != null) {
            iacResourceBindingRepository.saveAll(relationships.iacResourceBindings().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }

        // ====================================================================
        // Library Backend Foundation (Spec: 2026-05-05-library-backend-foundation)
        // Save code_unit_dependencies LAST -- references application_points
        // (saved earlier in the application domain).
        // ====================================================================
        if (relationships.codeUnitDependencies() != null) {
            codeUnitDependencyRepository.saveAll(relationships.codeUnitDependencies().stream()
                .map(dto -> entityMapper.toEntity(dto, modelFileId))
                .collect(Collectors.toList()));
        }
    }

    /**
     * Validates ApplicationPoint constraints including required application_id and target references.
     *
     * Spec: Global Application Point Picker with Derived ApplicationPoints
     * Spec: Expand Application Points to Reference Service/Class/Method
     *
     * Constraints:
     * - application_id is required and must be non-null and non-blank
     * - If target_type is non-null and non-blank, target_ref_id must also be non-null and non-blank (pairwise constraint)
     * - If target_ref_id is non-null and non-blank, target_type must also be non-null and non-blank (pairwise constraint)
     * - If target_type is set, it must be one of: SERVICE, CLASS, METHOD
     * - If target_type is CLASS, target_ref_id must reference a valid Class entity
     * - If target_type is METHOD, target_ref_id must reference a valid Method entity
     * - If target_type is SERVICE, target_ref_id must reference a valid Service entity
     *
     * @param applicationPoints The list of ApplicationPointDto to validate
     * @param entities The MetaModelEntitiesDto containing all entities for reference validation
     * @throws IllegalArgumentException if validation fails (returns HTTP 400)
     */
    private void validateApplicationPointTargets(
            List<ApplicationPointDto> applicationPoints,
            MetaModelEntitiesDto entities) {

        // Build sets of valid IDs for each target type
        Set<String> serviceIds = entities.services() != null
            ? entities.services().stream().map(ServiceDto::id).collect(Collectors.toSet())
            : Set.of();

        Set<String> classIds = entities.classes() != null
            ? entities.classes().stream().map(ClassDto::id).collect(Collectors.toSet())
            : Set.of();

        Set<String> methodIds = entities.methods() != null
            ? entities.methods().stream().map(MethodDto::id).collect(Collectors.toSet())
            : Set.of();

        // Build map for better error messages
        Map<String, String> classNameById = entities.classes() != null
            ? entities.classes().stream().collect(Collectors.toMap(ClassDto::id, ClassDto::name, (a, b) -> a))
            : Map.of();

        Map<String, String> methodNameById = entities.methods() != null
            ? entities.methods().stream().collect(Collectors.toMap(MethodDto::id, MethodDto::name, (a, b) -> a))
            : Map.of();

        for (ApplicationPointDto dto : applicationPoints) {
            // Spec: Global Application Point Picker - application_id is required
            if (dto.applicationId() == null || dto.applicationId().isBlank()) {
                throw new ValidationException(
                    "application_points",
                    "application_id_required",
                    "application_id",
                    dto.id(),
                    dto.name(),
                    "ApplicationPoint validation failed for id '" + dto.id() + "' (name: '" + dto.name() + "'): " +
                    "application_id is required. Every ApplicationPoint must be associated with an Application."
                );
            }

            String targetType = dto.targetType();
            String targetRefId = dto.targetRefId();

            // Check pairwise constraint: both must be set or both must be null/blank
            boolean typeSet = targetType != null && !targetType.isBlank();
            boolean refIdSet = targetRefId != null && !targetRefId.isBlank();

            if (typeSet != refIdSet) {
                throw new ValidationException(
                    "application_points",
                    "target_pairwise",
                    "target_type",
                    dto.id(),
                    dto.name(),
                    "ApplicationPoint validation failed for id '" + dto.id() + "' (name: '" + dto.name() + "'): " +
                    "target_type and target_ref_id must both be set or both be null/blank. " +
                    "Found: target_type=" + (typeSet ? "'" + targetType + "'" : "null") +
                    ", target_ref_id=" + (refIdSet ? "'" + targetRefId + "'" : "null")
                );
            }

            // If both are set, validate the target_type value and the reference
            if (typeSet && refIdSet) {
                switch (targetType.toUpperCase()) {
                    case "SERVICE":
                        if (!serviceIds.contains(targetRefId)) {
                            throw new ValidationException(
                                "application_points",
                                "invalid_target_ref",
                                "target_ref_id",
                                dto.id(),
                                dto.name(),
                                "ApplicationPoint validation failed for id '" + dto.id() + "' (name: '" + dto.name() + "'): " +
                                "target_ref_id '" + targetRefId + "' does not reference a valid Service entity. " +
                                "Ensure the Service exists in the model before creating a derived ApplicationPoint for it."
                            );
                        }
                        break;
                    case "CLASS":
                        if (!classIds.contains(targetRefId)) {
                            throw new ValidationException(
                                "application_points",
                                "invalid_target_ref",
                                "target_ref_id",
                                dto.id(),
                                dto.name(),
                                "ApplicationPoint validation failed for id '" + dto.id() + "' (name: '" + dto.name() + "'): " +
                                "target_ref_id '" + targetRefId + "' does not reference a valid Class entity. " +
                                "Ensure the Class exists in the model before creating a derived ApplicationPoint for it."
                            );
                        }
                        log.debug("ApplicationPoint '{}' targets Class '{}'", dto.name(),
                            classNameById.getOrDefault(targetRefId, targetRefId));
                        break;
                    case "METHOD":
                        if (!methodIds.contains(targetRefId)) {
                            throw new ValidationException(
                                "application_points",
                                "invalid_target_ref",
                                "target_ref_id",
                                dto.id(),
                                dto.name(),
                                "ApplicationPoint validation failed for id '" + dto.id() + "' (name: '" + dto.name() + "'): " +
                                "target_ref_id '" + targetRefId + "' does not reference a valid Method entity. " +
                                "Ensure the Method exists in the model before creating a derived ApplicationPoint for it."
                            );
                        }
                        log.debug("ApplicationPoint '{}' targets Method '{}'", dto.name(),
                            methodNameById.getOrDefault(targetRefId, targetRefId));
                        break;
                    case "LIBRARY":
                        // Library Backend Foundation (Spec: 2026-05-05-library-backend-foundation):
                        // LIBRARY target_type is admitted by the relaxed CHECK in changeset 124.
                        // The library_ids cross-reference set is NOT enforced at validation
                        // time -- mirrors the convention for Spec 3 callers that may point at
                        // libraries which have not yet been resolved server-side.
                        log.debug("ApplicationPoint '{}' targets Library ref_id '{}'", dto.name(), targetRefId);
                        break;
                    default:
                        throw new ValidationException(
                            "application_points",
                            "invalid_target_type",
                            "target_type",
                            dto.id(),
                            dto.name(),
                            "ApplicationPoint validation failed for id '" + dto.id() + "' (name: '" + dto.name() + "'): " +
                            "target_type '" + targetType + "' is invalid. Must be one of: SERVICE, CLASS, METHOD, LIBRARY"
                        );
                }
            }
        }
    }

    /**
     * Validates LogicalDataEntityRelationship point-id fields.
     *
     * Constraints:
     * - fromDataEntityPointId must be non-null and non-blank
     * - toDataEntityPointId must be non-null and non-blank
     *
     * Spec: Remove Legacy Data Entity Relationship Columns
     *
     * @param dto The DTO to validate
     * @throws IllegalArgumentException if validation fails
     */
    private void validateLogicalDataEntityRelationshipPointIds(LogicalDataEntityRelationshipDto dto) {
        if (dto.fromDataEntityPointId() == null || dto.fromDataEntityPointId().isBlank()) {
            throw new ValidationException(
                "logical_data_entity_relationships",
                "endpoint_required",
                "from_data_entity_point_id",
                dto.id(),
                null,
                "LogicalDataEntityRelationship validation failed for id '" + dto.id() + "': " +
                "fromDataEntityPointId is required"
            );
        }

        if (dto.toDataEntityPointId() == null || dto.toDataEntityPointId().isBlank()) {
            throw new ValidationException(
                "logical_data_entity_relationships",
                "endpoint_required",
                "to_data_entity_point_id",
                dto.id(),
                null,
                "LogicalDataEntityRelationship validation failed for id '" + dto.id() + "': " +
                "toDataEntityPointId is required"
            );
        }
    }

    /**
     * Validates DataMovement XOR constraint: exactly one of dataEntityPointId
     * or interfaceWithSchemaId must be set (non-null, non-blank).
     *
     * Spec: Data Movement Interface Schema Extension
     *
     * @param dto The DTO to validate
     * @throws IllegalArgumentException if validation fails
     */
    private void validateDataMovementPointId(DataMovementDto dto) {
        boolean hasDataEntity = dto.dataEntityPointId() != null && !dto.dataEntityPointId().isBlank();
        boolean hasInterface = dto.interfaceWithSchemaId() != null && !dto.interfaceWithSchemaId().isBlank();

        if (hasDataEntity && hasInterface) {
            throw new ValidationException(
                "data_movements",
                "xor_constraint",
                "data_entity_point_id",
                dto.id(),
                null,
                "DataMovement validation failed for id '" + dto.id() + "': " +
                "exactly one of dataEntityPointId or interfaceWithSchemaId must be set, not both"
            );
        }
        if (!hasDataEntity && !hasInterface) {
            throw new ValidationException(
                "data_movements",
                "xor_constraint",
                "data_entity_point_id",
                dto.id(),
                null,
                "DataMovement validation failed for id '" + dto.id() + "': " +
                "exactly one of dataEntityPointId or interfaceWithSchemaId must be set"
            );
        }
    }

    /**
     * Validates UIWorkflowTransition source and target screen references.
     *
     * Constraints:
     * - source_screen_id must be non-null and non-blank
     * - target_screen_id must be non-null and non-blank
     *
     * @param dto The DTO to validate
     * @throws IllegalArgumentException if validation fails
     */
    private void validateUIWorkflowTransition(UIWorkflowTransitionDto dto) {
        if (dto.sourceScreenId() == null || dto.sourceScreenId().isBlank()) {
            throw new ValidationException(
                "ui_workflow_transitions",
                "endpoint_required",
                "source_screen_id",
                dto.id(),
                null,
                "UIWorkflowTransition validation failed for id '" + dto.id() + "': " +
                "source_screen_id must be set"
            );
        }

        if (dto.targetScreenId() == null || dto.targetScreenId().isBlank()) {
            throw new ValidationException(
                "ui_workflow_transitions",
                "endpoint_required",
                "target_screen_id",
                dto.id(),
                null,
                "UIWorkflowTransition validation failed for id '" + dto.id() + "': " +
                "target_screen_id must be set"
            );
        }
    }

    /**
     * Validates UIAction business rules.
     *
     * Constraints:
     * - If effect_type is 'CALL_API', contract_id must be non-null and non-blank
     *
     * @param dto The DTO to validate
     * @throws IllegalArgumentException if validation fails
     */
    private void validateUIAction(UIActionDto dto) {
        // If effect_type is CALL_API, contract_id is required
        if ("CALL_API".equalsIgnoreCase(dto.effectType())) {
            if (dto.contractId() == null || dto.contractId().isBlank()) {
                throw new ValidationException(
                    "ui_actions",
                    "conditional_required",
                    "contract_id",
                    dto.id(),
                    null,
                    "UIAction validation failed for id '" + dto.id() + "': " +
                    "contract_id is required when effect_type is 'CALL_API'"
                );
            }
        }
    }

    /**
     * Validates PackageSet entity.
     *
     * Constraints:
     * - name must be non-null and non-blank
     *
     * @param dto The DTO to validate
     * @throws IllegalArgumentException if validation fails
     */
    private void validatePackageSet(PackageSetDto dto) {
        if (dto.name() == null || dto.name().isBlank()) {
            throw new ValidationException(
                "package_sets",
                "name_required",
                "name",
                dto.id(),
                dto.name(),
                "PackageSet validation failed for id '" + dto.id() + "': " +
                "name must not be blank"
            );
        }
    }

    /**
     * Validates Package entity.
     *
     * Constraints:
     * - name must be non-null and non-blank
     * - package_set_id must be non-null and non-blank
     *
     * @param dto The DTO to validate
     * @throws IllegalArgumentException if validation fails
     */
    private void validatePackage(PackageDto dto) {
        if (dto.name() == null || dto.name().isBlank()) {
            throw new ValidationException(
                "packages",
                "name_required",
                "name",
                dto.id(),
                dto.name(),
                "Package validation failed for id '" + dto.id() + "': " +
                "name must not be blank"
            );
        }
        if (dto.packageSetId() == null || dto.packageSetId().isBlank()) {
            throw new ValidationException(
                "packages",
                "name_required",
                "package_set_id",
                dto.id(),
                dto.name(),
                "Package validation failed for id '" + dto.id() + "': " +
                "package_set_id must not be blank"
            );
        }
    }

    /**
     * Saves diagrams with typed content handling.
     *
     * For typed diagrams (Sequence, ER, Activity, State, UI_SCREEN):
     * - If typedContent is provided, validates it and persists
     * - If typedContent is null/missing, auto-populates with default structure
     *
     * For General diagrams:
     * - typedContent remains null
     *
     * @param diagrams List of diagram DTOs to save
     * @param modelFileId The model file ID
     * @throws IllegalArgumentException if typedContent validation fails
     */
    private void saveDiagrams(List<DiagramDto> diagrams, String modelFileId) {
        if (diagrams == null) return;

        for (DiagramDto diagram : diagrams) {
            // Process typed content before saving
            DiagramDto processedDiagram = processTypedContent(diagram);

            // Save diagram first
            DiagramEntity diagramEntity = diagramMapper.toEntity(processedDiagram, modelFileId);
            diagramRepository.save(diagramEntity);

            String diagramId = diagramEntity.getId();

            // Save nodes
            if (processedDiagram.diagramNodes() != null) {
                diagramNodeRepository.saveAll(processedDiagram.diagramNodes().stream()
                    .map(dto -> diagramMapper.toEntity(dto, modelFileId, diagramId))
                    .collect(Collectors.toList()));
            }

            // Save edges
            if (processedDiagram.diagramEdges() != null) {
                diagramEdgeRepository.saveAll(processedDiagram.diagramEdges().stream()
                    .map(dto -> diagramMapper.toEntity(dto, modelFileId, diagramId))
                    .collect(Collectors.toList()));
            }

            // Save decorations
            if (processedDiagram.decorations() != null) {
                diagramDecorationRepository.saveAll(processedDiagram.decorations().stream()
                    .map(dto -> diagramMapper.toEntity(dto, modelFileId, diagramId))
                    .collect(Collectors.toList()));
            }

            // Save interaction edges
            if (processedDiagram.interactionEdges() != null) {
                diagramInteractionEdgeRepository.saveAll(processedDiagram.interactionEdges().stream()
                    .map(dto -> diagramMapper.toEntity(dto, modelFileId, diagramId))
                    .collect(Collectors.toList()));
            }
        }
    }

    /**
     * Processes typed content for a diagram before saving.
     *
     * - Validates existing typedContent if present
     * - Auto-populates default typedContent for typed diagrams without typedContent
     * - Returns null typedContent for General diagrams
     *
     * @param diagram The diagram DTO to process
     * @return A new DiagramDto with processed typedContent
     * @throws IllegalArgumentException if typedContent validation fails
     */
    private DiagramDto processTypedContent(DiagramDto diagram) {
        String diagramType = diagram.diagramType();
        Map<String, Object> typedContent = diagram.typedContent();

        // Validate existing typedContent if present
        // This will throw IllegalArgumentException for validation failures
        TypedContentValidator.validate(typedContent, diagramType);

        // Determine final typedContent
        Map<String, Object> finalTypedContent;

        if (typedContent != null) {
            // Use the provided typedContent (already validated)
            finalTypedContent = typedContent;
        } else if (TypedContentDefaults.requiresTypedContent(diagramType)) {
            // Auto-populate default typedContent for typed diagrams
            finalTypedContent = TypedContentDefaults.getDefaultTypedContent(diagramType);
            log.debug("Auto-populated default typedContent for {} diagram: {}",
                diagramType, diagram.id());
        } else {
            // General or unknown diagram type - no typedContent
            finalTypedContent = null;
        }

        // Create new DiagramDto with processed typedContent
        return new DiagramDto(
            diagram.id(),
            diagram.name(),
            diagram.description(),
            diagram.diagramType(),
            diagram.settings(),
            diagram.viewQuarter(),
            diagram.diagramNodes(),
            diagram.diagramEdges(),
            diagram.decorations(),
            diagram.interactionEdges(),
            finalTypedContent
        );
    }

    private ModelFileSummaryDto toSummaryDto(ModelFileEntity entity) {
        return new ModelFileSummaryDto(
            entity.getId(),
            entity.getFilename(),
            entity.getDescription(),
            entity.getCreatedAt(),
            entity.getUpdatedAt(),
            entity.getIsDefault(),
            entity.getTags()
        );
    }
}
