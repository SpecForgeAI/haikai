package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.targetstate.ApplyMappingMutationsRequest;
import com.example.architecturemodel.model.dto.targetstate.ApplyMappingMutationsResponse;
import com.example.architecturemodel.service.ApplyMappingMutationsService;
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
 * REST controller for the apply-mapping-mutations endpoint.
 *
 * <p>Spec: Target State Architect-Persona Conversation
 * (2026-05-24-target-state-architect-conversation) -- Task Group 4.</p>
 *
 * <p>Endpoint:</p>
 * <ul>
 *   <li>{@code POST /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions/{decisionId}/apply-mapping-mutations}
 *       -- applies the deterministic mapping-mutation rule subset (forwarded
 *       by the gateway) for the named captured decision inside one
 *       {@code @Transactional} boundary per Q13. Decorates {@code notes} and
 *       (when the rule requests it) updates {@code mapping_type}; never touches
 *       {@code created_by_task} (per Q14).</li>
 * </ul>
 *
 * <p>Cross-project leak protection mirrors Spec 2's pattern -- the service
 * collapses cross-project / cross-architecture misses to
 * {@code ResourceNotFoundException} which the global exception handler maps
 * to HTTP 404 (not 403).</p>
 *
 * <p>The request / response DTOs returned here are marked {@code @CamelCaseWire}
 * because the captured-decisions data plane speaks camelCase.</p>
 */
@RestController
@RequestMapping(
    "/api/projects/{projectId}"
    + "/target-architectures/{targetArchitectureId}"
    + "/captured-decisions/{decisionId}/apply-mapping-mutations"
)
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class CapturedDecisionsApplyMappingMutationsController {

    private final ApplyMappingMutationsService service;

    /**
     * Applies the supplied mutation rule subset to the captured decision's
     * affected mappings. Returns 200 with a per-table-set summary the gateway
     * uses to render a {@code mapping-mutation-summary} conversation turn.
     */
    @PostMapping
    public ResponseEntity<ApplyMappingMutationsResponse> apply(
            @PathVariable UUID projectId,
            @PathVariable UUID targetArchitectureId,
            @PathVariable UUID decisionId,
            @RequestBody ApplyMappingMutationsRequest request) {
        log.info(
            "POST /api/projects/{}/target-architectures/{}/captured-decisions/{}"
            + "/apply-mapping-mutations (tableSets={}, change={}, elementRef={}/{})",
            projectId, targetArchitectureId, decisionId,
            request == null ? null : request.affectedTableSets(),
            request == null ? null : request.defaultMappingTypeChange(),
            request == null ? null : request.elementRefType(),
            request == null ? null : request.elementRefId());

        ApplyMappingMutationsResponse response =
            service.applyMutations(projectId, targetArchitectureId, decisionId, request);
        return ResponseEntity.ok(response);
    }
}
