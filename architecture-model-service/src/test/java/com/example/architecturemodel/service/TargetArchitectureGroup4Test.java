package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.model.dto.DecommissionedInTargetAnnotationDto;
import com.example.architecturemodel.model.dto.MappingSuggestRequest;
import com.example.architecturemodel.model.dto.MappingSuggestResponse;
import com.example.architecturemodel.model.dto.MappingSuggestTargetSnapshot;
import com.example.architecturemodel.model.dto.MarkDecommissionedRequest;
import com.example.architecturemodel.model.dto.MarkDecommissionedResponse;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Service-level tests for the Target Architecture authoring flow Task Group 4
 * surface:
 *
 * <ul>
 *   <li>{@link TargetArchitectureDecommissionService} -- atomic target-side
 *       row + mapping-row write with the right provenance / status / type /
 *       createdByTask stamps.</li>
 *   <li>{@link DecommissionedInTargetAnnotationService} -- derived current-side
 *       annotation for two reasons: no-mapping and all-mappings-decommissioned.</li>
 *   <li>{@link MappingSuggestService} -- read-only (no row mutations).</li>
 * </ul>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 4.</p>
 *
 * <p>Four focused tests per task spec 4.1:</p>
 * <ol>
 *   <li>{@code mark-decommissioned} writes a target-side row with
 *       {@code provenance='user-authored'} +
 *       {@code decommissioning_status='decommissioned'}, plus a mapping row
 *       with {@code mapping_type='decommissioned'} and
 *       {@code createdByTask='unmapped-panel-mark-decom'}.</li>
 *   <li>Derived "decommissioned in target" annotation surfaces on a current
 *       element with no mapping into the active target.</li>
 *   <li>Derived annotation surfaces when EVERY mapping into the active target
 *       points at a target row with {@code decommissioning_status='decommissioned'}.</li>
 *   <li>{@code mapping-suggest} performs zero row mutations across the call.</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class TargetArchitectureGroup4Test {

    @Mock private ArchitectureRepository architectureRepository;
    @Mock private ArchitectureElementMappingRepository mappingRepository;
    @Mock private JdbcTemplate jdbcTemplate;

    private TargetArchitectureDecommissionService decommissionService;
    private DecommissionedInTargetAnnotationService annotationService;
    private MappingSuggestService mappingSuggestService;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID CURRENT_ARCH_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID TARGET_ARCH_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final String SOURCE_ELEMENT_ID = "44444444-4444-4444-4444-444444444444";
    private static final String TARGET_MODEL_FILE_ID = "55555555-5555-5555-5555-555555555555";

    @BeforeEach
    void setUp() {
        decommissionService = new TargetArchitectureDecommissionService(
            architectureRepository, mappingRepository, jdbcTemplate);
        annotationService = new DecommissionedInTargetAnnotationService(
            architectureRepository, jdbcTemplate);
        mappingSuggestService = new MappingSuggestService(
            architectureRepository, jdbcTemplate);
    }

    private ArchitectureEntity targetArch() {
        return ArchitectureEntity.builder()
            .id(TARGET_ARCH_ID)
            .projectId(PROJECT_ID)
            .kind("target")
            .draftState("active")
            .archived(false)
            .name("Active Target")
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
            .build();
    }

    // -----------------------------------------------------------------------
    // Test 1: mark-decommissioned writes target-side row + mapping row with
    // the right stamps
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("mark-decommissioned writes target-side row with provenance=user-authored + decommissioning_status=decommissioned, plus mapping_type=decommissioned + createdByTask=unmapped-panel-mark-decom")
    void markDecommissionedWritesTargetSideRowAndMapping() {
        when(architectureRepository.findById(TARGET_ARCH_ID))
            .thenReturn(Optional.of(targetArch()));
        // Lenient because the service uses the request-supplied currentArchitectureId
        // and never consults this fallback finder in this path.
        lenient().when(architectureRepository.findFirstByProjectIdAndArchivedFalseOrderByCreatedAtAsc(PROJECT_ID))
            .thenReturn(Optional.of(currentArch()));

        Map<String, Object> sourceRow = new HashMap<>();
        sourceRow.put("id", SOURCE_ELEMENT_ID);
        sourceRow.put("name", "Order Service");
        sourceRow.put("description", "legacy order processor");
        sourceRow.put("application_id", "app-uuid-aaa");
        when(jdbcTemplate.queryForList(
                eq("SELECT * FROM application_components WHERE id = ?"),
                eq(SOURCE_ELEMENT_ID)))
            .thenReturn(List.of(sourceRow));

        Map<String, Object> modelFileRow = new HashMap<>();
        modelFileRow.put("id", TARGET_MODEL_FILE_ID);
        when(jdbcTemplate.queryForList(
                eq("SELECT id FROM model_files WHERE architecture_id = ? ORDER BY id ASC LIMIT 1"),
                eq(TARGET_ARCH_ID)))
            .thenReturn(List.of(modelFileRow));

        when(mappingRepository.saveAndFlush(any(ArchitectureElementMappingEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        MarkDecommissionedRequest request = new MarkDecommissionedRequest(
            SOURCE_ELEMENT_ID, "application_components", CURRENT_ARCH_ID);

        MarkDecommissionedResponse response = decommissionService.markDecommissioned(
            PROJECT_ID, TARGET_ARCH_ID, request);

        // Capture the target-side INSERT — it must carry provenance + decom status
        ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);
        verify(jdbcTemplate).update(
            sqlCaptor.capture(),
            any(), any(), any(), any(), any(),
            eq("user-authored"),
            eq("decommissioned"));
        assertThat(sqlCaptor.getValue())
            .as("target-side INSERT must hit application_components and include provenance + decom columns")
            .contains("INSERT INTO application_components")
            .contains("provenance")
            .contains("decommissioning_status");

        // Capture the mapping row
        ArgumentCaptor<ArchitectureElementMappingEntity> mappingCaptor =
            ArgumentCaptor.forClass(ArchitectureElementMappingEntity.class);
        verify(mappingRepository).saveAndFlush(mappingCaptor.capture());
        ArchitectureElementMappingEntity saved = mappingCaptor.getValue();

        assertThat(saved.getProjectId()).isEqualTo(PROJECT_ID);
        assertThat(saved.getSourceArchitectureId()).isEqualTo(CURRENT_ARCH_ID);
        assertThat(saved.getTargetArchitectureId()).isEqualTo(TARGET_ARCH_ID);
        assertThat(saved.getSourceElementId()).isEqualTo(SOURCE_ELEMENT_ID);
        assertThat(saved.getSourceElementType()).isEqualTo("application_components");
        assertThat(saved.getTargetElementType()).isEqualTo("application_components");
        assertThat(saved.getMappingType()).isEqualTo("decommissioned");
        assertThat(saved.getCreatedByTask()).isEqualTo("unmapped-panel-mark-decom");

        assertThat(response.newTargetElementId()).isNotBlank();
        assertThat(response.newTargetElementType()).isEqualTo("application_components");
        assertThat(response.mappingId()).isEqualTo(saved.getId());
    }

    // -----------------------------------------------------------------------
    // Test 2: derived annotation surfaces when no mapping exists into the
    // active target
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("derived annotation surfaces on a current element with no mapping into the active target")
    void derivedAnnotationSurfacesOnUnmappedCurrentElement() {
        when(architectureRepository.findById(CURRENT_ARCH_ID))
            .thenReturn(Optional.of(currentArch()));
        when(architectureRepository.findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                PROJECT_ID, "target", "active"))
            .thenReturn(Optional.of(targetArch()));

        // application_components row: 0 mappings into the active target →
        // reason=no_mapping_to_active_target
        Map<String, Object> row = new HashMap<>();
        row.put("element_id", SOURCE_ELEMENT_ID);
        row.put("element_name", "Order Service");
        row.put("total_mappings", 0L);
        row.put("decommissioned_mappings", 0L);
        when(jdbcTemplate.queryForList(
                any(String.class),
                eq(PROJECT_ID), eq("application_components"), eq(TARGET_ARCH_ID),
                eq(PROJECT_ID), eq("application_components"), eq(TARGET_ARCH_ID),
                eq(CURRENT_ARCH_ID)))
            .thenReturn(List.of(row));
        // Other tables return empty
        lenient().when(jdbcTemplate.queryForList(
                any(String.class),
                eq(PROJECT_ID), eq("interfaces"), eq(TARGET_ARCH_ID),
                eq(PROJECT_ID), eq("interfaces"), eq(TARGET_ARCH_ID),
                eq(CURRENT_ARCH_ID)))
            .thenReturn(List.of());
        lenient().when(jdbcTemplate.queryForList(
                any(String.class),
                eq(PROJECT_ID), eq("data_entity_points"), eq(TARGET_ARCH_ID),
                eq(PROJECT_ID), eq("data_entity_points"), eq(TARGET_ARCH_ID),
                eq(CURRENT_ARCH_ID)))
            .thenReturn(List.of());
        lenient().when(jdbcTemplate.queryForList(
                any(String.class),
                eq(PROJECT_ID), eq("infrastructure_points"), eq(TARGET_ARCH_ID),
                eq(PROJECT_ID), eq("infrastructure_points"), eq(TARGET_ARCH_ID),
                eq(CURRENT_ARCH_ID)))
            .thenReturn(List.of());

        List<DecommissionedInTargetAnnotationDto> result =
            annotationService.findAnnotations(PROJECT_ID, CURRENT_ARCH_ID, null);

        assertThat(result).hasSize(1);
        DecommissionedInTargetAnnotationDto annotation = result.get(0);
        assertThat(annotation.elementId()).isEqualTo(SOURCE_ELEMENT_ID);
        assertThat(annotation.elementType()).isEqualTo("application_components");
        assertThat(annotation.name()).isEqualTo("Order Service");
        assertThat(annotation.reason())
            .as("element with zero mappings into active target → reason=no_mapping_to_active_target")
            .isEqualTo(DecommissionedInTargetAnnotationDto.REASON_NO_MAPPING);
    }

    // -----------------------------------------------------------------------
    // Test 3: derived annotation surfaces when every mapping into the active
    // target points at a decommissioned target row
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("derived annotation surfaces when every mapping points at a target element with decommissioning_status=decommissioned")
    void derivedAnnotationSurfacesWhenAllMappingsAreDecommissioned() {
        when(architectureRepository.findById(CURRENT_ARCH_ID))
            .thenReturn(Optional.of(currentArch()));
        when(architectureRepository.findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                PROJECT_ID, "target", "active"))
            .thenReturn(Optional.of(targetArch()));

        // application_components row: 2 mappings, both decommissioned →
        // reason=all_mappings_decommissioned
        Map<String, Object> row = new HashMap<>();
        row.put("element_id", SOURCE_ELEMENT_ID);
        row.put("element_name", "Legacy Reporting");
        row.put("total_mappings", 2L);
        row.put("decommissioned_mappings", 2L);
        when(jdbcTemplate.queryForList(
                any(String.class),
                eq(PROJECT_ID), eq("application_components"), eq(TARGET_ARCH_ID),
                eq(PROJECT_ID), eq("application_components"), eq(TARGET_ARCH_ID),
                eq(CURRENT_ARCH_ID)))
            .thenReturn(List.of(row));
        lenient().when(jdbcTemplate.queryForList(
                any(String.class),
                eq(PROJECT_ID), eq("interfaces"), eq(TARGET_ARCH_ID),
                eq(PROJECT_ID), eq("interfaces"), eq(TARGET_ARCH_ID),
                eq(CURRENT_ARCH_ID)))
            .thenReturn(List.of());
        lenient().when(jdbcTemplate.queryForList(
                any(String.class),
                eq(PROJECT_ID), eq("data_entity_points"), eq(TARGET_ARCH_ID),
                eq(PROJECT_ID), eq("data_entity_points"), eq(TARGET_ARCH_ID),
                eq(CURRENT_ARCH_ID)))
            .thenReturn(List.of());
        lenient().when(jdbcTemplate.queryForList(
                any(String.class),
                eq(PROJECT_ID), eq("infrastructure_points"), eq(TARGET_ARCH_ID),
                eq(PROJECT_ID), eq("infrastructure_points"), eq(TARGET_ARCH_ID),
                eq(CURRENT_ARCH_ID)))
            .thenReturn(List.of());

        List<DecommissionedInTargetAnnotationDto> result =
            annotationService.findAnnotations(PROJECT_ID, CURRENT_ARCH_ID, null);

        assertThat(result).hasSize(1);
        DecommissionedInTargetAnnotationDto annotation = result.get(0);
        assertThat(annotation.elementId()).isEqualTo(SOURCE_ELEMENT_ID);
        assertThat(annotation.reason())
            .as("element with all mappings decommissioned → reason=all_mappings_decommissioned")
            .isEqualTo(DecommissionedInTargetAnnotationDto.REASON_ALL_DECOMMISSIONED);
    }

    // -----------------------------------------------------------------------
    // Test 4: mapping-suggest is read-only — no row mutations across the call
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("mapping-suggest performs zero row mutations across the call (read-only contract)")
    void mappingSuggestPerformsNoRowMutations() {
        when(architectureRepository.findById(CURRENT_ARCH_ID))
            .thenReturn(Optional.of(currentArch()));

        // One candidate per supertype table — exact name match should score 1.0
        Map<String, Object> row = new HashMap<>();
        row.put("element_id", SOURCE_ELEMENT_ID);
        row.put("element_name", "Order Service");
        when(jdbcTemplate.queryForList(any(String.class), eq(CURRENT_ARCH_ID)))
            .thenReturn(List.of(row));

        MappingSuggestRequest request = new MappingSuggestRequest(
            null,
            new MappingSuggestTargetSnapshot("Order Service", null, null));

        MappingSuggestResponse response = mappingSuggestService.suggest(
            PROJECT_ID, CURRENT_ARCH_ID, request);

        assertThat(response.candidates()).isNotEmpty();
        assertThat(response.candidates().get(0).name()).isEqualTo("Order Service");
        assertThat(response.candidates().get(0).confidence()).isEqualTo(1.0);

        // Strict read-only assertion: NO writes hit jdbcTemplate or the mapping
        // repository. We never call any update / delete / saveAndFlush surface.
        verify(jdbcTemplate, never()).update(any(String.class), any(Object[].class));
        verify(jdbcTemplate, never()).update(any(String.class));
        verify(mappingRepository, never()).save(any(ArchitectureElementMappingEntity.class));
        verify(mappingRepository, never()).saveAndFlush(any(ArchitectureElementMappingEntity.class));
        verify(architectureRepository, never()).save(any(ArchitectureEntity.class));
        verify(architectureRepository, never()).saveAndFlush(any(ArchitectureEntity.class));
    }
}
