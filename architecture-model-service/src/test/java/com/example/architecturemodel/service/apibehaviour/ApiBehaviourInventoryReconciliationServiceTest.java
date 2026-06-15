package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.InventoryReconciliationRequest;
import com.example.architecturemodel.model.dto.apibehaviour.InventoryReconciliationResponse;
import com.example.architecturemodel.model.dto.discovery.CreateDiscoveryFindingRequest;
import com.example.architecturemodel.model.entity.EndpointEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureSessionEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourOperationEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourCaptureSessionRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourOperationRepository;
import com.example.architecturemodel.repository.entity.EndpointRepository;
import com.example.architecturemodel.service.discovery.DiscoveryFindingService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Focused tests for {@link ApiBehaviourInventoryReconciliationService} --
 * the new AMS inventory-reconciliation endpoint backing service (Spec:
 * Model-Seeded Capture Inventory, 2026-06-11 -- Task Group 1).
 *
 * <p>Covers (per task 1.1): (b) scope partition + excluded-with-reason rows
 * still ACCOUNT for their endpoint; (c) the null-scope fallback chain
 * (request &rarr; session row &rarr; whole architecture); (d) coverage math
 * with numerators/denominators and the empty-denominator-&rarr;-100 rule;
 * (e) {@code persist_scope: true} writes {@code scope_interface_ids_json}
 * to the session row; (f) findings delete-then-emit idempotence + shape and
 * {@code refresh_findings: false} writing nothing.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ApiBehaviourInventoryReconciliationServiceTest {

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCHITECTURE_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID SESSION_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");

    @Mock
    private ApiBehaviourCaptureSessionRepository sessionRepository;
    @Mock
    private ApiBehaviourOperationRepository operationRepository;
    @Mock
    private ModelFileRepository modelFileRepository;
    @Mock
    private EndpointRepository endpointRepository;
    @Mock
    private DiscoveryFindingService discoveryFindingService;

    private ApiBehaviourInventoryReconciliationService service;
    private ApiBehaviourCaptureSessionEntity session;

    /** In-memory finding store driven by the mocked DiscoveryFindingService. */
    private final List<CreateDiscoveryFindingRequest> findingStore = new ArrayList<>();

    @BeforeEach
    void setUp() {
        service = new ApiBehaviourInventoryReconciliationService(
            sessionRepository, operationRepository, modelFileRepository,
            endpointRepository, discoveryFindingService);

        session = ApiBehaviourCaptureSessionEntity.builder()
            .id(SESSION_ID)
            .projectId(PROJECT_ID)
            .architectureId(ARCHITECTURE_ID)
            .status("draft")
            .build();
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(session));
        when(sessionRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));

        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("mf-1").filename("model.json").build();
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(Optional.of(modelFile));

        // Mocked finding service behaves like the real delete-before-emit store.
        findingStore.clear();
        when(discoveryFindingService.deleteFindingsByCaptureSessionId(SESSION_ID))
            .thenAnswer(inv -> {
                int n = findingStore.size();
                findingStore.clear();
                return n;
            });
        when(discoveryFindingService.createForCaptureSession(
                eq(PROJECT_ID), eq(ARCHITECTURE_ID), eq(SESSION_ID), any()))
            .thenAnswer(inv -> {
                findingStore.add(inv.getArgument(3));
                return null;
            });
    }

    @Test
    @DisplayName("(b) scope partition: out-of-scope endpoints land in excluded_by_scope; an excluded-with-reason operation row still ACCOUNTS for its endpoint")
    void scopePartitionAndExcludedWithReasonAccounting() {
        EndpointEntity inScopeAccounted = endpoint("ep-1", "iface-a", "GET", "/a");
        EndpointEntity inScopeExcludedRow = endpoint("ep-2", "iface-a", "POST", "/b");
        EndpointEntity inScopeUnaccounted = endpoint("ep-3", "iface-a", "DELETE", "/c");
        EndpointEntity outOfScope = endpoint("ep-4", "iface-z", "GET", "/z");
        when(endpointRepository.findByModelFileId("mf-1")).thenReturn(
            List.of(inScopeAccounted, inScopeExcludedRow, inScopeUnaccounted, outOfScope));

        // ep-1 accounted by an ordinary included row; ep-2 accounted by an
        // EXCLUDED-with-reason row (included=false + exclusion_reason).
        when(operationRepository.findBySessionIdOrderByCreatedAtAsc(SESSION_ID)).thenReturn(
            List.of(
                op("a", "GET", "/a", Boolean.TRUE, null),
                op("b", "POST", "/b", Boolean.FALSE, "deprecated -- retired endpoint")));

        InventoryReconciliationResponse out = service.reconcile(PROJECT_ID, SESSION_ID,
            new InventoryReconciliationRequest(List.of("iface-a"), false, false));

        // Only the genuinely unaccounted in-scope endpoint blocks.
        assertThat(out.inScopeUnaccountedEndpoints())
            .extracting(InventoryReconciliationResponse.UnaccountedEndpointRef::endpointId)
            .containsExactly("ep-3");
        assertThat(out.inScopeUnaccountedEndpoints().get(0).key()).isEqualTo("DELETE /c");
        // The out-of-scope endpoint is VISIBLE in the excluded-by-scope group.
        assertThat(out.excludedByScopeEndpoints())
            .extracting(InventoryReconciliationResponse.ExcludedByScopeEndpointRef::endpointId)
            .containsExactly("ep-4");
        // 2 of 3 in scope accounted (the excluded-with-reason row counts).
        assertThat(out.inScopeAccountedCount()).isEqualTo(2);
        assertThat(out.inScopeTotalCount()).isEqualTo(3);
    }

    @Test
    @DisplayName("(c) null-scope fallback chain: request null -> session scope_interface_ids_json; both null -> whole architecture")
    void nullScopeFallbackChain() {
        EndpointEntity epA = endpoint("ep-a", "iface-a", "GET", "/a");
        EndpointEntity epZ = endpoint("ep-z", "iface-z", "GET", "/z");
        when(endpointRepository.findByModelFileId("mf-1")).thenReturn(List.of(epA, epZ));
        when(operationRepository.findBySessionIdOrderByCreatedAtAsc(SESSION_ID))
            .thenReturn(List.of());

        // Request scope null -> the session row's persisted scope is used.
        session.setScopeInterfaceIdsJson(List.of("iface-a"));
        InventoryReconciliationResponse scoped = service.reconcile(PROJECT_ID, SESSION_ID,
            new InventoryReconciliationRequest(null, false, false));
        assertThat(scoped.inScopeTotalCount()).isEqualTo(1);
        assertThat(scoped.excludedByScopeEndpoints()).hasSize(1);

        // Session scope ALSO null -> the WHOLE architecture is in scope --
        // nothing silently absent.
        session.setScopeInterfaceIdsJson(null);
        InventoryReconciliationResponse whole = service.reconcile(PROJECT_ID, SESSION_ID,
            new InventoryReconciliationRequest(null, false, false));
        assertThat(whole.inScopeTotalCount()).isEqualTo(2);
        assertThat(whole.excludedByScopeEndpoints()).isEmpty();
        assertThat(whole.inScopeUnaccountedEndpoints()).hasSize(2);
    }

    @Test
    @DisplayName("(d) coverage math: both percentages with numerators/denominators; empty denominator -> 100")
    void coverageMath() {
        EndpointEntity inScopeAccounted = endpoint("ep-1", "iface-a", "GET", "/a");
        EndpointEntity inScopeUnaccounted = endpoint("ep-2", "iface-a", "POST", "/b");
        EndpointEntity outOfScopeAccounted = endpoint("ep-3", "iface-z", "GET", "/z");
        EndpointEntity outOfScopeUnaccounted = endpoint("ep-4", "iface-z", "PUT", "/y");
        when(endpointRepository.findByModelFileId("mf-1")).thenReturn(
            List.of(inScopeAccounted, inScopeUnaccounted, outOfScopeAccounted, outOfScopeUnaccounted));
        when(operationRepository.findBySessionIdOrderByCreatedAtAsc(SESSION_ID)).thenReturn(
            List.of(op("a", "GET", "/a", Boolean.TRUE, null),
                op("z", "GET", "/z", Boolean.TRUE, null)));

        InventoryReconciliationResponse out = service.reconcile(PROJECT_ID, SESSION_ID,
            new InventoryReconciliationRequest(List.of("iface-a"), false, false));

        // In-scope: 1 of 2 accounted = 50%.
        assertThat(out.inScopeAccountedCount()).isEqualTo(1);
        assertThat(out.inScopeTotalCount()).isEqualTo(2);
        assertThat(out.inScopeCoveragePct()).isEqualTo(50.0);
        // Whole architecture: 2 of 4 accounted = 50% (excluded-by-scope rows
        // lower the figure by design, D7 -- ep-4 counts against it).
        assertThat(out.architectureAccountedCount()).isEqualTo(2);
        assertThat(out.architectureTotalCount()).isEqualTo(4);
        assertThat(out.architectureCoveragePct()).isEqualTo(50.0);

        // Empty denominators -> 100 (no endpoints at all).
        when(endpointRepository.findByModelFileId("mf-1")).thenReturn(List.of());
        when(operationRepository.findBySessionIdOrderByCreatedAtAsc(SESSION_ID))
            .thenReturn(List.of());
        InventoryReconciliationResponse empty = service.reconcile(PROJECT_ID, SESSION_ID,
            new InventoryReconciliationRequest(null, false, false));
        assertThat(empty.inScopeCoveragePct()).isEqualTo(100.0);
        assertThat(empty.architectureCoveragePct()).isEqualTo(100.0);
        assertThat(empty.inScopeTotalCount()).isZero();
        assertThat(empty.architectureTotalCount()).isZero();
    }

    @Test
    @DisplayName("(e) persist_scope: true + provided ids writes scope_interface_ids_json to the session row; false leaves it untouched")
    void persistScopeWritesSessionRow() {
        when(endpointRepository.findByModelFileId("mf-1")).thenReturn(List.of());
        when(operationRepository.findBySessionIdOrderByCreatedAtAsc(SESSION_ID))
            .thenReturn(List.of());

        // persist_scope false -> no write.
        service.reconcile(PROJECT_ID, SESSION_ID,
            new InventoryReconciliationRequest(List.of("iface-a"), false, false));
        verify(sessionRepository, never()).saveAndFlush(any());
        assertThat(session.getScopeInterfaceIdsJson()).isNull();

        // persist_scope true + ids -> written to the session row.
        service.reconcile(PROJECT_ID, SESSION_ID,
            new InventoryReconciliationRequest(List.of("iface-a", "iface-b"), true, false));
        verify(sessionRepository).saveAndFlush(session);
        assertThat(session.getScopeInterfaceIdsJson())
            .containsExactly("iface-a", "iface-b");
    }

    @Test
    @DisplayName("(f) findings: two refresh_findings:true calls leave exactly ONE correctly-shaped finding per gap operation; refresh_findings:false writes nothing")
    void findingsDeleteThenEmitIdempotence() {
        when(endpointRepository.findByModelFileId("mf-1"))
            .thenReturn(List.of(endpoint("ep-1", "iface-a", "GET", "/known")));
        ApiBehaviourOperationEntity known = op("known", "GET", "/known", Boolean.TRUE, null);
        ApiBehaviourOperationEntity ghost = op("ghostOp", "DELETE", "/ghost", Boolean.TRUE, null);
        when(operationRepository.findBySessionIdOrderByCreatedAtAsc(SESSION_ID))
            .thenReturn(List.of(known, ghost));

        // Two reconciliations with refresh_findings true (null defaults to true).
        service.reconcile(PROJECT_ID, SESSION_ID,
            new InventoryReconciliationRequest(null, false, true));
        service.reconcile(PROJECT_ID, SESSION_ID,
            new InventoryReconciliationRequest(null, false, null));

        // Delete-before-emit idempotence: EXACTLY one finding for the one gap op.
        assertThat(findingStore).hasSize(1);
        CreateDiscoveryFindingRequest finding = findingStore.get(0);
        assertThat(finding.findingType()).isEqualTo("operation_without_model_endpoint");
        assertThat(finding.category()).isEqualTo("reconciliation");
        assertThat(finding.severity()).isEqualTo("medium");
        assertThat(finding.source()).isEqualTo("capture_inventory_reconciliation");
        assertThat(finding.title()).contains("DELETE /ghost");
        assertThat(finding.detailJson())
            .containsEntry("operation_row_id", ghost.getId().toString())
            .containsEntry("operation_id", "ghostOp")
            .containsEntry("reconciliation_key", "DELETE /ghost");

        // refresh_findings: false -> display-only, writes NOTHING.
        int deletesSoFar = findingStore.size();
        service.reconcile(PROJECT_ID, SESSION_ID,
            new InventoryReconciliationRequest(null, false, false));
        assertThat(findingStore).hasSize(deletesSoFar);
        verify(discoveryFindingService, org.mockito.Mockito.times(2))
            .deleteFindingsByCaptureSessionId(SESSION_ID);
    }

    @Test
    @DisplayName("(Task Group 5) SOAP round-trip: included AND excluded-with-reason synthesised SOAP rows account for their soap::-keyed endpoints on the NEXT reconcile, and emit NO spurious findings")
    void soapAccountingRowsRoundTripToAccountedWithoutSpuriousFindings() {
        // Two SOAP endpoints keyed soap::<soap_action> / soap::<root> -- the
        // shapes the wizard's unmatched section would surface for accounting.
        EndpointEntity soapInclude = soapEndpoint("ep-soap-1", "iface-soap",
            "urn:GetAccount", "GetAccountRequest");
        EndpointEntity soapExclude = soapEndpoint("ep-soap-2", "iface-soap",
            null, "GetBalanceRequest");
        when(endpointRepository.findByModelFileId("mf-1"))
            .thenReturn(List.of(soapInclude, soapExclude));

        // The validation service's account-endpoints action persisted one
        // INCLUDE row and one EXCLUDE-with-reason row -- method POST + the
        // servlet path, SOAP metadata stamped under x-amvs-soap.
        ApiBehaviourOperationEntity includedRow = soapSynthesisedOp(
            "urn:GetAccount", Boolean.TRUE, null, "urn:GetAccount", "GetAccountRequest");
        ApiBehaviourOperationEntity excludedRow = soapSynthesisedOp(
            "GetBalance", Boolean.FALSE, "deprecated service", null, "GetBalanceRequest");
        when(operationRepository.findBySessionIdOrderByCreatedAtAsc(SESSION_ID))
            .thenReturn(List.of(includedRow, excludedRow));

        InventoryReconciliationResponse out = service.reconcile(PROJECT_ID, SESSION_ID,
            new InventoryReconciliationRequest(List.of("iface-soap"), false, true));

        // Both SOAP endpoints are ACCOUNTED -- include AND exclude verdicts
        // round-trip through the calculator's soap:: key, so the /start gate
        // can clear instead of 409-ing forever on SOAP scopes.
        assertThat(out.inScopeUnaccountedEndpoints()).isEmpty();
        assertThat(out.inScopeAccountedCount()).isEqualTo(2);
        assertThat(out.inScopeTotalCount()).isEqualTo(2);
        assertThat(out.inScopeCoveragePct()).isEqualTo(100.0);

        // And the synthesised rows are NOT discovery gaps: no
        // operation-without-model-endpoint entry, no spurious finding.
        assertThat(out.operationsWithoutModelEndpoint()).isEmpty();
        assertThat(findingStore).isEmpty();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static EndpointEntity endpoint(
            String id, String interfaceId, String verb, String path) {
        return EndpointEntity.builder()
            .id(id)
            .modelFileId("mf-1")
            .interfaceId(interfaceId)
            .name(id)
            .protocol("REST")
            .endpointType("REST")
            .operationVerb(verb)
            .pathOrAddress(path)
            .build();
    }

    private static EndpointEntity soapEndpoint(
            String id, String interfaceId, String soapAction, String requestRootElement) {
        Map<String, Object> meta = new LinkedHashMap<>();
        if (soapAction != null) {
            meta.put("soap_action", soapAction);
        }
        if (requestRootElement != null) {
            meta.put("request_root_element", requestRootElement);
        }
        return EndpointEntity.builder()
            .id(id)
            .modelFileId("mf-1")
            .interfaceId(interfaceId)
            .name(id)
            .protocol("SOAP")
            .endpointType("SOAP")
            .operationVerb("POST")
            .pathOrAddress("/services/Account")
            .protocolMetadataJson(meta)
            .build();
    }

    /** Operation row exactly as the account-endpoints action synthesises it. */
    private static ApiBehaviourOperationEntity soapSynthesisedOp(
            String operationId, Boolean included, String exclusionReason,
            String soapAction, String requestRootElement) {
        Map<String, Object> soapBlock = new LinkedHashMap<>();
        if (soapAction != null) {
            soapBlock.put("soap_action", soapAction);
        }
        if (requestRootElement != null) {
            soapBlock.put("request_root_element", requestRootElement);
        }
        Map<String, Object> oas = new LinkedHashMap<>();
        oas.put("x-amvs-source", "model-endpoint-reconciliation");
        oas.put("x-amvs-soap", soapBlock);
        return ApiBehaviourOperationEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(SESSION_ID)
            .operationId(operationId)
            .method("POST")
            .path("/services/Account")
            .included(included)
            .safeToExecute(null)
            .exclusionReason(exclusionReason)
            .oasOperationJson(oas)
            .build();
    }

    private static ApiBehaviourOperationEntity op(
            String operationId, String method, String path,
            Boolean included, String exclusionReason) {
        Map<String, Object> oas = new LinkedHashMap<>();
        return ApiBehaviourOperationEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(SESSION_ID)
            .operationId(operationId)
            .method(method)
            .path(path)
            .included(included)
            .safeToExecute(Boolean.FALSE)
            .exclusionReason(exclusionReason)
            .oasOperationJson(new HashMap<>(oas))
            .build();
    }
}
