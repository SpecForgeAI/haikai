package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.MigrationStorySpecGenerationDto;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.BatchPersistResult;
import com.example.architecturemodel.service.quality.SpecQualityScorer;
import com.example.architecturemodel.util.ShapeSpecHeadingParser;
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
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Focused JUnit tests for the spec-quality-scoring persist-time hook in
 * {@link MigrationStorySpecGenerationService}.
 *
 * <p>Spec: Spec Quality Scoring (2026-05-20) -- Task Group 3.</p>
 *
 * <p>Tests cover the contract:</p>
 * <ol>
 *   <li>{@code generated} row on fresh insert: quality columns populated,
 *       {@code previous_quality_score} stays null</li>
 *   <li>Overwrite of a previously-scored row captures the prior score into
 *       {@code previous_quality_score} BEFORE re-scoring</li>
 *   <li>{@code insufficient_context} status: all four quality fields null
 *       (scoring skipped)</li>
 *   <li>{@code failed} status: same null-out behaviour as
 *       {@code insufficient_context}</li>
 *   <li>Scorer exception is swallowed: persistence still happens, four
 *       quality fields nulled, {@code quality_scoring_error} warning
 *       appended to {@code warnings_json}</li>
 *   <li>Back-compat 4/5-arg constructors still work (regression guard)</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class MigrationStorySpecGenerationServiceQualityScoringTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID BOOK_ID = UUID.randomUUID();

    @Mock private MigrationStorySpecGenerationRepository repository;
    @Mock private GeneratedMigrationBookOfWorkRepository bookOfWorkRepository;
    @Mock private WorkItemRepository workItemRepository;

    private MigrationStorySpecGenerationService service;
    private SpecQualityScorer realScorer;

    @BeforeEach
    void setUp() {
        realScorer = new SpecQualityScorer();
        service = new MigrationStorySpecGenerationService(
            repository, bookOfWorkRepository, workItemRepository,
            new ShapeSpecHeadingParser(),
            new MissingInputKeyHasher(),
            realScorer);
        // Book + WorkItem stubs (book has no items; we just need the lookup
        // to succeed).
        GeneratedMigrationBookOfWorkEntity book = new GeneratedMigrationBookOfWorkEntity();
        book.setId(BOOK_ID);
        book.setProjectId(PROJECT_ID);
        book.setStatus("draft");
        Map<String, Object> blob = new LinkedHashMap<>();
        blob.put("items", List.of());
        book.setBookOfWorkJson(blob);
        book.setCreatedAt(Instant.now());
        book.setUpdatedAt(Instant.now());
        lenient().when(bookOfWorkRepository.findById(BOOK_ID)).thenReturn(Optional.of(book));
    }

    // -----------------------------------------------------------------------
    // Test 1: fresh-insert row with status=generated gets non-null quality cols
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("persistOne on a fresh 'generated' row populates quality fields, previous_quality_score=null")
    void persistOne_freshGeneratedRow_populatesQualityFieldsNullPrevious() {
        UUID workItemId = UUID.randomUUID();
        lenient().when(workItemRepository.findByIdAndProjectId(workItemId, PROJECT_ID))
            .thenReturn(Optional.of(workItem(workItemId)));
        lenient().when(repository.findByWorkItemId(workItemId)).thenReturn(List.of());

        MigrationStorySpecGenerationDto dto = generatedDto(workItemId, sampleSpecText());

        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        BatchPersistResult result = service.persistBatchResults(
            PROJECT_ID, BOOK_ID, List.of(dto));
        assertThat(result.persistedCount()).isEqualTo(1);
        MigrationStorySpecGenerationEntity saved = cap.getValue();

        assertThat(saved.getQualityScore()).isNotNull();
        assertThat(saved.getQualityScore()).isBetween(0, 100);
        assertThat(saved.getQualityGrade()).isIn("A", "B", "C", "D", "F");
        assertThat(saved.getQualityDimensionsJson()).hasSize(6);
        // First-time scoring: previous_quality_score stays null.
        assertThat(saved.getPreviousQualityScore()).isNull();
    }

    // -----------------------------------------------------------------------
    // Test 2: overwrite captures prior quality_score into previous_quality_score
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("persistOne overwriting a scored row captures prior score into previous_quality_score")
    void persistOne_overwrite_capturesPriorScore() {
        UUID workItemId = UUID.randomUUID();
        lenient().when(workItemRepository.findByIdAndProjectId(workItemId, PROJECT_ID))
            .thenReturn(Optional.of(workItem(workItemId)));

        // Existing row already has a quality_score = 42 (and quality_grade D).
        MigrationStorySpecGenerationEntity existing =
            MigrationStorySpecGenerationEntity.builder()
                .id(UUID.randomUUID())
                .projectId(PROJECT_ID)
                .workItemId(workItemId)
                .bookOfWorkId(BOOK_ID)
                .status(MigrationStorySpecGenerationStatus.GENERATED)
                .generatedSpecText("old spec")
                .qualityScore(42)
                .qualityGrade("D")
                .createdByTask(MigrationStorySpecGenerationService.GENERATOR_TASK_ID)
                .generationAttemptNumber(1)
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();
        lenient().when(repository.findByWorkItemId(workItemId))
            .thenReturn(List.of(existing));

        MigrationStorySpecGenerationDto dto = generatedDto(workItemId, sampleSpecText());

        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        BatchPersistResult result = service.persistBatchResults(
            PROJECT_ID, BOOK_ID, List.of(dto));
        assertThat(result.persistedCount()).isEqualTo(1);
        MigrationStorySpecGenerationEntity saved = cap.getValue();

        // The prior score (42) was captured BEFORE the new score replaced it.
        assertThat(saved.getPreviousQualityScore()).isEqualTo(42);
        // And the new score / grade has been written.
        assertThat(saved.getQualityScore()).isNotNull();
        assertThat(saved.getQualityGrade()).isIn("A", "B", "C", "D", "F");
    }

    // -----------------------------------------------------------------------
    // Test 3: insufficient_context status -> all four quality fields null
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("persistOne on 'insufficient_context' row sets all quality fields to null")
    void persistOne_insufficientContext_nullsQualityFields() {
        UUID workItemId = UUID.randomUUID();
        lenient().when(workItemRepository.findByIdAndProjectId(workItemId, PROJECT_ID))
            .thenReturn(Optional.of(workItem(workItemId)));
        lenient().when(repository.findByWorkItemId(workItemId)).thenReturn(List.of());

        MigrationStorySpecGenerationDto dto = new MigrationStorySpecGenerationDto(
            null, PROJECT_ID, workItemId, BOOK_ID, "bi-1",
            MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT,
            null, null, null, null,
            null, null, null, null, null,
            0, null, null, null);

        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        BatchPersistResult result = service.persistBatchResults(
            PROJECT_ID, BOOK_ID, List.of(dto));
        assertThat(result.persistedCount()).isEqualTo(1);
        MigrationStorySpecGenerationEntity saved = cap.getValue();

        assertThat(saved.getQualityScore()).isNull();
        assertThat(saved.getQualityGrade()).isNull();
        assertThat(saved.getQualityDimensionsJson()).isNull();
        // Previous-quality-score is null on a fresh insufficient_context insert
        // (no prior row to anchor against).
        assertThat(saved.getPreviousQualityScore()).isNull();
    }

    // -----------------------------------------------------------------------
    // Test 4: failed status -> all four quality fields null (same as insufficient)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("persistOne on 'failed' row nulls quality fields (same as insufficient_context)")
    void persistOne_failed_nullsQualityFields() {
        UUID workItemId = UUID.randomUUID();
        lenient().when(workItemRepository.findByIdAndProjectId(workItemId, PROJECT_ID))
            .thenReturn(Optional.of(workItem(workItemId)));
        lenient().when(repository.findByWorkItemId(workItemId)).thenReturn(List.of());

        MigrationStorySpecGenerationDto dto = new MigrationStorySpecGenerationDto(
            null, PROJECT_ID, workItemId, BOOK_ID, "bi-1",
            MigrationStorySpecGenerationStatus.FAILED,
            null, null, null, null,
            null, null, null, null, "LLM call failed",
            0, null, null, null);

        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        BatchPersistResult result = service.persistBatchResults(
            PROJECT_ID, BOOK_ID, List.of(dto));
        assertThat(result.persistedCount()).isEqualTo(1);
        MigrationStorySpecGenerationEntity saved = cap.getValue();

        assertThat(saved.getQualityScore()).isNull();
        assertThat(saved.getQualityGrade()).isNull();
        assertThat(saved.getQualityDimensionsJson()).isNull();
    }

    // -----------------------------------------------------------------------
    // Test 5: scorer exception is swallowed; row still persists with nulls +
    // quality_scoring_error warning
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("persistOne swallows scorer exceptions: nulls quality fields and appends quality_scoring_error warning")
    void persistOne_scorerThrows_swallowedAndWarningAppended() {
        UUID workItemId = UUID.randomUUID();
        lenient().when(workItemRepository.findByIdAndProjectId(workItemId, PROJECT_ID))
            .thenReturn(Optional.of(workItem(workItemId)));
        lenient().when(repository.findByWorkItemId(workItemId)).thenReturn(List.of());

        // Inject a scorer that throws.
        SpecQualityScorer throwingScorer = mock(SpecQualityScorer.class);
        doThrow(new RuntimeException("kaboom"))
            .when(throwingScorer).score(any());

        MigrationStorySpecGenerationService throwingService =
            new MigrationStorySpecGenerationService(
                repository, bookOfWorkRepository, workItemRepository,
                new ShapeSpecHeadingParser(),
                new MissingInputKeyHasher(),
                throwingScorer);

        MigrationStorySpecGenerationDto dto = generatedDto(workItemId, sampleSpecText());

        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        BatchPersistResult result = throwingService.persistBatchResults(
            PROJECT_ID, BOOK_ID, List.of(dto));
        assertThat(result.persistedCount())
            .as("Row still persists despite scorer failure")
            .isEqualTo(1);
        MigrationStorySpecGenerationEntity saved = cap.getValue();

        assertThat(saved.getQualityScore()).isNull();
        assertThat(saved.getQualityGrade()).isNull();
        assertThat(saved.getQualityDimensionsJson()).isNull();
        assertThat(saved.getWarningsJson())
            .as("quality_scoring_error warning appended")
            .anyMatch(w -> "quality_scoring_error".equals(w.get("kind")));
    }

    // -----------------------------------------------------------------------
    // Test 6: back-compat 4-arg and 5-arg constructors still work
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("4-arg and 5-arg back-compat constructors still produce a working service")
    void backCompatConstructors_stillWork() {
        // 4-arg constructor (pre-MissingInputKeyHasher, pre-SpecQualityScorer)
        MigrationStorySpecGenerationService fourArg =
            new MigrationStorySpecGenerationService(
                repository, bookOfWorkRepository, workItemRepository,
                new ShapeSpecHeadingParser());
        assertThat(fourArg).isNotNull();

        // 5-arg constructor (pre-SpecQualityScorer)
        MigrationStorySpecGenerationService fiveArg =
            new MigrationStorySpecGenerationService(
                repository, bookOfWorkRepository, workItemRepository,
                new ShapeSpecHeadingParser(),
                new MissingInputKeyHasher());
        assertThat(fiveArg).isNotNull();

        // Smoke: 4-arg can still persist a row end-to-end.
        UUID workItemId = UUID.randomUUID();
        lenient().when(workItemRepository.findByIdAndProjectId(workItemId, PROJECT_ID))
            .thenReturn(Optional.of(workItem(workItemId)));
        lenient().when(repository.findByWorkItemId(workItemId)).thenReturn(List.of());

        MigrationStorySpecGenerationDto dto = generatedDto(workItemId, sampleSpecText());

        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        BatchPersistResult result = fourArg.persistBatchResults(
            PROJECT_ID, BOOK_ID, List.of(dto));
        assertThat(result.persistedCount()).isEqualTo(1);
        // The 4-arg constructor builds a default SpecQualityScorer, so the
        // row should still come out scored.
        assertThat(cap.getValue().getQualityScore()).isNotNull();
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private MigrationStorySpecGenerationDto generatedDto(UUID workItemId, String specText) {
        return new MigrationStorySpecGenerationDto(
            null, PROJECT_ID, workItemId, BOOK_ID, "bi-1",
            MigrationStorySpecGenerationStatus.GENERATED,
            "high", null, specText,
            null, null, null, null, null, null,
            1, null, null, null);
    }

    private String sampleSpecText() {
        return String.join("\n",
            "## Decisions",
            "- decide thing",
            "## Interfaces",
            "- PaymentService",
            "## Assumptions",
            "- assumption A",
            "## Acceptance Criteria",
            "- when PaymentService returns 200 it asserts record exists",
            "## Tests",
            "- com.example.PaymentServiceTest",
            "## Evidence",
            "- [finding-1] supporting spec",
            "## Files Affected",
            "- src/main/java/Foo.java");
    }

    private WorkItemEntity workItem(UUID id) {
        return WorkItemEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .type("STORY")
            .title("Payment Story " + id.toString().substring(0, 4))
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }
}
