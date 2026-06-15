package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.TemporaryDiagramDto;
import com.example.architecturemodel.service.TemporaryDiagramService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for TemporaryDiagramController.
 *
 * Spec 2026-03-26: MCP Endpoint for Saving Temporary Architecture Diagrams (Increment 3)
 * Task Group 2: Java Service, DTO, and Controller
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing -- Task 6.3
 *   URL shape and service signatures updated to be architecture-scoped.
 *   New URL: /api/projects/{projectId}/architectures/{architectureId}/temporary-diagrams/{temporaryDiagramId}
 */
@WebMvcTest(TemporaryDiagramController.class)
class TemporaryDiagramControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private TemporaryDiagramService temporaryDiagramService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final String TEMPORARY_DIAGRAM_ID = "tmp-er-diagram-001";

    /**
     * Test 5: PUT endpoint returns 200 with DTO on success.
     */
    @Test
    void putDiagram_returns200WithDto_onSuccess() throws Exception {
        // Given
        UUID entityId = UUID.randomUUID();
        Instant now = Instant.now();
        Map<String, Object> diagramPayload = Map.of(
            "id", TEMPORARY_DIAGRAM_ID,
            "name", "Test ER Diagram",
            "diagram_kind", "ER"
        );

        TemporaryDiagramDto savedDto = new TemporaryDiagramDto(
            entityId,
            PROJECT_ID,
            TEMPORARY_DIAGRAM_ID,
            diagramPayload,
            now.toString(),
            now.toString()
        );

        when(temporaryDiagramService.saveDiagram(
                eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(TEMPORARY_DIAGRAM_ID), any()))
            .thenReturn(savedDto);

        String requestBody = """
            {
                "diagram_payload": {
                    "id": "tmp-er-diagram-001",
                    "name": "Test ER Diagram",
                    "diagram_kind": "ER"
                }
            }
            """;

        // When/Then
        mockMvc.perform(put(
                "/api/projects/{projectId}/architectures/{architectureId}/temporary-diagrams/{temporaryDiagramId}",
                PROJECT_ID, ARCHITECTURE_ID, TEMPORARY_DIAGRAM_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.id").value(entityId.toString()))
            .andExpect(jsonPath("$.project_id").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.temporary_diagram_id").value(TEMPORARY_DIAGRAM_ID))
            .andExpect(jsonPath("$.diagram_payload.name").value("Test ER Diagram"))
            .andExpect(jsonPath("$.diagram_payload.diagram_kind").value("ER"))
            .andExpect(jsonPath("$.created_at").value(now.toString()))
            .andExpect(jsonPath("$.updated_at").value(now.toString()));
    }

    /**
     * Test 6: GET endpoint returns 404 when diagram not found.
     */
    @Test
    void getDiagram_returns404_whenNotFound() throws Exception {
        // Given
        when(temporaryDiagramService.getDiagram(PROJECT_ID, ARCHITECTURE_ID, "nonexistent-diagram"))
            .thenReturn(null);

        // When/Then
        mockMvc.perform(get(
                "/api/projects/{projectId}/architectures/{architectureId}/temporary-diagrams/{temporaryDiagramId}",
                PROJECT_ID, ARCHITECTURE_ID, "nonexistent-diagram"))
            .andExpect(status().isNotFound());
    }
}
