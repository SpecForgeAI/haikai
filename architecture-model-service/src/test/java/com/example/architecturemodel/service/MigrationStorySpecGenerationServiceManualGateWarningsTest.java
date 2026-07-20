package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.MigrationStorySpecGenerationDto;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkEntity;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Manual-gate heading-warning exemption (Phase 0, 2026-07-20).
 *
 * <p>Manual-gate specs (deterministic HUMAN/WIZARD procedure text, stamped
 * {@code focused_context_refs_json.source = 'code_plan_manual_gate'} by the
 * gateway code-carriage) intentionally omit the decisions / interfaces /
 * assumptions sections. The write-time {@link ShapeSpecHeadingParser} hook must
 * NOT append {@code parser_missing_heading} warnings for them — but must keep
 * doing so for ordinary specs.</p>
 */
@ExtendWith(MockitoExtension.class)
class MigrationStorySpecGenerationServiceManualGateWarningsTest {

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
            new ShapeSpecHeadingParser(),
            new MissingInputKeyHasher(),
            new SpecQualityScorer());
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

    private static final String MANUAL_GATE_SPEC = String.join("\n",
        "/agent-os:shape-spec Full-surface parity verification sweep",
        "",
        "## Manual-gate work item",
        "",
        "This story is HUMAN/WIZARD work — the execution driver never dispatches",
        "it to the implement-verify service.",
        "",
        "## Procedure",
        "",
        "Unscoped replay of the full baseline against the target.",
        "",
        "## Gate condition",
        "",
        "An UNSCOPED clean parity result over the full stream surface.");

    private MigrationStorySpecGenerationEntity persistAndCapture(
        MigrationStorySpecGenerationDto dto, UUID workItemId) {
        lenient().when(workItemRepository.findByIdAndProjectId(workItemId, PROJECT_ID))
            .thenReturn(Optional.of(WorkItemEntity.builder()
                .id(workItemId).projectId(PROJECT_ID).type("STORY")
                .title("Story").status("PLANNED").sortOrder(0)
                .createdAt(Instant.now()).updatedAt(Instant.now()).build()));
        lenient().when(repository.findByWorkItemId(workItemId)).thenReturn(List.of());
        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(repository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));
        service.persistBatchResults(PROJECT_ID, BOOK_ID, List.of(dto));
        return cap.getValue();
    }

    @Test
    @DisplayName("manual-gate spec (source=code_plan_manual_gate): NO parser_missing_heading warnings appended")
    void manualGateSpecSkipsMissingHeadingWarnings() {
        UUID workItemId = UUID.randomUUID();
        MigrationStorySpecGenerationDto dto = new MigrationStorySpecGenerationDto(
            null, PROJECT_ID, workItemId, BOOK_ID, "bi-gate",
            MigrationStorySpecGenerationStatus.GENERATED,
            "high", null, MANUAL_GATE_SPEC,
            null, null,
            Map.of("source", "code_plan_manual_gate"),
            null, null, null,
            1, null, null, null);

        MigrationStorySpecGenerationEntity saved = persistAndCapture(dto, workItemId);

        List<Map<String, Object>> warnings = saved.getWarningsJson();
        if (warnings != null) {
            assertThat(warnings)
                .as("manual-gate specs must NOT accumulate parser_missing_heading warnings")
                .noneMatch(w -> ShapeSpecHeadingParser.WARNING_KIND_MISSING_HEADING
                    .equals(w.get("kind")));
        }
    }

    @Test
    @DisplayName("ordinary spec WITHOUT the sections still gets the missing-heading warnings (exemption is manual-gate-only)")
    void ordinarySpecStillGetsMissingHeadingWarnings() {
        UUID workItemId = UUID.randomUUID();
        MigrationStorySpecGenerationDto dto = new MigrationStorySpecGenerationDto(
            null, PROJECT_ID, workItemId, BOOK_ID, "bi-ord",
            MigrationStorySpecGenerationStatus.GENERATED,
            "high", null, MANUAL_GATE_SPEC, // same heading-less text...
            null, null,
            Map.of("source", "focused_context"), // ...but NOT a manual gate
            null, null, null,
            1, null, null, null);

        MigrationStorySpecGenerationEntity saved = persistAndCapture(dto, workItemId);

        assertThat(saved.getWarningsJson())
            .as("ordinary specs keep the canonical missing-heading warnings")
            .isNotNull()
            .anyMatch(w -> ShapeSpecHeadingParser.WARNING_KIND_MISSING_HEADING
                .equals(w.get("kind")));
    }
}
