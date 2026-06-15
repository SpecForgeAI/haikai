package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ImplementContextResolveRequestDto;
import com.example.architecturemodel.model.dto.ResolvedImplementContextDto;
import com.example.architecturemodel.model.dto.diagram.ResolvedDiagramSummary;
import com.example.architecturemodel.model.dto.entity.ResolvedEntitySummary;
import com.example.architecturemodel.service.ImplementContextResolutionService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Unit tests for ImplementContextResolutionController.
 *
 * Spec: Implement Context Resolution - Iteration 3
 */
@WebMvcTest(ImplementContextResolutionController.class)
class ImplementContextResolutionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private ImplementContextResolutionService resolutionService;

    @MockBean
    private com.example.architecturemodel.service.ContextBundleExpansionService expansionService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final String BASE_URL = "/api/projects/{projectId}/implement-context/resolve";

    @Test
    void resolveContext_validRequest_returns200WithResolvedContext() throws Exception {
        // Arrange
        ResolvedEntitySummary entitySummary = new ResolvedEntitySummary(
            "svc-123",
            "UserService",
            "services",
            "application",
            Map.of("applicationId", "app-1")
        );

        ResolvedDiagramSummary diagramSummary = new ResolvedDiagramSummary(
            "diagram-1",
            "System Overview",
            "General",
            List.of("svc-123", "app-1")
        );

        ResolvedImplementContextDto response = new ResolvedImplementContextDto(
            List.of(entitySummary),
            List.of(diagramSummary)
        );

        when(resolutionService.resolveContext(eq(PROJECT_ID), anyList(), anyList()))
            .thenReturn(response);

        ImplementContextResolveRequestDto request = new ImplementContextResolveRequestDto(
            List.of("services::svc-123"),
            List.of("diagram-1")
        );

        // Act & Assert
        mockMvc.perform(post(BASE_URL, PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.resolved_entities").isArray())
            .andExpect(jsonPath("$.resolved_entities[0].id").value("svc-123"))
            .andExpect(jsonPath("$.resolved_entities[0].name").value("UserService"))
            .andExpect(jsonPath("$.resolved_entities[0].entity_type").value("services"))
            .andExpect(jsonPath("$.resolved_entities[0].category").value("application"))
            .andExpect(jsonPath("$.resolved_diagrams").isArray())
            .andExpect(jsonPath("$.resolved_diagrams[0].id").value("diagram-1"))
            .andExpect(jsonPath("$.resolved_diagrams[0].name").value("System Overview"))
            .andExpect(jsonPath("$.resolved_diagrams[0].diagram_type").value("General"));
    }

    @Test
    void resolveContext_emptyLists_returnsEmptyResolvedLists() throws Exception {
        // Arrange
        ResolvedImplementContextDto response = new ResolvedImplementContextDto(
            List.of(),
            List.of()
        );

        when(resolutionService.resolveContext(eq(PROJECT_ID), anyList(), anyList()))
            .thenReturn(response);

        ImplementContextResolveRequestDto request = new ImplementContextResolveRequestDto(
            List.of(),
            List.of()
        );

        // Act & Assert
        mockMvc.perform(post(BASE_URL, PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.resolved_entities").isArray())
            .andExpect(jsonPath("$.resolved_entities").isEmpty())
            .andExpect(jsonPath("$.resolved_diagrams").isArray())
            .andExpect(jsonPath("$.resolved_diagrams").isEmpty());
    }

    @Test
    void resolveContext_blankProjectId_returns400() throws Exception {
        // Arrange
        ImplementContextResolveRequestDto request = new ImplementContextResolveRequestDto(
            List.of("services::svc-123"),
            List.of("diagram-1")
        );

        // Act & Assert
        mockMvc.perform(post("/api/projects/{projectId}/implement-context/resolve", "   ")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest());
    }

    @Test
    void resolveContext_nonExistentProject_returns404() throws Exception {
        // Arrange
        UUID unknownProjectId = UUID.randomUUID();
        when(resolutionService.resolveContext(eq(unknownProjectId), anyList(), anyList()))
            .thenThrow(new ResourceNotFoundException("Model file not found: " + unknownProjectId));

        ImplementContextResolveRequestDto request = new ImplementContextResolveRequestDto(
            List.of("services::svc-123"),
            List.of()
        );

        // Act & Assert
        mockMvc.perform(post("/api/projects/{projectId}/implement-context/resolve", unknownProjectId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isNotFound());
    }

    @Test
    void resolveContext_nullRequestBody_returns400() throws Exception {
        // Act & Assert
        mockMvc.perform(post(BASE_URL, PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content("null"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void resolveContext_responseUsesSnakeCaseJsonNames() throws Exception {
        // Arrange
        ResolvedEntitySummary entitySummary = new ResolvedEntitySummary(
            "svc-123",
            "UserService",
            "services",
            "application",
            Map.of("applicationId", "app-1")
        );

        ResolvedImplementContextDto response = new ResolvedImplementContextDto(
            List.of(entitySummary),
            List.of()
        );

        when(resolutionService.resolveContext(eq(PROJECT_ID), anyList(), anyList()))
            .thenReturn(response);

        ImplementContextResolveRequestDto request = new ImplementContextResolveRequestDto(
            List.of("services::svc-123"),
            List.of()
        );

        // Act & Assert - verify snake_case JSON property names
        mockMvc.perform(post(BASE_URL, PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(content().string(org.hamcrest.Matchers.containsString("resolved_entities")))
            .andExpect(content().string(org.hamcrest.Matchers.containsString("resolved_diagrams")))
            .andExpect(content().string(org.hamcrest.Matchers.containsString("entity_type")))
            .andExpect(content().string(org.hamcrest.Matchers.containsString("relevant_fields")));
    }
}
