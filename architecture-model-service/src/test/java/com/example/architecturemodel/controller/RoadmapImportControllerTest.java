package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.roadmap.RoadmapImportResultDto;
import com.example.architecturemodel.service.RoadmapImportService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for RoadmapImportController.
 *
 * Tests HTTP status codes and response format for import operations.
 */
@ExtendWith(MockitoExtension.class)
class RoadmapImportControllerTest {

    @Mock
    private RoadmapImportService roadmapImportService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @BeforeEach
    void setUp() {
        RoadmapImportController controller = new RoadmapImportController(roadmapImportService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();

        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
    }

    /**
     * Test POST returns 200 with correct JSON response on success.
     */
    @Test
    void importRoadmap_returns200WithCorrectJson() throws Exception {
        RoadmapImportResultDto result = new RoadmapImportResultDto(
                PROJECT_ID, 5, 3, 10);

        when(roadmapImportService.importFromAgentOsFile(eq(PROJECT_ID)))
                .thenReturn(result);

        mockMvc.perform(post("/api/model/projects/{projectId}/roadmap/import", PROJECT_ID)
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.project_id").value(PROJECT_ID.toString()))
                .andExpect(jsonPath("$.artifact_revision").value(5))
                .andExpect(jsonPath("$.initiatives_created").value(3))
                .andExpect(jsonPath("$.epics_created").value(10));
    }

    /**
     * Test POST returns 404 when roadmap.md not found.
     */
    @Test
    void importRoadmap_returns404WhenFileNotFound() throws Exception {
        when(roadmapImportService.importFromAgentOsFile(eq(PROJECT_ID)))
                .thenThrow(new ResourceNotFoundException("Roadmap file not found at: /path/to/roadmap.md"));

        mockMvc.perform(post("/api/model/projects/{projectId}/roadmap/import", PROJECT_ID)
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("Not Found"))
                .andExpect(jsonPath("$.message").value("Roadmap file not found at: /path/to/roadmap.md"));
    }

    /**
     * Test POST returns 400 for parse failures.
     */
    @Test
    void importRoadmap_returns400ForParseFailure() throws Exception {
        when(roadmapImportService.importFromAgentOsFile(eq(PROJECT_ID)))
                .thenThrow(new IllegalArgumentException("Invalid markdown format: missing required sections"));

        mockMvc.perform(post("/api/model/projects/{projectId}/roadmap/import", PROJECT_ID)
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.message").value("Invalid markdown format: missing required sections"));
    }

    /**
     * Test POST returns 409 when features/stories exist.
     */
    @Test
    void importRoadmap_returns409WhenFeaturesExist() throws Exception {
        when(roadmapImportService.importFromAgentOsFile(eq(PROJECT_ID)))
                .thenThrow(new ResponseStatusException(HttpStatus.CONFLICT,
                        "Cannot import: 5 FEATURE/STORY work items exist"));

        mockMvc.perform(post("/api/model/projects/{projectId}/roadmap/import", PROJECT_ID)
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.error").value("Conflict"))
                .andExpect(jsonPath("$.message").value("Cannot import: 5 FEATURE/STORY work items exist"));
    }

    /**
     * Test POST returns 500 for unexpected IO errors.
     */
    @Test
    void importRoadmap_returns500ForIOError() throws Exception {
        when(roadmapImportService.importFromAgentOsFile(eq(PROJECT_ID)))
                .thenThrow(new RuntimeException("Disk read error"));

        mockMvc.perform(post("/api/model/projects/{projectId}/roadmap/import", PROJECT_ID)
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.status").value(500))
                .andExpect(jsonPath("$.error").value("Internal Server Error"))
                .andExpect(jsonPath("$.message").value("An unexpected error occurred"));
    }
}
