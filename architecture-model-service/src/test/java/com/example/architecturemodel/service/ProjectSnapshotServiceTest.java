package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.ProjectArtifactMapper;
import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.entity.ProjectArtifactEntity;
import com.example.architecturemodel.repository.entity.ProjectArtifactRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Unit tests for ProjectSnapshotService.
 *
 * Spec 2026-01-06: Project Snapshot JSON Export
 * Task Group 2: Service Layer Tests
 *
 * Spec 2026-01-10: Project Hierarchy Grouping - Updated ProjectDto constructor
 */
@ExtendWith(MockitoExtension.class)
class ProjectSnapshotServiceTest {

    @Mock
    private ProjectService projectService;

    @Mock
    private ModelService modelService;

    @Mock
    private WorkItemService workItemService;

    @Mock
    private ProjectArtifactRepository projectArtifactRepository;

    @InjectMocks
    private ProjectSnapshotService projectSnapshotService;

    private ProjectDto testProject;
    private UUID testProjectId;
    private ArchitectureModelDto testModel;

    @BeforeEach
    void setUp() {
        testProjectId = UUID.randomUUID();
        // Updated to include projectHierarchy field (null for this test)
        testProject = new ProjectDto(
            testProjectId,
            "Test Project",
            "/projects/test",
            null, // projectHierarchy - Spec 2026-01-10
            null, // organisationId
            null, // repoUrl
            true,
            Instant.now(),
            Instant.now()
        );

        // Create empty model for test
        testModel = createEmptyModel();
    }

    @Test
    @DisplayName("exportActiveProjectSnapshot returns complete snapshot when active project exists")
    void exportActiveProjectSnapshot_returnsCompleteSnapshot_whenActiveProjectExists() {
        // Setup mocks
        when(projectService.getActiveProject()).thenReturn(testProject);
        when(modelService.loadModel(testProject.name())).thenReturn(testModel);
        when(workItemService.getWorkItems(testProjectId, null, null)).thenReturn(List.of());
        when(projectArtifactRepository.findByProjectIdOrderByCreatedAtDesc(testProjectId))
            .thenReturn(List.of());

        // Execute
        ProjectSnapshotDto result = projectSnapshotService.exportActiveProjectSnapshot();

        // Verify
        assertThat(result).isNotNull();
        assertThat(result.project()).isEqualTo(testProject);
        assertThat(result.model()).isNotNull();
        assertThat(result.workItems()).isNotNull();
        assertThat(result.artifacts()).isNotNull();
        assertThat(result.meta()).isNotNull();
    }

    @Test
    @DisplayName("exportActiveProjectSnapshot throws ResourceNotFoundException when no active project")
    void exportActiveProjectSnapshot_throwsException_whenNoActiveProject() {
        // Setup mock to throw
        when(projectService.getActiveProject())
            .thenThrow(new ResourceNotFoundException("No active project."));

        // Execute & Verify
        assertThatThrownBy(() -> projectSnapshotService.exportActiveProjectSnapshot())
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("No active project");
    }

    @Test
    @DisplayName("exportActiveProjectSnapshot handles missing model gracefully with empty default model")
    void exportActiveProjectSnapshot_handlessMissingModel_returnsEmptyModel() {
        // Setup mocks - model throws exception
        when(projectService.getActiveProject()).thenReturn(testProject);
        when(modelService.loadModel(testProject.name()))
            .thenThrow(new ResourceNotFoundException("Model file not found"));
        when(workItemService.getWorkItems(testProjectId, null, null)).thenReturn(List.of());
        when(projectArtifactRepository.findByProjectIdOrderByCreatedAtDesc(testProjectId))
            .thenReturn(List.of());

        // Execute
        ProjectSnapshotDto result = projectSnapshotService.exportActiveProjectSnapshot();

        // Verify - should return empty model instead of throwing
        assertThat(result).isNotNull();
        assertThat(result.model()).isNotNull();
        assertThat(result.model().metaModel()).isNotNull();
        assertThat(result.model().diagrams()).isEmpty();
    }

    @Test
    @DisplayName("exportActiveProjectSnapshot sets snapshot_version to 1")
    void exportActiveProjectSnapshot_setsSnapshotVersionTo1() {
        // Setup mocks
        when(projectService.getActiveProject()).thenReturn(testProject);
        when(modelService.loadModel(testProject.name())).thenReturn(testModel);
        when(workItemService.getWorkItems(testProjectId, null, null)).thenReturn(List.of());
        when(projectArtifactRepository.findByProjectIdOrderByCreatedAtDesc(testProjectId))
            .thenReturn(List.of());

        // Execute
        ProjectSnapshotDto result = projectSnapshotService.exportActiveProjectSnapshot();

        // Verify
        assertThat(result.meta().snapshotVersion()).isEqualTo(1);
    }

    @Test
    @DisplayName("exportActiveProjectSnapshot sets export_kind to PROJECT_SNAPSHOT")
    void exportActiveProjectSnapshot_setsExportKindToProjectSnapshot() {
        // Setup mocks
        when(projectService.getActiveProject()).thenReturn(testProject);
        when(modelService.loadModel(testProject.name())).thenReturn(testModel);
        when(workItemService.getWorkItems(testProjectId, null, null)).thenReturn(List.of());
        when(projectArtifactRepository.findByProjectIdOrderByCreatedAtDesc(testProjectId))
            .thenReturn(List.of());

        // Execute
        ProjectSnapshotDto result = projectSnapshotService.exportActiveProjectSnapshot();

        // Verify
        assertThat(result.meta().exportKind()).isEqualTo("PROJECT_SNAPSHOT");
    }

    @Test
    @DisplayName("exportActiveProjectSnapshot sets exported_at to current UTC time")
    void exportActiveProjectSnapshot_setsExportedAtToCurrentTime() {
        // Setup mocks
        when(projectService.getActiveProject()).thenReturn(testProject);
        when(modelService.loadModel(testProject.name())).thenReturn(testModel);
        when(workItemService.getWorkItems(testProjectId, null, null)).thenReturn(List.of());
        when(projectArtifactRepository.findByProjectIdOrderByCreatedAtDesc(testProjectId))
            .thenReturn(List.of());

        // Record time before execution
        Instant before = Instant.now();

        // Execute
        ProjectSnapshotDto result = projectSnapshotService.exportActiveProjectSnapshot();

        // Record time after execution
        Instant after = Instant.now();

        // Verify exported_at is within expected range (within 5 seconds tolerance)
        assertThat(result.meta().exportedAt()).isNotNull();
        assertThat(result.meta().exportedAt()).isAfterOrEqualTo(before);
        assertThat(result.meta().exportedAt()).isBeforeOrEqualTo(after);
    }

    /**
     * Helper method to create an empty ArchitectureModelDto.
     */
    private ArchitectureModelDto createEmptyModel() {
        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );

        MetaModelRelationshipsDto relationships = new MetaModelRelationshipsDto(
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );

        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        return new ArchitectureModelDto(metaModel, List.of());
    }
}
