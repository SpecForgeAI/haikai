package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.TemplateModeNotImplementedException;
import com.example.architecturemodel.mapper.ArchitectureMapper;
import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.dto.SeedTargetArchitectureRequest;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ArchitectureTagRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
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
 * Service-level tests for {@link TargetArchitectureSeedService}.
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 2.</p>
 *
 * <p>Four focused tests per task spec 2.1:</p>
 * <ol>
 *   <li>{@code clone-current} produces a new architecture with
 *       {@code kind='target'}, {@code draft_state='draft'} and exactly N
 *       elements where N = source element count; every cloned element is
 *       stamped {@code provenance='cloned-from'}.</li>
 *   <li>{@code clone-current} auto-creates one {@code mapping_type='equivalent'}
 *       row in {@code architecture_element_mappings} per element with
 *       {@code confidence=1.0} and
 *       {@code createdByTask='target-arch-seed-clone'}.</li>
 *   <li>{@code blank} produces an empty target architecture (no clone, no
 *       mappings) with correct {@code kind='target'} and
 *       {@code draft_state='draft'}.</li>
 *   <li>{@code from-template} throws
 *       {@link TemplateModeNotImplementedException} so the global handler
 *       returns 501 with a clean envelope.</li>
 * </ol>
 *
 * <p>{@link ArchitectureCloneService} and {@link JdbcTemplate} are mocked --
 * the seed service is a thin wrapper around the existing clone path, and the
 * JDBC contract (which SQL is issued in which order with which args) is the
 * cleanest unit-level seam. The graph-clone correctness behind the wrapper is
 * already covered by {@code ArchitectureCloneIntegrationTest}.</p>
 */
@ExtendWith(MockitoExtension.class)
class TargetArchitectureSeedServiceTest {

    private static final String APP_COMPS_STAMP_SQL =
        "UPDATE application_components SET provenance = ? "
            + " WHERE model_file_id IN ("
            + "    SELECT id FROM model_files WHERE architecture_id = ?"
            + " )"
            + " AND provenance IS NULL";

    private static final String APP_COMPS_MAP_SELECT_SQL =
        "SELECT t.id AS id FROM application_components t "
            + " WHERE t.model_file_id IN ("
            + "    SELECT id FROM model_files WHERE architecture_id = ?"
            + " )";

    @Mock
    private ArchitectureRepository architectureRepository;

    @Mock
    private ArchitectureTagRepository architectureTagRepository;

    @Mock
    private ArchitectureCloneService architectureCloneService;

    @Mock
    private ArchitectureElementMappingRepository mappingRepository;

    @Mock
    private JdbcTemplate jdbcTemplate;

    private ArchitectureMapper architectureMapper;
    private TargetArchitectureSeedService seedService;

    private UUID projectId;
    private UUID sourceArchitectureId;
    private UUID newArchitectureId;

    @BeforeEach
    void setUp() {
        projectId = UUID.randomUUID();
        sourceArchitectureId = UUID.randomUUID();
        newArchitectureId = UUID.randomUUID();

        architectureMapper = new ArchitectureMapper();
        seedService = new TargetArchitectureSeedService(
            architectureRepository,
            architectureTagRepository,
            architectureMapper,
            architectureCloneService,
            mappingRepository,
            jdbcTemplate);
    }

    // ------------------------------------------------------------------------
    // Test 1: clone-current stamps provenance='cloned-from' on every element
    // and the new architecture row is kind='target', draft_state='draft'
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Test 1: clone-current produces kind=target, draft_state=draft, every cloned element stamped provenance='cloned-from'")
    void cloneCurrentStampsProvenanceAndFlipsTargetDraft() {
        stubCloneCurrentSeedScaffolding();

        // Three application_components rows on each side, paired by name.
        // The clone service is mocked, so the new arch entity returned by
        // findById(newArchitectureId) starts with kind='current'/draft='active'
        // (per the clone path defaults); the seed service must flip it.
        lenient().when(jdbcTemplate.update(anyString(), anyString(), any(UUID.class)))
            .thenReturn(0);
        when(jdbcTemplate.update(
                eq(APP_COMPS_STAMP_SQL),
                eq(SeedTargetArchitectureRequest.PROVENANCE_CLONED_FROM),
                eq(newArchitectureId)))
            .thenReturn(3);

        // Clone returns the new DTO + the source->clone id correlation map.
        when(architectureCloneService.cloneArchitectureWithIdMap(
                eq(projectId), eq(sourceArchitectureId), anyString(), any(), any(), any()))
            .thenReturn(new ArchitectureCloneService.CloneResult(
                cloneDto(),
                Map.of(
                    "src-comp-1", "new-comp-1",
                    "src-comp-2", "new-comp-2",
                    "src-comp-3", "new-comp-3")));

        lenient().when(jdbcTemplate.queryForList(anyString(), any(UUID.class)))
            .thenReturn(Collections.emptyList());
        // Mapping pass queries the NEW rows by id (not by name); source ids come
        // from the clone idMap, so only one query per table is issued.
        when(jdbcTemplate.queryForList(eq(APP_COMPS_MAP_SELECT_SQL), eq(newArchitectureId)))
            .thenReturn(List.of(
                row("new-comp-1", "Order Service"),
                row("new-comp-2", "Inventory Service"),
                row("new-comp-3", "Billing Service")));

        // ACT
        SeedTargetArchitectureRequest request = new SeedTargetArchitectureRequest(
            SeedTargetArchitectureRequest.MODE_CLONE_CURRENT,
            null,
            sourceArchitectureId,
            null);
        ArchitectureDto result = seedService.seed(projectId, request);

        // ASSERT
        assertThat(result).isNotNull();
        assertThat(result.id()).isEqualTo(newArchitectureId);
        assertThat(result.projectId()).isEqualTo(projectId);

        // The new architecture row was flipped to kind='target', draft_state='draft'.
        ArgumentCaptor<ArchitectureEntity> savedCaptor =
            ArgumentCaptor.forClass(ArchitectureEntity.class);
        verify(architectureRepository, atLeastOnce()).saveAndFlush(savedCaptor.capture());
        ArchitectureEntity flipped = savedCaptor.getValue();
        assertThat(flipped.getKind()).isEqualTo("target");
        assertThat(flipped.getDraftState()).isEqualTo("draft");

        // Verify the stamping UPDATE fired for application_components with
        // the expected provenance value.
        verify(jdbcTemplate).update(
            eq(APP_COMPS_STAMP_SQL),
            eq(SeedTargetArchitectureRequest.PROVENANCE_CLONED_FROM),
            eq(newArchitectureId));
    }

    // ------------------------------------------------------------------------
    // Test 2: clone-current auto-creates equivalent mappings with confidence=1.0
    // and createdByTask='target-arch-seed-clone'
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Test 2: clone-current creates mapping_type='equivalent' rows with confidence=1.0 and createdByTask='target-arch-seed-clone'")
    void cloneCurrentCreatesEquivalentMappings() {
        stubCloneCurrentSeedScaffolding();

        lenient().when(jdbcTemplate.update(anyString(), anyString(), any(UUID.class)))
            .thenReturn(0);
        when(jdbcTemplate.update(
                eq(APP_COMPS_STAMP_SQL),
                eq(SeedTargetArchitectureRequest.PROVENANCE_CLONED_FROM),
                eq(newArchitectureId)))
            .thenReturn(2);

        when(architectureCloneService.cloneArchitectureWithIdMap(
                eq(projectId), eq(sourceArchitectureId), anyString(), any(), any(), any()))
            .thenReturn(new ArchitectureCloneService.CloneResult(
                cloneDto(),
                Map.of("src-A", "new-A", "src-B", "new-B")));

        lenient().when(jdbcTemplate.queryForList(anyString(), any(UUID.class)))
            .thenReturn(Collections.emptyList());
        when(jdbcTemplate.queryForList(eq(APP_COMPS_MAP_SELECT_SQL), eq(newArchitectureId)))
            .thenReturn(List.of(
                row("new-A", "Alpha"),
                row("new-B", "Beta")));

        // ACT
        SeedTargetArchitectureRequest request = new SeedTargetArchitectureRequest(
            SeedTargetArchitectureRequest.MODE_CLONE_CURRENT,
            null,
            sourceArchitectureId,
            null);
        seedService.seed(projectId, request);

        // ASSERT: the mapping repository received saveAll with two equivalent
        // mappings, each carrying confidence=1.0 + createdByTask='target-arch-seed-clone'.
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Iterable<ArchitectureElementMappingEntity>> savedCaptor =
            ArgumentCaptor.forClass(Iterable.class);
        verify(mappingRepository).saveAll(savedCaptor.capture());

        List<ArchitectureElementMappingEntity> savedMappings = new ArrayList<>();
        savedCaptor.getValue().forEach(savedMappings::add);

        assertThat(savedMappings)
            .as("clone-current must insert exactly one mapping per cloned element")
            .hasSize(2);
        assertThat(savedMappings).allSatisfy(m -> {
            assertThat(m.getProjectId()).isEqualTo(projectId);
            assertThat(m.getSourceArchitectureId()).isEqualTo(sourceArchitectureId);
            assertThat(m.getTargetArchitectureId()).isEqualTo(newArchitectureId);
            assertThat(m.getSourceElementType()).isEqualTo("application_components");
            assertThat(m.getTargetElementType()).isEqualTo("application_components");
            assertThat(m.getMappingType()).isEqualTo("equivalent");
            assertThat(m.getConfidence()).isEqualTo(1.0d);
            assertThat(m.getCreatedByTask())
                .isEqualTo(SeedTargetArchitectureRequest.CLONE_CREATED_BY_TASK);
            // Source-element back-reference (the natural place for
            // "cloned-from element id" -- no new column on the element table)
            assertThat(m.getSourceElementId()).isNotBlank();
            assertThat(m.getTargetElementId()).isNotBlank();
            assertThat(m.getSourceElementId()).isNotEqualTo(m.getTargetElementId());
        });
        // The two mappings cover the two distinct element names.
        assertThat(savedMappings)
            .extracting(ArchitectureElementMappingEntity::getSourceElementId)
            .containsExactlyInAnyOrder("src-A", "src-B");
        assertThat(savedMappings)
            .extracting(ArchitectureElementMappingEntity::getTargetElementId)
            .containsExactlyInAnyOrder("new-A", "new-B");
    }

    // ------------------------------------------------------------------------
    // Test 3: blank produces empty target architecture, no clone, no mappings
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Test 3: blank produces empty target architecture (no elements, no mappings) with kind='target' and draft_state='draft'")
    void blankProducesEmptyTargetArchitecture() {
        when(architectureRepository.findByProjectIdOrderByCreatedAtAsc(projectId))
            .thenReturn(Collections.emptyList());
        when(architectureRepository.existsByProjectIdAndNameIgnoreCase(eq(projectId), anyString()))
            .thenReturn(false);
        when(architectureRepository.saveAndFlush(any(ArchitectureEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(architectureTagRepository.findByArchitectureId(any(UUID.class)))
            .thenReturn(Collections.emptyList());

        SeedTargetArchitectureRequest request = new SeedTargetArchitectureRequest(
            SeedTargetArchitectureRequest.MODE_BLANK,
            null,
            null,
            null);

        ArchitectureDto result = seedService.seed(projectId, request);

        // The clone service was NOT called.
        verify(architectureCloneService, never())
            .cloneArchitectureWithIdMap(any(), any(), anyString(), any(), any(), any());

        // The mapping repository was NOT touched.
        verify(mappingRepository, never()).saveAll(any());

        // The JDBC stamping path did not fire.
        verify(jdbcTemplate, never()).update(anyString(), anyString(), any(UUID.class));

        // The architecture row was saved with kind='target', draft_state='draft'.
        ArgumentCaptor<ArchitectureEntity> savedCaptor =
            ArgumentCaptor.forClass(ArchitectureEntity.class);
        verify(architectureRepository, times(1)).saveAndFlush(savedCaptor.capture());
        ArchitectureEntity saved = savedCaptor.getValue();
        assertThat(saved.getKind()).isEqualTo("target");
        assertThat(saved.getDraftState()).isEqualTo("draft");
        assertThat(saved.getProjectId()).isEqualTo(projectId);
        assertThat(saved.getName()).startsWith("Draft ");

        assertThat(result).isNotNull();
        assertThat(result.projectId()).isEqualTo(projectId);
    }

    // ------------------------------------------------------------------------
    // Test 4: from-template throws TemplateModeNotImplementedException
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Test 4: from-template throws TemplateModeNotImplementedException (mapped to HTTP 501 by the global handler)")
    void fromTemplateThrowsNotImplemented() {
        SeedTargetArchitectureRequest request = new SeedTargetArchitectureRequest(
            SeedTargetArchitectureRequest.MODE_FROM_TEMPLATE,
            "tmpl-abc",
            null,
            null);

        assertThatThrownBy(() -> seedService.seed(projectId, request))
            .isInstanceOf(TemplateModeNotImplementedException.class)
            .hasMessageContaining("not implemented");

        // No side effects: nothing touched the clone path, the JDBC layer, the
        // mapping repository, or the architecture repository.
        verify(architectureCloneService, never())
            .cloneArchitectureWithIdMap(any(), any(), anyString(), any(), any(), any());
        verify(mappingRepository, never()).saveAll(any());
        verify(jdbcTemplate, never()).update(anyString(), anyString(), any(UUID.class));
        verify(architectureRepository, never()).saveAndFlush(any(ArchitectureEntity.class));
    }

    // ------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------

    /**
     * Stubs the common scaffolding for the two clone-current tests: source
     * architecture lookup, project-scoped draft count for auto-name, the
     * clone-service result, post-clone findById, save/findByArchId glue, and
     * tag-list result.
     */
    private void stubCloneCurrentSeedScaffolding() {
        ArchitectureEntity sourceArch = ArchitectureEntity.builder()
            .id(sourceArchitectureId)
            .projectId(projectId)
            .name("Default")
            .kind("current")
            .draftState("active")
            .archived(false)
            .build();
        ArchitectureEntity newArch = ArchitectureEntity.builder()
            .id(newArchitectureId)
            .projectId(projectId)
            .name("Draft 2026-05-20 #1")
            .archived(false)
            // The clone service leaves these at the entity-level defaults;
            // the seed service is expected to flip them.
            .kind("current")
            .draftState("active")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        lenient().when(architectureRepository.findById(sourceArchitectureId))
            .thenReturn(Optional.of(sourceArch));
        when(architectureRepository.findByProjectIdOrderByCreatedAtAsc(projectId))
            .thenReturn(List.of(sourceArch));
        when(architectureRepository.findById(newArchitectureId))
            .thenReturn(Optional.of(newArch));
        when(architectureRepository.saveAndFlush(any(ArchitectureEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(architectureTagRepository.findByArchitectureId(newArchitectureId))
            .thenReturn(Collections.emptyList());
    }

    private ArchitectureDto cloneDto() {
        return new ArchitectureDto(
            newArchitectureId, projectId, "Draft 2026-05-20 #1", null,
            Collections.emptyList(), false, Instant.now(), Instant.now());
    }

    private static Map<String, Object> row(String id, String name) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("id", id);
        r.put("name", name);
        return r;
    }
}
