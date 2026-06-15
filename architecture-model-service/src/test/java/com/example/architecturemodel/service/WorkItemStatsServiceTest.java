package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.WorkItemStatsDto;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * Unit tests for WorkItemService.getWorkItemStats().
 *
 * Spec 2026-03-06: Dashboard Real Data -- Work Item Stats Endpoint.
 */
@ExtendWith(MockitoExtension.class)
class WorkItemStatsServiceTest {

    @Mock
    private WorkItemRepository workItemRepository;

    @InjectMocks
    private WorkItemService workItemService;

    private static final UUID PROJECT_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");

    /**
     * Build a list of Object[] rows for mocking countByTypeAndStatus results.
     */
    private static List<Object[]> buildRows(Object[]... rows) {
        List<Object[]> list = new ArrayList<>();
        Collections.addAll(list, rows);
        return list;
    }

    /**
     * Test that typeCounts correctly groups by type AND status.
     * Verifies the nested map structure: { EPIC: { PLANNED: 3, IN_PROGRESS: 2 }, STORY: { PLANNED: 5 } }
     */
    @Test
    void getWorkItemStats_groupsByTypeAndStatus() {
        List<Object[]> rows = buildRows(
            new Object[]{"EPIC", "PLANNED", 3L},
            new Object[]{"EPIC", "IN_PROGRESS", 2L},
            new Object[]{"STORY", "PLANNED", 5L},
            new Object[]{"FEATURE", "COMPLETED", 1L}
        );

        when(workItemRepository.countByTypeAndStatus(eq(PROJECT_ID))).thenReturn(rows);
        when(workItemRepository.countStoriesWithAc(eq(PROJECT_ID))).thenReturn(4L);

        WorkItemStatsDto result = workItemService.getWorkItemStats(PROJECT_ID);

        assertThat(result.typeCounts()).hasSize(3);
        assertThat(result.typeCounts().get("EPIC")).containsEntry("PLANNED", 3L);
        assertThat(result.typeCounts().get("EPIC")).containsEntry("IN_PROGRESS", 2L);
        assertThat(result.typeCounts().get("STORY")).containsEntry("PLANNED", 5L);
        assertThat(result.typeCounts().get("FEATURE")).containsEntry("COMPLETED", 1L);
        assertThat(result.storiesWithAcCount()).isEqualTo(4L);
    }

    /**
     * Test that storiesWithAcCount returns the count from the repository query,
     * counting only STORYs where description is non-null and non-empty.
     */
    @Test
    void getWorkItemStats_storiesWithAcCount_returnsRepositoryCount() {
        List<Object[]> rows = buildRows(
            new Object[]{"STORY", "PLANNED", 10L}
        );

        when(workItemRepository.countByTypeAndStatus(eq(PROJECT_ID))).thenReturn(rows);
        when(workItemRepository.countStoriesWithAc(eq(PROJECT_ID))).thenReturn(7L);

        WorkItemStatsDto result = workItemService.getWorkItemStats(PROJECT_ID);

        assertThat(result.storiesWithAcCount()).isEqualTo(7L);
    }

    /**
     * Test that an empty project returns empty typeCounts and storiesWithAcCount of 0.
     */
    @Test
    void getWorkItemStats_emptyProject_returnsEmptyMaps() {
        List<Object[]> emptyRows = new ArrayList<>();

        when(workItemRepository.countByTypeAndStatus(eq(PROJECT_ID))).thenReturn(emptyRows);
        when(workItemRepository.countStoriesWithAc(eq(PROJECT_ID))).thenReturn(0L);

        WorkItemStatsDto result = workItemService.getWorkItemStats(PROJECT_ID);

        assertThat(result.typeCounts()).isEmpty();
        assertThat(result.storiesWithAcCount()).isEqualTo(0L);
    }

    /**
     * Test that multiple statuses for the same type are correctly nested
     * under the type key in the map.
     */
    @Test
    void getWorkItemStats_multipleStatusesPerType_nestedCorrectly() {
        List<Object[]> rows = buildRows(
            new Object[]{"EPIC", "PLANNED", 5L},
            new Object[]{"EPIC", "IN_PROGRESS", 3L},
            new Object[]{"EPIC", "COMPLETED", 1L},
            new Object[]{"EPIC", "CANCELLED", 2L}
        );

        when(workItemRepository.countByTypeAndStatus(eq(PROJECT_ID))).thenReturn(rows);
        when(workItemRepository.countStoriesWithAc(eq(PROJECT_ID))).thenReturn(0L);

        WorkItemStatsDto result = workItemService.getWorkItemStats(PROJECT_ID);

        assertThat(result.typeCounts()).hasSize(1);
        assertThat(result.typeCounts().get("EPIC")).hasSize(4);
        assertThat(result.typeCounts().get("EPIC")).containsEntry("PLANNED", 5L);
        assertThat(result.typeCounts().get("EPIC")).containsEntry("IN_PROGRESS", 3L);
        assertThat(result.typeCounts().get("EPIC")).containsEntry("COMPLETED", 1L);
        assertThat(result.typeCounts().get("EPIC")).containsEntry("CANCELLED", 2L);
    }
}
