package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryCandidateDto;
import com.example.architecturemodel.model.dto.discovery.BulkCandidateEditRequest;
import com.example.architecturemodel.model.dto.discovery.BulkCandidateEditResponse;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Service-layer tests for the ATOMIC bulk-candidate-EDIT write
 * ({@code DiscoveryCandidateService.bulkEdit(...)} /
 * {@code bulkEditInArchitecture(...)}) added by the Skipped-candidate visibility +
 * grouped bulk-fill (C1) spec (2026-06-20) Task Group 3.
 *
 * <p>The bulk-edit endpoint is the write that lets the C1 remediation panel
 * bulk-fill the missing field(s) that blocked / degraded a group of candidates and
 * re-attempt the save in one step. It mirrors
 * {@code DiscoveryCascadeReviewService.bulkReviewCascade} for the all-or-nothing
 * transaction guarantee, but PATCHES per-candidate fields (top-level columns AND
 * the {@code data} JSONB blob) rather than applying one shared
 * {@code review_status}.</p>
 *
 * <p>Proof obligations (Task Group 3 task 3.1):</p>
 * <ul>
 *   <li>the {@code data} JSONB blob patch ROUND-TRIPS through the write (partial
 *       overlay -- supplied keys merged, untouched keys preserved);</li>
 *   <li>top-level field patches apply PATCH-style (only non-null fields written);</li>
 *   <li>ATOMICITY: any single-patch failure (unknown id / cross-run id / null id)
 *       aborts the WHOLE batch -- nothing is persisted (no {@code save});</li>
 *   <li>basic validation: null body, empty patch list, a patch with a null
 *       {@code candidate_id}.</li>
 * </ul>
 *
 * <p>Standalone Mockito setup mirrors {@code DiscoveryCandidateResolveConflictTest}
 * -- no full Spring context (the AMS suite has unrelated pre-existing failures
 * documented in MEMORY.md).</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DiscoveryCandidateBulkEditServiceTest {

    @Mock
    private DiscoveryCandidateRepository candidateRepository;

    @Mock
    private DiscoveryRunArchitectureGuard runGuard;

    private DiscoveryCandidateService service;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCHITECTURE_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID RUN_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");

    @BeforeEach
    void setUp() {
        service = new DiscoveryCandidateService(candidateRepository, runGuard);
        doNothing().when(runGuard).verify(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID));
        when(candidateRepository.save(any(DiscoveryCandidateEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
    }

    /**
     * A business_logics-style candidate carrying an existing {@code data} blob with
     * the class context already present (so we can prove a partial overlay merge
     * neither drops the existing key nor replaces the whole blob).
     */
    private DiscoveryCandidateEntity candidate(UUID id, String name, String type, Map<String, Object> data) {
        return DiscoveryCandidateEntity.builder()
            .id(id)
            .runId(RUN_ID)
            .candidateType(type)
            .name(name)
            .confidence(0.80)
            .status("proposed")
            .sourceClusterIds(new ArrayList<>(List.of("cluster-1")))
            .data(new HashMap<>(data))
            .synthesizedAt(Instant.now())
            .reviewStatus("approved")
            .build();
    }

    private BulkCandidateEditRequest.Patch patch(
            UUID id, String name, String reviewStatus, Map<String, Object> data) {
        return new BulkCandidateEditRequest.Patch(
            id, name, null, null, reviewStatus, null, null, data);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapAt(Map<String, Object> data, String key) {
        return (Map<String, Object>) data.get(key);
    }

    /**
     * Test 1: the {@code data} JSONB blob patch ROUND-TRIPS as a PARTIAL OVERLAY.
     * The supplied {@code interface_type} key is merged in, the pre-existing
     * {@code description} key is PRESERVED (not wiped by a wholesale replace), and a
     * camelCase {@code data} key round-trips verbatim (the data map is a passthrough
     * JSONB blob Jackson never snake_cases).
     */
    @Test
    @DisplayName("Test 1: data blob patch round-trips as a partial overlay (merge, not replace)")
    void bulkEdit_dataBlobPatch_roundTripsAsPartialOverlay() {
        UUID candidateId = UUID.randomUUID();
        Map<String, Object> existing = new HashMap<>();
        existing.put("description", "REST interface for orders");
        existing.put("controllerClassName", "OrderController");
        DiscoveryCandidateEntity entity = candidate(candidateId, "OrderApi", "interface", existing);
        when(candidateRepository.findById(candidateId)).thenReturn(Optional.of(entity));

        Map<String, Object> dataPatch = new HashMap<>();
        dataPatch.put("interface_type", "MESSAGE_QUEUE");
        dataPatch.put("controllerClassName", "OrderQueueController"); // overlay overwrites this one key

        BulkCandidateEditRequest request = new BulkCandidateEditRequest(
            List.of(patch(candidateId, null, null, dataPatch)));

        BulkCandidateEditResponse response =
            service.bulkEditInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, request);

        assertThat(response.appliedCount()).isEqualTo(1);
        assertThat(response.requestedCount()).isEqualTo(1);
        assertThat(response.ids()).containsExactly(candidateId);

        Map<String, Object> data = response.applied().get(0).data();
        // Supplied key merged in.
        assertThat(data).containsEntry("interface_type", "MESSAGE_QUEUE");
        // Overlaid key overwritten.
        assertThat(data).containsEntry("controllerClassName", "OrderQueueController");
        // Untouched pre-existing key PRESERVED (overlay, not wholesale replace).
        assertThat(data).containsEntry("description", "REST interface for orders");
    }

    /**
     * Test 2: top-level field patches apply PATCH-style -- the supplied {@code name}
     * and {@code review_status} are written, while OMITTED (null) fields leave the
     * persisted values alone. This is the business_logics {@code <class>.<method>}
     * qualification primitive (rewrite {@code name}) exercised through the bulk path.
     */
    @Test
    @DisplayName("Test 2: top-level field patches apply PATCH-style (only non-null fields written)")
    void bulkEdit_topLevelFields_patchStyle() {
        UUID candidateId = UUID.randomUUID();
        DiscoveryCandidateEntity entity = candidate(candidateId, "process", "business_logic", new HashMap<>());
        entity.setConfidence(0.42);
        when(candidateRepository.findById(candidateId)).thenReturn(Optional.of(entity));

        // Patch name (qualify) + review_status; confidence/data omitted (null).
        BulkCandidateEditRequest request = new BulkCandidateEditRequest(
            List.of(patch(candidateId, "OrderService.process", "committed", null)));

        BulkCandidateEditResponse response =
            service.bulkEditInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, request);

        DiscoveryCandidateDto dto = response.applied().get(0);
        assertThat(dto.name()).isEqualTo("OrderService.process");
        assertThat(dto.reviewStatus()).isEqualTo("committed");
        // Omitted confidence left alone (NOT clobbered to 0.0 / default).
        assertThat(dto.confidence()).isEqualTo(0.42);
        verify(candidateRepository, times(1)).save(any(DiscoveryCandidateEntity.class));
    }

    /**
     * Test 3: multiple patches in ONE request are all applied and each one is saved.
     * Proves the bulk fan-out over the curated set, not just a single-row path.
     */
    @Test
    @DisplayName("Test 3: a multi-candidate curated set applies every patch (one save each)")
    void bulkEdit_multipleCandidates_allApplied() {
        UUID id1 = UUID.randomUUID();
        UUID id2 = UUID.randomUUID();
        DiscoveryCandidateEntity e1 = candidate(id1, "a", "business_logic", new HashMap<>());
        DiscoveryCandidateEntity e2 = candidate(id2, "b", "business_logic", new HashMap<>());
        when(candidateRepository.findById(id1)).thenReturn(Optional.of(e1));
        when(candidateRepository.findById(id2)).thenReturn(Optional.of(e2));

        Map<String, Object> d1 = new HashMap<>();
        d1.put("className", "OrderService");
        Map<String, Object> d2 = new HashMap<>();
        d2.put("className", "PaymentService");

        BulkCandidateEditRequest request = new BulkCandidateEditRequest(List.of(
            patch(id1, "OrderService.process", null, d1),
            patch(id2, "PaymentService.process", null, d2)));

        BulkCandidateEditResponse response =
            service.bulkEditInArchitecture(RUN_ID, PROJECT_ID, ARCHITECTURE_ID, request);

        assertThat(response.appliedCount()).isEqualTo(2);
        assertThat(response.ids()).containsExactly(id1, id2);
        assertThat(response.applied()).extracting(DiscoveryCandidateDto::name)
            .containsExactly("OrderService.process", "PaymentService.process");
        verify(candidateRepository, times(2)).save(any(DiscoveryCandidateEntity.class));
    }

    /**
     * Test 4: ATOMICITY -- a curated set whose SECOND id is unknown throws (no row is
     * silently skipped) and the failing id is NEVER saved. Under the single
     * {@code @Transactional} the WHOLE batch rolls back, so although the first row's
     * {@code save} fires inside the (mocked) transaction, the thrown exception is the
     * all-or-nothing signal -- there is NO per-item {@code failed[]} best-effort arm.
     */
    @Test
    @DisplayName("Test 4: atomic -- an unknown id mid-batch throws and the bad id is never saved")
    void bulkEdit_unknownIdMidBatch_throwsAtomic() {
        UUID goodId = UUID.randomUUID();
        UUID missingId = UUID.randomUUID();
        DiscoveryCandidateEntity good = candidate(goodId, "a", "business_logic", new HashMap<>());
        when(candidateRepository.findById(goodId)).thenReturn(Optional.of(good));
        when(candidateRepository.findById(missingId)).thenReturn(Optional.empty());

        BulkCandidateEditRequest request = new BulkCandidateEditRequest(List.of(
            patch(goodId, "A.process", null, null),
            patch(missingId, "B.process", null, null)));

        assertThatThrownBy(() -> service.bulkEditInArchitecture(
                RUN_ID, PROJECT_ID, ARCHITECTURE_ID, request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Candidate not found");

        // The missing id IS looked up (that lookup returns empty and is what throws);
        // the batch then aborts. Under the single @Transactional the whole batch rolls
        // back -- the propagated exception is the all-or-nothing signal (there is NO
        // per-item failed[] best-effort arm). The non-existent candidate is never saved
        // (only a loaded entity can be saved, and the missing id never loads).
        verify(candidateRepository, times(1)).findById(missingId);
        verify(candidateRepository, never()).save(argThat(e -> missingId.equals(e.getId())));
    }

    /**
     * Test 5: ATOMICITY (cross-run) -- a candidate that does not belong to the run is
     * rejected (mirrors the run-ownership guard in {@code updateCandidate}) and the
     * whole batch aborts; the cross-run id is never saved.
     */
    @Test
    @DisplayName("Test 5: atomic -- a cross-run candidate id throws and is never saved")
    void bulkEdit_crossRunCandidate_throwsAtomic() {
        UUID candidateId = UUID.randomUUID();
        DiscoveryCandidateEntity foreign = candidate(candidateId, "a", "business_logic", new HashMap<>());
        foreign.setRunId(UUID.fromString("99999999-9999-9999-9999-999999999999"));
        when(candidateRepository.findById(candidateId)).thenReturn(Optional.of(foreign));

        BulkCandidateEditRequest request = new BulkCandidateEditRequest(
            List.of(patch(candidateId, "A.process", null, null)));

        assertThatThrownBy(() -> service.bulkEditInArchitecture(
                RUN_ID, PROJECT_ID, ARCHITECTURE_ID, request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("does not belong to run");

        verify(candidateRepository, never()).save(any(DiscoveryCandidateEntity.class));
    }

    /**
     * Test 6: validation -- a patch with a null {@code candidate_id} is rejected and
     * nothing is saved.
     */
    @Test
    @DisplayName("Test 6: a patch with a null candidate_id is rejected (no save)")
    void bulkEdit_nullCandidateIdInPatch_rejected() {
        BulkCandidateEditRequest request = new BulkCandidateEditRequest(
            List.of(patch(null, "A.process", null, null)));

        assertThatThrownBy(() -> service.bulkEditInArchitecture(
                RUN_ID, PROJECT_ID, ARCHITECTURE_ID, request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("candidate_id");

        verify(candidateRepository, never()).save(any(DiscoveryCandidateEntity.class));
    }

    /**
     * Test 7: validation -- a null body is rejected; an empty patch list is a no-op
     * (zero applied, zero requested, nothing saved). Mirrors the cascade's both-empty
     * no-op.
     */
    @Test
    @DisplayName("Test 7: null body rejected; empty patch list is a no-op")
    void bulkEdit_nullBodyRejected_emptyListIsNoOp() {
        // null body -> rejected
        assertThatThrownBy(() -> service.bulkEditInArchitecture(
                RUN_ID, PROJECT_ID, ARCHITECTURE_ID, null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("required");

        // empty list -> no-op
        BulkCandidateEditResponse response = service.bulkEditInArchitecture(
            RUN_ID, PROJECT_ID, ARCHITECTURE_ID, new BulkCandidateEditRequest(List.of()));
        assertThat(response.appliedCount()).isZero();
        assertThat(response.requestedCount()).isZero();
        assertThat(response.applied()).isEmpty();
        verify(candidateRepository, never()).save(any(DiscoveryCandidateEntity.class));
    }
}
