package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryCandidateEntityMappingDto;
import com.example.architecturemodel.model.dto.DiscoveryRunDto;
import com.example.architecturemodel.service.DiscoveryCandidateEntityMappingService;
import com.example.architecturemodel.service.DiscoveryRunService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for DiscoveryEntityOriginsController.
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Task Group 1: Project-scoped entity origin endpoint
 *
 * Tests:
 * 1. Entity origins returns all mappings across all runs for a project
 * 2. Entity origins returns empty list when no mappings exist
 * 3. Entity origins returns empty list when no runs exist for the project
 */
@WebMvcTest(DiscoveryEntityOriginsController.class)
class DiscoveryEntityOriginsControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private DiscoveryRunService discoveryRunService;

    @MockBean
    private DiscoveryCandidateEntityMappingService mappingService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final String BASE_URL = "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/entity-origins";

    /**
     * Test 1: Entity origins returns all mappings across all runs for a project.
     */
    @Test
    @DisplayName("Test 1: GET entity-origins returns all mappings across all runs for a project")
    void getEntityOrigins_returnsAllMappingsAcrossRuns() throws Exception {
        // Given: two runs for the project
        UUID runId1 = UUID.randomUUID();
        UUID runId2 = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryRunDto run1 = new DiscoveryRunDto(
            runId1, PROJECT_ID, UUID.randomUUID(), null, null, null, null, false,
 null, null, null, "COMPLETED", null,
            Map.of(), Map.of(), null, now.toString(), now.toString()
        );
        DiscoveryRunDto run2 = new DiscoveryRunDto(
            runId2, PROJECT_ID, UUID.randomUUID(), null, null, null, null, false,
 null, null, null, "COMPLETED", null,
            Map.of(), Map.of(), null, now.toString(), now.toString()
        );

        when(discoveryRunService.getRunsByProjectAndArchitecture(PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(List.of(run1, run2));

        // Mappings from both runs
        UUID mappingId1 = UUID.randomUUID();
        UUID mappingId2 = UUID.randomUUID();
        UUID mappingId3 = UUID.randomUUID();
        UUID candidateId1 = UUID.randomUUID();
        UUID candidateId2 = UUID.randomUUID();
        UUID candidateId3 = UUID.randomUUID();

        DiscoveryCandidateEntityMappingDto mapping1 = new DiscoveryCandidateEntityMappingDto(
            mappingId1, candidateId1, runId1, "applications", "app-abc123", "created", now.toString()
        );
        DiscoveryCandidateEntityMappingDto mapping2 = new DiscoveryCandidateEntityMappingDto(
            mappingId2, candidateId2, runId1, "services", "svc-def456", "created", now.toString()
        );
        DiscoveryCandidateEntityMappingDto mapping3 = new DiscoveryCandidateEntityMappingDto(
            mappingId3, candidateId3, runId2, "applications", "app-ghi789", "reused", now.toString()
        );

        when(mappingService.getByProjectRunIds(List.of(runId1, runId2)))
            .thenReturn(List.of(mapping1, mapping2, mapping3));

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType("application/json"))
            .andExpect(jsonPath("$.length()").value(3))
            .andExpect(jsonPath("$[0].id").value(mappingId1.toString()))
            .andExpect(jsonPath("$[0].entity_type").value("applications"))
            .andExpect(jsonPath("$[0].entity_id").value("app-abc123"))
            .andExpect(jsonPath("$[0].run_id").value(runId1.toString()))
            .andExpect(jsonPath("$[1].entity_type").value("services"))
            .andExpect(jsonPath("$[1].entity_id").value("svc-def456"))
            .andExpect(jsonPath("$[2].entity_type").value("applications"))
            .andExpect(jsonPath("$[2].entity_id").value("app-ghi789"))
            .andExpect(jsonPath("$[2].run_id").value(runId2.toString()));

        verify(discoveryRunService).getRunsByProjectAndArchitecture(PROJECT_ID, ARCHITECTURE_ID);
        verify(mappingService).getByProjectRunIds(List.of(runId1, runId2));
    }

    /**
     * Test 2: Entity origins returns empty list when no mappings exist.
     */
    @Test
    @DisplayName("Test 2: GET entity-origins returns empty list when no mappings exist")
    void getEntityOrigins_returnsEmptyList_whenNoMappingsExist() throws Exception {
        // Given: one run exists but has no mappings
        UUID runId = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryRunDto run = new DiscoveryRunDto(
            runId, PROJECT_ID, UUID.randomUUID(), null, null, null, null, false,
 null, null, null, "COMPLETED", null,
            Map.of(), Map.of(), null, now.toString(), now.toString()
        );

        when(discoveryRunService.getRunsByProjectAndArchitecture(PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(List.of(run));

        when(mappingService.getByProjectRunIds(List.of(runId)))
            .thenReturn(Collections.emptyList());

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType("application/json"))
            .andExpect(jsonPath("$.length()").value(0));

        verify(discoveryRunService).getRunsByProjectAndArchitecture(PROJECT_ID, ARCHITECTURE_ID);
        verify(mappingService).getByProjectRunIds(List.of(runId));
    }

    /**
     * Test 3: Entity origins returns empty list when no runs exist for the project.
     */
    @Test
    @DisplayName("Test 3: GET entity-origins returns empty list when no runs exist")
    void getEntityOrigins_returnsEmptyList_whenNoRunsExist() throws Exception {
        // Given: no runs for the project
        when(discoveryRunService.getRunsByProjectAndArchitecture(PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(Collections.emptyList());

        when(mappingService.getByProjectRunIds(Collections.emptyList()))
            .thenReturn(Collections.emptyList());

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType("application/json"))
            .andExpect(jsonPath("$.length()").value(0));

        verify(discoveryRunService).getRunsByProjectAndArchitecture(PROJECT_ID, ARCHITECTURE_ID);
        verify(mappingService).getByProjectRunIds(Collections.emptyList());
    }
}
