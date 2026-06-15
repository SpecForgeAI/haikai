package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.MigrationStorySpecGenerationDto;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
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
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Focused JUnit tests for the {@code applyManualEdit} service method on
 * {@link MigrationStorySpecGenerationService}.
 *
 * <p>Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
 * Task Group 2.</p>
 *
 * <p>Tests cover:</p>
 * <ol>
 *   <li>Manual edit persists {@code generatedSpecText} + the four audit
 *       fields and captures the prior spec text into
 *       {@code previousSpecText}.</li>
 *   <li>Manual edit on a {@code generated} row refreshes the parser-derived
 *       columns (decisions / interfaces / assumptions) from the new text.</li>
 *   <li>Manual edit on a {@code generated} row refreshes the quality columns
 *       and captures the prior score into {@code previousQualityScore}.</li>
 *   <li>Manual edit on an {@code insufficient_context} row with non-empty
 *       text PROMOTES {@code status} to {@code generated} (D5 fix) so the
 *       hand-authored row becomes dispatchable; the scorer then runs normally
 *       (the four quality fields are populated, NOT nulled) alongside the text
 *       + parser + audit fields.</li>
 *   <li>404 (via {@link ResourceNotFoundException}) when the supplied
 *       projectId does not match the spec row's project (cross-project
 *       access never leaks ownership).</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class MigrationStorySpecGenerationServiceManualEditTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID OTHER_PROJECT_ID = UUID.randomUUID();
    private static final UUID BOOK_ID = UUID.randomUUID();

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
    }

    // -----------------------------------------------------------------------
    // Test 1: persist + audit fields + previousSpecText capture
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("applyManualEdit persists specText + the four audit fields and captures previousSpecText")
    void applyManualEdit_persistsAuditAndPreviousSpecText() {
        UUID specId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();

        MigrationStorySpecGenerationEntity existing = baseEntity(specId, workItemId)
            
            .generatedSpecText("/agent-os:shape-spec OLD content")
            .status(MigrationStorySpecGenerationStatus.GENERATED)
            .qualityScore(42)
            .qualityGrade("D")
            .build();
        when(repository.findById(specId)).thenReturn(Optional.of(existing));
        lenient().when(workItemRepository.findById(workItemId))
            .thenReturn(Optional.of(workItem(workItemId)));

        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        MigrationStorySpecGenerationDto result = service.applyManualEdit(
            PROJECT_ID, specId, sampleSpecText(), "alice@example.com");

        MigrationStorySpecGenerationEntity saved = cap.getValue();
        // The four manual-edit audit fields are written.
        assertThat(saved.getManuallyEdited())
            .as("manually_edited flips to true")
            .isTrue();
        assertThat(saved.getLastManuallyEditedAt())
            .as("last_manually_edited_at is set to a recent Instant")
            .isNotNull();
        assertThat(saved.getLastManuallyEditedBy())
            .as("editedBy comes from the supplied header value")
            .isEqualTo("alice@example.com");

        // The prior spec text was captured BEFORE the overwrite.
        assertThat(saved.getPreviousSpecText())
            .as("prior generatedSpecText copied into previousSpecText (single-slot history)")
            .isEqualTo("/agent-os:shape-spec OLD content");

        // The new spec text is on the row.
        assertThat(saved.getGeneratedSpecText())
            .as("new spec text overwrites generated_spec_text")
            .isEqualTo(sampleSpecText());

        // DTO carries the audit fields through to the frontend.
        assertThat(result.manuallyEdited()).isTrue();
        assertThat(result.lastManuallyEditedBy()).isEqualTo("alice@example.com");
        assertThat(result.previousSpecText()).isEqualTo("/agent-os:shape-spec OLD content");
    }

    // -----------------------------------------------------------------------
    // Test 2: parser refresh on a generated row
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("applyManualEdit refreshes decisions/interfaces/assumptions JSON from the new spec text")
    void applyManualEdit_refreshesParserDerivedColumns() {
        UUID specId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();

        MigrationStorySpecGenerationEntity existing = baseEntity(specId, workItemId)
            
            .status(MigrationStorySpecGenerationStatus.GENERATED)
            .generatedSpecText("/agent-os:shape-spec original")
            .build();
        when(repository.findById(specId)).thenReturn(Optional.of(existing));
        lenient().when(workItemRepository.findById(workItemId))
            .thenReturn(Optional.of(workItem(workItemId)));

        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        service.applyManualEdit(
            PROJECT_ID, specId, sampleSpecText(), "alice@example.com");

        MigrationStorySpecGenerationEntity saved = cap.getValue();
        assertThat(saved.getDecisionsJson())
            .as("decisions extracted from new spec text")
            .isNotNull()
            .anySatisfy(d -> assertThat(d).contains("decide thing"));
        assertThat(saved.getInterfacesJson())
            .as("interfaces extracted from new spec text")
            .isNotNull()
            .anySatisfy(i -> assertThat(i).contains("PaymentService"));
        assertThat(saved.getAssumptionsJson())
            .as("assumptions extracted from new spec text")
            .isNotNull()
            .anySatisfy(a -> assertThat(a).contains("assumption A"));
    }

    // -----------------------------------------------------------------------
    // Test 3: quality refresh on a generated row -- previousQualityScore captured
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("applyManualEdit refreshes quality columns and captures prior score into previousQualityScore")
    void applyManualEdit_refreshesQualityAndCapturesPriorScore() {
        UUID specId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();

        MigrationStorySpecGenerationEntity existing = baseEntity(specId, workItemId)
            
            .status(MigrationStorySpecGenerationStatus.GENERATED)
            .generatedSpecText("/agent-os:shape-spec original")
            .qualityScore(42)
            .qualityGrade("D")
            .build();
        when(repository.findById(specId)).thenReturn(Optional.of(existing));
        lenient().when(workItemRepository.findById(workItemId))
            .thenReturn(Optional.of(workItem(workItemId)));

        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        service.applyManualEdit(
            PROJECT_ID, specId, sampleSpecText(), "alice@example.com");

        MigrationStorySpecGenerationEntity saved = cap.getValue();
        assertThat(saved.getQualityScore()).isNotNull().isBetween(0, 100);
        assertThat(saved.getQualityGrade()).isIn("A", "B", "C", "D", "F");
        assertThat(saved.getQualityDimensionsJson()).hasSize(5);
        // The prior score (42) was captured BEFORE the new score replaced it.
        assertThat(saved.getPreviousQualityScore())
            .as("prior quality_score copied into previous_quality_score")
            .isEqualTo(42);
    }

    // -----------------------------------------------------------------------
    // Test 4: insufficient_context row -- scorer skipped
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("applyManualEdit on an insufficient_context row with non-empty text PROMOTES status to generated and scores normally (D5 fix)")
    void applyManualEdit_insufficientContext_nonEmptyText_promotesAndScores() {
        UUID specId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();

        MigrationStorySpecGenerationEntity existing = baseEntity(specId, workItemId)
            
            .status(MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT)
            .generatedSpecText(null)
            .build();
        when(repository.findById(specId)).thenReturn(Optional.of(existing));
        lenient().when(workItemRepository.findById(workItemId))
            .thenReturn(Optional.of(workItem(workItemId)));

        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        MigrationStorySpecGenerationDto result = service.applyManualEdit(
            PROJECT_ID, specId, sampleSpecText(), "alice@example.com");

        MigrationStorySpecGenerationEntity saved = cap.getValue();
        // D5 fix: a non-empty hand-authored spec promotes the row to `generated`
        // so it becomes dispatchable (the latent bug was that status never moved).
        assertThat(saved.getStatus())
            .as("non-empty hand-authored text promotes insufficient_context -> generated")
            .isEqualTo(MigrationStorySpecGenerationStatus.GENERATED);
        assertThat(result.status()).isEqualTo(MigrationStorySpecGenerationStatus.GENERATED);
        // Because the row is now `generated`, the scorer runs NORMALLY (no longer
        // skipped) -- the four quality fields are populated, not nulled.
        assertThat(saved.getQualityScore()).isNotNull().isBetween(0, 100);
        assertThat(saved.getQualityGrade()).isIn("A", "B", "C", "D", "F");
        assertThat(saved.getQualityDimensionsJson()).hasSize(5);
        // Text + audit + parser still persisted.
        assertThat(saved.getManuallyEdited()).isTrue();
        assertThat(saved.getLastManuallyEditedBy()).isEqualTo("alice@example.com");
        assertThat(saved.getGeneratedSpecText()).isEqualTo(sampleSpecText());
    }

    @Test
    @DisplayName("applyManualEdit with EMPTY text on an insufficient_context row leaves status unchanged (D5 fix: only non-empty text promotes)")
    void applyManualEdit_insufficientContext_emptyText_leavesStatus() {
        UUID specId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();

        MigrationStorySpecGenerationEntity existing = baseEntity(specId, workItemId)
            
            .status(MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT)
            .generatedSpecText("some prior text")
            .build();
        when(repository.findById(specId)).thenReturn(Optional.of(existing));
        lenient().when(workItemRepository.findById(workItemId))
            .thenReturn(Optional.of(workItem(workItemId)));

        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        // Blank text must NOT promote -- clearing a spec cannot silently make the
        // row dispatchable, and the scorer stays skipped (status still insufficient).
        service.applyManualEdit(PROJECT_ID, specId, "   ", "alice@example.com");

        MigrationStorySpecGenerationEntity saved = cap.getValue();
        assertThat(saved.getStatus())
            .as("blank hand-authored text leaves status at insufficient_context")
            .isEqualTo(MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT);
        assertThat(saved.getQualityScore()).isNull();
        assertThat(saved.getQualityGrade()).isNull();
        assertThat(saved.getQualityDimensionsJson()).isNull();
    }

    // -----------------------------------------------------------------------
    // Test 5: cross-project 404
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("applyManualEdit throws ResourceNotFoundException when projectId does not match the spec row")
    void applyManualEdit_crossProject_throws404() {
        UUID specId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();

        // Row belongs to OTHER_PROJECT_ID; caller requests PROJECT_ID.
        MigrationStorySpecGenerationEntity existing = baseEntity(specId, workItemId)
            
            .projectId(OTHER_PROJECT_ID)
            .build();
        when(repository.findById(specId)).thenReturn(Optional.of(existing));

        assertThatThrownBy(() -> service.applyManualEdit(
            PROJECT_ID, specId, sampleSpecText(), "alice@example.com"))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @DisplayName("applyManualEdit throws ResourceNotFoundException when the spec row does not exist")
    void applyManualEdit_unknownSpec_throws404() {
        UUID specId = UUID.randomUUID();
        when(repository.findById(specId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.applyManualEdit(
            PROJECT_ID, specId, sampleSpecText(), "alice@example.com"))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private MigrationStorySpecGenerationEntity.MigrationStorySpecGenerationEntityBuilder baseEntity(UUID specId, UUID workItemId) {
        return MigrationStorySpecGenerationEntity.builder()
            .id(specId)
            .projectId(PROJECT_ID)
            .workItemId(workItemId)
            .bookOfWorkId(BOOK_ID)
            .status(MigrationStorySpecGenerationStatus.GENERATED)
            .createdByTask(MigrationStorySpecGenerationService.GENERATOR_TASK_ID)
            .generationAttemptNumber(1)
            .createdAt(Instant.now())
            .updatedAt(Instant.now());
    }

    private String sampleSpecText() {
        return String.join("\n",
            "/agent-os:shape-spec",
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
