package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.model.dto.discovery.CreateDiscoveryFindingRequest;
import com.example.architecturemodel.model.dto.discovery.DiscoveryFindingDto;
import com.example.architecturemodel.model.dto.discovery.ReviewDiscoveryFindingRequest;
import com.example.architecturemodel.model.dto.discovery.UpdateDiscoveryFindingRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffEntity;
import com.example.architecturemodel.service.ApiBehaviourDiffArchitectureGuard;
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
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Diff-scoped REST controller for {@code discovery_findings} sourced from
 * an {@code api_behaviour_diff}.
 *
 * <p>Separate from the run-scoped {@code DiscoveryFindingController}
 * because the existing class-level {@code @RequestMapping} bakes
 * {@code /runs/{runId}} into the path and every service method calls
 * {@code runGuard.verify(...)} as its first line. Creating, reading or
 * patching a diff-sourced finding via that surface is impossible without
 * a runId, so a parallel controller is the cleanest split (per accepted
 * Q4 / Q9 -- copy-modify acceptable for v1).</p>
 *
 * <p>Mounts at {@code /api/projects/{projectId}/api-behaviour/diffs/{diffId}/findings}
 * (mirrors the existing {@code ApiBehaviourDiffController} prefix, which
 * does not carry an architecture segment -- the diff itself uniquely
 * binds project + architecture via its FK columns).</p>
 *
 * <p>Endpoints:</p>
 * <ul>
 *   <li>{@code GET .../findings} -- all findings for the diff, ascending
 *       created_at. Used by the diff-scoped review surface and as a
 *       fallback list when the badge per-diff_item lookup is not
 *       available.</li>
 *   <li>{@code GET .../findings/by-diff-item/{diffItemId}} -- findings
 *       linked to a specific diff_item. Used by the per-row "Findings"
 *       badge on the Drift report tab.</li>
 *   <li>{@code POST .../findings} -- create a diff-sourced finding.
 *       <b>Internal-only path</b> consumed by the validation-service's
 *       {@code diffRunner.ts} emission step (per accepted Q9 -- emission
 *       goes from validation-service direct to AMS via the AMS internal
 *       surface; the gateway does NOT proxy this endpoint). The body
 *       reuses {@link CreateDiscoveryFindingRequest} (the same record
 *       used by the run-scoped POST); origin scoping comes from the
 *       URL's {@code projectId} + {@code diffId} (architectureId is
 *       resolved off the diff row by the guard).</li>
 *   <li>{@code DELETE .../findings} -- bulk delete of all findings
 *       sourced from this diff. <b>Load-bearing for recompute</b> per
 *       accepted Q6 -- the {@code api_behaviour_diff_id ON DELETE
 *       CASCADE} only fires when the diff row itself is deleted;
 *       recompute keeps the diff row alive while replacing diff_items,
 *       so the validation-service runner MUST call this BEFORE re-emit
 *       to avoid finding accumulation (2x after one recompute, 3x after
 *       two, ...). Also internal-only -- not proxied by the gateway.</li>
 *   <li>{@code PATCH .../findings/{findingId}} -- reviewer status
 *       transitions on a diff-sourced finding (same body shape as the
 *       existing run-scoped PATCH).</li>
 *   <li>{@code POST .../findings/{findingId}/review} -- convenience
 *       review endpoint (status + reviewer notes + reviewed_at stamp in
 *       one call); mirrors the run-scoped POST .../review.</li>
 * </ul>
 *
 * <p>The first line of every endpoint is
 * {@code apiBehaviourDiffArchitectureGuard.verify(diffId, projectId)}.
 * Missing or out-of-project diffs return 404.</p>
 *
 * <p>Spec: API Test Harness — Findings Integration (2026-05-25) -- Task
 * Group 1 added the read + review surface; Task Group 2 added the
 * internal {@code POST} and {@code DELETE} endpoints for
 * validation-service direct-to-AMS emission and recompute cleanup.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/api-behaviour/diffs/{diffId}/findings")
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourDiffFindingController {

    private final DiscoveryFindingService service;
    private final ApiBehaviourDiffArchitectureGuard diffGuard;

    /**
     * List all findings sourced from this diff, ordered ascending by
     * {@code created_at}.
     */
    @GetMapping
    public ResponseEntity<List<DiscoveryFindingDto>> listForDiff(
            @PathVariable UUID projectId,
            @PathVariable UUID diffId) {
        diffGuard.verify(diffId, projectId);
        log.debug("GET /diffs/{}/findings projectId={}", diffId, projectId);
        return ResponseEntity.ok(service.listForDiff(diffId));
    }

    /**
     * List findings linked to a specific {@code api_behaviour_diff_item}
     * (via {@code discovery_finding_links} where
     * {@code target_type='api_behaviour_diff_item'}). Used by the per-row
     * "Findings" badge on the Drift report tab.
     */
    @GetMapping("/by-diff-item/{diffItemId}")
    public ResponseEntity<List<DiscoveryFindingDto>> listByDiffItem(
            @PathVariable UUID projectId,
            @PathVariable UUID diffId,
            @PathVariable UUID diffItemId) {
        diffGuard.verify(diffId, projectId);
        log.debug("GET /diffs/{}/findings/by-diff-item/{} projectId={}",
            diffId, diffItemId, projectId);
        return ResponseEntity.ok(service.findingsByDiffItem(diffId, diffItemId));
    }

    /**
     * Create a diff-sourced finding.
     *
     * <p><b>Internal-only path.</b> Consumed by the validation-service's
     * {@code diffRunner.ts} emission step (per accepted Q9, emission
     * goes from validation-service direct to AMS; the gateway does NOT
     * proxy this endpoint). The architectureId is resolved off the diff
     * row via {@link ApiBehaviourDiffArchitectureGuard#verifyAndLoad} so
     * the caller does not have to pass it in the URL or the body --
     * keeps the contract tight against caller error.</p>
     *
     * <p>The {@link CreateDiscoveryFindingRequest#links()} member is
     * honoured -- the validation-service runner passes a single link
     * with {@code targetType='api_behaviour_diff_item'} +
     * {@code linkType='derived_from'} pointing at the originating
     * diff_item row, so a separate POST {@code /links} call is avoided.</p>
     */
    @PostMapping
    public ResponseEntity<DiscoveryFindingDto> createForDiff(
            @PathVariable UUID projectId,
            @PathVariable UUID diffId,
            @RequestBody CreateDiscoveryFindingRequest request) {
        ApiBehaviourDiffEntity diff = diffGuard.verifyAndLoad(diffId, projectId);
        log.debug("POST /diffs/{}/findings projectId={} architectureId={}",
            diffId, projectId, diff.getArchitectureId());
        DiscoveryFindingDto created = service.createForDiff(
            projectId, diff.getArchitectureId(), diffId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /**
     * Bulk-delete all findings sourced from this diff.
     *
     * <p><b>Load-bearing for diff recompute -- NOT defensive</b> per
     * accepted Q6. The {@code api_behaviour_diff_id ON DELETE CASCADE}
     * only fires on diff-row deletion; recompute keeps the diff row
     * alive while replacing diff_items, so {@code diffRunner.ts} MUST
     * call this endpoint BEFORE re-emit. Without it, findings would
     * accumulate across recomputes (2x after one recompute, 3x after
     * two, ...).</p>
     *
     * <p>Internal-only -- not proxied by the gateway.</p>
     */
    @DeleteMapping
    public ResponseEntity<Void> deleteAllForDiff(
            @PathVariable UUID projectId,
            @PathVariable UUID diffId) {
        diffGuard.verify(diffId, projectId);
        int removed = service.deleteFindingsByApiBehaviourDiffId(diffId);
        log.debug("DELETE /diffs/{}/findings projectId={} removed={}",
            diffId, projectId, removed);
        return ResponseEntity.noContent().build();
    }

    /**
     * Reviewer status transitions / edits on a diff-sourced finding.
     * Same body shape as the existing run-scoped PATCH.
     */
    @PatchMapping("/{findingId}")
    public ResponseEntity<DiscoveryFindingDto> patchFinding(
            @PathVariable UUID projectId,
            @PathVariable UUID diffId,
            @PathVariable UUID findingId,
            @RequestBody UpdateDiscoveryFindingRequest request) {
        diffGuard.verify(diffId, projectId);
        log.debug("PATCH /diffs/{}/findings/{} projectId={}", diffId, findingId, projectId);
        return ResponseEntity.ok(service.updateForDiff(diffId, findingId, request));
    }

    /**
     * Convenience review endpoint: sets status + reviewer notes +
     * reviewed_at stamp in one call. Mirrors the run-scoped POST .../review.
     */
    @PostMapping("/{findingId}/review")
    public ResponseEntity<DiscoveryFindingDto> reviewFinding(
            @PathVariable UUID projectId,
            @PathVariable UUID diffId,
            @PathVariable UUID findingId,
            @RequestBody ReviewDiscoveryFindingRequest request) {
        // Load the diff once so future use can confirm architecture for
        // diagnostic logging; the guard's pure verify(...) is sufficient
        // for security.
        ApiBehaviourDiffEntity diff = diffGuard.verifyAndLoad(diffId, projectId);
        log.debug("POST /diffs/{}/findings/{}/review projectId={} architectureId={}",
            diffId, findingId, projectId, diff.getArchitectureId());
        return ResponseEntity.ok(service.reviewForDiff(diffId, findingId, request));
    }
}
