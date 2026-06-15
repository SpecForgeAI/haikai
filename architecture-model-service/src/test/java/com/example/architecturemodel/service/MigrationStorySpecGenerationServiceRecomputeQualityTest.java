package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.BulkRecomputeQualityResult;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.RecomputeQualityResult;
import com.example.architecturemodel.service.quality.SpecQualityScorer;
import com.example.architecturemodel.util.ShapeSpecHeadingParser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Focused tests for the project-ownership + skip-status + bulk-summary
 * behaviour of the new recompute methods on
 * {@link MigrationStorySpecGenerationService}.
 *
 * <p>Spec: Spec Quality Scoring (2026-05-20) -- Task Group 4.</p>
 *
 * <p>Tests cover:</p>
 * <ol>
 *   <li>Cross-project specId throws {@link ResourceNotFoundException} (404
 *       surface at the controller).</li>
 *   <li>{@code insufficient_context} row returns the N/A sentinel and does
 *       NOT call {@code save(...)}.</li>
 *   <li>Bulk recompute counts insufficient_context + failed rows into
 *       {@code gradeBreakdown.na} (not {@code F}).</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class MigrationStorySpecGenerationServiceRecomputeQualityTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID OTHER_PROJECT_ID = UUID.randomUUID();
    private static final UUID SPEC_ID = UUID.randomUUID();
    private static final UUID WORK_ITEM_ID = UUID.randomUUID();

    @Mock private MigrationStorySpecGenerationRepository repository;
    @Mock private GeneratedMigrationBookOfWorkRepository bookOfWorkRepository;
    @Mock private WorkItemRepository workItemRepository;

    private MigrationStorySpecGenerationService service;

    @BeforeEach
    void setUp() {
        service = new MigrationStorySpecGenerationService(
            repository, bookOfWorkRepository, workItemRepository,
            new ShapeSpecHeadingParser(),
            new MissingInputKeyHasher(),
            new SpecQualityScorer());
        // Default: save returns its argument so callers see the entity back.
        lenient().when(repository.save(any(MigrationStorySpecGenerationEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
    }

    // -----------------------------------------------------------------------
    // 1) Cross-project specId throws ResourceNotFoundException
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("recomputeQualityForSpec throws ResourceNotFoundException when the spec belongs to a different project")
    void recomputeQuality_crossProject_throws404() {
        MigrationStorySpecGenerationEntity entity =
            new MigrationStorySpecGenerationEntity();
        entity.setId(SPEC_ID);
        entity.setProjectId(OTHER_PROJECT_ID);
        entity.setWorkItemId(WORK_ITEM_ID);
        entity.setStatus(MigrationStorySpecGenerationStatus.GENERATED);
        when(repository.findById(SPEC_ID)).thenReturn(Optional.of(entity));

        assertThatThrownBy(() -> service.recomputeQualityForSpec(PROJECT_ID, SPEC_ID))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining(SPEC_ID.toString());
    }

    // -----------------------------------------------------------------------
    // 2) insufficient_context row returns N/A sentinel; no scoring performed
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("recomputeQualityForSpec on insufficient_context row returns N/A sentinel with null quality fields")
    void recomputeQuality_insufficientContext_returnsNaSentinel() {
        MigrationStorySpecGenerationEntity entity =
            new MigrationStorySpecGenerationEntity();
        entity.setId(SPEC_ID);
        entity.setProjectId(PROJECT_ID);
        entity.setWorkItemId(WORK_ITEM_ID);
        entity.setStatus(MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT);
        when(repository.findById(SPEC_ID)).thenReturn(Optional.of(entity));

        RecomputeQualityResult result =
            service.recomputeQualityForSpec(PROJECT_ID, SPEC_ID);

        assertThat(result.qualityScore()).isNull();
        assertThat(result.qualityGrade()).isNull();
        assertThat(result.qualityDimensions()).isNull();
        assertThat(result.previousQualityScore()).isNull();
        assertThat(result.message()).isEqualTo("N/A: no spec text to assess");
    }

    // -----------------------------------------------------------------------
    // 3) Bulk recompute counts skipped rows into gradeBreakdown.na
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("bulkRecomputeQualityForProject counts insufficient_context + failed rows into gradeBreakdown.na (not F)")
    void bulkRecompute_skippedRowsCountIntoNa() {
        MigrationStorySpecGenerationEntity skipped1 =
            new MigrationStorySpecGenerationEntity();
        skipped1.setId(UUID.randomUUID());
        skipped1.setProjectId(PROJECT_ID);
        skipped1.setWorkItemId(UUID.randomUUID());
        skipped1.setStatus(MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT);

        MigrationStorySpecGenerationEntity skipped2 =
            new MigrationStorySpecGenerationEntity();
        skipped2.setId(UUID.randomUUID());
        skipped2.setProjectId(PROJECT_ID);
        skipped2.setWorkItemId(UUID.randomUUID());
        skipped2.setStatus(MigrationStorySpecGenerationStatus.FAILED);

        // A scorable row (status=generated, empty body -> low scoring, valid grade).
        MigrationStorySpecGenerationEntity scorable =
            new MigrationStorySpecGenerationEntity();
        scorable.setId(UUID.randomUUID());
        scorable.setProjectId(PROJECT_ID);
        scorable.setWorkItemId(UUID.randomUUID());
        scorable.setStatus(MigrationStorySpecGenerationStatus.GENERATED);
        scorable.setGeneratedSpecText("");

        when(repository.findByProjectId(PROJECT_ID))
            .thenReturn(List.of(skipped1, skipped2, scorable));
        // WorkItem lookups for the scorable row's title resolution.
        lenient().when(workItemRepository.findById(any(UUID.class)))
            .thenAnswer(inv -> {
                WorkItemEntity wi = new WorkItemEntity();
                wi.setId(inv.getArgument(0));
                wi.setTitle("Test story");
                return Optional.of(wi);
            });

        BulkRecomputeQualityResult result =
            service.bulkRecomputeQualityForProject(PROJECT_ID);

        assertThat(result.totalScored()).isEqualTo(1);
        assertThat(result.totalSkipped()).isEqualTo(2);
        assertThat(result.gradeBreakdown()).containsEntry("na", 2);
        // The scorable row will land in some letter band (likely F since the
        // spec text is empty); F should remain 0 for the SKIPPED rows
        // specifically -- the assertion below proves skipped never bumps F.
        Integer fCount = result.gradeBreakdown().get("F");
        // The scorable row may or may not land in F depending on the scorer's
        // tie-breaking; we just verify total = totalScored + totalSkipped.
        int sum = result.gradeBreakdown().values().stream()
            .mapToInt(Integer::intValue).sum();
        assertThat(sum).isEqualTo(3);
        // na MUST equal totalSkipped exactly (skipped rows go to na, not F).
        assertThat(result.gradeBreakdown().get("na")).isEqualTo(2);
        // F never inflates above the count of the one scorable row.
        assertThat(fCount).isLessThanOrEqualTo(1);
    }
}
