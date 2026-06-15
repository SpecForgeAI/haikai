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
import com.example.architecturemodel.util.ShapeSpecHeadingParser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.HashMap;
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
 * Focused JUnit tests for the spec-emit-time
 * {@code populateMissingInputKeys(...)} hook in
 * {@link MigrationStorySpecGenerationService}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 3.4.</p>
 *
 * <p>Two tests covering the hook contract:</p>
 * <ol>
 *   <li>{@link #persistOne_populatesMissingInputKeysFromStructuredEntries} --
 *       on an {@code insufficient_context} persist, the hook hashes each v1-
 *       type entry in {@code missing_inputs_json} and writes the resulting
 *       16-hex-char keys to {@code missing_input_keys_json}.</li>
 *   <li>{@link #persistOne_outOfV1EntriesProduceNoKey} -- entries with an out-
 *       of-v1 type (e.g. {@code decision}) NEVER produce a key entry.</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class MigrationStorySpecGenerationServiceMissingInputKeysTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID BOOK_ID = UUID.randomUUID();

    @Mock private MigrationStorySpecGenerationRepository repository;
    @Mock private GeneratedMigrationBookOfWorkRepository bookOfWorkRepository;
    @Mock private WorkItemRepository workItemRepository;

    private MigrationStorySpecGenerationService service;
    private MissingInputKeyHasher hasher;

    @BeforeEach
    void setUp() {
        hasher = new MissingInputKeyHasher();
        service = new MigrationStorySpecGenerationService(
            repository, bookOfWorkRepository, workItemRepository,
            new ShapeSpecHeadingParser(),
            hasher);
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

    @Test
    @DisplayName("persistOne hashes each v1-type missing-input entry into missing_input_keys_json")
    void persistOne_populatesMissingInputKeysFromStructuredEntries() {
        UUID workItemId = UUID.randomUUID();
        lenient().when(workItemRepository.findByIdAndProjectId(workItemId, PROJECT_ID))
            .thenReturn(Optional.of(workItem(workItemId)));
        lenient().when(repository.findByWorkItemId(workItemId)).thenReturn(List.of());

        // Three v1-type missing inputs: one api_contract, one mapping, one
        // target_element. The hook must hash all three.
        Map<String, Object> apiContractEntry = new HashMap<>();
        apiContractEntry.put("type", "api_contract");
        apiContractEntry.put("service", "PaymentsService");
        apiContractEntry.put("operation", "createPayment");
        apiContractEntry.put("description", "human-readable");

        Map<String, Object> mappingEntry = new HashMap<>();
        mappingEntry.put("type", "mapping");
        mappingEntry.put("sourceElementId", "src-elem-1");
        mappingEntry.put("targetElementId", "tgt-elem-1");

        Map<String, Object> targetElementEntry = new HashMap<>();
        targetElementEntry.put("type", "target_element");
        targetElementEntry.put("logicalName", "OrderService");

        MigrationStorySpecGenerationDto dto = new MigrationStorySpecGenerationDto(
            null, PROJECT_ID, workItemId, BOOK_ID, "bi-1",
            MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT,
            null, null, null, null,
            List.of(apiContractEntry, mappingEntry, targetElementEntry),
            null, null, null, null,
            0, null, null, null);

        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        BatchPersistResult result = service.persistBatchResults(
            PROJECT_ID, BOOK_ID, List.of(dto));

        assertThat(result.persistedCount()).isEqualTo(1);
        MigrationStorySpecGenerationEntity saved = cap.getValue();

        // Expected keys -- computed from the canonical descriptors via the
        // same hasher.
        String expectedApiKey = hasher.computeKey(
            "api_contract",
            hasher.canonicalDescriptorForApiContract("PaymentsService", "createPayment"));
        String expectedMappingKey = hasher.computeKey(
            "mapping",
            hasher.canonicalDescriptorForMapping("src-elem-1", "tgt-elem-1"));
        String expectedTargetKey = hasher.computeKey(
            "target_element",
            hasher.canonicalDescriptorForArchElement("OrderService"));

        assertThat(saved.getMissingInputKeysJson())
            .as("All three v1-type entries hashed into missing_input_keys_json")
            .containsExactly(expectedApiKey, expectedMappingKey, expectedTargetKey);
        // Sanity: 16-hex chars apiece.
        assertThat(saved.getMissingInputKeysJson()).allSatisfy(k ->
            assertThat(k).hasSize(16).matches("[0-9a-f]{16}"));
        // The unhashed JSON is preserved for the UI.
        assertThat(saved.getMissingInputsJson()).hasSize(3);
    }

    @Test
    @DisplayName("persistOne ignores out-of-v1 missing-input entries (no key produced)")
    void persistOne_outOfV1EntriesProduceNoKey() {
        UUID workItemId = UUID.randomUUID();
        lenient().when(workItemRepository.findByIdAndProjectId(workItemId, PROJECT_ID))
            .thenReturn(Optional.of(workItem(workItemId)));
        lenient().when(repository.findByWorkItemId(workItemId)).thenReturn(List.of());

        // One v1-type (api_contract) and one out-of-v1 (decision). The
        // out-of-v1 entry must NOT produce a key.
        Map<String, Object> v1Entry = new HashMap<>();
        v1Entry.put("type", "api_contract");
        v1Entry.put("service", "PaymentsService");
        v1Entry.put("operation", "createPayment");

        Map<String, Object> outOfV1Entry = new HashMap<>();
        outOfV1Entry.put("type", "decision");
        outOfV1Entry.put("topic", "Should we use SQS or Kinesis?");

        MigrationStorySpecGenerationDto dto = new MigrationStorySpecGenerationDto(
            null, PROJECT_ID, workItemId, BOOK_ID, "bi-1",
            MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT,
            null, null, null, null,
            List.of(v1Entry, outOfV1Entry),
            null, null, null, null,
            0, null, null, null);

        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        BatchPersistResult result = service.persistBatchResults(
            PROJECT_ID, BOOK_ID, List.of(dto));
        assertThat(result.persistedCount()).isEqualTo(1);
        MigrationStorySpecGenerationEntity saved = cap.getValue();

        // ONLY the v1 entry produced a key.
        assertThat(saved.getMissingInputKeysJson()).hasSize(1);
        String expectedApiKey = hasher.computeKey(
            "api_contract",
            hasher.canonicalDescriptorForApiContract("PaymentsService", "createPayment"));
        assertThat(saved.getMissingInputKeysJson()).containsExactly(expectedApiKey);
        // Both items still surface in the unhashed JSON (the UI renders the
        // out-of-v1 row read-only).
        assertThat(saved.getMissingInputsJson()).hasSize(2);
    }

    // -------- helper --------

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
}
