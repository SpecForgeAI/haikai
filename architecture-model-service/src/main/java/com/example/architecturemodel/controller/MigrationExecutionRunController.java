package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.MigrationExecutionRunDto;
import com.example.architecturemodel.model.dto.MigrationExecutionRunItemDto;
import com.example.architecturemodel.service.MigrationExecutionRunService;
import com.example.architecturemodel.service.MigrationExecutionRunService.CreateRunRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * REST controller exposing the Migration Execution run-state endpoints the
 * gateway-hosted Migration Execution Driver (Groups 2/3/4) calls.
 *
 * <p>Endpoints:</p>
 * <ul>
 *   <li>{@code POST /api/projects/{projectId}/migration-execution-runs}
 *       -- create a run + its ordered run-items (records the pinned baseline id
 *       + the {@code deploy_on_complete} markers). Returns the persisted run
 *       with items.</li>
 *   <li>{@code GET /api/projects/{projectId}/migration-execution-runs/{runId}}
 *       -- read run-state (run + items) for the run-progress view.</li>
 *   <li>{@code GET /api/projects/{projectId}/migration-books-of-work/{bookId}/migration-execution-run}
 *       -- the latest run + items for a book of work (the dashboard's
 *       run-progress lookup); {@code 404} if no run yet.</li>
 *   <li>{@code GET /api/projects/{projectId}/migration-execution-run-items/by-job-id/{jobId}}
 *       -- the build-results callback correlation lookup (Group 3); {@code 404}
 *       if no run-item carries that {@code job_id}.</li>
 *   <li>{@code PATCH /api/projects/{projectId}/migration-execution-run-items/{runItemId}}
 *       -- update a run-item (dispatched / job_id / outcome / branch / pr_url /
 *       decision-log append). Null-guarded.</li>
 *   <li>{@code PATCH /api/projects/{projectId}/migration-execution-runs/{runId}}
 *       -- update the run (status / current position / target_base_url /
 *       decision-log). Null-guarded.</li>
 * </ul>
 *
 * <p>Auth gating: identical to the sibling migration controllers -- relies on
 * the upstream auth filter chain. snake_case wire (the global AMS default).</p>
 *
 * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class MigrationExecutionRunController {

    private final MigrationExecutionRunService service;

    @PostMapping("/api/projects/{projectId}/migration-execution-runs")
    public ResponseEntity<?> createRun(
            @PathVariable UUID projectId,
            @RequestBody CreateRunRequest request) {
        try {
            MigrationExecutionRunDto created = service.createRun(projectId, request);
            return ResponseEntity.status(HttpStatus.CREATED).body(created);
        } catch (IllegalArgumentException e) {
            log.warn("[diag-ams] migration_execution_run create_bad_request projectId={} reason={}",
                projectId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/api/projects/{projectId}/migration-execution-runs/{runId}")
    public ResponseEntity<?> getRunState(
            @PathVariable UUID projectId,
            @PathVariable UUID runId) {
        try {
            return ResponseEntity.ok(service.getRunState(runId));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @GetMapping("/api/projects/{projectId}/migration-books-of-work/{bookId}/migration-execution-run")
    public ResponseEntity<?> getLatestRunForBook(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId) {
        Optional<MigrationExecutionRunDto> latest = service.getLatestRunForBook(bookId);
        return latest.<ResponseEntity<?>>map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * GET /api/projects/{projectId}/migration-execution-run-items/by-job-id/{jobId}
     *
     * <p>The build-results callback correlation lookup (Group 3): the gateway
     * build-results door receives a {@code job_id} and resolves the owning
     * run-item to advance. {@code 404} when no run-item carries that
     * {@code job_id} (the door maps that to its own {@code 404} -- "unknown
     * job_id for this workspace"). Exposes the existing
     * {@link MigrationExecutionRunService#findRunItemByJobId(String)} so the
     * gateway never has to reach into AMS storage directly.</p>
     */
    @GetMapping("/api/projects/{projectId}/migration-execution-run-items/by-job-id/{jobId}")
    public ResponseEntity<?> getRunItemByJobId(
            @PathVariable UUID projectId,
            @PathVariable String jobId) {
        Optional<MigrationExecutionRunItemDto> item = service.findRunItemByJobId(jobId);
        return item.<ResponseEntity<?>>map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PatchMapping("/api/projects/{projectId}/migration-execution-run-items/{runItemId}")
    public ResponseEntity<?> updateRunItem(
            @PathVariable UUID projectId,
            @PathVariable UUID runItemId,
            @RequestBody MigrationExecutionRunItemDto dto) {
        try {
            return ResponseEntity.ok(service.updateRunItem(runItemId, dto));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PatchMapping("/api/projects/{projectId}/migration-execution-runs/{runId}")
    public ResponseEntity<?> updateRun(
            @PathVariable UUID projectId,
            @PathVariable UUID runId,
            @RequestBody MigrationExecutionRunDto dto) {
        try {
            return ResponseEntity.ok(service.updateRun(runId, dto));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
