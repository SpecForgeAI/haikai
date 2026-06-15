package com.example.architecturemodel.controller.discovery;

import com.example.architecturemodel.model.dto.discovery.BulkCreateDiscoveryFindingsRequest;
import com.example.architecturemodel.model.dto.discovery.BulkReviewDiscoveryFindingsRequest;
import com.example.architecturemodel.model.dto.discovery.BulkReviewDiscoveryFindingsResponse;
import com.example.architecturemodel.model.dto.discovery.CreateDiscoveryFindingRequest;
import com.example.architecturemodel.model.dto.discovery.CreateDiscoveryFindingRequest.CreateDiscoveryFindingLinkRequest;
import com.example.architecturemodel.model.dto.discovery.DiscoveryFindingDto;
import com.example.architecturemodel.model.dto.discovery.DiscoveryFindingLinkDto;
import com.example.architecturemodel.model.dto.discovery.DiscoveryFindingSearchResponse;
import com.example.architecturemodel.model.dto.discovery.ReviewDiscoveryFindingRequest;
import com.example.architecturemodel.model.dto.discovery.UpdateDiscoveryFindingRequest;
import com.example.architecturemodel.service.discovery.DiscoveryFindingService;
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
 * REST controller for {@code discovery_findings} + {@code discovery_finding_links}.
 *
 * <p>Path prefix mirrors the existing discovery surface:
 * {@code /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/findings}.
 * The {@code :architectureId} segment is mandatory -- a request without it
 * 404s at the Express/Spring layer (no fallback resolution).</p>
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 2; extended by Bulk Findings Actions
 * (2026-05-28) Task Group 1 with the
 * {@link #bulkReview(UUID, UUID, UUID, BulkReviewDiscoveryFindingsRequest)
 * bulk-review} endpoint; normalized by Normalize Findings Review Actions
 * (Spec F, 2026-06-02) -- {@code status} renamed to {@code review_status}
 * with the candidate-parity disposition vocabulary.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/findings")
@RequiredArgsConstructor
@Slf4j
public class DiscoveryFindingController {

    private final DiscoveryFindingService service;

    @GetMapping
    public ResponseEntity<DiscoveryFindingSearchResponse> list(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String findingType,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String source,
            @RequestParam(required = false) String createdByStage,
            @RequestParam(required = false) String linkedTargetType,
            @RequestParam(required = false) String linkedTargetId,
            @RequestParam(required = false) String text,
            @RequestParam(required = false, defaultValue = "0") int page,
            @RequestParam(required = false, defaultValue = "50") int size) {
        log.debug(
            "GET /findings runId={} filters[status={}, severity={}, category={}, type={}, linkedTargetType={}]",
            runId, status, severity, category, findingType, linkedTargetType);
        DiscoveryFindingSearchResponse response = service.list(
            projectId, architectureId, runId,
            category, findingType, severity, status,
            source, createdByStage,
            linkedTargetType, linkedTargetId,
            text, page, size);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/{findingId}")
    public ResponseEntity<DiscoveryFindingDto> get(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @PathVariable UUID findingId) {
        return ResponseEntity.ok(service.get(projectId, architectureId, runId, findingId));
    }

    @PostMapping
    public ResponseEntity<DiscoveryFindingDto> create(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestBody CreateDiscoveryFindingRequest request) {
        DiscoveryFindingDto created = service.create(projectId, architectureId, runId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PostMapping("/bulk")
    public ResponseEntity<List<DiscoveryFindingDto>> bulkCreate(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestBody BulkCreateDiscoveryFindingsRequest request) {
        List<DiscoveryFindingDto> created = service.bulkCreate(
            projectId, architectureId, runId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /**
     * Bulk-review entry point. Transitions many findings to a single
     * reviewer disposition atomically (one {@code @Transactional} on the
     * service method).
     *
     * <p>Body shape (snake_case via global Jackson naming strategy):</p>
     * <pre>
     * {
     *   "ids": ["uuid", ...],          // OR filter; mutually exclusive
     *   "filter": { ... },              // OR ids; nested record
     *   "review_status": "approved",    // required; reviewer-valid only
     *   "reviewer_notes": "..."        // optional; overwrite when supplied
     * }
     * </pre>
     *
     * <p>Validation:</p>
     * <ul>
     *   <li>{@code review_status} must be a reviewer-valid disposition
     *       ({@code approved}, {@code rejected}, {@code deferred});
     *       {@code pending_review} (and any other value) is rejected with
     *       400.</li>
     *   <li>{@code ids} and {@code filter} are mutually exclusive; both
     *       supplied returns 400 {@code mutually_exclusive_inputs}.</li>
     *   <li>Foreign ids in {@code ids} (different run / project /
     *       architecture) return 404.</li>
     * </ul>
     *
     * <p>Transitions are unrestricted (any-&gt;any) under Spec F: every
     * non-same-disposition row is actioned. Rows already in the requested
     * disposition are counted into {@code skipped_by_reason.already_in_target};
     * {@code skipped_by_reason.transition_not_allowed} is retained for
     * response-shape stability but is always {@code 0}.</p>
     *
     * <p>The run guard is invoked exactly once at the top of the service
     * method (mirrors every other run-scoped surface).</p>
     */
    @PostMapping("/bulk-review")
    public ResponseEntity<BulkReviewDiscoveryFindingsResponse> bulkReview(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestBody BulkReviewDiscoveryFindingsRequest request) {
        log.debug(
            "POST /findings/bulk-review runId={} reviewStatus={} ids={} filterPresent={}",
            runId,
            request == null ? null : request.reviewStatus(),
            request == null || request.ids() == null ? 0 : request.ids().size(),
            request != null && request.filter() != null);
        BulkReviewDiscoveryFindingsResponse response =
            service.bulkReview(projectId, architectureId, runId, request);
        return ResponseEntity.ok(response);
    }

    @PatchMapping("/{findingId}")
    public ResponseEntity<DiscoveryFindingDto> update(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @PathVariable UUID findingId,
            @RequestBody UpdateDiscoveryFindingRequest request) {
        return ResponseEntity.ok(
            service.update(projectId, architectureId, runId, findingId, request));
    }

    /**
     * Spec also documents this as {@code PUT .../findings/{findingId}}; for
     * frontend compatibility both verbs are routed to the same handler.
     */
    @org.springframework.web.bind.annotation.PutMapping("/{findingId}")
    public ResponseEntity<DiscoveryFindingDto> updateViaPut(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @PathVariable UUID findingId,
            @RequestBody UpdateDiscoveryFindingRequest request) {
        return update(projectId, architectureId, runId, findingId, request);
    }

    @PostMapping("/{findingId}/review")
    public ResponseEntity<DiscoveryFindingDto> review(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @PathVariable UUID findingId,
            @RequestBody ReviewDiscoveryFindingRequest request) {
        return ResponseEntity.ok(
            service.review(projectId, architectureId, runId, findingId, request));
    }

    @DeleteMapping("/{findingId}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @PathVariable UUID findingId) {
        service.delete(projectId, architectureId, runId, findingId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{findingId}/links")
    public ResponseEntity<List<DiscoveryFindingLinkDto>> listLinks(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @PathVariable UUID findingId) {
        return ResponseEntity.ok(
            service.listLinks(projectId, architectureId, runId, findingId));
    }

    @PostMapping("/{findingId}/links")
    public ResponseEntity<DiscoveryFindingLinkDto> addLink(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @PathVariable UUID findingId,
            @RequestBody CreateDiscoveryFindingLinkRequest request) {
        DiscoveryFindingLinkDto created = service.addLink(
            projectId, architectureId, runId, findingId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @DeleteMapping("/{findingId}/links/{linkId}")
    public ResponseEntity<Void> removeLink(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @PathVariable UUID findingId,
            @PathVariable UUID linkId) {
        service.removeLink(projectId, architectureId, runId, findingId, linkId);
        return ResponseEntity.noContent().build();
    }
}
