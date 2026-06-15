package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.DiscoveryCandidateDto;
import com.example.architecturemodel.model.dto.discovery.BulkReviewCascadeRequest;
import com.example.architecturemodel.model.dto.discovery.BulkReviewCascadeResponse;
import com.example.architecturemodel.model.dto.discovery.ResolveDiscoveryConflictRequest;
import com.example.architecturemodel.service.DiscoveryCandidateService;
import com.example.architecturemodel.service.discovery.DiscoveryCascadeReviewService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.UUID;

/**
 * REST Controller for Discovery Candidate endpoints.
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 *
 * Extended: Cascade-aware Bulk Review + Reject Suppression (Spec 2 --
 * 2026-06-02) Task Group 1 with the {@code POST .../candidates/bulk-review-cascade}
 * atomic endpoint spanning candidates + linked findings in one transaction.
 *
 * Extended: Conversational Discovery-Review "Architect" Persona (Spec 3 --
 * 2026-06-02) Task Group 1 with the {@code PATCH .../candidates/{candidateId}/resolve-conflict}
 * durable single-attribute conflict-resolution write.
 *
 * Base path: /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidates
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidates")
@RequiredArgsConstructor
@Slf4j
public class DiscoveryCandidateController {

    private final DiscoveryCandidateService discoveryCandidateService;
    private final DiscoveryCascadeReviewService discoveryCascadeReviewService;

    @PostMapping
    public ResponseEntity<?> bulkInsert(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestBody List<DiscoveryCandidateDto> candidates) {
        log.debug("POST /api/model/projects/{}/architectures/{}/discovery/runs/{}/candidates - {} candidates",
            projectId, architectureId, runId, candidates.size());

        try {
            List<DiscoveryCandidateDto> result = discoveryCandidateService.bulkCreateInArchitecture(
                runId, projectId, architectureId, candidates);
            return ResponseEntity.ok(result);
        } catch (NoSuchElementException e) {
            log.warn("Run not found in architecture for candidate insert: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad request bulk inserting candidates for run {}: {}", runId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping
    public ResponseEntity<?> listCandidates(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String status) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/runs/{}/candidates?type={}&status={}",
            projectId, architectureId, runId, type, status);

        try {
            List<DiscoveryCandidateDto> candidates = discoveryCandidateService.getByRunIdInArchitecture(
                runId, projectId, architectureId, type, status);
            return ResponseEntity.ok(candidates);
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for candidate list: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        }
    }

    @GetMapping("/count")
    public ResponseEntity<?> countCandidates(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/runs/{}/candidates/count",
            projectId, architectureId, runId);

        try {
            long count = discoveryCandidateService.countByRunIdInArchitecture(
                runId, projectId, architectureId);
            return ResponseEntity.ok(Map.of("count", count));
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for candidate count: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        }
    }

    @DeleteMapping
    public ResponseEntity<?> deleteCandidates(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId) {
        log.debug("DELETE /api/model/projects/{}/architectures/{}/discovery/runs/{}/candidates",
            projectId, architectureId, runId);

        try {
            long count = discoveryCandidateService.deleteByRunIdInArchitecture(
                runId, projectId, architectureId);
            return ResponseEntity.ok(Map.of("deleted", count));
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for candidate delete: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * ATOMIC cascade-aware bulk review across candidates AND their linked
     * findings (Spec 2 -- Cascade-aware Bulk Review + Reject Suppression,
     * 2026-06-02). Applies one reviewer disposition ({@code approved} /
     * {@code rejected} / {@code deferred}) to the curated id sets in a single
     * transaction; ANY single-entity failure rolls back the WHOLE batch.
     *
     * <p>Body shape (snake_case via global Jackson naming strategy):</p>
     * <pre>
     * {
     *   "candidate_ids": ["uuid", ...],   // explicit curated set (may be empty)
     *   "finding_ids":   ["uuid", ...],   // explicit curated set (may be empty)
     *   "review_status": "rejected",       // required; reviewer-valid only
     *   "reviewer_notes": "..."           // optional; written to actioned rows
     * }
     * </pre>
     *
     * <p>Mirrors the finding controller's {@code POST .../findings/bulk-review}:
     * debug-logs runId / reviewStatus / id-counts and lets the standard
     * exceptions map to the conventional statuses ({@code NoSuchElementException}
     * from the run guard and {@link ResourceNotFoundException} from an
     * out-of-scope id -&gt; 404; {@code IllegalArgumentException} -&gt; 400).
     * The candidate controller catches these explicitly (the
     * {@code NoSuchElementException} thrown by the run guard is not covered by
     * the global handler, matching the other endpoints in this controller).</p>
     */
    @PostMapping("/bulk-review-cascade")
    public ResponseEntity<?> bulkReviewCascade(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestBody BulkReviewCascadeRequest request) {
        log.debug(
            "POST /api/model/projects/{}/architectures/{}/discovery/runs/{}/candidates/bulk-review-cascade reviewStatus={} candidateIds={} findingIds={}",
            projectId, architectureId, runId,
            request == null ? null : request.reviewStatus(),
            request == null || request.candidateIds() == null ? 0 : request.candidateIds().size(),
            request == null || request.findingIds() == null ? 0 : request.findingIds().size());

        try {
            BulkReviewCascadeResponse response = discoveryCascadeReviewService.bulkReviewCascade(
                projectId, architectureId, runId, request);
            return ResponseEntity.ok(response);
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for cascade bulk review: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        } catch (ResourceNotFoundException e) {
            log.warn("Cascade bulk review id out of scope for run {}: {}", runId, e.getMessage());
            return ResponseEntity.status(404).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            log.warn("Bad request on cascade bulk review for run {}: {}", runId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/{candidateId}")
    public ResponseEntity<?> updateCandidate(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @PathVariable UUID candidateId,
            @RequestBody DiscoveryCandidateDto update) {
        log.debug("PUT /api/model/projects/{}/architectures/{}/discovery/runs/{}/candidates/{}",
            projectId, architectureId, runId, candidateId);

        try {
            DiscoveryCandidateDto result = discoveryCandidateService.updateCandidateInArchitecture(
                runId, projectId, architectureId, candidateId, update);
            return ResponseEntity.ok(result);
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for candidate update: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad request updating candidate {} for run {}: {}", candidateId, runId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PatchMapping("/{candidateId}/review")
    public ResponseEntity<?> reviewCandidate(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @PathVariable UUID candidateId,
            @RequestBody Map<String, String> body) {
        log.debug("PATCH /api/model/projects/{}/architectures/{}/discovery/runs/{}/candidates/{}/review",
            projectId, architectureId, runId, candidateId);

        String reviewStatus = body.get("review_status");
        String reviewedBy = body.get("reviewed_by");

        try {
            DiscoveryCandidateDto result = discoveryCandidateService.reviewCandidateInArchitecture(
                runId, projectId, architectureId, candidateId, reviewStatus, reviewedBy);
            return ResponseEntity.ok(result);
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for candidate review: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            String message = e.getMessage();
            if (message != null && message.contains("not found")) {
                log.warn("Candidate not found for review: {}", message);
                return ResponseEntity.status(404).body(Map.of("error", message));
            }
            log.warn("Bad request reviewing candidate {} for run {}: {}", candidateId, runId, message);
            return ResponseEntity.badRequest().body(Map.of("error", message));
        }
    }

    /**
     * DURABLE single-attribute conflict-resolution write (Spec 3 --
     * Conversational Discovery-Review "Architect" Persona, 2026-06-02). Mirrors
     * the focused {@code PATCH .../{candidateId}/review} above (single-concern)
     * rather than round-tripping the whole candidate via {@code PUT .../{candidateId}}.
     *
     * <p>Today single-conflict resolution is CLIENT-SIDE-ONLY (the grid mutates
     * candidate {@code data} in React state and persists only on save-back). This
     * endpoint drives a thin deterministic server-side write so a conversational
     * resolution is DURABLE IMMEDIATELY: it sets the canonical slot
     * {@code data[attr]}, stamps {@code data._conflictResolutions[attr]}, and clears
     * {@code data._conflicts[attr]} -- a JSONB passthrough on the existing
     * {@code data} column, NO schema / Liquibase change. The endpoint stays
     * single-attribute (resolve-by-pattern is driven by the gateway issuing one call
     * per similarity-class member).</p>
     *
     * <p>Body shape (snake_case via the global Jackson naming strategy):</p>
     * <pre>
     * {
     *   "attr":          "framework",   // required; the conflicting attribute
     *   "chosen_value":  "JAX-RS",      // the chosen value (-&gt; canonical data[attr])
     *   "chosen_source": "springClassicScanner", // the chosen value's source
     *   "resolved_by":   "reviewer",    // optional; defaults to "anonymous"
     *   "resolved_at":   "2026-06-02T10:15:30Z" // optional; server stamps now() if absent
     * }
     * </pre>
     *
     * <p><b>CRITICAL:</b> the request top-level fields are snake_case, but the keys
     * the service stamps INSIDE {@code data._conflictResolutions[attr]} are
     * <b>camelCase</b> ({@code chosenValue} / {@code chosenSource} / {@code resolvedBy}
     * / {@code resolvedAt}) to match Spec 0 + the frontend reader -- {@code data} is a
     * passthrough JSONB map Jackson never snake_cases.</p>
     *
     * <p>Returns the updated {@link DiscoveryCandidateDto} (consistent with
     * {@code reviewCandidate}). Maps a not-found candidate to 404 and other bad input
     * (e.g. a blank {@code attr} or a cross-run candidate) to 400, mirroring the
     * {@code /review} exception handling.</p>
     */
    @PatchMapping("/{candidateId}/resolve-conflict")
    public ResponseEntity<?> resolveConflict(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @PathVariable UUID candidateId,
            @RequestBody ResolveDiscoveryConflictRequest request) {
        log.debug("PATCH /api/model/projects/{}/architectures/{}/discovery/runs/{}/candidates/{}/resolve-conflict attr={}",
            projectId, architectureId, runId, candidateId,
            request == null ? null : request.attr());

        try {
            DiscoveryCandidateDto result = discoveryCandidateService.resolveConflictInArchitecture(
                runId, projectId, architectureId, candidateId,
                request == null ? null : request.attr(),
                request == null ? null : request.chosenValue(),
                request == null ? null : request.chosenSource(),
                request == null ? null : request.resolvedBy(),
                request == null ? null : request.resolvedAt());
            return ResponseEntity.ok(result);
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for conflict resolution: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            String message = e.getMessage();
            if (message != null && message.contains("not found")) {
                log.warn("Candidate not found for conflict resolution: {}", message);
                return ResponseEntity.status(404).body(Map.of("error", message));
            }
            log.warn("Bad request resolving conflict on candidate {} for run {}: {}", candidateId, runId, message);
            return ResponseEntity.badRequest().body(Map.of("error", message));
        }
    }
}
