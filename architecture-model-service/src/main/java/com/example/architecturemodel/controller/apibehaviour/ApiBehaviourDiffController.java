package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourDiffDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourDiffRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourDiffRequest;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourDiffService;
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
 * REST controller for {@code api_behaviour_diffs}.
 *
 * <p>Standard CRUD plus the UI-lookup endpoint
 * {@code GET /by-target/{targetBaselineId}} -- the most-common path from the
 * Drift report tab on {@code BaselineDetailView}. Returns 404 when no diff
 * has been computed for the given target (the UI shows "Computing..." in
 * that case).</p>
 *
 * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 2</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/api-behaviour/diffs")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourDiffController {

    private final ApiBehaviourDiffService service;

    @PostMapping
    public ResponseEntity<ApiBehaviourDiffDto> create(
            @PathVariable UUID projectId,
            @RequestBody CreateApiBehaviourDiffRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(service.create(projectId, request));
    }

    @GetMapping("/{diffId}")
    public ResponseEntity<ApiBehaviourDiffDto> get(
            @PathVariable UUID projectId,
            @PathVariable UUID diffId) {
        return ResponseEntity.ok(service.get(projectId, diffId));
    }

    /**
     * UI-primary endpoint -- the Drift report tab on
     * {@code BaselineDetailView} reads the diff for the currently-viewed
     * target baseline. Returns 404 when no diff has been computed yet
     * (the UI shows "Computing..." in that case).
     */
    @GetMapping("/by-target/{targetBaselineId}")
    public ResponseEntity<ApiBehaviourDiffDto> getByTargetBaseline(
            @PathVariable UUID projectId,
            @PathVariable UUID targetBaselineId) {
        return ResponseEntity.ok(
            service.getByTargetBaselineId(projectId, targetBaselineId));
    }

    /**
     * Source-side lookup. Supports the v2 reverse-lookup surface; v1 UI
     * navigation is target-driven (one-way per accepted Q9).
     */
    @GetMapping
    public ResponseEntity<List<ApiBehaviourDiffDto>> listBySource(
            @PathVariable UUID projectId,
            @RequestParam UUID sourceBaselineId) {
        return ResponseEntity.ok(
            service.listBySourceBaselineId(projectId, sourceBaselineId));
    }

    @PatchMapping("/{diffId}")
    public ResponseEntity<ApiBehaviourDiffDto> update(
            @PathVariable UUID projectId,
            @PathVariable UUID diffId,
            @RequestBody UpdateApiBehaviourDiffRequest request) {
        return ResponseEntity.ok(service.update(projectId, diffId, request));
    }

    @DeleteMapping("/{diffId}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID projectId,
            @PathVariable UUID diffId) {
        service.delete(projectId, diffId);
        return ResponseEntity.noContent().build();
    }
}
