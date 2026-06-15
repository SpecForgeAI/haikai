package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.discovery.DiscoveryFindingDto;
import com.example.architecturemodel.model.dto.discovery.DiscoveryFindingLinkDto;
import com.example.architecturemodel.model.dto.discovery.ReviewDiscoveryFindingRequest;
import com.example.architecturemodel.model.dto.discovery.UpdateDiscoveryFindingRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffEntity;
import com.example.architecturemodel.service.ApiBehaviourDiffArchitectureGuard;
import com.example.architecturemodel.service.discovery.DiscoveryFindingService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for {@link ApiBehaviourDiffFindingController}.
 *
 * <p>Standalone setup mirrors {@code DiscoveryFindingControllerTest} -- no
 * full Spring context, {@link GlobalExceptionHandler} wired by hand so
 * error envelopes go through the same mapping as in production. The plain
 * {@link ObjectMapper} serialises DTO keys in camelCase (e.g.
 * {@code reviewStatus}); production wire is snake_case via the global
 * strategy.</p>
 *
 * <p>Spec: API Test Harness — Findings Integration (2026-05-25) -- Task
 * Group 1; normalized by Normalize Findings Review Actions (Spec F,
 * 2026-06-02) -- {@code status} renamed to {@code reviewStatus} with the
 * candidate-parity disposition vocabulary.</p>
 */
@ExtendWith(MockitoExtension.class)
class ApiBehaviourDiffFindingControllerTest {

    @Mock
    private DiscoveryFindingService service;

    @Mock
    private ApiBehaviourDiffArchitectureGuard diffGuard;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCHITECTURE_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID DIFF_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID DIFF_ITEM_ID = UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID FINDING_ID = UUID.fromString("55555555-5555-5555-5555-555555555555");

    private static final Instant NOW = Instant.parse("2026-05-25T10:00:00Z");

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new ApiBehaviourDiffFindingController(service, diffGuard))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    private DiscoveryFindingDto diffFinding(String severity, String reviewStatus) {
        return new DiscoveryFindingDto(
            FINDING_ID,
            null,                       // runId -- null for diff-sourced
            DIFF_ID,                    // apiBehaviourDiffId
            PROJECT_ID, ARCHITECTURE_ID,
            "api_behaviour_status_drift", "api_behaviour_drift", severity,
            null, reviewStatus, null,   // confidence, reviewStatus, previousReviewStatus
            "Status drift: GET /widgets responded 200 -> 500",
            "Source 200 vs target 500.",
            Map.of("method", "GET", "path", "/widgets"),
            "api_behaviour_diff", "diffRunner.findingEmission",
            NOW, NOW, null, null,
            List.of(new DiscoveryFindingLinkDto(
                UUID.randomUUID(), FINDING_ID, "derived_from",
                "api_behaviour_diff_item", DIFF_ITEM_ID.toString(),
                null, NOW))
        );
    }

    @Test
    @DisplayName("GET /findings returns the diff-scoped list and serialises apiBehaviourDiffId")
    void listForDiffReturnsDtoArray() throws Exception {
        doNothing().when(diffGuard).verify(eq(DIFF_ID), eq(PROJECT_ID));
        when(service.listForDiff(DIFF_ID))
            .thenReturn(List.of(
                diffFinding("critical", "pending_review"),
                diffFinding("medium", "approved")));

        mockMvc.perform(get(
                "/api/projects/{p}/api-behaviour/diffs/{d}/findings",
                PROJECT_ID, DIFF_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].apiBehaviourDiffId").value(DIFF_ID.toString()))
            .andExpect(jsonPath("$[0].runId").doesNotExist())
            .andExpect(jsonPath("$[0].severity").value("critical"))
            .andExpect(jsonPath("$[0].source").value("api_behaviour_diff"))
            .andExpect(jsonPath("$[1].reviewStatus").value("approved"));
    }

    @Test
    @DisplayName("GET /findings/by-diff-item/{diffItemId} returns findings linked to the diff_item")
    void listByDiffItemReturnsLinked() throws Exception {
        doNothing().when(diffGuard).verify(eq(DIFF_ID), eq(PROJECT_ID));
        when(service.findingsByDiffItem(DIFF_ID, DIFF_ITEM_ID))
            .thenReturn(List.of(diffFinding("high", "pending_review")));

        mockMvc.perform(get(
                "/api/projects/{p}/api-behaviour/diffs/{d}/findings/by-diff-item/{i}",
                PROJECT_ID, DIFF_ID, DIFF_ITEM_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].apiBehaviourDiffId").value(DIFF_ID.toString()))
            .andExpect(jsonPath("$[0].links[0].targetType").value("api_behaviour_diff_item"))
            .andExpect(jsonPath("$[0].links[0].targetId").value(DIFF_ITEM_ID.toString()));
    }

    @Test
    @DisplayName("PATCH /findings/{findingId} transitions review_status and returns the updated finding")
    void patchTransitionsStatus() throws Exception {
        doNothing().when(diffGuard).verify(eq(DIFF_ID), eq(PROJECT_ID));
        when(service.updateForDiff(eq(DIFF_ID), eq(FINDING_ID),
                any(UpdateDiscoveryFindingRequest.class)))
            .thenReturn(diffFinding("critical", "approved"));

        String body = objectMapper.writeValueAsString(Map.of("reviewStatus", "approved"));

        mockMvc.perform(patch(
                "/api/projects/{p}/api-behaviour/diffs/{d}/findings/{f}",
                PROJECT_ID, DIFF_ID, FINDING_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.reviewStatus").value("approved"))
            .andExpect(jsonPath("$.apiBehaviourDiffId").value(DIFF_ID.toString()));
    }

    @Test
    @DisplayName("POST /findings/{findingId}/review stamps reviewer state and returns the updated finding")
    void reviewSetsReviewerState() throws Exception {
        ApiBehaviourDiffEntity diff = ApiBehaviourDiffEntity.builder()
            .id(DIFF_ID).projectId(PROJECT_ID).architectureId(ARCHITECTURE_ID)
            .sourceBaselineId(UUID.randomUUID()).targetBaselineId(UUID.randomUUID())
            .status("completed").build();
        when(diffGuard.verifyAndLoad(eq(DIFF_ID), eq(PROJECT_ID))).thenReturn(diff);

        DiscoveryFindingDto reviewed = new DiscoveryFindingDto(
            FINDING_ID, null, DIFF_ID, PROJECT_ID, ARCHITECTURE_ID,
            "api_behaviour_status_drift", "api_behaviour_drift", "critical",
            null, "approved", "pending_review",
            "Status drift", "summary", Map.of(),
            "api_behaviour_diff", "diffRunner.findingEmission",
            NOW, NOW, NOW, "looks ok",
            List.of());
        when(service.reviewForDiff(eq(DIFF_ID), eq(FINDING_ID),
                any(ReviewDiscoveryFindingRequest.class)))
            .thenReturn(reviewed);

        String body = objectMapper.writeValueAsString(Map.of(
            "reviewStatus", "approved",
            "reviewerNotes", "looks ok"));

        mockMvc.perform(post(
                "/api/projects/{p}/api-behaviour/diffs/{d}/findings/{f}/review",
                PROJECT_ID, DIFF_ID, FINDING_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.reviewStatus").value("approved"))
            .andExpect(jsonPath("$.reviewerNotes").value("looks ok"))
            .andExpect(jsonPath("$.reviewedAt").exists());
    }

    @Test
    @DisplayName("GET /findings on a diff not in scope of the URL projectId returns 404")
    void listForDiffOutOfScopeReturns404() throws Exception {
        doThrow(new ResourceNotFoundException(
            "API behaviour diff " + DIFF_ID + " does not belong to project " + PROJECT_ID))
            .when(diffGuard).verify(eq(DIFF_ID), eq(PROJECT_ID));

        mockMvc.perform(get(
                "/api/projects/{p}/api-behaviour/diffs/{d}/findings",
                PROJECT_ID, DIFF_ID))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message")
                .value(org.hamcrest.Matchers.containsString("does not belong to project")));
    }
}
