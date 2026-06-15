package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.dto.diagram.UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto;
import com.example.architecturemodel.service.UserJourneyOverviewDiagramProjectionService;
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
 * Controller tests for UserJourneyOverviewDiagramController.
 *
 * Spec: User Journey Overview Parent Diagram Generation
 * Task Group 3: REST Controller
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing -- Task 6.3
 *   URL shape and service signature updated to be architecture-scoped.
 *   New URL: /api/projects/{projectId}/architectures/{architectureId}/user-journey-overview-diagrams/...
 */
@WebMvcTest(UserJourneyOverviewDiagramController.class)
class UserJourneyOverviewDiagramControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private UserJourneyOverviewDiagramProjectionService projectionService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final String BUSINESS_USER_ID = "bu-001";

    private static final UserJourneyOverviewNodeLinkDto DEFAULT_UNLINKED =
        new UserJourneyOverviewNodeLinkDto(null, null, "UNLINKED");

    /**
     * Test 1: GET /api/projects/{projectId}/architectures/{architectureId}/user-journey-overview-diagrams/temporary?businessUserId={id}
     * returns 200 with the projected DTO.
     */
    @Test
    void getTemporaryOverviewDiagram_returns200WithCorrectJsonStructure() throws Exception {
        // Given
        UserJourneyOverviewDiagramDto diagram = buildSampleOverviewDiagram();
        when(projectionService.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID))
            .thenReturn(diagram);

        // When/Then
        mockMvc.perform(get(
                "/api/projects/{projectId}/architectures/{architectureId}/user-journey-overview-diagrams/temporary",
                PROJECT_ID, ARCHITECTURE_ID)
                .param("businessUserId", BUSINESS_USER_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.diagram_type").value("USER_JOURNEY_OVERVIEW"))
            .andExpect(jsonPath("$.version").value("1.0"))
            .andExpect(jsonPath("$.overview").exists())
            .andExpect(jsonPath("$.overview.business_user_id").value(BUSINESS_USER_ID))
            .andExpect(jsonPath("$.overview.business_user_name").value("Test User"))
            .andExpect(jsonPath("$.overview.title").value("Test User Journey Overview"))
            .andExpect(jsonPath("$.lanes").isArray())
            .andExpect(jsonPath("$.lanes.length()").value(1))
            .andExpect(jsonPath("$.lanes[0].id").value("bp-001"))
            .andExpect(jsonPath("$.lanes[0].name").value("Process One"))
            .andExpect(jsonPath("$.lanes[0].order").value(0))
            .andExpect(jsonPath("$.nodes").isArray())
            .andExpect(jsonPath("$.nodes.length()").value(1))
            .andExpect(jsonPath("$.nodes[0].id").value("uj-001"))
            .andExpect(jsonPath("$.nodes[0].lane_id").value("bp-001"))
            .andExpect(jsonPath("$.nodes[0].name").value("Test Journey"))
            .andExpect(jsonPath("$.nodes[0].metadata.step_count").value(5))
            .andExpect(jsonPath("$.nodes[0].metadata.application_count").value(2))
            .andExpect(jsonPath("$.nodes[0].metadata.relationship_in_count").value(1))
            .andExpect(jsonPath("$.nodes[0].metadata.relationship_out_count").value(0))
            .andExpect(jsonPath("$.edges").isArray())
            .andExpect(jsonPath("$.render_hints.lane_axis").value("VERTICAL"))
            .andExpect(jsonPath("$.render_hints.flow_direction").value("LEFT_TO_RIGHT"))
            .andExpect(jsonPath("$.render_hints.show_title").value(true))
            .andExpect(jsonPath("$.render_hints.show_lane_headers").value(true))
            .andExpect(jsonPath("$.render_hints.show_node_description").value(true))
            .andExpect(jsonPath("$.render_hints.show_relationship_labels").value(true));
    }

    /**
     * Test 2: GET with a business user that has no journeys returns 200 with empty valid structure.
     */
    @Test
    void getTemporaryOverviewDiagram_noJourneys_returns200WithEmptyStructure() throws Exception {
        // Given
        UserJourneyOverviewDiagramDto emptyDiagram = buildEmptyOverviewDiagram();
        when(projectionService.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID))
            .thenReturn(emptyDiagram);

        // When/Then
        mockMvc.perform(get(
                "/api/projects/{projectId}/architectures/{architectureId}/user-journey-overview-diagrams/temporary",
                PROJECT_ID, ARCHITECTURE_ID)
                .param("businessUserId", BUSINESS_USER_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.diagram_type").value("USER_JOURNEY_OVERVIEW"))
            .andExpect(jsonPath("$.version").value("1.0"))
            .andExpect(jsonPath("$.overview").exists())
            .andExpect(jsonPath("$.overview.business_user_id").value(BUSINESS_USER_ID))
            .andExpect(jsonPath("$.lanes").isArray())
            .andExpect(jsonPath("$.lanes.length()").value(0))
            .andExpect(jsonPath("$.nodes").isArray())
            .andExpect(jsonPath("$.nodes.length()").value(0))
            .andExpect(jsonPath("$.edges").isArray())
            .andExpect(jsonPath("$.edges.length()").value(0));
    }

    /**
     * Test 3: GET with missing businessUserId query parameter returns 400 Bad Request.
     */
    @Test
    void getTemporaryOverviewDiagram_missingBusinessUserId_returns400() throws Exception {
        // When/Then -- no businessUserId param
        mockMvc.perform(get(
                "/api/projects/{projectId}/architectures/{architectureId}/user-journey-overview-diagrams/temporary",
                PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isBadRequest());
    }

    // ============== Helper methods ==============

    private UserJourneyOverviewDiagramDto buildSampleOverviewDiagram() {
        UserJourneyOverviewHeaderDto header = new UserJourneyOverviewHeaderDto(
            BUSINESS_USER_ID, "Test User", "Test User Journey Overview"
        );

        List<UserJourneyOverviewLaneDto> lanes = List.of(
            new UserJourneyOverviewLaneDto("bp-001", "Process One", 0)
        );

        List<UserJourneyOverviewNodeDto> nodes = List.of(
            new UserJourneyOverviewNodeDto(
                "uj-001", "bp-001", "Test Journey", "A test journey",
                BUSINESS_USER_ID, "Test User", "bp-001", "Process One",
                new UserJourneyOverviewNodeDto.UserJourneyOverviewNodeMetadataDto(5, 2, 1, 0),
                DEFAULT_UNLINKED
            )
        );

        List<UserJourneyOverviewEdgeDto> edges = List.of();

        UserJourneyOverviewRenderHintsDto hints = new UserJourneyOverviewRenderHintsDto(
            "VERTICAL", "LEFT_TO_RIGHT", true, true, true, true
        );

        return new UserJourneyOverviewDiagramDto(
            "USER_JOURNEY_OVERVIEW", "1.0", header, lanes, nodes, edges, hints
        );
    }

    private UserJourneyOverviewDiagramDto buildEmptyOverviewDiagram() {
        UserJourneyOverviewHeaderDto header = new UserJourneyOverviewHeaderDto(
            BUSINESS_USER_ID, "Test User", "Test User Journey Overview"
        );

        UserJourneyOverviewRenderHintsDto hints = new UserJourneyOverviewRenderHintsDto(
            "VERTICAL", "LEFT_TO_RIGHT", true, true, true, true
        );

        return new UserJourneyOverviewDiagramDto(
            "USER_JOURNEY_OVERVIEW", "1.0", header, List.of(), List.of(), List.of(), hints
        );
    }
}
