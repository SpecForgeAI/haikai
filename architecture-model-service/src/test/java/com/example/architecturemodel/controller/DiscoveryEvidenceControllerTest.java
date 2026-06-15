package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryEvidenceDto;
import com.example.architecturemodel.service.DiscoveryEvidenceService;
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
 * Controller tests for DiscoveryEvidenceController.
 *
 * Spec: Phase 1a Universal Evidence Extraction (Increment 6)
 * Task Group 2: Evidence Entity, DTO, Repository, Service, and Controller
 *
 * Tests:
 * 1. POST bulk insert endpoint accepts an array of evidence atom DTOs and persists them
 * 2. GET by run ID returns all evidence atoms for that run
 * 3. GET by run ID with ?type=symbol filter returns only symbol-type atoms
 * 4. GET count endpoint returns the correct atom count for a run
 * 5. POST with empty array returns 200 with empty result (no error)
 * 6. GET for a non-existent run ID returns empty list (not 404)
 */
@WebMvcTest(DiscoveryEvidenceController.class)
class DiscoveryEvidenceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private DiscoveryEvidenceService discoveryEvidenceService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final UUID RUN_ID = UUID.randomUUID();
    private static final String BASE_URL =
        "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/evidence";

    /**
     * Test 1: POST bulk insert endpoint accepts an array of evidence atom DTOs
     * and persists them.
     */
    @Test
    @DisplayName("Test 1: POST bulk insert accepts array of evidence atom DTOs and persists them")
    void bulkInsert_acceptsArrayAndPersists() throws Exception {
        // Given
        UUID atomId1 = UUID.randomUUID();
        UUID atomId2 = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryEvidenceDto dto1 = new DiscoveryEvidenceDto(
            atomId1, RUN_ID, "https://github.com/example/repo",
            "src/main/java/App.java", "file_structure",
            Map.of("relativePath", "src/main/java/App.java", "extension", ".java",
                   "sizeBytes", 2048, "lineCount", 75),
            now.toString(),
            null, null
        );

        DiscoveryEvidenceDto dto2 = new DiscoveryEvidenceDto(
            atomId2, RUN_ID, "https://github.com/example/repo",
            "src/main/java/App.java", "symbol",
            Map.of("name", "main", "kind", "function", "line", 10,
                   "scope", "App", "language", "Java"),
            now.toString(),
            null, null
        );

        List<DiscoveryEvidenceDto> inputAtoms = List.of(dto1, dto2);

        when(discoveryEvidenceService.bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList()))
            .thenReturn(inputAtoms);

        // When/Then
        mockMvc.perform(post(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(inputAtoms)))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value(atomId1.toString()))
            .andExpect(jsonPath("$[0].run_id").value(RUN_ID.toString()))
            .andExpect(jsonPath("$[0].repo_url").value("https://github.com/example/repo"))
            .andExpect(jsonPath("$[0].file_path").value("src/main/java/App.java"))
            .andExpect(jsonPath("$[0].type").value("file_structure"))
            .andExpect(jsonPath("$[0].data.relativePath").value("src/main/java/App.java"))
            .andExpect(jsonPath("$[0].data.extension").value(".java"))
            .andExpect(jsonPath("$[0].data.sizeBytes").value(2048))
            .andExpect(jsonPath("$[0].data.lineCount").value(75))
            .andExpect(jsonPath("$[1].id").value(atomId2.toString()))
            .andExpect(jsonPath("$[1].type").value("symbol"))
            .andExpect(jsonPath("$[1].data.name").value("main"))
            .andExpect(jsonPath("$[1].data.kind").value("function"));

        verify(discoveryEvidenceService).bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList());
    }

    /**
     * Test 2: GET by run ID returns all evidence atoms for that run.
     */
    @Test
    @DisplayName("Test 2: GET by run ID returns all evidence atoms for that run")
    void listEvidence_returnsAllAtomsForRun() throws Exception {
        // Given
        Instant now = Instant.now();

        DiscoveryEvidenceDto fileAtom = new DiscoveryEvidenceDto(
            UUID.randomUUID(), RUN_ID, "https://github.com/example/repo",
            "src/index.ts", "file_structure",
            Map.of("relativePath", "src/index.ts", "extension", ".ts",
                   "sizeBytes", 4096, "lineCount", 120),
            now.toString(),
            null, null
        );

        DiscoveryEvidenceDto symbolAtom = new DiscoveryEvidenceDto(
            UUID.randomUUID(), RUN_ID, "https://github.com/example/repo",
            "src/index.ts", "symbol",
            Map.of("name", "handleRequest", "kind", "function", "line", 42,
                   "scope", "Server", "language", "TypeScript"),
            now.toString(),
            null, null
        );

        DiscoveryEvidenceDto patternAtom = new DiscoveryEvidenceDto(
            UUID.randomUUID(), RUN_ID, "https://github.com/example/repo",
            "src/index.ts", "string_pattern",
            Map.of("patternName", "import_statement", "matchedText", "import express from 'express'",
                   "line", 1, "contextSnippet", "import express from 'express';"),
            now.toString(),
            null, null
        );

        when(discoveryEvidenceService.getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, null))
            .thenReturn(List.of(fileAtom, symbolAtom, patternAtom));

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(3))
            .andExpect(jsonPath("$[0].type").value("file_structure"))
            .andExpect(jsonPath("$[1].type").value("symbol"))
            .andExpect(jsonPath("$[2].type").value("string_pattern"));

        verify(discoveryEvidenceService).getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, null);
    }

    /**
     * Test 3: GET by run ID with ?type=symbol filter returns only symbol-type atoms.
     */
    @Test
    @DisplayName("Test 3: GET by run ID with ?type=symbol returns only symbol-type atoms")
    void listEvidence_withTypeFilter_returnsOnlyMatchingAtoms() throws Exception {
        // Given
        Instant now = Instant.now();

        DiscoveryEvidenceDto symbolAtom1 = new DiscoveryEvidenceDto(
            UUID.randomUUID(), RUN_ID, "https://github.com/example/repo",
            "src/App.java", "symbol",
            Map.of("name", "main", "kind", "function", "line", 10,
                   "scope", "App", "language", "Java"),
            now.toString(),
            null, null
        );

        DiscoveryEvidenceDto symbolAtom2 = new DiscoveryEvidenceDto(
            UUID.randomUUID(), RUN_ID, "https://github.com/example/repo",
            "src/Service.java", "symbol",
            Map.of("name", "process", "kind", "method", "line", 25,
                   "scope", "Service", "language", "Java"),
            now.toString(),
            null, null
        );

        when(discoveryEvidenceService.getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, "symbol"))
            .thenReturn(List.of(symbolAtom1, symbolAtom2));

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .param("type", "symbol"))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].type").value("symbol"))
            .andExpect(jsonPath("$[0].data.name").value("main"))
            .andExpect(jsonPath("$[1].type").value("symbol"))
            .andExpect(jsonPath("$[1].data.name").value("process"));

        verify(discoveryEvidenceService).getByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, "symbol");
    }

    /**
     * Test 4: GET count endpoint returns the correct atom count for a run.
     */
    @Test
    @DisplayName("Test 4: GET count endpoint returns the correct atom count for a run")
    void countEvidence_returnsCorrectCount() throws Exception {
        // Given
        when(discoveryEvidenceService.countByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(42L);

        // When/Then
        mockMvc.perform(get(BASE_URL + "/count", PROJECT_ID, ARCHITECTURE_ID, RUN_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.count").value(42));

        verify(discoveryEvidenceService).countByRunIdInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID);
    }

    /**
     * Test 5: POST with empty array returns 200 with empty result (no error).
     */
    @Test
    @DisplayName("Test 5: POST with empty array returns 200 with empty result")
    void bulkInsert_withEmptyArray_returns200WithEmptyResult() throws Exception {
        // Given
        when(discoveryEvidenceService.bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), anyList()))
            .thenReturn(List.of());

        // When/Then
        mockMvc.perform(post(BASE_URL, PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content("[]"))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(0));

        verify(discoveryEvidenceService).bulkCreateInArchitecture(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(List.of()));
    }

    /**
     * Test 6: GET for a non-existent run ID returns empty list (not 404).
     */
    @Test
    @DisplayName("Test 6: GET for non-existent run ID returns empty list, not 404")
    void listEvidence_forNonExistentRunId_returnsEmptyList() throws Exception {
        // Given
        UUID nonExistentRunId = UUID.randomUUID();

        when(discoveryEvidenceService.getByRunIdInArchitecture(nonExistentRunId, PROJECT_ID, ARCHITECTURE_ID, null))
            .thenReturn(List.of());

        // When/Then
        mockMvc.perform(get("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/evidence",
                PROJECT_ID, ARCHITECTURE_ID, nonExistentRunId))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(0));

        verify(discoveryEvidenceService).getByRunIdInArchitecture(nonExistentRunId, PROJECT_ID, ARCHITECTURE_ID, null);
    }
}
