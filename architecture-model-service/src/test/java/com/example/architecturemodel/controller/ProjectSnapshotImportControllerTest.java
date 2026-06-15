package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportRequestDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportResultDto;
import com.example.architecturemodel.service.ProjectService;
import com.example.architecturemodel.service.ProjectSnapshotImportService;
import com.example.architecturemodel.service.ProjectSnapshotService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for ProjectController import endpoint.
 *
 * Spec 2026-01-06: Project Snapshot JSON Import
 * Task Group 3: API Layer Tests
 */
@WebMvcTest(ActiveProjectController.class)
class ProjectSnapshotImportControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private ProjectService projectService;

    @MockBean
    private ProjectSnapshotService projectSnapshotService;

    @MockBean
    private ProjectSnapshotImportService projectSnapshotImportService;

    private UUID testProjectId;
    private ProjectDto testProject;
    private ProjectSnapshotImportResultDto testResult;

    @BeforeEach
    void setUp() {
        testProjectId = UUID.randomUUID();
        Instant now = Instant.now();

        testProject = new ProjectDto(
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

        testResult = new ProjectSnapshotImportResultDto(
            testProject,
            true,
            5,
            3,
            List.of()
        );
    }

    @Test
    @DisplayName("POST /api/projects/import returns 201 Created with valid snapshot")
    void testImportProjectReturns201() throws Exception {
        when(projectSnapshotImportService.importSnapshot(any(ProjectSnapshotImportRequestDto.class)))
            .thenReturn(testResult);

        String requestBody = createValidImportRequestJson();

        mockMvc.perform(post("/api/projects/import")
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.project.id").value(testProjectId.toString()))
            .andExpect(jsonPath("$.project.name").value("Imported Project"))
            .andExpect(jsonPath("$.model_saved").value(true))
            .andExpect(jsonPath("$.work_items_inserted").value(5))
            .andExpect(jsonPath("$.artifacts_inserted").value(3))
            .andExpect(jsonPath("$.warnings").isArray())
            .andExpect(jsonPath("$.warnings").isEmpty());
    }

    @Test
    @DisplayName("POST /api/projects/import returns 400 Bad Request for unsupported snapshot_version")
    void testImportProjectReturns400ForUnsupportedVersion() throws Exception {
        when(projectSnapshotImportService.importSnapshot(any(ProjectSnapshotImportRequestDto.class)))
            .thenThrow(new IllegalArgumentException("Unsupported snapshot version: 2. Supported version: 1"));

        String requestBody = createImportRequestJsonWithVersion(2);

        mockMvc.perform(post("/api/projects/import")
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Unsupported snapshot version: 2. Supported version: 1"));
    }

    @Test
    @DisplayName("POST /api/projects/import returns 400 Bad Request for missing project_parent_folder")
    void testImportProjectReturns400ForMissingParentFolder() throws Exception {
        when(projectSnapshotImportService.importSnapshot(any(ProjectSnapshotImportRequestDto.class)))
            .thenThrow(new IllegalArgumentException("Project parent folder is required"));

        String requestBody = createImportRequestJsonWithoutParentFolder();

        mockMvc.perform(post("/api/projects/import")
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Project parent folder is required"));
    }

    @Test
    @DisplayName("POST /api/projects/import returns 409 Conflict for duplicate project name")
    void testImportProjectReturns409ForDuplicateName() throws Exception {
        when(projectSnapshotImportService.importSnapshot(any(ProjectSnapshotImportRequestDto.class)))
            .thenThrow(new ConflictException("Project name already exists: Existing Project"));

        String requestBody = createValidImportRequestJson();

        mockMvc.perform(post("/api/projects/import")
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.message").value("Project name already exists: Existing Project"));
    }

    @Test
    @DisplayName("POST /api/projects/import returns 409 Conflict for ID collision")
    void testImportProjectReturns409ForIdCollision() throws Exception {
        UUID collidingId = UUID.randomUUID();
        when(projectSnapshotImportService.importSnapshot(any(ProjectSnapshotImportRequestDto.class)))
            .thenThrow(new ConflictException("Work item ID already exists: " + collidingId));

        String requestBody = createValidImportRequestJson();

        mockMvc.perform(post("/api/projects/import")
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.message").value("Work item ID already exists: " + collidingId));
    }

    @Test
    @DisplayName("POST /api/projects/import response body matches ProjectSnapshotImportResultDto structure")
    void testImportProjectResponseStructure() throws Exception {
        when(projectSnapshotImportService.importSnapshot(any(ProjectSnapshotImportRequestDto.class)))
            .thenReturn(testResult);

        String requestBody = createValidImportRequestJson();

        mockMvc.perform(post("/api/projects/import")
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isCreated())
            // Verify all expected fields in response
            .andExpect(jsonPath("$.project").exists())
            .andExpect(jsonPath("$.project.id").exists())
            .andExpect(jsonPath("$.project.name").exists())
            .andExpect(jsonPath("$.project.project_parent_folder").exists())
            .andExpect(jsonPath("$.project.is_active").exists())
            .andExpect(jsonPath("$.model_saved").exists())
            .andExpect(jsonPath("$.work_items_inserted").exists())
            .andExpect(jsonPath("$.artifacts_inserted").exists())
            .andExpect(jsonPath("$.warnings").exists());
    }

    /**
     * Creates a valid import request JSON for testing.
     */
    private String createValidImportRequestJson() {
        return """
            {
                "snapshot": {
                    "meta": {
                        "snapshot_version": 1,
                        "exported_at": "2026-01-06T12:00:00Z",
                        "export_kind": "PROJECT_SNAPSHOT"
                    },
                    "project": {
                        "id": "550e8400-e29b-41d4-a716-446655440000",
                        "name": "Original Project",
                        "project_parent_folder": "/original/path",
                        "is_active": true,
                        "created_at": "2026-01-06T10:00:00Z",
                        "updated_at": "2026-01-06T11:00:00Z"
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
                "import_as_name": "Imported Project",
                "project_parent_folder": "/new/path",
                "set_active": true
            }
            """;
    }

    /**
     * Creates an import request JSON with a specific snapshot version.
     */
    private String createImportRequestJsonWithVersion(int version) {
        return """
            {
                "snapshot": {
                    "meta": {
                        "snapshot_version": %d,
                        "exported_at": "2026-01-06T12:00:00Z",
                        "export_kind": "PROJECT_SNAPSHOT"
                    },
                    "project": {
                        "id": "550e8400-e29b-41d4-a716-446655440000",
                        "name": "Original Project",
                        "project_parent_folder": "/original/path",
                        "is_active": true
                    },
                    "model": {
                        "metaModel": {"entities": {}, "relationships": {}},
                        "diagrams": []
                    },
                    "work_items": [],
                    "artifacts": []
                },
                "project_parent_folder": "/new/path"
            }
            """.formatted(version);
    }

    /**
     * Creates an import request JSON without project_parent_folder.
     */
    private String createImportRequestJsonWithoutParentFolder() {
        return """
            {
                "snapshot": {
                    "meta": {
                        "snapshot_version": 1,
                        "exported_at": "2026-01-06T12:00:00Z",
                        "export_kind": "PROJECT_SNAPSHOT"
                    },
                    "project": {
                        "id": "550e8400-e29b-41d4-a716-446655440000",
                        "name": "Original Project",
                        "project_parent_folder": "/original/path",
                        "is_active": true
                    },
                    "model": {
                        "metaModel": {"entities": {}, "relationships": {}},
                        "diagrams": []
                    },
                    "work_items": [],
                    "artifacts": []
                }
            }
            """;
    }
}
