package com.example.architecturemodel.service.procbehaviour;

import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.CreateProcBaselineRequest;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.CreateProcBaselineRequest.ProcBaselineItemDto;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.PatchProcCaptureSessionRequest;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourBaselineItemEntity;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourCaptureSessionEntity;
import com.example.architecturemodel.repository.entity.ProcBehaviourBaselineItemRepository;
import com.example.architecturemodel.repository.entity.ProcBehaviourBaselineRepository;
import com.example.architecturemodel.repository.entity.ProcBehaviourCaptureRepository;
import com.example.architecturemodel.repository.entity.ProcBehaviourCaptureSessionRepository;
import com.example.architecturemodel.repository.entity.ProcBehaviourDiagnosticRepository;
import com.example.architecturemodel.repository.entity.ProcBehaviourScenarioRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Spec 3 (Stored Proc &amp; Function Behaviour Program, 2026-09-09): the proc
 * behaviour data plane's four rules -- the session state machine, the
 * order-independent baseline content hash, one-pinned-per-(architecture,kind),
 * and body-hash staleness.
 *
 * <p>Vocabulary is invented (an {@code upd_ledger_roll} rollup proc and a
 * {@code fn_ledger_total} function) -- no real schema names appear here.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ProcBehaviourServiceTest {

    @Mock
    private ProcBehaviourCaptureSessionRepository sessionRepository;
    @Mock
    private ProcBehaviourScenarioRepository scenarioRepository;
    @Mock
    private ProcBehaviourCaptureRepository captureRepository;
    @Mock
    private ProcBehaviourBaselineRepository baselineRepository;
    @Mock
    private ProcBehaviourBaselineItemRepository baselineItemRepository;
    @Mock
    private ProcBehaviourDiagnosticRepository diagnosticRepository;

    private ProcBehaviourService service;

    private final UUID projectId = UUID.randomUUID();
    private final UUID architectureId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new ProcBehaviourService(
            sessionRepository, scenarioRepository, captureRepository,
            baselineRepository, baselineItemRepository, diagnosticRepository);
        when(sessionRepository.save(any(ProcBehaviourCaptureSessionEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(baselineRepository.save(any(ProcBehaviourBaselineEntity.class)))
            .thenAnswer(inv -> {
                ProcBehaviourBaselineEntity b = inv.getArgument(0);
                if (b.getId() == null) {
                    b.setId(UUID.randomUUID());
                }
                return b;
            });
    }

    // ------------------------------------------------------------------
    // (a) state machine
    // ------------------------------------------------------------------

    private ProcBehaviourCaptureSessionEntity session(String status) {
        UUID id = UUID.randomUUID();
        ProcBehaviourCaptureSessionEntity entity = ProcBehaviourCaptureSessionEntity.builder()
            .id(id).projectId(projectId).architectureId(architectureId)
            .name("upd_ledger_roll sweep").status(status)
            .kind(ProcBehaviourCaptureSessionEntity.KIND_CURRENT)
            .scopeRoutineIdsJson(new ArrayList<>())
            .build();
        when(sessionRepository.findById(id)).thenReturn(java.util.Optional.of(entity));
        return entity;
    }

    private static PatchProcCaptureSessionRequest toStatus(String status) {
        return new PatchProcCaptureSessionRequest(
            null, status, null, null, null, null, null, null, null, null);
    }

    // ------------------------------------------------------------------
    // delete (2026-09-12)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("delete: removes a finished session, detaches (never deletes) its baselines, refuses a running one, false when absent")
    void deleteSessionDetachesBaselinesAndRefusesRunning() {
        ProcBehaviourCaptureSessionEntity done = session("completed_with_findings");
        ProcBehaviourBaselineEntity fromIt = ProcBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID()).projectId(projectId).architectureId(architectureId)
            .sessionId(done.getId()).name("v1").kind("current").status("saved").build();
        ProcBehaviourBaselineEntity other = ProcBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID()).projectId(projectId).architectureId(architectureId)
            .sessionId(UUID.randomUUID()).name("v0").kind("current").status("saved").build();
        when(baselineRepository.findByArchitectureIdOrderByCreatedAtDesc(architectureId))
            .thenReturn(List.of(fromIt, other));

        assertThat(service.deleteSession(architectureId, done.getId())).isTrue();
        org.mockito.Mockito.verify(sessionRepository).delete(done);
        assertThat(fromIt.getSessionId()).isNull();
        assertThat(other.getSessionId()).isNotNull();
        org.mockito.Mockito.verify(baselineRepository, never()).delete(any(ProcBehaviourBaselineEntity.class));

        ProcBehaviourCaptureSessionEntity running = session("running");
        assertThatThrownBy(() -> service.deleteSession(architectureId, running.getId()))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("still running");
        org.mockito.Mockito.verify(sessionRepository, never()).delete(running);

        // Wrong architecture / unknown id: false, nothing touched.
        assertThat(service.deleteSession(UUID.randomUUID(), done.getId())).isFalse();
        assertThat(service.deleteSession(architectureId, UUID.randomUUID())).isFalse();
    }

    @Test
    @DisplayName("the legal chain draft -> configured -> running -> completed_with_findings walks through")
    void legalChainSucceeds() {
        ProcBehaviourCaptureSessionEntity s = session(ProcBehaviourCaptureSessionEntity.STATUS_DRAFT);

        service.patchSession(architectureId, s.getId(),
            toStatus(ProcBehaviourCaptureSessionEntity.STATUS_CONFIGURED));
        assertThat(s.getStatus()).isEqualTo(ProcBehaviourCaptureSessionEntity.STATUS_CONFIGURED);

        // configured -> draft is allowed (re-scoping) and comes back again.
        service.patchSession(architectureId, s.getId(),
            toStatus(ProcBehaviourCaptureSessionEntity.STATUS_DRAFT));
        assertThat(s.getStatus()).isEqualTo(ProcBehaviourCaptureSessionEntity.STATUS_DRAFT);
        service.patchSession(architectureId, s.getId(),
            toStatus(ProcBehaviourCaptureSessionEntity.STATUS_CONFIGURED));

        service.patchSession(architectureId, s.getId(),
            toStatus(ProcBehaviourCaptureSessionEntity.STATUS_RUNNING));
        assertThat(s.getStatus()).isEqualTo(ProcBehaviourCaptureSessionEntity.STATUS_RUNNING);

        service.patchSession(architectureId, s.getId(),
            toStatus(ProcBehaviourCaptureSessionEntity.STATUS_COMPLETED_WITH_FINDINGS));
        assertThat(s.getStatus())
            .isEqualTo(ProcBehaviourCaptureSessionEntity.STATUS_COMPLETED_WITH_FINDINGS);
    }

    @Test
    @DisplayName("draft -> running is illegal and throws; a terminal session cannot be re-run")
    void illegalTransitionsThrow() {
        ProcBehaviourCaptureSessionEntity draft = session(ProcBehaviourCaptureSessionEntity.STATUS_DRAFT);
        assertThatThrownBy(() -> service.patchSession(architectureId, draft.getId(),
            toStatus(ProcBehaviourCaptureSessionEntity.STATUS_RUNNING)))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("draft -> running");
        assertThat(draft.getStatus()).isEqualTo(ProcBehaviourCaptureSessionEntity.STATUS_DRAFT);

        ProcBehaviourCaptureSessionEntity done =
            session(ProcBehaviourCaptureSessionEntity.STATUS_COMPLETED);
        assertThatThrownBy(() -> service.patchSession(architectureId, done.getId(),
            toStatus(ProcBehaviourCaptureSessionEntity.STATUS_RUNNING)))
            .isInstanceOf(IllegalStateException.class);

        assertThatThrownBy(() -> service.patchSession(architectureId, draft.getId(),
            toStatus("half_done")))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("unknown");
    }

    @Test
    @DisplayName("a sparse patch merges jsonb fields without touching the status")
    void sparsePatchMergesJsonbFields() {
        ProcBehaviourCaptureSessionEntity s = session(ProcBehaviourCaptureSessionEntity.STATUS_RUNNING);
        Map<String, Object> coverage = Map.of("routines_at_floor", 4);

        service.patchSession(architectureId, s.getId(), new PatchProcCaptureSessionRequest(
            null, null, List.of("r-1"), null, null, null, coverage, null, null, null));

        assertThat(s.getStatus()).isEqualTo(ProcBehaviourCaptureSessionEntity.STATUS_RUNNING);
        assertThat(s.getScopeRoutineIdsJson()).containsExactly("r-1");
        assertThat(s.getCoverageSummaryJson()).isEqualTo(coverage);
        assertThat(s.getSessionProfileJson()).isNull();
    }

    // ------------------------------------------------------------------
    // (b) baseline create: counts + deterministic content hash
    // ------------------------------------------------------------------

    private static ProcBaselineItemDto item(UUID routineId, String scenarioName, Map<String, Object> envelope) {
        return new ProcBaselineItemDto(
            routineId, "body-hash-" + routineId, UUID.randomUUID(), scenarioName,
            "happy_path", "success", List.of(Map.of("name", "@as_of", "value", "2026-09-01")),
            null, envelope, null, null, null);
    }

    @Test
    @DisplayName("create computes routine/scenario counts and an order-independent content hash")
    void createBaselineCountsAndHashes() {
        UUID rollup = UUID.randomUUID();
        UUID total = UUID.randomUUID();
        Map<String, Object> envA = new LinkedHashMap<>();
        envA.put("return_value", 0);
        envA.put("row_counts", List.of(3));
        Map<String, Object> envB = new LinkedHashMap<>();
        envB.put("row_counts", List.of(0));
        envB.put("return_value", 2);

        List<ProcBaselineItemDto> items = List.of(
            item(rollup, "rolls the open period", envA),
            item(rollup, "returns 2 when the period is closed", envB),
            item(total, "totals an empty ledger", envA));

        ProcBehaviourBaselineEntity first = service.createBaseline(projectId, architectureId,
            new CreateProcBaselineRequest(UUID.randomUUID(), "S0 proc baseline", "current",
                Map.of("snapshot", "s0"), items));

        assertThat(first.getRoutineCount()).isEqualTo(2);
        assertThat(first.getScenarioCount()).isEqualTo(3);
        assertThat(first.getContentHash()).isNotBlank().hasSize(64);
        assertThat(first.getStatus()).isEqualTo(ProcBehaviourBaselineEntity.STATUS_DRAFT);

        // Same items again -> the same hash.
        ProcBehaviourBaselineEntity same = service.createBaseline(projectId, architectureId,
            new CreateProcBaselineRequest(null, "S0 proc baseline (re-save)", "current", null, items));
        assertThat(same.getContentHash()).isEqualTo(first.getContentHash());

        // Reordered items (and a reordered envelope map) -> STILL the same hash.
        Map<String, Object> envAReordered = new LinkedHashMap<>();
        envAReordered.put("row_counts", List.of(3));
        envAReordered.put("return_value", 0);
        List<ProcBaselineItemDto> reordered = List.of(
            item(total, "totals an empty ledger", envAReordered),
            item(rollup, "returns 2 when the period is closed", envB),
            item(rollup, "rolls the open period", envAReordered));
        ProcBehaviourBaselineEntity shuffled = service.createBaseline(projectId, architectureId,
            new CreateProcBaselineRequest(null, "S0 proc baseline (shuffled)", "current", null, reordered));
        assertThat(shuffled.getContentHash()).isEqualTo(first.getContentHash());

        // A changed expectation MUST move the hash.
        List<ProcBaselineItemDto> changed = List.of(
            item(rollup, "rolls the open period", Map.of("return_value", 9)),
            item(rollup, "returns 2 when the period is closed", envB),
            item(total, "totals an empty ledger", envA));
        ProcBehaviourBaselineEntity moved = service.createBaseline(projectId, architectureId,
            new CreateProcBaselineRequest(null, "S0 proc baseline (drifted)", "current", null, changed));
        assertThat(moved.getContentHash()).isNotEqualTo(first.getContentHash());

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<ProcBehaviourBaselineItemEntity>> captor =
            ArgumentCaptor.forClass(List.class);
        verify(baselineItemRepository, times(4)).saveAll(captor.capture());
        assertThat(captor.getAllValues().get(0)).hasSize(3);
        assertThat(captor.getAllValues().get(0).get(0).getBaselineId()).isEqualTo(first.getId());
    }

    // ------------------------------------------------------------------
    // (c) pin supersedes only the same kind
    // ------------------------------------------------------------------

    private ProcBehaviourBaselineEntity baseline(String kind, String status) {
        return ProcBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID()).projectId(projectId).architectureId(architectureId)
            .name("baseline " + kind + " " + status).kind(kind).status(status)
            .build();
    }

    @Test
    @DisplayName("pin supersedes the previously pinned baseline of the SAME kind only")
    void pinSupersedesSameKindOnly() {
        ProcBehaviourBaselineEntity oldCurrent =
            baseline("current", ProcBehaviourBaselineEntity.STATUS_PINNED);
        ProcBehaviourBaselineEntity pinnedTarget =
            baseline("target", ProcBehaviourBaselineEntity.STATUS_PINNED);
        ProcBehaviourBaselineEntity draftCurrent =
            baseline("current", ProcBehaviourBaselineEntity.STATUS_DRAFT);
        ProcBehaviourBaselineEntity newCurrent =
            baseline("current", ProcBehaviourBaselineEntity.STATUS_DRAFT);

        when(baselineRepository.findById(newCurrent.getId()))
            .thenReturn(java.util.Optional.of(newCurrent));
        when(baselineRepository.findByArchitectureIdOrderByCreatedAtDesc(architectureId))
            .thenReturn(List.of(newCurrent, oldCurrent, pinnedTarget, draftCurrent));

        ProcBehaviourBaselineEntity pinned = service.pin(architectureId, newCurrent.getId());

        assertThat(pinned.getStatus()).isEqualTo(ProcBehaviourBaselineEntity.STATUS_PINNED);
        assertThat(pinned.getPinnedAt()).isNotNull();
        assertThat(oldCurrent.getStatus()).isEqualTo(ProcBehaviourBaselineEntity.STATUS_SUPERSEDED);
        assertThat(pinnedTarget.getStatus()).isEqualTo(ProcBehaviourBaselineEntity.STATUS_PINNED);
        assertThat(draftCurrent.getStatus()).isEqualTo(ProcBehaviourBaselineEntity.STATUS_DRAFT);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<ProcBehaviourBaselineEntity>> captor =
            ArgumentCaptor.forClass(List.class);
        verify(baselineRepository).saveAll(captor.capture());
        assertThat(captor.getValue()).containsExactly(oldCurrent);
    }

    // ------------------------------------------------------------------
    // (d) staleness
    // ------------------------------------------------------------------

    private static ProcBehaviourBaselineItemEntity itemEntity(UUID routineId, String bodyHash) {
        return ProcBehaviourBaselineItemEntity.builder()
            .id(UUID.randomUUID()).baselineId(UUID.randomUUID()).routineId(routineId)
            .routineBodyHash(bodyHash).scenarioName("s").scenarioType("happy_path")
            .build();
    }

    @Test
    @DisplayName("markItemsStale flips only the items whose body hash moved")
    void markItemsStaleMarksOnlyDiffering() {
        UUID baselineId = UUID.randomUUID();
        UUID rollup = UUID.randomUUID();
        UUID total = UUID.randomUUID();
        UUID unmentioned = UUID.randomUUID();

        ProcBehaviourBaselineItemEntity movedA = itemEntity(rollup, "hash-old");
        ProcBehaviourBaselineItemEntity movedB = itemEntity(rollup, "hash-old");
        ProcBehaviourBaselineItemEntity unchanged = itemEntity(total, "hash-total");
        ProcBehaviourBaselineItemEntity absent = itemEntity(unmentioned, "hash-other");
        when(baselineItemRepository.findByBaselineId(baselineId))
            .thenReturn(List.of(movedA, movedB, unchanged, absent));

        int marked = service.markItemsStale(baselineId, Map.of(
            rollup.toString(), "hash-new",
            total.toString(), "hash-total"));

        assertThat(marked).isEqualTo(2);
        assertThat(movedA.isStale()).isTrue();
        assertThat(movedA.getStaleReason())
            .isEqualTo(ProcBehaviourBaselineItemEntity.STALE_REASON_BODY_CHANGED);
        assertThat(movedB.isStale()).isTrue();
        assertThat(unchanged.isStale()).isFalse();
        assertThat(unchanged.getStaleReason()).isNull();
        assertThat(absent.isStale()).isFalse();

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<ProcBehaviourBaselineItemEntity>> captor =
            ArgumentCaptor.forClass(List.class);
        verify(baselineItemRepository).saveAll(captor.capture());
        assertThat(captor.getValue()).containsExactlyInAnyOrder(movedA, movedB);
    }

    @Test
    @DisplayName("an empty hash map marks nothing and never writes")
    void emptyStaleRequestIsNoop() {
        assertThat(service.markItemsStale(UUID.randomUUID(), Map.of())).isZero();
        assertThat(service.markItemsStale(UUID.randomUUID(), null)).isZero();
        verify(baselineItemRepository, never()).saveAll(any());
    }
}
