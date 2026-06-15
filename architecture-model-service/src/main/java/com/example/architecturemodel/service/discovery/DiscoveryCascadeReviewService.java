package com.example.architecturemodel.service.discovery;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.discovery.BulkReviewCascadeRequest;
import com.example.architecturemodel.model.dto.discovery.BulkReviewCascadeResponse;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingRepository;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import com.example.architecturemodel.service.DiscoveryRunArchitectureGuard;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.UUID;

/**
 * ATOMIC, cascade-aware bulk review service spanning discovery candidates AND
 * discovery findings in ONE {@code @Transactional} boundary.
 *
 * <p>This is the write half of Spec 2 (Cascade-aware Bulk Review + Reject
 * Suppression, 2026-06-02). It applies a single reviewer disposition
 * ({@code approved} / {@code rejected} / {@code deferred}) across an explicit,
 * client-curated set of candidate ids + finding ids. Either arm failing (e.g.
 * a cross-architecture id that does not load in scope) rolls back the WHOLE batch -- no
 * candidate AND no finding is left mutated. This all-or-nothing guarantee is
 * the oracle-grade story the user chose over the best-effort per-row fan-out
 * (Resolved Decision 4).</p>
 *
 * <h2>Why a dedicated service</h2>
 * The candidate repository ({@code DiscoveryCandidateRepository}) and the
 * finding repository ({@code DiscoveryFindingRepository}) live in different
 * packages and are owned by two existing services
 * ({@code DiscoveryCandidateService} and {@code DiscoveryFindingService}).
 * Spanning both arms inside ONE transaction is cleanest in a small service that
 * injects BOTH repositories directly -- the single {@code @Transactional}
 * method below is the one boundary both arms share.
 *
 * <h2>Semantics (mirrors the two existing single-kind paths)</h2>
 * <ul>
 *   <li><b>Candidate arm</b> stays consistent with
 *       {@code DiscoveryCandidateService.reviewCandidate}:
 *       {@code VALID_REVIEW_STATUSES = {approved, rejected, deferred}},
 *       unrestricted any-&gt;any transitions, capturing
 *       {@code previous_review_status} + {@code reviewed_at} +
 *       {@code reviewed_by} per actioned row. <b>{@code committed} gating:</b>
 *       a candidate whose {@code status == 'committed'} (the row is already
 *       persisted into the architecture model) is SKIPPED -- counted into the
 *       candidate block's {@code transition_not_allowed}, NOT transitioned and
 *       NOT failed. ({@code status} -- {@code proposed}/{@code committed} -- is
 *       a DISTINCT field from {@code review_status}.)</li>
 *   <li><b>Finding arm</b> reuses the
 *       {@code DiscoveryFindingService.applyStatusChange} semantics: capture
 *       {@code previous_review_status} + stamp {@code reviewed_at} on every
 *       actioned row. Findings have NO committed gate.</li>
 *   <li>Same-disposition rows (current == requested) on EITHER kind are counted
 *       {@code alreadyInTarget} and not rewritten.</li>
 *   <li>Per-kind {@code delta_by_from_status} accumulators are captured
 *       PRE-mutation; each repository gets a single {@code saveAll} + one
 *       {@code flush} (mirrors the finding bulk pattern; NOT per-row
 *       {@code saveAndFlush}).</li>
 *   <li>{@code reviewerNotes} (when supplied non-blank after trim) is written
 *       to every ACTIONED row of both kinds; omitted/blank preserves existing
 *       notes.</li>
 * </ul>
 *
 * <h2>Scope verification (architecture-scoped)</h2>
 * The run guard verifies the path {@code (run, project, architecture)} tuple
 * ONCE at the top. Then EVERY supplied id is scope-verified against the
 * ARCHITECTURE, not a single run: the Review Room unions MULTIPLE discovery
 * runs (a code scan + a database scan, cross-scan links, and identity-merged
 * candidates whose originals live in a sibling run), so a cascaded candidate /
 * finding legitimately belongs to a DIFFERENT run than the path run -- but
 * ALWAYS within the SAME architecture. A candidate id must load AND its parent
 * run must be bound to the path {@code (project, architecture)} (verified via
 * the run guard -- candidates carry no architecture column); a finding id must
 * load AND match the path {@code (project, architecture)}. An id that does not
 * load, or whose run / row belongs to another architecture/project, throws
 * {@link ResourceNotFoundException} (the controller maps it to 404) BEFORE any
 * save -- under the single transaction the whole batch rolls back, so a
 * cross-architecture id injection cannot mutate foreign rows.
 *
 * <p>Spec: Cascade-aware Bulk Review + Reject Suppression (Spec 2,
 * 2026-06-02) -- Task Group 1.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiscoveryCascadeReviewService {

    /**
     * Reviewer-valid dispositions (candidate-parity vocabulary). Mirrors
     * {@code DiscoveryCandidateService.VALID_REVIEW_STATUSES} and
     * {@code DiscoveryFindingService.ALLOWED_REVIEWER_STATUSES}.
     */
    static final Set<String> VALID_REVIEW_STATUSES = Set.of(
        "approved", "rejected", "deferred");

    /** Candidate {@code status} value that gates re-disposition (skip, not fail). */
    static final String COMMITTED_STATUS = "committed";

    private final DiscoveryCandidateRepository candidateRepository;
    private final DiscoveryFindingRepository findingRepository;
    private final DiscoveryRunArchitectureGuard runGuard;

    /**
     * Apply one reviewer disposition across the curated candidate + finding set
     * atomically. See the class Javadoc for the full contract.
     *
     * @param projectId      path-scoped project UUID
     * @param architectureId path-scoped architecture UUID
     * @param runId          path-scoped discovery run UUID
     * @param request        the curated id sets + disposition (+ optional notes)
     * @return per-kind sub-counts (candidate block + finding block)
     * @throws IllegalArgumentException  null body / blank or invalid disposition
     * @throws ResourceNotFoundException any supplied id missing or out of scope
     *         (whole batch rolls back)
     */
    @Transactional
    public BulkReviewCascadeResponse bulkReviewCascade(
            UUID projectId, UUID architectureId, UUID runId,
            BulkReviewCascadeRequest request) {
        runGuard.verify(runId, projectId, architectureId);
        if (request == null) {
            throw new IllegalArgumentException("Bulk cascade review request body is required");
        }
        String requestedStatus = request.reviewStatus();
        if (requestedStatus == null || requestedStatus.isBlank()) {
            throw new IllegalArgumentException("review_status is required");
        }
        if (!VALID_REVIEW_STATUSES.contains(requestedStatus)) {
            throw new IllegalArgumentException(
                "review_status '" + requestedStatus + "' is not a valid reviewer status; "
                    + "allowed: " + VALID_REVIEW_STATUSES);
        }

        String trimmedNotes = null;
        if (request.reviewerNotes() != null) {
            String t = request.reviewerNotes().trim();
            if (!t.isEmpty()) {
                trimmedNotes = t;
            }
        }

        // Resolve + scope-verify BOTH id sets up-front. Any out-of-scope id
        // throws ResourceNotFoundException before any mutation, so the whole
        // transaction rolls back atomically.
        List<DiscoveryCandidateEntity> candidates =
            resolveCandidates(request.candidateIds(), projectId, architectureId);
        List<DiscoveryFindingEntity> findings =
            resolveFindings(request.findingIds(), projectId, architectureId);

        BulkReviewCascadeResponse.KindResult candidateResult =
            applyCandidateArm(candidates, requestedStatus, trimmedNotes);
        BulkReviewCascadeResponse.KindResult findingResult =
            applyFindingArm(findings, requestedStatus, trimmedNotes);

        log.debug(
            "bulkReviewCascade runId={} reviewStatus={} candidates[updated={} skipped={}] findings[updated={} skipped={}]",
            runId, requestedStatus,
            candidateResult.updatedCount(), candidateResult.skippedCount(),
            findingResult.updatedCount(), findingResult.skippedCount());

        return new BulkReviewCascadeResponse(candidateResult, findingResult);
    }

    // ------------------------------------------------------------------
    // Candidate arm
    // ------------------------------------------------------------------

    private BulkReviewCascadeResponse.KindResult applyCandidateArm(
            List<DiscoveryCandidateEntity> candidates,
            String requestedStatus, String trimmedNotes) {
        int alreadyInTarget = 0;
        int committedSkipped = 0;
        Map<String, Integer> deltaByFromStatus = new LinkedHashMap<>();
        List<DiscoveryCandidateEntity> toSave = new ArrayList<>(candidates.size());
        Instant now = Instant.now();

        for (DiscoveryCandidateEntity entity : candidates) {
            // committed gating: candidate `status` (proposed/committed) is a
            // DISTINCT field from review_status. A committed row is already
            // persisted into the architecture model -- skip (count), do not
            // transition, do not fail.
            if (COMMITTED_STATUS.equalsIgnoreCase(entity.getStatus())) {
                committedSkipped++;
                continue;
            }
            String current = entity.getReviewStatus();
            if (requestedStatus.equals(current)) {
                alreadyInTarget++;
                continue;
            }
            // Capture the pre-mutation disposition before overwriting (audit).
            deltaByFromStatus.merge(current, 1, Integer::sum);
            entity.setPreviousReviewStatus(current);
            entity.setReviewStatus(requestedStatus);
            entity.setReviewedAt(now);
            if (trimmedNotes != null) {
                // reviewedBy doubles as the review actor label; the cascade
                // endpoint records a stable system actor for the bulk action.
                entity.setReviewedBy("bulk-cascade");
            } else if (entity.getReviewedBy() == null || entity.getReviewedBy().isBlank()) {
                entity.setReviewedBy("anonymous");
            }
            toSave.add(entity);
        }

        if (!toSave.isEmpty()) {
            candidateRepository.saveAll(toSave);
            candidateRepository.flush();
        }

        int updatedCount = deltaByFromStatus.values().stream()
            .mapToInt(Integer::intValue).sum();
        int skippedCount = alreadyInTarget + committedSkipped;
        return new BulkReviewCascadeResponse.KindResult(
            updatedCount,
            skippedCount,
            new BulkReviewCascadeResponse.SkippedByReason(alreadyInTarget, committedSkipped),
            deltaByFromStatus
        );
    }

    // ------------------------------------------------------------------
    // Finding arm
    // ------------------------------------------------------------------

    private BulkReviewCascadeResponse.KindResult applyFindingArm(
            List<DiscoveryFindingEntity> findings,
            String requestedStatus, String trimmedNotes) {
        int alreadyInTarget = 0;
        Map<String, Integer> deltaByFromStatus = new LinkedHashMap<>();
        List<DiscoveryFindingEntity> toSave = new ArrayList<>(findings.size());
        Instant now = Instant.now();

        for (DiscoveryFindingEntity entity : findings) {
            String current = entity.getReviewStatus();
            if (requestedStatus.equals(current)) {
                alreadyInTarget++;
                continue;
            }
            // Mirrors DiscoveryFindingService.applyStatusChange: capture prior
            // disposition + stamp reviewed_at. Findings have no committed gate.
            deltaByFromStatus.merge(current, 1, Integer::sum);
            entity.setPreviousReviewStatus(current);
            entity.setReviewStatus(requestedStatus);
            entity.setReviewedAt(now);
            if (trimmedNotes != null) {
                entity.setReviewerNotes(trimmedNotes);
            }
            toSave.add(entity);
        }

        if (!toSave.isEmpty()) {
            findingRepository.saveAll(toSave);
            findingRepository.flush();
        }

        int updatedCount = deltaByFromStatus.values().stream()
            .mapToInt(Integer::intValue).sum();
        // transitionNotAllowed is retained for shape symmetry with the
        // candidate block but is ALWAYS 0 for findings (no committed gate;
        // transitions are unrestricted under Spec F).
        return new BulkReviewCascadeResponse.KindResult(
            updatedCount,
            alreadyInTarget,
            new BulkReviewCascadeResponse.SkippedByReason(alreadyInTarget, 0),
            deltaByFromStatus
        );
    }

    // ------------------------------------------------------------------
    // Scope-verifying resolution (mirrors DiscoveryFindingService.resolveCandidates)
    // ------------------------------------------------------------------

    /**
     * Load every candidate id and verify each belongs to the requested
     * ARCHITECTURE (not a single run). Candidates carry no project/architecture
     * column, so scope is verified by checking each candidate's parent run is
     * bound to the path {@code (project, architecture)} via the run guard. The
     * Review Room unions MULTIPLE runs -- a code scan + a database scan,
     * cross-scan links, and identity-merged candidates whose {@code _mergedFrom}
     * originals live in a sibling run -- so a cascaded candidate legitimately
     * belongs to a run OTHER than the conversation's path run, but always within
     * the SAME architecture. Each distinct run is verified once. Any id that
     * does not load, has no run, or whose run belongs to another
     * architecture/project throws {@link ResourceNotFoundException}.
     */
    private List<DiscoveryCandidateEntity> resolveCandidates(
            List<UUID> ids, UUID projectId, UUID architectureId) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        List<DiscoveryCandidateEntity> loaded = candidateRepository.findAllById(ids);
        if (loaded.size() != ids.size()) {
            throw new ResourceNotFoundException(
                "One or more discovery candidate ids not found in scope");
        }
        Set<UUID> verifiedRuns = new HashSet<>();
        for (DiscoveryCandidateEntity entity : loaded) {
            UUID candidateRunId = entity.getRunId();
            if (candidateRunId == null) {
                throw new ResourceNotFoundException(
                    "Discovery candidate " + entity.getId()
                        + " not found in the requested scope");
            }
            // Verify each distinct parent run is bound to the path architecture
            // exactly once. The run guard throws NoSuchElementException for a
            // run in another architecture/project -- remap it to the candidate
            // 404 contract (the controller maps both to 404, but the scoped
            // message identifies the offending id for the client).
            if (verifiedRuns.add(candidateRunId)) {
                try {
                    runGuard.verify(candidateRunId, projectId, architectureId);
                } catch (NoSuchElementException outOfScope) {
                    throw new ResourceNotFoundException(
                        "Discovery candidate " + entity.getId()
                            + " not found in the requested scope");
                }
            }
        }
        return loaded;
    }

    /**
     * Load every finding id and verify the {@code (project, architecture)} pair
     * matches the path. Findings carry {@code (project, architecture, run)}; the
     * run is intentionally NOT matched here because the cascade unions multiple
     * runs (architecture-scoped -- see {@link #resolveCandidates}), so a finding
     * linked to a sibling-run candidate is in-scope as long as it shares the
     * path architecture. Any id that does not load OR belongs to another
     * architecture/project throws {@link ResourceNotFoundException}.
     */
    private List<DiscoveryFindingEntity> resolveFindings(
            List<UUID> ids, UUID projectId, UUID architectureId) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        List<DiscoveryFindingEntity> loaded = findingRepository.findAllById(ids);
        if (loaded.size() != ids.size()) {
            throw new ResourceNotFoundException(
                "One or more discovery finding ids not found in scope");
        }
        for (DiscoveryFindingEntity entity : loaded) {
            if (!projectId.equals(entity.getProjectId())
                    || !architectureId.equals(entity.getArchitectureId())) {
                throw new ResourceNotFoundException(
                    "Discovery finding " + entity.getId()
                        + " not found in the requested scope");
            }
        }
        return loaded;
    }
}
