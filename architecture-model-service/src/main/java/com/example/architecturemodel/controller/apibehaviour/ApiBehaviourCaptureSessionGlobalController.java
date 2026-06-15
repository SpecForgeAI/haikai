package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureSessionDto;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourCaptureSessionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Cross-project (global) read endpoint for api-behaviour capture sessions.
 *
 * <p>Unlike {@link ApiBehaviourCaptureSessionController} -- which is project- and
 * architecture-scoped for the user-facing, gateway-proxied flows -- this
 * controller exposes a single NON-scoped list-by-status query. It is deliberately
 * outside the project-scoping the user-facing routes enforce, because it is an
 * INTERNAL service-to-service endpoint:</p>
 *
 * <ul>
 *   <li>The {@code api-migration-validation-service} calls it at startup
 *       (orphan-session reconciliation: any session left {@code running} by a
 *       crashed process lost its in-memory secrets and must be marked
 *       {@code failed}); and</li>
 *   <li>at the start of every <b>target replay</b>, where the runner is handed
 *       only a {@code sessionId} and must resolve the session by id from the set
 *       of {@code running} sessions without knowing the owning project up front
 *       (see the validation service's {@code listAllCaptureSessionsByStatus}).</li>
 * </ul>
 *
 * <p>The underlying finder
 * ({@code ApiBehaviourCaptureSessionRepository.findByStatus}) already existed for
 * this purpose; this controller is the missing wiring that completes it.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) -- Task Group 4
 * (startup reconciliation).</p>
 */
@RestController
@RequestMapping("/api/api-behaviour/capture-sessions")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourCaptureSessionGlobalController {

    private final ApiBehaviourCaptureSessionService service;

    /**
     * List every capture session in {@code status}, across all projects.
     *
     * <p>{@code GET /api/api-behaviour/capture-sessions?status=running}</p>
     *
     * @param status one of the allowed lifecycle statuses (draft / configured /
     *               running / completed / failed / cancelled); an unknown value
     *               is rejected by the service with HTTP 400.
     */
    @GetMapping
    public ResponseEntity<List<ApiBehaviourCaptureSessionDto>> listByStatus(
            @RequestParam String status) {
        log.debug("GET /api/api-behaviour/capture-sessions?status={}", status);
        return ResponseEntity.ok(service.listByStatus(status));
    }
}
