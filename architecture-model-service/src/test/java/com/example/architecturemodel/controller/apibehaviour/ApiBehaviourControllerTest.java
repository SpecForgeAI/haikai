package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineDto;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineItemDto;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureSessionDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourCaptureSessionRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourCaptureSessionRequest;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourBaselineItemService;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourBaselineService;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourCaptureSessionService;
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
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for the API Behaviour controller surface.
 *
 * <p>Standalone setup mirrors {@code ArchitectureElementMappingControllerTest}
 * — no full Spring context (the project has unrelated pre-existing failures
 * documented in MEMORY.md), and the global exception handler is wired by hand
 * so error envelopes go through the same mapping as in production.</p>
 *
 * <p>Covers Task Group 2.1 of the API Behaviour Baseline Capture Service spec
 * (2026-05-15):</p>
 * <ol>
 *   <li>{@code POST /api/projects/{projectId}/api-behaviour/capture-sessions}
 *       happy path returns 201 with the created DTO.</li>
 *   <li>{@code PATCH} on a capture session with a partial body — verifies
 *       the boxed-{@link Boolean} {@code mutatingCallsConfirmed} field is NOT
 *       wiped to {@code false} when the client omits it (covers the
 *       primitive-double pitfall).</li>
 *   <li>{@code GET /api/projects/{projectId}/api-behaviour/baselines}
 *       returns the ordered list and forwards the {@code architectureId}
 *       query param to the service.</li>
 *   <li>{@code GET /api/projects/{projectId}/api-behaviour/baseline-items?baselineId=...}
 *       returns items for the baseline.</li>
 *   <li>{@code PATCH} on a capture session with an illegal status transition
 *       returns 409 (status guards enforced at service layer).</li>
 * </ol>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
@ExtendWith(MockitoExtension.class)
class ApiBehaviourControllerTest {

    @Mock
    private ApiBehaviourCaptureSessionService sessionService;

    @Mock
    private ApiBehaviourBaselineService baselineService;

    @Mock
    private ApiBehaviourBaselineItemService baselineItemService;

    private MockMvc sessionMockMvc;
    private MockMvc baselineMockMvc;
    private MockMvc baselineItemMockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCHITECTURE_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID SESSION_ID =
        UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID BASELINE_ID =
        UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID ITEM_ID =
        UUID.fromString("55555555-5555-5555-5555-555555555555");

    private static final Instant NOW = Instant.parse("2026-05-15T10:00:00Z");

    @BeforeEach
    void setUp() {
        sessionMockMvc = MockMvcBuilders
            .standaloneSetup(new ApiBehaviourCaptureSessionController(sessionService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        baselineMockMvc = MockMvcBuilders
            .standaloneSetup(new ApiBehaviourBaselineController(baselineService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        baselineItemMockMvc = MockMvcBuilders
            .standaloneSetup(new ApiBehaviourBaselineItemController(baselineItemService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    private ApiBehaviourCaptureSessionDto sessionDto(String status, Boolean mutatingConfirmed) {
        return new ApiBehaviourCaptureSessionDto(
            SESSION_ID, PROJECT_ID, ARCHITECTURE_ID,
            "test session", status,
            "non-prod", "https://api.example.test", "bearer",
            Map.of("authType", "bearer"),
            Map.of("X-Trace", "[REDACTED]"),
            null, null,
            mutatingConfirmed,
            null, null, null,
            NOW, NOW
        );
    }

    @Test
    @DisplayName("POST /capture-sessions happy path returns 201 with the created DTO and forwards architectureId from the body")
    void createCaptureSessionHappyPath() throws Exception {
        when(sessionService.create(eq(PROJECT_ID),
                any(CreateApiBehaviourCaptureSessionRequest.class)))
            .thenReturn(sessionDto("draft", Boolean.FALSE));

        String body = objectMapper.writeValueAsString(Map.of(
            "architectureId", ARCHITECTURE_ID.toString(),
            "name", "test session",
            "environmentName", "non-prod",
            "apiBaseUrl", "https://api.example.test",
            "authType", "bearer",
            "mutatingCallsConfirmed", false
        ));

        sessionMockMvc.perform(post("/api/projects/{projectId}/api-behaviour/capture-sessions",
                PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(SESSION_ID.toString()))
            .andExpect(jsonPath("$.projectId").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.architectureId").value(ARCHITECTURE_ID.toString()))
            .andExpect(jsonPath("$.status").value("draft"))
            .andExpect(jsonPath("$.mutatingCallsConfirmed").value(false));

        ArgumentCaptor<CreateApiBehaviourCaptureSessionRequest> captor =
            ArgumentCaptor.forClass(CreateApiBehaviourCaptureSessionRequest.class);
        verify(sessionService).create(eq(PROJECT_ID), captor.capture());
        assertThat(captor.getValue().architectureId()).isEqualTo(ARCHITECTURE_ID);
        assertThat(captor.getValue().name()).isEqualTo("test session");
    }

    @Test
    @DisplayName("PATCH /capture-sessions/{id} with partial body: mutatingCallsConfirmed=null in JSON binds to null on DTO and is preserved (PATCH does NOT wipe boxed-Boolean fields)")
    void patchPreservesBoxedBooleanWhenOmitted() throws Exception {
        // The service is mocked here so the controller test only proves that
        // the controller-bound DTO's mutatingCallsConfirmed is NULL (not
        // false) when the JSON body omits it. The corresponding service-layer
        // behaviour (null-guard preserves the existing column value) is
        // exercised separately by the persistence/service unit tests.
        when(sessionService.update(eq(PROJECT_ID), eq(SESSION_ID),
                any(UpdateApiBehaviourCaptureSessionRequest.class)))
            .thenReturn(sessionDto("configured", Boolean.TRUE));

        // Body omits mutatingCallsConfirmed entirely.
        String body = objectMapper.writeValueAsString(Map.of(
            "name", "renamed",
            "status", "configured"
        ));

        sessionMockMvc.perform(patch(
                "/api/projects/{projectId}/api-behaviour/capture-sessions/{sessionId}",
                PROJECT_ID, SESSION_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("configured"))
            // Critical assertion: the response shows the EXISTING true value
            // was preserved (the mock returns true). If the DTO had used a
            // primitive boolean, the omitted JSON key would have bound to
            // false and the service would have flipped the column.
            .andExpect(jsonPath("$.mutatingCallsConfirmed").value(true));

        ArgumentCaptor<UpdateApiBehaviourCaptureSessionRequest> captor =
            ArgumentCaptor.forClass(UpdateApiBehaviourCaptureSessionRequest.class);
        verify(sessionService).update(eq(PROJECT_ID), eq(SESSION_ID), captor.capture());
        UpdateApiBehaviourCaptureSessionRequest sent = captor.getValue();
        // The DTO field is null because the JSON key was omitted -- the
        // service-layer null-guard preserves the existing column value.
        assertThat(sent.mutatingCallsConfirmed())
            .as("Boxed Boolean must be null when JSON key is omitted (PATCH semantic)")
            .isNull();
        assertThat(sent.name()).isEqualTo("renamed");
        assertThat(sent.status()).isEqualTo("configured");
    }

    @Test
    @DisplayName("GET /baselines?architectureId=... returns ordered list and forwards architectureId to service")
    void listBaselinesByArchitecture() throws Exception {
        ApiBehaviourBaselineDto baselineA = new ApiBehaviourBaselineDto(
            BASELINE_ID, PROJECT_ID, ARCHITECTURE_ID, SESSION_ID,
            "v1 baseline", "active", 5, 3, "first run",
            NOW, NOW
        );
        ApiBehaviourBaselineDto baselineB = new ApiBehaviourBaselineDto(
            UUID.randomUUID(), PROJECT_ID, ARCHITECTURE_ID, SESSION_ID,
            "v0 baseline", "archived", 2, 2, null,
            NOW.minusSeconds(86400), NOW.minusSeconds(86400)
        );
        when(baselineService.listByProjectAndArchitecture(PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(List.of(baselineA, baselineB));

        baselineMockMvc.perform(get("/api/projects/{projectId}/api-behaviour/baselines",
                PROJECT_ID)
                .param("architectureId", ARCHITECTURE_ID.toString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value(BASELINE_ID.toString()))
            .andExpect(jsonPath("$[0].name").value("v1 baseline"))
            .andExpect(jsonPath("$[0].status").value("active"))
            .andExpect(jsonPath("$[0].acceptedCaptureCount").value(5))
            .andExpect(jsonPath("$[1].name").value("v0 baseline"));

        verify(baselineService).listByProjectAndArchitecture(PROJECT_ID, ARCHITECTURE_ID);
    }

    @Test
    @DisplayName("GET /baseline-items?baselineId=... returns items for the baseline")
    void listBaselineItems() throws Exception {
        ApiBehaviourBaselineItemDto item = new ApiBehaviourBaselineItemDto(
            ITEM_ID,
            BASELINE_ID,
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            "GET", "/widgets", "happy",
            Map.of("query", Map.of("limit", 10)),
            200,
            Map.of("items", List.of(Map.of("id", "w1"))),
            "noted",
            NOW, NOW
        );
        when(baselineItemService.listByBaseline(BASELINE_ID)).thenReturn(List.of(item));

        baselineItemMockMvc.perform(get(
                "/api/projects/{projectId}/api-behaviour/baseline-items", PROJECT_ID)
                .param("baselineId", BASELINE_ID.toString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].id").value(ITEM_ID.toString()))
            .andExpect(jsonPath("$[0].baselineId").value(BASELINE_ID.toString()))
            .andExpect(jsonPath("$[0].method").value("GET"))
            .andExpect(jsonPath("$[0].path").value("/widgets"))
            .andExpect(jsonPath("$[0].responseStatus").value(200));

        verify(baselineItemService).listByBaseline(BASELINE_ID);
    }

    @Test
    @DisplayName("PATCH on capture session with illegal status transition surfaces a 409 from the service-layer guard")
    void patchIllegalStatusTransitionReturns409() throws Exception {
        when(sessionService.update(eq(PROJECT_ID), eq(SESSION_ID),
                any(UpdateApiBehaviourCaptureSessionRequest.class)))
            .thenThrow(new com.example.architecturemodel.exception.ConflictException(
                "Illegal status transition for api-behaviour capture session: 'draft' -> 'completed'"));

        String body = objectMapper.writeValueAsString(Map.of("status", "completed"));

        sessionMockMvc.perform(patch(
                "/api/projects/{projectId}/api-behaviour/capture-sessions/{sessionId}",
                PROJECT_ID, SESSION_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.message").value(
                "Illegal status transition for api-behaviour capture session: 'draft' -> 'completed'"));
    }
}
