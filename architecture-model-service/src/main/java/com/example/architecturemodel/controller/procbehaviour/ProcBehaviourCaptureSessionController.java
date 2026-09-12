package com.example.architecturemodel.controller.procbehaviour;

import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.CreateProcCaptureSessionRequest;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.InsertProcCapturesRequest;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.InsertProcDiagnosticsRequest;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.PatchProcCaptureSessionRequest;
import com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests.UpsertProcScenariosRequest;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourCaptureEntity;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourCaptureSessionEntity;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourDiagnosticEntity;
import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourScenarioEntity;
import com.example.architecturemodel.service.procbehaviour.ProcBehaviourService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Proc behaviour capture sessions, scenarios, captures and diagnostics --
 * Stored Proc &amp; Function Behaviour Program, Spec 3 (changeset 230).
 *
 * <pre>
 *   POST   .../proc-behaviour/capture-sessions                    -> 201 session
 *   GET    .../proc-behaviour/capture-sessions                    -> [session] newest first
 *   GET    .../proc-behaviour/capture-sessions/{id}               -> session | 404
 *   PATCH  .../proc-behaviour/capture-sessions/{id}               -> session | 409 {error}
 *   POST   .../proc-behaviour/capture-sessions/{id}/scenarios     -> [scenario] upserted
 *   GET    .../proc-behaviour/capture-sessions/{id}/scenarios[?routine_id=]
 *   POST   .../proc-behaviour/capture-sessions/{id}/captures      -> [capture] inserted
 *   GET    .../proc-behaviour/capture-sessions/{id}/captures[?scenario_id=]
 *   POST   .../proc-behaviour/capture-sessions/{id}/diagnostics   -> [diagnostic] inserted
 *   GET    .../proc-behaviour/capture-sessions/{id}/diagnostics
 * </pre>
 *
 * <p>Entities are returned VERBATIM -- the AMS snake_case default renders
 * {@code scopeRoutineIdsJson} as {@code scope_routine_ids_json}. An illegal
 * status transition surfaces as 409 with {@code {error}}, not as a CHECK
 * constraint 500.</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/proc-behaviour")
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ProcBehaviourCaptureSessionController {

    private final ProcBehaviourService service;

    // ------------------------------------------------------------------
    // Sessions
    // ------------------------------------------------------------------

    @PostMapping("/capture-sessions")
    public ResponseEntity<ProcBehaviourCaptureSessionEntity> createSession(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody CreateProcCaptureSessionRequest request) {
        ProcBehaviourCaptureSessionEntity created =
            service.createSession(projectId, architectureId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @GetMapping("/capture-sessions")
    public List<ProcBehaviourCaptureSessionEntity> listSessions(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        return service.listSessions(architectureId);
    }

    @GetMapping("/capture-sessions/{sessionId}")
    public ResponseEntity<ProcBehaviourCaptureSessionEntity> getSession(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID sessionId) {
        return service.getSession(architectureId, sessionId)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * DELETE a capture session (2026-09-12). 204 when deleted, 404 when it is
     * not in this architecture, 409 (via the controller-local handler) when
     * it is still running. Saved baselines survive (detached, not deleted).
     */
    @DeleteMapping("/capture-sessions/{sessionId}")
    public ResponseEntity<Void> deleteSession(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID sessionId) {
        return service.deleteSession(architectureId, sessionId)
            ? ResponseEntity.noContent().build()
            : ResponseEntity.notFound().build();
    }

    @PatchMapping("/capture-sessions/{sessionId}")
    public ResponseEntity<ProcBehaviourCaptureSessionEntity> patchSession(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID sessionId,
            @RequestBody PatchProcCaptureSessionRequest request) {
        if (service.getSession(architectureId, sessionId).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(service.patchSession(architectureId, sessionId, request));
    }

    // ------------------------------------------------------------------
    // Scenarios
    // ------------------------------------------------------------------

    @PostMapping("/capture-sessions/{sessionId}/scenarios")
    public ResponseEntity<List<ProcBehaviourScenarioEntity>> upsertScenarios(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID sessionId,
            @RequestBody UpsertProcScenariosRequest request) {
        if (service.getSession(architectureId, sessionId).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(service.upsertScenarios(sessionId, request));
    }

    @GetMapping("/capture-sessions/{sessionId}/scenarios")
    public List<ProcBehaviourScenarioEntity> listScenarios(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID sessionId,
            @RequestParam(name = "routine_id", required = false) UUID routineId) {
        return service.listScenarios(sessionId, routineId);
    }

    // ------------------------------------------------------------------
    // Captures
    // ------------------------------------------------------------------

    @PostMapping("/capture-sessions/{sessionId}/captures")
    public ResponseEntity<List<ProcBehaviourCaptureEntity>> insertCaptures(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID sessionId,
            @RequestBody InsertProcCapturesRequest request) {
        if (service.getSession(architectureId, sessionId).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(service.insertCaptures(sessionId, request));
    }

    @GetMapping("/capture-sessions/{sessionId}/captures")
    public List<ProcBehaviourCaptureEntity> listCaptures(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID sessionId,
            @RequestParam(name = "scenario_id", required = false) UUID scenarioId) {
        return service.listCaptures(sessionId, scenarioId);
    }

    // ------------------------------------------------------------------
    // Diagnostics
    // ------------------------------------------------------------------

    @PostMapping("/capture-sessions/{sessionId}/diagnostics")
    public ResponseEntity<List<ProcBehaviourDiagnosticEntity>> insertDiagnostics(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID sessionId,
            @RequestBody InsertProcDiagnosticsRequest request) {
        if (service.getSession(architectureId, sessionId).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(service.insertDiagnostics(sessionId, request));
    }

    @GetMapping("/capture-sessions/{sessionId}/diagnostics")
    public List<ProcBehaviourDiagnosticEntity> listDiagnostics(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID sessionId) {
        return service.listDiagnostics(sessionId);
    }

    /**
     * An illegal state-machine transition is a CONFLICT, not a server error.
     * Controller-local, so the global handler's mappings stay untouched.
     */
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalTransition(IllegalStateException ex) {
        log.warn("[diag-ams] op=proc_behaviour_conflict message={}", ex.getMessage());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", ex.getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
    }
}
