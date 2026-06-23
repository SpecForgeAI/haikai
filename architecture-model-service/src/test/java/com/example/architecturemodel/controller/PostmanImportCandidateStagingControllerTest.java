package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryCandidateDto;
import com.example.architecturemodel.model.dto.StageImportedCandidateRequest;
import com.example.architecturemodel.service.DiscoveryRunService;
import com.example.architecturemodel.service.PostmanImportCandidateStagingService;
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
 * Slice tests for the {@code POST .../discovery/stage-imported-candidate}
 * endpoint on {@link DiscoveryOrphanController}.
 *
 * Spec: 2026-06-23 Import a Postman Collection into Capture, R5 / A4 -- Task
 * Group 5. The AMS side of "Add to architecture": stages ONE imported endpoint
 * as an un-approved discovery candidate scoped to a (project, architecture).
 *
 * These are {@code @WebMvcTest} slice tests (service mocked, no DB / Liquibase),
 * mirroring {@code DiscoveryCandidateControllerTest}. No migration was added by
 * Task Group 5, so none needs to run here.
 *
 * Critical behaviours asserted:
 * 1. The endpoint accepts the snake_case request shape, delegates with the path
 *    (project, architecture), and returns the staged candidate.
 * 2. The staged candidate is UN-APPROVED on the wire
 *    ({@code review_status='pending_review'}, {@code status='proposed'}) and
 *    snake_case (R8).
 * 3. A missing required field (blank method) maps to 400.
 */
@WebMvcTest(DiscoveryOrphanController.class)
class PostmanImportCandidateStagingControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private PostmanImportCandidateStagingService postmanImportCandidateStagingService;

    // DiscoveryOrphanController also depends on DiscoveryRunService; mock it so the
    // WebMvc slice context wires.
    @MockBean
    private DiscoveryRunService discoveryRunService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final String URL =
        "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/stage-imported-candidate";

    /**
     * Test 1: POST stages an imported endpoint and returns the staged candidate;
     * the snake_case body is parsed and forwarded to the service with the path
     * (project, architecture).
     */
    @Test
    @DisplayName("Test 1: POST stage-imported-candidate persists and returns the staged candidate")
    void stageImportedCandidate_persistsAndReturns() throws Exception {
        UUID candidateId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryCandidateDto staged = new DiscoveryCandidateDto(
            candidateId, runId, "interface", "GET /orders/42",
            0.0, "proposed",
            List.of(),
            Map.of("method", "GET", "path", "/orders/42", "source", "postman-import"),
            now.toString(),
            null,
            "pending_review", null, null, null,
            null,
            "create"
        );

        when(postmanImportCandidateStagingService.stageImportedCandidate(
                eq(PROJECT_ID), eq(ARCHITECTURE_ID), any(StageImportedCandidateRequest.class)))
            .thenReturn(staged);

        String body = "{"
            + "\"method\":\"GET\","
            + "\"path\":\"/orders/42\","
            + "\"source_item_name\":\"Get order by id\""
            + "}";

        mockMvc.perform(post(URL, PROJECT_ID, ARCHITECTURE_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.id").value(candidateId.toString()))
            .andExpect(jsonPath("$.run_id").value(runId.toString()))
            .andExpect(jsonPath("$.candidate_type").value("interface"))
            .andExpect(jsonPath("$.name").value("GET /orders/42"))
            .andExpect(jsonPath("$.data.method").value("GET"))
            .andExpect(jsonPath("$.data.path").value("/orders/42"));

        verify(postmanImportCandidateStagingService).stageImportedCandidate(
            eq(PROJECT_ID), eq(ARCHITECTURE_ID), any(StageImportedCandidateRequest.class));
    }

    /**
     * Test 2: the staged candidate is UN-APPROVED on the wire (snake_case R8):
     * review_status=pending_review and status=proposed.
     */
    @Test
    @DisplayName("Test 2: staged candidate is un-approved (review_status=pending_review, status=proposed)")
    void stageImportedCandidate_isUnApproved() throws Exception {
        UUID candidateId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();

        DiscoveryCandidateDto staged = new DiscoveryCandidateDto(
            candidateId, runId, "interface", "POST /orders",
            0.0, "proposed",
            List.of(),
            Map.of("method", "POST", "path", "/orders", "source", "postman-import"),
            Instant.now().toString(),
            null,
            "pending_review", null, null, null,
            null,
            "create"
        );

        when(postmanImportCandidateStagingService.stageImportedCandidate(
                eq(PROJECT_ID), eq(ARCHITECTURE_ID), any(StageImportedCandidateRequest.class)))
            .thenReturn(staged);

        mockMvc.perform(post(URL, PROJECT_ID, ARCHITECTURE_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"method\":\"POST\",\"path\":\"/orders\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.review_status").value("pending_review"))
            .andExpect(jsonPath("$.status").value("proposed"))
            .andExpect(jsonPath("$.operation").value("create"));
    }

    /**
     * Test 3: a missing required field (blank method) is rejected with 400, with
     * the service's IllegalArgumentException surfaced as an error envelope.
     */
    @Test
    @DisplayName("Test 3: missing required field (blank method) -> 400")
    void stageImportedCandidate_missingMethod_returns400() throws Exception {
        when(postmanImportCandidateStagingService.stageImportedCandidate(
                eq(PROJECT_ID), eq(ARCHITECTURE_ID), any(StageImportedCandidateRequest.class)))
            .thenThrow(new IllegalArgumentException("method is required"));

        mockMvc.perform(post(URL, PROJECT_ID, ARCHITECTURE_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"path\":\"/orders\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("method is required"));
    }
}
