package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryRunDto;
import com.example.architecturemodel.service.DiscoveryRunService;
import com.fasterxml.jackson.databind.ObjectMapper;
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

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for DiscoveryRunController.
 *
 * Spec: Discovery Run Model and Orchestration (Increment 5)
 * Task Group 2: Entity, DTO, Repository, Service, Controller
 */
@WebMvcTest(DiscoveryRunController.class)
class DiscoveryRunControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private DiscoveryRunService discoveryRunService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();

    /**
     * Test 5: POST createRun returns 200 with DTO for valid creation.
     */
    @Test
    void createRun_returns200WithDto_onSuccess() throws Exception {
        // Given
        UUID runId = UUID.randomUUID();
        Instant now = Instant.now();
        Map<String, Object> configSnapshot = Map.of(
            "repos", List.of(Map.of("url", "https://github.com/example/repo"))
        );
        Map<String, Object> stepsPayload = Map.of(
            "1a", Map.of("status", "pending"),
            "1b", Map.of("status", "pending"),
            "1c", Map.of("status", "pending"),
            "1d", Map.of("status", "pending")
        );

        DiscoveryRunDto dto = new DiscoveryRunDto(
            runId,
            PROJECT_ID,
            UUID.randomUUID(),
            null,
            null,
            null,
            null,
            false,
            null,
            null,
            null,
            "PENDING",
            null,
            configSnapshot,
            stepsPayload,
            null,
            now.toString(),
            now.toString()
        );

        // Controller now calls the 8-arg createRun(projectId, architectureId, serviceId,
        // mode, warnings, confirmLlmSolo, serviceIdentitySnapshot, discoveryKind).
        // Spec: Database Discovery Packs (2026-05-16) added the eighth
        // discoveryKind positional argument.
        when(discoveryRunService.createRun(
                any(UUID.class),
                any(UUID.class),
                nullable(String.class),
                nullable(String.class),
                nullable(String.class),
                anyBoolean(),
                nullable(Map.class),
                nullable(String.class)))
            .thenReturn(dto);

        // When/Then
        mockMvc.perform(post(
                "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs",
                PROJECT_ID, ARCHITECTURE_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.id").value(runId.toString()))
            .andExpect(jsonPath("$.project_id").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.status").value("PENDING"))
            .andExpect(jsonPath("$.current_step").doesNotExist())
            .andExpect(jsonPath("$.steps_payload.1a.status").value("pending"))
            .andExpect(jsonPath("$.steps_payload.1b.status").value("pending"))
            .andExpect(jsonPath("$.steps_payload.1c.status").value("pending"))
            .andExpect(jsonPath("$.steps_payload.1d.status").value("pending"))
            .andExpect(jsonPath("$.created_at").value(now.toString()))
            .andExpect(jsonPath("$.updated_at").value(now.toString()));
    }

    /**
     * Test 6: GET listRuns returns 200 with array of DTOs for a given project.
     */
    @Test
    void listRuns_returns200WithArray() throws Exception {
        // Given
        UUID runId1 = UUID.randomUUID();
        UUID runId2 = UUID.randomUUID();
        Instant now = Instant.now();
        Instant earlier = now.minusSeconds(3600);

        Map<String, Object> stepsPayload = Map.of(
            "1a", Map.of("status", "pending"),
            "1b", Map.of("status", "pending"),
            "1c", Map.of("status", "pending"),
            "1d", Map.of("status", "pending")
        );

        DiscoveryRunDto dto1 = new DiscoveryRunDto(
            runId1, PROJECT_ID, UUID.randomUUID(), null, null, null, null, false,
 null, null, null, "COMPLETED", null,
            Map.of("repos", List.of()), stepsPayload, null,
            now.toString(), now.toString()
        );
        DiscoveryRunDto dto2 = new DiscoveryRunDto(
            runId2, PROJECT_ID, UUID.randomUUID(), null, null, null, null, false,
 null, null, null, "FAILED", "1b",
            Map.of("repos", List.of()), stepsPayload, "Step 1b failed",
            earlier.toString(), earlier.toString()
        );

        when(discoveryRunService.getRunsByProjectAndArchitectureAndKind(
                PROJECT_ID, ARCHITECTURE_ID, null))
            .thenReturn(List.of(dto1, dto2));

        // When/Then
        mockMvc.perform(get(
                "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs",
                PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value(runId1.toString()))
            .andExpect(jsonPath("$[0].status").value("COMPLETED"))
            .andExpect(jsonPath("$[1].id").value(runId2.toString()))
            .andExpect(jsonPath("$[1].status").value("FAILED"))
            .andExpect(jsonPath("$[1].error_message").value("Step 1b failed"));
    }

    // =========================================================================
    // Gap Tests (Task Group 8: Test Review and Integration Verification)
    // =========================================================================

    /**
     * Gap Test 2: getRunById returns 404 for non-existent run.
     *
     * Verifies that GET /api/model/projects/{projectId}/discovery/runs/{runId}
     * returns 404 when the service returns null for the given runId.
     */
    @Test
    void getRun_returns404_whenRunNotFound() throws Exception {
        // Given
        UUID runId = UUID.randomUUID();
        when(discoveryRunService.getRunInArchitecture(runId, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(null);

        // When/Then
        mockMvc.perform(get(
                "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}",
                PROJECT_ID, ARCHITECTURE_ID, runId))
            .andExpect(status().isNotFound());
    }

    // =========================================================================
    // V3 Tier UX regression (Spec 2026-04-20 — Task Group 5)
    // =========================================================================

    /**
     * Regression: {@code GET /discovery/runs/{runId}} must surface the four
     * V3 Tier UX fields on the DTO response:
     *   - {@code mode} (persisted A/B/C tier)
     *   - {@code tier} (derived from {@code mode} — same single-char value)
     *   - {@code warnings} (JSON-encoded string[] passed through verbatim)
     *   - {@code confirmed_llm_solo} (explicit Tier C opt-in flag)
     *
     * Group 1 wired these onto the DTO + toDto() mapping; this test pins the
     * contract so any future DTO shape change that drops a field fails loudly.
     */
    @Test
    void getRun_returnsTierUxFields_onSuccess() throws Exception {
        // Given: a Tier C run that explicitly opted in via confirmLlmSolo.
        UUID runId = UUID.randomUUID();
        Instant now = Instant.now();
        String warningsJson = "[\"Discovery will run in LLM-only mode. "
            + "No language or framework pack matches. "
            + "Pass confirmLlmSolo: true to proceed.\"]";

        DiscoveryRunDto dto = new DiscoveryRunDto(
            runId,
            PROJECT_ID,
            ARCHITECTURE_ID,     // architectureId (Spec: Discovery Run Robustness Section 3)
            null,
            "C",                 // mode
            "C",                 // tier (derived — same value)
            warningsJson,
            true,
                null,                // discoveryKind
            null,                // degraded (Oracle Integrity & Determinism)
            null,                // degraded_reasons
            "PENDING",
            null,
            Map.of(),
            Map.of(),
            null,
            now.toString(),
            now.toString()
        );

        when(discoveryRunService.getRunInArchitecture(runId, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(dto);

        // When/Then: all four V3 Tier UX fields must surface on the response.
        mockMvc.perform(get(
                "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}",
                PROJECT_ID, ARCHITECTURE_ID, runId))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.id").value(runId.toString()))
            .andExpect(jsonPath("$.mode").value("C"))
            .andExpect(jsonPath("$.tier").value("C"))
            .andExpect(jsonPath("$.warnings").value(warningsJson))
            .andExpect(jsonPath("$.confirmed_llm_solo").value(true))
            // Spec: Discovery Run Robustness Section 3 — architecture_id surfaces on the DTO
            .andExpect(jsonPath("$.architecture_id").value(ARCHITECTURE_ID.toString()));
    }

    /**
     * Regression: {@code GET /discovery/runs} (list) must surface {@code mode}
     * and {@code tier} on every entry. Warnings are deliberately excluded from
     * list output for brevity but are available on the detail endpoint.
     */
    @Test
    void listRuns_returnsModeAndTierPerEntry() throws Exception {
        // Given: two runs of different tiers (A + B) so both mode values surface.
        UUID runIdA = UUID.randomUUID();
        UUID runIdB = UUID.randomUUID();
        Instant now = Instant.now();
        String tierBWarningsJson = "[\"Tier B warning line\"]";

        DiscoveryRunDto tierARun = new DiscoveryRunDto(
            runIdA, PROJECT_ID, UUID.randomUUID(), null,
            "A",                 // mode
            "A",                 // tier (derived)
            null,                // no warnings for tier A
            false,
            null,
            null, null,
            "COMPLETED", null,
            Map.of(), Map.of(), null,
            now.toString(), now.toString()
        );
        DiscoveryRunDto tierBRun = new DiscoveryRunDto(
            runIdB, PROJECT_ID, UUID.randomUUID(), null,
            "B",                 // mode
            "B",                 // tier (derived)
            tierBWarningsJson,
            false,
            null,
            null, null,
            "RUNNING", "1b",
            Map.of(), Map.of(), null,
            now.toString(), now.toString()
        );

        when(discoveryRunService.getRunsByProjectAndArchitectureAndKind(
                PROJECT_ID, ARCHITECTURE_ID, null))
            .thenReturn(List.of(tierARun, tierBRun));

        // When/Then: each entry carries mode + tier.
        mockMvc.perform(get(
                "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs",
                PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].mode").value("A"))
            .andExpect(jsonPath("$[0].tier").value("A"))
            .andExpect(jsonPath("$[1].mode").value("B"))
            .andExpect(jsonPath("$[1].tier").value("B"));
    }
}
