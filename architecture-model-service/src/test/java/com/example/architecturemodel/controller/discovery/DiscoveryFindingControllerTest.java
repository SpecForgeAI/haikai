package com.example.architecturemodel.controller.discovery;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.InvalidFindingLinkTargetException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.discovery.CreateDiscoveryFindingRequest;
import com.example.architecturemodel.model.dto.discovery.DiscoveryFindingDto;
import com.example.architecturemodel.model.dto.discovery.DiscoveryFindingSearchResponse;
import com.example.architecturemodel.model.dto.discovery.ReviewDiscoveryFindingRequest;
import com.example.architecturemodel.model.dto.discovery.UpdateDiscoveryFindingRequest;
import com.example.architecturemodel.service.discovery.DiscoveryFindingService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for {@link DiscoveryFindingController}.
 *
 * <p>Standalone setup mirrors {@code ApiBehaviourControllerTest} -- no full
 * Spring context (the project has unrelated pre-existing failures documented
 * in MEMORY.md), and {@link GlobalExceptionHandler} is wired by hand so
 * error envelopes go through the same mapping as in production.</p>
 *
 * <p><b>Wire-naming note:</b> the standalone MockMvc converter uses a plain
 * {@link ObjectMapper} (NOT the Spring-configured SNAKE_CASE one), so DTO JSON
 * keys here are the raw camelCase record-component names (e.g.
 * {@code reviewStatus}). Production wire is snake_case via the global
 * strategy; that mapping is exercised by integration tests, not this slice.</p>
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 2.1; normalized by Normalize Findings Review
 * Actions (Spec F, 2026-06-02) -- {@code status} renamed to
 * {@code reviewStatus} with the candidate-parity disposition vocabulary.</p>
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryFindingControllerTest {

    @Mock
    private DiscoveryFindingService service;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCHITECTURE_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID RUN_ID =
        UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID FINDING_ID =
        UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID CANDIDATE_ID =
        UUID.fromString("55555555-5555-5555-5555-555555555555");

    private static final Instant NOW = Instant.parse("2026-05-16T10:00:00Z");

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new DiscoveryFindingController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    private DiscoveryFindingDto findingDto(String reviewStatus, Double confidence, String severity) {
        return new DiscoveryFindingDto(
            FINDING_ID, RUN_ID, PROJECT_ID, ARCHITECTURE_ID,
            "low_confidence_candidate", "ambiguity", severity,
            confidence, reviewStatus,
            "test finding", "summary text",
            Map.of("key", "value"),
            "test", "controller-test",
            NOW, NOW, null, null,
            List.of()
        );
    }

    @Test
    @DisplayName("POST /findings happy path: returns 201, defaults review_status='pending_review' when omitted, forwards path scope ids")
    void createFindingHappyPath() throws Exception {
        when(service.create(eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(RUN_ID),
                any(CreateDiscoveryFindingRequest.class)))
            .thenReturn(findingDto("pending_review", 0.5, "medium"));

        String body = objectMapper.writeValueAsString(Map.of(
            "findingType", "low_confidence_candidate",
            "category", "ambiguity",
            "severity", "medium",
            "title", "test finding"
        ));

        mockMvc.perform(post(
                "/api/model/projects/{p}/architectures/{a}/discovery/runs/{r}/findings",
                PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(FINDING_ID.toString()))
            .andExpect(jsonPath("$.runId").value(RUN_ID.toString()))
            .andExpect(jsonPath("$.projectId").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.architectureId").value(ARCHITECTURE_ID.toString()))
            .andExpect(jsonPath("$.reviewStatus").value("pending_review"));

        ArgumentCaptor<CreateDiscoveryFindingRequest> captor =
            ArgumentCaptor.forClass(CreateDiscoveryFindingRequest.class);
        verify(service).create(eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(RUN_ID),
            captor.capture());
        assertThat(captor.getValue().title()).isEqualTo("test finding");
        // review_status was omitted in JSON -- binds to null; service applies
        // the 'pending_review' default.
        assertThat(captor.getValue().reviewStatus()).isNull();
    }

    @Test
    @DisplayName("POST /findings out-of-scope run returns 404 (ResourceNotFoundException from run guard)")
    void createFindingOutOfScopeReturns404() throws Exception {
        when(service.create(eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(RUN_ID),
                any(CreateDiscoveryFindingRequest.class)))
            .thenThrow(new ResourceNotFoundException(
                "Discovery run " + RUN_ID
                    + " is not bound to architecture " + ARCHITECTURE_ID));

        String body = objectMapper.writeValueAsString(Map.of(
            "findingType", "low_confidence_candidate",
            "category", "ambiguity",
            "severity", "medium",
            "title", "scope mismatch"
        ));

        mockMvc.perform(post(
                "/api/model/projects/{p}/architectures/{a}/discovery/runs/{r}/findings",
                PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message")
                .value(org.hamcrest.Matchers.containsString("not bound to architecture")));
    }

    @Test
    @DisplayName("POST /findings/{id}/links D6 invalid target returns 400 with code=invalid_link_target")
    void addLinkInvalidTargetReturns400() throws Exception {
        when(service.addLink(eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(RUN_ID),
                eq(FINDING_ID), any()))
            .thenThrow(new InvalidFindingLinkTargetException(
                "discovery_candidate",
                CANDIDATE_ID.toString(),
                "target belongs to a different run"));

        String body = objectMapper.writeValueAsString(Map.of(
            "linkType", "supports",
            "targetType", "discovery_candidate",
            "targetId", CANDIDATE_ID.toString()
        ));

        mockMvc.perform(post(
                "/api/model/projects/{p}/architectures/{a}/discovery/runs/{r}/findings/{f}/links",
                PROJECT_ID, ARCHITECTURE_ID, RUN_ID, FINDING_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("invalid_link_target"))
            .andExpect(jsonPath("$.target_type").value("discovery_candidate"))
            .andExpect(jsonPath("$.target_id").value(CANDIDATE_ID.toString()));
    }

    @Test
    @DisplayName("PATCH /findings/{id} with only reviewer_notes preserves confidence (boxed Double is null on DTO)")
    void patchPreservesConfidenceWhenOmitted() throws Exception {
        when(service.update(eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(RUN_ID), eq(FINDING_ID),
                any(UpdateDiscoveryFindingRequest.class)))
            .thenReturn(findingDto("pending_review", 0.87, "medium"));

        // Body omits confidence and review_status entirely.
        String body = objectMapper.writeValueAsString(Map.of(
            "reviewerNotes", "needs another look"
        ));

        mockMvc.perform(patch(
                "/api/model/projects/{p}/architectures/{a}/discovery/runs/{r}/findings/{f}",
                PROJECT_ID, ARCHITECTURE_ID, RUN_ID, FINDING_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.reviewStatus").value("pending_review"))
            .andExpect(jsonPath("$.confidence").value(0.87));

        ArgumentCaptor<UpdateDiscoveryFindingRequest> captor =
            ArgumentCaptor.forClass(UpdateDiscoveryFindingRequest.class);
        verify(service).update(eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(RUN_ID), eq(FINDING_ID),
            captor.capture());
        UpdateDiscoveryFindingRequest sent = captor.getValue();
        assertThat(sent.confidence())
            .as("Boxed Double must be null when JSON key is omitted")
            .isNull();
        assertThat(sent.reviewStatus()).isNull();
        assertThat(sent.reviewerNotes()).isEqualTo("needs another look");
    }

    @Test
    @DisplayName("POST /findings/{id}/review with review_status + notes sets reviewed_at and returns updated DTO")
    void reviewSetsStatusAndNotes() throws Exception {
        DiscoveryFindingDto reviewed = new DiscoveryFindingDto(
            FINDING_ID, RUN_ID, PROJECT_ID, ARCHITECTURE_ID,
            "low_confidence_candidate", "ambiguity", "medium",
            0.5, "approved",
            "test finding", "summary",
            Map.of(),
            "test", "controller-test",
            NOW, NOW, NOW, "looks ok",
            List.of()
        );
        when(service.review(eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(RUN_ID), eq(FINDING_ID),
                any(ReviewDiscoveryFindingRequest.class)))
            .thenReturn(reviewed);

        String body = objectMapper.writeValueAsString(Map.of(
            "reviewStatus", "approved",
            "reviewerNotes", "looks ok"
        ));

        mockMvc.perform(post(
                "/api/model/projects/{p}/architectures/{a}/discovery/runs/{r}/findings/{f}/review",
                PROJECT_ID, ARCHITECTURE_ID, RUN_ID, FINDING_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.reviewStatus").value("approved"))
            .andExpect(jsonPath("$.reviewerNotes").value("looks ok"))
            .andExpect(jsonPath("$.reviewedAt").exists());
    }

    @Test
    @DisplayName("PATCH /findings/{id} with an out-of-vocabulary review_status surfaces 400 (IllegalArgumentException)")
    void patchInvalidReviewStatusReturns400() throws Exception {
        // Spec F: transitions are unrestricted (any->any), so there is no
        // 'illegal transition' 422 any more. A value outside ALLOWED_STATUSES
        // is a plain bad request.
        when(service.update(eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(RUN_ID), eq(FINDING_ID),
                any(UpdateDiscoveryFindingRequest.class)))
            .thenThrow(new IllegalArgumentException(
                "review_status 'bogus' is not in the allowed set"));

        String body = objectMapper.writeValueAsString(Map.of("reviewStatus", "bogus"));

        mockMvc.perform(patch(
                "/api/model/projects/{p}/architectures/{a}/discovery/runs/{r}/findings/{f}",
                PROJECT_ID, ARCHITECTURE_ID, RUN_ID, FINDING_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message")
                .value(org.hamcrest.Matchers.containsString("not in the allowed set")));
    }

    @Test
    @DisplayName("GET /findings forwards multi-filter query params to the service and returns the paged envelope")
    void listFiltersForwarded() throws Exception {
        DiscoveryFindingDto match = findingDto("deferred", 0.6, "high");
        when(service.list(eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(RUN_ID),
                any(), any(), any(), any(),
                any(), any(),
                any(), any(),
                any(), anyInt(), anyInt()))
            .thenReturn(new DiscoveryFindingSearchResponse(List.of(match), 1L, 0, 50));

        mockMvc.perform(get(
                "/api/model/projects/{p}/architectures/{a}/discovery/runs/{r}/findings",
                PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .param("status", "deferred")
                .param("severity", "high")
                .param("linkedTargetType", "discovery_candidate")
                .param("linkedTargetId", CANDIDATE_ID.toString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items.length()").value(1))
            .andExpect(jsonPath("$.items[0].reviewStatus").value("deferred"))
            .andExpect(jsonPath("$.items[0].severity").value("high"))
            .andExpect(jsonPath("$.total").value(1));

        verify(service).list(eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(RUN_ID),
            eq(null), eq(null), eq("high"), eq("deferred"),
            eq(null), eq(null),
            eq("discovery_candidate"), eq(CANDIDATE_ID.toString()),
            eq(null), anyInt(), anyInt());
    }
}
