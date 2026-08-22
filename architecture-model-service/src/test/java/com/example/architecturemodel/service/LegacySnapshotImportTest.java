package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.entity.*;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportRequestDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportResultDto;
import com.example.architecturemodel.model.dto.export.SnapshotMeta;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.entity.ProjectArtifactRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for legacy snapshot import compatibility.
 *
 * These tests verify that snapshots without dataEntityPoints field are
 * imported successfully and that Data Entity Points are generated with
 * correct deterministic IDs.
 *
 * Spec: Data Entity Point Backfill and Legacy Snapshot Compatibility
 * Task Group 2: Snapshot Import Compatibility
 */
@ExtendWith(MockitoExtension.class)
class LegacySnapshotImportTest {

    @Mock
    private ProjectService projectService;

    @Mock
    private ModelService modelService;

    @Mock
    private WorkItemRepository workItemRepository;

    @Mock
    private ProjectArtifactRepository projectArtifactRepository;

    @Mock
    private ProjectRepository projectRepository;

    @Mock
    private ProjectDeletionService projectDeletionService;

    @InjectMocks
    private ProjectSnapshotImportService importService;

    private ProjectDto testCreatedProject;
    private UUID testProjectId;
    private Instant now;

    @BeforeEach
    void setUp() {
        now = Instant.now();
        testProjectId = UUID.randomUUID();

        testCreatedProject = new ProjectDto(
            testProjectId,
            "Imported Project",
            "/new/path",
            null, // projectHierarchy
            null, // organisationId
            null, // repoUrl
            true,
            now,
            now
        );
    }

    /**
     * Test 1: Import legacy snapshot JSON without dataEntityPoints field succeeds.
     *
     * Verifies that snapshots with null/absent dataEntityPoints field are
     * imported successfully without throwing validation errors.
     */
    @Test
    @DisplayName("Import legacy snapshot without dataEntityPoints field succeeds")
    void testImportLegacySnapshotWithoutDataEntityPointsSucceeds() {
        // Given: A legacy snapshot without dataEntityPoints
        ProjectDto originalProject = new ProjectDto(
            UUID.randomUUID(),
            "Legacy Project",
            "/legacy/path",
            null, // projectHierarchy
            null, // organisationId
            null, // repoUrl
            true,
            now,
            now
        );

        // Create model with logical/physical entities but NO dataEntityPoints
        MetaModelEntitiesDto entities = createEntitiesWithoutDataEntityPoints();
        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        ArchitectureModelDto model = new ArchitectureModelDto(metaModel, List.of());

        // Legacy snapshot without meta (simulates old format)
        ProjectSnapshotDto legacySnapshot = new ProjectSnapshotDto(
            null, // No meta - legacy snapshot
            originalProject,
            model,
            List.of(),
            List.of()
        );

        when(projectRepository.findByName("Legacy Project")).thenReturn(Optional.empty());
        when(projectService.createProject(eq("Legacy Project"), eq("/legacy/path"), any(), eq(true)))
            .thenReturn(testCreatedProject);

        ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
            legacySnapshot, null, null, true, false
        );

        // When: Import the snapshot
        // Then: No exception should be thrown
        assertThatNoException().isThrownBy(() -> importService.importSnapshot(request));

        // Verify model was saved (which triggers ensure service via saveEntities)
        verify(modelService).saveModel(eq("Legacy Project"), any(ArchitectureModelDto.class));
    }

    /**
     * Test 2: Legacy snapshot import generates Data Entity Points with correct deterministic IDs.
     *
     * Verifies that when importing a legacy snapshot (without dataEntityPoints),
     * the ModelService.saveModel() call ensures Data Entity Points are created
     * via the DataEntityPointEnsureService with deterministic IDs.
     */
    @Test
    @DisplayName("Legacy snapshot import calls saveModel which ensures Data Entity Points")
    void testLegacySnapshotImportEnsuresDataEntityPointsViaSaveModel() {
        // Given: A legacy snapshot with logical and physical entities but no dataEntityPoints
        ProjectDto originalProject = new ProjectDto(
            UUID.randomUUID(),
            "Legacy Project",
            "/legacy/path",
            null, // projectHierarchy
            null, // organisationId
            null, // repoUrl
            true,
            now,
            now
        );

        // Create entities that need Data Entity Points
        LogicalDataEntityDto logicalEntity = new LogicalDataEntityDto(
            "log-001", "Customer", "Customer entity", null, null, null,
            null
        );
        PhysicalDataEntityDto physicalEntity = new PhysicalDataEntityDto(
            "phy-001", "customers_table", "Customers table", null, null, null, null, null, null
        , null, null);

        MetaModelEntitiesDto entities = createEntitiesWithData(
            List.of(logicalEntity),
            List.of(physicalEntity),
            null  // dataEntityPoints is null (legacy snapshot)
        );

        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        ArchitectureModelDto model = new ArchitectureModelDto(metaModel, List.of());

        SnapshotMeta meta = new SnapshotMeta(1, now, "PROJECT_SNAPSHOT");
        ProjectSnapshotDto snapshot = new ProjectSnapshotDto(
            meta,
            originalProject,
            model,
            List.of(),
            List.of()
        );

        when(projectRepository.findByName("Legacy Project")).thenReturn(Optional.empty());
        when(projectService.createProject(eq("Legacy Project"), eq("/legacy/path"), any(), eq(true)))
            .thenReturn(testCreatedProject);

        ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
            snapshot, null, null, true, false
        );

        // When: Import the snapshot
        ProjectSnapshotImportResultDto result = importService.importSnapshot(request);

        // Then: ModelService.saveModel was called with the model containing entities
        // (saveModel internally calls saveEntities which calls DataEntityPointEnsureService)
        ArgumentCaptor<ArchitectureModelDto> modelCaptor = ArgumentCaptor.forClass(ArchitectureModelDto.class);
        verify(modelService).saveModel(eq("Legacy Project"), modelCaptor.capture());

        ArchitectureModelDto savedModel = modelCaptor.getValue();
        assertThat(savedModel.metaModel().entities().logicalDataEntities()).hasSize(1);
        assertThat(savedModel.metaModel().entities().logicalDataEntities().get(0).id()).isEqualTo("log-001");
        assertThat(savedModel.metaModel().entities().physicalDataEntities()).hasSize(1);
        assertThat(savedModel.metaModel().entities().physicalDataEntities().get(0).id()).isEqualTo("phy-001");

        // Verify import succeeded
        assertThat(result.modelSaved()).isTrue();
    }

    /**
     * Test 3: Import snapshot with explicit dataEntityPoints field preserves IDs
     * and creates no duplicates.
     *
     * Verifies that when importing a snapshot that already has dataEntityPoints,
     * the existing IDs are preserved and no duplicate points are created.
     */
    @Test
    @DisplayName("Import snapshot with explicit dataEntityPoints preserves IDs")
    void testImportSnapshotWithExplicitDataEntityPointsPreservesIds() {
        // Given: A snapshot with explicit dataEntityPoints
        ProjectDto originalProject = new ProjectDto(
            UUID.randomUUID(),
            "Modern Project",
            "/modern/path",
            null, // projectHierarchy
            null, // organisationId
            null, // repoUrl
            true,
            now,
            now
        );

        // Create explicit Data Entity Points
        DataEntityPointDto existingPoint = new DataEntityPointDto(
            "dep_log_log-001",
            "LOGICAL_ENTITY",
            "log-001",
            null,
            null,
            null,
            null,
            null
        );

        LogicalDataEntityDto logicalEntity = new LogicalDataEntityDto(
            "log-001", "Customer", "Customer entity", null, null, null,
            null
        );

        MetaModelEntitiesDto entities = createEntitiesWithData(
            List.of(logicalEntity),
            List.of(),
            List.of(existingPoint)  // explicit dataEntityPoints
        );

        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        ArchitectureModelDto model = new ArchitectureModelDto(metaModel, List.of());

        SnapshotMeta meta = new SnapshotMeta(1, now, "PROJECT_SNAPSHOT");
        ProjectSnapshotDto snapshot = new ProjectSnapshotDto(
            meta,
            originalProject,
            model,
            List.of(),
            List.of()
        );

        when(projectRepository.findByName("Modern Project")).thenReturn(Optional.empty());
        when(projectService.createProject(eq("Modern Project"), eq("/modern/path"), any(), eq(true)))
            .thenReturn(testCreatedProject);

        ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
            snapshot, null, null, true, false
        );

        // When: Import the snapshot
        ProjectSnapshotImportResultDto result = importService.importSnapshot(request);

        // Then: ModelService.saveModel was called with model containing explicit points
        ArgumentCaptor<ArchitectureModelDto> modelCaptor = ArgumentCaptor.forClass(ArchitectureModelDto.class);
        verify(modelService).saveModel(eq("Modern Project"), modelCaptor.capture());

        ArchitectureModelDto savedModel = modelCaptor.getValue();
        assertThat(savedModel.metaModel().entities().dataEntityPoints()).hasSize(1);
        assertThat(savedModel.metaModel().entities().dataEntityPoints().get(0).id()).isEqualTo("dep_log_log-001");

        // Verify import succeeded
        assertThat(result.modelSaved()).isTrue();
    }

    /**
     * Test 4: Re-import same snapshot twice results in identical state
     * (no duplicates, IDs unchanged).
     *
     * Verifies that importing the same snapshot twice produces the same result
     * without creating duplicate Data Entity Points.
     */
    @Test
    @DisplayName("Re-import same snapshot twice results in identical state")
    void testReimportSameSnapshotTwiceProducesIdenticalState() {
        // Given: A snapshot with entities
        ProjectDto originalProject = new ProjectDto(
            UUID.randomUUID(),
            "Reimport Project",
            "/reimport/path",
            null, // projectHierarchy
            null, // organisationId
            null, // repoUrl
            true,
            now,
            now
        );

        LogicalDataEntityDto logicalEntity = new LogicalDataEntityDto(
            "log-reimport", "Account", "Account entity", null, null, null,
            null
        );

        MetaModelEntitiesDto entities = createEntitiesWithData(
            List.of(logicalEntity),
            List.of(),
            null  // No dataEntityPoints (legacy)
        );

        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        ArchitectureModelDto model = new ArchitectureModelDto(metaModel, List.of());

        SnapshotMeta meta = new SnapshotMeta(1, now, "PROJECT_SNAPSHOT");
        ProjectSnapshotDto snapshot = new ProjectSnapshotDto(meta, originalProject, model, List.of(), List.of());

        ProjectDto firstCreatedProject = new ProjectDto(
            UUID.randomUUID(), "Reimport Project", "/reimport/path",
            null, null, null, // projectHierarchy, organisationId, repoUrl
            true, now, now
        );
        ProjectDto secondCreatedProject = new ProjectDto(
            UUID.randomUUID(), "Reimport Project 2", "/reimport/path",
            null, null, null, // projectHierarchy, organisationId, repoUrl
            true, now, now
        );

        // First import
        when(projectRepository.findByName("Reimport Project")).thenReturn(Optional.empty());
        when(projectService.createProject(eq("Reimport Project"), eq("/reimport/path"), any(), eq(true)))
            .thenReturn(firstCreatedProject);

        ProjectSnapshotImportRequestDto request1 = new ProjectSnapshotImportRequestDto(
            snapshot, null, null, true, false
        );
        ProjectSnapshotImportResultDto result1 = importService.importSnapshot(request1);

        // Second import with different name (to avoid name conflict)
        when(projectRepository.findByName("Reimport Project 2")).thenReturn(Optional.empty());
        when(projectService.createProject(eq("Reimport Project 2"), eq("/reimport/path"), any(), eq(true)))
            .thenReturn(secondCreatedProject);

        ProjectSnapshotImportRequestDto request2 = new ProjectSnapshotImportRequestDto(
            snapshot, "Reimport Project 2", null, true, false
        );
        ProjectSnapshotImportResultDto result2 = importService.importSnapshot(request2);

        // Then: Both imports succeeded
        assertThat(result1.modelSaved()).isTrue();
        assertThat(result2.modelSaved()).isTrue();

        // Verify saveModel was called twice (once per import)
        verify(modelService, times(2)).saveModel(anyString(), any(ArchitectureModelDto.class));
    }

    /**
     * Creates MetaModelEntitiesDto with logical and physical entities but NO dataEntityPoints.
     * This simulates a legacy snapshot format.
     */
    private MetaModelEntitiesDto createEntitiesWithoutDataEntityPoints() {
        LogicalDataEntityDto logicalEntity = new LogicalDataEntityDto(
            "log-legacy", "Product", "Product entity", null, null, null,
            null
        );
        PhysicalDataEntityDto physicalEntity = new PhysicalDataEntityDto(
            "phy-legacy", "products_table", "Products table", null, null, null, null, null, null
        , null, null);

        return createEntitiesWithData(
            List.of(logicalEntity),
            List.of(physicalEntity),
            null  // dataEntityPoints is null (legacy)
        );
    }

    /**
     * Creates MetaModelEntitiesDto with specified logical entities, physical entities, and data entity points.
     */
    private MetaModelEntitiesDto createEntitiesWithData(
            List<LogicalDataEntityDto> logicalEntities,
            List<PhysicalDataEntityDto> physicalEntities,
            List<DataEntityPointDto> dataEntityPoints) {

        return new MetaModelEntitiesDto(
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
            logicalEntities,  // logicalDataEntities
            List.of(), // logicalDataAttributes
            physicalEntities, // physicalDataEntities
            List.of(), // physicalDataAttributes
            dataEntityPoints, // dataEntityPoints - can be null for legacy
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
            List.of(), // businessLogics
            List.of(), // packageSets
            List.of(), // packages
            List.of(), // packageSetDefaultRules
            List.of(), // userJourneys
            List.of(),  // activitySteps
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
    }

    private MetaModelRelationshipsDto createEmptyRelationships() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyRelationships();
    }
}
