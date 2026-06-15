package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.exception.DuplicateArchitectureElementMappingException;
import com.example.architecturemodel.exception.SameArchitectureCopyException;
import com.example.architecturemodel.model.dto.ArchitectureElementMappingDto;
import com.example.architecturemodel.model.dto.CreateArchitectureElementMappingRequest;
import com.example.architecturemodel.model.dto.UpdateArchitectureElementMappingRequest;
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
import org.springframework.dao.DataIntegrityViolationException;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link ArchitectureElementMappingService}.
 *
 * <p>Covers Task Group 2.1 service-layer contracts:</p>
 * <ol>
 *   <li>Create happy path: fields persisted, server-side
 *       {@code created_by_task} = {@code "mapping-review-modal-add"},
 *       {@code confidence} pass-through (NOT defaulted to 1.0).</li>
 *   <li>Validation: {@code source == target} -> {@link SameArchitectureCopyException};
 *       {@code mapping_type} / {@code status} not in v1 lists ->
 *       {@link IllegalArgumentException}.</li>
 *   <li>Duplicate: typed
 *       {@link DuplicateArchitectureElementMappingException} thrown on
 *       compound-key collision (controller maps to 422
 *       {@code {code: "duplicate_mapping"}}).</li>
 *   <li>Update: only mutable fields touched; server overwrites
 *       {@code created_by_task} to {@code "mapping-review-modal-edit"}.</li>
 *   <li>Update: PATCH semantics for ALL FOUR mutable fields -- absent JSON
 *       key (Jackson-bound to null on the boxed/reference DTO field) means
 *       "preserve existing value". Boxed {@link Double} on confidence is
 *       what makes this safe under Jackson's default binding.</li>
 *   <li>Update: empty-string notes is the v1 clear-notes signal.</li>
 * </ol>
 *
 * <p>Spec: Create Target Baseline from Current State (2026-05-15) -- Task Group 2</p>
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureElementMappingServiceTest {

    @Mock
    private ArchitectureElementMappingRepository repository;

    @Mock
    private ArchitectureRepository architectureRepository;

    private ArchitectureElementMappingService service;

    private UUID projectId;
    private UUID sourceArch;
    private UUID targetArch;

    @BeforeEach
    void setUp() {
        service = new ArchitectureElementMappingService(repository, architectureRepository);
        projectId = UUID.randomUUID();
        sourceArch = UUID.randomUUID();
        targetArch = UUID.randomUUID();

        // Default architecture fixtures: both belong to project, neither archived.
        lenient().when(architectureRepository.findById(sourceArch))
            .thenReturn(Optional.of(buildArch(sourceArch, projectId)));
        lenient().when(architectureRepository.findById(targetArch))
            .thenReturn(Optional.of(buildArch(targetArch, projectId)));
    }

    private static ArchitectureEntity buildArch(UUID id, UUID projectId) {
        return ArchitectureEntity.builder()
            .id(id)
            .projectId(projectId)
            .name("Arch-" + id)
            .archived(false)
            .build();
    }

    private CreateArchitectureElementMappingRequest happyCreate(
            String mappingType, String status, Double confidence) {
        return new CreateArchitectureElementMappingRequest(
            sourceArch,
            targetArch,
            "applications",
            "src-app-1",
            "applications",
            "tgt-app-1",
            mappingType,
            status,
            "Manually added rationale",
            confidence
        );
    }

    @Test
    @DisplayName("create happy path persists fields, sets created_by_task=mapping-review-modal-add, honours confidence verbatim")
    void createHappyPath() {
        when(repository.saveAndFlush(any(ArchitectureElementMappingEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        // No duplicate exists.
        when(repository
            .existsByProjectIdAndSourceArchitectureIdAndTargetArchitectureIdAndSourceElementTypeAndSourceElementIdAndTargetElementTypeAndTargetElementIdAndMappingType(
                any(), any(), any(), anyString(), anyString(), anyString(), anyString(), anyString()))
            .thenReturn(false);

        CreateArchitectureElementMappingRequest req = happyCreate("equivalent", "confirmed", null);
        ArchitectureElementMappingDto dto = service.create(projectId, req);

        ArgumentCaptor<ArchitectureElementMappingEntity> captor =
            ArgumentCaptor.forClass(ArchitectureElementMappingEntity.class);
        verify(repository).saveAndFlush(captor.capture());
        ArchitectureElementMappingEntity saved = captor.getValue();

        assertThat(saved.getProjectId()).isEqualTo(projectId);
        assertThat(saved.getSourceArchitectureId()).isEqualTo(sourceArch);
        assertThat(saved.getTargetArchitectureId()).isEqualTo(targetArch);
        assertThat(saved.getSourceElementType()).isEqualTo("applications");
        assertThat(saved.getSourceElementId()).isEqualTo("src-app-1");
        assertThat(saved.getTargetElementType()).isEqualTo("applications");
        assertThat(saved.getTargetElementId()).isEqualTo("tgt-app-1");
        assertThat(saved.getMappingType()).isEqualTo("equivalent");
        assertThat(saved.getStatus()).isEqualTo("confirmed");
        assertThat(saved.getCreatedByTask())
            .as("Manual create via service must use mapping-review-modal-add")
            .isEqualTo("mapping-review-modal-add");
        assertThat(saved.getNotes()).isEqualTo("Manually added rationale");
        assertThat(saved.getConfidence())
            .as("Manual-add path must NOT default confidence to 1.0; null in -> null out")
            .isNull();
        assertThat(dto.createdByTask()).isEqualTo("mapping-review-modal-add");
    }

    @Test
    @DisplayName("create rejects when source_architecture_id == target_architecture_id and when mapping_type/status are not in v1 lists")
    void createRejectsInvalidInputs() {
        // 1. source == target. Service throws SameArchitectureCopyException
        // from validateArchitectures (called AFTER validateBody, so input
        // validation passes). No architecture lookup is needed.
        UUID same = UUID.randomUUID();
        lenient().when(architectureRepository.findById(same))
            .thenReturn(Optional.of(buildArch(same, projectId)));
        CreateArchitectureElementMappingRequest reqSame = new CreateArchitectureElementMappingRequest(
            same, same,
            "applications", "src", "applications", "tgt",
            "equivalent", "confirmed", null, null);
        assertThatThrownBy(() -> service.create(projectId, reqSame))
            .isInstanceOf(SameArchitectureCopyException.class);

        // 2. unknown mapping_type.
        CreateArchitectureElementMappingRequest badMapping = happyCreate(
            "deprecated_v0", "confirmed", null);
        assertThatThrownBy(() -> service.create(projectId, badMapping))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("mappingType")
            .hasMessageContaining("deprecated_v0");

        // 3. unknown status.
        CreateArchitectureElementMappingRequest badStatus = happyCreate(
            "equivalent", "in_review_v0", null);
        assertThatThrownBy(() -> service.create(projectId, badStatus))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("status")
            .hasMessageContaining("in_review_v0");
    }

    @Test
    @DisplayName("create returns DuplicateArchitectureElementMappingException on compound-key collision")
    void createDuplicateThrowsTypedException() {
        // Compound-key existence check returns true; the existing row in the
        // arch-pair list has a DIFFERENT id, so the service throws.
        when(repository
            .existsByProjectIdAndSourceArchitectureIdAndTargetArchitectureIdAndSourceElementTypeAndSourceElementIdAndTargetElementTypeAndTargetElementIdAndMappingType(
                any(), any(), any(), anyString(), anyString(), anyString(), anyString(), anyString()))
            .thenReturn(true);
        ArchitectureElementMappingEntity existing = ArchitectureElementMappingEntity.builder()
            .id(UUID.randomUUID()) // different id from the one the service will assign
            .projectId(projectId)
            .sourceArchitectureId(sourceArch)
            .targetArchitectureId(targetArch)
            .sourceElementType("applications")
            .sourceElementId("src-app-1")
            .targetElementType("applications")
            .targetElementId("tgt-app-1")
            .mappingType("equivalent")
            .status("confirmed")
            .createdByTask("mapping-review-modal-add")
            .build();
        when(repository.findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                projectId, sourceArch, targetArch))
            .thenReturn(List.of(existing));

        assertThatThrownBy(() -> service.create(projectId, happyCreate("equivalent", "confirmed", null)))
            .isInstanceOf(DuplicateArchitectureElementMappingException.class);
    }

    @Test
    @DisplayName("create surfaces DuplicateArchitectureElementMappingException when DB raises DataIntegrityViolation as race-safety net")
    void createDuplicateSurfacesFromDbViolation() {
        // existsBy... returns false (race), but DB-level constraint fires.
        when(repository
            .existsByProjectIdAndSourceArchitectureIdAndTargetArchitectureIdAndSourceElementTypeAndSourceElementIdAndTargetElementTypeAndTargetElementIdAndMappingType(
                any(), any(), any(), anyString(), anyString(), anyString(), anyString(), anyString()))
            .thenReturn(false);
        when(repository.saveAndFlush(any(ArchitectureElementMappingEntity.class)))
            .thenThrow(new DataIntegrityViolationException("unique constraint architecture_element_mappings_unique_pair"));

        assertThatThrownBy(() -> service.create(projectId, happyCreate("equivalent", "confirmed", null)))
            .isInstanceOf(DuplicateArchitectureElementMappingException.class);
    }

    @Test
    @DisplayName("update touches only mutable fields and sets created_by_task=mapping-review-modal-edit")
    void updateOnlyMutableFieldsAndOverridesCreatedByTask() {
        UUID mappingId = UUID.randomUUID();
        ArchitectureElementMappingEntity existing = ArchitectureElementMappingEntity.builder()
            .id(mappingId)
            .projectId(projectId)
            .sourceArchitectureId(sourceArch)
            .targetArchitectureId(targetArch)
            .sourceElementType("applications")
            .sourceElementId("src-app-1")
            .targetElementType("applications")
            .targetElementId("tgt-app-1")
            .mappingType("equivalent")
            .status("confirmed")
            .createdByTask("selective-copy-with-auto-map")
            .confidence(1.0)
            .notes("auto-asserted equivalence")
            .build();
        when(repository.findById(mappingId)).thenReturn(Optional.of(existing));
        when(repository.saveAndFlush(any(ArchitectureElementMappingEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        // Compound-key existence: only the row we're updating matches, so existsBy returns true,
        // and the in-list scan finds the same id -> not a duplicate.
        when(repository
            .existsByProjectIdAndSourceArchitectureIdAndTargetArchitectureIdAndSourceElementTypeAndSourceElementIdAndTargetElementTypeAndTargetElementIdAndMappingType(
                any(), any(), any(), anyString(), anyString(), anyString(), anyString(), anyString()))
            .thenReturn(true);
        when(repository.findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                projectId, sourceArch, targetArch))
            .thenReturn(List.of(existing));

        UpdateArchitectureElementMappingRequest req = new UpdateArchitectureElementMappingRequest(
            "renamed", "needs_review", "user clarified rename rationale", 0.6);
        ArchitectureElementMappingDto dto = service.update(projectId, mappingId, req);

        // Mutable fields updated.
        assertThat(existing.getMappingType()).isEqualTo("renamed");
        assertThat(existing.getStatus()).isEqualTo("needs_review");
        assertThat(existing.getNotes()).isEqualTo("user clarified rename rationale");
        assertThat(existing.getConfidence()).isEqualTo(0.6);

        // Immutable fields unchanged.
        assertThat(existing.getSourceArchitectureId()).isEqualTo(sourceArch);
        assertThat(existing.getTargetArchitectureId()).isEqualTo(targetArch);
        assertThat(existing.getSourceElementId()).isEqualTo("src-app-1");
        assertThat(existing.getTargetElementId()).isEqualTo("tgt-app-1");

        // created_by_task overwritten server-side.
        assertThat(existing.getCreatedByTask())
            .as("PUT must overwrite created_by_task to mapping-review-modal-edit")
            .isEqualTo("mapping-review-modal-edit");
        assertThat(dto.createdByTask()).isEqualTo("mapping-review-modal-edit");
    }

    @Test
    @DisplayName("update with all-null PATCH body preserves every mutable field (true PATCH semantics; absent JSON key = no change)")
    void updateAllNullFieldsPreserveExistingValues() {
        UUID mappingId = UUID.randomUUID();
        ArchitectureElementMappingEntity existing = ArchitectureElementMappingEntity.builder()
            .id(mappingId)
            .projectId(projectId)
            .sourceArchitectureId(sourceArch)
            .targetArchitectureId(targetArch)
            .sourceElementType("applications")
            .sourceElementId("src-app-1")
            .targetElementType("applications")
            .targetElementId("tgt-app-1")
            .mappingType("equivalent")
            .status("confirmed")
            .createdByTask("selective-copy-with-auto-map")
            .confidence(1.0)
            .notes("auto-asserted equivalence")
            .build();
        when(repository.findById(mappingId)).thenReturn(Optional.of(existing));
        when(repository.saveAndFlush(any(ArchitectureElementMappingEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(repository
            .existsByProjectIdAndSourceArchitectureIdAndTargetArchitectureIdAndSourceElementTypeAndSourceElementIdAndTargetElementTypeAndTargetElementIdAndMappingType(
                any(), any(), any(), anyString(), anyString(), anyString(), anyString(), anyString()))
            .thenReturn(true);
        when(repository.findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                projectId, sourceArch, targetArch))
            .thenReturn(List.of(existing));

        UpdateArchitectureElementMappingRequest req = new UpdateArchitectureElementMappingRequest(
            null, null, null, null);
        service.update(projectId, mappingId, req);

        // All four mutable fields preserve their existing values when the
        // PATCH body sends null. This is true PATCH (RFC 5789): absent key
        // means "do not touch". The boxed Double on confidence is what
        // makes this safe -- a primitive double would have wiped the
        // existing 1.0 to 0.0 on Jackson-bind.
        assertThat(existing.getMappingType()).isEqualTo("equivalent");
        assertThat(existing.getStatus()).isEqualTo("confirmed");
        assertThat(existing.getNotes())
            .as("Notes preserved on null PATCH (edit-just-the-confidence must not wipe notes)")
            .isEqualTo("auto-asserted equivalence");
        assertThat(existing.getConfidence())
            .as("Confidence preserved on null PATCH (edit-just-the-notes must not wipe confidence)")
            .isEqualTo(1.0);
        // created_by_task is always overwritten server-side, even on a no-op PATCH.
        assertThat(existing.getCreatedByTask()).isEqualTo("mapping-review-modal-edit");
    }

    @Test
    @DisplayName("update with explicit empty-string notes writes empty string (clear-notes via PATCH)")
    void updateEmptyStringNotesClears() {
        UUID mappingId = UUID.randomUUID();
        ArchitectureElementMappingEntity existing = ArchitectureElementMappingEntity.builder()
            .id(mappingId)
            .projectId(projectId)
            .sourceArchitectureId(sourceArch)
            .targetArchitectureId(targetArch)
            .sourceElementType("applications")
            .sourceElementId("src-app-1")
            .targetElementType("applications")
            .targetElementId("tgt-app-1")
            .mappingType("equivalent")
            .status("confirmed")
            .createdByTask("selective-copy-with-auto-map")
            .confidence(1.0)
            .notes("auto-asserted equivalence")
            .build();
        when(repository.findById(mappingId)).thenReturn(Optional.of(existing));
        when(repository.saveAndFlush(any(ArchitectureElementMappingEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(repository
            .existsByProjectIdAndSourceArchitectureIdAndTargetArchitectureIdAndSourceElementTypeAndSourceElementIdAndTargetElementTypeAndTargetElementIdAndMappingType(
                any(), any(), any(), anyString(), anyString(), anyString(), anyString(), anyString()))
            .thenReturn(true);
        when(repository.findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                projectId, sourceArch, targetArch))
            .thenReturn(List.of(existing));

        UpdateArchitectureElementMappingRequest req = new UpdateArchitectureElementMappingRequest(
            null, null, "", null);
        service.update(projectId, mappingId, req);

        assertThat(existing.getNotes())
            .as("Empty-string notes is the v1 clear-notes signal (null preserves)")
            .isEqualTo("");
        // Other fields untouched.
        assertThat(existing.getConfidence()).isEqualTo(1.0);
        assertThat(existing.getMappingType()).isEqualTo("equivalent");
        assertThat(existing.getStatus()).isEqualTo("confirmed");
    }

    @Test
    @DisplayName("create rejects when target architecture belongs to a different project")
    void createRejectsCrossProjectArchitecture() {
        UUID otherProjectArch = UUID.randomUUID();
        when(architectureRepository.findById(otherProjectArch))
            .thenReturn(Optional.of(buildArch(otherProjectArch, UUID.randomUUID()))); // different project
        CreateArchitectureElementMappingRequest req = new CreateArchitectureElementMappingRequest(
            sourceArch, otherProjectArch,
            "applications", "src", "applications", "tgt",
            "equivalent", "confirmed", null, null);

        assertThatThrownBy(() -> service.create(projectId, req))
            .isInstanceOf(ArchitectureNotFoundException.class);
    }
}
