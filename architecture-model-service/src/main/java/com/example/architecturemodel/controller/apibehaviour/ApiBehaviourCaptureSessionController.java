package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureSessionDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourCaptureSessionRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourCaptureSessionRequest;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourCaptureSessionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * REST controller for {@code api_behaviour_capture_sessions}.
 *
 * <p>Routes mirror the AMS-direct CRUD pattern from
 * {@link com.example.architecturemodel.controller.ArchitectureElementMappingController}.
 * Caller MUST supply both {@code projectId} (path variable) and
 * {@code architectureId} (query param on the list endpoint, body on the
 * create endpoint) — the gateway proxy enforces a 404 for any URL missing
 * the architecture binding (see {@code gateway/src/routes/discovery.ts}
 * pattern).</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/api-behaviour/capture-sessions")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourCaptureSessionController {

    private final ApiBehaviourCaptureSessionService service;

    @GetMapping
    public ResponseEntity<List<ApiBehaviourCaptureSessionDto>> list(
            @PathVariable UUID projectId,
            @RequestParam UUID architectureId) {
        log.debug("GET /api/projects/{}/api-behaviour/capture-sessions arch={}",
            projectId, architectureId);
        return ResponseEntity.ok(service.listByProjectAndArchitecture(projectId, architectureId));
    }

    @GetMapping("/{sessionId}")
    public ResponseEntity<ApiBehaviourCaptureSessionDto> get(
            @PathVariable UUID projectId,
            @PathVariable UUID sessionId) {
        return ResponseEntity.ok(service.get(projectId, sessionId));
    }

    @PostMapping
    public ResponseEntity<ApiBehaviourCaptureSessionDto> create(
            @PathVariable UUID projectId,
            @RequestBody CreateApiBehaviourCaptureSessionRequest request) {
        log.info("POST /api/projects/{}/api-behaviour/capture-sessions", projectId);
        ApiBehaviourCaptureSessionDto created = service.create(projectId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PatchMapping("/{sessionId}")
    public ResponseEntity<ApiBehaviourCaptureSessionDto> update(
            @PathVariable UUID projectId,
            @PathVariable UUID sessionId,
            @RequestBody UpdateApiBehaviourCaptureSessionRequest request) {
        log.info("PATCH /api/projects/{}/api-behaviour/capture-sessions/{}",
            projectId, sessionId);
        return ResponseEntity.ok(service.update(projectId, sessionId, request));
    }

    @DeleteMapping("/{sessionId}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID projectId,
            @PathVariable UUID sessionId) {
        service.delete(projectId, sessionId);
        return ResponseEntity.noContent().build();
    }
}
