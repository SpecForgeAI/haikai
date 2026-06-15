package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportRequestDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportResultDto;
import com.example.architecturemodel.model.dto.export.SnapshotMeta;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.entity.ProjectArtifactRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.service.ProjectSnapshotImportService;
import com.example.architecturemodel.service.ProjectService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration tests for Project Snapshot Import overwrite functionality.
 *
 * Spec 2026-01-07: Overwrite Existing Project Option for Snapshot Import
 * Task Group 2: API Integration Tests
 *
 * Tests the complete import flow including:
 * - Test 1: POST with existing name and no overwrite flag returns 409 with error message
 * - Test 2: POST with existing name and overwrite_existing_project=true returns 201
 * - Test 3: After overwrite, verify old project data is gone
 * - Test 4: Verify response body matches ProjectSnapshotImportResultDto structure
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class ProjectSnapshotOverwriteImportIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ProjectSnapshotImportService importService;

    @Autowired
    private ProjectService projectService;

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private WorkItemRepository workItemRepository;

    @Autowired
    private ProjectArtifactRepository projectArtifactRepository;

    private Instant now;

    @BeforeEach
    void setUp() {
        now = Instant.now();
        // Clean up any existing data
        workItemRepository.deleteAll();
        projectArtifactRepository.deleteAll();
        projectRepository.deleteAll();
    }

    @Nested
    @DisplayName("Overwrite Import API Tests (Spec 2026-01-07)")
    class OverwriteImportApiTests {

        @Test
        @DisplayName("Test 1: POST /api/projects/import with existing name and no overwrite flag returns 409")
        void testImportExistingProjectWithoutOverwriteReturns409() throws Exception {
            // Arrange: Create an existing project
            ProjectDto existingProject = projectService.createProject(
                "Test Project",
                "/existing/path",
                null,
                true
            );

            // Create import request without overwrite flag (or false)
            Map<String, Object> requestBody = buildImportRequestBody(
                "Test Project",
                "/new/path",
                true,
                false  // overwrite = false
            );

            // Act & Assert
            MvcResult result = mockMvc.perform(post("/api/projects/import")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(requestBody)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.error").value("Conflict"))
                .andExpect(jsonPath("$.message").value("Project name already exists: Test Project"))
                .andReturn();

            // Verify original project still exists
            assertThat(projectRepository.findByName("Test Project")).isPresent();
        }

        @Test
        @DisplayName("Test 2: POST /api/projects/import with existing name and overwrite=true returns 201")
        void testImportExistingProjectWithOverwriteReturns201() throws Exception {
            // Arrange: Create an existing project
            ProjectDto existingProject = projectService.createProject(
                "Test Project",
                "/existing/path",
                null,
                true
            );

            UUID oldProjectId = existingProject.id();

            // Create import request with overwrite = true
            Map<String, Object> requestBody = buildImportRequestBody(
                "Test Project",
                "/new/path",
                true,
                true  // overwrite = true
            );

            // Act & Assert
            MvcResult result = mockMvc.perform(post("/api/projects/import")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(requestBody)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.project").exists())
                .andExpect(jsonPath("$.project.name").value("Test Project"))
                .andExpect(jsonPath("$.project.project_parent_folder").value(
                    java.nio.file.Paths.get("/new/path").toAbsolutePath().normalize().toString() + "/"))
                .andReturn();

            // Verify old project is gone and new project exists
            assertThat(projectRepository.findById(oldProjectId)).isEmpty();
            assertThat(projectRepository.findByName("Test Project")).isPresent();

            // Verify the new project has a different ID
            ProjectEntity newProject = projectRepository.findByName("Test Project").get();
            assertThat(newProject.getId()).isNotEqualTo(oldProjectId);
            assertThat(newProject.getProjectParentFolder()).isEqualTo(
                java.nio.file.Paths.get("/new/path").toAbsolutePath().normalize().toString() + "/");
        }

        @Test
        @DisplayName("Test 3: After overwrite, verify old project data (work items, artifacts) is gone")
        @Transactional
        void testOverwriteRemovesOldProjectData() throws Exception {
            // Arrange: Create an existing project with work items
            ProjectDto existingProject = projectService.createProject(
                "Test Project",
                "/existing/path",
                null,
                true
            );

            UUID existingProjectId = existingProject.id();

            // Add some work items to the existing project
            WorkItemEntity oldWorkItem = WorkItemEntity.builder()
                .id(UUID.randomUUID())
                .projectId(existingProjectId)
                .type("INITIATIVE")
                .title("Old Initiative")
                .description("Old Description")
                .status("PLANNED")
                .sortOrder(1)
                .createdAt(now)
                .updatedAt(now)
                .build();
            workItemRepository.save(oldWorkItem);

            // Verify old data exists
            assertThat(workItemRepository.countByProjectId(existingProjectId)).isEqualTo(1);

            // Create import request with overwrite = true and new work items
            Map<String, Object> requestBody = buildImportRequestBodyWithWorkItems(
                "Test Project",
                "/new/path",
                true,
                true,  // overwrite = true
                List.of(Map.of(
                    "id", UUID.randomUUID().toString(),
                    "type", "INITIATIVE",
                    "title", "New Initiative",
                    "description", "New Description",
                    "status", "IN_PROGRESS"
                ))
            );

            // Act
            mockMvc.perform(post("/api/projects/import")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(requestBody)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.work_items_inserted").value(1));

            // Assert: Old work items are gone
            assertThat(workItemRepository.countByProjectId(existingProjectId)).isEqualTo(0);

            // Verify new project has only new work items
            ProjectEntity newProject = projectRepository.findByName("Test Project").get();
            UUID newProjectId = newProject.getId();
            List<WorkItemEntity> newWorkItems = workItemRepository
                .findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(newProjectId);

            assertThat(newWorkItems).hasSize(1);
            assertThat(newWorkItems.get(0).getTitle()).isEqualTo("New Initiative");
            assertThat(newWorkItems.get(0).getStatus()).isEqualTo("IN_PROGRESS");
        }

        @Test
        @DisplayName("Test 4: Verify response body matches ProjectSnapshotImportResultDto structure")
        void testResponseBodyMatchesExpectedStructure() throws Exception {
            // Create import request (no existing project)
            Map<String, Object> requestBody = buildImportRequestBodyWithWorkItems(
                "New Project",
                "/new/path",
                true,
                false,
                List.of(
                    Map.of(
                        "id", UUID.randomUUID().toString(),
                        "type", "INITIATIVE",
                        "title", "Initiative 1",
                        "status", "PLANNED"
                    ),
                    Map.of(
                        "id", UUID.randomUUID().toString(),
                        "type", "EPIC",
                        "title", "Epic 1",
                        "status", "PLANNED"
                    )
                )
            );

            // Act & Assert
            mockMvc.perform(post("/api/projects/import")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(requestBody)))
                .andExpect(status().isCreated())
                // Verify structure matches ProjectSnapshotImportResultDto
                .andExpect(jsonPath("$.project").exists())
                .andExpect(jsonPath("$.project.id").exists())
                .andExpect(jsonPath("$.project.name").value("New Project"))
                .andExpect(jsonPath("$.project.project_parent_folder").value(
                    java.nio.file.Paths.get("/new/path").toAbsolutePath().normalize().toString() + "/"))
                .andExpect(jsonPath("$.project.is_active").value(true))
                .andExpect(jsonPath("$.project.created_at").exists())
                .andExpect(jsonPath("$.project.updated_at").exists())
                .andExpect(jsonPath("$.model_saved").value(true))
                .andExpect(jsonPath("$.work_items_inserted").value(2))
                .andExpect(jsonPath("$.artifacts_inserted").value(0))
                .andExpect(jsonPath("$.warnings").isArray());
        }
    }

    @Nested
    @DisplayName("Request Payload Deserialization Tests")
    class RequestPayloadDeserializationTests {

        @Test
        @DisplayName("Deserializes snake_case overwrite_existing_project field")
        void testDeserializesSnakeCaseOverwriteField() throws Exception {
            // Arrange: Create an existing project
            projectService.createProject("Test Project", "/existing/path", null, true);

            // Create request with snake_case field name
            String jsonBody = """
                {
                    "snapshot": {
                        "meta": {
                            "snapshot_version": 1,
                            "exported_at": "2026-01-07T12:00:00Z",
                            "export_kind": "PROJECT_SNAPSHOT"
                        },
                        "project": {
                            "id": "550e8400-e29b-41d4-a716-446655440000",
                            "name": "Test Project",
                            "projectParentFolder": "/snapshot/path",
                            "isActive": true,
                            "createdAt": "2026-01-07T10:00:00Z",
                            "updatedAt": "2026-01-07T11:00:00Z"
                        },
                        "model": {
                            "metaModel": {
                                "entities": {},
                                "relationships": {}
                            },
                            "diagrams": []
                        },
                        "work_items": [],
                        "artifacts": []
                    },
                    "project_parent_folder": "/new/path",
                    "set_active": true,
                    "overwrite_existing_project": true
                }
                """;

            // Act & Assert: Should succeed with overwrite
            mockMvc.perform(post("/api/projects/import")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(jsonBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.project.name").value("Test Project"));
        }

        @Test
        @DisplayName("Deserializes camelCase overwriteExistingProject field via @JsonAlias")
        void testDeserializesCamelCaseOverwriteField() throws Exception {
            // Arrange: Create an existing project
            projectService.createProject("Test Project", "/existing/path", null, true);

            // Create request with camelCase field name
            String jsonBody = """
                {
                    "snapshot": {
                        "meta": {
                            "snapshot_version": 1,
                            "exported_at": "2026-01-07T12:00:00Z",
                            "export_kind": "PROJECT_SNAPSHOT"
                        },
                        "project": {
                            "id": "550e8400-e29b-41d4-a716-446655440000",
                            "name": "Test Project",
                            "projectParentFolder": "/snapshot/path",
                            "isActive": true,
                            "createdAt": "2026-01-07T10:00:00Z",
                            "updatedAt": "2026-01-07T11:00:00Z"
                        },
                        "model": {
                            "metaModel": {
                                "entities": {},
                                "relationships": {}
                            },
                            "diagrams": []
                        },
                        "work_items": [],
                        "artifacts": []
                    },
                    "project_parent_folder": "/new/path",
                    "set_active": true,
                    "overwriteExistingProject": true
                }
                """;

            // Act & Assert: Should succeed with overwrite
            mockMvc.perform(post("/api/projects/import")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(jsonBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.project.name").value("Test Project"));
        }

        @Test
        @DisplayName("Default value (null treated as false) works correctly")
        void testDefaultValueNullTreatedAsFalse() throws Exception {
            // Arrange: Create an existing project
            projectService.createProject("Test Project", "/existing/path", null, true);

            // Create request without overwrite field
            String jsonBody = """
                {
                    "snapshot": {
                        "meta": {
                            "snapshot_version": 1,
                            "exported_at": "2026-01-07T12:00:00Z",
                            "export_kind": "PROJECT_SNAPSHOT"
                        },
                        "project": {
                            "id": "550e8400-e29b-41d4-a716-446655440000",
                            "name": "Test Project",
                            "projectParentFolder": "/snapshot/path",
                            "isActive": true,
                            "createdAt": "2026-01-07T10:00:00Z",
                            "updatedAt": "2026-01-07T11:00:00Z"
                        },
                        "model": {
                            "metaModel": {
                                "entities": {},
                                "relationships": {}
                            },
                            "diagrams": []
                        },
                        "work_items": [],
                        "artifacts": []
                    },
                    "project_parent_folder": "/new/path",
                    "set_active": true
                }
                """;

            // Act & Assert: Should return 409 (default overwrite = false)
            mockMvc.perform(post("/api/projects/import")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(jsonBody))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("Project name already exists: Test Project"));
        }
    }

    /**
     * Helper method to build import request body.
     */
    private Map<String, Object> buildImportRequestBody(
            String projectName,
            String projectParentFolder,
            boolean setActive,
            boolean overwriteExistingProject) {
        return buildImportRequestBodyWithWorkItems(
            projectName, projectParentFolder, setActive, overwriteExistingProject, List.of()
        );
    }

    /**
     * Helper method to build import request body with work items.
     */
    private Map<String, Object> buildImportRequestBodyWithWorkItems(
            String projectName,
            String projectParentFolder,
            boolean setActive,
            boolean overwriteExistingProject,
            List<Map<String, Object>> workItems) {

        Map<String, Object> snapshot = new HashMap<>();

        // Meta
        Map<String, Object> meta = new HashMap<>();
        meta.put("snapshot_version", 1);
        meta.put("exported_at", now.toString());
        meta.put("export_kind", "PROJECT_SNAPSHOT");
        snapshot.put("meta", meta);

        // Project
        Map<String, Object> project = new HashMap<>();
        project.put("id", UUID.randomUUID().toString());
        project.put("name", projectName);
        project.put("projectParentFolder", "/original/path");
        project.put("isActive", true);
        project.put("createdAt", now.toString());
        project.put("updatedAt", now.toString());
        snapshot.put("project", project);

        // Model
        Map<String, Object> model = new HashMap<>();
        Map<String, Object> metaModel = new HashMap<>();
        metaModel.put("entities", Map.of());
        metaModel.put("relationships", Map.of());
        model.put("metaModel", metaModel);
        model.put("diagrams", List.of());
        snapshot.put("model", model);

        // Work items
        snapshot.put("work_items", workItems);

        // Artifacts
        snapshot.put("artifacts", List.of());

        // Build request
        Map<String, Object> request = new HashMap<>();
        request.put("snapshot", snapshot);
        request.put("project_parent_folder", projectParentFolder);
        request.put("set_active", setActive);
        request.put("overwrite_existing_project", overwriteExistingProject);

        return request;
    }
}
