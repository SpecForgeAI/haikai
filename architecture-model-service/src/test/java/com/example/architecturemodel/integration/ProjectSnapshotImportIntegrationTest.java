package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportRequestDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportResultDto;
import com.example.architecturemodel.model.dto.export.SnapshotMeta;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.entity.ProjectArtifactRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.service.ProjectSnapshotImportService;
import com.example.architecturemodel.service.ProjectSnapshotService;
import com.example.architecturemodel.service.ProjectService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for Project Snapshot Import feature.
 *
 * Tests the complete import flow including:
 * - Round-trip export/import verification
 * - set_active flag behavior
 * - Empty work items/artifacts handling
 * - import_as_name override
 *
 * Spec 2026-01-06: Project Snapshot JSON Import
 * Task Group 4: Integration Testing
 */
@SpringBootTest
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class ProjectSnapshotImportIntegrationTest {

    @Autowired
    private ProjectSnapshotImportService importService;

    @Autowired
    private ProjectSnapshotService snapshotService;

    @Autowired
    private ProjectService projectService;

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private WorkItemRepository workItemRepository;

    @Autowired
    private ProjectArtifactRepository projectArtifactRepository;

    @PersistenceContext
    private EntityManager entityManager;

    @BeforeEach
    void setUp() {
        // Clean up any existing data
        workItemRepository.deleteAll();
        projectArtifactRepository.deleteAll();
        projectRepository.deleteAll();
    }

    @Test
    @DisplayName("Round-trip: export active project, import as new project, verify all data matches")
    @Transactional
    void testRoundTripExportImport() {
        // Create and activate a project
        ProjectDto originalProject = projectService.createProject(
            "Original Project",
            "/original/path",
            null,
            true
        );

        // Export the project
        ProjectSnapshotDto snapshot = snapshotService.exportActiveProjectSnapshot();

        assertThat(snapshot).isNotNull();
        assertThat(snapshot.project().name()).isEqualTo("Original Project");
        assertThat(snapshot.meta().snapshotVersion()).isEqualTo(1);

        // Import as a new project
        ProjectSnapshotImportRequestDto importRequest = new ProjectSnapshotImportRequestDto(
            snapshot,
            "Imported Copy",
            "/imported/path",
            false,  // Don't activate, keep original active
            false
        );

        ProjectSnapshotImportResultDto result = importService.importSnapshot(importRequest);

        // Verify import result
        assertThat(result.project()).isNotNull();
        assertThat(result.project().name()).isEqualTo("Imported Copy");
        // createProject normalizes the parent folder to an absolute path with a
        // trailing separator so all consumers see the same location.
        assertThat(result.project().projectParentFolder()).isEqualTo(
            java.nio.file.Paths.get("/imported/path").toAbsolutePath().normalize().toString() + "/");
        assertThat(result.project().isActive()).isFalse();

        // Verify original project is still active
        ProjectDto activeProject = projectService.getActiveProject();
        assertThat(activeProject.id()).isEqualTo(originalProject.id());

        // Verify we now have two projects
        List<ProjectDto> allProjects = projectService.listProjects();
        assertThat(allProjects).hasSize(2);
    }

    @Test
    @DisplayName("Import with set_active=true deactivates previously active project")
    @Transactional
    void testSetActiveTrueDeactivatesOthers() {
        // Create first project (active)
        ProjectDto firstProject = projectService.createProject(
            "First Project",
            "/first/path",
            null,
            true
        );

        assertThat(firstProject.isActive()).isTrue();

        // Create snapshot for import
        ProjectSnapshotDto snapshot = createTestSnapshot("Second Project");

        // Import with set_active=true
        ProjectSnapshotImportRequestDto importRequest = new ProjectSnapshotImportRequestDto(
            snapshot,
            null,  // Use snapshot project name
            "/second/path",
            true,  // Make imported project active
            false
        );

        ProjectSnapshotImportResultDto result = importService.importSnapshot(importRequest);

        // Verify imported project is now active
        assertThat(result.project().isActive()).isTrue();

        // Verify first project is now inactive. deactivateAll() is a bulk JPQL
        // update that bypasses the persistence context, so clear the first-level
        // cache before refetching inside this @Transactional test.
        entityManager.clear();
        ProjectEntity firstEntity = projectRepository.findById(firstProject.id()).orElseThrow();
        assertThat(firstEntity.getIsActive()).isFalse();

        // Verify active project is the imported one
        ProjectDto activeProject = projectService.getActiveProject();
        assertThat(activeProject.id()).isEqualTo(result.project().id());
    }

    @Test
    @DisplayName("Import with set_active=false leaves existing active project active")
    @Transactional
    void testSetActiveFalseKeepsExistingActive() {
        // Create first project (active)
        ProjectDto firstProject = projectService.createProject(
            "First Project",
            "/first/path",
            null,
            true
        );

        // Create snapshot for import
        ProjectSnapshotDto snapshot = createTestSnapshot("Second Project");

        // Import with set_active=false
        ProjectSnapshotImportRequestDto importRequest = new ProjectSnapshotImportRequestDto(
            snapshot,
            null,
            "/second/path",
            false,  // Don't activate imported project
            false
        );

        ProjectSnapshotImportResultDto result = importService.importSnapshot(importRequest);

        // Verify imported project is not active
        assertThat(result.project().isActive()).isFalse();

        // Verify first project is still active
        ProjectDto activeProject = projectService.getActiveProject();
        assertThat(activeProject.id()).isEqualTo(firstProject.id());
    }

    @Test
    @DisplayName("Import with import_as_name override correctly renames project")
    @Transactional
    void testImportAsNameOverride() {
        // Create snapshot with one name
        ProjectSnapshotDto snapshot = createTestSnapshot("Original Name");

        // Import with different name
        ProjectSnapshotImportRequestDto importRequest = new ProjectSnapshotImportRequestDto(
            snapshot,
            "Renamed Project",  // Override name
            "/renamed/path",
            true,
            false
        );

        ProjectSnapshotImportResultDto result = importService.importSnapshot(importRequest);

        // Verify project has the overridden name
        assertThat(result.project().name()).isEqualTo("Renamed Project");

        // Verify we can find it by the new name
        List<ProjectDto> projects = projectService.listProjects();
        assertThat(projects).hasSize(1);
        assertThat(projects.get(0).name()).isEqualTo("Renamed Project");
    }

    @Test
    @DisplayName("Import with empty work_items and artifacts lists succeeds")
    @Transactional
    void testImportWithEmptyWorkItemsAndArtifacts() {
        // Create snapshot with empty lists
        ProjectSnapshotDto snapshot = createTestSnapshot("Empty Project");

        ProjectSnapshotImportRequestDto importRequest = new ProjectSnapshotImportRequestDto(
            snapshot,
            null,
            "/empty/path",
            true,
            false
        );

        ProjectSnapshotImportResultDto result = importService.importSnapshot(importRequest);

        // Verify import succeeded
        assertThat(result.project()).isNotNull();
        assertThat(result.workItemsInserted()).isEqualTo(0);
        assertThat(result.artifactsInserted()).isEqualTo(0);
        assertThat(result.modelSaved()).isTrue();
    }

    @Test
    @DisplayName("Import with work items preserves all fields and hierarchy")
    @Transactional
    void testImportWithWorkItemsPreservesData() {
        UUID initiativeId = UUID.randomUUID();
        UUID epicId = UUID.randomUUID();
        UUID originalProjectId = UUID.randomUUID();
        Instant now = Instant.now();

        // Create work items with parent-child relationship
        WorkItemDto initiative = new WorkItemDto(
            initiativeId, originalProjectId, "INITIATIVE", null,
            "Test Initiative", "Initiative Description", "PLANNED", 1, 1, "Q1 2026",
            null, "JIRA", "PROJ-1", null, now, now
        );

        WorkItemDto epic = new WorkItemDto(
            epicId, originalProjectId, "EPIC", initiativeId,  // Parent reference
            "Test Epic", "Epic Description", "IN_PROGRESS", 2, 2, "Q2 2026",
            null, "JIRA", "PROJ-2", null, now, now
        );

        ProjectSnapshotDto snapshot = createTestSnapshotWithWorkItems(
            "Project With Work Items",
            List.of(initiative, epic)
        );

        ProjectSnapshotImportRequestDto importRequest = new ProjectSnapshotImportRequestDto(
            snapshot,
            null,
            "/work-items/path",
            true,
            false
        );

        ProjectSnapshotImportResultDto result = importService.importSnapshot(importRequest);

        // Verify work items were imported
        assertThat(result.workItemsInserted()).isEqualTo(2);

        // Verify work items exist in repository with correct project ID
        UUID newProjectId = result.project().id();
        var workItems = workItemRepository.findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(newProjectId);

        assertThat(workItems).hasSize(2);

        // Find initiative and epic
        var importedInitiative = workItems.stream()
            .filter(wi -> wi.getId().equals(initiativeId))
            .findFirst()
            .orElseThrow();

        var importedEpic = workItems.stream()
            .filter(wi -> wi.getId().equals(epicId))
            .findFirst()
            .orElseThrow();

        // Verify initiative fields
        assertThat(importedInitiative.getTitle()).isEqualTo("Test Initiative");
        assertThat(importedInitiative.getType()).isEqualTo("INITIATIVE");
        assertThat(importedInitiative.getParentId()).isNull();
        assertThat(importedInitiative.getExternalSystem()).isEqualTo("JIRA");
        assertThat(importedInitiative.getExternalKey()).isEqualTo("PROJ-1");

        // Verify epic parent reference is preserved
        assertThat(importedEpic.getParentId()).isEqualTo(initiativeId);
    }

    /**
     * Helper method to create a test snapshot.
     */
    private ProjectSnapshotDto createTestSnapshot(String projectName) {
        return createTestSnapshotWithWorkItems(projectName, List.of());
    }

    /**
     * Helper method to create a test snapshot with work items.
     */
    private ProjectSnapshotDto createTestSnapshotWithWorkItems(String projectName, List<WorkItemDto> workItems) {
        UUID projectId = UUID.randomUUID();
        Instant now = Instant.now();

        SnapshotMeta meta = new SnapshotMeta(1, now, "PROJECT_SNAPSHOT");

        ProjectDto project = new ProjectDto(
            projectId,
            projectName,
            "/original/path",
            null, // projectHierarchy
            null, // organisationId
            null, // repoUrl
            true,
            now,
            now
        );

        ArchitectureModelDto model = createEmptyModel();

        return new ProjectSnapshotDto(meta, project, model, workItems, List.of());
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
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of()
        );

        MetaModelRelationshipsDto relationships = new MetaModelRelationshipsDto(
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of()
        );

        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        return new ArchitectureModelDto(metaModel, List.of());
    }
}
