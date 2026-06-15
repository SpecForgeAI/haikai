package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourDiffDto;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourDiffService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for {@link ApiBehaviourDiffController}, focusing on the
 * UI-primary {@code GET /by-target/{targetBaselineId}} endpoint.
 *
 * <p>Covers Task Group 2.1 of the API Test Harness — Diff Engine spec
 * (2026-05-25):</p>
 * <ol>
 *   <li>Happy-path: returns the diff DTO for the given target baseline.</li>
 *   <li>404: returns when the target baseline does not resolve to a diff
 *       (the UI shows "Computing..." in that case).</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class ApiBehaviourDiffControllerTest {

    @Mock
    private ApiBehaviourDiffService diffService;

    private MockMvc mockMvc;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCHITECTURE_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID DIFF_ID =
        UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID SOURCE_BASELINE_ID =
        UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID TARGET_BASELINE_ID =
        UUID.fromString("55555555-5555-5555-5555-555555555555");

    private static final Instant NOW = Instant.parse("2026-05-25T10:00:00Z");

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new ApiBehaviourDiffController(diffService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    @Test
    @DisplayName("GET .../diffs/by-target/{targetBaselineId} returns the diff DTO for the given target")
    void getByTargetReturnsDto() throws Exception {
        ApiBehaviourDiffDto diff = new ApiBehaviourDiffDto(
            DIFF_ID, PROJECT_ID, ARCHITECTURE_ID,
            SOURCE_BASELINE_ID, TARGET_BASELINE_ID,
            "completed",
            3, 1, 1, 0, 2, 0,
            NOW.minusSeconds(60), NOW.minusSeconds(30), NOW,
            null,
            NOW.minusSeconds(120), NOW
        );
        when(diffService.getByTargetBaselineId(PROJECT_ID, TARGET_BASELINE_ID))
            .thenReturn(diff);

        mockMvc.perform(get(
                "/api/projects/{projectId}/api-behaviour/diffs/by-target/{targetBaselineId}",
                PROJECT_ID, TARGET_BASELINE_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(DIFF_ID.toString()))
            .andExpect(jsonPath("$.sourceBaselineId").value(SOURCE_BASELINE_ID.toString()))
            .andExpect(jsonPath("$.targetBaselineId").value(TARGET_BASELINE_ID.toString()))
            .andExpect(jsonPath("$.status").value("completed"))
            .andExpect(jsonPath("$.matchedCount").value(3))
            .andExpect(jsonPath("$.statusDriftCount").value(1))
            .andExpect(jsonPath("$.bodyShapeDriftCount").value(1))
            .andExpect(jsonPath("$.bodyValueDriftCount").value(0))
            .andExpect(jsonPath("$.sourceOnlyCount").value(2));

        verify(diffService).getByTargetBaselineId(PROJECT_ID, TARGET_BASELINE_ID);
    }

    @Test
    @DisplayName("GET .../diffs/by-target/{targetBaselineId} returns 404 when no diff exists for the target")
    void getByTargetReturns404WhenMissing() throws Exception {
        when(diffService.getByTargetBaselineId(eq(PROJECT_ID), eq(TARGET_BASELINE_ID)))
            .thenThrow(new ResourceNotFoundException(
                "API behaviour diff not found for target baseline " + TARGET_BASELINE_ID));

        mockMvc.perform(get(
                "/api/projects/{projectId}/api-behaviour/diffs/by-target/{targetBaselineId}",
                PROJECT_ID, TARGET_BASELINE_ID))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value(
                "API behaviour diff not found for target baseline " + TARGET_BASELINE_ID));
    }
}
