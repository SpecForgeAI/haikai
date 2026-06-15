package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryCandidateDto;
import com.example.architecturemodel.service.DiscoveryCandidateService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for the PATCH /{candidateId}/review endpoint on DiscoveryCandidateController.
 *
 * Spec: Candidate Review and Approval Workflow (Increment 13)
 * Task Group 2, Task 2.1: 5 focused tests for the review endpoint
 *
 * Test 1: PATCH returns 200 with updated DTO when review_status is set to "approved"
 * Test 2: PATCH captures previous_review_status from the candidate's current value
 * Test 3: PATCH defaults reviewed_by to "anonymous" when not provided in request body
 * Test 4: PATCH returns 400 when review_status is an invalid value (e.g., "invalid")
 * Test 5: PATCH returns 404 when candidateId does not exist
 */
@WebMvcTest(DiscoveryCandidateController.class)
class DiscoveryCandidateReviewEndpointTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private DiscoveryCandidateService discoveryCandidateService;

    @MockBean
    private com.example.architecturemodel.service.discovery.DiscoveryCascadeReviewService discoveryCascadeReviewService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final UUID RUN_ID = UUID.randomUUID();
    private static final String BASE_URL =
        "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidates";

    /**
     * Test 1: PATCH returns 200 with updated DTO when review_status is set to "approved".
     *
     * Verifies the happy path: sending a valid review_status of "approved" returns 200
     * with the full updated DTO including the new review_status and audit fields.
     */
    @Test
    @DisplayName("Test 1: PATCH returns 200 with updated DTO when review_status is set to 'approved'")
    void reviewCandidate_returns200WithUpdatedDto_whenApproved() throws Exception {
        // Given
        UUID candidateId = UUID.randomUUID();
        Instant reviewedAt = Instant.parse("2026-04-05T12:00:00Z");

        DiscoveryCandidateDto updatedDto = new DiscoveryCandidateDto(
            candidateId, RUN_ID, "application", "OrderService",
            0.85, "proposed",
            List.of("cluster-1"),
            Map.of("description", "Order management application"),
            Instant.now().toString(),
            null,
            "approved", "Alice", reviewedAt.toString(), "pending_review",
            null,
            null
        );

        when(discoveryCandidateService.reviewCandidateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(candidateId), eq("approved"), eq("Alice")))
            .thenReturn(updatedDto);

        Map<String, String> requestBody = Map.of(
            "review_status", "approved",
            "reviewed_by", "Alice"
        );

        // When/Then
        mockMvc.perform(patch(BASE_URL + "/{candidateId}/review", PROJECT_ID, ARCHITECTURE_ID, RUN_ID, candidateId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(requestBody)))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.id").value(candidateId.toString()))
            .andExpect(jsonPath("$.review_status").value("approved"))
            .andExpect(jsonPath("$.reviewed_by").value("Alice"))
            .andExpect(jsonPath("$.reviewed_at").value(reviewedAt.toString()))
            .andExpect(jsonPath("$.previous_review_status").value("pending_review"))
            .andExpect(jsonPath("$.candidate_type").value("application"))
            .andExpect(jsonPath("$.name").value("OrderService"));

        verify(discoveryCandidateService).reviewCandidateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(candidateId), eq("approved"), eq("Alice"));
    }

    /**
     * Test 2: PATCH captures previous_review_status from the candidate's current value.
     *
     * Verifies that when reviewing a candidate that already has a non-default review_status
     * (e.g., "approved"), the response includes the previous status in previous_review_status.
     */
    @Test
    @DisplayName("Test 2: PATCH captures previous_review_status from the candidate's current value")
    void reviewCandidate_capturesPreviousReviewStatus() throws Exception {
        // Given: a candidate that was previously "approved" is now being "rejected"
        UUID candidateId = UUID.randomUUID();
        Instant reviewedAt = Instant.parse("2026-04-05T14:00:00Z");

        DiscoveryCandidateDto updatedDto = new DiscoveryCandidateDto(
            candidateId, RUN_ID, "service", "PaymentGateway",
            0.72, "proposed",
            List.of("cluster-2"),
            Map.of("description", "Payment processing"),
            Instant.now().toString(),
            null,
            "rejected", "Bob", reviewedAt.toString(), "approved",
            null,
            null
        );

        when(discoveryCandidateService.reviewCandidateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(candidateId), eq("rejected"), eq("Bob")))
            .thenReturn(updatedDto);

        Map<String, String> requestBody = Map.of(
            "review_status", "rejected",
            "reviewed_by", "Bob"
        );

        // When/Then
        mockMvc.perform(patch(BASE_URL + "/{candidateId}/review", PROJECT_ID, ARCHITECTURE_ID, RUN_ID, candidateId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(requestBody)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.review_status").value("rejected"))
            .andExpect(jsonPath("$.previous_review_status").value("approved"))
            .andExpect(jsonPath("$.reviewed_by").value("Bob"));

        verify(discoveryCandidateService).reviewCandidateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(candidateId), eq("rejected"), eq("Bob"));
    }

    /**
     * Test 3: PATCH defaults reviewed_by to "anonymous" when not provided in request body.
     *
     * Verifies that when the request body does not include reviewed_by, the service
     * receives null for that parameter and the returned DTO shows "anonymous".
     */
    @Test
    @DisplayName("Test 3: PATCH defaults reviewed_by to 'anonymous' when not provided in request body")
    void reviewCandidate_defaultsReviewedByToAnonymous_whenNotProvided() throws Exception {
        // Given: request body with only review_status (no reviewed_by)
        UUID candidateId = UUID.randomUUID();
        Instant reviewedAt = Instant.parse("2026-04-05T15:00:00Z");

        DiscoveryCandidateDto updatedDto = new DiscoveryCandidateDto(
            candidateId, RUN_ID, "application", "InventoryService",
            0.88, "proposed",
            List.of("cluster-3"),
            Map.of("description", "Inventory management"),
            Instant.now().toString(),
            null,
            "deferred", "anonymous", reviewedAt.toString(), "pending_review",
            null,
            null
        );

        when(discoveryCandidateService.reviewCandidateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(candidateId), eq("deferred"), isNull()))
            .thenReturn(updatedDto);

        // Request body with only review_status, no reviewed_by key
        String requestBody = "{\"review_status\": \"deferred\"}";

        // When/Then
        mockMvc.perform(patch(BASE_URL + "/{candidateId}/review", PROJECT_ID, ARCHITECTURE_ID, RUN_ID, candidateId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.review_status").value("deferred"))
            .andExpect(jsonPath("$.reviewed_by").value("anonymous"));

        verify(discoveryCandidateService).reviewCandidateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(candidateId), eq("deferred"), isNull());
    }

    /**
     * Test 4: PATCH returns 400 when review_status is an invalid value (e.g., "invalid").
     *
     * Verifies that the endpoint returns a 400 Bad Request with an error message
     * when an invalid review_status value is provided.
     */
    @Test
    @DisplayName("Test 4: PATCH returns 400 when review_status is an invalid value")
    void reviewCandidate_returns400_whenReviewStatusIsInvalid() throws Exception {
        // Given
        UUID candidateId = UUID.randomUUID();

        when(discoveryCandidateService.reviewCandidateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(candidateId), eq("invalid"), isNull()))
            .thenThrow(new IllegalArgumentException(
                "Invalid review_status: invalid. Must be one of: approved, rejected, deferred"));

        String requestBody = "{\"review_status\": \"invalid\"}";

        // When/Then
        mockMvc.perform(patch(BASE_URL + "/{candidateId}/review", PROJECT_ID, ARCHITECTURE_ID, RUN_ID, candidateId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value(
                "Invalid review_status: invalid. Must be one of: approved, rejected, deferred"));

        verify(discoveryCandidateService).reviewCandidateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(candidateId), eq("invalid"), isNull());
    }

    /**
     * Test 5: PATCH returns 404 when candidateId does not exist.
     *
     * Verifies that the endpoint returns a 404 Not Found when the service throws
     * an IllegalArgumentException with a "not found" message for a non-existent candidate.
     */
    @Test
    @DisplayName("Test 5: PATCH returns 404 when candidateId does not exist")
    void reviewCandidate_returns404_whenCandidateNotFound() throws Exception {
        // Given
        UUID nonExistentCandidateId = UUID.randomUUID();

        when(discoveryCandidateService.reviewCandidateInArchitecture(
                eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(nonExistentCandidateId), eq("approved"), eq("Alice")))
            .thenThrow(new IllegalArgumentException("Candidate not found: " + nonExistentCandidateId));

        Map<String, String> requestBody = Map.of(
            "review_status", "approved",
            "reviewed_by", "Alice"
        );

        // When/Then
        mockMvc.perform(patch(BASE_URL + "/{candidateId}/review", PROJECT_ID, ARCHITECTURE_ID, RUN_ID, nonExistentCandidateId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(requestBody)))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("Candidate not found: " + nonExistentCandidateId));

        verify(discoveryCandidateService).reviewCandidateInArchitecture(
                eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(nonExistentCandidateId), eq("approved"), eq("Alice"));
    }
}
