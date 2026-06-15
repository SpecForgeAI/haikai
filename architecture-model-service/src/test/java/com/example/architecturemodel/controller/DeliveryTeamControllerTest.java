package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.DeliveryTeamDto;
import com.example.architecturemodel.service.DeliveryTeamService;
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
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for DeliveryTeamController.
 *
 * Note: The application uses a global Jackson SNAKE_CASE naming strategy
 * (configured in application.yml), so all JSON field names in responses
 * are snake_case (e.g. project_id, created_at, updated_at).
 *
 * Spec: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)
 * Task Group 4: REST Controller (Task 4.2)
 */
@WebMvcTest(DeliveryTeamController.class)
class DeliveryTeamControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private DeliveryTeamService deliveryTeamService;

    private UUID testProjectId;
    private UUID testTeamId;
    private Instant testCreatedAt;
    private Instant testUpdatedAt;
    private DeliveryTeamDto testDto;

    @BeforeEach
    void setUp() {
        testProjectId = UUID.randomUUID();
        testTeamId = UUID.randomUUID();
        testCreatedAt = Instant.parse("2026-02-15T10:00:00Z");
        testUpdatedAt = Instant.parse("2026-02-15T10:00:00Z");
        testDto = new DeliveryTeamDto(
            testTeamId,
            testProjectId,
            "Platform Team",
            "INTERNAL",
            "Handles platform services",
            testCreatedAt,
            testUpdatedAt
        );
    }

    /**
     * Test 1: GET /api/projects/{projectId}/delivery-teams returns 200 with list of DTOs.
     */
    @Test
    @DisplayName("GET list returns 200 with list of delivery teams in snake_case JSON")
    void testListReturns200WithTeams() throws Exception {
        DeliveryTeamDto secondDto = new DeliveryTeamDto(
            UUID.randomUUID(),
            testProjectId,
            "Vendor Team",
            "EXTERNAL",
            null,
            testCreatedAt,
            testUpdatedAt
        );

        when(deliveryTeamService.list(any(UUID.class)))
            .thenReturn(List.of(testDto, secondDto));

        mockMvc.perform(get("/api/projects/{projectId}/delivery-teams", testProjectId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isArray())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value(testTeamId.toString()))
            .andExpect(jsonPath("$[0].project_id").value(testProjectId.toString()))
            .andExpect(jsonPath("$[0].name").value("Platform Team"))
            .andExpect(jsonPath("$[0].type").value("INTERNAL"))
            .andExpect(jsonPath("$[0].description").value("Handles platform services"))
            .andExpect(jsonPath("$[0].created_at").exists())
            .andExpect(jsonPath("$[0].updated_at").exists());
    }

    /**
     * Test 2: GET /api/projects/{projectId}/delivery-teams/{teamId} returns 200 with single DTO.
     */
    @Test
    @DisplayName("GET by ID returns 200 with single delivery team")
    void testGetByIdReturns200() throws Exception {
        when(deliveryTeamService.getById(any(UUID.class), any(UUID.class)))
            .thenReturn(testDto);

        mockMvc.perform(get("/api/projects/{projectId}/delivery-teams/{teamId}",
                    testProjectId, testTeamId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(testTeamId.toString()))
            .andExpect(jsonPath("$.project_id").value(testProjectId.toString()))
            .andExpect(jsonPath("$.name").value("Platform Team"))
            .andExpect(jsonPath("$.type").value("INTERNAL"))
            .andExpect(jsonPath("$.description").value("Handles platform services"))
            .andExpect(jsonPath("$.created_at").exists())
            .andExpect(jsonPath("$.updated_at").exists());
    }

    /**
     * Test 3: GET /api/projects/{projectId}/delivery-teams/{teamId} returns 404
     * when service throws ResourceNotFoundException.
     */
    @Test
    @DisplayName("GET by ID returns 404 when team not found")
    void testGetByIdReturns404WhenNotFound() throws Exception {
        when(deliveryTeamService.getById(any(UUID.class), any(UUID.class)))
            .thenThrow(new ResourceNotFoundException("Delivery team not found with id: " + testTeamId));

        mockMvc.perform(get("/api/projects/{projectId}/delivery-teams/{teamId}",
                    testProjectId, testTeamId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value("Delivery team not found with id: " + testTeamId));
    }

    /**
     * Test 4: POST /api/projects/{projectId}/delivery-teams with valid body returns 201.
     */
    @Test
    @DisplayName("POST with valid body returns 201 with created delivery team")
    void testPostReturns201() throws Exception {
        when(deliveryTeamService.create(any(UUID.class), anyString(), anyString(), anyString()))
            .thenReturn(testDto);

        String requestBody = objectMapper.writeValueAsString(
            new DeliveryTeamController.CreateDeliveryTeamRequest(
                "Platform Team", "INTERNAL", "Handles platform services")
        );

        mockMvc.perform(post("/api/projects/{projectId}/delivery-teams", testProjectId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(testTeamId.toString()))
            .andExpect(jsonPath("$.project_id").value(testProjectId.toString()))
            .andExpect(jsonPath("$.name").value("Platform Team"))
            .andExpect(jsonPath("$.type").value("INTERNAL"));
    }

    /**
     * Test 5: POST with invalid input returns 400 when service throws IllegalArgumentException.
     */
    @Test
    @DisplayName("POST with invalid input returns 400 Bad Request")
    void testPostReturns400OnInvalidInput() throws Exception {
        when(deliveryTeamService.create(any(UUID.class), anyString(), anyString(), any()))
            .thenThrow(new IllegalArgumentException("Delivery team name is required"));

        String requestBody = objectMapper.writeValueAsString(
            new DeliveryTeamController.CreateDeliveryTeamRequest("", "INTERNAL", null)
        );

        mockMvc.perform(post("/api/projects/{projectId}/delivery-teams", testProjectId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Delivery team name is required"));
    }

    /**
     * Test 6: POST with duplicate name returns 409 when service throws ConflictException.
     */
    @Test
    @DisplayName("POST with duplicate name returns 409 Conflict")
    void testPostReturns409OnDuplicateName() throws Exception {
        when(deliveryTeamService.create(any(UUID.class), anyString(), anyString(), any()))
            .thenThrow(new ConflictException(
                "Delivery team with name 'Platform Team' already exists in this project (case-insensitive)"));

        String requestBody = objectMapper.writeValueAsString(
            new DeliveryTeamController.CreateDeliveryTeamRequest(
                "Platform Team", "INTERNAL", null)
        );

        mockMvc.perform(post("/api/projects/{projectId}/delivery-teams", testProjectId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.message").value(
                "Delivery team with name 'Platform Team' already exists in this project (case-insensitive)"));
    }

    /**
     * Test 7: PUT /api/projects/{projectId}/delivery-teams/{teamId} with valid body returns 200.
     */
    @Test
    @DisplayName("PUT with valid body returns 200 with updated delivery team")
    void testPutReturns200() throws Exception {
        Instant updatedTime = Instant.parse("2026-02-15T12:00:00Z");
        DeliveryTeamDto updatedDto = new DeliveryTeamDto(
            testTeamId,
            testProjectId,
            "Updated Team Name",
            "EXTERNAL",
            "Updated description",
            testCreatedAt,
            updatedTime
        );

        when(deliveryTeamService.update(any(UUID.class), any(UUID.class),
                anyString(), anyString(), anyString()))
            .thenReturn(updatedDto);

        String requestBody = objectMapper.writeValueAsString(
            new DeliveryTeamController.UpdateDeliveryTeamRequest(
                "Updated Team Name", "EXTERNAL", "Updated description")
        );

        mockMvc.perform(put("/api/projects/{projectId}/delivery-teams/{teamId}",
                    testProjectId, testTeamId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(testTeamId.toString()))
            .andExpect(jsonPath("$.name").value("Updated Team Name"))
            .andExpect(jsonPath("$.type").value("EXTERNAL"))
            .andExpect(jsonPath("$.description").value("Updated description"));
    }

    /**
     * Test 8: DELETE /api/projects/{projectId}/delivery-teams/{teamId} returns 204 with no body.
     */
    @Test
    @DisplayName("DELETE returns 204 No Content")
    void testDeleteReturns204() throws Exception {
        doNothing().when(deliveryTeamService).delete(any(UUID.class), any(UUID.class));

        mockMvc.perform(delete("/api/projects/{projectId}/delivery-teams/{teamId}",
                    testProjectId, testTeamId))
            .andExpect(status().isNoContent())
            .andExpect(content().string(""));
    }
}
