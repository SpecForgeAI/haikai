package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiagramBundleSelection;
import com.example.architecturemodel.model.dto.EntityBundleSelection;
import com.example.architecturemodel.model.dto.ExpandResolveRequestDto;
import com.example.architecturemodel.model.dto.ExpandResolveResponseDto;
import com.example.architecturemodel.model.dto.diagram.ResolvedDiagramSummary;
import com.example.architecturemodel.model.dto.entity.ResolvedEntitySummary;
import com.example.architecturemodel.service.ContextBundleExpansionService;
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
 * Unit tests for ImplementContextResolutionController expand-resolve endpoint.
 *
 * Spec: Context Bundles Backend Expansion - Task Group 2
 */
@WebMvcTest(ImplementContextResolutionController.class)
class ImplementContextResolutionControllerExpandResolveTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private ImplementContextResolutionService resolutionService;

    @MockBean
    private ContextBundleExpansionService expansionService;

    private static final UUID PROJECT_ID = UUID.fromString("00000000-0000-0000-0000-000000001234");
    private static final String BASE_URL = "/api/projects/{projectId}/implement-context/expand-resolve";

    @Test
    void expandResolveContext_validRequest_returns200WithExpandedContext() throws Exception {
        // Arrange
        ResolvedEntitySummary entitySummary = new ResolvedEntitySummary(
            "iface-123",
            "UserAPI",
            "interfaces",
            "application",
            Map.of("serviceId", "svc-1", "interfaceType", "REST")
        );

        ResolvedDiagramSummary diagramSummary = new ResolvedDiagramSummary(
            "diagram-1",
            "API Overview",
            "Interface",
            List.of("iface-123", "endpoint-1")
        );

        ExpandResolveResponseDto response = new ExpandResolveResponseDto(
            List.of("interfaces::iface-123", "endpoints::endpoint-1", "endpoints::endpoint-2"),
            List.of("diagram-1"),
            List.of(entitySummary),
            List.of(diagramSummary),
            false,
            null,
            List.of()
        );

        when(expansionService.expandAndResolve(eq(PROJECT_ID), anyList(), anyList()))
            .thenReturn(response);

        ExpandResolveRequestDto request = new ExpandResolveRequestDto(
            List.of(new EntityBundleSelection("interfaces", "iface-123", "interface_with_endpoints", null)),
            List.of(new DiagramBundleSelection("diagram-1", "diagram_only"))
        );

        // Act & Assert
        mockMvc.perform(post(BASE_URL, PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.expanded_entity_ids").isArray())
            .andExpect(jsonPath("$.expanded_entity_ids[0]").value("interfaces::iface-123"))
            .andExpect(jsonPath("$.expanded_entity_ids[1]").value("endpoints::endpoint-1"))
            .andExpect(jsonPath("$.expanded_diagram_ids").isArray())
            .andExpect(jsonPath("$.expanded_diagram_ids[0]").value("diagram-1"))
            .andExpect(jsonPath("$.resolved_entities").isArray())
            .andExpect(jsonPath("$.resolved_entities[0].id").value("iface-123"))
            .andExpect(jsonPath("$.resolved_entities[0].name").value("UserAPI"))
            .andExpect(jsonPath("$.resolved_diagrams").isArray())
            .andExpect(jsonPath("$.resolved_diagrams[0].id").value("diagram-1"))
            .andExpect(jsonPath("$.truncated").value(false))
            .andExpect(jsonPath("$.truncation_reason").doesNotExist());
    }

    @Test
    void expandResolveContext_responseIncludesAllExpectedFields() throws Exception {
        // Arrange - verify all fields in response structure
        ResolvedEntitySummary entitySummary = new ResolvedEntitySummary(
            "svc-456",
            "OrderService",
            "services",
            "application",
            Map.of("applicationId", "app-1")
        );

        ExpandResolveResponseDto response = new ExpandResolveResponseDto(
            List.of("services::svc-456", "interfaces::iface-1"),
            List.of(),
            List.of(entitySummary),
            List.of(),
            false,
            null,
            List.of()
        );

        when(expansionService.expandAndResolve(eq(PROJECT_ID), anyList(), anyList()))
            .thenReturn(response);

        ExpandResolveRequestDto request = new ExpandResolveRequestDto(
            List.of(new EntityBundleSelection("services", "svc-456", "service_with_parents_and_children", null)),
            List.of()
        );

        // Act & Assert - verify response contains all expected top-level fields
        mockMvc.perform(post(BASE_URL, PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.expanded_entity_ids").exists())
            .andExpect(jsonPath("$.expanded_diagram_ids").exists())
            .andExpect(jsonPath("$.resolved_entities").exists())
            .andExpect(jsonPath("$.resolved_diagrams").exists())
            .andExpect(jsonPath("$.truncated").exists())
            // truncation_reason can be null/absent when not truncated
            .andExpect(content().string(org.hamcrest.Matchers.containsString("expanded_entity_ids")))
            .andExpect(content().string(org.hamcrest.Matchers.containsString("expanded_diagram_ids")))
            .andExpect(content().string(org.hamcrest.Matchers.containsString("resolved_entities")))
            .andExpect(content().string(org.hamcrest.Matchers.containsString("resolved_diagrams")));
    }

    @Test
    void expandResolveContext_blankProjectId_returns400() throws Exception {
        // Arrange
        ExpandResolveRequestDto request = new ExpandResolveRequestDto(
            List.of(new EntityBundleSelection("interfaces", "iface-123", "interface_only", null)),
            List.of()
        );

        // Act & Assert
        mockMvc.perform(post("/api/projects/{projectId}/implement-context/expand-resolve", "   ")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest());
    }

    @Test
    void expandResolveContext_nullRequestBody_returns400() throws Exception {
        // Act & Assert
        mockMvc.perform(post(BASE_URL, PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content("null"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void expandResolveContext_truncatedResponse_includesTruncationMetadata() throws Exception {
        // Arrange - simulate truncation when limits exceeded
        ExpandResolveResponseDto response = new ExpandResolveResponseDto(
            List.of("services::svc-1", "services::svc-2"), // truncated list
            List.of(),
            List.of(),
            List.of(),
            true,
            "Entity limit exceeded: 252 entities truncated to 250",
            List.of()
        );

        when(expansionService.expandAndResolve(eq(PROJECT_ID), anyList(), anyList()))
            .thenReturn(response);

        ExpandResolveRequestDto request = new ExpandResolveRequestDto(
            List.of(new EntityBundleSelection("services", "svc-1", "service_with_parents_and_children", null)),
            List.of()
        );

        // Act & Assert
        mockMvc.perform(post(BASE_URL, PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.truncated").value(true))
            .andExpect(jsonPath("$.truncation_reason").value("Entity limit exceeded: 252 entities truncated to 250"));
    }

    @Test
    void expandResolveContext_emptyLists_returnsEmptyExpandedLists() throws Exception {
        // Arrange
        ExpandResolveResponseDto response = new ExpandResolveResponseDto(
            List.of(),
            List.of(),
            List.of(),
            List.of(),
            false,
            null,
            List.of()
        );

        when(expansionService.expandAndResolve(eq(PROJECT_ID), anyList(), anyList()))
            .thenReturn(response);

        ExpandResolveRequestDto request = new ExpandResolveRequestDto(
            List.of(),
            List.of()
        );

        // Act & Assert
        mockMvc.perform(post(BASE_URL, PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.expanded_entity_ids").isArray())
            .andExpect(jsonPath("$.expanded_entity_ids").isEmpty())
            .andExpect(jsonPath("$.expanded_diagram_ids").isArray())
            .andExpect(jsonPath("$.expanded_diagram_ids").isEmpty())
            .andExpect(jsonPath("$.resolved_entities").isArray())
            .andExpect(jsonPath("$.resolved_entities").isEmpty())
            .andExpect(jsonPath("$.resolved_diagrams").isArray())
            .andExpect(jsonPath("$.resolved_diagrams").isEmpty())
            .andExpect(jsonPath("$.truncated").value(false));
    }
}
