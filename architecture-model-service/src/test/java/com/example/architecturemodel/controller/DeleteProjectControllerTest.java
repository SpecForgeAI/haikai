package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.service.OrganisationService;
import com.example.architecturemodel.service.ProjectService;
import com.example.architecturemodel.service.ProjectSnapshotImportService;
import com.example.architecturemodel.service.ProjectSnapshotService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.io.IOException;
import java.util.UUID;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for DELETE /api/projects/{id} endpoint.
 *
 * Spec 2026-01-10: Project Menu + Delete Project
 * Task Group 1: Backend Delete Project Implementation
 */
@WebMvcTest(ProjectController.class)
class DeleteProjectControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ProjectService projectService;

    @MockBean
    private OrganisationService organisationService;

    @MockBean
    private ProjectSnapshotService projectSnapshotService;

    // Spec 2026-06-12 (Implementation-Service Init, TG1): ProjectController now
    // injects the repo-map service; mocked here (Mockito default = empty list).
    @MockBean
    private com.example.architecturemodel.service.ProjectImplementationRepoService projectImplementationRepoService;

    @MockBean
    private ProjectSnapshotImportService projectSnapshotImportService;

    @Test
    @DisplayName("DELETE /api/projects/{id} returns 200 OK with success message when project exists")
    void testDeleteProject_returns200_whenProjectExists() throws Exception {
        UUID projectId = UUID.randomUUID();
        doNothing().when(projectService).deleteProject(projectId);

        mockMvc.perform(delete("/api/projects/{id}", projectId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.message").value("Project deleted successfully"));
    }

    @Test
    @DisplayName("DELETE /api/projects/{id} returns 404 Not Found when project does not exist")
    void testDeleteProject_returns404_whenProjectNotFound() throws Exception {
        UUID projectId = UUID.randomUUID();
        doThrow(new ResourceNotFoundException("Project not found with id: " + projectId))
            .when(projectService).deleteProject(projectId);

        mockMvc.perform(delete("/api/projects/{id}", projectId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value("Project not found with id: " + projectId));
    }

    @Test
    @DisplayName("DELETE /api/projects/{id} returns 400 Bad Request when projectParentFolder is blank/null")
    void testDeleteProject_returns400_whenParentFolderBlank() throws Exception {
        UUID projectId = UUID.randomUUID();
        doThrow(new IllegalArgumentException("Project parent folder is blank or invalid"))
            .when(projectService).deleteProject(projectId);

        mockMvc.perform(delete("/api/projects/{id}", projectId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Project parent folder is blank or invalid"));
    }

    @Test
    @DisplayName("DELETE /api/projects/{id} rejects root-like paths with 400 Bad Request")
    void testDeleteProject_returns400_forRootLikePaths() throws Exception {
        UUID projectId = UUID.randomUUID();
        doThrow(new IllegalArgumentException("Cannot delete root directory or root-like path"))
            .when(projectService).deleteProject(projectId);

        mockMvc.perform(delete("/api/projects/{id}", projectId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Cannot delete root directory or root-like path"));
    }

    @Test
    @DisplayName("DELETE /api/projects/{id} returns 500 on filesystem deletion failure (atomicity test)")
    void testDeleteProject_returns500_onFilesystemFailure() throws Exception {
        UUID projectId = UUID.randomUUID();
        doThrow(new IOException("Failed to delete project files"))
            .when(projectService).deleteProject(projectId);

        mockMvc.perform(delete("/api/projects/{id}", projectId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isInternalServerError());
    }
}
