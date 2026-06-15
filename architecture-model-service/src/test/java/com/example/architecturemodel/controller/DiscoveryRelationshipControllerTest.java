package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryRelationshipDto;
import com.example.architecturemodel.service.DiscoveryRelationshipService;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for DiscoveryRelationshipController.
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * Task Group 2: Relationship JPA Stack (1b)
 *
 * Tests:
 * 1. POST bulk insert accepts array of relationship DTOs and returns persisted results
 * 2. GET by run ID returns all relationships for that run
 * 3. GET by run ID with ?type=imports filter returns only matching relationships
 * 4. GET /count returns the correct relationship count for a run
 */
@WebMvcTest(DiscoveryRelationshipController.class)
class DiscoveryRelationshipControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private DiscoveryRelationshipService discoveryRelationshipService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final UUID RUN_ID = UUID.randomUUID();
    private static final String BASE_URL =
        "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/relationships";

    /**
     * Test 1: POST bulk insert accepts array of relationship DTOs and returns persisted results.
     */
    @Test
    @DisplayName("Test 1: POST bulk insert accepts array of relationship DTOs and returns persisted results")
    void bulkInsert_acceptsArrayAndPersists() throws Exception {
        // Given
        UUID relId1 = UUID.randomUUID();
        UUID relId2 = UUID.randomUUID();
        UUID sourceAtomId1 = UUID.randomUUID();
        UUID targetAtomId1 = UUID.randomUUID();
        UUID sourceAtomId2 = UUID.randomUUID();
        UUID targetAtomId2 = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryRelationshipDto dto1 = new DiscoveryRelationshipDto(
            relId1, RUN_ID, sourceAtomId1, targetAtomId1,
            "imports", 0.95,
            Map.of("importPath", "com.example.Service", "line", 5),
            now.toString()
        );

        DiscoveryRelationshipDto dto2 = new DiscoveryRelationshipDto(
            relId2, RUN_ID, sourceAtomId2, targetAtomId2,
            "calls", 0.80,
            Map.of("methodName", "process", "line", 42),
            now.toString()
        );

        List<DiscoveryRelationshipDto> inputRelationships = List.of(dto1, dto2);

        when(discoveryRelationshipService.bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList()))
            .thenReturn(inputRelationships);

        // When/Then
        mockMvc.perform(post(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(inputRelationships)))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value(relId1.toString()))
            .andExpect(jsonPath("$[0].run_id").value(RUN_ID.toString()))
            .andExpect(jsonPath("$[0].source_atom_id").value(sourceAtomId1.toString()))
            .andExpect(jsonPath("$[0].target_atom_id").value(targetAtomId1.toString()))
            .andExpect(jsonPath("$[0].relationship_type").value("imports"))
            .andExpect(jsonPath("$[0].confidence").value(0.95))
            .andExpect(jsonPath("$[0].data.importPath").value("com.example.Service"))
            .andExpect(jsonPath("$[0].data.line").value(5))
            .andExpect(jsonPath("$[1].id").value(relId2.toString()))
            .andExpect(jsonPath("$[1].relationship_type").value("calls"))
            .andExpect(jsonPath("$[1].confidence").value(0.80))
            .andExpect(jsonPath("$[1].data.methodName").value("process"));

        verify(discoveryRelationshipService).bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList());
    }

    /**
     * Test 2: GET by run ID returns all relationships for that run.
     */
    @Test
    @DisplayName("Test 2: GET by run ID returns all relationships for that run")
    void listRelationships_returnsAllRelationshipsForRun() throws Exception {
        // Given
        Instant now = Instant.now();

        DiscoveryRelationshipDto importsRel = new DiscoveryRelationshipDto(
            UUID.randomUUID(), RUN_ID, UUID.randomUUID(), UUID.randomUUID(),
            "imports", 0.95,
            Map.of("importPath", "com.example.Util"),
            now.toString()
        );

        DiscoveryRelationshipDto callsRel = new DiscoveryRelationshipDto(
            UUID.randomUUID(), RUN_ID, UUID.randomUUID(), UUID.randomUUID(),
            "calls", 0.85,
            Map.of("methodName", "execute"),
            now.toString()
        );

        DiscoveryRelationshipDto extendsRel = new DiscoveryRelationshipDto(
            UUID.randomUUID(), RUN_ID, UUID.randomUUID(), UUID.randomUUID(),
            "extends", 0.99,
            Map.of("superClass", "BaseService"),
            now.toString()
        );

        when(discoveryRelationshipService.getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, null))
            .thenReturn(List.of(importsRel, callsRel, extendsRel));

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(3))
            .andExpect(jsonPath("$[0].relationship_type").value("imports"))
            .andExpect(jsonPath("$[1].relationship_type").value("calls"))
            .andExpect(jsonPath("$[2].relationship_type").value("extends"));

        verify(discoveryRelationshipService).getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, null);
    }

    /**
     * Test 3: GET by run ID with ?type=imports filter returns only matching relationships.
     */
    @Test
    @DisplayName("Test 3: GET by run ID with ?type=imports returns only matching relationships")
    void listRelationships_withTypeFilter_returnsOnlyMatchingRelationships() throws Exception {
        // Given
        Instant now = Instant.now();

        DiscoveryRelationshipDto importsRel1 = new DiscoveryRelationshipDto(
            UUID.randomUUID(), RUN_ID, UUID.randomUUID(), UUID.randomUUID(),
            "imports", 0.90,
            Map.of("importPath", "com.example.ServiceA"),
            now.toString()
        );

        DiscoveryRelationshipDto importsRel2 = new DiscoveryRelationshipDto(
            UUID.randomUUID(), RUN_ID, UUID.randomUUID(), UUID.randomUUID(),
            "imports", 0.85,
            Map.of("importPath", "com.example.ServiceB"),
            now.toString()
        );

        when(discoveryRelationshipService.getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, "imports"))
            .thenReturn(List.of(importsRel1, importsRel2));

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .param("type", "imports"))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].relationship_type").value("imports"))
            .andExpect(jsonPath("$[0].data.importPath").value("com.example.ServiceA"))
            .andExpect(jsonPath("$[1].relationship_type").value("imports"))
            .andExpect(jsonPath("$[1].data.importPath").value("com.example.ServiceB"));

        verify(discoveryRelationshipService).getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, "imports");
    }

    /**
     * Test 4: GET /count returns the correct relationship count for a run.
     */
    @Test
    @DisplayName("Test 4: GET /count returns the correct relationship count for a run")
    void countRelationships_returnsCorrectCount() throws Exception {
        // Given
        when(discoveryRelationshipService.countByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(17L);

        // When/Then
        mockMvc.perform(get(BASE_URL + "/count", PROJECT_ID, ARCHITECTURE_ID, RUN_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.count").value(17));

        verify(discoveryRelationshipService).countByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID);
    }
}
