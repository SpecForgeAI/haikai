package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryCandidateDto;
import com.example.architecturemodel.model.dto.discovery.BulkCandidateEditResponse;
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
import java.util.NoSuchElementException;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Controller tests for the new {@code POST .../candidates/bulk-edit} endpoint
 * added by the Skipped-candidate visibility + grouped bulk-fill (C1) spec
 * (2026-06-20) Task Group 3.
 *
 * <p>Mirrors {@code DiscoveryCandidateControllerTest} (the {@code @WebMvcTest} +
 * {@code MockMvc} setup, including the same {@code @MockBean}s the controller
 * requires). The endpoint is the atomic bulk-candidate-EDIT mirror of
 * {@code bulkReviewCascade}, so these tests assert the request reaches the service
 * verbatim, the snake_case response shape ({@code applied_count} /
 * {@code requested_count} / {@code ids} / {@code applied[]}), and the
 * exception-&gt;status mapping (run-not-found -&gt; 404; bad request -&gt; 400).</p>
 */
@WebMvcTest(DiscoveryCandidateController.class)
class DiscoveryCandidateBulkEditControllerTest {

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
    private static final String BULK_EDIT_URL =
        "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidates/bulk-edit";

    /**
     * Test 1: a valid bulk-edit request returns 200 with the snake_case response
     * shape -- {@code applied_count} / {@code requested_count} / {@code ids} /
     * {@code applied[]} (each applied row is a snake_case {@link DiscoveryCandidateDto}
     * carrying the patched {@code data} blob). The request body (a {@code patches}
     * array carrying {@code candidate_id} + field patches + a {@code data} overlay)
     * is forwarded to the service.
     */
    @Test
    @DisplayName("Test 1: POST /bulk-edit returns 200 with the snake_case applied response shape")
    void bulkEdit_validRequest_returnsAppliedResponseShape() throws Exception {
        UUID candidateId = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryCandidateDto appliedDto = new DiscoveryCandidateDto(
            candidateId, RUN_ID, "interface", "OrderApi",
            0.80, "proposed",
            List.of(UUID.randomUUID().toString()),
            Map.of("interface_type", "MESSAGE_QUEUE", "description", "Order interface"),
            now.toString(),
            null,
            "committed", null, null, null,
            null,
            null
        );

        BulkCandidateEditResponse response = new BulkCandidateEditResponse(
            1, 1, List.of(candidateId), List.of(appliedDto));

        when(discoveryCandidateService.bulkEditInArchitecture(
                eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID),
                any(com.example.architecturemodel.model.dto.discovery.BulkCandidateEditRequest.class)))
            .thenReturn(response);

        // Build the request body as raw snake_case JSON (the wire shape the frontend sends).
        String body = "{\"patches\":[{"
            + "\"candidate_id\":\"" + candidateId + "\","
            + "\"review_status\":\"committed\","
            + "\"data\":{\"interface_type\":\"MESSAGE_QUEUE\"}"
            + "}]}";

        mockMvc.perform(post(BULK_EDIT_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.applied_count").value(1))
            .andExpect(jsonPath("$.requested_count").value(1))
            .andExpect(jsonPath("$.ids[0]").value(candidateId.toString()))
            .andExpect(jsonPath("$.applied[0].id").value(candidateId.toString()))
            .andExpect(jsonPath("$.applied[0].candidate_type").value("interface"))
            .andExpect(jsonPath("$.applied[0].review_status").value("committed"))
            .andExpect(jsonPath("$.applied[0].data.interface_type").value("MESSAGE_QUEUE"))
            .andExpect(jsonPath("$.applied[0].data.description").value("Order interface"));

        verify(discoveryCandidateService).bulkEditInArchitecture(
            eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID),
            any(com.example.architecturemodel.model.dto.discovery.BulkCandidateEditRequest.class));
    }

    /**
     * Test 2: when the run guard rejects the (run, project, architecture) tuple the
     * service throws {@code NoSuchElementException}; the controller maps it to 404
     * (mirrors {@code updateCandidate} / {@code bulkReviewCascade}).
     */
    @Test
    @DisplayName("Test 2: run not found in architecture -> 404")
    void bulkEdit_runNotFound_returns404() throws Exception {
        when(discoveryCandidateService.bulkEditInArchitecture(
                eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID),
                any(com.example.architecturemodel.model.dto.discovery.BulkCandidateEditRequest.class)))
            .thenThrow(new NoSuchElementException("Discovery run not found: " + RUN_ID));

        String body = "{\"patches\":[{\"candidate_id\":\"" + UUID.randomUUID() + "\",\"name\":\"X\"}]}";

        mockMvc.perform(post(BULK_EDIT_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isNotFound());
    }

    /**
     * Test 3: an unknown candidate id surfaces from the service as an
     * {@code IllegalArgumentException} whose message contains "not found"; the
     * controller maps that to 404 (the bulk-edit endpoint's not-found arm).
     */
    @Test
    @DisplayName("Test 3: an unknown candidate id (message contains 'not found') -> 404")
    void bulkEdit_unknownCandidate_returns404() throws Exception {
        UUID missing = UUID.randomUUID();
        when(discoveryCandidateService.bulkEditInArchitecture(
                eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID),
                any(com.example.architecturemodel.model.dto.discovery.BulkCandidateEditRequest.class)))
            .thenThrow(new IllegalArgumentException("Candidate not found: " + missing));

        String body = "{\"patches\":[{\"candidate_id\":\"" + missing + "\",\"name\":\"X\"}]}";

        mockMvc.perform(post(BULK_EDIT_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("Candidate not found: " + missing));
    }

    /**
     * Test 4: a bad request (an {@code IllegalArgumentException} whose message does
     * NOT contain "not found", e.g. a patch missing its {@code candidate_id}) maps to
     * 400 with the error body.
     */
    @Test
    @DisplayName("Test 4: a bad request (no candidate_id) -> 400")
    void bulkEdit_badRequest_returns400() throws Exception {
        when(discoveryCandidateService.bulkEditInArchitecture(
                eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID),
                any(com.example.architecturemodel.model.dto.discovery.BulkCandidateEditRequest.class)))
            .thenThrow(new IllegalArgumentException("Each bulk-edit patch requires a candidate_id"));

        String body = "{\"patches\":[{\"name\":\"X\"}]}";

        mockMvc.perform(post(BULK_EDIT_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Each bulk-edit patch requires a candidate_id"));
    }
}
