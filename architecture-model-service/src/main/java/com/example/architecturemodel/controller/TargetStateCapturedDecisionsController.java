package com.example.architecturemodel.controller;

import com.example.architecturemodel.mapper.TargetStateCapturedDecisionMapper;
import com.example.architecturemodel.model.dto.targetstate.CreateTargetStateCapturedDecisionRequest;
import com.example.architecturemodel.model.dto.targetstate.TargetStateCapturedDecisionDto;
import com.example.architecturemodel.model.entity.TargetStateCapturedDecisionEntity;
import com.example.architecturemodel.service.TargetStateCapturedDecisionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * REST controller for the {@code target_state_captured_decisions} surface.
 *
 * <p>Spec: Target State Captured Decisions -- Data Plane
 * (2026-05-24-target-state-captured-decisions-data-plane) -- Task Group 3.</p>
 *
 * <p>Endpoints (insert-only data plane; NO PATCH / PUT / DELETE per Q3 and
 * spec.md):</p>
 * <ul>
 *   <li>{@code POST   /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions}
 *       -- create a new captured-decision row, atomically superseding any
 *       prior matching-tuple row inside the same transaction.</li>
 *   <li>{@code GET    /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions}
 *       -- default returns only non-superseded "latest" rows;
 *       {@code ?includeSuperseded=true} returns the full audit list including
 *       superseded rows.</li>
 *   <li>{@code GET    /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions/{decisionId}}
 *       -- single row; HTTP 404 (NOT 403) on cross-project / cross-architecture
 *       access per the service-layer guard (Q15).</li>
 *   <li>{@code GET    /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions/by-code/{decisionCode}}
 *       -- latest non-superseded rows for one decision code across every
 *       scope (architecture-wide + service / interface / element overrides).</li>
 * </ul>
 *
 * <p>The DTOs returned here are marked {@code @CamelCaseWire} because the
 * captured-decisions data plane speaks camelCase.</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class TargetStateCapturedDecisionsController {

    private final TargetStateCapturedDecisionService service;
    private final TargetStateCapturedDecisionMapper mapper;

    /**
     * Creates a new captured-decision row. Atomic supersession of any prior
     * matching-tuple row is handled in the service inside a single
     * {@code @Transactional} boundary.
     */
    @PostMapping
    public ResponseEntity<TargetStateCapturedDecisionDto> create(
            @PathVariable UUID projectId,
            @PathVariable UUID targetArchitectureId,
            @RequestBody CreateTargetStateCapturedDecisionRequest request) {
        log.info(
            "POST /api/projects/{}/target-architectures/{}/captured-decisions "
            + "(decisionCode={}, scopeKind={}, scopeRefId={})",
            projectId, targetArchitectureId,
            request == null ? null : request.decisionCode(),
            request == null ? null : request.scopeKind(),
            request == null ? null : request.scopeRefId());

        TargetStateCapturedDecisionEntity created =
            service.createDecision(projectId, targetArchitectureId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(mapper.toDto(created));
    }

    /**
     * Lists captured decisions for the given target architecture.
     *
     * <p>Default behaviour: only non-superseded "latest" rows (what
     * downstream prompts consume). Pass {@code ?includeSuperseded=true} to
     * receive the full audit list.</p>
     */
    @GetMapping
    public ResponseEntity<List<TargetStateCapturedDecisionDto>> list(
            @PathVariable UUID projectId,
            @PathVariable UUID targetArchitectureId,
            @RequestParam(name = "includeSuperseded", required = false, defaultValue = "false")
                boolean includeSuperseded) {
        log.debug(
            "GET /api/projects/{}/target-architectures/{}/captured-decisions"
            + "?includeSuperseded={}",
            projectId, targetArchitectureId, includeSuperseded);

        List<TargetStateCapturedDecisionEntity> rows = includeSuperseded
            ? service.listAllDecisions(projectId, targetArchitectureId)
            : service.listLatestDecisions(projectId, targetArchitectureId);

        return ResponseEntity.ok(rows.stream().map(mapper::toDto).toList());
    }

    /**
     * Returns a single captured-decision row by id. Returns HTTP 404 on
     * cross-project / cross-architecture access (NOT 403, per Q15) -- the
     * service-layer guard collapses "row exists in another project" to "row
     * does not exist" so we never leak existence to an attacker who guesses
     * sibling UUIDs.
     */
    @GetMapping("/{decisionId}")
    public ResponseEntity<TargetStateCapturedDecisionDto> findById(
            @PathVariable UUID projectId,
            @PathVariable UUID targetArchitectureId,
            @PathVariable UUID decisionId) {
        log.debug(
            "GET /api/projects/{}/target-architectures/{}/captured-decisions/{}",
            projectId, targetArchitectureId, decisionId);

        TargetStateCapturedDecisionEntity row =
            service.getByIdOrThrow(projectId, targetArchitectureId, decisionId);
        return ResponseEntity.ok(mapper.toDto(row));
    }

    /**
     * Returns the latest non-superseded rows for one decision code across
     * every scope (architecture-wide + service / interface / element
     * overrides). Drives the gateway resolver's per-code drill-down.
     */
    @GetMapping("/by-code/{decisionCode}")
    public ResponseEntity<List<TargetStateCapturedDecisionDto>> findByCode(
            @PathVariable UUID projectId,
            @PathVariable UUID targetArchitectureId,
            @PathVariable String decisionCode) {
        log.debug(
            "GET /api/projects/{}/target-architectures/{}/captured-decisions/by-code/{}",
            projectId, targetArchitectureId, decisionCode);

        List<TargetStateCapturedDecisionEntity> rows =
            service.findByDecisionCode(projectId, targetArchitectureId, decisionCode);
        return ResponseEntity.ok(rows.stream().map(mapper::toDto).toList());
    }
}
