package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.apibehaviour.InventoryReconciliationRequest;
import com.example.architecturemodel.model.dto.apibehaviour.InventoryReconciliationResponse;
import com.example.architecturemodel.model.dto.apibehaviour.InventoryReconciliationResponse.ExcludedByScopeEndpointRef;
import com.example.architecturemodel.model.dto.apibehaviour.InventoryReconciliationResponse.OperationWithoutModelEndpointRef;
import com.example.architecturemodel.model.dto.apibehaviour.InventoryReconciliationResponse.UnaccountedEndpointRef;
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
import com.example.architecturemodel.service.migration.InventoryReconciliationCalculator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Capture-session inventory reconciliation against the committed
 * architecture-model endpoint set -- the enumerator-of-record check.
 *
 * <p>Spec: Model-Seeded Capture Inventory (2026-06-11) -- Task Group 1.
 * Serves BOTH call sites with one write path: configure-time
 * ({@code reconcile-inventory} action, default {@code refresh_findings:
 * true}) and Start-time (the {@code /start} hard-block gate, also
 * {@code refresh_findings: true}); display-only callers (baseline coverage
 * figure) pass {@code refresh_findings: false} and write nothing.</p>
 *
 * <h2>Scope resolution (null scope = whole architecture)</h2>
 * <p>Request {@code scope_interface_ids} &rarr; session row's persisted
 * {@code scope_interface_ids_json} &rarr; whole-architecture endpoint set --
 * nothing silently absent. When {@code persist_scope=true} AND the request
 * provided ids, they are written to the session row.</p>
 *
 * <h2>Accounting</h2>
 * <p>An endpoint is ACCOUNTED iff its reconciliation key (from
 * {@link InventoryReconciliationCalculator} -- the SINGLE comparison home,
 * never reimplemented in TypeScript) matches at least one of the session's
 * operation rows, REGARDLESS of the row's {@code included} value: an
 * excluded-with-reason row ({@code included=false} + {@code
 * exclusion_reason}) counts as accounted. Persistence IS the accounting
 * record.</p>
 *
 * <h2>Finding emission (delete-before-emit, diffRunner precedent)</h2>
 * <p>When {@code refresh_findings=true}: delete ALL prior findings carrying
 * this session's {@code api_behaviour_capture_session_id}, then emit one
 * finding per operation-without-model-endpoint. Per-finding failures are
 * fail-soft (log + skip); the reconciliation response is NEVER failed by an
 * emission error.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourInventoryReconciliationService {

    private final ApiBehaviourCaptureSessionRepository sessionRepository;
    private final ApiBehaviourOperationRepository operationRepository;
    private final ModelFileRepository modelFileRepository;
    private final EndpointRepository endpointRepository;
    private final DiscoveryFindingService discoveryFindingService;

    @Transactional
    public InventoryReconciliationResponse reconcile(
            UUID projectId, UUID sessionId, InventoryReconciliationRequest request) {
        ApiBehaviourCaptureSessionEntity session = findOrThrow(projectId, sessionId);

        // --- Scope fallback chain: request -> session row -> whole architecture. ---
        List<String> requestScope = request == null ? null : request.scopeInterfaceIds();
        List<String> effectiveScope = requestScope != null
            ? requestScope
            : session.getScopeInterfaceIdsJson();
        Set<String> scopeSet = effectiveScope == null ? null : new HashSet<>(effectiveScope);

        // --- Load the architecture's committed endpoints (gate-C lookup shape). ---
        String modelFileId = modelFileRepository
            .findByProjectIdAndArchitectureId(projectId, session.getArchitectureId())
            .map(ModelFileEntity::getId)
            .orElse(null);
        List<EndpointEntity> endpoints = modelFileId == null
            ? List.of()
            : endpointRepository.findByModelFileId(modelFileId);
        if (endpoints == null) {
            endpoints = List.of();
        }

        // --- Load the session's persisted operation rows (ALL rows: an
        // excluded-with-reason row still accounts for its endpoint). ---
        List<ApiBehaviourOperationEntity> operations =
            operationRepository.findBySessionIdOrderByCreatedAtAsc(sessionId);

        // --- ONE whole-architecture comparison via the shared calculator. ---
        InventoryReconciliationCalculator.Result result =
            InventoryReconciliationCalculator.reconcile(endpoints, operations);
        Set<String> unmatchedEndpointIds = new HashSet<>();
        for (EndpointEntity ep : result.endpointsWithoutOperation()) {
            unmatchedEndpointIds.add(ep.getId());
        }

        // --- Scope partition + coverage tallies. ---
        List<UnaccountedEndpointRef> inScopeUnaccounted = new ArrayList<>();
        List<ExcludedByScopeEndpointRef> excludedByScope = new ArrayList<>();
        int inScopeTotal = 0;
        int inScopeAccounted = 0;
        int architectureAccounted = 0;
        for (EndpointEntity ep : endpoints) {
            boolean accounted = !unmatchedEndpointIds.contains(ep.getId());
            if (accounted) {
                architectureAccounted++;
            }
            boolean inScope = scopeSet == null || scopeSet.contains(ep.getInterfaceId());
            if (inScope) {
                inScopeTotal++;
                if (accounted) {
                    inScopeAccounted++;
                } else {
                    inScopeUnaccounted.add(toUnaccountedRef(ep));
                }
            } else {
                excludedByScope.add(new ExcludedByScopeEndpointRef(
                    ep.getId(),
                    ep.getInterfaceId(),
                    InventoryReconciliationCalculator.endpointKey(ep),
                    ep.getName()));
            }
        }

        List<OperationWithoutModelEndpointRef> operationsWithoutEndpoint = new ArrayList<>();
        for (ApiBehaviourOperationEntity op : result.operationsWithoutEndpoint()) {
            operationsWithoutEndpoint.add(new OperationWithoutModelEndpointRef(
                op.getId(),
                op.getOperationId(),
                op.getMethod(),
                op.getPath(),
                InventoryReconciliationCalculator.operationKey(op)));
        }

        // --- Persist the scope onto the session row when asked to. ---
        if (request != null
                && Boolean.TRUE.equals(request.persistScope())
                && requestScope != null) {
            session.setScopeInterfaceIdsJson(new ArrayList<>(requestScope));
            sessionRepository.saveAndFlush(session);
        }

        // --- Findings refresh (default TRUE; delete-before-emit; fail-soft). ---
        boolean refreshFindings = request == null
            || request.refreshFindings() == null
            || Boolean.TRUE.equals(request.refreshFindings());
        if (refreshFindings) {
            refreshReconciliationFindings(
                projectId, session.getArchitectureId(), sessionId,
                result.operationsWithoutEndpoint());
        }

        return new InventoryReconciliationResponse(
            inScopeUnaccounted,
            operationsWithoutEndpoint,
            excludedByScope,
            pct(inScopeAccounted, inScopeTotal),
            inScopeAccounted,
            inScopeTotal,
            pct(architectureAccounted, endpoints.size()),
            architectureAccounted,
            endpoints.size());
    }

    // ------------------------------------------------------------------
    // Finding emission (single write path; diffRunner delete-before-emit)
    // ------------------------------------------------------------------

    /**
     * Delete ALL prior reconciliation findings for the session, then emit
     * one finding per operation-without-model-endpoint. Idempotent across
     * re-runs by construction. The whole block is fail-soft: a delete
     * failure skips emission (never accumulate duplicates); a per-finding
     * emission failure logs + skips that finding. The reconciliation
     * response is never failed from here.
     */
    private void refreshReconciliationFindings(
            UUID projectId, UUID architectureId, UUID sessionId,
            List<ApiBehaviourOperationEntity> operationsWithoutEndpoint) {
        try {
            int deleted = discoveryFindingService.deleteFindingsByCaptureSessionId(sessionId);
            if (deleted > 0) {
                log.info("inventory-reconciliation: deleted {} prior reconciliation "
                    + "finding(s) for session {}", deleted, sessionId);
            }
        } catch (RuntimeException ex) {
            // Without a clean delete, re-emitting would accumulate duplicates
            // across re-runs -- skip emission entirely this round (fail-soft).
            log.warn("inventory-reconciliation: failed to delete prior findings for "
                + "session {} -- skipping finding emission this run: {}",
                sessionId, ex.toString());
            return;
        }
        for (ApiBehaviourOperationEntity op : operationsWithoutEndpoint) {
            try {
                discoveryFindingService.createForCaptureSession(
                    projectId, architectureId, sessionId, buildFindingRequest(op));
            } catch (RuntimeException ex) {
                // Fail-soft per finding (mirrors diffRunner): log + skip.
                log.warn("inventory-reconciliation: failed to emit reconciliation "
                    + "finding for operation {} (session {}): {}",
                    op.getId(), sessionId, ex.toString());
            }
        }
    }

    /**
     * Finding shape per the spec: origin = the capture session (other two
     * origins null, satisfying the three-way CHECK);
     * {@code category: reconciliation};
     * {@code finding_type: operation_without_model_endpoint};
     * {@code severity: medium}; review disposition defaults to
     * {@code pending_review} (the post-Spec-F vocabulary equivalent of the
     * legacy {@code new} status); {@code source:
     * capture_inventory_reconciliation}; title/summary carry the operation's
     * method + path via its reconciliation key; {@code detail_json} carries
     * the operation row id, {@code operation_id}, and the key.
     */
    private static CreateDiscoveryFindingRequest buildFindingRequest(
            ApiBehaviourOperationEntity op) {
        String key = InventoryReconciliationCalculator.operationKey(op);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("operation_row_id", op.getId() == null ? null : op.getId().toString());
        detail.put("operation_id", op.getOperationId());
        detail.put("reconciliation_key", key);
        detail.put("method", op.getMethod());
        detail.put("path", op.getPath());
        return new CreateDiscoveryFindingRequest(
            "operation_without_model_endpoint",
            "reconciliation",
            "medium",
            null,
            null, // review status -> service default pending_review
            "Captured operation without model endpoint: " + key,
            "The capture session knows operation '" + key + "'"
                + (op.getOperationId() == null ? "" : " (" + op.getOperationId() + ")")
                + " but no committed architecture-model endpoint matches its "
                + "reconciliation key -- a discovery gap worth reviewing.",
            detail,
            "capture_inventory_reconciliation",
            null,
            null,
            null);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static UnaccountedEndpointRef toUnaccountedRef(EndpointEntity ep) {
        String soapAction = null;
        String requestRootElement = null;
        Map<String, Object> meta = ep.getProtocolMetadataJson();
        if (meta != null) {
            Object action = meta.get("soap_action");
            soapAction = action == null ? null : action.toString();
            Object root = meta.get("request_root_element");
            requestRootElement = root == null ? null : root.toString();
        }
        return new UnaccountedEndpointRef(
            ep.getId(),
            ep.getInterfaceId(),
            InventoryReconciliationCalculator.endpointKey(ep),
            ep.getName(),
            ep.getOperationVerb(),
            ep.getPathOrAddress(),
            ep.getProtocol(),
            soapAction,
            requestRootElement);
    }

    /** Coverage percentage with the empty-denominator-returns-100 rule. */
    private static Double pct(int numerator, int denominator) {
        if (denominator == 0) {
            return 100.0;
        }
        return numerator * 100.0 / denominator;
    }

    private ApiBehaviourCaptureSessionEntity findOrThrow(UUID projectId, UUID sessionId) {
        ApiBehaviourCaptureSessionEntity entity = sessionRepository.findById(sessionId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "API behaviour capture session not found: " + sessionId));
        if (!projectId.equals(entity.getProjectId())) {
            throw new ResourceNotFoundException(
                "API behaviour capture session " + sessionId
                    + " not found in project " + projectId);
        }
        return entity;
    }
}
