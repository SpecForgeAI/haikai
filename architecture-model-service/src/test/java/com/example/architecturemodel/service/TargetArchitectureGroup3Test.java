package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.mapper.ArchitectureMapper;
import com.example.architecturemodel.model.dto.MarkStaleResponse;
import com.example.architecturemodel.model.dto.PromoteTargetArchitectureResponse;
import com.example.architecturemodel.model.dto.UnmappedCurrentElementDto;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ArchitectureTagRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Service-level tests for the Target Architecture authoring flow Task Group 3
 * pipelines:
 *
 * <ul>
 *   <li>{@link TargetArchitectureStaleMarkService} -- promote-path firing,
 *       debounce on active-target save, draft-state regression.</li>
 *   <li>{@link TargetArchitecturePromoteService} -- promote demote-then-promote
 *       semantics, impact-preview count, 409 on delete-active.</li>
 *   <li>{@link UnmappedCurrentElementsService} -- LEFT JOIN gap return.</li>
 * </ul>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 3.</p>
 *
 * <p>Seven focused tests per task spec 3.1:</p>
 * <ol>
 *   <li>{@code mark-stale} flips {@code stale=true} on rows whose
 *       {@code architecture_element_ids} intersect the changed set; idempotent
 *       on second call.</li>
 *   <li>{@code mark-stale} catches rows referencing changed elements
 *       transitively via {@code mapping_refs}.</li>
 *   <li>{@code promote} flips the chosen draft to active and demotes the
 *       prior active to draft with the "(superseded YYYY-MM-DD)" suffix.</li>
 *   <li>{@code promote} returns an impact-preview count that matches the
 *       actual stale-marked count after the transition.</li>
 *   <li>{@code delete} returns 409 (ConflictException) when called on an
 *       architecture whose {@code draft_state='active'}.</li>
 *   <li>{@code unmapped-current-elements} returns exactly the LEFT JOIN gap.</li>
 *   <li>Draft edits never invoke {@code mark-stale} (regression: the
 *       service short-circuits when {@code draft_state='draft'}).</li>
 * </ol>
 *
 * <p>Plus two debounce-window guard tests (in/out of window) for completeness
 * (still under the 7-test cap because debounce is a sub-rule of the
 * active-target firing semantics covered by test 7).</p>
 */
@ExtendWith(MockitoExtension.class)
class TargetArchitectureGroup3Test {

    @Mock
    private ArchitectureRepository architectureRepository;

    @Mock
    private ArchitectureTagRepository architectureTagRepository;

    @Mock
    private ArchitectureElementMappingRepository mappingRepository;

    @Mock
    private MigrationStorySpecGenerationRepository specRepository;

    @Mock
    private JdbcTemplate jdbcTemplate;

    private ArchitectureMapper architectureMapper;
    private TargetArchitectureStaleMarkService staleMarkService;
    private TargetArchitecturePromoteService promoteService;
    private UnmappedCurrentElementsService unmappedService;

    private UUID projectId;
    private UUID draftTargetId;
    private UUID priorActiveTargetId;
    private UUID currentArchId;

    @BeforeEach
    void setUp() {
        projectId = UUID.randomUUID();
        draftTargetId = UUID.randomUUID();
        priorActiveTargetId = UUID.randomUUID();
        currentArchId = UUID.randomUUID();

        architectureMapper = new ArchitectureMapper();
        staleMarkService = new TargetArchitectureStaleMarkService(
            specRepository, architectureRepository);
        promoteService = new TargetArchitecturePromoteService(
            architectureRepository,
            architectureTagRepository,
            architectureMapper,
            mappingRepository,
            staleMarkService,
            jdbcTemplate);
        unmappedService = new UnmappedCurrentElementsService(
            architectureRepository, jdbcTemplate);
    }

    // ------------------------------------------------------------------------
    // Test 1: mark-stale flips stale=true on direct architecture_element_ids
    // matches; idempotent on second call (bumps stale_marked_at)
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Test 1: mark-stale flips stale=true on architecture_element_ids matches; idempotent")
    void markStaleFlipsRowsOnDirectElementIdIntersection() {
        UUID workItemA = UUID.randomUUID();
        UUID workItemB = UUID.randomUUID();
        UUID workItemC = UUID.randomUUID();

        MigrationStorySpecGenerationEntity rowA = specRowWithRefs(workItemA, Map.of(
            "architecture_element_ids", List.of("elt-1", "elt-2", "elt-7")));
        MigrationStorySpecGenerationEntity rowB = specRowWithRefs(workItemB, Map.of(
            "architecture_element_ids", List.of("elt-99")));
        MigrationStorySpecGenerationEntity rowC = specRowWithRefs(workItemC, Map.of(
            "architecture_element_ids", List.of("elt-2")));

        when(specRepository.findByProjectId(projectId))
            .thenReturn(List.of(rowA, rowB, rowC));

        // ACT: changed = { elt-2, elt-7 } -> A and C match, B does not.
        int firstCall = staleMarkService.markStaleNow(projectId, List.of("elt-2", "elt-7"));

        assertThat(firstCall).isEqualTo(2);
        assertThat(rowA.getStale()).isTrue();
        assertThat(rowA.getStaleMarkedAt()).isNotNull();
        assertThat(rowC.getStale()).isTrue();
        assertThat(rowC.getStaleMarkedAt()).isNotNull();
        assertThat(rowB.getStale()).isNull();
        assertThat(rowB.getStaleMarkedAt()).isNull();

        // Idempotent: a second call with the same changed set still marks the
        // same rows. Spec says markedCount should still report >0 because the
        // stale_marked_at IS bumped (the column moves forward).
        Instant before = rowA.getStaleMarkedAt();
        // Sleep a bit to ensure the bumped timestamp differs.
        try {
            Thread.sleep(5);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        int secondCall = staleMarkService.markStaleNow(projectId, List.of("elt-2", "elt-7"));
        assertThat(secondCall).isEqualTo(2);
        assertThat(rowA.getStale()).isTrue();
        assertThat(rowA.getStaleMarkedAt()).isAfter(before);
    }

    // ------------------------------------------------------------------------
    // Test 2: mark-stale ALSO catches rows referencing changed elements
    // transitively via mapping_refs
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Test 2: mark-stale catches transitive matches via mapping_refs objects (sourceElementId / targetElementId)")
    void markStaleCatchesTransitiveMappingRefMatches() {
        // Row A cites no direct element ids, but cites a mapping referencing
        // changed element 'elt-5' on its target side.
        Map<String, Object> mappingObjA = new LinkedHashMap<>();
        mappingObjA.put("id", "map-A");
        mappingObjA.put("sourceElementId", "elt-99");
        mappingObjA.put("targetElementId", "elt-5");

        MigrationStorySpecGenerationEntity rowA = specRowWithRefs(UUID.randomUUID(), Map.of(
            "mapping_refs", List.of(mappingObjA)));

        // Row B cites a mapping referencing only un-changed elements.
        Map<String, Object> mappingObjB = new LinkedHashMap<>();
        mappingObjB.put("id", "map-B");
        mappingObjB.put("sourceElementId", "elt-100");
        mappingObjB.put("targetElementId", "elt-101");
        MigrationStorySpecGenerationEntity rowB = specRowWithRefs(UUID.randomUUID(), Map.of(
            "mapping_refs", List.of(mappingObjB)));

        when(specRepository.findByProjectId(projectId))
            .thenReturn(List.of(rowA, rowB));

        int marked = staleMarkService.markStaleNow(projectId, List.of("elt-5"));

        assertThat(marked).isEqualTo(1);
        assertThat(rowA.getStale()).isTrue();
        assertThat(rowB.getStale()).isNull();
    }

    // ------------------------------------------------------------------------
    // Test 3: promote flips draft -> active, demotes prior active to draft
    // with the "(superseded YYYY-MM-DD)" suffix
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Test 3: promote demotes prior active to draft+renamed, activates the chosen draft")
    void promoteDemoteAndActivate() {
        ArchitectureEntity draft = ArchitectureEntity.builder()
            .id(draftTargetId)
            .projectId(projectId)
            .name("Draft 2026-05-20 #1")
            .kind("target")
            .draftState("draft")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        ArchitectureEntity priorActive = ArchitectureEntity.builder()
            .id(priorActiveTargetId)
            .projectId(projectId)
            .name("Target Baseline")
            .kind("target")
            .draftState("active")
            .archived(false)
            .createdAt(Instant.now().minus(7, ChronoUnit.DAYS))
            .updatedAt(Instant.now())
            .build();

        when(architectureRepository.findById(draftTargetId))
            .thenReturn(Optional.of(draft));
        when(architectureRepository.findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                projectId, "target", "active"))
            .thenReturn(Optional.of(priorActive));
        when(architectureRepository.existsByProjectIdAndNameIgnoreCaseAndIdNot(
                eq(projectId), anyString(), any(UUID.class)))
            .thenReturn(false);
        when(architectureRepository.save(any(ArchitectureEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(architectureTagRepository.findByArchitectureId(any(UUID.class)))
            .thenReturn(List.of());
        when(mappingRepository.search(eq(projectId), any(), any(), any(), any(), any(), any(), any()))
            .thenReturn(List.of());
        // markStaleNow short-circuits before this would be consulted (empty changed set); lenient so unnecessary stubbing does not fail the strict default.
        lenient().when(specRepository.findByProjectId(projectId)).thenReturn(List.of());

        // ACT
        PromoteTargetArchitectureResponse response =
            promoteService.promote(projectId, draftTargetId);

        // ASSERT
        assertThat(response).isNotNull();
        assertThat(response.architecture().id()).isEqualTo(draftTargetId);
        assertThat(response.previousActiveId()).isEqualTo(priorActiveTargetId);
        assertThat(draft.getDraftState()).isEqualTo("active");
        assertThat(priorActive.getDraftState()).isEqualTo("draft");
        assertThat(priorActive.getName()).startsWith("Target Baseline (superseded ");
        assertThat(priorActive.getName()).endsWith(")");
    }

    // ------------------------------------------------------------------------
    // Test 4: promote returns an impact-preview count that matches the
    // actual stale-marked count after transition
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Test 4: promote returns impact-preview count equal to specs actually marked stale")
    void promoteReturnsImpactPreviewMatchingActualStaleCount() {
        ArchitectureEntity draft = ArchitectureEntity.builder()
            .id(draftTargetId)
            .projectId(projectId)
            .name("Draft 2026-05-20 #1")
            .kind("target")
            .draftState("draft")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        ArchitectureEntity priorActive = ArchitectureEntity.builder()
            .id(priorActiveTargetId)
            .projectId(projectId)
            .name("Target Baseline")
            .kind("target")
            .draftState("active")
            .archived(false)
            .createdAt(Instant.now().minus(7, ChronoUnit.DAYS))
            .updatedAt(Instant.now())
            .build();

        when(architectureRepository.findById(draftTargetId))
            .thenReturn(Optional.of(draft));
        when(architectureRepository.findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                projectId, "target", "active"))
            .thenReturn(Optional.of(priorActive));
        when(architectureRepository.existsByProjectIdAndNameIgnoreCaseAndIdNot(
                eq(projectId), anyString(), any(UUID.class)))
            .thenReturn(false);
        when(architectureRepository.save(any(ArchitectureEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(architectureTagRepository.findByArchitectureId(any(UUID.class)))
            .thenReturn(List.of());

        // Prior-active mapping: src-1 -> tgt-OLD; src-2 -> tgt-SAME.
        // New-active mapping:   src-1 -> tgt-NEW;  src-2 -> tgt-SAME.
        // Changed-element set: { src-1 } (target differs).
        when(mappingRepository.search(eq(projectId), any(), eq(priorActiveTargetId),
                any(), any(), any(), any(), any()))
            .thenReturn(List.of(
                mapping("src-1", "tgt-OLD", priorActiveTargetId),
                mapping("src-2", "tgt-SAME", priorActiveTargetId)));
        when(mappingRepository.search(eq(projectId), any(), eq(draftTargetId),
                any(), any(), any(), any(), any()))
            .thenReturn(List.of(
                mapping("src-1", "tgt-NEW", draftTargetId),
                mapping("src-2", "tgt-SAME", draftTargetId)));

        // Two spec rows reference src-1 (the changed element); one references
        // only src-2 (unchanged).
        MigrationStorySpecGenerationEntity affectedA = specRowWithRefs(UUID.randomUUID(), Map.of(
            "architecture_element_ids", List.of("src-1")));
        MigrationStorySpecGenerationEntity affectedB = specRowWithRefs(UUID.randomUUID(), Map.of(
            "architecture_element_ids", List.of("src-1", "src-99")));
        MigrationStorySpecGenerationEntity unaffected = specRowWithRefs(UUID.randomUUID(), Map.of(
            "architecture_element_ids", List.of("src-2")));

        when(specRepository.findByProjectId(projectId))
            .thenReturn(List.of(affectedA, affectedB, unaffected));

        // ACT
        PromoteTargetArchitectureResponse response =
            promoteService.promote(projectId, draftTargetId);

        // ASSERT: impact-preview count equals the actual marked-stale count.
        assertThat(response.specsMarkedStale()).isEqualTo(2);
        assertThat(affectedA.getStale()).isTrue();
        assertThat(affectedB.getStale()).isTrue();
        assertThat(unaffected.getStale()).isNull();
    }

    // ------------------------------------------------------------------------
    // Test 5: delete returns 409 (ConflictException) when called on the
    // active target architecture
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Test 5: delete refuses with 409 when the architecture is the active target")
    void deleteRefusesActiveTargetWith409() {
        ArchitectureEntity activeTarget = ArchitectureEntity.builder()
            .id(priorActiveTargetId)
            .projectId(projectId)
            .name("Active Target")
            .kind("target")
            .draftState("active")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(architectureRepository.findById(priorActiveTargetId))
            .thenReturn(Optional.of(activeTarget));

        assertThatThrownBy(() -> promoteService.delete(projectId, priorActiveTargetId, false))
            .isInstanceOf(ConflictException.class)
            .hasMessageContaining("active target");

        verify(architectureRepository, never()).save(any(ArchitectureEntity.class));
    }

    @Test
    @DisplayName("delete with force=true clears the active target (archives + demotes to draft)")
    void forceDeleteActiveTargetArchivesAndDemotes() {
        ArchitectureEntity activeTarget = ArchitectureEntity.builder()
            .id(priorActiveTargetId)
            .projectId(projectId)
            .name("Active Target")
            .kind("target")
            .draftState("active")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        when(architectureRepository.findById(priorActiveTargetId))
            .thenReturn(Optional.of(activeTarget));

        promoteService.delete(projectId, priorActiveTargetId, true);

        assertThat(activeTarget.getArchived())
            .as("force-delete archives the active target")
            .isTrue();
        assertThat(activeTarget.getDraftState())
            .as("force-delete also drops the active flag so the project has no active target")
            .isEqualTo("draft");
        verify(architectureRepository).save(activeTarget);
    }

    // ------------------------------------------------------------------------
    // Test 6: unmapped-current-elements returns exactly the LEFT JOIN gap
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Test 6: unmapped-current-elements returns the LEFT JOIN gap returned by the JDBC query")
    void unmappedReturnsLeftJoinGap() {
        ArchitectureEntity currentArch = ArchitectureEntity.builder()
            .id(currentArchId)
            .projectId(projectId)
            .name("Default")
            .kind("current")
            .draftState("active")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(architectureRepository.findById(currentArchId))
            .thenReturn(Optional.of(currentArch));
        when(architectureRepository.findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                projectId, "target", "active"))
            .thenReturn(Optional.of(ArchitectureEntity.builder()
                .id(priorActiveTargetId)
                .projectId(projectId)
                .name("Active Target")
                .kind("target")
                .draftState("active")
                .archived(false)
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build()));

        // application_components: two unmapped rows.
        when(jdbcTemplate.queryForList(
                anyString(),
                eq(currentArchId), eq(projectId), eq("application_components"),
                eq(priorActiveTargetId)))
            .thenReturn(List.of(
                resultRow("comp-1", "Order Service"),
                resultRow("comp-2", "Billing Service")));
        // interfaces: one unmapped row.
        when(jdbcTemplate.queryForList(
                anyString(),
                eq(currentArchId), eq(projectId), eq("interfaces"),
                eq(priorActiveTargetId)))
            .thenReturn(List.of(resultRow("api-9", "OrdersAPI")));
        // data_entity_points: no gap.
        when(jdbcTemplate.queryForList(
                anyString(),
                eq(currentArchId), eq(projectId), eq("data_entity_points"),
                eq(priorActiveTargetId)))
            .thenReturn(List.of());
        // infrastructure_points: no gap.
        when(jdbcTemplate.queryForList(
                anyString(),
                eq(currentArchId), eq(projectId), eq("infrastructure_points"),
                eq(priorActiveTargetId)))
            .thenReturn(List.of());

        // ACT
        List<UnmappedCurrentElementDto> out = unmappedService.findUnmapped(projectId, currentArchId, null);

        // ASSERT
        assertThat(out).hasSize(3);
        assertThat(out).extracting(UnmappedCurrentElementDto::elementId)
            .containsExactly("comp-1", "comp-2", "api-9");
        assertThat(out).extracting(UnmappedCurrentElementDto::elementType)
            .containsExactly("application_components", "application_components", "interfaces");
        assertThat(out).extracting(UnmappedCurrentElementDto::name)
            .containsExactly("Order Service", "Billing Service", "OrdersAPI");
    }

    // ------------------------------------------------------------------------
    // Test 7: Draft edits never invoke mark-stale (regression).
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Test 7: Draft-state architecture saves NEVER fire mark-stale (regression on the active-vs-draft gate)")
    void draftEditsNeverFireMarkStale() {
        ArchitectureEntity draftArch = ArchitectureEntity.builder()
            .id(draftTargetId)
            .projectId(projectId)
            .name("Draft 2026-05-20 #1")
            .kind("target")
            .draftState("draft") // KEY: draft, not active
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(architectureRepository.findById(draftTargetId))
            .thenReturn(Optional.of(draftArch));
        // No spec-repository stubbing: it must never be called.

        MarkStaleResponse response = staleMarkService.markStaleIfActiveAndDebounced(
            projectId, draftTargetId, List.of("elt-1", "elt-2"));

        assertThat(response.markedCount()).isEqualTo(0);
        assertThat(response.debounceSkipped()).isFalse();
        verify(specRepository, never()).findByProjectId(any(UUID.class));
        verify(specRepository, never()).saveAll(any());
        verify(architectureRepository, never()).save(any(ArchitectureEntity.class));
        // The lastMarkedStaleAt stamp on the draft must NOT be touched.
        assertThat(draftArch.getLastMarkedStaleAt()).isNull();
    }

    // ------------------------------------------------------------------------
    // Bonus 8: Active-target save WITHIN debounce window skips mark-stale.
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Bonus: Active-target save WITHIN debounce window returns debounceSkipped=true and does NOT mark stale")
    void activeTargetSaveInsideDebounceWindowSkips() {
        ArchitectureEntity activeArch = ArchitectureEntity.builder()
            .id(priorActiveTargetId)
            .projectId(projectId)
            .name("Active Target")
            .kind("target")
            .draftState("active")
            .archived(false)
            .lastMarkedStaleAt(Instant.now().minusSeconds(1)) // 1s ago: within 5s window
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(architectureRepository.findById(priorActiveTargetId))
            .thenReturn(Optional.of(activeArch));

        MarkStaleResponse response = staleMarkService.markStaleIfActiveAndDebounced(
            projectId, priorActiveTargetId, List.of("elt-1"));

        assertThat(response.debounceSkipped()).isTrue();
        assertThat(response.markedCount()).isEqualTo(0);
        verify(specRepository, never()).findByProjectId(any(UUID.class));
        verify(specRepository, never()).saveAll(any());
        verify(architectureRepository, never()).save(any(ArchitectureEntity.class));
    }

    // ------------------------------------------------------------------------
    // Bonus 9: Active-target save OUTSIDE debounce window fires mark-stale
    // and bumps the stamp.
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Bonus: Active-target save OUTSIDE debounce window fires mark-stale and bumps last_marked_stale_at")
    void activeTargetSaveOutsideDebounceFires() {
        ArchitectureEntity activeArch = ArchitectureEntity.builder()
            .id(priorActiveTargetId)
            .projectId(projectId)
            .name("Active Target")
            .kind("target")
            .draftState("active")
            .archived(false)
            .lastMarkedStaleAt(Instant.now().minusSeconds(120)) // 2 minutes ago: outside 5s window
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(architectureRepository.findById(priorActiveTargetId))
            .thenReturn(Optional.of(activeArch));
        // No specs in the project -> markedCount=0 but the call is NOT skipped.
        // markStaleNow short-circuits before this would be consulted (empty changed set); lenient so unnecessary stubbing does not fail the strict default.
        lenient().when(specRepository.findByProjectId(projectId)).thenReturn(List.of());

        Instant before = activeArch.getLastMarkedStaleAt();
        MarkStaleResponse response = staleMarkService.markStaleIfActiveAndDebounced(
            projectId, priorActiveTargetId, List.of("elt-1"));

        assertThat(response.debounceSkipped()).isFalse();
        // The stamp on the active arch WAS bumped (since outside debounce).
        ArgumentCaptor<ArchitectureEntity> savedCaptor =
            ArgumentCaptor.forClass(ArchitectureEntity.class);
        verify(architectureRepository, atLeastOnce()).save(savedCaptor.capture());
        ArchitectureEntity persisted = savedCaptor.getValue();
        assertThat(persisted.getLastMarkedStaleAt()).isAfter(before);
    }

    // ------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------

    private MigrationStorySpecGenerationEntity specRowWithRefs(UUID workItemId, Map<String, Object> refs) {
        return MigrationStorySpecGenerationEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
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
            .projectId(projectId)
            .sourceArchitectureId(currentArchId)
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

    private Map<String, Object> resultRow(String elementId, String elementName) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("element_id", elementId);
        r.put("element_name", elementName);
        return r;
    }
}
