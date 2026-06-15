package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.MigrationStorySpecGenerationDto;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationConfidence;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.BatchPersistResult;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.StaleSpecSummary;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Service-level tests for the stale-spec dashboard surface and the
 * clear-stale-on-regenerate write-path hook.
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 9.</p>
 *
 * <p>Two tests:</p>
 * <ol>
 *   <li>{@code getStaleSpecSummary} returns the expected count + WorkItem id
 *       list from the project-scoped {@code stale=true} repository query.</li>
 *   <li>{@code persistBatchResults} clears {@code stale=false} and
 *       {@code staleMarkedAt=null} on a previously-stale row when the new
 *       status is a successful regeneration (generated /
 *       generated_with_warnings); a failed re-attempt leaves the stale flag
 *       intact.</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class MigrationStorySpecGenerationServiceStaleTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID BOOK_ID = UUID.randomUUID();

    @Mock private MigrationStorySpecGenerationRepository repository;
    @Mock private GeneratedMigrationBookOfWorkRepository bookOfWorkRepository;
    @Mock private WorkItemRepository workItemRepository;

    private MigrationStorySpecGenerationService service;

    @BeforeEach
    void setUp() {
        service = new MigrationStorySpecGenerationService(
            repository, bookOfWorkRepository, workItemRepository,
            new com.example.architecturemodel.util.ShapeSpecHeadingParser());
    }

    private GeneratedMigrationBookOfWorkEntity buildBook() {
        GeneratedMigrationBookOfWorkEntity e = new GeneratedMigrationBookOfWorkEntity();
        e.setId(BOOK_ID);
        e.setProjectId(PROJECT_ID);
        e.setStatus("draft");
        Map<String, Object> blob = new LinkedHashMap<>();
        blob.put("items", List.of());
        e.setBookOfWorkJson(blob);
        e.setCreatedAt(Instant.now());
        e.setUpdatedAt(Instant.now());
        return e;
    }

    private WorkItemEntity workItem(UUID id) {
        return WorkItemEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .type("STORY")
            .title("story-" + id.toString().substring(0, 4))
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }

    private MigrationStorySpecGenerationEntity staleRow(UUID workItemId) {
        Instant now = Instant.now();
        return MigrationStorySpecGenerationEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .workItemId(workItemId)
            .bookOfWorkId(BOOK_ID)
            .bookItemId("bi-" + workItemId)
            .status(MigrationStorySpecGenerationStatus.GENERATED)
            .confidence(MigrationStorySpecGenerationConfidence.MEDIUM)
            .generationAttemptNumber(1)
            .createdByTask(MigrationStorySpecGenerationService.GENERATOR_TASK_ID)
            .stale(Boolean.TRUE)
            .staleMarkedAt(now.minusSeconds(60))
            .createdAt(now.minusSeconds(120))
            .updatedAt(now.minusSeconds(60))
            .build();
    }

    private MigrationStorySpecGenerationDto regenDto(UUID workItemId, String status) {
        return new MigrationStorySpecGenerationDto(
            null, PROJECT_ID, workItemId, BOOK_ID, "bi-" + workItemId,
            status,
            MigrationStorySpecGenerationConfidence.HIGH,
            "high",
            status.startsWith("generated") ? "/agent-os:shape-spec regen" : null,
            null, null, null, null,
            Instant.now().toString(), null,
            null, null, null, null
        );
    }

    // -----------------------------------------------------------------------
    // Test 1: getStaleSpecSummary returns the expected count + ids.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("getStaleSpecSummary returns count + workItemIds from stale=true rows")
    void getStaleSpecSummaryReturnsCountAndIds() {
        UUID wi1 = UUID.randomUUID();
        UUID wi2 = UUID.randomUUID();
        UUID wi3 = UUID.randomUUID();
        List<MigrationStorySpecGenerationEntity> stale = List.of(
            staleRow(wi1), staleRow(wi2), staleRow(wi3));
        when(repository.findByProjectIdAndStaleTrue(PROJECT_ID)).thenReturn(stale);

        StaleSpecSummary summary = service.getStaleSpecSummary(PROJECT_ID);

        assertThat(summary.staleCount()).isEqualTo(3);
        assertThat(summary.staleWorkItemIds())
            .containsExactlyInAnyOrder(wi1.toString(), wi2.toString(), wi3.toString());
    }

    @Test
    @DisplayName("getStaleSpecSummary returns empty summary when no rows are stale")
    void getStaleSpecSummaryEmpty() {
        when(repository.findByProjectIdAndStaleTrue(PROJECT_ID)).thenReturn(List.of());

        StaleSpecSummary summary = service.getStaleSpecSummary(PROJECT_ID);

        assertThat(summary.staleCount()).isZero();
        assertThat(summary.staleWorkItemIds()).isEmpty();
    }

    // -----------------------------------------------------------------------
    // Test 3: clear-stale-on-regenerate semantics.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("persistBatchResults clears stale flag when regen status is successful")
    void persistBatchClearsStaleOnSuccess() {
        GeneratedMigrationBookOfWorkEntity book = buildBook();
        lenient().when(bookOfWorkRepository.findById(BOOK_ID))
            .thenReturn(Optional.of(book));

        UUID wi = UUID.randomUUID();
        lenient().when(workItemRepository.findByIdAndProjectId(wi, PROJECT_ID))
            .thenReturn(Optional.of(workItem(wi)));

        MigrationStorySpecGenerationEntity existing = staleRow(wi);
        when(repository.findByWorkItemId(wi)).thenReturn(List.of(existing));

        ArgumentCaptor<MigrationStorySpecGenerationEntity> captor =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(captor.capture())).thenAnswer(inv -> inv.getArgument(0));

        BatchPersistResult result = service.persistBatchResults(
            PROJECT_ID, BOOK_ID,
            List.of(regenDto(wi, MigrationStorySpecGenerationStatus.GENERATED)));

        assertThat(result.persistedCount()).isEqualTo(1);

        MigrationStorySpecGenerationEntity saved = captor.getValue();
        assertThat(saved.getStale()).isEqualTo(Boolean.FALSE);
        assertThat(saved.getStaleMarkedAt()).isNull();
    }

    @Test
    @DisplayName("persistBatchResults keeps stale flag when regen status is FAILED")
    void persistBatchKeepsStaleOnFailure() {
        GeneratedMigrationBookOfWorkEntity book = buildBook();
        lenient().when(bookOfWorkRepository.findById(BOOK_ID))
            .thenReturn(Optional.of(book));

        UUID wi = UUID.randomUUID();
        lenient().when(workItemRepository.findByIdAndProjectId(wi, PROJECT_ID))
            .thenReturn(Optional.of(workItem(wi)));

        MigrationStorySpecGenerationEntity existing = staleRow(wi);
        Instant priorStaleMarkedAt = existing.getStaleMarkedAt();
        when(repository.findByWorkItemId(wi)).thenReturn(List.of(existing));

        ArgumentCaptor<MigrationStorySpecGenerationEntity> captor =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(captor.capture())).thenAnswer(inv -> inv.getArgument(0));

        BatchPersistResult result = service.persistBatchResults(
            PROJECT_ID, BOOK_ID,
            List.of(regenDto(wi, MigrationStorySpecGenerationStatus.FAILED)));

        assertThat(result.persistedCount()).isEqualTo(1);

        MigrationStorySpecGenerationEntity saved = captor.getValue();
        assertThat(saved.getStale()).isEqualTo(Boolean.TRUE);
        assertThat(saved.getStaleMarkedAt()).isEqualTo(priorStaleMarkedAt);
    }
}
