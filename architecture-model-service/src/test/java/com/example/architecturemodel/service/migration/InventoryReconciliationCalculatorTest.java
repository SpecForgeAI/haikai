package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.entity.EndpointEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourOperationEntity;
import com.example.architecturemodel.service.migration.MigrationDiscoveryContextService.InventoryReconciliation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused tests for the shared {@link InventoryReconciliationCalculator}
 * extracted from {@code MigrationDiscoveryContextService} (Spec:
 * Model-Seeded Capture Inventory, 2026-06-11 -- Task Group 1).
 *
 * <p>Covers (per task 1.1): (a) the DETAILED result -- REST matching on
 * {@code <METHOD> <path>}, SOAP matching on {@code soap::<soap_action>} with
 * the {@code request_root_element} and {@code soap::<endpoint id>}
 * fallbacks, full refs + matched counts in both directions; (h) readiness
 * gate C still derives its existing
 * {@code discoveredNotCaptured}/{@code capturedNotDiscovered} counts
 * unchanged via the calculator (identity keys byte-identical, distinct-KEY
 * counting preserved).</p>
 */
class InventoryReconciliationCalculatorTest {

    private static final UUID SESSION_ID = UUID.randomUUID();

    @Test
    @DisplayName("(a) detailed result: REST + SOAP keys (action, root-element fallback, id fallback), full refs + matched counts both directions")
    void detailedResultRestAndSoapKeysWithFallbacks() {
        // REST endpoint matched by an operation on <METHOD> <path>
        // (method case/whitespace-insensitive on both sides).
        EndpointEntity restMatched = endpoint("ep-rest", "iface-rest", "REST",
            "get", " /things ", null);
        // SOAP endpoint keyed on soap_action -- NEVER matchable by a harness
        // op (operations always key on <METHOD> <path>).
        EndpointEntity soapAction = endpoint("ep-soap-action", "iface-soap", "SOAP",
            "POST", "/soap", soapMeta("urn:GetFoo", "GetFooRequest"));
        // SOAP endpoint with NO soap_action -> request_root_element fallback.
        EndpointEntity soapRoot = endpoint("ep-soap-root", "iface-soap", "SOAP",
            "POST", "/soap", soapMeta(null, "GetBarRequest"));
        // SOAP endpoint with NO discriminator at all -> soap::<endpoint id>.
        EndpointEntity soapBare = endpoint("ep-soap-bare", "iface-soap", "SOAP",
            "POST", "/soap", null);

        ApiBehaviourOperationEntity opMatched = op("getThings", "GET", "/things");
        ApiBehaviourOperationEntity opGhost = op("ghost", "DELETE", "/ghost");

        InventoryReconciliationCalculator.Result result =
            InventoryReconciliationCalculator.reconcile(
                List.of(restMatched, soapAction, soapRoot, soapBare),
                List.of(opMatched, opGhost));

        // Key derivations are the calculator's single source of truth.
        assertThat(InventoryReconciliationCalculator.endpointKey(restMatched))
            .isEqualTo("GET /things");
        assertThat(InventoryReconciliationCalculator.endpointKey(soapAction))
            .isEqualTo("soap::urn:GetFoo");
        assertThat(InventoryReconciliationCalculator.endpointKey(soapRoot))
            .isEqualTo("soap::GetBarRequest");
        assertThat(InventoryReconciliationCalculator.endpointKey(soapBare))
            .isEqualTo("soap::ep-soap-bare");
        assertThat(InventoryReconciliationCalculator.operationKey(opMatched))
            .isEqualTo("GET /things");

        // Endpoint direction: the three SOAP endpoints are unmatched (full refs).
        assertThat(result.endpointsWithoutOperation())
            .containsExactly(soapAction, soapRoot, soapBare);
        assertThat(result.unmatchedEndpointKeys()).containsExactly(
            "soap::urn:GetFoo", "soap::GetBarRequest", "soap::ep-soap-bare");
        assertThat(result.matchedEndpointCount()).isEqualTo(1);

        // Operation direction: the ghost op is unmatched (full ref).
        assertThat(result.operationsWithoutEndpoint()).containsExactly(opGhost);
        assertThat(result.unmatchedOperationKeys()).containsExactly("DELETE /ghost");
        assertThat(result.matchedOperationCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("(h) readiness gate C derives its existing two counts unchanged via the calculator (distinct-KEY counting preserved)")
    void readinessGateCountsDeriveUnchangedFromCalculator() {
        // Two endpoints sharing ONE key (duplicate rows) -- the pre-extraction
        // gate counted distinct KEYS, so these must count as ONE, not two.
        EndpointEntity dupA = endpoint("ep-a", "iface", "REST", "GET", "/dup", null);
        EndpointEntity dupB = endpoint("ep-b", "iface", "REST", "GET", "/dup", null);
        EndpointEntity matched = endpoint("ep-c", "iface", "REST", "POST", "/c", null);

        ApiBehaviourOperationEntity opMatched = op("c", "POST", "/c");
        ApiBehaviourOperationEntity opGhost1 = op("g1", "PUT", "/ghost");
        ApiBehaviourOperationEntity opGhost1Dup = op("g1-dup", "PUT", "/ghost");
        ApiBehaviourOperationEntity opGhost2 = op("g2", "DELETE", "/ghost2");

        List<EndpointEntity> endpoints = List.of(dupA, dupB, matched);
        List<ApiBehaviourOperationEntity> ops =
            List.of(opMatched, opGhost1, opGhost1Dup, opGhost2);

        InventoryReconciliation gate =
            MigrationDiscoveryContextService.computeInventoryReconciliation(endpoints, ops);
        InventoryReconciliationCalculator.Result detailed =
            InventoryReconciliationCalculator.reconcile(endpoints, ops);

        // Pre-extraction semantics: 1 distinct unmatched endpoint key
        // ("GET /dup"), 2 distinct unmatched operation keys.
        assertThat(gate.discoveredNotCapturedCount()).isEqualTo(1);
        assertThat(gate.capturedNotDiscoveredCount()).isEqualTo(2);
        assertThat(gate.isReconciled()).isFalse();

        // The gate's integers ARE the calculator's distinct unmatched key-set
        // sizes -- single source of truth, no parallel computation.
        assertThat(gate.discoveredNotCapturedCount())
            .isEqualTo(detailed.unmatchedEndpointKeys().size());
        assertThat(gate.capturedNotDiscoveredCount())
            .isEqualTo(detailed.unmatchedOperationKeys().size());
        // The detailed result still carries FULL refs (rows, not keys).
        assertThat(detailed.endpointsWithoutOperation()).containsExactly(dupA, dupB);
        assertThat(detailed.operationsWithoutEndpoint())
            .containsExactly(opGhost1, opGhost1Dup, opGhost2);
    }

    @Test
    @DisplayName("(Task Group 5) SOAP key round-trip: a model-synthesised operation row carrying x-amvs-soap keys soap::<action|root> and ACCOUNTS for its endpoint; harness rows stay <METHOD> <path>")
    void synthesisedSoapOperationRowRoundTripsToAccounted() {
        // The two SOAP endpoints the wizard's INCLUDE / EXCLUDE accounting
        // action would synthesise rows for.
        EndpointEntity soapAction = endpoint("ep-soap-action", "iface-soap", "SOAP",
            "POST", "/services/Account", soapMeta("urn:GetAccount", "GetAccountRequest"));
        EndpointEntity soapRootOnly = endpoint("ep-soap-root", "iface-soap", "SOAP",
            "POST", "/services/Account", soapMeta(null, "GetBalanceRequest"));

        // Synthesised rows: method POST + the servlet path (NOT the SOAP key)
        // but with the endpoint's SOAP metadata stamped under x-amvs-soap on
        // oas_operation_json -- exactly what account-endpoints persists.
        ApiBehaviourOperationEntity includedRow = soapSynthesisedOp(
            "urn:GetAccount", "POST", "/services/Account",
            "urn:GetAccount", "GetAccountRequest");
        ApiBehaviourOperationEntity excludedRow = soapSynthesisedOp(
            "GetBalance", "POST", "/services/Account",
            null, "GetBalanceRequest");
        // A genuinely harness-captured op (no x-amvs-soap block) keeps the
        // pre-extraction <METHOD> <path> key -- readiness behaviour frozen.
        ApiBehaviourOperationEntity harnessRow = op("ghost", "POST", "/services/Account");

        // Key derivations: the synthesised rows mirror the ENDPOINT
        // discriminator chain (soap_action preferred, root-element fallback).
        assertThat(InventoryReconciliationCalculator.operationKey(includedRow))
            .isEqualTo("soap::urn:GetAccount")
            .isEqualTo(InventoryReconciliationCalculator.endpointKey(soapAction));
        assertThat(InventoryReconciliationCalculator.operationKey(excludedRow))
            .isEqualTo("soap::GetBalanceRequest")
            .isEqualTo(InventoryReconciliationCalculator.endpointKey(soapRootOnly));
        assertThat(InventoryReconciliationCalculator.operationKey(harnessRow))
            .isEqualTo("POST /services/Account");

        // Round trip: after include + exclude both SOAP endpoints are
        // ACCOUNTED on the next reconcile -- the gate can clear.
        InventoryReconciliationCalculator.Result result =
            InventoryReconciliationCalculator.reconcile(
                List.of(soapAction, soapRootOnly),
                List.of(includedRow, excludedRow, harnessRow));
        assertThat(result.endpointsWithoutOperation()).isEmpty();
        assertThat(result.matchedEndpointCount()).isEqualTo(2);
        // ... and NO spurious operation-without-model-endpoint entry exists
        // for the synthesised rows (only the genuine harness ghost remains).
        assertThat(result.operationsWithoutEndpoint()).containsExactly(harnessRow);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static EndpointEntity endpoint(
            String id, String interfaceId, String protocol, String verb, String path,
            Map<String, Object> protocolMeta) {
        return EndpointEntity.builder()
            .id(id)
            .modelFileId("mf-1")
            .interfaceId(interfaceId)
            .name(id)
            .protocol(protocol)
            .endpointType(protocol)
            .operationVerb(verb)
            .pathOrAddress(path)
            .protocolMetadataJson(protocolMeta)
            .build();
    }

    private static Map<String, Object> soapMeta(String soapAction, String requestRootElement) {
        Map<String, Object> m = new HashMap<>();
        if (soapAction != null) {
            m.put("soap_action", soapAction);
        }
        if (requestRootElement != null) {
            m.put("request_root_element", requestRootElement);
        }
        return m;
    }

    /**
     * Operation row as the validation service's include/exclude accounting
     * action synthesises it from a SOAP endpoint: method/path from the
     * endpoint row, the SOAP metadata stamped under
     * {@code oas_operation_json['x-amvs-soap']}.
     */
    private static ApiBehaviourOperationEntity soapSynthesisedOp(
            String operationId, String method, String path,
            String soapAction, String requestRootElement) {
        Map<String, Object> soapBlock = soapMeta(soapAction, requestRootElement);
        Map<String, Object> oas = new HashMap<>();
        oas.put("x-amvs-source", "model-endpoint-reconciliation");
        oas.put("x-amvs-soap", soapBlock);
        return ApiBehaviourOperationEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(SESSION_ID)
            .operationId(operationId)
            .method(method)
            .path(path)
            .oasOperationJson(oas)
            .build();
    }

    private static ApiBehaviourOperationEntity op(String operationId, String method, String path) {
        return ApiBehaviourOperationEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(SESSION_ID)
            .operationId(operationId)
            .method(method)
            .path(path)
            .oasOperationJson(new HashMap<>())
            .build();
    }
}
