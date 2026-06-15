package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportRequestDto;
import com.example.architecturemodel.model.dto.export.SnapshotMeta;
import com.example.architecturemodel.store.SessionProjectStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for ProjectSessionController.
 *
 * Spec 2026-01-22: Explicit Project Session API
 * Task Group 1: ProjectSessionController (Always-On)
 *
 * Spec 2026-01-22: File Mode Blank Start UX
 * Task Group 2: ProjectSessionController Updates
 * - Updated tests for 200 responses (not 404) when no session exists
 * - Added tests for blank project auto-initialization
 * - Added tests for import snapshot normalization
 *
 * Tests all session endpoints:
 * - GET /api/project-session (auto-initializes blank)
 * - POST /api/project-session/import (normalizes snapshot)
 * - GET /api/project-session/export (auto-initializes blank)
 * - POST /api/project-session/clear
 */
@WebMvcTest(ProjectSessionController.class)
class ProjectSessionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private SessionProjectStore sessionProjectStore;

    private ProjectDto testProject;
    private ProjectSnapshotDto testSnapshot;
    private ProjectDto blankProject;
    private ProjectSnapshotDto blankSnapshot;

    @BeforeEach
    void setUp() {
        // Create a test project DTO
        testProject = new ProjectDto(
            UUID.randomUUID(),
            "Test Project",
            "/test/folder",
            null,
            null,
            null, // repoUrl
            true,
            Instant.now(),
            Instant.now()
        );

        // Create a minimal test snapshot
        testSnapshot = createTestSnapshot();

        // Create a blank project for auto-initialization tests
        blankProject = new ProjectDto(
            UUID.randomUUID(),
            "Untitled",
            null,
            null,
            null,
            null, // repoUrl
            true,
            Instant.now(),
            Instant.now()
        );

        // Create a blank snapshot for auto-initialization tests
        SnapshotMeta blankMeta = new SnapshotMeta(1, Instant.now(), "session");
        blankSnapshot = new ProjectSnapshotDto(
            blankMeta,
            blankProject,
            null, // model - blank
            java.util.List.of(), // workItems
            java.util.List.of()  // artifacts
        );
    }

    private ProjectSnapshotDto createTestSnapshot() {
        // Create minimal snapshot for testing
        SnapshotMeta meta = new SnapshotMeta(1, Instant.now(), "FULL");
        return new ProjectSnapshotDto(
            meta,
            testProject,
            null, // model
            java.util.List.of(), // workItems
            java.util.List.of()  // artifacts
        );
    }

    // =========================================================================
    // Test 1: GET /api/project-session returns 200 with project when session exists
    // =========================================================================

    @Test
    @DisplayName("GET /api/project-session returns 200 with project when session exists")
    void getSessionProject_WhenSessionExists_Returns200WithProject() throws Exception {
        // Arrange - ensureActiveProject returns existing project
        when(sessionProjectStore.ensureActiveProject()).thenReturn(testProject);

        // Act & Assert
        mockMvc.perform(get("/api/project-session")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.name").value("Test Project"))
            .andExpect(jsonPath("$.is_active").value(true));
    }

    // =========================================================================
    // Spec 2026-01-22: File Mode Blank Start UX
    // Task Group 2: Tests for auto-initialization and 200 responses
    // =========================================================================

    @Nested
    @DisplayName("File Mode Blank Start UX Tests")
    class BlankStartUxTests {

        @Test
        @DisplayName("getSessionProject_returns200WithBlankProject_whenNoSessionExists")
        void getSessionProject_returns200WithBlankProject_whenNoSessionExists() throws Exception {
            // Arrange - ensureActiveProject creates and returns blank project
            when(sessionProjectStore.ensureActiveProject()).thenReturn(blankProject);

            // Act & Assert - returns 200, NOT 404
            mockMvc.perform(get("/api/project-session")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.name").value("Untitled"))
                .andExpect(jsonPath("$.is_active").value(true));
        }

        @Test
        @DisplayName("exportSessionSnapshot_returns200WithBlankSnapshot_whenNoSessionExists")
        void exportSessionSnapshot_returns200WithBlankSnapshot_whenNoSessionExists() throws Exception {
            // Arrange - ensureActiveSnapshot creates and returns blank snapshot
            when(sessionProjectStore.ensureActiveSnapshot()).thenReturn(blankSnapshot);

            // Act & Assert - returns 200, NOT 404
            mockMvc.perform(get("/api/project-session/export")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.project").exists())
                .andExpect(jsonPath("$.project.name").value("Untitled"))
                .andExpect(jsonPath("$.meta").exists())
                .andExpect(jsonPath("$.meta.export_kind").value("session"));
        }

        @Test
        @DisplayName("importToSession_normalizesSnapshotProjectIdentity")
        void importToSession_normalizesSnapshotProjectIdentity() throws Exception {
            // Arrange - Create import request with snapshot that has different project
            ProjectDto originalSnapshotProject = new ProjectDto(
                UUID.randomUUID(),
                "Original Project Name",
                "/original/folder",
                "original-hierarchy",
                "org-123",
                null, // repoUrl
                true,
                Instant.now().minusSeconds(1000),
                Instant.now().minusSeconds(500)
            );
            SnapshotMeta meta = new SnapshotMeta(1, Instant.now(), "FULL");
            ProjectSnapshotDto snapshotWithDifferentProject = new ProjectSnapshotDto(
                meta,
                originalSnapshotProject,
                null,
                java.util.List.of(),
                java.util.List.of()
            );

            ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
                snapshotWithDifferentProject,
                null, // importAsName - use snapshot's project name
                null, // projectParentFolder
                true, // setActive
                false // overwriteExistingProject
            );

            String requestBody = objectMapper.writeValueAsString(request);

            // Act
            mockMvc.perform(post("/api/project-session/import")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody)
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isCreated());

            // Assert - Capture the arguments to verify normalization
            ArgumentCaptor<ProjectDto> projectCaptor = ArgumentCaptor.forClass(ProjectDto.class);
            ArgumentCaptor<ProjectSnapshotDto> snapshotCaptor = ArgumentCaptor.forClass(ProjectSnapshotDto.class);
            verify(sessionProjectStore).setActiveProject(projectCaptor.capture(), snapshotCaptor.capture());

            ProjectDto storedProject = projectCaptor.getValue();
            ProjectSnapshotDto storedSnapshot = snapshotCaptor.getValue();

            // Verify the stored snapshot's project matches the synthetic project (normalized)
            assertThat(storedSnapshot.project()).isEqualTo(storedProject);
            assertThat(storedSnapshot.project().name()).isEqualTo("Original Project Name");
            // The ID should be different (new UUID generated)
            assertThat(storedSnapshot.project().id()).isNotEqualTo(originalSnapshotProject.id());
        }

        @Test
        @DisplayName("getSessionProject_returnsBlankProjectWithNameUntitled")
        void getSessionProject_returnsBlankProjectWithNameUntitled() throws Exception {
            // Arrange - ensureActiveProject returns blank project with "Untitled" name
            when(sessionProjectStore.ensureActiveProject()).thenReturn(blankProject);

            // Act & Assert
            mockMvc.perform(get("/api/project-session")
                    .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.name").value("Untitled"))
                .andExpect(jsonPath("$.is_active").value(true))
                .andExpect(jsonPath("$.id").exists());
        }
    }

    // =========================================================================
    // Test 3: POST /api/project-session/import stores project and returns 201
    // =========================================================================

    @Test
    @DisplayName("POST /api/project-session/import stores project and returns 201")
    void importToSession_ValidRequest_ReturnsCreated() throws Exception {
        // Arrange - Create import request with snapshot
        ProjectSnapshotImportRequestDto request = new ProjectSnapshotImportRequestDto(
            testSnapshot,
            null, // importAsName
            null, // projectParentFolder
            true, // setActive
            false // overwriteExistingProject
        );

        String requestBody = objectMapper.writeValueAsString(request);

        // Act & Assert
        mockMvc.perform(post("/api/project-session/import")
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isCreated())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.project").exists())
            .andExpect(jsonPath("$.project.name").value("Test Project"))
            .andExpect(jsonPath("$.model_saved").value(false))
            .andExpect(jsonPath("$.work_items_inserted").value(0))
            .andExpect(jsonPath("$.artifacts_inserted").value(0));

        // Verify session store was called
        verify(sessionProjectStore, times(1)).setActiveProject(any(ProjectDto.class), any(ProjectSnapshotDto.class));
    }

    // =========================================================================
    // Test 4: GET /api/project-session/export returns snapshot when session exists
    // =========================================================================

    @Test
    @DisplayName("GET /api/project-session/export returns snapshot when session exists")
    void exportSessionSnapshot_WhenSessionExists_Returns200WithSnapshot() throws Exception {
        // Arrange - ensureActiveSnapshot returns existing snapshot
        when(sessionProjectStore.ensureActiveSnapshot()).thenReturn(testSnapshot);

        // Act & Assert
        mockMvc.perform(get("/api/project-session/export")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.project").exists())
            .andExpect(jsonPath("$.meta").exists());
    }

    // =========================================================================
    // Test 6: POST /api/project-session/clear clears session and returns 204
    // =========================================================================

    @Test
    @DisplayName("POST /api/project-session/clear clears session and returns 204")
    void clearSession_Returns204() throws Exception {
        // Act & Assert
        mockMvc.perform(post("/api/project-session/clear"))
            .andExpect(status().isNoContent());

        // Verify clear was called
        verify(sessionProjectStore, times(1)).clear();
    }
}
