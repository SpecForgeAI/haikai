package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourComparisonWaiverDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourComparisonWaiverRequest;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourComparisonWaiverService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Comparison-waiver CRUD (Spec 2026-07-06-j — Parity Exactness &amp;
 * First-Class SOAP). Consumed by the validation service's reconcile
 * comparator: the effective set (project rows + global seeds) REPLACES the
 * fixed in-code header allowlist, making every tolerated difference visible,
 * reasoned, and deletable.
 */
@RestController
@RequestMapping("/api/projects/{projectId}/api-behaviour/comparison-waivers")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourComparisonWaiverController {

    private final ApiBehaviourComparisonWaiverService service;

    /** The project's EFFECTIVE waiver set (its rows + the global seeds). */
    @GetMapping
    public ResponseEntity<List<ApiBehaviourComparisonWaiverDto>> list(
            @PathVariable UUID projectId) {
        return ResponseEntity.ok(service.listEffective(projectId));
    }

    @PostMapping
    public ResponseEntity<ApiBehaviourComparisonWaiverDto> create(
            @PathVariable UUID projectId,
            @RequestBody CreateApiBehaviourComparisonWaiverRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(service.create(projectId, request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID projectId,
            @PathVariable UUID id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
