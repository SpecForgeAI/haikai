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
 * Controller tests for DiscoveryCandidateController.
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * Task Group 4: Candidate JPA Stack (1d)
 *
 * Tests:
 * 1. POST bulk insert accepts array of candidate DTOs and returns persisted results
 * 2. GET by run ID returns all candidates for that run
 * 3. GET by run ID with ?type=application&status=proposed returns only matching candidates (dual filter)
 * 4. GET /count returns the correct candidate count
 * 5. PUT /{candidateId} updates candidate status and returns updated DTO
 *
 * Extended: Phase 1d Candidate Generation (Increment 10)
 * Task Group 6: DELETE endpoint test, parentCandidateId round-trip
 *
 * 6. DELETE returns 200 with count of deleted candidates
 * 7. DELETE for non-existent runId returns 0 without error
 */
@WebMvcTest(DiscoveryCandidateController.class)
class DiscoveryCandidateControllerTest {

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
     * Test 1: POST bulk insert accepts array of candidate DTOs and returns persisted results.
     */
    @Test
    @DisplayName("Test 1: POST bulk insert accepts array of candidate DTOs and returns persisted results")
    void bulkInsert_acceptsArrayAndPersists() throws Exception {
        // Given
        UUID candidateId1 = UUID.randomUUID();
        UUID candidateId2 = UUID.randomUUID();
        UUID clusterId1 = UUID.randomUUID();
        UUID clusterId2 = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryCandidateDto dto1 = new DiscoveryCandidateDto(
            candidateId1, RUN_ID, "application", "OrderService",
            0.85, "proposed",
            List.of(clusterId1.toString(), clusterId2.toString()),
            Map.of("description", "Order management application", "techStack", "Java/Spring"),
            now.toString(),
            null,
            "pending_review", null, null, null,
            null,
            null
        );

        DiscoveryCandidateDto dto2 = new DiscoveryCandidateDto(
            candidateId2, RUN_ID, "service", "PaymentGateway",
            0.72, "proposed",
            List.of(clusterId2.toString()),
            Map.of("description", "Payment processing service"),
            now.toString(),
            null,
            "pending_review", null, null, null,
            null,
            null
        );

        List<DiscoveryCandidateDto> inputCandidates = List.of(dto1, dto2);

        when(discoveryCandidateService.bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList()))
            .thenReturn(inputCandidates);

        // When/Then
        mockMvc.perform(post(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(inputCandidates)))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value(candidateId1.toString()))
            .andExpect(jsonPath("$[0].run_id").value(RUN_ID.toString()))
            .andExpect(jsonPath("$[0].candidate_type").value("application"))
            .andExpect(jsonPath("$[0].name").value("OrderService"))
            .andExpect(jsonPath("$[0].confidence").value(0.85))
            .andExpect(jsonPath("$[0].status").value("proposed"))
            .andExpect(jsonPath("$[0].source_cluster_ids.length()").value(2))
            .andExpect(jsonPath("$[0].source_cluster_ids[0]").value(clusterId1.toString()))
            .andExpect(jsonPath("$[0].data.description").value("Order management application"))
            .andExpect(jsonPath("$[0].data.techStack").value("Java/Spring"))
            .andExpect(jsonPath("$[1].id").value(candidateId2.toString()))
            .andExpect(jsonPath("$[1].candidate_type").value("service"))
            .andExpect(jsonPath("$[1].name").value("PaymentGateway"))
            .andExpect(jsonPath("$[1].confidence").value(0.72));

        verify(discoveryCandidateService).bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList());
    }

    /**
     * Test 2: GET by run ID returns all candidates for that run.
     */
    @Test
    @DisplayName("Test 2: GET by run ID returns all candidates for that run")
    void listCandidates_returnsAllCandidatesForRun() throws Exception {
        // Given
        Instant now = Instant.now();

        DiscoveryCandidateDto candidate1 = new DiscoveryCandidateDto(
            UUID.randomUUID(), RUN_ID, "application", "OrderService",
            0.85, "proposed",
            List.of(UUID.randomUUID().toString()),
            Map.of("description", "Order management application"),
            now.toString(),
            null,
            "pending_review", null, null, null,
            null,
            null
        );

        DiscoveryCandidateDto candidate2 = new DiscoveryCandidateDto(
            UUID.randomUUID(), RUN_ID, "service", "PaymentGateway",
            0.72, "accepted",
            List.of(UUID.randomUUID().toString()),
            Map.of("description", "Payment processing service"),
            now.toString(),
            null,
            "approved", "Alice", now.toString(), "pending_review",
            null,
            null
        );

        DiscoveryCandidateDto candidate3 = new DiscoveryCandidateDto(
            UUID.randomUUID(), RUN_ID, "data_entity", "CustomerRecord",
            0.91, "proposed",
            List.of(UUID.randomUUID().toString()),
            Map.of("description", "Customer data entity"),
            now.toString(),
            null,
            "pending_review", null, null, null,
            null,
            null
        );

        when(discoveryCandidateService.getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, null, null))
            .thenReturn(List.of(candidate1, candidate2, candidate3));

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(3))
            .andExpect(jsonPath("$[0].candidate_type").value("application"))
            .andExpect(jsonPath("$[0].name").value("OrderService"))
            .andExpect(jsonPath("$[1].candidate_type").value("service"))
            .andExpect(jsonPath("$[1].status").value("accepted"))
            .andExpect(jsonPath("$[2].candidate_type").value("data_entity"))
            .andExpect(jsonPath("$[2].name").value("CustomerRecord"));

        verify(discoveryCandidateService).getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, null, null);
    }

    /**
     * Test 3: GET by run ID with ?type=application&status=proposed returns only matching
     * candidates (dual filter).
     */
    @Test
    @DisplayName("Test 3: GET by run ID with dual filter ?type=application&status=proposed returns matching candidates")
    void listCandidates_withDualFilter_returnsOnlyMatchingCandidates() throws Exception {
        // Given
        Instant now = Instant.now();

        DiscoveryCandidateDto matchingCandidate = new DiscoveryCandidateDto(
            UUID.randomUUID(), RUN_ID, "application", "OrderService",
            0.85, "proposed",
            List.of(UUID.randomUUID().toString()),
            Map.of("description", "Order management application"),
            now.toString(),
            null,
            "pending_review", null, null, null,
            null,
            null
        );

        when(discoveryCandidateService.getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, "application", "proposed"))
            .thenReturn(List.of(matchingCandidate));

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .param("type", "application")
                .param("status", "proposed"))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].candidate_type").value("application"))
            .andExpect(jsonPath("$[0].status").value("proposed"))
            .andExpect(jsonPath("$[0].name").value("OrderService"));

        verify(discoveryCandidateService).getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, "application", "proposed");
    }

    /**
     * Test 4: GET /count returns the correct candidate count.
     */
    @Test
    @DisplayName("Test 4: GET /count returns the correct candidate count for a run")
    void countCandidates_returnsCorrectCount() throws Exception {
        // Given
        when(discoveryCandidateService.countByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(17L);

        // When/Then
        mockMvc.perform(get(BASE_URL + "/count", PROJECT_ID, ARCHITECTURE_ID, RUN_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.count").value(17));

        verify(discoveryCandidateService).countByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID);
    }

    /**
     * Test 5: PUT /{candidateId} updates candidate status and returns updated DTO.
     */
    @Test
    @DisplayName("Test 5: PUT /{candidateId} updates candidate status and returns updated DTO")
    void updateCandidate_updatesStatusAndReturnsUpdatedDto() throws Exception {
        // Given
        UUID candidateId = UUID.randomUUID();
        UUID clusterId = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryCandidateDto updateRequest = new DiscoveryCandidateDto(
            null, null, "application", "OrderService",
            0.85, "accepted",
            List.of(clusterId.toString()),
            Map.of("description", "Order management application"),
            null,
            null,
            null, null, null, null,
            null,
            null
        );

        DiscoveryCandidateDto updatedResult = new DiscoveryCandidateDto(
            candidateId, RUN_ID, "application", "OrderService",
            0.85, "accepted",
            List.of(clusterId.toString()),
            Map.of("description", "Order management application"),
            now.toString(),
            null,
            "pending_review", null, null, null,
            null,
            null
        );

        when(discoveryCandidateService.updateCandidateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(candidateId), any(DiscoveryCandidateDto.class)))
            .thenReturn(updatedResult);

        // When/Then
        mockMvc.perform(put(BASE_URL + "/{candidateId}", PROJECT_ID, ARCHITECTURE_ID, RUN_ID, candidateId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(updateRequest)))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.id").value(candidateId.toString()))
            .andExpect(jsonPath("$.run_id").value(RUN_ID.toString()))
            .andExpect(jsonPath("$.candidate_type").value("application"))
            .andExpect(jsonPath("$.name").value("OrderService"))
            .andExpect(jsonPath("$.confidence").value(0.85))
            .andExpect(jsonPath("$.status").value("accepted"))
            .andExpect(jsonPath("$.source_cluster_ids[0]").value(clusterId.toString()))
            .andExpect(jsonPath("$.data.description").value("Order management application"))
            .andExpect(jsonPath("$.synthesized_at").value(now.toString()));

        verify(discoveryCandidateService).updateCandidateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(candidateId), any(DiscoveryCandidateDto.class));
    }

    // ---- Phase 1d: DELETE endpoint tests (Increment 10, Task Group 6) ----

    /**
     * Task 6.1 Test 4: DELETE endpoint returns 200 with count of deleted candidates.
     * Deleting for a non-existent runId returns 0 without error.
     *
     * Verifies that:
     * - DELETE /api/model/projects/{projectId}/discovery/runs/{runId}/candidates returns 200
     * - Response body contains {"deleted": <count>}
     * - The service deleteByRunId is called with the correct runId
     * - When no candidates exist (non-existent runId), returns {"deleted": 0}
     */
    @Test
    @DisplayName("Task 6.1 Test 4: DELETE endpoint returns 200 with deleted count; non-existent runId returns 0")
    void deleteCandidates_returns200WithDeletedCount() throws Exception {
        // Part 1: Deleting candidates for a run with existing candidates
        when(discoveryCandidateService.deleteByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(7L);

        mockMvc.perform(delete(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.deleted").value(7));

        verify(discoveryCandidateService).deleteByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID);

        // Part 2: Deleting for a non-existent runId returns 0 without error
        UUID nonExistentRunId = UUID.randomUUID();
        when(discoveryCandidateService.deleteByRunIdInArchitecture(nonExistentRunId, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(0L);

        mockMvc.perform(delete(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, nonExistentRunId))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.deleted").value(0));

        verify(discoveryCandidateService).deleteByRunIdInArchitecture(nonExistentRunId, PROJECT_ID, ARCHITECTURE_ID);
    }
}
