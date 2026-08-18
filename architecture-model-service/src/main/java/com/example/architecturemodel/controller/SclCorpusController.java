package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.SclContractBulkUpsertRequest;
import com.example.architecturemodel.model.dto.SclContractDto;
import com.example.architecturemodel.model.dto.SclReachabilityBulkRequest;
import com.example.architecturemodel.model.dto.SclReachabilityItemDto;
import com.example.architecturemodel.model.dto.SclScanDto;
import com.example.architecturemodel.service.SclCorpusService;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * REST Controller for the SCL corpus persistence endpoints (Structural
 * Contract Language, 2026-08-18).
 *
 * The miner streams contract batches / reachability worklists against a scan;
 * readers pull light contract listings (bodies stripped) and full per-contract
 * bodies. Every JSON payload (body / gloss / roots / stats / signals) is
 * OPAQUE -- persisted and served verbatim, never parsed here.
 *
 * Error mapping matches {@link MigrationExecutionRunController}:
 * {@link ResourceNotFoundException} -> 404,
 * {@link IllegalArgumentException} -> 400 with
 * {@code {"error": message}}.
 *
 * Base path: /api/model/projects/{projectId}/architectures/{architectureId}/scl
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/scl")
@RequiredArgsConstructor
@Slf4j
public class SclCorpusController {

    private final SclCorpusService sclCorpusService;

    // ------------------------------------------------------------------
    // Scans
    // ------------------------------------------------------------------

    /**
     * POST .../scl/scans -- create a new scan (status {@code in_progress}).
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @return 201 Created with the fresh scan
     */
    @PostMapping("/scans")
    public ResponseEntity<SclScanDto> createScan(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        log.debug("POST /api/model/projects/{}/architectures/{}/scl/scans",
            projectId, architectureId);
        SclScanDto created = sclCorpusService.createScan(projectId, architectureId);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /**
     * GET .../scl/scans -- the (project, architecture) scan history, newest first.
     */
    @GetMapping("/scans")
    public ResponseEntity<List<SclScanDto>> listScans(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/scl/scans",
            projectId, architectureId);
        return ResponseEntity.ok(sclCorpusService.listScans(projectId, architectureId));
    }

    /**
     * GET .../scl/scans/latest -- the most recent scan, or 404 when the pair
     * has never been mined.
     */
    @GetMapping("/scans/latest")
    public ResponseEntity<SclScanDto> getLatestScan(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/scl/scans/latest",
            projectId, architectureId);
        return sclCorpusService.getLatestScan(projectId, architectureId)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * GET .../scl/scans/{scanId} -- one scan by id (2026-08-18: the gateway
     * annotation pass and the Structural Model tab read a scan by explicit id).
     */
    @GetMapping("/scans/{scanId}")
    public ResponseEntity<SclScanDto> getScan(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID scanId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/scl/scans/{}",
            projectId, architectureId, scanId);
        return sclCorpusService.getScan(scanId)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * PATCH .../scl/scans/{scanId} -- null-guarded scan PATCH
     * ({@code status} validated against the vocabulary; {@code stats_json}
     * opaque). 404 for an unknown scan, 400 for a bad status.
     */
    @PatchMapping("/scans/{scanId}")
    public ResponseEntity<?> updateScan(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID scanId,
            @RequestBody UpdateSclScanRequest request) {
        log.debug("PATCH /api/model/projects/{}/architectures/{}/scl/scans/{}",
            projectId, architectureId, scanId);
        try {
            SclScanDto updated = sclCorpusService.updateScan(
                scanId,
                request != null ? request.status() : null,
                request != null ? request.statsJson() : null);
            return ResponseEntity.ok(updated);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad request updating SCL scan {}: {}", scanId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    // ------------------------------------------------------------------
    // Contracts
    // ------------------------------------------------------------------

    /**
     * POST .../scl/scans/{scanId}/contracts/bulk -- bulk-upsert a contract
     * batch keyed on (scan_id, contract_key). Returns {@code {"upserted": n}}.
     * 404 for an unknown scan, 400 for blank keys / null bodies.
     */
    @PostMapping("/scans/{scanId}/contracts/bulk")
    public ResponseEntity<?> bulkUpsertContracts(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID scanId,
            @RequestBody SclContractBulkUpsertRequest request) {
        log.debug("POST /api/model/projects/{}/architectures/{}/scl/scans/{}/contracts/bulk -- entries: {}",
            projectId, architectureId, scanId,
            request == null || request.contracts() == null ? 0 : request.contracts().size());
        try {
            int upserted = sclCorpusService.bulkUpsertContracts(
                scanId, request != null ? request.contracts() : null);
            return ResponseEntity.ok(Map.of("upserted", upserted));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad request bulk-upserting SCL contracts for scan {}: {}",
                scanId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * GET .../scl/scans/{scanId}/contracts?kind=&amp;min_fan_in=&amp;q=&amp;include_body=
     * -- filtered contract listing. Bodies (and glosses) are stripped unless
     * {@code include_body=true} to keep list payloads light.
     */
    @GetMapping("/scans/{scanId}/contracts")
    public ResponseEntity<List<SclContractDto>> listContracts(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID scanId,
            @RequestParam(name = "kind", required = false) String kind,
            @RequestParam(name = "min_fan_in", required = false) Integer minFanIn,
            @RequestParam(name = "q", required = false) String q,
            @RequestParam(name = "include_body", required = false, defaultValue = "false")
            boolean includeBody) {
        log.debug("GET /api/model/projects/{}/architectures/{}/scl/scans/{}/contracts"
            + "?kind={}&min_fan_in={}&q={}&include_body={}",
            projectId, architectureId, scanId, kind, minFanIn, q, includeBody);
        return ResponseEntity.ok(
            sclCorpusService.listContracts(scanId, kind, minFanIn, q, includeBody));
    }

    /**
     * GET .../scl/scans/{scanId}/contracts/{contractKey} -- one contract with
     * its FULL opaque body. Contract keys are simple path-safe tokens
     * (e.g. {@code T-abc123}). 404 for an unknown pair.
     */
    @GetMapping("/scans/{scanId}/contracts/{contractKey}")
    public ResponseEntity<SclContractDto> getContract(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID scanId,
            @PathVariable String contractKey) {
        log.debug("GET /api/model/projects/{}/architectures/{}/scl/scans/{}/contracts/{}",
            projectId, architectureId, scanId, contractKey);
        try {
            return ResponseEntity.ok(sclCorpusService.getContract(scanId, contractKey));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * PATCH .../scl/scans/{scanId}/contracts/{contractKey}/gloss -- gloss-only
     * update for the LLM annotation pass. 404 for an unknown pair.
     */
    @PatchMapping("/scans/{scanId}/contracts/{contractKey}/gloss")
    public ResponseEntity<SclContractDto> patchContractGloss(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID scanId,
            @PathVariable String contractKey,
            @RequestBody PatchSclGlossRequest request) {
        log.debug("PATCH /api/model/projects/{}/architectures/{}/scl/scans/{}/contracts/{}/gloss",
            projectId, architectureId, scanId, contractKey);
        try {
            return ResponseEntity.ok(sclCorpusService.patchContractGloss(
                scanId, contractKey, request != null ? request.glossJson() : null));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ------------------------------------------------------------------
    // Reachability worklist
    // ------------------------------------------------------------------

    /**
     * PUT .../scl/scans/{scanId}/reachability -- replace the scan's worklist
     * wholesale. Returns {@code {"replaced": n}}. 404 for an unknown scan.
     */
    @PutMapping("/scans/{scanId}/reachability")
    public ResponseEntity<?> replaceReachability(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID scanId,
            @RequestBody SclReachabilityBulkRequest request) {
        log.debug("PUT /api/model/projects/{}/architectures/{}/scl/scans/{}/reachability -- items: {}",
            projectId, architectureId, scanId,
            request == null || request.items() == null ? 0 : request.items().size());
        try {
            int replaced = sclCorpusService.replaceReachability(
                scanId, request != null ? request.items() : null);
            return ResponseEntity.ok(Map.of("replaced", replaced));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * GET .../scl/scans/{scanId}/reachability -- the scan's worklist ordered
     * by source path.
     */
    @GetMapping("/scans/{scanId}/reachability")
    public ResponseEntity<List<SclReachabilityItemDto>> listReachability(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID scanId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/scl/scans/{}/reachability",
            projectId, architectureId, scanId);
        return ResponseEntity.ok(sclCorpusService.listReachability(scanId));
    }

    /**
     * PATCH .../scl/reachability/{itemId} -- set the triage verdict
     * ({@code dead_code} | {@code missed_entrypoint} | {@code framework_invoked},
     * or null to reopen). 404 for an unknown item, 400 for an unknown verdict.
     */
    @PatchMapping("/reachability/{itemId}")
    public ResponseEntity<?> patchReachabilityDisposition(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID itemId,
            @RequestBody PatchSclDispositionRequest request) {
        log.debug("PATCH /api/model/projects/{}/architectures/{}/scl/reachability/{}",
            projectId, architectureId, itemId);
        try {
            return ResponseEntity.ok(sclCorpusService.patchReachabilityDisposition(
                itemId, request != null ? request.disposition() : null));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad request patching SCL reachability item {}: {}", itemId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    // ------------------------------------------------------------------
    // Request bodies
    // ------------------------------------------------------------------

    /**
     * PATCH body for a scan: both fields optional (null = leave unchanged).
     *
     * @param status the new status (in_progress | completed | failed), or null
     * @param statsJson the new opaque stats payload, or null
     */
    public record UpdateSclScanRequest(
        @JsonProperty("status")
        String status,

        @JsonProperty("stats_json")
        Map<String, Object> statsJson
    ) {}

    /**
     * PATCH body for a contract gloss.
     *
     * @param glossJson the new opaque gloss payload (null clears the gloss)
     */
    public record PatchSclGlossRequest(
        @JsonProperty("gloss_json")
        Map<String, Object> glossJson
    ) {}

    /**
     * PATCH body for a reachability triage verdict.
     *
     * @param disposition dead_code | missed_entrypoint | framework_invoked,
     *                    or null to reopen the item
     */
    public record PatchSclDispositionRequest(
        @JsonProperty("disposition")
        String disposition
    ) {}
}
