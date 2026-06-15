package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ImplementWorkspaceDto;
import com.example.architecturemodel.service.WorkItemImplementWorkspaceService;
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

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for WorkItemImplementWorkspaceController.
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 3: Backend Controller Layer
 */
@WebMvcTest(WorkItemImplementWorkspaceController.class)
class WorkItemImplementWorkspaceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private WorkItemImplementWorkspaceService workspaceService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID WORK_ITEM_ID = UUID.randomUUID();

    /**
     * Test 1: GET returns 200 with empty workspace when none exists.
     */
    @Test
    void getWorkspace_returns200WithEmptyWorkspace_whenNoneExists() throws Exception {
        // Given
        ImplementWorkspaceDto emptyDto = ImplementWorkspaceDto.empty(PROJECT_ID, WORK_ITEM_ID);

        when(workspaceService.getWorkspace(PROJECT_ID, WORK_ITEM_ID)).thenReturn(emptyDto);

        // When/Then
        mockMvc.perform(get("/api/projects/{projectId}/work-items/{workItemId}/implement-workspace",
                PROJECT_ID, WORK_ITEM_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.project_id").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.work_item_id").value(WORK_ITEM_ID.toString()))
            .andExpect(jsonPath("$.schema_version").value(1))
            .andExpect(jsonPath("$.implementation_mode").value(false))
            .andExpect(jsonPath("$.active_increment_id").doesNotExist())
            .andExpect(jsonPath("$.questions").isEmpty())
            .andExpect(jsonPath("$.team_chat_transcript").isEmpty());
    }

    /**
     * Test 2: GET returns 200 with populated workspace when exists.
     */
    @Test
    void getWorkspace_returns200WithPopulatedWorkspace_whenExists() throws Exception {
        // Given
        ImplementWorkspaceDto dto = new ImplementWorkspaceDto(
            PROJECT_ID,
            WORK_ITEM_ID,
            1,
            true,
            Map.of("featureUnderstanding", "Test feature"),
            "INC-1",
            List.of(Map.of("id", "q1", "question", "What is X?")),
            Map.of("INC-1", Map.of("shapeSpec", "spec")),
            List.of(Map.of("role", "assistant", "message", "Hello"))
        );

        when(workspaceService.getWorkspace(PROJECT_ID, WORK_ITEM_ID)).thenReturn(dto);

        // When/Then
        mockMvc.perform(get("/api/projects/{projectId}/work-items/{workItemId}/implement-workspace",
                PROJECT_ID, WORK_ITEM_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.project_id").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.work_item_id").value(WORK_ITEM_ID.toString()))
            .andExpect(jsonPath("$.schema_version").value(1))
            .andExpect(jsonPath("$.implementation_mode").value(true))
            .andExpect(jsonPath("$.active_increment_id").value("INC-1"))
            .andExpect(jsonPath("$.planner_payload.featureUnderstanding").value("Test feature"))
            .andExpect(jsonPath("$.questions[0].id").value("q1"))
            .andExpect(jsonPath("$.execution_artifacts_by_increment.INC-1.shapeSpec").value("spec"))
            .andExpect(jsonPath("$.team_chat_transcript[0].role").value("assistant"));
    }

    /**
     * Test 3: PUT returns 200 and saves workspace correctly.
     */
    @Test
    void saveWorkspace_returns200AndSavesCorrectly() throws Exception {
        // Given
        Map<String, Object> workspaceState = Map.of(
            "schemaVersion", 1,
            "implementationMode", true,
            "activeIncrementId", "INC-2"
        );

        ImplementWorkspaceDto savedDto = new ImplementWorkspaceDto(
            PROJECT_ID,
            WORK_ITEM_ID,
            1,
            true,
            Map.of(),
            "INC-2",
            List.of(),
            Map.of(),
            List.of()
        );

        when(workspaceService.saveWorkspace(eq(PROJECT_ID), eq(WORK_ITEM_ID), any()))
            .thenReturn(savedDto);

        String requestBody = """
            {
                "workspace_state": {
                    "schemaVersion": 1,
                    "implementationMode": true,
                    "activeIncrementId": "INC-2"
                }
            }
            """;

        // When/Then
        mockMvc.perform(put("/api/projects/{projectId}/work-items/{workItemId}/implement-workspace",
                PROJECT_ID, WORK_ITEM_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.project_id").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.work_item_id").value(WORK_ITEM_ID.toString()))
            .andExpect(jsonPath("$.implementation_mode").value(true))
            .andExpect(jsonPath("$.active_increment_id").value("INC-2"));
    }

    /**
     * Test 4: GET/PUT return 400 for blank projectId or null workItemId.
     */
    @Test
    void getWorkspace_returns400ForBlankProjectId() throws Exception {
        // When/Then
        mockMvc.perform(get("/api/projects/{projectId}/work-items/{workItemId}/implement-workspace",
                " ", WORK_ITEM_ID))
            .andExpect(status().isBadRequest());
    }
}
