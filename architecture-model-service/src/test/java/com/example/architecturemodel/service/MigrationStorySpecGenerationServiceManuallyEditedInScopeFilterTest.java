package com.example.architecturemodel.service;

import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.ManuallyEditedInScopeRow;
import com.example.architecturemodel.service.quality.SpecQualityScorer;
import com.example.architecturemodel.util.ShapeSpecHeadingParser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Cross-layer gap coverage for {@code listManuallyEditedInScope} filtering
 * semantics that drive the bulk-overwrite picker (Task Group 9).
 *
 * <p>The Group 3.4 happy-path coverage (controller MockMvc + service unit
 * tests for {@code applyManualEdit}) does not assert the negative cases below
 * end-to-end -- yet they govern what the frontend bulk picker shows. A row
 * with {@code manuallyEdited=false} must NOT appear; a row that belongs to a
 * different project must NOT leak (even when the AMS book-of-work guard
 * accepts the request).</p>
 *
 * <p>Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
 * Task Group 10 (cross-layer gap analysis).</p>
 */
@ExtendWith(MockitoExtension.class)
class MigrationStorySpecGenerationServiceManuallyEditedInScopeFilterTest {

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
        // Book of work resolves for the supplied project.
        GeneratedMigrationBookOfWorkEntity book = new GeneratedMigrationBookOfWorkEntity();
        book.setId(BOOK_ID);
        book.setProjectId(PROJECT_ID);
        when(bookOfWorkRepository.findById(BOOK_ID)).thenReturn(Optional.of(book));
    }

    // -----------------------------------------------------------------------
    // Test 1: rows with manuallyEdited=false are filtered out of the listing
    // (the bulk picker must NEVER show LLM-generated rows).
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("listManuallyEditedInScope excludes rows where manuallyEdited == false")
    void listManuallyEditedInScope_excludesNonManuallyEditedRows() {
        UUID editedWorkItem = UUID.randomUUID();
        UUID freshWorkItem = UUID.randomUUID();
        MigrationStorySpecGenerationEntity edited = baseRow(editedWorkItem)
            .manuallyEdited(Boolean.TRUE)
            .lastManuallyEditedBy("alice@example.com")
            .lastManuallyEditedAt(Instant.parse("2026-05-20T10:00:00Z"))
            .build();
        MigrationStorySpecGenerationEntity fresh = baseRow(freshWorkItem)
            .manuallyEdited(Boolean.FALSE)
            .build();
        // A third row whose flag is NULL (legacy data path) must also be
        // filtered out -- only Boolean.TRUE qualifies.
        UUID nullFlagWorkItem = UUID.randomUUID();
        MigrationStorySpecGenerationEntity legacyNull = baseRow(nullFlagWorkItem)
            .manuallyEdited(null)
            .build();
        when(repository.findByBookOfWorkIdOrderByCreatedAtAsc(BOOK_ID))
            .thenReturn(List.of(edited, fresh, legacyNull));
        lenient().when(workItemRepository.findById(editedWorkItem))
            .thenReturn(Optional.of(workItem(editedWorkItem, "Edited story")));

        List<ManuallyEditedInScopeRow> rows =
            service.listManuallyEditedInScope(PROJECT_ID, BOOK_ID, null);

        assertThat(rows)
            .as("Only the manuallyEdited=true row appears in the listing.")
            .hasSize(1);
        assertThat(rows.get(0).workItemId()).isEqualTo(editedWorkItem);
        assertThat(rows.get(0).lastManuallyEditedBy()).isEqualTo("alice@example.com");
        assertThat(rows.get(0).workItemTitle()).isEqualTo("Edited story");
    }

    // -----------------------------------------------------------------------
    // Test 2: rows belonging to a different projectId are filtered out, even
    // when the book-of-work guard accepts the request. Defence in depth so
    // cross-project rows never leak into the bulk picker.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("listManuallyEditedInScope excludes rows whose projectId does not match the caller's projectId")
    void listManuallyEditedInScope_excludesCrossProjectRows() {
        UUID ownWorkItem = UUID.randomUUID();
        UUID otherWorkItem = UUID.randomUUID();
        MigrationStorySpecGenerationEntity own = baseRow(ownWorkItem)
            .projectId(PROJECT_ID)
            .manuallyEdited(Boolean.TRUE)
            .lastManuallyEditedBy("alice@example.com")
            .build();
        // Same book id (simulates a corrupted state / cross-tenant residue);
        // belongs to a DIFFERENT project. Must be dropped silently.
        MigrationStorySpecGenerationEntity other = baseRow(otherWorkItem)
            .projectId(OTHER_PROJECT_ID)
            .manuallyEdited(Boolean.TRUE)
            .lastManuallyEditedBy("eve@example.com")
            .build();
        when(repository.findByBookOfWorkIdOrderByCreatedAtAsc(BOOK_ID))
            .thenReturn(List.of(own, other));
        lenient().when(workItemRepository.findById(ownWorkItem))
            .thenReturn(Optional.of(workItem(ownWorkItem, "Owned story")));

        List<ManuallyEditedInScopeRow> rows =
            service.listManuallyEditedInScope(PROJECT_ID, BOOK_ID, null);

        assertThat(rows)
            .as("Cross-project rows are dropped silently; no ownership leakage.")
            .hasSize(1);
        assertThat(rows.get(0).workItemId()).isEqualTo(ownWorkItem);
        assertThat(rows.get(0).lastManuallyEditedBy()).isEqualTo("alice@example.com");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private MigrationStorySpecGenerationEntity.MigrationStorySpecGenerationEntityBuilder baseRow(UUID workItemId) {
        return MigrationStorySpecGenerationEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .workItemId(workItemId)
            .bookOfWorkId(BOOK_ID)
            .status(MigrationStorySpecGenerationStatus.GENERATED)
            .createdByTask(MigrationStorySpecGenerationService.GENERATOR_TASK_ID)
            .generationAttemptNumber(1)
            .createdAt(Instant.parse("2026-05-19T10:00:00Z"))
            .updatedAt(Instant.parse("2026-05-20T10:00:00Z"));
    }

    private WorkItemEntity workItem(UUID id, String title) {
        return WorkItemEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .type("STORY")
            .title(title)
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }
}
