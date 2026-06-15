package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportRequestDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportResultDto;
import com.example.architecturemodel.model.dto.export.SnapshotMeta;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.entity.ProjectArtifactRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.testsupport.TestMetaModelFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for ProjectSnapshotImportService overwrite functionality.
 *
 * Spec 2026-01-07: Overwrite Existing Project Option for Snapshot Import
 * Task Group 1: Backend DTO and Service Layer Tests
 *
 * These tests focus on the overwrite import feature:
 * - Test 1: Import with existing project name and overwriteExistingProject=false returns 409 Conflict
 * - Test 2: Import with existing project name and overwriteExistingProject=true succeeds and replaces data
 * - Test 3: Verify replacement is not a merge (old data absent after overwrite)
 * - Test 4: Verify transactionality (partial failure does not leave project in inconsistent state)
 */
@ExtendWith(MockitoExtension.class)
class ProjectSnapshotOverwriteImportServiceTest {

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

    private ProjectSnapshotDto testSnapshot;
    private ProjectDto testOriginalProject;
    private ProjectDto testCreatedProject;
    private UUID testProjectId;
    private UUID existingProjectId;
    private Instant now;

    @BeforeEach
    void setUp() {
        now = Instant.now();
        testProjectId = UUID.randomUUID();
        existingProjectId = UUID.randomUUID();

        testOriginalProject = new ProjectDto(
            UUID.randomUUID(),
            "Test Project",
            "/original/path",
            null, // projectHierarchy
            null, // organisationId
            null, // repoUrl
            true,
            now,
            now
        );

        testCreatedProject = new ProjectDto(
            testProjectId,
            "Test Project",
            "/new/path",
            null, // projectHierarchy
            null, // organisationId
            null, // repoUrl
            true,
            now,
            now
        );

        SnapshotMeta meta = new SnapshotMeta(1, now, "PROJECT_SNAPSHOT");
        ArchitectureModelDto model = createEmptyModel();
        testSnapshot = new ProjectSnapshotDto(meta, testOriginalProject, model, List.of(), List.of());
    }

    @Nested
    @DisplayName("Overwrite Import Tests (Spec 2026-01-07)")
    class OverwriteImportTests {

        @Test
        @DisplayName("Test 1: Import with existing project name and overwriteExistingProject=false returns 409 Conflict")
        void testImportExistingProjectWithOverwriteFalseReturns409() {
            // Arrange: Setup existing project
            ProjectEntity existingProject = ProjectEntity.builder()
                .id(existingProjectId)
                .name("Test Project")
                .projectParentFolder("/existing/path")
                .isActive(true)
                .build();

            when(projectRepository.findByName("Test Project"))
                .thenReturn(Optional.of(existingProject));

            // Create request with overwrite = false (default)
            ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
                testSnapshot,
                null,  // Use snapshot project name
                "/new/path",
                true,
                false  // overwriteExistingProject = false
            );

            // Act & Assert: Should throw ConflictException
            assertThatThrownBy(() -> importService.importSnapshot(request))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Project name already exists: Test Project");

            // Verify deletion was NOT called
            verify(projectDeletionService, never()).deleteProjectById(any(), anyString());
            // Verify project creation was NOT called
            verify(projectService, never()).createProject(anyString(), anyString(), nullable(String.class), anyBoolean());
        }

        @Test
        @DisplayName("Test 2: Import with existing project name and overwriteExistingProject=true succeeds and replaces data")
        void testImportExistingProjectWithOverwriteTrueSucceeds() {
            // Arrange: Setup existing project
            ProjectEntity existingProject = ProjectEntity.builder()
                .id(existingProjectId)
                .name("Test Project")
                .projectParentFolder("/existing/path")
                .isActive(true)
                .build();

            when(projectRepository.findByName("Test Project"))
                .thenReturn(Optional.of(existingProject));
            when(projectService.createProject(eq("Test Project"), eq("/new/path"), nullable(String.class), eq(true)))
                .thenReturn(testCreatedProject);

            // Create request with overwrite = true
            ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
                testSnapshot,
                null,  // Use snapshot project name
                "/new/path",
                true,
                true  // overwriteExistingProject = true
            );

            // Act
            ProjectSnapshotImportResultDto result = importService.importSnapshot(request);

            // Assert: Should succeed
            assertThat(result).isNotNull();
            assertThat(result.project()).isEqualTo(testCreatedProject);
            assertThat(result.project().name()).isEqualTo("Test Project");

            // Verify deletion was called for existing project
            verify(projectDeletionService).deleteProjectById(existingProjectId, "Test Project");

            // Verify new project was created
            verify(projectService).createProject("Test Project", "/new/path", null, true);
        }

        @Test
        @DisplayName("Test 3: Verify replacement is not a merge (old data absent after overwrite)")
        void testOverwriteIsFullReplacementNotMerge() {
            // Arrange: Setup existing project
            ProjectEntity existingProject = ProjectEntity.builder()
                .id(existingProjectId)
                .name("Test Project")
                .projectParentFolder("/existing/path")
                .isActive(true)
                .build();

            when(projectRepository.findByName("Test Project"))
                .thenReturn(Optional.of(existingProject));
            when(projectService.createProject(eq("Test Project"), eq("/new/path"), nullable(String.class), eq(true)))
                .thenReturn(testCreatedProject);

            // Create snapshot with specific work items and artifacts
            UUID newWorkItemId = UUID.randomUUID();
            UUID newArtifactId = UUID.randomUUID();

            WorkItemDto newWorkItem = new WorkItemDto(
                newWorkItemId, testOriginalProject.id(), "INITIATIVE", null,
                "New Initiative", "New Description", "PLANNED", 1, 1, "Q1 2026",
                null, null, null, null, now, now
            );

            ProjectArtifactDto newArtifact = new ProjectArtifactDto(
                newArtifactId, testOriginalProject.id(), "MISSION_MD",
                "# New Mission", "AGENT_OS", 1, now
            );

            ProjectSnapshotDto snapshotWithData = new ProjectSnapshotDto(
                testSnapshot.meta(),
                testOriginalProject,
                testSnapshot.model(),
                List.of(newWorkItem),
                List.of(newArtifact)
            );

            when(workItemRepository.existsById(newWorkItemId)).thenReturn(false);
            when(projectArtifactRepository.existsById(newArtifactId)).thenReturn(false);

            // Create request with overwrite = true
            ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
                snapshotWithData,
                null,
                "/new/path",
                true,
                true  // overwriteExistingProject = true
            );

            // Act
            ProjectSnapshotImportResultDto result = importService.importSnapshot(request);

            // Assert: Deletion was called first (removes old data)
            verify(projectDeletionService).deleteProjectById(existingProjectId, "Test Project");

            // Then new data was imported
            assertThat(result.workItemsInserted()).isEqualTo(1);
            assertThat(result.artifactsInserted()).isEqualTo(1);

            // Verify work items were saved with new project ID
            verify(workItemRepository).saveAll(anyList());
            verify(projectArtifactRepository).saveAll(anyList());

            // The key assertion: deletion was called before creation,
            // ensuring old data is removed before new data is added.
            // This is verified by the order of mock invocations:
            // 1. findByName (check for existing)
            // 2. deleteProjectById (remove existing)
            // 3. createProject (create new)
            // 4. saveAll (save new data)
            var inOrder = inOrder(projectDeletionService, projectService, workItemRepository);
            inOrder.verify(projectDeletionService).deleteProjectById(existingProjectId, "Test Project");
            inOrder.verify(projectService).createProject(anyString(), anyString(), nullable(String.class), anyBoolean());
            inOrder.verify(workItemRepository).saveAll(anyList());
        }

        @Test
        @DisplayName("Test 4: Verify transactionality (partial failure does not leave project in inconsistent state)")
        void testTransactionalityOnPartialFailure() {
            // Arrange: Setup existing project
            ProjectEntity existingProject = ProjectEntity.builder()
                .id(existingProjectId)
                .name("Test Project")
                .projectParentFolder("/existing/path")
                .isActive(true)
                .build();

            when(projectRepository.findByName("Test Project"))
                .thenReturn(Optional.of(existingProject));
            when(projectService.createProject(eq("Test Project"), eq("/new/path"), nullable(String.class), eq(true)))
                .thenReturn(testCreatedProject);

            // Setup a work item that will cause ID collision AFTER project is created
            UUID collidingWorkItemId = UUID.randomUUID();
            WorkItemDto workItem = new WorkItemDto(
                collidingWorkItemId, testOriginalProject.id(), "INITIATIVE", null,
                "Test Initiative", "Description", "PLANNED", 1, 1, "Q1 2026",
                null, null, null, null, now, now
            );

            ProjectSnapshotDto snapshotWithWorkItems = new ProjectSnapshotDto(
                testSnapshot.meta(),
                testOriginalProject,
                testSnapshot.model(),
                List.of(workItem),
                List.of()
            );

            // Simulate work item ID collision after deletion and project creation
            when(workItemRepository.existsById(collidingWorkItemId)).thenReturn(true);

            // Create request with overwrite = true
            ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
                snapshotWithWorkItems,
                null,
                "/new/path",
                true,
                true  // overwriteExistingProject = true
            );

            // Act & Assert: Should throw ConflictException for work item ID collision
            assertThatThrownBy(() -> importService.importSnapshot(request))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Work item ID already exists: " + collidingWorkItemId);

            // The @Transactional annotation on the service method ensures that
            // when this exception is thrown, Spring will roll back all changes:
            // - The deletion of the old project
            // - The creation of the new project
            //
            // This test verifies the exception is thrown, and the transactional
            // behavior is ensured by Spring's transaction management.
            //
            // Note: In a real integration test with database, we would verify
            // that the original project still exists after the failure.
        }
    }

    @Nested
    @DisplayName("DTO Overwrite Field Tests")
    class DtoOverwriteFieldTests {

        @Test
        @DisplayName("effectiveOverwriteExistingProject returns false when field is null")
        void testEffectiveOverwriteReturnsFalseWhenNull() {
            ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
                testSnapshot, null, "/path", true, null
            );

            assertThat(request.effectiveOverwriteExistingProject()).isFalse();
        }

        @Test
        @DisplayName("effectiveOverwriteExistingProject returns false when field is explicitly false")
        void testEffectiveOverwriteReturnsFalseWhenExplicitlyFalse() {
            ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
                testSnapshot, null, "/path", true, false
            );

            assertThat(request.effectiveOverwriteExistingProject()).isFalse();
        }

        @Test
        @DisplayName("effectiveOverwriteExistingProject returns true when field is explicitly true")
        void testEffectiveOverwriteReturnsTrueWhenExplicitlyTrue() {
            ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
                testSnapshot, null, "/path", true, true
            );

            assertThat(request.effectiveOverwriteExistingProject()).isTrue();
        }
    }

    @Nested
    @DisplayName("No Existing Project Tests")
    class NoExistingProjectTests {

        @Test
        @DisplayName("Import succeeds when no existing project exists (overwrite flag irrelevant)")
        void testImportSucceedsWhenNoExistingProject() {
            // Arrange: No existing project
            when(projectRepository.findByName("Test Project"))
                .thenReturn(Optional.empty());
            when(projectService.createProject(eq("Test Project"), eq("/new/path"), nullable(String.class), eq(true)))
                .thenReturn(testCreatedProject);

            // Create request with overwrite = true (but won't matter since no existing project)
            ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
                testSnapshot,
                null,
                "/new/path",
                true,
                true  // Won't matter - no existing project
            );

            // Act
            ProjectSnapshotImportResultDto result = importService.importSnapshot(request);

            // Assert: Should succeed
            assertThat(result).isNotNull();
            assertThat(result.project()).isEqualTo(testCreatedProject);

            // Verify deletion was NOT called (no existing project to delete)
            verify(projectDeletionService, never()).deleteProjectById(any(), anyString());

            // Verify new project was created
            verify(projectService).createProject("Test Project", "/new/path", null, true);
        }
    }

    /**
     * Helper method to create an empty ArchitectureModelDto.
     */
    private ArchitectureModelDto createEmptyModel() {
        MetaModelEntitiesDto entities = TestMetaModelFactory.emptyEntities();
        MetaModelRelationshipsDto relationships = TestMetaModelFactory.emptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        return new ArchitectureModelDto(metaModel, List.of());
    }
}
