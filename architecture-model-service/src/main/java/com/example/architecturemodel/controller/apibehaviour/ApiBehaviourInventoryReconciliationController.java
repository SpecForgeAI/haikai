package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.InventoryReconciliationRequest;
import com.example.architecturemodel.model.dto.apibehaviour.InventoryReconciliationResponse;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourInventoryReconciliationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * REST controller for capture-session inventory reconciliation -- the
 * committed architecture-model endpoint set as enumerator-of-record.
 *
 * <p>POST because reconciliation is a parameterised computation with
 * side-effects (optional scope persistence + session-linked reconciliation
 * finding refresh). Routes follow the
 * {@link ApiBehaviourCaptureSessionController} conventions (project-scoped
 * path; 404 for cross-project session ids via the service lookup).</p>
 *
 * <p>Snake_case wire on both request and response via the AMS global Jackson
 * strategy -- NO {@code @CamelCaseWire}; consumers are the validation
 * service's snake_case-typed {@code archModelClient} (configure-time
 * {@code reconcile-inventory} action + the fail-closed {@code /start} gate)
 * and the frontend.</p>
 *
 * <p>Spec: Model-Seeded Capture Inventory (2026-06-11) -- Task Group 1.</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/api-behaviour/capture-sessions/{sessionId}/inventory-reconciliation")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourInventoryReconciliationController {

    private final ApiBehaviourInventoryReconciliationService service;

    @PostMapping
    public ResponseEntity<InventoryReconciliationResponse> reconcile(
            @PathVariable UUID projectId,
            @PathVariable UUID sessionId,
            @RequestBody(required = false) InventoryReconciliationRequest request) {
        log.info("POST /api/projects/{}/api-behaviour/capture-sessions/{}/inventory-reconciliation "
                + "scopeProvided={} persistScope={} refreshFindings={}",
            projectId, sessionId,
            request != null && request.scopeInterfaceIds() != null,
            request == null ? null : request.persistScope(),
            request == null ? null : request.refreshFindings());
        return ResponseEntity.ok(service.reconcile(projectId, sessionId, request));
    }
}
