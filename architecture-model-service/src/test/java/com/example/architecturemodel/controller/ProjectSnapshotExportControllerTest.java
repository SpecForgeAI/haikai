package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.SnapshotMeta;
import com.example.architecturemodel.service.ProjectService;
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

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for GET /api/projects/active/export endpoint.
 *
 * Spec 2026-01-06: Project Snapshot JSON Export
 * Task Group 3: API Layer Tests
 */
@WebMvcTest(ActiveProjectController.class)
class ProjectSnapshotExportControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private ProjectService projectService;

    @MockBean
    private ProjectSnapshotService projectSnapshotService;

    @MockBean
    private com.example.architecturemodel.service.ProjectSnapshotImportService projectSnapshotImportService;

    private ProjectSnapshotDto testSnapshot;
    private UUID testProjectId;

    @BeforeEach
    void setUp() {
        testProjectId = UUID.randomUUID();
        Instant now = Instant.now();

        ProjectDto project = new ProjectDto(
            testProjectId,
            "Test Project",
            "/projects/test",
            null, // projectHierarchy
            null, // organisationId
            null, // repoUrl
            true,
            now,
            now
        );

        SnapshotMeta meta = new SnapshotMeta(1, now, "PROJECT_SNAPSHOT");

        ArchitectureModelDto model = createEmptyModel();

        testSnapshot = new ProjectSnapshotDto(
            meta,
            project,
            model,
            List.of(),
            List.of()
        );
    }

    @Test
    @DisplayName("GET /api/projects/active/export returns 200 with ProjectSnapshotDto when active project exists")
    void testExportActiveProject_returns200_whenActiveProjectExists() throws Exception {
        when(projectSnapshotService.exportActiveProjectSnapshot()).thenReturn(testSnapshot);

        mockMvc.perform(get("/api/projects/active/export")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.meta").exists())
            .andExpect(jsonPath("$.project").exists())
            .andExpect(jsonPath("$.model").exists())
            .andExpect(jsonPath("$.work_items").isArray())
            .andExpect(jsonPath("$.artifacts").isArray());
    }

    @Test
    @DisplayName("GET /api/projects/active/export returns 404 with message when no active project")
    void testExportActiveProject_returns404_whenNoActiveProject() throws Exception {
        when(projectSnapshotService.exportActiveProjectSnapshot())
            .thenThrow(new ResourceNotFoundException("No active project."));

        mockMvc.perform(get("/api/projects/active/export")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("GET /api/projects/active/export returns Content-Type application/json")
    void testExportActiveProject_returnsApplicationJsonContentType() throws Exception {
        when(projectSnapshotService.exportActiveProjectSnapshot()).thenReturn(testSnapshot);

        mockMvc.perform(get("/api/projects/active/export")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON));
    }

    @Test
    @DisplayName("GET /api/projects/active/export includes all expected top-level fields")
    void testExportActiveProject_includesAllExpectedFields() throws Exception {
        when(projectSnapshotService.exportActiveProjectSnapshot()).thenReturn(testSnapshot);

        mockMvc.perform(get("/api/projects/active/export")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            // Verify meta fields
            .andExpect(jsonPath("$.meta.snapshot_version").value(1))
            .andExpect(jsonPath("$.meta.export_kind").value("PROJECT_SNAPSHOT"))
            .andExpect(jsonPath("$.meta.exported_at").exists())
            // Verify project fields
            .andExpect(jsonPath("$.project.id").value(testProjectId.toString()))
            .andExpect(jsonPath("$.project.name").value("Test Project"))
            // Verify model structure
            .andExpect(jsonPath("$.model.metaModel").exists())
            .andExpect(jsonPath("$.model.diagrams").isArray())
            // Verify work_items and artifacts arrays
            .andExpect(jsonPath("$.work_items").isArray())
            .andExpect(jsonPath("$.artifacts").isArray());
    }

    /**
     * Helper method to create an empty ArchitectureModelDto.
     */
    private ArchitectureModelDto createEmptyModel() {
        MetaModelEntitiesDto entities = com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyEntities();
        MetaModelRelationshipsDto relationships = com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyRelationships();
        return new ArchitectureModelDto(new MetaModelDto(entities, relationships), List.of());
    }
}
