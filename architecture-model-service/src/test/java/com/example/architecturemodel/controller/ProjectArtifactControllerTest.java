package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ProjectArtifactDto;
import com.example.architecturemodel.service.ProjectArtifactService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for ProjectArtifactController.
 */
@ExtendWith(MockitoExtension.class)
class ProjectArtifactControllerTest {

    @Mock
    private ProjectArtifactService projectArtifactService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID = UUID.randomUUID();

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

    /**
     * Test GET /artifacts/{artifactType}/latest returns latest revision with 200.
     */
    @Test
    void getLatestArtifact_returns200() throws Exception {
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();

        ProjectArtifactDto artifact = new ProjectArtifactDto(
            id, PROJECT_ID, "MISSION_MD", "# Mission\n\nOur mission...",
            "AGENT_OS", 3, now
        );

        when(projectArtifactService.getLatestArtifact(PROJECT_ID, "MISSION_MD"))
            .thenReturn(artifact);

        mockMvc.perform(get("/api/model/projects/{projectId}/artifacts/{artifactType}/latest",
                PROJECT_ID, "MISSION_MD"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(id.toString()))
            .andExpect(jsonPath("$.project_id").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.artifact_type").value("MISSION_MD"))
            .andExpect(jsonPath("$.revision").value(3));
    }

    /**
     * Test GET /artifacts/{artifactType}/latest returns 404 when no revisions exist.
     */
    @Test
    void getLatestArtifact_notFound_returns404() throws Exception {
        when(projectArtifactService.getLatestArtifact(PROJECT_ID, "ROADMAP_MD"))
            .thenThrow(new ResourceNotFoundException(
                "No artifact found for project: project-1, type: ROADMAP_MD"));

        mockMvc.perform(get("/api/model/projects/{projectId}/artifacts/{artifactType}/latest",
                PROJECT_ID, "ROADMAP_MD"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value(
                "No artifact found for project: project-1, type: ROADMAP_MD"));
    }

    /**
     * Test POST /artifacts/{artifactType} creates new revision with 201.
     */
    @Test
    void createArtifact_returns201() throws Exception {
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();

        ProjectArtifactDto inputDto = new ProjectArtifactDto(
            null, null, null, "# Mission\n\nNew content",
            "USER_EDIT", null, null
        );

        ProjectArtifactDto resultDto = new ProjectArtifactDto(
            id, PROJECT_ID, "MISSION_MD", "# Mission\n\nNew content",
            "USER_EDIT", 2, now
        );

        when(projectArtifactService.createArtifact(eq(PROJECT_ID), eq("MISSION_MD"),
            any(ProjectArtifactDto.class))).thenReturn(resultDto);

        mockMvc.perform(post("/api/model/projects/{projectId}/artifacts/{artifactType}",
                PROJECT_ID, "MISSION_MD")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(inputDto)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(id.toString()))
            .andExpect(jsonPath("$.revision").value(2));

        verify(projectArtifactService).createArtifact(eq(PROJECT_ID), eq("MISSION_MD"),
            any(ProjectArtifactDto.class));
    }

    /**
     * Test POST /artifacts/{artifactType} with invalid type returns 400.
     */
    @Test
    void createArtifact_invalidType_returns400() throws Exception {
        ProjectArtifactDto inputDto = new ProjectArtifactDto(
            null, null, null, "Content",
            "AGENT_OS", null, null
        );

        when(projectArtifactService.createArtifact(eq(PROJECT_ID), eq("INVALID_TYPE"),
            any(ProjectArtifactDto.class)))
            .thenThrow(new IllegalArgumentException("Invalid artifact type: INVALID_TYPE"));

        mockMvc.perform(post("/api/model/projects/{projectId}/artifacts/{artifactType}",
                PROJECT_ID, "INVALID_TYPE")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(inputDto)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Invalid artifact type: INVALID_TYPE"));
    }

    /**
     * Test GET /artifacts/{artifactType} returns all revisions.
     */
    @Test
    void getArtifactRevisions_returns200() throws Exception {
        UUID id1 = UUID.randomUUID();
        UUID id2 = UUID.randomUUID();
        Instant now = Instant.now();

        List<ProjectArtifactDto> artifacts = List.of(
            new ProjectArtifactDto(id1, PROJECT_ID, "BACKLOG_MD", "Rev 2 content",
                "AGENT_OS", 2, now),
            new ProjectArtifactDto(id2, PROJECT_ID, "BACKLOG_MD", "Rev 1 content",
                "AGENT_OS", 1, now)
        );

        when(projectArtifactService.getArtifactRevisions(PROJECT_ID, "BACKLOG_MD"))
            .thenReturn(artifacts);

        mockMvc.perform(get("/api/model/projects/{projectId}/artifacts/{artifactType}",
                PROJECT_ID, "BACKLOG_MD"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].revision").value(2))
            .andExpect(jsonPath("$[1].revision").value(1));
    }

    /**
     * Test DELETE /artifacts/by-id/{id} returns 204.
     */
    @Test
    void deleteArtifact_returns204() throws Exception {
        UUID id = UUID.randomUUID();

        doNothing().when(projectArtifactService).deleteArtifact(id);

        mockMvc.perform(delete("/api/model/projects/{projectId}/artifacts/by-id/{id}",
                PROJECT_ID, id))
            .andExpect(status().isNoContent());

        verify(projectArtifactService).deleteArtifact(id);
    }
}
