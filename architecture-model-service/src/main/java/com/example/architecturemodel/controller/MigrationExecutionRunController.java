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

    /**
     * {@code projectId} is deliberately {@code String}, not {@code UUID}
     * (2026-07-29): the gateway's build-results advance correlates purely on
     * the globally-unique job id and passes the literal sentinel
     * {@code "by-job"} as the project segment (the real project id is
     * recovered from the run afterwards). A {@code UUID} declaration made
     * Spring 400 the sentinel before this handler -- which ignores the
     * segment entirely -- ever ran, halting every migration run at spec 0.
     */
    @GetMapping("/api/projects/{projectId}/migration-execution-runs/{runId}")
    public ResponseEntity<?> getRunState(
            @PathVariable String projectId,
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
     * GET /api/projects/{projectId}/migration-books-of-work/{bookId}/migration-execution-runs
     *
     * <p>ALL runs of a book WITH their ordered items, newest first
     * (2026-08-07): the gateway driver's plane-aware precedence reads the
     * book's full run history (which planes already deployed in earlier stage
     * runs). Always {@code 200} with a list (possibly empty).</p>
     */
    @GetMapping("/api/projects/{projectId}/migration-books-of-work/{bookId}/migration-execution-runs")
    public ResponseEntity<?> getRunsForBook(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId) {
        return ResponseEntity.ok(service.getRunsForBook(bookId));
    }

    /**
     * GET /api/migration-execution-runs/in-flight
     *
     * <p>CROSS-project in-flight run headers ({@code started} /
     * {@code dispatching}), newest first (2026-08-07): the gateway
     * boot-recovery sweep's discovery source — before this endpoint the
     * default discovery returned an empty set and boot recovery was inert, so
     * a gateway restart stranded any mid-segment run forever. Deliberately
     * NOT under {@code /api/projects/{projectId}}: recovery runs before the
     * gateway knows which projects have runs.</p>
     */
    @GetMapping("/api/migration-execution-runs/in-flight")
    public ResponseEntity<?> listInFlightRuns() {
        return ResponseEntity.ok(service.listInFlightRuns());
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
    /**
     * {@code projectId} is deliberately {@code String} -- the gateway passes
     * the {@code "by-job"} sentinel here (see {@link #getRunState}); the
     * lookup keys on the globally-unique {@code jobId} alone.
     */
    @GetMapping("/api/projects/{projectId}/migration-execution-run-items/by-job-id/{jobId}")
    public ResponseEntity<?> getRunItemByJobId(
            @PathVariable String projectId,
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
