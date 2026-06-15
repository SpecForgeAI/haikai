package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ProjectArtifactMetadataDto;
import com.example.architecturemodel.service.ProjectArtifactService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.UUID;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for latest-metadata endpoint.
 *
 * Spec 2026-01-04: Roadmap Import UX Glue - Persisted Status + Detailed Counts + Error UX
 * Task Group 2: Tests for latest-metadata endpoint.
 */
@ExtendWith(MockitoExtension.class)
class ProjectArtifactControllerMetadataTest {

    @Mock
    private ProjectArtifactService projectArtifactService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @BeforeEach
    void setUp() {
        ProjectArtifactController controller = new ProjectArtifactController(projectArtifactService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();

        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        objectMapper.registerModule(new JavaTimeModule());
    }

    // ========================================================================
    // Test 1: Successful metadata retrieval returns 200 with correct fields
    // ========================================================================

    @Test
    void getLatestArtifactMetadata_returns200WithCorrectFields() throws Exception {
        // Arrange
        Instant now = Instant.now();
        ProjectArtifactMetadataDto metadata = new ProjectArtifactMetadataDto(
            PROJECT_ID, "ROADMAP_MD", 5, now, "AGENT_OS"
        );

        when(projectArtifactService.getLatestArtifactMetadata(PROJECT_ID, "ROADMAP_MD"))
            .thenReturn(metadata);

        // Act & Assert
        mockMvc.perform(get("/api/model/projects/{projectId}/artifacts/{artifactType}/latest-metadata",
                PROJECT_ID, "ROADMAP_MD"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.project_id").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.artifact_type").value("ROADMAP_MD"))
            .andExpect(jsonPath("$.revision").value(5))
            .andExpect(jsonPath("$.source").value("AGENT_OS"))
            .andExpect(jsonPath("$.created_at").exists());
    }

    // ========================================================================
    // Test 2: Returns 404 when no artifact exists
    // ========================================================================

    @Test
    void getLatestArtifactMetadata_noArtifact_returns404() throws Exception {
        // Arrange
        String expectedMessage = "No artifact found for project: " + PROJECT_ID + ", type: ROADMAP_MD";
        when(projectArtifactService.getLatestArtifactMetadata(PROJECT_ID, "ROADMAP_MD"))
            .thenThrow(new ResourceNotFoundException(expectedMessage));

        // Act & Assert
        mockMvc.perform(get("/api/model/projects/{projectId}/artifacts/{artifactType}/latest-metadata",
                PROJECT_ID, "ROADMAP_MD"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value(expectedMessage));
    }

    // ========================================================================
    // Test 3: Returns 400 for invalid artifact type
    // ========================================================================

    @Test
    void getLatestArtifactMetadata_invalidArtifactType_returns400() throws Exception {
        // Arrange
        when(projectArtifactService.getLatestArtifactMetadata(PROJECT_ID, "INVALID_TYPE"))
            .thenThrow(new IllegalArgumentException(
                "Invalid artifact type: INVALID_TYPE. Allowed values: [MISSION_MD, ROADMAP_MD, BACKLOG_MD]"));

        // Act & Assert
        mockMvc.perform(get("/api/model/projects/{projectId}/artifacts/{artifactType}/latest-metadata",
                PROJECT_ID, "INVALID_TYPE"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value(
                "Invalid artifact type: INVALID_TYPE. Allowed values: [MISSION_MD, ROADMAP_MD, BACKLOG_MD]"));
    }

    // ========================================================================
    // Test 4: Response does not include content field
    // ========================================================================

    @Test
    void getLatestArtifactMetadata_responseExcludesContent() throws Exception {
        // Arrange
        Instant now = Instant.now();
        ProjectArtifactMetadataDto metadata = new ProjectArtifactMetadataDto(
            PROJECT_ID, "MISSION_MD", 3, now, "USER_EDIT"
        );

        when(projectArtifactService.getLatestArtifactMetadata(PROJECT_ID, "MISSION_MD"))
            .thenReturn(metadata);

        // Act & Assert
        mockMvc.perform(get("/api/model/projects/{projectId}/artifacts/{artifactType}/latest-metadata",
                PROJECT_ID, "MISSION_MD"))
            .andExpect(status().isOk())
            // Verify metadata fields exist
            .andExpect(jsonPath("$.project_id").exists())
            .andExpect(jsonPath("$.artifact_type").exists())
            .andExpect(jsonPath("$.revision").exists())
            .andExpect(jsonPath("$.source").exists())
            .andExpect(jsonPath("$.created_at").exists())
            // Verify content field does NOT exist
            .andExpect(jsonPath("$.content").doesNotExist());
    }
}
