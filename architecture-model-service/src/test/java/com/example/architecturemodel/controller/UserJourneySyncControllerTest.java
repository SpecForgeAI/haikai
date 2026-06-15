package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.diagram.DiagramDto;
import com.example.architecturemodel.model.dto.diagram.UserJourneySyncStatusResponse;
import com.example.architecturemodel.service.UserJourneySyncService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for UserJourneySyncController.
 *
 * Spec: User Journey One-Way Sync from Meta-Model
 * Task Group 2: Sync Controller Endpoints
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing -- Task 6.3
 *   URL shape and service signatures updated to be architecture-scoped.
 *   New URL: /api/projects/{projectId}/architectures/{architectureId}/diagrams/{diagramId}/...
 */
@WebMvcTest(UserJourneySyncController.class)
class UserJourneySyncControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private UserJourneySyncService syncService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final String DIAGRAM_ID = "diag-001";

    /**
     * Test 1: GET sync-status returns 200 with IN_SYNC for a synced v2 diagram.
     */
    @Test
    void getSyncStatus_returns200WithInSync() throws Exception {
        when(syncService.checkSyncStatus(PROJECT_ID, ARCHITECTURE_ID, DIAGRAM_ID))
            .thenReturn(new UserJourneySyncStatusResponse(
                "IN_SYNC", null, "2026-04-03T10:00:00Z", "abc123hash"));

        mockMvc.perform(get(
                "/api/projects/{projectId}/architectures/{architectureId}/diagrams/{diagramId}/user-journey-sync-status",
                PROJECT_ID, ARCHITECTURE_ID, DIAGRAM_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.sync_status").value("IN_SYNC"))
            .andExpect(jsonPath("$.stale_reason").doesNotExist())
            .andExpect(jsonPath("$.last_synced_at").value("2026-04-03T10:00:00Z"))
            .andExpect(jsonPath("$.last_synced_hash").value("abc123hash"));
    }

    /**
     * Test 2: GET sync-status returns 200 with STALE when meta-model has changed.
     */
    @Test
    void getSyncStatus_returns200WithStale() throws Exception {
        when(syncService.checkSyncStatus(PROJECT_ID, ARCHITECTURE_ID, DIAGRAM_ID))
            .thenReturn(new UserJourneySyncStatusResponse(
                "STALE", "Meta-model data has changed since last sync",
                "2026-04-03T09:00:00Z", "oldhash"));

        mockMvc.perform(get(
                "/api/projects/{projectId}/architectures/{architectureId}/diagrams/{diagramId}/user-journey-sync-status",
                PROJECT_ID, ARCHITECTURE_ID, DIAGRAM_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.sync_status").value("STALE"))
            .andExpect(jsonPath("$.stale_reason").value("Meta-model data has changed since last sync"));
    }

    /**
     * Test 3: GET sync-status returns 200 with UNLINKED for a v1 diagram.
     */
    @Test
    void getSyncStatus_returns200WithUnlinked() throws Exception {
        when(syncService.checkSyncStatus(PROJECT_ID, ARCHITECTURE_ID, DIAGRAM_ID))
            .thenReturn(new UserJourneySyncStatusResponse(
                "UNLINKED", null, null, null));

        mockMvc.perform(get(
                "/api/projects/{projectId}/architectures/{architectureId}/diagrams/{diagramId}/user-journey-sync-status",
                PROJECT_ID, ARCHITECTURE_ID, DIAGRAM_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.sync_status").value("UNLINKED"))
            .andExpect(jsonPath("$.stale_reason").doesNotExist())
            .andExpect(jsonPath("$.last_synced_at").doesNotExist())
            .andExpect(jsonPath("$.last_synced_hash").doesNotExist());
    }

    /**
     * Test 4: POST refresh-from-model returns 200 with updated diagram and IN_SYNC status.
     */
    @Test
    void refreshFromModel_returns200WithUpdatedDiagram() throws Exception {
        Map<String, Object> typedContent = Map.of(
            "type", "USER_JOURNEY",
            "version", 2,
            "content", Map.of("diagram_type", "USER_JOURNEY")
        );

        DiagramDto updatedDiagram = new DiagramDto(
            DIAGRAM_ID, "My Journey", "desc", "USER_JOURNEY",
            null, null, List.of(), List.of(), List.of(), List.of(),
            typedContent
        );

        when(syncService.refreshFromModel(PROJECT_ID, ARCHITECTURE_ID, DIAGRAM_ID))
            .thenReturn(updatedDiagram);

        mockMvc.perform(post(
                "/api/projects/{projectId}/architectures/{architectureId}/diagrams/{diagramId}/refresh-user-journey-from-model",
                PROJECT_ID, ARCHITECTURE_ID, DIAGRAM_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.id").value(DIAGRAM_ID))
            .andExpect(jsonPath("$.name").value("My Journey"))
            .andExpect(jsonPath("$.typed_content.type").value("USER_JOURNEY"))
            .andExpect(jsonPath("$.typed_content.version").value(2));
    }

    /**
     * Test 5: POST refresh-from-model returns 404 when source is broken.
     */
    @Test
    void refreshFromModel_returns404WhenSourceBroken() throws Exception {
        when(syncService.refreshFromModel(PROJECT_ID, ARCHITECTURE_ID, DIAGRAM_ID))
            .thenThrow(new ResourceNotFoundException("User journey not found: uj-001"));

        mockMvc.perform(post(
                "/api/projects/{projectId}/architectures/{architectureId}/diagrams/{diagramId}/refresh-user-journey-from-model",
                PROJECT_ID, ARCHITECTURE_ID, DIAGRAM_ID))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.status").value(404))
            .andExpect(jsonPath("$.message").value("User journey not found: uj-001"));
    }
}
