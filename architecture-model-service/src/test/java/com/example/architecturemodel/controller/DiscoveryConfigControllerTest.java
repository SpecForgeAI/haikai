package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryConfigDto;
import com.example.architecturemodel.service.DiscoveryConfigService;
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
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for DiscoveryConfigController.
 *
 * Spec: Phase 0 Persistence Contract (Increment 2)
 * Task Group 3: Service and Controller
 */
@WebMvcTest(DiscoveryConfigController.class)
class DiscoveryConfigControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private DiscoveryConfigService discoveryConfigService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();

    /**
     * Test 5: PUT endpoint returns 200 with DTO on success.
     */
    @Test
    void putConfig_returns200WithDto_onSuccess() throws Exception {
        // Given
        UUID entityId = UUID.randomUUID();
        Instant now = Instant.now();
        Map<String, Object> configPayload = Map.of(
            "repos", List.of(Map.of("url", "https://github.com/example/repo")),
            "techHints", List.of("Java")
        );

        DiscoveryConfigDto savedDto = new DiscoveryConfigDto(
            entityId,
            PROJECT_ID,
            configPayload,
            "DRAFT",
            now.toString(),
            now.toString()
        );

        when(discoveryConfigService.upsertConfig(eq(PROJECT_ID), any(), eq("DRAFT")))
            .thenReturn(savedDto);

        String requestBody = """
            {
                "config_payload": {
                    "repos": [{"url": "https://github.com/example/repo"}],
                    "techHints": ["Java"]
                },
                "status": "DRAFT"
            }
            """;

        // When/Then
        mockMvc.perform(put("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/config", PROJECT_ID, ARCHITECTURE_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.id").value(entityId.toString()))
            .andExpect(jsonPath("$.project_id").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.status").value("DRAFT"))
            .andExpect(jsonPath("$.config_payload.repos[0].url").value("https://github.com/example/repo"))
            .andExpect(jsonPath("$.created_at").value(now.toString()))
            .andExpect(jsonPath("$.updated_at").value(now.toString()));
    }

    /**
     * Test 6: GET endpoint returns 404 when config not found.
     */
    @Test
    void getConfig_returns404_whenNotFound() throws Exception {
        // Given
        when(discoveryConfigService.getConfig(PROJECT_ID))
            .thenReturn(null);

        // When/Then
        mockMvc.perform(get("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/config", PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isNotFound());
    }

    /**
     * Test 7: GET endpoint returns 200 with DTO when config exists.
     */
    @Test
    void getConfig_returns200WithDto_whenExists() throws Exception {
        // Given
        UUID entityId = UUID.randomUUID();
        Instant now = Instant.now();
        Map<String, Object> configPayload = Map.of(
            "repos", List.of(Map.of("url", "https://github.com/example/repo")),
            "notes", List.of("Initial discovery config")
        );

        DiscoveryConfigDto dto = new DiscoveryConfigDto(
            entityId,
            PROJECT_ID,
            configPayload,
            "COMPLETE",
            now.toString(),
            now.toString()
        );

        when(discoveryConfigService.getConfig(PROJECT_ID))
            .thenReturn(dto);

        // When/Then
        mockMvc.perform(get("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/config", PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.id").value(entityId.toString()))
            .andExpect(jsonPath("$.project_id").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.status").value("COMPLETE"))
            .andExpect(jsonPath("$.config_payload.repos[0].url").value("https://github.com/example/repo"))
            .andExpect(jsonPath("$.config_payload.notes[0]").value("Initial discovery config"));
    }

    /**
     * Gap Test 5 (Task Group 7): PUT without explicit status defaults to DRAFT.
     *
     * When the request body omits the "status" field, the controller
     * should default to "DRAFT" and successfully return a 200 response
     * with the saved DTO showing status=DRAFT.
     */
    @Test
    void putConfig_returns200_withDefaultDraftStatus() throws Exception {
        // Given
        UUID entityId = UUID.randomUUID();
        Instant now = Instant.now();
        Map<String, Object> configPayload = Map.of(
            "repos", List.of(Map.of("url", "https://github.com/example/repo"))
        );

        DiscoveryConfigDto savedDto = new DiscoveryConfigDto(
            entityId,
            PROJECT_ID,
            configPayload,
            "DRAFT",
            now.toString(),
            now.toString()
        );

        // The controller should default null status to "DRAFT" before calling the service
        when(discoveryConfigService.upsertConfig(eq(PROJECT_ID), any(), eq("DRAFT")))
            .thenReturn(savedDto);

        // Request body WITHOUT the "status" field
        String requestBody = """
            {
                "config_payload": {
                    "repos": [{"url": "https://github.com/example/repo"}]
                }
            }
            """;

        // When/Then
        mockMvc.perform(put("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/config", PROJECT_ID, ARCHITECTURE_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.id").value(entityId.toString()))
            .andExpect(jsonPath("$.project_id").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.status").value("DRAFT"));
    }
}
