package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MissingInputResolutionCreateRequest;
import com.example.architecturemodel.model.dto.migration.MissingInputResolutionDto;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.service.MissingInputKeyHasher;
import com.example.architecturemodel.service.migration.MissingInputResolutionBulkService.BulkResolveItem;
import com.example.architecturemodel.service.migration.MissingInputResolutionBulkService.BulkResolveResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Focused JUnit tests for {@link MissingInputResolutionBulkService}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 3.5.</p>
 *
 * <p>Two tests covering the preview / commit branching contract:</p>
 * <ol>
 *   <li>{@link #bulkResolve_previewReturnsAffectedSpecIdsWithoutWriting} --
 *       {@code commit=false} returns the per-key preview row with the affected
 *       spec ids and NEVER calls
 *       {@link MissingInputResolutionService#create(UUID,
 *       MissingInputResolutionCreateRequest)}.</li>
 *   <li>{@link #bulkResolve_commitInsertsResolutionsInOneTransaction} --
 *       {@code commit=true} inserts one resolution per intersecting item via
 *       the create primitive in a single transaction.</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class MissingInputResolutionBulkServiceTest {

    @Mock
    private MissingInputResolutionService resolutionService;

    @Mock
    private MigrationStorySpecGenerationRepository specRepository;

    private MissingInputResolutionBulkService bulkService;

    private MissingInputKeyHasher hasher;

    private UUID projectId;

    @BeforeEach
    void setUp() {
        hasher = new MissingInputKeyHasher();
        bulkService = new MissingInputResolutionBulkService(
            resolutionService, specRepository, hasher);
        projectId = UUID.randomUUID();
    }

    @Test
    @DisplayName("bulkResolve with commit=false returns the affected-spec list WITHOUT calling create")
    void bulkResolve_previewReturnsAffectedSpecIdsWithoutWriting() {
        // Two items in the upload: one api_contract (matches a spec in the
        // project) and one mapping (does NOT match -- dropped from preview).
        BulkResolveItem matching = new BulkResolveItem(
            "api_contract", "PaymentsService", "createPayment",
            null, null, null, null);
        BulkResolveItem orphan = new BulkResolveItem(
            "mapping", null, null,
            "src-no-match", "tgt-no-match", null, null);

        String matchingKey = hasher.computeKey(
            "api_contract",
            hasher.canonicalDescriptorForApiContract("PaymentsService", "createPayment"));

        UUID spec1Id = UUID.randomUUID();
        UUID spec2Id = UUID.randomUUID();
        // Two specs in the project: both reference the matching key.
        MigrationStorySpecGenerationEntity s1 = buildSpec(spec1Id, matchingKey);
        MigrationStorySpecGenerationEntity s2 = buildSpec(spec2Id, matchingKey);
        when(specRepository.findByProjectId(projectId)).thenReturn(List.of(s1, s2));

        BulkResolveResponse response = bulkService.bulkResolve(
            projectId, List.of(matching, orphan),
            /* commit */ Boolean.FALSE,
            null /* resolvedBy not required on preview */);

        // Preview surface: previewOnly=true, the orphan item is dropped, and
        // the matching item lists BOTH spec ids.
        assertThat(response.previewOnly()).isEqualTo(Boolean.TRUE);
        assertThat(response.resolutions()).hasSize(1);
        assertThat(response.resolutions().get(0).key()).isEqualTo(matchingKey);
        assertThat(response.resolutions().get(0).missingInputType()).isEqualTo("api_contract");
        assertThat(response.resolutions().get(0).affectedSpecIds())
            .containsExactlyInAnyOrder(spec1Id, spec2Id);

        // CRITICAL: no writes on preview.
        verify(resolutionService, never()).create(any(UUID.class),
            any(MissingInputResolutionCreateRequest.class));
    }

    @Test
    @DisplayName("bulkResolve with commit=true inserts one resolution per intersecting item in one transaction")
    void bulkResolve_commitInsertsResolutionsInOneTransaction() {
        BulkResolveItem apiItem = new BulkResolveItem(
            "api_contract", "OrdersService", "placeOrder",
            null, null, null, null);
        BulkResolveItem targetItem = new BulkResolveItem(
            "target_element", null, null,
            null, null, "OrderService", null);

        String apiKey = hasher.computeKey(
            "api_contract",
            hasher.canonicalDescriptorForApiContract("OrdersService", "placeOrder"));
        String targetKey = hasher.computeKey(
            "target_element",
            hasher.canonicalDescriptorForArchElement("OrderService"));

        UUID specId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity spec = buildSpec(specId, apiKey, targetKey);
        when(specRepository.findByProjectId(projectId)).thenReturn(List.of(spec));

        // Stub create to return a dummy DTO so the service can continue.
        when(resolutionService.create(eq(projectId),
                any(MissingInputResolutionCreateRequest.class)))
            .thenAnswer(inv -> {
                MissingInputResolutionCreateRequest req = inv.getArgument(1);
                return new MissingInputResolutionDto(
                    UUID.randomUUID(), projectId, req.missingInputKey(),
                    req.missingInputType(), req.resolutionPayload(),
                    Instant.now(), req.resolvedBy(),
                    Boolean.FALSE, null, null,
                    Instant.now(), Instant.now());
            });

        BulkResolveResponse response = bulkService.bulkResolve(
            projectId, List.of(apiItem, targetItem),
            /* commit */ Boolean.TRUE,
            "alice@example.com");

        // Both items intersected with the spec; both got persisted.
        assertThat(response.previewOnly()).isEqualTo(Boolean.FALSE);
        assertThat(response.resolutions()).hasSize(2);

        ArgumentCaptor<MissingInputResolutionCreateRequest> cap =
            ArgumentCaptor.forClass(MissingInputResolutionCreateRequest.class);
        verify(resolutionService, times(2)).create(eq(projectId), cap.capture());

        List<MissingInputResolutionCreateRequest> captured = cap.getAllValues();
        assertThat(captured).extracting(MissingInputResolutionCreateRequest::missingInputKey)
            .containsExactlyInAnyOrder(apiKey, targetKey);
        assertThat(captured).allSatisfy(req ->
            assertThat(req.resolvedBy()).isEqualTo("alice@example.com"));
    }

    private MigrationStorySpecGenerationEntity buildSpec(UUID id, String... keys) {
        return MigrationStorySpecGenerationEntity.builder()
            .id(id)
            .projectId(projectId)
            .workItemId(UUID.randomUUID())
            .status(MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT)
            .missingInputKeysJson(new ArrayList<>(List.of(keys)))
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }
}
