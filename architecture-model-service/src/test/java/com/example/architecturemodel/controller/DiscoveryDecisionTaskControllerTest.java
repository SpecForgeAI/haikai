package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryDecisionTaskDto;
import com.example.architecturemodel.service.DiscoveryDecisionTaskService;
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
 * Controller tests for DiscoveryDecisionTaskController.
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * Task Group 5: Liquibase Migration and JPA Entity Stack
 *
 * Tests:
 * 1. POST bulk insert accepts array of decision task DTOs and returns persisted results
 */
@WebMvcTest(DiscoveryDecisionTaskController.class)
class DiscoveryDecisionTaskControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private DiscoveryDecisionTaskService discoveryDecisionTaskService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final UUID RUN_ID = UUID.randomUUID();
    private static final String BASE_URL =
        "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/decision-tasks";

    /**
     * Test 4: POST bulk insert accepts array of decision task DTOs and returns persisted results.
     */
    @Test
    @DisplayName("Test 4: POST bulk insert accepts array of decision task DTOs and returns persisted results")
    void bulkInsert_acceptsArrayAndPersists() throws Exception {
        // Given
        UUID taskId1 = UUID.randomUUID();
        UUID taskId2 = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryDecisionTaskDto dto1 = new DiscoveryDecisionTaskDto(
            taskId1, RUN_ID, "confirm_relationship", "pending",
            Map.of("sourceAtom", Map.of("type", "symbol", "name", "OrderService"),
                   "targetAtom", Map.of("type", "string_pattern", "patternName", "import_statement")),
            null, now.toString(), null
        );

        DiscoveryDecisionTaskDto dto2 = new DiscoveryDecisionTaskDto(
            taskId2, RUN_ID, "resolve_competing_relationships", "pending",
            Map.of("sourceAtom", Map.of("type", "symbol", "name", "PaymentGateway"),
                   "competitors", List.of(Map.of("targetAtom", Map.of("type", "symbol")))),
            null, now.toString(), null
        );

        List<DiscoveryDecisionTaskDto> inputTasks = List.of(dto1, dto2);

        when(discoveryDecisionTaskService.bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList()))
            .thenReturn(inputTasks);

        // When/Then
        mockMvc.perform(post(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(inputTasks)))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value(taskId1.toString()))
            .andExpect(jsonPath("$[0].run_id").value(RUN_ID.toString()))
            .andExpect(jsonPath("$[0].task_type").value("confirm_relationship"))
            .andExpect(jsonPath("$[0].status").value("pending"))
            .andExpect(jsonPath("$[0].input_data.sourceAtom.type").value("symbol"))
            .andExpect(jsonPath("$[0].output_data").doesNotExist())
            .andExpect(jsonPath("$[0].created_at").value(now.toString()))
            .andExpect(jsonPath("$[0].resolved_at").doesNotExist())
            .andExpect(jsonPath("$[1].id").value(taskId2.toString()))
            .andExpect(jsonPath("$[1].task_type").value("resolve_competing_relationships"))
            .andExpect(jsonPath("$[1].input_data.sourceAtom.name").value("PaymentGateway"));

        verify(discoveryDecisionTaskService).bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList());
    }
}
