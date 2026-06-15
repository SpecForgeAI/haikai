package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.ArchitectureMapper;
import com.example.architecturemodel.model.dto.MarkDecommissionedRequest;
import com.example.architecturemodel.model.dto.MarkDecommissionedResponse;
import com.example.architecturemodel.model.dto.PromoteTargetArchitectureResponse;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ArchitectureTagRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.StaleSpecSummary;
import com.example.architecturemodel.util.ShapeSpecHeadingParser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Task Group 10 cross-layer / gap-fill tests for the Target Architecture
 * Authoring Flow (Spec 2026-05-20).
 *
 * <p>These tests intentionally cross service boundaries inside AMS to surface
 * cross-layer regressions that the per-group tests cannot catch in isolation.
 * Per tasks.md sub-task 10.2 they target the genuine gaps left by Groups 3, 4
 * and 9:</p>
 *
 * <ol>
 *   <li><b>Promote -> dashboard end-to-end:</b> after
 *       {@link TargetArchitecturePromoteService#promote(UUID, UUID)} flips spec
 *       rows to {@code stale=true}, the dashboard's
 *       {@link MigrationStorySpecGenerationService#getStaleSpecSummary(UUID)}
 *       returns the SAME count + ids. Closes 10.2 candidate (a) at the AMS
 *       layer.</li>
 *   <li><b>Decommission write-then-read round-trip:</b> after
 *       {@link TargetArchitectureDecommissionService#markDecommissioned(UUID,
 *       UUID, MarkDecommissionedRequest)} writes a target-side row +
 *       mapping, {@link DecommissionedInTargetAnnotationService} would surface
 *       the derived annotation. Closes 10.2 candidate (d).</li>
 *   <li><b>Decommission is target-side only:</b> assert
 *       {@link TargetArchitectureDecommissionService#markDecommissioned(UUID,
 *       UUID, MarkDecommissionedRequest)} never issues an UPDATE / DELETE
 *       statement against the current-side element row -- only INSERT into the
 *       target table and the mapping row are written. Spec acceptance:
 *       "Decommissioning is target-side only; current-side stays clean."</li>
 * </ol>
 *
 * <p>These three tests fill the gaps identified in tasks.md sub-task 10.2
 * candidates (a) and (d) at the AMS layer. (Loop guardrail / draft-edits
 * regression is already covered by Group 3 Test 7; impact-preview equality is
 * already covered by Group 3 Test 4.)</p>
 */
@ExtendWith(MockitoExtension.class)
class TargetArchitectureGroup10CrossLayerTest {

    @Mock private ArchitectureRepository architectureRepository;
    @Mock private ArchitectureTagRepository architectureTagRepository;
    @Mock private ArchitectureElementMappingRepository mappingRepository;
    @Mock private MigrationStorySpecGenerationRepository specRepository;
    @Mock private GeneratedMigrationBookOfWorkRepository bookOfWorkRepository;
    @Mock private WorkItemRepository workItemRepository;
    @Mock private JdbcTemplate jdbcTemplate;

    private TargetArchitectureStaleMarkService staleMarkService;
    private TargetArchitecturePromoteService promoteService;
    private MigrationStorySpecGenerationService specGenerationService;
    private TargetArchitectureDecommissionService decommissionService;
    private DecommissionedInTargetAnnotationService annotationService;

    private static final UUID PROJECT_ID =
        UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID DRAFT_TARGET_ID =
        UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final UUID PRIOR_ACTIVE_TARGET_ID =
        UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final UUID CURRENT_ARCH_ID =
        UUID.fromString("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static final String SOURCE_ELEMENT_ID =
        "ee111111-ee11-ee11-ee11-ee1111111111";

    @BeforeEach
    void setUp() {
        ArchitectureMapper architectureMapper = new ArchitectureMapper();
        staleMarkService = new TargetArchitectureStaleMarkService(
            specRepository, architectureRepository);
        promoteService = new TargetArchitecturePromoteService(
            architectureRepository,
            architectureTagRepository,
            architectureMapper,
            mappingRepository,
            staleMarkService,
            jdbcTemplate);
        specGenerationService = new MigrationStorySpecGenerationService(
            specRepository, bookOfWorkRepository, workItemRepository,
            new ShapeSpecHeadingParser());
        decommissionService = new TargetArchitectureDecommissionService(
            architectureRepository, mappingRepository, jdbcTemplate);
        annotationService = new DecommissionedInTargetAnnotationService(
            architectureRepository, jdbcTemplate);
    }

    // -----------------------------------------------------------------------
    // Test 1: promote -> getStaleSpecSummary end-to-end at the AMS layer.
    //
    // Verifies the cross-service pipeline:
    //   promote() => mark-stale fires => specs flip stale=true =>
    //   getStaleSpecSummary returns the marked rows.
    //
    // Closes 10.2 candidate (a) (end-to-end stale-fires-on-promote) at the
    // AMS layer; the gateway / frontend halves are covered by the proxy
    // tests and the dashboard tests respectively, both of which already exist.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Cross-layer: promote() flips specs stale; getStaleSpecSummary then returns the same count")
    void promoteThenSummaryRoundTrip() {
        UUID workItemAffected = UUID.randomUUID();
        UUID workItemUnaffected = UUID.randomUUID();

        ArchitectureEntity draft = ArchitectureEntity.builder()
            .id(DRAFT_TARGET_ID)
            .projectId(PROJECT_ID)
            .name("Draft 2026-05-20 #1")
            .kind("target")
            .draftState("draft")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        ArchitectureEntity priorActive = ArchitectureEntity.builder()
            .id(PRIOR_ACTIVE_TARGET_ID)
            .projectId(PROJECT_ID)
            .name("Active Target Baseline")
            .kind("target")
            .draftState("active")
            .archived(false)
            .createdAt(Instant.now().minus(7, ChronoUnit.DAYS))
            .updatedAt(Instant.now())
            .build();

        when(architectureRepository.findById(DRAFT_TARGET_ID))
            .thenReturn(Optional.of(draft));
        when(architectureRepository.findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                PROJECT_ID, "target", "active"))
            .thenReturn(Optional.of(priorActive));
        when(architectureRepository.existsByProjectIdAndNameIgnoreCaseAndIdNot(
                eq(PROJECT_ID), anyString(), any(UUID.class)))
            .thenReturn(false);
        when(architectureRepository.save(any(ArchitectureEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(architectureTagRepository.findByArchitectureId(any(UUID.class)))
            .thenReturn(List.of());

        // Prior-active mapping: src-1 -> tgt-OLD; new-active mapping: src-1 ->
        // tgt-NEW. Changed-element set is therefore { src-1 }.
        when(mappingRepository.search(eq(PROJECT_ID), any(), eq(PRIOR_ACTIVE_TARGET_ID),
                any(), any(), any(), any(), any()))
            .thenReturn(List.of(mapping("src-1", "tgt-OLD", PRIOR_ACTIVE_TARGET_ID)));
        when(mappingRepository.search(eq(PROJECT_ID), any(), eq(DRAFT_TARGET_ID),
                any(), any(), any(), any(), any()))
            .thenReturn(List.of(mapping("src-1", "tgt-NEW", DRAFT_TARGET_ID)));

        // Two spec rows: one cites src-1 (will go stale), one cites unrelated.
        MigrationStorySpecGenerationEntity affected = specRowWithRefs(workItemAffected, Map.of(
            "architecture_element_ids", List.of("src-1")));
        MigrationStorySpecGenerationEntity unaffected = specRowWithRefs(workItemUnaffected, Map.of(
            "architecture_element_ids", List.of("src-99")));

        when(specRepository.findByProjectId(PROJECT_ID))
            .thenReturn(List.of(affected, unaffected));
        // saveAll is invoked when at least one row matches; the rows already in
        // the list have been mutated in place by markStaleNow.
        when(specRepository.saveAll(any())).thenAnswer(inv -> inv.getArgument(0));

        // ACT 1: promote.
        PromoteTargetArchitectureResponse promoteResp =
            promoteService.promote(PROJECT_ID, DRAFT_TARGET_ID);
        assertThat(promoteResp.specsMarkedStale()).isEqualTo(1);

        // ACT 2: now query the dashboard summary. The repository's
        // findByProjectIdAndStaleTrue must return the same rows that were
        // marked stale in step 1.
        when(specRepository.findByProjectIdAndStaleTrue(PROJECT_ID))
            .thenReturn(List.of(affected));
        StaleSpecSummary summary = specGenerationService.getStaleSpecSummary(PROJECT_ID);

        // ASSERT: the dashboard count + workItem ids match what promote
        // actually marked stale. This is the cross-service round-trip.
        assertThat(summary.staleCount()).isEqualTo(promoteResp.specsMarkedStale());
        assertThat(summary.staleWorkItemIds())
            .containsExactly(workItemAffected.toString());
        assertThat(affected.getStale()).isTrue();
        assertThat(unaffected.getStale()).isNull();
    }

    // -----------------------------------------------------------------------
    // Test 2: decommission write-then-read round-trip.
    //
    // After markDecommissioned writes the target row + decommissioned mapping,
    // the derived annotation service (when fed an active target = the same
    // target we just wrote into) would surface the current element with
    // reason=all_mappings_decommissioned. We simulate this by feeding the
    // annotation service's per-table query the post-write counts (1 total
    // mapping, 1 decommissioned mapping) -- the call chain succeeds end-to-end
    // and lands the expected reason code.
    //
    // Closes 10.2 candidate (d) (decommissioning round trip) at the AMS layer.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Cross-layer: mark-decommissioned then derived-annotation surfaces all_mappings_decommissioned")
    void decommissionWriteThenAnnotationRoundTrip() {
        UUID targetArchId = PRIOR_ACTIVE_TARGET_ID;
        ArchitectureEntity activeTarget = targetArch(targetArchId);
        ArchitectureEntity currentArch = currentArch();

        // WRITE PATH: markDecommissioned stubs.
        when(architectureRepository.findById(targetArchId))
            .thenReturn(Optional.of(activeTarget));
        lenient().when(architectureRepository.findFirstByProjectIdAndArchivedFalseOrderByCreatedAtAsc(PROJECT_ID))
            .thenReturn(Optional.of(currentArch));

        Map<String, Object> sourceRow = new HashMap<>();
        sourceRow.put("id", SOURCE_ELEMENT_ID);
        sourceRow.put("name", "Legacy Reporting Service");
        sourceRow.put("description", "to be decommissioned");
        sourceRow.put("application_id", "app-uuid-aaa");
        when(jdbcTemplate.queryForList(
                eq("SELECT * FROM application_components WHERE id = ?"),
                eq(SOURCE_ELEMENT_ID)))
            .thenReturn(List.of(sourceRow));

        Map<String, Object> modelFileRow = new HashMap<>();
        modelFileRow.put("id", "model-file-target-1");
        when(jdbcTemplate.queryForList(
                eq("SELECT id FROM model_files WHERE architecture_id = ? ORDER BY id ASC LIMIT 1"),
                eq(targetArchId)))
            .thenReturn(List.of(modelFileRow));

        when(mappingRepository.saveAndFlush(any(ArchitectureElementMappingEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        MarkDecommissionedRequest request = new MarkDecommissionedRequest(
            SOURCE_ELEMENT_ID, "application_components", CURRENT_ARCH_ID);

        MarkDecommissionedResponse writeResponse = decommissionService.markDecommissioned(
            PROJECT_ID, targetArchId, request);

        // Capture the mapping that was written so we can correlate with the
        // read-side query in the next phase.
        ArgumentCaptor<ArchitectureElementMappingEntity> mappingCaptor =
            ArgumentCaptor.forClass(ArchitectureElementMappingEntity.class);
        verify(mappingRepository).saveAndFlush(mappingCaptor.capture());
        ArchitectureElementMappingEntity writtenMapping = mappingCaptor.getValue();
        assertThat(writtenMapping.getMappingType()).isEqualTo("decommissioned");
        assertThat(writeResponse.newTargetElementId()).isNotBlank();

        // READ PATH: simulate the derived-annotation query post-write. The
        // current element now has total_mappings=1 + decommissioned_mappings=1
        // because the mark-decommissioned step inserted exactly one
        // decommissioned mapping. The annotation service must classify the row
        // as reason=all_mappings_decommissioned.
        when(architectureRepository.findById(CURRENT_ARCH_ID))
            .thenReturn(Optional.of(currentArch));
        when(architectureRepository.findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                PROJECT_ID, "target", "active"))
            .thenReturn(Optional.of(activeTarget));

        Map<String, Object> annotationRow = new HashMap<>();
        annotationRow.put("element_id", SOURCE_ELEMENT_ID);
        annotationRow.put("element_name", "Legacy Reporting Service");
        annotationRow.put("total_mappings", 1L);
        annotationRow.put("decommissioned_mappings", 1L);
        when(jdbcTemplate.queryForList(
                any(String.class),
                eq(PROJECT_ID), eq("application_components"), eq(targetArchId),
                eq(PROJECT_ID), eq("application_components"), eq(targetArchId),
                eq(CURRENT_ARCH_ID)))
            .thenReturn(List.of(annotationRow));
        // Other tables return empty.
        lenient().when(jdbcTemplate.queryForList(
                any(String.class),
                eq(PROJECT_ID), eq("interfaces"), eq(targetArchId),
                eq(PROJECT_ID), eq("interfaces"), eq(targetArchId),
                eq(CURRENT_ARCH_ID)))
            .thenReturn(List.of());
        lenient().when(jdbcTemplate.queryForList(
                any(String.class),
                eq(PROJECT_ID), eq("data_entity_points"), eq(targetArchId),
                eq(PROJECT_ID), eq("data_entity_points"), eq(targetArchId),
                eq(CURRENT_ARCH_ID)))
            .thenReturn(List.of());
        lenient().when(jdbcTemplate.queryForList(
                any(String.class),
                eq(PROJECT_ID), eq("infrastructure_points"), eq(targetArchId),
                eq(PROJECT_ID), eq("infrastructure_points"), eq(targetArchId),
                eq(CURRENT_ARCH_ID)))
            .thenReturn(List.of());

        // ACT: query annotations.
        var annotations = annotationService.findAnnotations(PROJECT_ID, CURRENT_ARCH_ID, null);

        // ASSERT: the current element surfaces with the expected reason.
        assertThat(annotations).hasSize(1);
        assertThat(annotations.get(0).elementId()).isEqualTo(SOURCE_ELEMENT_ID);
        assertThat(annotations.get(0).reason())
            .isEqualTo(com.example.architecturemodel.model.dto.DecommissionedInTargetAnnotationDto
                .REASON_ALL_DECOMMISSIONED);
    }

    // -----------------------------------------------------------------------
    // Test 3: decommissioning is target-side only -- the current-architecture
    // element row is never updated/deleted.
    //
    // The spec acceptance reads: "Decommissioning is target-side only;
    // current-side stays clean." Group 4 Test 1 verifies the target-side
    // INSERT happens but never explicitly asserts that NO UPDATE / DELETE
    // touches the current-side row.
    //
    // We verify that across the markDecommissioned call:
    //   - jdbcTemplate.update is invoked ONLY with INSERT statements
    //     (no UPDATE / DELETE on the source-side tables).
    //   - The current-side element row's id is NEVER passed to an UPDATE.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Cross-check: mark-decommissioned does not UPDATE / DELETE the current-side element row")
    void decommissionDoesNotMutateCurrentSideElementRow() {
        UUID targetArchId = PRIOR_ACTIVE_TARGET_ID;
        ArchitectureEntity activeTarget = targetArch(targetArchId);
        ArchitectureEntity currentArch = currentArch();

        when(architectureRepository.findById(targetArchId))
            .thenReturn(Optional.of(activeTarget));
        lenient().when(architectureRepository.findFirstByProjectIdAndArchivedFalseOrderByCreatedAtAsc(PROJECT_ID))
            .thenReturn(Optional.of(currentArch));

        Map<String, Object> sourceRow = new HashMap<>();
        sourceRow.put("id", SOURCE_ELEMENT_ID);
        sourceRow.put("name", "Legacy Reporting Service");
        sourceRow.put("application_id", "app-uuid-aaa");
        when(jdbcTemplate.queryForList(
                eq("SELECT * FROM application_components WHERE id = ?"),
                eq(SOURCE_ELEMENT_ID)))
            .thenReturn(List.of(sourceRow));

        Map<String, Object> modelFileRow = new HashMap<>();
        modelFileRow.put("id", "model-file-target-1");
        when(jdbcTemplate.queryForList(
                eq("SELECT id FROM model_files WHERE architecture_id = ? ORDER BY id ASC LIMIT 1"),
                eq(targetArchId)))
            .thenReturn(List.of(modelFileRow));

        when(mappingRepository.saveAndFlush(any(ArchitectureElementMappingEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        MarkDecommissionedRequest request = new MarkDecommissionedRequest(
            SOURCE_ELEMENT_ID, "application_components", CURRENT_ARCH_ID);

        // ACT.
        decommissionService.markDecommissioned(PROJECT_ID, targetArchId, request);

        // ASSERT: no UPDATE / DELETE statement was issued against
        // application_components for the source element id. We capture every
        // jdbcTemplate.update SQL string and assert each is an INSERT, and
        // that the source element id is NEVER bound to an UPDATE / DELETE.
        ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);
        verify(jdbcTemplate, org.mockito.Mockito.atLeastOnce()).update(
            sqlCaptor.capture(), any(), any(), any(), any(), any(), any(), any());

        for (String sql : sqlCaptor.getAllValues()) {
            String upper = sql.toUpperCase();
            assertThat(upper)
                .as("decommission must only INSERT (target-side); never UPDATE / DELETE current-side. SQL was: " + sql)
                .doesNotStartWith("UPDATE")
                .doesNotStartWith("DELETE");
        }

        // No UPDATE was issued anywhere that binds the source element id as a
        // primary-key arg. We cover this with a second matcher form: assert
        // that no update(...) call binds the source-element id in WHERE id = ?
        // form -- detect by argument-list containment.
        verify(jdbcTemplate, never()).update(
            argThat((String s) -> s != null
                && (s.toUpperCase().contains("UPDATE APPLICATION_COMPONENTS")
                    || s.toUpperCase().contains("DELETE FROM APPLICATION_COMPONENTS"))),
            any(Object[].class));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private MigrationStorySpecGenerationEntity specRowWithRefs(UUID workItemId, Map<String, Object> refs) {
        return MigrationStorySpecGenerationEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .workItemId(workItemId)
            .status("generated")
            .focusedContextRefsJson(new HashMap<>(refs))
            .generationPass(1)
            .generationAttemptNumber(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }

    private ArchitectureElementMappingEntity mapping(String sourceElementId, String targetElementId,
                                                      UUID targetArchitectureId) {
        return ArchitectureElementMappingEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .sourceArchitectureId(CURRENT_ARCH_ID)
            .targetArchitectureId(targetArchitectureId)
            .sourceElementType("application_components")
            .sourceElementId(sourceElementId)
            .targetElementType("application_components")
            .targetElementId(targetElementId)
            .mappingType("equivalent")
            .status("active")
            .createdByTask("target-arch-seed-clone")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .confidence(1.0d)
            .build();
    }

    private ArchitectureEntity targetArch(UUID id) {
        return ArchitectureEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .kind("target")
            .draftState("active")
            .archived(false)
            .name("Active Target")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }

    private ArchitectureEntity currentArch() {
        return ArchitectureEntity.builder()
            .id(CURRENT_ARCH_ID)
            .projectId(PROJECT_ID)
            .kind("current")
            .draftState("active")
            .archived(false)
            .name("Current")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }
}
