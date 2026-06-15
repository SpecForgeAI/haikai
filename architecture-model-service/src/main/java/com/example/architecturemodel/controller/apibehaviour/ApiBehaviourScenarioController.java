package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourScenarioDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourScenarioRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourScenarioRequest;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourScenarioService;
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
 * REST controller for {@code api_behaviour_scenarios}.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/api-behaviour/scenarios")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourScenarioController {

    private final ApiBehaviourScenarioService service;

    /**
     * List scenarios for a session OR for a single operation. Caller MUST
     * supply exactly one of {@code sessionId} or {@code operationId}.
     */
    @GetMapping
    public ResponseEntity<List<ApiBehaviourScenarioDto>> list(
            @PathVariable UUID projectId,
            @RequestParam(required = false) UUID sessionId,
            @RequestParam(required = false) UUID operationId) {
        if (sessionId == null && operationId == null) {
            throw new IllegalArgumentException("Either sessionId or operationId is required");
        }
        if (sessionId != null && operationId != null) {
            throw new IllegalArgumentException(
                "Provide exactly one of sessionId or operationId, not both");
        }
        if (sessionId != null) {
            return ResponseEntity.ok(service.listBySession(sessionId));
        }
        return ResponseEntity.ok(service.listByOperation(operationId));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiBehaviourScenarioDto> get(
            @PathVariable UUID projectId,
            @PathVariable UUID id) {
        return ResponseEntity.ok(service.get(id));
    }

    @PostMapping
    public ResponseEntity<ApiBehaviourScenarioDto> create(
            @PathVariable UUID projectId,
            @RequestBody CreateApiBehaviourScenarioRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(request));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<ApiBehaviourScenarioDto> update(
            @PathVariable UUID projectId,
            @PathVariable UUID id,
            @RequestBody UpdateApiBehaviourScenarioRequest request) {
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
