package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.WorkItemDto;
import com.example.architecturemodel.service.WorkItemService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for WorkItemController.
 */
@ExtendWith(MockitoExtension.class)
class WorkItemControllerTest {

    @Mock
    private WorkItemService workItemService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        WorkItemController controller = new WorkItemController(workItemService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();

        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        objectMapper.registerModule(new JavaTimeModule());
    }

    /**
     * Test GET /work-items returns list with 200.
     */
    @Test
    void listWorkItems_returns200() throws Exception {
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();

        WorkItemDto item = new WorkItemDto(
            id, PROJECT_ID, "INITIATIVE", null,
            "Test Initiative", "Description", "PLANNED",
            0, null, null, null, null, null, null, now, now
        );

        when(workItemService.getWorkItems(eq(PROJECT_ID), isNull(), isNull()))
            .thenReturn(List.of(item));

        mockMvc.perform(get("/api/model/projects/{projectId}/work-items", PROJECT_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value(id.toString()))
            .andExpect(jsonPath("$[0].project_id").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$[0].type").value("INITIATIVE"))
            .andExpect(jsonPath("$[0].title").value("Test Initiative"));
    }

    /**
     * Test POST /work-items creates with 201.
     */
    @Test
    void createWorkItem_returns201() throws Exception {
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();

        WorkItemDto inputDto = new WorkItemDto(
            null, PROJECT_ID, "INITIATIVE", null,
            "New Initiative", "Description", "PLANNED",
            0, null, null, null, null, null, null, null, null
        );

        WorkItemDto resultDto = new WorkItemDto(
            id, PROJECT_ID, "INITIATIVE", null,
            "New Initiative", "Description", "PLANNED",
            0, null, null, null, null, null, null, now, now
        );

        when(workItemService.createWorkItem(eq(PROJECT_ID), any(WorkItemDto.class)))
            .thenReturn(resultDto);

        mockMvc.perform(post("/api/model/projects/{projectId}/work-items", PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(inputDto)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(id.toString()))
            .andExpect(jsonPath("$.title").value("New Initiative"));
    }

    /**
     * Test POST /work-items with validation failure returns 400.
     */
    @Test
    void createWorkItem_validationFailure_returns400() throws Exception {
        WorkItemDto inputDto = new WorkItemDto(
            null, PROJECT_ID, "INVALID_TYPE", null,
            "Invalid Item", null, null, null, null, null, null, null, null, null, null, null
        );

        when(workItemService.createWorkItem(eq(PROJECT_ID), any(WorkItemDto.class)))
            .thenThrow(new IllegalArgumentException("Invalid work item type: INVALID_TYPE"));

        mockMvc.perform(post("/api/model/projects/{projectId}/work-items", PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(inputDto)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Invalid work item type: INVALID_TYPE"));
    }

    /**
     * Test GET /work-items/{id} with non-existent ID returns 404.
     */
    @Test
    void getWorkItem_notFound_returns404() throws Exception {
        UUID id = UUID.randomUUID();

        when(workItemService.getWorkItem(id))
            .thenThrow(new ResourceNotFoundException("Work item not found: " + id));

        mockMvc.perform(get("/api/model/projects/{projectId}/work-items/{id}", PROJECT_ID, id))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value("Work item not found: " + id));
    }

    /**
     * Test PUT /work-items/{id} with cross-project parent returns 400.
     */
    @Test
    void updateWorkItem_crossProjectParent_returns400() throws Exception {
        UUID id = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();

        WorkItemDto inputDto = new WorkItemDto(
            id, PROJECT_ID, "EPIC", parentId,
            "Updated Epic", null, "PLANNED", 0, null, null, null, null, null, null, null, null
        );

        when(workItemService.updateWorkItem(eq(id), any(WorkItemDto.class)))
            .thenThrow(new IllegalArgumentException(
                "Parent work item must be in the same project"));

        mockMvc.perform(put("/api/model/projects/{projectId}/work-items/{id}", PROJECT_ID, id)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(inputDto)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Parent work item must be in the same project"));
    }

    /**
     * Test DELETE /work-items/{id} returns 204.
     */
    @Test
    void deleteWorkItem_returns204() throws Exception {
        UUID id = UUID.randomUUID();

        doNothing().when(workItemService).deleteWorkItem(id);

        mockMvc.perform(delete("/api/model/projects/{projectId}/work-items/{id}", PROJECT_ID, id))
            .andExpect(status().isNoContent());

        verify(workItemService).deleteWorkItem(id);
    }

    // ============================================================================
    // Spec 2026-01-18: Fix Feature Edit 400 Error - HTTP Integration Tests
    // Task Group 3.2: Integration tests for parent_id preservation
    // ============================================================================

    /**
     * Test: HTTP PUT with parent_id in request body updates correctly (returns 200).
     *
     * Spec 2026-01-18: Integration test verifying the backend receives request with parent_id
     * and updates correctly without 400 error.
     */
    @Test
    void updateWorkItem_withParentIdInRequest_returns200() throws Exception {
        UUID featureId = UUID.randomUUID();
        UUID epicParentId = UUID.randomUUID();
        Instant now = Instant.now();

        // Input DTO includes parent_id (snake_case for JSON)
        WorkItemDto inputDto = new WorkItemDto(
            featureId, PROJECT_ID, "FEATURE", epicParentId,
            "Updated Feature Title", "Updated description", "IN_PROGRESS",
            1, 2, "2026-Q2", null, null, null, null, null, null
        );

        // Expected response
        WorkItemDto resultDto = new WorkItemDto(
            featureId, PROJECT_ID, "FEATURE", epicParentId,
            "Updated Feature Title", "Updated description", "IN_PROGRESS",
            1, 2, "2026-Q2", null, null, null, null, now, now
        );

        when(workItemService.updateWorkItem(eq(featureId), any(WorkItemDto.class)))
            .thenReturn(resultDto);

        mockMvc.perform(put("/api/model/projects/{projectId}/work-items/{id}", PROJECT_ID, featureId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(inputDto)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(featureId.toString()))
            .andExpect(jsonPath("$.title").value("Updated Feature Title"))
            .andExpect(jsonPath("$.parent_id").value(epicParentId.toString()))
            .andExpect(jsonPath("$.type").value("FEATURE"));

        verify(workItemService).updateWorkItem(eq(featureId), any(WorkItemDto.class));
    }

    /**
     * Test: HTTP PUT without parent_id in request body succeeds (returns 200).
     *
     * Spec 2026-01-18: Integration test verifying the backend receives request without parent_id
     * and preserves the existing parent relationship (patch semantics).
     */
    @Test
    void updateWorkItem_withoutParentIdInRequest_returns200() throws Exception {
        UUID featureId = UUID.randomUUID();
        UUID existingParentId = UUID.randomUUID();
        Instant now = Instant.now();

        // Input DTO without parent_id (simulating frontend edit that only updates title)
        // Note: Jackson will serialize this as {"parent_id": null, ...}
        WorkItemDto inputDto = new WorkItemDto(
            featureId, PROJECT_ID, "FEATURE", null,  // parent_id is null
            "Updated Feature Title", null, "PLANNED",
            0, null, null, null, null, null, null, null, null
        );

        // Service returns with preserved parent (patch semantics applied)
        WorkItemDto resultDto = new WorkItemDto(
            featureId, PROJECT_ID, "FEATURE", existingParentId,  // parent preserved
            "Updated Feature Title", null, "PLANNED",
            0, null, null, null, null, null, null, now, now
        );

        when(workItemService.updateWorkItem(eq(featureId), any(WorkItemDto.class)))
            .thenReturn(resultDto);

        mockMvc.perform(put("/api/model/projects/{projectId}/work-items/{id}", PROJECT_ID, featureId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(inputDto)))
            .andExpect(status().isOk())  // No 400 error
            .andExpect(jsonPath("$.id").value(featureId.toString()))
            .andExpect(jsonPath("$.title").value("Updated Feature Title"))
            .andExpect(jsonPath("$.parent_id").value(existingParentId.toString()))  // Parent preserved
            .andExpect(jsonPath("$.type").value("FEATURE"));

        verify(workItemService).updateWorkItem(eq(featureId), any(WorkItemDto.class));
    }

    /**
     * Test: HTTP PUT for STORY without parent_id succeeds (returns 200).
     *
     * Spec 2026-01-18: Integration test verifying STORY updates work correctly
     * with patch semantics for parent preservation.
     */
    @Test
    void updateWorkItem_storyWithoutParentId_returns200() throws Exception {
        UUID storyId = UUID.randomUUID();
        UUID existingFeatureParentId = UUID.randomUUID();
        Instant now = Instant.now();

        // Input DTO without parent_id (STORY edit that only updates description)
        WorkItemDto inputDto = new WorkItemDto(
            storyId, PROJECT_ID, "STORY", null,  // parent_id is null
            "Story Title", "Updated story description", "READY",
            0, null, null, null, null, null, null, null, null
        );

        // Service returns with preserved FEATURE parent
        WorkItemDto resultDto = new WorkItemDto(
            storyId, PROJECT_ID, "STORY", existingFeatureParentId,  // FEATURE parent preserved
            "Story Title", "Updated story description", "READY",
            0, null, null, null, null, null, null, now, now
        );

        when(workItemService.updateWorkItem(eq(storyId), any(WorkItemDto.class)))
            .thenReturn(resultDto);

        mockMvc.perform(put("/api/model/projects/{projectId}/work-items/{id}", PROJECT_ID, storyId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(inputDto)))
            .andExpect(status().isOk())  // No 400 error
            .andExpect(jsonPath("$.id").value(storyId.toString()))
            .andExpect(jsonPath("$.description").value("Updated story description"))
            .andExpect(jsonPath("$.parent_id").value(existingFeatureParentId.toString()))  // Parent preserved
            .andExpect(jsonPath("$.type").value("STORY"));

        verify(workItemService).updateWorkItem(eq(storyId), any(WorkItemDto.class));
    }

    /**
     * Test: HTTP PUT for FEATURE edit (title change) does not cause 400 error.
     *
     * Spec 2026-01-18: Critical workflow test - Edit FEATURE -> Save -> No 400 error.
     * This test simulates the exact scenario that was causing the original bug.
     */
    @Test
    void updateWorkItem_featureTitleEdit_no400Error() throws Exception {
        UUID featureId = UUID.randomUUID();
        UUID epicParentId = UUID.randomUUID();
        Instant now = Instant.now();

        // Simulating frontend edit modal payload (includes type and parentId for defensive coding)
        WorkItemDto inputDto = new WorkItemDto(
            featureId, PROJECT_ID, "FEATURE", epicParentId,
            "Renamed Feature", null, "PLANNED",
            0, null, null, null, null, null, null, null, null
        );

        // Expected successful response
        WorkItemDto resultDto = new WorkItemDto(
            featureId, PROJECT_ID, "FEATURE", epicParentId,
            "Renamed Feature", null, "PLANNED",
            0, null, null, null, null, null, null, now, now
        );

        when(workItemService.updateWorkItem(eq(featureId), any(WorkItemDto.class)))
            .thenReturn(resultDto);

        // The critical assertion: this should NOT return 400
        mockMvc.perform(put("/api/model/projects/{projectId}/work-items/{id}", PROJECT_ID, featureId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(inputDto)))
            .andExpect(status().isOk())  // NOT 400!
            .andExpect(jsonPath("$.title").value("Renamed Feature"))
            .andExpect(jsonPath("$.parent_id").value(epicParentId.toString()));
    }
}
