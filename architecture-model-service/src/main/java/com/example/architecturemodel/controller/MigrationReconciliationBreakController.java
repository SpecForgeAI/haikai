package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.MigrationReconciliationBreakDto;
import com.example.architecturemodel.service.MigrationReconciliationBreakService;
import com.fasterxml.jackson.annotation.JsonProperty;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * REST controller exposing the Migration Reconciliation break &lt;-&gt; bug
 * lifecycle + disposition endpoints the gateway loop (Groups 2/3/4) calls.
 *
 * <p>A break == a drifting {@code api_behaviour_diff_item}: the target response
 * diverged from the pinned current-state oracle for the same request. These
 * endpoints are the run-scoped store the gateway loop reads and mutates after
 * the final-spec deploy.</p>
 *
 * <p>Endpoints (all under {@code /api/projects/{projectId}}):</p>
 * <ul>
 *   <li>{@code POST .../migration-execution-runs/{runId}/reconciliation-breaks}
 *       -- bulk-create breaks for a run from a completed reconcile result
 *       (records the pinned-baseline oracle anchor + the
 *       {@code source_baseline_item_id} scope keys). Returns the persisted
 *       breaks.</li>
 *   <li>{@code GET .../migration-execution-runs/{runId}/reconciliation-breaks}
 *       -- read a run's breaks (oldest-first) for the review surface.</li>
 *   <li>{@code GET .../reconciliation-breaks/by-bug-id/{bugId}} -- resolve the
 *       breaks behind a bug-fix callback (Group 4).</li>
 *   <li>{@code GET .../reconciliation-breaks?source_baseline_item_id=...} --
 *       resolve break(s) for a replayable source operation (the CD-6 scope key).</li>
 *   <li>{@code PATCH .../reconciliation-breaks/{breakId}} -- update a break's
 *       disposition / flags. Null-guarded.</li>
 *   <li>{@code PATCH .../reconciliation-breaks/{breakId}/attempt} -- increment
 *       the circuit-breaker attempt counter.</li>
 *   <li>{@code PATCH .../reconciliation-breaks/{breakId}/circuit-breaker} -- trip
 *       the circuit breaker / escalate to human review.</li>
 *   <li>{@code POST .../reconciliation-breaks/mark-sent} -- stamp the
 *       {@code bug_id} on a batch + move them to {@code sent_as_bug}.</li>
 * </ul>
 *
 * <p>Auth gating: identical to the sibling migration controllers -- relies on
 * the upstream auth filter chain. snake_case wire (the global AMS default).</p>
 *
 * <p>Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) --
 * Task Group 1.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class MigrationReconciliationBreakController {

    private final MigrationReconciliationBreakService service;

    /**
     * Bulk-create request: the batch of breaks produced by a completed reconcile
     * result. The {@code runId} comes from the URL path and binds every break.
     */
    public record CreateBreaksRequest(
        @JsonProperty("breaks")
        List<MigrationReconciliationBreakDto> breaks
    ) {}

    /**
     * Mark-sent request: the bug-report correlation id assigned by the send plus
     * the user-selected break ids it covered (CD-5: one report per batch).
     */
    public record MarkSentRequest(
        @JsonProperty("bug_id")
        String bugId,
        @JsonProperty("break_ids")
        List<UUID> breakIds
    ) {}

    /**
     * Circuit-breaker request: trip the breaker / escalate a break to human
     * review with an optional detail.
     */
    public record CircuitBreakerRequest(
        @JsonProperty("circuit_broken")
        Boolean circuitBroken,
        @JsonProperty("needs_human")
        Boolean needsHuman,
        @JsonProperty("error_detail")
        String errorDetail
    ) {}

    @PostMapping("/api/projects/{projectId}/migration-execution-runs/{runId}/reconciliation-breaks")
    public ResponseEntity<?> createBreaks(
            @PathVariable UUID projectId,
            @PathVariable UUID runId,
            @RequestBody CreateBreaksRequest request) {
        try {
            List<MigrationReconciliationBreakDto> created =
                service.createBreaks(runId, request == null ? null : request.breaks());
            return ResponseEntity.status(HttpStatus.CREATED).body(created);
        } catch (IllegalArgumentException e) {
            log.warn("[diag-ams] migration_reconciliation_break create_bad_request runId={} reason={}",
                runId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/api/projects/{projectId}/migration-execution-runs/{runId}/reconciliation-breaks")
    public ResponseEntity<?> getBreaksForRun(
            @PathVariable UUID projectId,
            @PathVariable UUID runId) {
        return ResponseEntity.ok(service.getBreaksForRun(runId));
    }

    @GetMapping("/api/projects/{projectId}/reconciliation-breaks/by-bug-id/{bugId}")
    public ResponseEntity<?> getBreaksByBugId(
            @PathVariable UUID projectId,
            @PathVariable String bugId) {
        return ResponseEntity.ok(service.findBreaksByBugId(bugId));
    }

    /**
     * GET .../reconciliation-breaks?source_baseline_item_id=...
     *
     * <p>Resolve the break(s) for a replayable source operation -- the CD-6
     * scoped-re-reconcile resolution key. The gateway uses this to map a scoped
     * re-reconcile result back onto its break rows.</p>
     */
    @GetMapping("/api/projects/{projectId}/reconciliation-breaks")
    public ResponseEntity<?> getBreaksBySourceBaselineItemId(
            @PathVariable UUID projectId,
            @RequestParam("source_baseline_item_id") UUID sourceBaselineItemId) {
        return ResponseEntity.ok(service.findBreaksBySourceBaselineItemId(sourceBaselineItemId));
    }

    @PatchMapping("/api/projects/{projectId}/reconciliation-breaks/{breakId}")
    public ResponseEntity<?> updateBreak(
            @PathVariable UUID projectId,
            @PathVariable UUID breakId,
            @RequestBody MigrationReconciliationBreakDto dto) {
        try {
            return ResponseEntity.ok(service.updateBreak(breakId, dto));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PatchMapping("/api/projects/{projectId}/reconciliation-breaks/{breakId}/attempt")
    public ResponseEntity<?> incrementAttempt(
            @PathVariable UUID projectId,
            @PathVariable UUID breakId) {
        try {
            return ResponseEntity.ok(service.incrementAttempt(breakId));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PatchMapping("/api/projects/{projectId}/reconciliation-breaks/{breakId}/circuit-breaker")
    public ResponseEntity<?> setCircuitBroken(
            @PathVariable UUID projectId,
            @PathVariable UUID breakId,
            @RequestBody CircuitBreakerRequest request) {
        try {
            boolean circuitBroken = request != null && Boolean.TRUE.equals(request.circuitBroken());
            boolean needsHuman = request != null && Boolean.TRUE.equals(request.needsHuman());
            String errorDetail = request == null ? null : request.errorDetail();
            return ResponseEntity.ok(
                service.setCircuitBroken(breakId, circuitBroken, needsHuman, errorDetail));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PostMapping("/api/projects/{projectId}/reconciliation-breaks/mark-sent")
    public ResponseEntity<?> markSent(
            @PathVariable UUID projectId,
            @RequestBody MarkSentRequest request) {
        try {
            List<MigrationReconciliationBreakDto> updated = service.markSent(
                request == null ? null : request.bugId(),
                request == null ? null : request.breakIds());
            return ResponseEntity.ok(updated);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
