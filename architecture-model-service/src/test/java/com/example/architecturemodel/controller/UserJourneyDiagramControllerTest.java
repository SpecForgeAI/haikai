package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.service.UserJourneyDiagramProjectionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for UserJourneyDiagramController.
 *
 * Spec: User Journey Temporary Diagram JSON Generation
 * Task Group 3: REST Controller and Controller Tests
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing -- Task 6.3
 *   URL shape and service signatures updated to be architecture-scoped.
 *   New URL: /api/projects/{projectId}/architectures/{architectureId}/user-journey-diagrams/...
 */
@WebMvcTest(UserJourneyDiagramController.class)
class UserJourneyDiagramControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private UserJourneyDiagramProjectionService projectionService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final String JOURNEY_ID = "uj-001";

    /**
     * Test 1: GET single journey returns 200 with correct JSON structure.
     */
    @Test
    void getSingleJourney_returns200WithCorrectJsonStructure() throws Exception {
        // Given
        UserJourneyDiagramDto diagram = buildSampleDiagram();
        when(projectionService.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, JOURNEY_ID))
            .thenReturn(diagram);

        // When/Then
        mockMvc.perform(get(
                "/api/projects/{projectId}/architectures/{architectureId}/user-journey-diagrams/{userJourneyId}/temporary",
                PROJECT_ID, ARCHITECTURE_ID, JOURNEY_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.diagram_type").value("USER_JOURNEY"))
            .andExpect(jsonPath("$.version").value("1.0"))
            .andExpect(jsonPath("$.journey").exists())
            .andExpect(jsonPath("$.journey.id").value(JOURNEY_ID))
            .andExpect(jsonPath("$.journey.name").value("Test Journey"))
            .andExpect(jsonPath("$.journey.user_role_id").value("bu-001"))
            .andExpect(jsonPath("$.journey.user_role_name").value("User One"))
            .andExpect(jsonPath("$.journey.parent_business_process_id").value("bp-001"))
            .andExpect(jsonPath("$.journey.parent_business_process_name").value("Process One"))
            .andExpect(jsonPath("$.lanes").isArray())
            .andExpect(jsonPath("$.lanes[0].id").value("app-1"))
            .andExpect(jsonPath("$.steps").isArray())
            .andExpect(jsonPath("$.steps[0].id").value("step-1"))
            .andExpect(jsonPath("$.steps[0].journey_id").value(JOURNEY_ID))
            .andExpect(jsonPath("$.steps[0].lane_id").value("app-1"))
            .andExpect(jsonPath("$.steps[0].process_activity_id").value("pa-1"))
            .andExpect(jsonPath("$.steps[0].process_activity_name").value("Act 1"))
            .andExpect(jsonPath("$.steps[0].business_user_id").value("bu-001"))
            .andExpect(jsonPath("$.steps[0].business_user_name").value("User One"))
            .andExpect(jsonPath("$.edges").isArray())
            .andExpect(jsonPath("$.edges[0].id").value("edge-" + JOURNEY_ID + "-1-2"))
            .andExpect(jsonPath("$.edges[0].from_step_id").value("step-1"))
            .andExpect(jsonPath("$.edges[0].to_step_id").value("step-2"))
            .andExpect(jsonPath("$.edges[0].is_cross_lane").value(false))
            .andExpect(jsonPath("$.render_hints").exists())
            .andExpect(jsonPath("$.render_hints.lane_axis").value("VERTICAL"))
            .andExpect(jsonPath("$.render_hints.flow_direction").value("LEFT_TO_RIGHT"))
            .andExpect(jsonPath("$.render_hints.show_title").value(true));
    }

    /**
     * Test 2: GET single journey returns 404 when service throws ResourceNotFoundException.
     */
    @Test
    void getSingleJourney_returns404_whenNotFound() throws Exception {
        // Given
        when(projectionService.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, "nonexistent"))
            .thenThrow(new ResourceNotFoundException("User journey not found: nonexistent"));

        // When/Then
        mockMvc.perform(get(
                "/api/projects/{projectId}/architectures/{architectureId}/user-journey-diagrams/{userJourneyId}/temporary",
                PROJECT_ID, ARCHITECTURE_ID, "nonexistent"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.status").value(404))
            .andExpect(jsonPath("$.message").value("User journey not found: nonexistent"));
    }

    /**
     * Test 3: GET all journeys returns 200 with JSON array.
     */
    @Test
    void getAllJourneys_returns200WithJsonArray() throws Exception {
        // Given
        UserJourneyDiagramDto diagram = buildSampleDiagram();
        when(projectionService.projectAllJourneys(PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(List.of(diagram));

        // When/Then
        mockMvc.perform(get(
                "/api/projects/{projectId}/architectures/{architectureId}/user-journey-diagrams/temporary",
                PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$").isArray())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].diagram_type").value("USER_JOURNEY"))
            .andExpect(jsonPath("$[0].version").value("1.0"))
            .andExpect(jsonPath("$[0].journey.id").value(JOURNEY_ID));
    }

    /**
     * Test 4: GET all journeys returns 200 with empty array when no journeys exist.
     */
    @Test
    void getAllJourneys_returns200WithEmptyArray_whenNoJourneys() throws Exception {
        // Given
        when(projectionService.projectAllJourneys(PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(List.of());

        // When/Then
        mockMvc.perform(get(
                "/api/projects/{projectId}/architectures/{architectureId}/user-journey-diagrams/temporary",
                PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$").isArray())
            .andExpect(jsonPath("$.length()").value(0));
    }

    /**
     * Test 5: Verify URL routing for both endpoints.
     */
    @Test
    void urlRouting_bothEndpointsRouteCorrectly() throws Exception {
        // Given
        UserJourneyDiagramDto diagram = buildSampleDiagram();
        when(projectionService.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, JOURNEY_ID))
            .thenReturn(diagram);
        when(projectionService.projectAllJourneys(PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(List.of(diagram));

        // When/Then - Single journey endpoint
        mockMvc.perform(get(
                "/api/projects/{projectId}/architectures/{architectureId}/user-journey-diagrams/{userJourneyId}/temporary",
                PROJECT_ID, ARCHITECTURE_ID, JOURNEY_ID))
            .andExpect(status().isOk());

        // When/Then - All journeys endpoint
        mockMvc.perform(get(
                "/api/projects/{projectId}/architectures/{architectureId}/user-journey-diagrams/temporary",
                PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk());
    }

    // ============== Helper methods ==============

    private UserJourneyDiagramDto buildSampleDiagram() {
        UserJourneyDiagramJourneyDto journey = new UserJourneyDiagramJourneyDto(
            JOURNEY_ID, "Test Journey", "A test journey",
            "bu-001", "User One", "bp-001", "Process One"
        );

        List<UserJourneyDiagramLaneDto> lanes = List.of(
            new UserJourneyDiagramLaneDto("app-1", "App One", 0)
        );

        List<UserJourneyDiagramStepDto> steps = List.of(
            new UserJourneyDiagramStepDto("step-1", JOURNEY_ID, 1, "app-1", "pa-1", "Act 1", "Step 1", null, "Desc 1", "bu-001", "User One", null, null),
            new UserJourneyDiagramStepDto("step-2", JOURNEY_ID, 2, "app-1", "pa-2", "Act 2", "Step 2", null, "Desc 2", "bu-001", "User One", null, null)
        );

        List<UserJourneyDiagramEdgeDto> edges = List.of(
            new UserJourneyDiagramEdgeDto("edge-" + JOURNEY_ID + "-1-2", "step-1", "step-2", 0, false)
        );

        UserJourneyDiagramRenderHintsDto hints = new UserJourneyDiagramRenderHintsDto(
            "VERTICAL", "LEFT_TO_RIGHT", true
        );

        return new UserJourneyDiagramDto("USER_JOURNEY", "1.0", journey, lanes, steps, edges, hints);
    }
}
