package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourOperationDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourOperationRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourOperationRequest;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourOperationService;
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
 * REST controller for {@code api_behaviour_operations}.
 *
 * <p>Operations are session-owned. The list endpoint requires a
 * {@code sessionId} query param.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/api-behaviour/operations")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourOperationController {

    private final ApiBehaviourOperationService service;

    @GetMapping
    public ResponseEntity<List<ApiBehaviourOperationDto>> list(
            @PathVariable UUID projectId,
            @RequestParam UUID sessionId) {
        return ResponseEntity.ok(service.listBySession(sessionId));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiBehaviourOperationDto> get(
            @PathVariable UUID projectId,
            @PathVariable UUID id) {
        return ResponseEntity.ok(service.get(id));
    }

    @PostMapping
    public ResponseEntity<ApiBehaviourOperationDto> create(
            @PathVariable UUID projectId,
            @RequestBody CreateApiBehaviourOperationRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(request));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<ApiBehaviourOperationDto> update(
            @PathVariable UUID projectId,
            @PathVariable UUID id,
            @RequestBody UpdateApiBehaviourOperationRequest request) {
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
