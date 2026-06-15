package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.dto.WorkItemStatsDto;
import com.example.architecturemodel.service.WorkItemService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for the Work Item Stats endpoint.
 *
 * Spec 2026-03-06: Dashboard Real Data -- Work Item Stats Endpoint.
 */
@ExtendWith(MockitoExtension.class)
class WorkItemStatsControllerTest {

    @Mock
    private WorkItemService workItemService;

    private MockMvc mockMvc;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @BeforeEach
    void setUp() {
        WorkItemController controller = new WorkItemController(workItemService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    /**
     * Test that GET /work-items/stats returns 200 with expected JSON shape
     * containing type_counts map and stories_with_ac_count integer.
     */
    @Test
    void getStats_returns200WithExpectedJsonShape() throws Exception {
        WorkItemStatsDto stats = new WorkItemStatsDto(
            Map.of(
                "EPIC", Map.of("PLANNED", 3L, "IN_PROGRESS", 2L),
                "STORY", Map.of("PLANNED", 5L)
            ),
            4L
        );

        when(workItemService.getWorkItemStats(eq(PROJECT_ID))).thenReturn(stats);

        mockMvc.perform(get("/api/model/projects/{projectId}/work-items/stats", PROJECT_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.type_counts").isMap())
            .andExpect(jsonPath("$.type_counts.EPIC.PLANNED").value(3))
            .andExpect(jsonPath("$.type_counts.EPIC.IN_PROGRESS").value(2))
            .andExpect(jsonPath("$.type_counts.STORY.PLANNED").value(5))
            .andExpect(jsonPath("$.stories_with_ac_count").value(4));
    }

    /**
     * Test that an empty project returns type_counts: {} and stories_with_ac_count: 0.
     */
    @Test
    void getStats_emptyProject_returnsEmptyTypeCounts() throws Exception {
        WorkItemStatsDto stats = new WorkItemStatsDto(Map.of(), 0L);

        when(workItemService.getWorkItemStats(eq(PROJECT_ID))).thenReturn(stats);

        mockMvc.perform(get("/api/model/projects/{projectId}/work-items/stats", PROJECT_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.type_counts").isMap())
            .andExpect(jsonPath("$.type_counts").isEmpty())
            .andExpect(jsonPath("$.stories_with_ac_count").value(0));
    }
}
