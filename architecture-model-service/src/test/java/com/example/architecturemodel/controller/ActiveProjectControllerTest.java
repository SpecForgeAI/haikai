package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportRequestDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportResultDto;
import com.example.architecturemodel.service.ProjectService;
import com.example.architecturemodel.service.ProjectSnapshotImportService;
import com.example.architecturemodel.service.ProjectSnapshotService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for ActiveProjectController.
 *
 * Spec 2026-01-22: Finalize DB/Session Separation (Phase 4)
 * Task Group 2: Update ActiveProjectController Tests
 *
 * This controller is now DB-conditional (only loaded when include-database=true).
 * Tests verify DB-only behavior:
 * - GET /api/projects/active delegates to ProjectService
 * - GET /api/projects/active/export delegates to ProjectSnapshotService
 * - POST /api/projects/import delegates to ProjectSnapshotImportService
 *
 * No-DB mode tests are NOT included here because:
 * - When include-database=false, this controller is not loaded
 * - API contract smoke tests (ApiContractSmokeTest) verify 404 behavior in no-DB mode
 *
 * Phase 4 Changes:
 * - Removed all no-DB mode tests (controller not loaded in no-DB mode)
 * - Removed mocks for SessionProjectStore and AppFeaturesProperties
 * - Simplified to DB-only service mocking
 */
@WebMvcTest(ActiveProjectController.class)
class ActiveProjectControllerTest {

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

    private ProjectDto testProject;
    private ProjectSnapshotDto testSnapshot;

    @BeforeEach
    void setUp() {
        testProject = createTestProject("Test Project");
        testSnapshot = createTestSnapshot(testProject);
    }

    // ============================================================================
    // GET /api/projects/active Tests
    // ============================================================================

    @Nested
    @DisplayName("GET /api/projects/active")
    class GetActiveProjectTests {

        @Test
        @DisplayName("returns 200 with project when active project exists")
        void testGetActiveProjectReturnsProject() throws Exception {
            // Given
            when(projectService.getActiveProject()).thenReturn(testProject);

            // When/Then
            mockMvc.perform(get("/api/projects/active")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Test Project"))
                .andExpect(jsonPath("$.is_active").value(true));
        }

        @Test
        @DisplayName("returns 404 when no active project exists")
        void testGetActiveProjectReturns404WhenNoActiveProject() throws Exception {
            // Given
            when(projectService.getActiveProject())
                .thenThrow(new ResourceNotFoundException("No active project."));

            // When/Then
            mockMvc.perform(get("/api/projects/active")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound());
        }
    }

    // ============================================================================
    // GET /api/projects/active/export Tests
    // ============================================================================

    @Nested
    @DisplayName("GET /api/projects/active/export")
    class ExportActiveProjectTests {

        @Test
        @DisplayName("returns 200 with snapshot when active project exists")
        void testExportActiveProjectReturnsSnapshot() throws Exception {
            // Given
            when(projectSnapshotService.exportActiveProjectSnapshot()).thenReturn(testSnapshot);

            // When/Then
            mockMvc.perform(get("/api/projects/active/export")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.project.name").value("Test Project"));
        }

        @Test
        @DisplayName("returns 404 when no active project exists")
        void testExportActiveProjectReturns404WhenNoActiveProject() throws Exception {
            // Given
            when(projectSnapshotService.exportActiveProjectSnapshot())
                .thenThrow(new ResourceNotFoundException("No active project."));

            // When/Then
            mockMvc.perform(get("/api/projects/active/export")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound());
        }
    }

    // ============================================================================
    // POST /api/projects/import Tests
    // ============================================================================

    @Nested
    @DisplayName("POST /api/projects/import")
    class ImportProjectTests {

        @Test
        @DisplayName("returns 201 with result on successful import")
        void testImportProjectReturns201() throws Exception {
            // Given
            ProjectSnapshotImportResultDto result = ProjectSnapshotImportResultDto.of(
                testProject, true, 5, 3
            );
            when(projectSnapshotImportService.importSnapshot(any())).thenReturn(result);

            ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
                testSnapshot, null, null, true, false
            );

            // When/Then
            mockMvc.perform(post("/api/projects/import")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.model_saved").value(true))
                .andExpect(jsonPath("$.work_items_inserted").value(5))
                .andExpect(jsonPath("$.artifacts_inserted").value(3));
        }

        @Test
        @DisplayName("returns result with project details")
        void testImportProjectReturnsProjectDetails() throws Exception {
            // Given
            ProjectSnapshotImportResultDto result = ProjectSnapshotImportResultDto.of(
                testProject, true, 0, 0
            );
            when(projectSnapshotImportService.importSnapshot(any())).thenReturn(result);

            ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
                testSnapshot, null, null, true, false
            );

            // When/Then
            mockMvc.perform(post("/api/projects/import")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.project.name").value("Test Project"))
                .andExpect(jsonPath("$.project.is_active").value(true));
        }
    }

    // Helper methods

    private ProjectDto createTestProject(String name) {
        return new ProjectDto(
            UUID.randomUUID(),
            name,
            null,  // projectParentFolder
            null,  // projectHierarchy
            null,  // organisationId
            null,  // repoUrl
            true,  // isActive
            Instant.now(),
            Instant.now()
        );
    }

    private ProjectSnapshotDto createTestSnapshot(ProjectDto project) {
        return new ProjectSnapshotDto(
            null,  // meta
            project,
            null,  // model
            null,  // workItems
            null   // artifacts
        );
    }
}
