package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineDto;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourBaselineService;
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
 * MockMvc tests for the new pairing-read endpoint
 * {@code GET /api/projects/{projectId}/api-behaviour/baselines/{sourceId}/target-baselines}.
 *
 * <p>Covers Task Group 2.1 of the API Test Harness — Target-Side Capture spec
 * (2026-05-25):</p>
 * <ol>
 *   <li>Empty list when no targets are paired with the source.</li>
 *   <li>Returns the paired target baselines when there are matches.</li>
 *   <li>Returns 404 when {@code sourceId} does not resolve under {@code projectId}.</li>
 *   <li>Returns 404 when the resolved baseline is {@code kind="target"}
 *       (sources must be current-state).</li>
 * </ol>
 *
 * <p>Standalone setup mirrors {@link ApiBehaviourControllerTest} — service is
 * a Mockito mock; the global exception handler is wired by hand so 404s flow
 * through the same mapping as in production.</p>
 */
@ExtendWith(MockitoExtension.class)
class ApiBehaviourBaselinePairingControllerTest {

    @Mock
    private ApiBehaviourBaselineService baselineService;

    private MockMvc mockMvc;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCHITECTURE_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID SESSION_ID =
        UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID SOURCE_ID =
        UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID TARGET_A_ID =
        UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final UUID TARGET_B_ID =
        UUID.fromString("66666666-6666-6666-6666-666666666666");

    private static final Instant NOW = Instant.parse("2026-05-25T10:00:00Z");

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new ApiBehaviourBaselineController(baselineService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    @Test
    @DisplayName("GET .../{sourceId}/target-baselines returns an empty list when no targets are paired with the source")
    void emptyListWhenNoPairedTargets() throws Exception {
        when(baselineService.listTargetBaselinesPairedWith(PROJECT_ID, SOURCE_ID))
            .thenReturn(List.of());

        mockMvc.perform(get(
                "/api/projects/{projectId}/api-behaviour/baselines/{sourceId}/target-baselines",
                PROJECT_ID, SOURCE_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(0));

        verify(baselineService).listTargetBaselinesPairedWith(PROJECT_ID, SOURCE_ID);
    }

    @Test
    @DisplayName("GET .../{sourceId}/target-baselines returns the paired target baselines (newest-first)")
    void returnsPairedTargets() throws Exception {
        ApiBehaviourBaselineDto targetA = new ApiBehaviourBaselineDto(
            TARGET_A_ID, PROJECT_ID, ARCHITECTURE_ID, SESSION_ID,
            "target replay v2", "active", 4, 3, null,
            "target", SOURCE_ID,
            NOW, NOW
        );
        ApiBehaviourBaselineDto targetB = new ApiBehaviourBaselineDto(
            TARGET_B_ID, PROJECT_ID, ARCHITECTURE_ID, SESSION_ID,
            "target replay v1", "active", 4, 3, null,
            "target", SOURCE_ID,
            NOW.minusSeconds(3600), NOW.minusSeconds(3600)
        );
        when(baselineService.listTargetBaselinesPairedWith(PROJECT_ID, SOURCE_ID))
            .thenReturn(List.of(targetA, targetB));

        mockMvc.perform(get(
                "/api/projects/{projectId}/api-behaviour/baselines/{sourceId}/target-baselines",
                PROJECT_ID, SOURCE_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value(TARGET_A_ID.toString()))
            .andExpect(jsonPath("$[0].kind").value("target"))
            .andExpect(jsonPath("$[0].pairedWithBaselineId").value(SOURCE_ID.toString()))
            .andExpect(jsonPath("$[1].id").value(TARGET_B_ID.toString()))
            .andExpect(jsonPath("$[1].kind").value("target"));

        verify(baselineService).listTargetBaselinesPairedWith(PROJECT_ID, SOURCE_ID);
    }

    @Test
    @DisplayName("GET .../{sourceId}/target-baselines returns 404 when the source baseline does not exist in the project")
    void returns404WhenSourceNotFound() throws Exception {
        when(baselineService.listTargetBaselinesPairedWith(eq(PROJECT_ID), eq(SOURCE_ID)))
            .thenThrow(new ResourceNotFoundException(
                "API behaviour baseline " + SOURCE_ID + " not found in project " + PROJECT_ID));

        mockMvc.perform(get(
                "/api/projects/{projectId}/api-behaviour/baselines/{sourceId}/target-baselines",
                PROJECT_ID, SOURCE_ID))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value(
                "API behaviour baseline " + SOURCE_ID + " not found in project " + PROJECT_ID));
    }

    @Test
    @DisplayName("GET .../{sourceId}/target-baselines returns 404 when the resolved baseline has kind='target' (sources must be current-state)")
    void returns404WhenSourceIsKindTarget() throws Exception {
        when(baselineService.listTargetBaselinesPairedWith(eq(PROJECT_ID), eq(SOURCE_ID)))
            .thenThrow(new ResourceNotFoundException(
                "API behaviour baseline " + SOURCE_ID
                    + " is not a current-state baseline (kind='target')"));

        mockMvc.perform(get(
                "/api/projects/{projectId}/api-behaviour/baselines/{sourceId}/target-baselines",
                PROJECT_ID, SOURCE_ID))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value(
                "API behaviour baseline " + SOURCE_ID
                    + " is not a current-state baseline (kind='target')"));
    }
}
