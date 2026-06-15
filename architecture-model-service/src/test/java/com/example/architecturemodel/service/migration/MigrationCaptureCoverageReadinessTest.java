package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationGapCodes;
import com.example.architecturemodel.model.dto.migration.ReadinessAssessmentDto;
import com.example.architecturemodel.model.entity.EndpointEntity;
import com.example.architecturemodel.model.entity.InterfaceLogicalEntityEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourOperationEntity;
import com.example.architecturemodel.model.entity.discovery.EndpointDataEffectEntity;
import com.example.architecturemodel.service.migration.MigrationDiscoveryContextService.CaptureCoverage;
import com.example.architecturemodel.service.migration.MigrationDiscoveryContextService.CoverageAggregates;
import com.example.architecturemodel.service.migration.MigrationDiscoveryContextService.InventoryReconciliation;
import com.example.architecturemodel.service.migration.MigrationDiscoveryContextService.ReadinessContext;
import com.example.architecturemodel.service.migration.MigrationDiscoveryContextService.SpecificationCoverage;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused tests for the three computed-on-read coverage dimensions folded into
 * {@link MigrationDiscoveryContextService#assessReadiness} by Spec
 * "Capture Coverage Gates" (2026-05-30) -- Task Group 1.
 *
 * <p>These exercise the pure static computation helpers + the static
 * {@code assessReadiness} folding directly (the helpers take already-loaded
 * entity lists, so no Spring / Mockito wiring is required). The end-to-end
 * {@code build(...)} path is covered by the pre-existing
 * {@code MigrationDiscoveryContextServiceTest}.</p>
 *
 * <p>Critical behaviours asserted (per task 1.1):</p>
 * <ul>
 *   <li>(A) partial capture &rarr; {@code incomplete_capture_coverage} + stream
 *       downgrade; surfaces WHICH operations are missing.</li>
 *   <li>(A) captured-but-never-replayed (current-only baseline) &rarr; NO false
 *       diff-coverage error.</li>
 *   <li>(B) under-specified REST (no data effect) and SOAP-by-message-bindings
 *       scored on the SOAP bar &rarr; {@code under_specified_endpoints}.</li>
 *   <li>(C) both-direction mismatch with the SOAP-aware key &rarr;
 *       {@code discovery_harness_inventory_mismatch}.</li>
 *   <li>fully-covered input emits NONE of the new codes.</li>
 *   <li>advisory semantics: streams downgrade (never block); {@code gaps} stays
 *       deduped.</li>
 * </ul>
 */
class MigrationCaptureCoverageReadinessTest {

    private static final UUID SESSION_ID = UUID.randomUUID();

    // ======================================================================
    // (A) CAPTURE coverage computation
    // ======================================================================

    @Test
    @DisplayName("(A) partial capture: capturedCount < includedCount and missing ops surfaced")
    void captureCoveragePartialSurfacesMissingOperations() {
        ApiBehaviourOperationEntity op1 = op("getThing", "GET", "/things/{id}", true);
        ApiBehaviourOperationEntity op2 = op("createThing", "POST", "/things", true);
        ApiBehaviourOperationEntity op3 = op("deleteThing", "DELETE", "/things/{id}", true);
        // op2 is excluded -- must not count toward the denominator.
        ApiBehaviourOperationEntity opExcluded = op("internalThing", "PUT", "/internal", false);

        // Only op1 captured.
        ApiBehaviourCaptureEntity cap = capture(op1.getId());

        CaptureCoverage cov = MigrationDiscoveryContextService.computeCaptureCoverage(
            List.of(op1, op2, op3, opExcluded), List.of(cap), /* anyDiffed */ false);

        assertThat(cov.includedCount()).isEqualTo(3);
        assertThat(cov.capturedCount()).isEqualTo(1);
        assertThat(cov.isComplete()).isFalse();
        // The two un-captured INCLUDED operations are surfaced (excluded op is not).
        assertThat(cov.missingOperationKeys())
            .containsExactlyInAnyOrder("POST /things", "DELETE /things/{id}");
        // anyDiffed false here is NOT an error -- see the dedicated diff test.
        assertThat(cov.anyDiffed()).isFalse();
    }

    @Test
    @DisplayName("(A) current-only baseline never replayed: anyDiffed=false is NOT a coverage error")
    void captureCoverageCurrentOnlyBaselineNoFalseDiffError() {
        ApiBehaviourOperationEntity op1 = op("getThing", "GET", "/things/{id}", true);
        // Fully captured, but never replayed/diffed (anyDiffed=false).
        CaptureCoverage cov = MigrationDiscoveryContextService.computeCaptureCoverage(
            List.of(op1), List.of(capture(op1.getId())), /* anyDiffed */ false);

        assertThat(cov.isComplete()).isTrue();            // capture is complete
        assertThat(cov.missingOperationKeys()).isEmpty();
        assertThat(cov.anyDiffed()).isFalse();            // by nature -- not an error

        // Fold into readiness: a complete capture with no diff must NOT emit the
        // incomplete-capture code.
        ReadinessContext ctx = ctxWithCoverage(
            baselineSummary(1, 1),
            new CoverageAggregates(cov, SpecificationCoverage.empty(), InventoryReconciliation.empty()));
        ReadinessAssessmentDto readiness = MigrationDiscoveryContextService.assessReadiness(ctx);

        assertThat(readiness.gaps()).doesNotContain(MigrationGapCodes.INCOMPLETE_CAPTURE_COVERAGE);
    }

    // ======================================================================
    // (B) SPECIFICATION coverage computation (per-protocol)
    // ======================================================================

    @Test
    @DisplayName("(B) under-specified REST (no data effect) vs SOAP scored on message-binding bar")
    void specificationCoveragePerProtocolBar() {
        // REST endpoint WITH a resolved data effect -> fully specified.
        EndpointEntity restOk = endpoint("ep-rest-ok", "iface-rest", "REST", "GET", "/ok", null);
        // REST endpoint WITHOUT a data effect -> under-specified.
        EndpointEntity restBad = endpoint("ep-rest-bad", "iface-rest", "REST", "GET", "/bad", null);
        // SOAP op whose parent interface HAS bound message entities -> fully specified
        // (judged on the SOAP bar, NOT on data effects -- it has none).
        EndpointEntity soapOk = endpoint("ep-soap-ok", "iface-soap-ok", "SOAP", "POST", null,
            soapMeta("urn:GetFoo", "GetFooRequest"));
        // SOAP op whose parent interface has NO bound message entities -> under-specified.
        EndpointEntity soapBad = endpoint("ep-soap-bad", "iface-soap-bad", "SOAP", "POST", null,
            soapMeta("urn:GetBar", "GetBarRequest"));

        Map<String, List<EndpointDataEffectEntity>> effectsByEndpoint = new HashMap<>();
        effectsByEndpoint.put("ep-rest-ok", List.of(dataEffect("ep-rest-ok")));
        // restBad, soapOk, soapBad: no data effects.

        Map<String, List<InterfaceLogicalEntityEntity>> bindingsByInterface = new HashMap<>();
        bindingsByInterface.put("iface-soap-ok", List.of(messageBinding("iface-soap-ok")));
        // iface-soap-bad: no bindings.

        SpecificationCoverage cov = MigrationDiscoveryContextService.computeSpecificationCoverage(
            List.of(restOk, restBad, soapOk, soapBad), effectsByEndpoint, bindingsByInterface);

        assertThat(cov.totalEndpoints()).isEqualTo(4);
        assertThat(cov.fullySpecifiedCount()).isEqualTo(2); // restOk + soapOk
        assertThat(cov.isComplete()).isFalse();
        assertThat(cov.underSpecifiedEndpointIds())
            .containsExactlyInAnyOrder("ep-rest-bad", "ep-soap-bad");
    }

    @Test
    @DisplayName("(B) behaviour is BONUS only: a SOAP op with bound messages is specified without behaviour")
    void specificationCoverageBehaviourIsBonusOnly() {
        EndpointEntity soapOk = endpoint("ep-soap-ok", "iface-soap-ok", "SOAP", "POST", null,
            soapMeta("urn:GetFoo", "GetFooRequest"));
        Map<String, List<InterfaceLogicalEntityEntity>> bindingsByInterface = new HashMap<>();
        bindingsByInterface.put("iface-soap-ok", List.of(messageBinding("iface-soap-ok")));

        SpecificationCoverage cov = MigrationDiscoveryContextService.computeSpecificationCoverage(
            List.of(soapOk), Map.of(), bindingsByInterface);

        // No business_logics.behavior was supplied at all, yet the endpoint is
        // fully specified on the SOAP message-binding bar.
        assertThat(cov.fullySpecifiedCount()).isEqualTo(1);
        assertThat(cov.isComplete()).isTrue();
    }

    // ======================================================================
    // (C) INVENTORY reconciliation computation (both directions, SOAP-aware key)
    // ======================================================================

    @Test
    @DisplayName("(C) both-direction mismatch flagged with the SOAP-aware key")
    void inventoryReconciliationBothDirectionsSoapAwareKey() {
        // Two SOAP ops on the SAME servlet path -- {method,path} would collapse
        // them to one POST/null. The SOAP-aware key keeps them distinct.
        EndpointEntity soapA = endpoint("ep-soap-a", "iface-soap", "SOAP", "POST", null,
            soapMeta("urn:OpA", "OpARequest"));
        EndpointEntity soapB = endpoint("ep-soap-b", "iface-soap", "SOAP", "POST", null,
            soapMeta("urn:OpB", "OpBRequest"));
        // A REST endpoint discovered but never captured by the harness.
        EndpointEntity restDiscoveredOnly = endpoint("ep-rest", "iface-rest", "REST", "GET", "/only-discovered", null);

        // Harness captured a REST op the model never discovered (captured-but-not-discovered).
        ApiBehaviourOperationEntity harnessRestOnly = op("ghost", "GET", "/only-in-harness", true);

        InventoryReconciliation rec = MigrationDiscoveryContextService.computeInventoryReconciliation(
            List.of(soapA, soapB, restDiscoveredOnly), List.of(harnessRestOnly));

        // discovered-but-not-captured: both SOAP ops (distinct keys) + the REST one = 3.
        assertThat(rec.discoveredNotCapturedCount()).isEqualTo(3);
        // captured-but-not-discovered: the harness ghost op = 1.
        assertThat(rec.capturedNotDiscoveredCount()).isEqualTo(1);
        assertThat(rec.isReconciled()).isFalse();
    }

    @Test
    @DisplayName("(Task Group 5) gate C clears once every endpoint is ACCOUNTED by session rows -- include, exclude-with-reason, and synthesised SOAP rows all count; DISCOVERY_HARNESS_INVENTORY_MISMATCH not emitted")
    void inventoryMismatchClearsWhenAllEndpointsAccounted() {
        // Three committed endpoints: a REST one covered by an ordinary
        // include row, a REST one covered by an EXCLUDED-with-reason
        // accounting row (gate C loads ALL session rows -- the exclusion row
        // carries the identity key, so the mismatch clears), and a SOAP one
        // covered by a model-synthesised include row keyed via x-amvs-soap.
        EndpointEntity restIncluded = endpoint("ep-1", "iface-a", "REST", "GET", "/a", null);
        EndpointEntity restExcluded = endpoint("ep-2", "iface-a", "REST", "POST", "/b", null);
        EndpointEntity soapIncluded = endpoint("ep-3", "iface-soap", "SOAP", "POST", "/soap",
            soapMeta("urn:GetAccount", "GetAccountRequest"));

        ApiBehaviourOperationEntity includeRow = op("getA", "GET", "/a", true);
        ApiBehaviourOperationEntity excludeRow = ApiBehaviourOperationEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(SESSION_ID)
            .operationId("legacyB")
            .method("POST")
            .path("/b")
            .included(false)
            .exclusionReason("deprecated -- retired endpoint")
            .oasOperationJson(new HashMap<>())
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        Map<String, Object> soapOas = new HashMap<>();
        soapOas.put("x-amvs-source", "model-endpoint-reconciliation");
        soapOas.put("x-amvs-soap", soapMeta("urn:GetAccount", "GetAccountRequest"));
        ApiBehaviourOperationEntity soapRow = ApiBehaviourOperationEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(SESSION_ID)
            .operationId("urn:GetAccount")
            .method("POST")
            .path("/soap")
            .included(true)
            .oasOperationJson(soapOas)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        InventoryReconciliation rec = MigrationDiscoveryContextService.computeInventoryReconciliation(
            List.of(restIncluded, restExcluded, soapIncluded),
            List.of(includeRow, excludeRow, soapRow));

        // Both directions reconcile: no endpoint is unaccounted, no row is a ghost.
        assertThat(rec.discoveredNotCapturedCount()).isZero();
        assertThat(rec.capturedNotDiscoveredCount()).isZero();
        assertThat(rec.isReconciled()).isTrue();

        // Folded into readiness, the advisory mismatch code is ABSENT --
        // genuine coverage clears it naturally (D6), no override needed.
        ReadinessContext ctx = ctxWithCoverage(
            baselineSummary(1, 1),
            new CoverageAggregates(
                new CaptureCoverage(2, 2, List.of(), true),
                new SpecificationCoverage(3, 3, List.of()),
                rec));
        ReadinessAssessmentDto readiness = MigrationDiscoveryContextService.assessReadiness(ctx);
        assertThat(readiness.gaps())
            .doesNotContain(MigrationGapCodes.DISCOVERY_HARNESS_INVENTORY_MISMATCH);
    }

    // ======================================================================
    // Folding into readiness: advisory downgrade, dedupe, fully-covered sanity
    // ======================================================================

    @Test
    @DisplayName("Advisory: (A)+(C) downgrade api/baseline, (B) downgrades discovery; never blocks; gaps deduped")
    void coverageGapsFoldAdvisorilyAndDedupe() {
        // (A) partial capture (1 of 2), (B) under-specified (1 of 2),
        // (C) mismatch in both directions.
        CaptureCoverage capture = new CaptureCoverage(2, 1, List.of("POST /things"), false);
        SpecificationCoverage spec = new SpecificationCoverage(2, 1, List.of("ep-bad"));
        InventoryReconciliation rec = new InventoryReconciliation(1, 1);

        // Baseline present + active so the base streams would otherwise be sufficient.
        ReadinessContext ctx = ctxWithCoverage(
            baselineSummary(1, 1),
            new CoverageAggregates(capture, spec, rec));
        ReadinessAssessmentDto readiness = MigrationDiscoveryContextService.assessReadiness(ctx);

        // All three new codes present.
        assertThat(readiness.gaps()).contains(
            MigrationGapCodes.INCOMPLETE_CAPTURE_COVERAGE,
            MigrationGapCodes.UNDER_SPECIFIED_ENDPOINTS,
            MigrationGapCodes.DISCOVERY_HARNESS_INVENTORY_MISMATCH);

        // Advisory downgrade -- streams move to partial, NOT insufficient/blocked.
        assertThat(readiness.apiReadiness()).isEqualTo(MigrationGapCodes.STATUS_PARTIAL);
        assertThat(readiness.baselineReadiness()).isEqualTo(MigrationGapCodes.STATUS_PARTIAL);
        // discoveryReadiness had a completed run + no high-sev unreviewed (sufficient)
        // -> downgraded to partial by (B).
        assertThat(readiness.discoveryReadiness()).isEqualTo(MigrationGapCodes.STATUS_PARTIAL);

        // gaps deduped (no duplicate codes even though A + C both touch two streams).
        assertThat(readiness.gaps()).doesNotHaveDuplicates();
    }

    @Test
    @DisplayName("Fully-covered input emits NONE of the three new coverage codes")
    void fullyCoveredEmitsNoNewCodes() {
        CaptureCoverage capture = new CaptureCoverage(3, 3, List.of(), true);
        SpecificationCoverage spec = new SpecificationCoverage(4, 4, List.of());
        InventoryReconciliation rec = new InventoryReconciliation(0, 0);

        ReadinessContext ctx = ctxWithCoverage(
            baselineSummary(1, 1),
            new CoverageAggregates(capture, spec, rec));
        ReadinessAssessmentDto readiness = MigrationDiscoveryContextService.assessReadiness(ctx);

        assertThat(readiness.gaps()).doesNotContain(
            MigrationGapCodes.INCOMPLETE_CAPTURE_COVERAGE,
            MigrationGapCodes.UNDER_SPECIFIED_ENDPOINTS,
            MigrationGapCodes.DISCOVERY_HARNESS_INVENTORY_MISMATCH);
    }

    // ======================================================================
    // Helpers
    // ======================================================================

    /**
     * Build a {@link ReadinessContext} with a completed run, an interface in the
     * model, the supplied baseline summary, and the supplied coverage aggregates
     * -- so the base api/discovery/baseline streams start at their happy-path
     * status and the only downgrade under test is from coverage.
     */
    private static ReadinessContext ctxWithCoverage(
            MigrationDiscoveryContextDto.ApiBehaviourBaselineSummary baselineSummary,
            CoverageAggregates coverage) {
        MigrationDiscoveryContextDto.ArchitectureSummary arch =
            new MigrationDiscoveryContextDto.ArchitectureSummary(
                UUID.randomUUID(), "Current",
                1, 1, /* interfaces */ 1, /* dataEntities */ 1, 1, 0, 0, 0, 0, true);

        com.example.architecturemodel.model.entity.DiscoveryRunEntity run =
            com.example.architecturemodel.model.entity.DiscoveryRunEntity.builder()
                .id(UUID.randomUUID())
                .projectId(UUID.randomUUID())
                .architectureId(UUID.randomUUID())
                .status("COMPLETED")
                .discoveryKind("code")
                .build();

        return new ReadinessContext(
            arch,
            null,
            List.of(run),
            List.of(),       // no findings -> no high-sev unreviewed
            List.of(),       // no unresolved decision tasks
            baselineSummary,
            null,
            null,
            null,
            false,
            coverage);
    }

    private static MigrationDiscoveryContextDto.ApiBehaviourBaselineSummary baselineSummary(
            int active, int total) {
        return new MigrationDiscoveryContextDto.ApiBehaviourBaselineSummary(
            total, active, total - active, List.of());
    }

    private static ApiBehaviourOperationEntity op(
            String operationId, String method, String path, boolean included) {
        return ApiBehaviourOperationEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(SESSION_ID)
            .operationId(operationId)
            .method(method)
            .path(path)
            .included(included)
            .safeToExecute(Boolean.TRUE)
            .oasOperationJson(new HashMap<>())
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }

    private static ApiBehaviourCaptureEntity capture(UUID operationId) {
        return ApiBehaviourCaptureEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(SESSION_ID)
            .scenarioId(UUID.randomUUID())
            .operationId(operationId)
            .attemptNumber(1)
            .requestMethod("GET")
            .requestUrlRedacted("https://x/y")
            .requestPath("/y")
            .responseStatus(200)
            .accepted(Boolean.TRUE)
            .capturedAt(Instant.now())
            .build();
    }

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
        m.put("soap_action", soapAction);
        m.put("request_root_element", requestRootElement);
        return m;
    }

    private static EndpointDataEffectEntity dataEffect(String endpointId) {
        EndpointDataEffectEntity e = new EndpointDataEffectEntity();
        e.setId("ede-" + endpointId);
        e.setModelFileId("mf-1");
        e.setEndpointId(endpointId);
        return e;
    }

    private static InterfaceLogicalEntityEntity messageBinding(String interfaceId) {
        return InterfaceLogicalEntityEntity.builder()
            .id("ile-" + interfaceId)
            .modelFileId("mf-1")
            .interfaceId(interfaceId)
            .dataEntityPointId("dep_log_msg-1")
            .build();
    }
}
