package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryCandidateEntityMappingDto;
import com.example.architecturemodel.service.DiscoveryCandidateEntityMappingService;
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
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for DiscoveryCandidateEntityMappingController.
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Task Group 2: JPA Entity, DTO, Repository, Service, and Controller
 *
 * Tests:
 * 1. POST bulk insert returns 200 with persisted mappings
 * 2. GET returns mappings filtered by runId
 */
@WebMvcTest(DiscoveryCandidateEntityMappingController.class)
class DiscoveryCandidateEntityMappingControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private DiscoveryCandidateEntityMappingService mappingService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final UUID RUN_ID = UUID.randomUUID();
    private static final String BASE_URL =
        "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidate-entity-mappings";

    /**
     * Test 1: POST bulk insert returns 200 with persisted mappings.
     */
    @Test
    @DisplayName("Test 1: POST bulk insert returns 200 with persisted mappings")
    void bulkInsert_returns200WithPersistedMappings() throws Exception {
        // Given
        UUID mappingId1 = UUID.randomUUID();
        UUID mappingId2 = UUID.randomUUID();
        UUID candidateId1 = UUID.randomUUID();
        UUID candidateId2 = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryCandidateEntityMappingDto inputDto1 = new DiscoveryCandidateEntityMappingDto(
            null, candidateId1, RUN_ID, "applications", "app-abc123", "created", null
        );

        DiscoveryCandidateEntityMappingDto inputDto2 = new DiscoveryCandidateEntityMappingDto(
            null, candidateId2, RUN_ID, "services", "svc-def456", "reused", null
        );

        DiscoveryCandidateEntityMappingDto resultDto1 = new DiscoveryCandidateEntityMappingDto(
            mappingId1, candidateId1, RUN_ID, "applications", "app-abc123", "created", now.toString()
        );

        DiscoveryCandidateEntityMappingDto resultDto2 = new DiscoveryCandidateEntityMappingDto(
            mappingId2, candidateId2, RUN_ID, "services", "svc-def456", "reused", now.toString()
        );

        when(mappingService.bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList()))
            .thenReturn(List.of(resultDto1, resultDto2));

        // When/Then
        mockMvc.perform(post(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(List.of(inputDto1, inputDto2))))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value(mappingId1.toString()))
            .andExpect(jsonPath("$[0].candidate_id").value(candidateId1.toString()))
            .andExpect(jsonPath("$[0].run_id").value(RUN_ID.toString()))
            .andExpect(jsonPath("$[0].entity_type").value("applications"))
            .andExpect(jsonPath("$[0].entity_id").value("app-abc123"))
            .andExpect(jsonPath("$[0].action").value("created"))
            .andExpect(jsonPath("$[0].created_at").value(now.toString()))
            .andExpect(jsonPath("$[1].id").value(mappingId2.toString()))
            .andExpect(jsonPath("$[1].entity_type").value("services"))
            .andExpect(jsonPath("$[1].action").value("reused"));

        verify(mappingService).bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList());
    }

    /**
     * Test 2: GET returns mappings filtered by runId.
     */
    @Test
    @DisplayName("Test 2: GET returns mappings filtered by runId")
    void listMappings_returnsMappingsForRunId() throws Exception {
        // Given
        UUID mappingId = UUID.randomUUID();
        UUID candidateId = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryCandidateEntityMappingDto resultDto = new DiscoveryCandidateEntityMappingDto(
            mappingId, candidateId, RUN_ID, "applications", "app-abc123", "created", now.toString()
        );

        when(mappingService.getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(List.of(resultDto));

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].id").value(mappingId.toString()))
            .andExpect(jsonPath("$[0].candidate_id").value(candidateId.toString()))
            .andExpect(jsonPath("$[0].run_id").value(RUN_ID.toString()))
            .andExpect(jsonPath("$[0].entity_type").value("applications"))
            .andExpect(jsonPath("$[0].entity_id").value("app-abc123"))
            .andExpect(jsonPath("$[0].action").value("created"))
            .andExpect(jsonPath("$[0].created_at").value(now.toString()));

        verify(mappingService).getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID);
    }
}
