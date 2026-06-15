package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.migration.MissingInputResolutionCreateRequest;
import com.example.architecturemodel.model.dto.migration.MissingInputResolutionDto;
import com.example.architecturemodel.model.entity.MissingInputResolutionEntity;
import com.example.architecturemodel.repository.entity.MissingInputResolutionRepository;
import com.example.architecturemodel.service.MissingInputKeyHasher;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Focused unit tests for {@link MissingInputResolutionService}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 2.</p>
 *
 * <p>Five focused tests cover the persistence + CRUD contracts called out in
 * Task 2.1:</p>
 * <ol>
 *   <li>{@link #create_persistsWithStampedFieldsAndDefaults} -- create stamps
 *       {@code resolved_at} and {@code resolved_by}, defaults
 *       {@code soft_deleted=false}, and persists every boxed field through
 *       the repository.</li>
 *   <li>{@link #create_conflictWhenActiveResolutionExistsForSameProjectKey} --
 *       conflict raised when an active resolution for the same
 *       {@code (projectId, key)} already exists; no save attempted (mirrors
 *       the partial unique index at the DB layer).</li>
 *   <li>{@link #create_sameKeyInDifferentProjectSucceeds} -- the partial
 *       unique constraint is scoped per project; the same key in a different
 *       project does NOT conflict.</li>
 *   <li>{@link #list_returnsOnlyActiveRows} -- list path delegates to the
 *       {@code findByProjectIdAndSoftDeletedFalse} finder so soft-deleted rows
 *       are filtered at the DB layer.</li>
 *   <li>{@link #softDelete_stampsAuditFields} -- soft-delete sets
 *       {@code softDeleted=true} and stamps {@code softDeletedAt} /
 *       {@code softDeletedBy}; returns the audited DTO.</li>
 * </ol>
 *
 * <p>Pattern: pure Mockito (no Spring context) following
 * {@code ArchitectureElementMappingServiceTest}. The {@link MissingInputKeyHasher}
 * dependency is a real instance (it is stateless and deterministic) so the
 * tests can assert on the produced key when the per-type canonical-descriptor
 * path is exercised.</p>
 */
@ExtendWith(MockitoExtension.class)
class MissingInputResolutionServiceTest {

    @Mock
    private MissingInputResolutionRepository repository;

    private final MissingInputKeyHasher hasher = new MissingInputKeyHasher();

    private MissingInputResolutionService service;

    private UUID projectId;

    @BeforeEach
    void setUp() {
        service = new MissingInputResolutionService(repository, hasher);
        projectId = UUID.randomUUID();
    }

    // ------------------------------------------------------------------
    // create
    // ------------------------------------------------------------------

    @Test
    @DisplayName("create stamps resolved_at + resolved_by, defaults soft_deleted=false, persists payload verbatim")
    void create_persistsWithStampedFieldsAndDefaults() {
        // No existing active resolution for this (project, key) tuple.
        when(repository.findByProjectIdAndMissingInputKeyAndSoftDeletedFalse(any(), any()))
            .thenReturn(Optional.empty());
        when(repository.save(any(MissingInputResolutionEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        Map<String, Object> payload = new HashMap<>();
        payload.put("contractBlobId", "blob-123");
        payload.put("filename", "payments.yaml");
        payload.put("format", "oas");
        payload.put("operationsCount", 17);

        MissingInputResolutionCreateRequest req = new MissingInputResolutionCreateRequest(
            /* missingInputKey */ null,
            /* missingInputType */ "api_contract",
            /* canonicalDescriptor */ null,
            /* serviceName */ "PaymentsService",
            /* operationName */ "createPayment",
            /* sourceElementId */ null,
            /* targetElementId */ null,
            /* targetElementLogicalName */ null,
            /* resolutionPayload */ payload,
            /* resolvedBy */ "alice@example.com");

        Instant before = Instant.now();
        MissingInputResolutionDto dto = service.create(projectId, req);
        Instant after = Instant.now();

        // Capture the persisted entity.
        ArgumentCaptor<MissingInputResolutionEntity> captor =
            ArgumentCaptor.forClass(MissingInputResolutionEntity.class);
        verify(repository).save(captor.capture());
        MissingInputResolutionEntity saved = captor.getValue();

        // Boxed types throughout -- verify field assignments persist.
        assertThat(saved.getId()).isNotNull();
        assertThat(saved.getProjectId()).isEqualTo(projectId);
        assertThat(saved.getMissingInputType()).isEqualTo("api_contract");
        assertThat(saved.getResolutionPayloadJson()).isEqualTo(payload);
        assertThat(saved.getResolvedBy()).isEqualTo("alice@example.com");
        assertThat(saved.getSoftDeleted())
            .as("soft_deleted defaulted to FALSE on insert")
            .isEqualTo(Boolean.FALSE);
        assertThat(saved.getSoftDeletedAt()).isNull();
        assertThat(saved.getSoftDeletedBy()).isNull();
        assertThat(saved.getResolvedAt())
            .as("resolved_at stamped between before and after")
            .isBetween(before.minusSeconds(1), after.plusSeconds(1));

        // The key was computed from the canonical (service, operation)
        // pair via MissingInputKeyHasher -- assert it matches the helper.
        String expectedKey = hasher.computeKey(
            "api_contract",
            hasher.canonicalDescriptorForApiContract("PaymentsService", "createPayment"));
        assertThat(saved.getMissingInputKey())
            .as("key computed from canonical descriptor")
            .isEqualTo(expectedKey)
            .hasSize(16)
            .matches("[0-9a-f]{16}");

        // DTO mirrors the persisted entity (audit-channel snapshot).
        assertThat(dto.id()).isEqualTo(saved.getId());
        assertThat(dto.missingInputKey()).isEqualTo(expectedKey);
        assertThat(dto.softDeleted()).isEqualTo(Boolean.FALSE);
        assertThat(dto.resolvedBy()).isEqualTo("alice@example.com");
    }

    @Test
    @DisplayName("create raises ConflictException when an active resolution already exists for the same (projectId, key); no save attempted")
    void create_conflictWhenActiveResolutionExistsForSameProjectKey() {
        String preComputedKey = hasher.computeKey(
            "mapping",
            hasher.canonicalDescriptorForMapping("src-elem-1", "tgt-elem-1"));

        MissingInputResolutionEntity existing = MissingInputResolutionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .missingInputKey(preComputedKey)
            .missingInputType("mapping")
            .resolvedAt(Instant.now())
            .resolvedBy("prior-user@example.com")
            .softDeleted(Boolean.FALSE)
            .build();
        when(repository.findByProjectIdAndMissingInputKeyAndSoftDeletedFalse(
                projectId, preComputedKey))
            .thenReturn(Optional.of(existing));

        Map<String, Object> payload = new HashMap<>();
        payload.put("sourceElementId", "src-elem-1");
        payload.put("targetElementId", "tgt-elem-1");
        payload.put("mappingRefId", UUID.randomUUID().toString());

        MissingInputResolutionCreateRequest req = new MissingInputResolutionCreateRequest(
            /* missingInputKey */ preComputedKey,
            /* missingInputType */ "mapping",
            /* canonicalDescriptor */ null,
            null, null, null, null, null,
            payload,
            "bob@example.com");

        assertThatThrownBy(() -> service.create(projectId, req))
            .isInstanceOf(ConflictException.class)
            .hasMessageContaining(preComputedKey);

        // CRITICAL: no save attempted -- the partial unique index is a
        // defence-in-depth net, but the service must short-circuit first.
        verify(repository, never()).save(any(MissingInputResolutionEntity.class));
    }

    @Test
    @DisplayName("create with same key in a DIFFERENT project succeeds (partial unique constraint is per project)")
    void create_sameKeyInDifferentProjectSucceeds() {
        UUID otherProjectId = UUID.randomUUID();
        String sharedKey = hasher.computeKey(
            "target_element",
            hasher.canonicalDescriptorForArchElement("customer-orders-service"));

        // Active resolution exists for OTHER project, NOT for `projectId`.
        when(repository.findByProjectIdAndMissingInputKeyAndSoftDeletedFalse(
                projectId, sharedKey))
            .thenReturn(Optional.empty());
        when(repository.save(any(MissingInputResolutionEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        Map<String, Object> payload = new HashMap<>();
        payload.put("targetElementId", UUID.randomUUID().toString());

        MissingInputResolutionCreateRequest req = new MissingInputResolutionCreateRequest(
            /* missingInputKey */ sharedKey,
            /* missingInputType */ "target_element",
            /* canonicalDescriptor */ null,
            null, null, null, null, null,
            payload,
            "carol@example.com");

        MissingInputResolutionDto dto = service.create(projectId, req);

        ArgumentCaptor<MissingInputResolutionEntity> captor =
            ArgumentCaptor.forClass(MissingInputResolutionEntity.class);
        verify(repository).save(captor.capture());
        MissingInputResolutionEntity saved = captor.getValue();

        // Scope is per project -- the row lands under THIS projectId even
        // though the same key is already used in `otherProjectId`.
        assertThat(saved.getProjectId()).isEqualTo(projectId);
        assertThat(saved.getProjectId()).isNotEqualTo(otherProjectId);
        assertThat(saved.getMissingInputKey()).isEqualTo(sharedKey);
        assertThat(saved.getMissingInputType()).isEqualTo("target_element");
        assertThat(dto.missingInputKey()).isEqualTo(sharedKey);
        assertThat(dto.projectId()).isEqualTo(projectId);
    }

    // ------------------------------------------------------------------
    // list
    // ------------------------------------------------------------------

    @Test
    @DisplayName("list returns only active rows (delegates to findByProjectIdAndSoftDeletedFalse), ordered by resolved_at DESC")
    void list_returnsOnlyActiveRows() {
        Instant t0 = Instant.parse("2026-01-01T10:00:00Z");
        Instant t1 = Instant.parse("2026-02-01T10:00:00Z");
        Instant t2 = Instant.parse("2026-03-01T10:00:00Z");

        MissingInputResolutionEntity oldest = MissingInputResolutionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .missingInputKey("aaaa111122223333")
            .missingInputType("api_contract")
            .resolvedAt(t0)
            .resolvedBy("alice@example.com")
            .softDeleted(Boolean.FALSE)
            .build();
        MissingInputResolutionEntity middle = MissingInputResolutionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .missingInputKey("bbbb111122223333")
            .missingInputType("mapping")
            .resolvedAt(t1)
            .resolvedBy("bob@example.com")
            .softDeleted(Boolean.FALSE)
            .build();
        MissingInputResolutionEntity newest = MissingInputResolutionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .missingInputKey("cccc111122223333")
            .missingInputType("target_element")
            .resolvedAt(t2)
            .resolvedBy("carol@example.com")
            .softDeleted(Boolean.FALSE)
            .build();
        // The finder ALREADY filters at the DB layer (WHERE soft_deleted =
        // FALSE) -- this test asserts the service delegates to that finder
        // and applies the newest-first sort defensively.
        when(repository.findByProjectIdAndSoftDeletedFalse(projectId))
            .thenReturn(List.of(oldest, middle, newest));

        List<MissingInputResolutionDto> rows = service.list(projectId);

        // Service called the soft-deleted-FALSE finder (NOT the all-rows
        // finder), so soft-deleted rows are filtered at the DB layer.
        verify(repository).findByProjectIdAndSoftDeletedFalse(projectId);

        // Newest first.
        assertThat(rows).hasSize(3);
        assertThat(rows.get(0).missingInputKey()).isEqualTo("cccc111122223333");
        assertThat(rows.get(1).missingInputKey()).isEqualTo("bbbb111122223333");
        assertThat(rows.get(2).missingInputKey()).isEqualTo("aaaa111122223333");

        // Every returned row is active.
        assertThat(rows).allSatisfy(r ->
            assertThat(r.softDeleted()).isEqualTo(Boolean.FALSE));
    }

    // ------------------------------------------------------------------
    // softDelete
    // ------------------------------------------------------------------

    @Test
    @DisplayName("softDelete sets soft_deleted=true and stamps soft_deleted_at + soft_deleted_by; returns audited DTO")
    void softDelete_stampsAuditFields() {
        UUID resolutionId = UUID.randomUUID();
        Instant resolvedAt = Instant.parse("2026-03-15T10:00:00Z");
        MissingInputResolutionEntity row = MissingInputResolutionEntity.builder()
            .id(resolutionId)
            .projectId(projectId)
            .missingInputKey("dddd444455556666")
            .missingInputType("api_contract")
            .resolvedAt(resolvedAt)
            .resolvedBy("alice@example.com")
            .softDeleted(Boolean.FALSE)
            .createdAt(resolvedAt)
            .updatedAt(resolvedAt)
            .build();
        when(repository.findById(resolutionId)).thenReturn(Optional.of(row));
        when(repository.save(any(MissingInputResolutionEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        Instant before = Instant.now();
        MissingInputResolutionDto dto = service.softDelete(
            projectId, resolutionId, "dave@example.com");
        Instant after = Instant.now();

        // Row mutated in place + saved.
        assertThat(row.getSoftDeleted()).isEqualTo(Boolean.TRUE);
        assertThat(row.getSoftDeletedAt())
            .isBetween(before.minusSeconds(1), after.plusSeconds(1));
        assertThat(row.getSoftDeletedBy()).isEqualTo("dave@example.com");

        // Audit fields preserved on the un-soft-deleted bits.
        assertThat(row.getResolvedAt()).isEqualTo(resolvedAt);
        assertThat(row.getResolvedBy()).isEqualTo("alice@example.com");

        // DTO carries the audited snapshot post-soft-delete.
        assertThat(dto.id()).isEqualTo(resolutionId);
        assertThat(dto.softDeleted()).isEqualTo(Boolean.TRUE);
        assertThat(dto.softDeletedBy()).isEqualTo("dave@example.com");
        assertThat(dto.softDeletedAt())
            .isBetween(before.minusSeconds(1), after.plusSeconds(1));

        // Project-scope enforcement: a cross-project soft-delete masquerades
        // as 404 (ResourceNotFoundException) per the discovery-child
        // convention.
        UUID otherProjectId = UUID.randomUUID();
        assertThatThrownBy(() -> service.softDelete(
                otherProjectId, resolutionId, "evil@example.com"))
            .isInstanceOf(ResourceNotFoundException.class);
    }
}
