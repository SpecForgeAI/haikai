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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
 * Deterministic-carriage heading-warning exemption.
 *
 * <p>Phase 0 (2026-07-20) exempted manual-gate specs
 * ({@code focused_context_refs_json.source = 'code_plan_manual_gate'}) from
 * {@code parser_missing_heading} warnings. Widened 2026-08-30 to EVERY
 * deterministic carriage source — those specs are mechanically assembled from
 * committed facts / a pack / a confirmed manifest and intentionally omit the
 * decisions / interfaces / assumptions sections, so the warnings were
 * unactionable noise on nearly every spec of a deterministic book (and
 * diluted the warnings that DO matter). The allow-list stays OPT-IN: an
 * unknown source keeps the canonical warnings.</p>
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

    /** Heading-less deterministic-carriage text (no decisions/interfaces/assumptions). */
    private static final String CARRIAGE_SPEC = String.join("\n",
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

    private MigrationStorySpecGenerationDto dtoWithSource(UUID workItemId, String source) {
        return new MigrationStorySpecGenerationDto(
            null, PROJECT_ID, workItemId, BOOK_ID, "bi-gate",
            MigrationStorySpecGenerationStatus.GENERATED,
            "high", null, CARRIAGE_SPEC,
            null, null,
            Map.of("source", source),
            null, null, null,
            1, null, null, null);
    }

    private static boolean isMissingHeadingWarning(Map<String, Object> w) {
        return ShapeSpecHeadingParser.WARNING_KIND_MISSING_HEADING.equals(w.get("kind"));
    }

    @ParameterizedTest(name = "source={0}: NO parser_missing_heading warnings appended")
    @ValueSource(strings = {
        "code_plan_manual_gate",
        "committed_model_code_carriage",
        "committed_model_internal_carriage",
        "scl_spec_carriage",
        "db_migration_pack",
        "scaffold_bootstrap_carriage",
    })
    void deterministicCarriageSpecSkipsMissingHeadingWarnings(String source) {
        UUID workItemId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity saved =
            persistAndCapture(dtoWithSource(workItemId, source), workItemId);

        List<Map<String, Object>> warnings = saved.getWarningsJson();
        if (warnings != null) {
            assertThat(warnings)
                .as("deterministic-carriage specs must NOT accumulate parser_missing_heading")
                .noneMatch(MigrationStorySpecGenerationServiceManualGateWarningsTest
                    ::isMissingHeadingWarning);
        }
    }

    @Test
    @DisplayName("an UNKNOWN source is NOT exempt — the allow-list stays opt-in")
    void unknownSourceStillGetsMissingHeadingWarnings() {
        UUID workItemId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity saved = persistAndCapture(
            dtoWithSource(workItemId, "some_future_carriage_nobody_registered"), workItemId);

        assertThat(saved.getWarningsJson())
            .as("unknown sources keep the canonical missing-heading warnings")
            .isNotNull()
            .anyMatch(MigrationStorySpecGenerationServiceManualGateWarningsTest
                ::isMissingHeadingWarning);
    }

    @Test
    @DisplayName("ordinary spec WITHOUT the sections still gets the missing-heading warnings")
    void ordinarySpecStillGetsMissingHeadingWarnings() {
        UUID workItemId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity saved = persistAndCapture(
            dtoWithSource(workItemId, "focused_context"), workItemId);

        assertThat(saved.getWarningsJson())
            .as("ordinary specs keep the canonical missing-heading warnings")
            .isNotNull()
            .anyMatch(MigrationStorySpecGenerationServiceManualGateWarningsTest
                ::isMissingHeadingWarning);
    }

    @Test
    @DisplayName("a row with NO focused_context_refs at all keeps the warnings (null-safe, not exempt)")
    void missingRefsBlobIsNotExempt() {
        UUID workItemId = UUID.randomUUID();
        MigrationStorySpecGenerationDto dto = new MigrationStorySpecGenerationDto(
            null, PROJECT_ID, workItemId, BOOK_ID, "bi-gate",
            MigrationStorySpecGenerationStatus.GENERATED,
            "high", null, CARRIAGE_SPEC,
            null, null,
            null,
            null, null, null,
            1, null, null, null);

        MigrationStorySpecGenerationEntity saved = persistAndCapture(dto, workItemId);

        assertThat(saved.getWarningsJson())
            .isNotNull()
            .anyMatch(MigrationStorySpecGenerationServiceManualGateWarningsTest
                ::isMissingHeadingWarning);
    }
}
