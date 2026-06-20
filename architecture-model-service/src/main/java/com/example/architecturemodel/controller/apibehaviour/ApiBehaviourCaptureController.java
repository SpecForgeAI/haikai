package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourCaptureRequest;
import com.example.architecturemodel.model.dto.apibehaviour.BatchUpdateApiBehaviourCapturesRequest;
import com.example.architecturemodel.model.dto.apibehaviour.BatchUpdateApiBehaviourCapturesResponse;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourCaptureRequest;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourCaptureService;
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
 * REST controller for {@code api_behaviour_captures}.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/api-behaviour/captures")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourCaptureController {

    private final ApiBehaviourCaptureService service;

    /**
     * List captures for a session OR for a single scenario. Caller MUST
     * supply exactly one of {@code sessionId} or {@code scenarioId}.
     */
    @GetMapping
    public ResponseEntity<List<ApiBehaviourCaptureDto>> list(
            @PathVariable UUID projectId,
            @RequestParam(required = false) UUID sessionId,
            @RequestParam(required = false) UUID scenarioId) {
        if (sessionId == null && scenarioId == null) {
            throw new IllegalArgumentException("Either sessionId or scenarioId is required");
        }
        if (sessionId != null && scenarioId != null) {
            throw new IllegalArgumentException(
                "Provide exactly one of sessionId or scenarioId, not both");
        }
        if (sessionId != null) {
            return ResponseEntity.ok(service.listBySession(sessionId));
        }
        return ResponseEntity.ok(service.listByScenario(scenarioId));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiBehaviourCaptureDto> get(
            @PathVariable UUID projectId,
            @PathVariable UUID id) {
        return ResponseEntity.ok(service.get(id));
    }

    @PostMapping
    public ResponseEntity<ApiBehaviourCaptureDto> create(
            @PathVariable UUID projectId,
            @RequestBody CreateApiBehaviourCaptureRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(request));
    }

    /**
     * Best-effort, NON-atomic batch PATCH. Applies each {@code {id, patch}}
     * via the existing per-row field-merge and returns the survivors in
     * {@code updated} + one {@code failed[]} entry per failing item
     * (id + reason). Per-call cap is
     * {@code ApiBehaviourCaptureService.MAX_BATCH_ITEMS} (400 if exceeded).
     * Registered BEFORE {@code /{id}} so the literal {@code batch} segment is
     * not captured as a capture id.
     *
     * <p>Spec: Baseline Save &amp; Review (2026-06-20) -- Task Group 1 (R1).</p>
     */
    @PatchMapping("/batch")
    public ResponseEntity<BatchUpdateApiBehaviourCapturesResponse> updateBatch(
            @PathVariable UUID projectId,
            @RequestBody BatchUpdateApiBehaviourCapturesRequest request) {
        return ResponseEntity.ok(service.updateBatch(
            projectId, request == null ? null : request.items()));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<ApiBehaviourCaptureDto> update(
            @PathVariable UUID projectId,
            @PathVariable UUID id,
            @RequestBody UpdateApiBehaviourCaptureRequest request) {
        return ResponseEntity.ok(service.update(id, request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID projectId,
            @PathVariable UUID id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
