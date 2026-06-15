package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.MigrationDeliveryDashboardDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryHierarchyNodeDto;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.WorkItemImplementWorkspaceRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Focused service-level tests that verify {@code manuallyEdited} on the
 * latest {@link MigrationStorySpecGenerationEntity} flows through
 * {@link MigrationDeliveryDashboardService} into the per-node
 * {@link MigrationDeliveryHierarchyNodeDto#manuallyEdited()} on the dashboard
 * response.
 *
 * <p>Frontend hierarchy tree reads this field directly to render the
 * "Edited" chip alongside the quality-grade chip -- no extra fetch per
 * node.</p>
 *
 * <p>Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
 * Task Group 4.</p>
 */
@ExtendWith(MockitoExtension.class)
class MigrationDeliveryDashboardServiceManuallyEditedTest {

    @Mock
    private GeneratedMigrationBookOfWorkRepository bookRepository;

    @Mock
    private WorkItemRepository workItemRepository;

    @Mock
    private MigrationStorySpecGenerationRepository specGenerationRepository;

    @Mock
    private WorkItemImplementWorkspaceRepository workspaceRepository;

    private MigrationDeliveryDashboardService service;

    private UUID projectId;
    private UUID bookId;

    @BeforeEach
    void setUp() {
        projectId = UUID.randomUUID();
        bookId = UUID.randomUUID();
        service = new MigrationDeliveryDashboardService(
            bookRepository,
            workItemRepository,
            specGenerationRepository,
            workspaceRepository);
    }

    @Test
    @DisplayName("manuallyEdited=true on the latest spec row surfaces on the hierarchy node DTO")
    void manuallyEditedTrueSurfacesOnHierarchyNode() {
        UUID workItemId = UUID.randomUUID();
        Map<String, Object> story = item("S1", null, "story", "Edited story", "WS", workItemId);
        seedBook(List.of(story));
        when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(List.of(workItem(workItemId, "Edited story")));

        MigrationStorySpecGenerationEntity spec = specGenWithManualEdit(
            workItemId,
            MigrationStorySpecGenerationStatus.GENERATED,
            Boolean.TRUE);
        when(specGenerationRepository.findByBookOfWorkId(bookId))
            .thenReturn(List.of(spec));
        lenient().when(workspaceRepository.findAll())
            .thenReturn(Collections.emptyList());

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        assertThat(dto.hierarchy()).hasSize(1);
        MigrationDeliveryHierarchyNodeDto node = dto.hierarchy().get(0);
        assertThat(node.workItemId()).isEqualTo(workItemId);
        assertThat(node.manuallyEdited()).isTrue();
    }

    @Test
    @DisplayName("manuallyEdited=null when no spec row exists for the node (no Edited chip rendered)")
    void manuallyEditedNullWhenNoSpecExists() {
        UUID workItemId = UUID.randomUUID();
        Map<String, Object> story = item("S1", null, "story", "Fresh story", "WS", workItemId);
        seedBook(List.of(story));
        when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(List.of(workItem(workItemId, "Fresh story")));
        when(specGenerationRepository.findByBookOfWorkId(bookId))
            .thenReturn(Collections.emptyList());
        lenient().when(workspaceRepository.findAll())
            .thenReturn(Collections.emptyList());

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        MigrationDeliveryHierarchyNodeDto node = dto.hierarchy().get(0);
        assertThat(node.manuallyEdited())
            .as("a node with no spec row has a null manuallyEdited flag")
            .isNull();
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private void seedBook(List<Map<String, Object>> items) {
        GeneratedMigrationBookOfWorkEntity book = new GeneratedMigrationBookOfWorkEntity();
        book.setId(bookId);
        book.setProjectId(projectId);
        book.setTitle("Test Book");
        book.setStatus("ACTIVE");
        Map<String, Object> bookJson = new LinkedHashMap<>();
        bookJson.put("items", items);
        book.setBookOfWorkJson(bookJson);
        book.setCreatedAt(Instant.now());
        book.setUpdatedAt(Instant.now());
        when(bookRepository.findById(bookId)).thenReturn(Optional.of(book));
    }

    private static Map<String, Object> item(
        String id, String parentId, String type, String title,
        String workstream, UUID workItemId) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("parentId", parentId);
        m.put("type", type);
        m.put("title", title);
        m.put("workstream", workstream);
        if (workItemId != null) {
            m.put("workItemId", workItemId.toString());
        }
        return m;
    }

    private static WorkItemEntity workItem(UUID id, String title) {
        WorkItemEntity row = WorkItemEntity.builder()
            .id(id)
            .projectId(UUID.randomUUID())
            .type("STORY")
            .title(title)
            .status("PLANNED")
            .sortOrder(0)
            .build();
        row.setCreatedAt(Instant.now());
        row.setUpdatedAt(Instant.now());
        return row;
    }

    private MigrationStorySpecGenerationEntity specGenWithManualEdit(
        UUID workItemId, String status, Boolean manuallyEdited) {
        MigrationStorySpecGenerationEntity row = MigrationStorySpecGenerationEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .workItemId(workItemId)
            .bookOfWorkId(bookId)
            .status(status)
            .generationAttemptNumber(1)
            .manuallyEdited(manuallyEdited)
            .build();
        row.setCreatedAt(Instant.now());
        row.setUpdatedAt(Instant.now());
        return row;
    }
}
