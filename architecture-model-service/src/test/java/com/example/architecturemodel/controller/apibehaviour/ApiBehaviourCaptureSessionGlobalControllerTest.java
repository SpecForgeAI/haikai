package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureSessionDto;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourCaptureSessionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Standalone MockMvc tests for {@link ApiBehaviourCaptureSessionGlobalController}
 * -- the cross-project (non-scoped) {@code GET /api/api-behaviour/capture-sessions?status=...}
 * endpoint the {@code api-migration-validation-service} calls at startup
 * (orphan-session reconciliation) and at the start of every target replay.
 *
 * <p>Verifies the endpoint actually MAPS and forwards the {@code status} param --
 * the original defect was a 404 because no controller was mapped at this path.
 * Standalone setup mirrors {@link ApiBehaviourControllerTest} (no full Spring
 * context -- the project has unrelated pre-existing H2-boot failures, e.g.
 * {@code ApiContractSmokeTest}), with the global exception handler wired by hand.</p>
 *
 * <p>The cross-project semantics + the snake_case wire shape are covered by the
 * persistence-level {@code ApiBehaviourCaptureSessionGlobalListTest}; here we
 * assert only case-identical fields ({@code id} / {@code status} / list length),
 * because the standalone converter uses a default (camelCase) ObjectMapper rather
 * than the globally-configured SNAKE_CASE strategy.</p>
 */
@ExtendWith(MockitoExtension.class)
class ApiBehaviourCaptureSessionGlobalControllerTest {

    @Mock
    private ApiBehaviourCaptureSessionService service;

    private MockMvc mockMvc;

    private static final UUID PROJECT_A = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID PROJECT_B = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID SESSION_A = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID SESSION_B = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final Instant NOW = Instant.parse("2026-05-31T10:00:00Z");

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new ApiBehaviourCaptureSessionGlobalController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    private ApiBehaviourCaptureSessionDto runningSession(UUID id, UUID projectId) {
        return new ApiBehaviourCaptureSessionDto(
            id, projectId, UUID.randomUUID(),
            "session-" + id, "running",
            "non-prod", "https://api.example.test", "bearer",
            null, null, null, null,
            Boolean.FALSE,
            NOW, null, null,
            "current", null,
            NOW, NOW);
    }

    @Test
    @DisplayName("GET /api/api-behaviour/capture-sessions?status=running maps, forwards the status param, and returns the service list")
    void listByStatusReturnsList() throws Exception {
        when(service.listByStatus("running")).thenReturn(List.of(
            runningSession(SESSION_A, PROJECT_A),
            runningSession(SESSION_B, PROJECT_B)));

        mockMvc.perform(get("/api/api-behaviour/capture-sessions").param("status", "running"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value(SESSION_A.toString()))
            .andExpect(jsonPath("$[1].id").value(SESSION_B.toString()))
            .andExpect(jsonPath("$[0].status").value("running"));

        verify(service).listByStatus(eq("running"));
    }

    @Test
    @DisplayName("GET without the required status param returns 400 (mapping exists, param is required)")
    void missingStatusParamIsBadRequest() throws Exception {
        mockMvc.perform(get("/api/api-behaviour/capture-sessions"))
            .andExpect(status().isBadRequest());
    }
}
