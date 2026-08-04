package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.DbGapProposalDto;
import com.example.architecturemodel.model.dto.UpdateDbGapProposalRequest;
import com.example.architecturemodel.model.dto.UpsertDbGapProposalsRequest;
import com.example.architecturemodel.service.DbGapProposalService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * REST Controller for the per-project DB gap-proposal queue rows (Spec 4
 * surface alongside {@link DbStructuralFindingDispositionController} --
 * scoped to the PROJECT, not a pack, so proposals and their review state
 * survive pack regeneration).
 *
 * <p><b>Endpoints (all scoped under
 * {@code /api/projects/{projectId}/db-gap-proposals}):</b></p>
 * <ul>
 *   <li>{@code GET    /} -- all proposal rows for the project, oldest first;
 *       optional {@code ?finding_key=} narrows to one structural
 *       finding.</li>
 *   <li>{@code PUT    /} -- bulk upsert by stable {@code proposal_key}
 *       ({@code fk--<relationship_id>} / {@code pk--<table>}). New keys
 *       create unreviewed rows; existing rows are refreshed ONLY while still
 *       unreviewed (reviewed rows are human state -- left verbatim, still
 *       returned).</li>
 *   <li>{@code PATCH  /{proposalId}} -- sparse review update
 *       ({@code review_status} stamps {@code reviewed_at}; {@code applied_at}
 *       records the model write-back).</li>
 *   <li>{@code DELETE /{proposalId}} -- remove (204 / 404).</li>
 * </ul>
 *
 * <p>Error conventions match {@link DbStructuralFindingDispositionController}:
 * unknown row -&gt; 404; invalid body (bad kind/origin/confidence/
 * review_status enum, blank/duplicate proposal_key, missing payload_json)
 * -&gt; 400 with {@code {"error": ...}}.</p>
 *
 * <p>Spec: LLM gap-proposal queue (2026-08-04) -- Spec 4.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/db-gap-proposals")
@RequiredArgsConstructor
@Slf4j
public class DbGapProposalController {

    private final DbGapProposalService service;

    /**
     * GET /api/projects/{projectId}/db-gap-proposals[?finding_key=...]
     */
    @GetMapping
    public ResponseEntity<?> listProposals(
            @PathVariable UUID projectId,
            @RequestParam(name = "finding_key", required = false) String findingKey) {
        log.debug("GET /api/projects/{}/db-gap-proposals finding_key={}",
            projectId, findingKey);
        List<DbGapProposalDto> proposals = service.listByProject(projectId, findingKey);
        return ResponseEntity.ok(proposals);
    }

    /**
     * PUT /api/projects/{projectId}/db-gap-proposals
     *
     * <p>Bulk upsert by stable {@code proposal_key}. Returns 200 with the
     * post-upsert rows for the whole batch (reviewed rows verbatim).</p>
     */
    @PutMapping
    public ResponseEntity<?> upsertProposals(
            @PathVariable UUID projectId,
            @RequestBody UpsertDbGapProposalsRequest request) {
        log.debug("PUT /api/projects/{}/db-gap-proposals batch={}",
            projectId,
            request != null && request.proposals() != null
                ? request.proposals().size() : 0);
        try {
            return ResponseEntity.ok(service.bulkUpsert(projectId, request));
        } catch (IllegalArgumentException e) {
            log.warn("Bad gap-proposal bulk upsert for project {}: {}",
                projectId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * PATCH /api/projects/{projectId}/db-gap-proposals/{proposalId}
     *
     * <p>Sparse review update: 200 with the updated row, 404 when absent,
     * 400 for a bad enum / unparseable applied_at.</p>
     */
    @PatchMapping("/{proposalId}")
    public ResponseEntity<?> patchProposal(
            @PathVariable UUID projectId,
            @PathVariable UUID proposalId,
            @RequestBody UpdateDbGapProposalRequest request) {
        log.debug("PATCH /api/projects/{}/db-gap-proposals/{}", projectId, proposalId);
        try {
            return ResponseEntity.ok(service.patch(projectId, proposalId, request));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad gap-proposal patch for project {} proposal {}: {}",
                projectId, proposalId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * DELETE /api/projects/{projectId}/db-gap-proposals/{proposalId}
     *
     * <p>Remove a proposal: 204 when removed, 404 when absent.</p>
     */
    @DeleteMapping("/{proposalId}")
    public ResponseEntity<?> deleteProposal(
            @PathVariable UUID projectId,
            @PathVariable UUID proposalId) {
        log.debug("DELETE /api/projects/{}/db-gap-proposals/{}", projectId, proposalId);
        try {
            service.delete(projectId, proposalId);
            return ResponseEntity.noContent().build();
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }
}
