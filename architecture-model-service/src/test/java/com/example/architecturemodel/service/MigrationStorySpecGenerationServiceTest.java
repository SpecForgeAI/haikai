package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
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
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.ManualEditProtectedException;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.SpecGenerationSummary;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.UpdateRowRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Service-level tests for {@link MigrationStorySpecGenerationService}.
 *
 * <p>Covers Group 8 acceptance signals (4 cases from spec.md "Tests - AMS"
 * extended to the 8-10 case range called out in the Group 8 task brief):</p>
 * <ol>
 *   <li>Persist a batch of 3 results: persisted count = 3.</li>
 *   <li>One bad row in the batch: per-row diagnostics + persistedCount = 2.</li>
 *   <li>List by book of work returns all rows for that book.</li>
 *   <li>List by WorkItem returns rows ordered by attempt number ascending.</li>
 *   <li>updateRow with confirmOverwrite=false on manually-edited row -> 409.</li>
 *   <li>updateRow with confirmOverwrite=true succeeds.</li>
 *   <li>getSummary counts + nextBatchStart computation (lazy not_attempted).</li>
 *   <li>404 when book / project / work-item not found.</li>
 * </ol>
 *
 * <p>Uses Mockito repository mocks -- mirrors the standalone-JUnit pattern used
 * by {@code MigrationDiscoveryContextServiceTest} and Spec 1's
 * service-test pattern.</p>
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 8.</p>
 */
@ExtendWith(MockitoExtension.class)
class MigrationStorySpecGenerationServiceTest {

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

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private GeneratedMigrationBookOfWorkEntity buildBook(List<Map<String, Object>> items) {
        GeneratedMigrationBookOfWorkEntity e = new GeneratedMigrationBookOfWorkEntity();
        e.setId(BOOK_ID);
        e.setProjectId(PROJECT_ID);
        e.setStatus("draft");
        Map<String, Object> blob = new LinkedHashMap<>();
        blob.put("items", items);
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

    private void stubBook(GeneratedMigrationBookOfWorkEntity book) {
        lenient().when(bookOfWorkRepository.findById(BOOK_ID)).thenReturn(Optional.of(book));
    }

    private void stubWorkItem(UUID id) {
        lenient().when(workItemRepository.findByIdAndProjectId(id, PROJECT_ID))
            .thenReturn(Optional.of(workItem(id)));
    }

    private MigrationStorySpecGenerationDto dto(UUID workItemId, String status) {
        return new MigrationStorySpecGenerationDto(
            null, PROJECT_ID, workItemId, BOOK_ID, "bi-" + workItemId,
            status,
            MigrationStorySpecGenerationConfidence.HIGH,
            "high",
            status.startsWith("generated") ? "/agent-os:shape-spec foo" : null,
            null, null, null, null,
            null, null,
            0, null, null, null
        );
    }

    private MigrationStorySpecGenerationEntity ent(
        UUID id, UUID workItemId, UUID bookId, String status, String createdByTask) {
        Instant now = Instant.now();
        return MigrationStorySpecGenerationEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .workItemId(workItemId)
            .bookOfWorkId(bookId)
            .bookItemId("bi-" + workItemId)
            .status(status)
            .confidence(MigrationStorySpecGenerationConfidence.MEDIUM)
            .generationAttemptNumber(1)
            .createdByTask(createdByTask != null
                ? createdByTask
                : MigrationStorySpecGenerationService.GENERATOR_TASK_ID)
            .createdAt(now)
            .updatedAt(now)
            .build();
    }

    // -----------------------------------------------------------------------
    // Tests
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Persist a batch of 3 results: persistedCount=3, no row errors")
    void persistBatchAllSucceed() {
        stubBook(buildBook(List.of()));
        UUID w1 = UUID.randomUUID(), w2 = UUID.randomUUID(), w3 = UUID.randomUUID();
        stubWorkItem(w1); stubWorkItem(w2); stubWorkItem(w3);
        when(repository.findByWorkItemId(any())).thenReturn(List.of());
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        BatchPersistResult result = service.persistBatchResults(
            PROJECT_ID, BOOK_ID,
            List.of(
                dto(w1, MigrationStorySpecGenerationStatus.GENERATED),
                dto(w2, MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS),
                dto(w3, MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT)));

        assertThat(result.persistedCount()).isEqualTo(3);
        assertThat(result.resultsCouldNotPersist()).isEqualTo(0);
        assertThat(result.errors()).isEmpty();
        assertThat(result.perStoryResults()).hasSize(3);
    }

    @Test
    @DisplayName("One bad row in batch: persistedCount=2, resultsCouldNotPersist=1, error captured")
    void persistBatchPartialFailure() {
        stubBook(buildBook(List.of()));
        UUID w1 = UUID.randomUUID(), w2 = UUID.randomUUID();
        stubWorkItem(w1); stubWorkItem(w2);
        when(repository.findByWorkItemId(any())).thenReturn(List.of());
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        // Build a dto with an invalid status
        MigrationStorySpecGenerationDto bad = new MigrationStorySpecGenerationDto(
            null, PROJECT_ID, w2, BOOK_ID, null,
            "definitely_not_a_real_status",
            null, null, null, null, null, null, null, null, null,
            0, null, null, null);

        BatchPersistResult result = service.persistBatchResults(
            PROJECT_ID, BOOK_ID,
            List.of(
                dto(w1, MigrationStorySpecGenerationStatus.GENERATED),
                bad));

        assertThat(result.persistedCount()).isEqualTo(1);
        assertThat(result.resultsCouldNotPersist()).isEqualTo(1);
        assertThat(result.errors()).hasSize(1);
        assertThat(result.errors().get(0).workItemId()).isEqualTo(w2.toString());
        assertThat(result.errors().get(0).errorMessage()).contains("Invalid status");
    }

    @Test
    @DisplayName("listByBookOfWork returns rows for the book")
    void listByBookOfWorkFilters() {
        stubBook(buildBook(List.of()));
        UUID w1 = UUID.randomUUID(), w2 = UUID.randomUUID();
        when(repository.findByBookOfWorkIdOrderByCreatedAtAsc(BOOK_ID))
            .thenReturn(List.of(
                ent(UUID.randomUUID(), w1, BOOK_ID,
                    MigrationStorySpecGenerationStatus.GENERATED, null),
                ent(UUID.randomUUID(), w2, BOOK_ID,
                    MigrationStorySpecGenerationStatus.FAILED, null)));

        List<MigrationStorySpecGenerationDto> rows = service.listByBookOfWork(PROJECT_ID, BOOK_ID);

        assertThat(rows).hasSize(2);
        assertThat(rows).extracting(MigrationStorySpecGenerationDto::status)
            .contains(MigrationStorySpecGenerationStatus.GENERATED,
                      MigrationStorySpecGenerationStatus.FAILED);
    }

    @Test
    @DisplayName("listByWorkItem orders by generation_attempt_number ascending")
    void listByWorkItemOrdersByAttemptNumber() {
        UUID w1 = UUID.randomUUID();
        stubWorkItem(w1);

        MigrationStorySpecGenerationEntity a1 = ent(UUID.randomUUID(), w1, BOOK_ID,
            MigrationStorySpecGenerationStatus.FAILED, null);
        a1.setGenerationAttemptNumber(2);
        MigrationStorySpecGenerationEntity a2 = ent(UUID.randomUUID(), w1, BOOK_ID,
            MigrationStorySpecGenerationStatus.GENERATED, null);
        a2.setGenerationAttemptNumber(1);
        MigrationStorySpecGenerationEntity a3 = ent(UUID.randomUUID(), w1, BOOK_ID,
            MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS, null);
        a3.setGenerationAttemptNumber(3);
        when(repository.findByWorkItemId(w1)).thenReturn(List.of(a1, a2, a3));

        List<MigrationStorySpecGenerationDto> rows = service.listByWorkItem(PROJECT_ID, w1);

        assertThat(rows).hasSize(3);
        assertThat(rows).extracting(MigrationStorySpecGenerationDto::generationAttemptNumber)
            .containsExactly(1, 2, 3);
    }

    @Test
    @DisplayName("updateRow with confirmOverwrite=false on manually-edited row returns 409 (ManualEditProtectedException)")
    void updateRowManualEditProtected() {
        UUID generationId = UUID.randomUUID();
        UUID w1 = UUID.randomUUID();
        MigrationStorySpecGenerationEntity manuallyEdited = ent(
            generationId, w1, BOOK_ID,
            MigrationStorySpecGenerationStatus.GENERATED,
            "user-manual-edit-task");                // not the generator task
        when(repository.findById(generationId)).thenReturn(Optional.of(manuallyEdited));

        UpdateRowRequest req = new UpdateRowRequest(
            dto(w1, MigrationStorySpecGenerationStatus.GENERATED),
            null /* confirmOverwrite */);

        assertThatThrownBy(() -> service.updateRow(PROJECT_ID, generationId, req))
            .isInstanceOf(ManualEditProtectedException.class);
    }

    @Test
    @DisplayName("updateRow with confirmOverwrite=true succeeds on manually-edited row")
    void updateRowConfirmOverwriteSucceeds() {
        UUID generationId = UUID.randomUUID();
        UUID w1 = UUID.randomUUID();
        MigrationStorySpecGenerationEntity manuallyEdited = ent(
            generationId, w1, BOOK_ID,
            MigrationStorySpecGenerationStatus.GENERATED,
            "user-manual-edit-task");
        when(repository.findById(generationId)).thenReturn(Optional.of(manuallyEdited));
        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        UpdateRowRequest req = new UpdateRowRequest(
            dto(w1, MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS),
            Boolean.TRUE);

        MigrationStorySpecGenerationDto out = service.updateRow(PROJECT_ID, generationId, req);

        assertThat(out.status())
            .isEqualTo(MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS);
        assertThat(cap.getValue().getCreatedByTask())
            .isEqualTo(MigrationStorySpecGenerationService.GENERATOR_TASK_ID);
    }

    @Test
    @DisplayName("getSummary computes counts correctly + notAttempted = totalSavedStories - attempted")
    void summaryComputesLazyNotAttempted() {
        // Build a BoW with 5 saved stories and 2 unsaved (not counted).
        List<Map<String, Object>> items = new ArrayList<>();
        UUID s1 = UUID.randomUUID(), s2 = UUID.randomUUID(), s3 = UUID.randomUUID(),
            s4 = UUID.randomUUID(), s5 = UUID.randomUUID();
        for (int i = 0; i < 5; i++) {
            UUID wid = List.of(s1, s2, s3, s4, s5).get(i);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", "story-" + i);
            m.put("type", "story");
            m.put("saveState", "saved");
            m.put("workItemId", wid.toString());
            m.put("sequenceOrder", i);
            items.add(m);
        }
        // 1 unsaved story (should not count toward totalSavedStories).
        Map<String, Object> unsaved = new LinkedHashMap<>();
        unsaved.put("id", "story-99");
        unsaved.put("type", "story");
        items.add(unsaved);
        stubBook(buildBook(items));

        // 3 attempted rows (2 generated, 1 failed) -- notAttempted = 5 - 3 = 2.
        List<MigrationStorySpecGenerationEntity> rows = List.of(
            attempted(s1, MigrationStorySpecGenerationStatus.GENERATED),
            attempted(s2, MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS),
            attempted(s3, MigrationStorySpecGenerationStatus.FAILED));
        when(repository.findByBookOfWorkIdOrderByCreatedAtAsc(BOOK_ID)).thenReturn(rows);

        SpecGenerationSummary out = service.getSummary(PROJECT_ID, BOOK_ID);

        assertThat(out.totalStories()).isEqualTo(5);
        assertThat(out.attemptedCount()).isEqualTo(3);
        assertThat(out.generatedCount()).isEqualTo(1);
        assertThat(out.generatedWithWarningsCount()).isEqualTo(1);
        assertThat(out.failedCount()).isEqualTo(1);
        assertThat(out.notAttemptedCount()).isEqualTo(2);
        // First unattempted story's sequenceOrder is 3 (s1, s2, s3 attempted -> next is s4 at seq=3).
        assertThat(out.nextBatchStart()).isEqualTo(3);
        assertThat(out.nextBatchSize()).isEqualTo(2);
    }

    private MigrationStorySpecGenerationEntity attempted(UUID workItemId, String status) {
        return ent(UUID.randomUUID(), workItemId, BOOK_ID, status, null);
    }

    @Test
    @DisplayName("Unknown book of work returns 404")
    void unknownBookOfWork404() {
        when(bookOfWorkRepository.findById(BOOK_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getSummary(PROJECT_ID, BOOK_ID))
            .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.listByBookOfWork(PROJECT_ID, BOOK_ID))
            .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.persistBatchResults(PROJECT_ID, BOOK_ID, List.of()))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @DisplayName("Unknown WorkItem on listByWorkItem returns 404")
    void unknownWorkItem404() {
        UUID w1 = UUID.randomUUID();
        when(workItemRepository.findByIdAndProjectId(w1, PROJECT_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.listByWorkItem(PROJECT_ID, w1))
            .isInstanceOf(ResourceNotFoundException.class);
    }
}
