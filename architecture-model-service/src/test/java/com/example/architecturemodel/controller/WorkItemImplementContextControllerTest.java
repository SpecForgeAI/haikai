package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ImplementContextDto;
import com.example.architecturemodel.service.WorkItemImplementContextService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for WorkItemImplementContextController.
 *
 * Spec 2026-01-09: Persist Implement Context per Work Item in Backend
 * Task Group 4: Testing and Verification
 */
@WebMvcTest(WorkItemImplementContextController.class)
class WorkItemImplementContextControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private WorkItemImplementContextService contextService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID WORK_ITEM_ID = UUID.randomUUID();

    @Test
    void getContext_returns200WithContext() throws Exception {
        // Given
        ImplementContextDto dto = new ImplementContextDto(
            PROJECT_ID,
            WORK_ITEM_ID,
            List.of("applications::app-1"),
            List.of("diagram-1")
        );

        when(contextService.getContext(PROJECT_ID, WORK_ITEM_ID)).thenReturn(dto);

        // When/Then
        mockMvc.perform(get("/api/projects/{projectId}/work-items/{workItemId}/implement-context",
                PROJECT_ID, WORK_ITEM_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.project_id").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.work_item_id").value(WORK_ITEM_ID.toString()))
            .andExpect(jsonPath("$.selected_entity_ids[0]").value("applications::app-1"))
            .andExpect(jsonPath("$.selected_diagram_ids[0]").value("diagram-1"));
    }

    @Test
    void getContext_returns200WithEmptyContext() throws Exception {
        // Given
        ImplementContextDto dto = new ImplementContextDto(
            PROJECT_ID,
            WORK_ITEM_ID,
            List.of(),
            List.of()
        );

        when(contextService.getContext(PROJECT_ID, WORK_ITEM_ID)).thenReturn(dto);

        // When/Then
        mockMvc.perform(get("/api/projects/{projectId}/work-items/{workItemId}/implement-context",
                PROJECT_ID, WORK_ITEM_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.selected_entity_ids").isEmpty())
            .andExpect(jsonPath("$.selected_diagram_ids").isEmpty());
    }

    @Test
    void saveContext_returns200WithUpdatedContext() throws Exception {
        // Given
        List<String> entityIds = List.of("applications::app-1", "services::svc-1");
        List<String> diagramIds = List.of("diagram-1");

        ImplementContextDto dto = new ImplementContextDto(
            PROJECT_ID,
            WORK_ITEM_ID,
            entityIds,
            diagramIds
        );

        // Controller now calls the full 8-arg saveContext (selections + relationships).
        when(contextService.saveContext(eq(PROJECT_ID), eq(WORK_ITEM_ID),
                any(), any(), any(), any(), any(), any()))
            .thenReturn(dto);

        String requestBody = """
            {
                "selected_entity_ids": ["applications::app-1", "services::svc-1"],
                "selected_diagram_ids": ["diagram-1"]
            }
            """;

        // When/Then
        mockMvc.perform(put("/api/projects/{projectId}/work-items/{workItemId}/implement-context",
                PROJECT_ID, WORK_ITEM_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.selected_entity_ids").isArray())
            .andExpect(jsonPath("$.selected_entity_ids.length()").value(2))
            .andExpect(jsonPath("$.selected_diagram_ids.length()").value(1));
    }

    @Test
    void getContext_returns400ForBlankProjectId() throws Exception {
        // When/Then
        mockMvc.perform(get("/api/projects/{projectId}/work-items/{workItemId}/implement-context",
                " ", WORK_ITEM_ID))
            .andExpect(status().isBadRequest());
    }
}
