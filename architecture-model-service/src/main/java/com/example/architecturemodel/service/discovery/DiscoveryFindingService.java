package com.example.architecturemodel.service.discovery;

import com.example.architecturemodel.exception.InvalidFindingLinkTargetException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.discovery.DiscoveryFindingMapper;
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
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.model.entity.DiscoveryClusterEntity;
import com.example.architecturemodel.model.entity.DiscoveryDecisionTaskEntity;
import com.example.architecturemodel.model.entity.DiscoveryEvidenceEntity;
import com.example.architecturemodel.model.entity.DiscoveryRelationshipEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingLinkEntity;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingLinkRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingRepository;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import com.example.architecturemodel.repository.entity.DiscoveryClusterRepository;
import com.example.architecturemodel.repository.entity.DiscoveryDecisionTaskRepository;
import com.example.architecturemodel.repository.entity.DiscoveryEvidenceRepository;
import com.example.architecturemodel.repository.entity.DiscoveryRelationshipRepository;
import com.example.architecturemodel.service.DiscoveryRunArchitectureGuard;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Service for {@code discovery_findings} + {@code discovery_finding_links}.
 *
 * <h2>Scoping</h2>
 * Every run-scoped read and write verifies the run/project/architecture
 * tuple via {@link DiscoveryRunArchitectureGuard}. Out-of-scope access
 * returns 404 (matches the existing discovery-child convention). The
 * parallel diff-scoped surface (added 2026-05-25) uses
 * {@code ApiBehaviourDiffArchitectureGuard} instead -- see
 * {@link #listForDiff}, {@link #getForDiff}, {@link #updateForDiff},
 * {@link #reviewForDiff}, {@link #findingsByDiffItem}.
 *
 * <h2>Review disposition vocabulary &amp; transitions (Spec F, 2026-06-02)</h2>
 * <ul>
 *   <li>Default on emit: {@code pending_review}.</li>
 *   <li>Reviewer dispositions: {@code approved}, {@code rejected},
 *       {@code deferred} (candidate-parity vocabulary).</li>
 *   <li>Transitions are UNRESTRICTED (any-&gt;any) -- mirrors
 *       {@code DiscoveryCandidateService.reviewCandidate}, which accepts any
 *       of its three dispositions from any state. There is no transition
 *       graph.</li>
 *   <li>Every real transition captures the prior value into
 *       {@code previous_review_status} (lightweight audit / re-open trail).</li>
 *   <li>Same-disposition PATCH is a no-op (allowed).</li>
 * </ul>
 *
 * <h2>D6 link-target validation</h2>
 * For run-scoped target types ({@code discovery_candidate}, {@code discovery_decision_task},
 * {@code discovery_relationship}, {@code discovery_evidence}, {@code discovery_cluster})
 * the target row MUST exist AND its {@code run_id} MUST match the parent
 * finding's {@code run_id}. For {@code architecture_element} the target_id
 * format is validated as a UUID and the architecture-scope match is enforced
 * via the architecture_id on the parent finding (which itself was guarded);
 * cross-table FK lookup across every element table is not feasible in a
 * single service, so a same-architecture invariant is enforced via the
 * finding scope rather than a per-table existence check. The
 * {@code api_behaviour_diff_item} target type (activated 2026-05-25) is
 * validated by UUID-shape only; existence is the responsibility of the
 * caller (the validation-service diff runner has just persisted the
 * diff_item, so a back-lookup is redundant). Future v1 documented-but-unused
 * target types ({@code work_item}, {@code api_behaviour_baseline}) are
 * rejected if submitted in v1.
 *
 * <h2>Origin invariant</h2>
 *
 * <p>Every finding row MUST carry EXACTLY ONE of {@code run_id} /
 * {@code api_behaviour_diff_id}. The DB-level
 * {@code discovery_finding_exactly_one_origin} CHECK constraint enforces
 * this; {@link #persistFindingEntity} mirrors the check at the service
 * layer for fail-fast error messages.</p>
 *
 * <h2>PATCH semantics</h2>
 * Every field on {@link UpdateDiscoveryFindingRequest} is boxed/reference;
 * the update method null-guards every one (per
 * {@code project_primitive_double_dto_overwrite.md}). {@code confidence} is
 * boxed {@link Double} so a PATCH that omits it does NOT silently zero the
 * column.
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 2; extended by API Test Harness — Findings
 * Integration (2026-05-25) Task Group 1 with the diff-scoped surface and
 * the bulk delete for recompute cleanup; extended by Bulk Findings Actions
 * (2026-05-28) Task Group 1 with the
 * {@link #bulkReview(UUID, UUID, UUID, BulkReviewDiscoveryFindingsRequest)
 * bulk-review} entry point; normalized by Normalize Findings Review Actions
 * (Spec F, 2026-06-02) -- candidate-parity disposition vocabulary,
 * unrestricted transitions, and the {@code previous_review_status} audit
 * trail.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiscoveryFindingService {

    /** Max findings accepted on a single bulk-create call. */
    public static final int MAX_BULK_FINDINGS = 500;

    /**
     * Full set of stored {@code review_status} dispositions (candidate-parity
     * vocabulary; Spec F). {@code pending_review} is the default-on-emit
     * pre-review state; {@code approved} / {@code rejected} / {@code deferred} /
     * {@code dismissed} are reviewer dispositions.
     *
     * <p>{@code dismissed} (D4 -- Carry-over Completeness Gate, 2026-06-14) is
     * the "real but consciously excluded from migration" disposition: alongside
     * {@code rejected} ("not real"), a {@code dismissed} behaviour-bearing finding
     * with a non-empty reason satisfies the carry_over completeness gate. NO DDL
     * -- {@code review_status} is string-typed; this set is the service-layer
     * validation gate. The dismissal reason folds into {@code reviewerNotes}.</p>
     */
    public static final Set<String> ALLOWED_STATUSES = Set.of(
        "pending_review", "approved", "rejected", "deferred", "dismissed");

    /**
     * Dispositions a reviewer may transition a finding INTO via the
     * single-row review and bulk-review endpoints. Mirrors
     * {@code DiscoveryCandidateService.VALID_REVIEW_STATUSES} -- excludes the
     * pre-review {@code pending_review} state (a reviewer action always lands
     * on one of the reviewer dispositions: {@code approved} / {@code rejected} /
     * {@code deferred} / {@code dismissed}). {@code dismissed} is the D4
     * carry_over-gate disposition (see {@link #ALLOWED_STATUSES}).
     */
    static final Set<String> ALLOWED_REVIEWER_STATUSES = Set.of(
        "approved", "rejected", "deferred", "dismissed");

    /**
     * v1 link target_type vocabulary -- D6.
     *
     * <p>Extended 2026-05-25 with {@code api_behaviour_diff_item} (accepted
     * Q5) so diff-sourced findings can link back to their originating
     * diff_item row. {@code api_behaviour_baseline} stays
     * documented-but-unused in v1 -- no consumer; minimises blast
     * radius.</p>
     */
    public static final Set<String> ALLOWED_LINK_TARGET_TYPES = Set.of(
        "discovery_evidence",
        "discovery_candidate",
        "discovery_relationship",
        "discovery_cluster",
        "discovery_decision_task",
        "architecture_element",
        "api_behaviour_diff_item"
    );

    /** Run-scoped link target types (must lookup + match run_id). */
    private static final Set<String> RUN_SCOPED_TARGET_TYPES = Set.of(
        "discovery_evidence",
        "discovery_candidate",
        "discovery_relationship",
        "discovery_cluster",
        "discovery_decision_task"
    );

    private final DiscoveryFindingRepository findingRepository;
    private final DiscoveryFindingLinkRepository linkRepository;
    private final DiscoveryRunArchitectureGuard runGuard;

    private final DiscoveryCandidateRepository candidateRepository;
    private final DiscoveryDecisionTaskRepository decisionTaskRepository;
    private final DiscoveryEvidenceRepository evidenceRepository;
    private final DiscoveryRelationshipRepository relationshipRepository;
    private final DiscoveryClusterRepository clusterRepository;

    // ---------------------------------------------------------------------
    // List + get
    // ---------------------------------------------------------------------

    @Transactional(readOnly = true)
    public DiscoveryFindingSearchResponse list(
            UUID projectId,
            UUID architectureId,
            UUID runId,
            String category,
            String findingType,
            String severity,
            String status,
            String source,
            String createdByStage,
            String linkedTargetType,
            String linkedTargetId,
            String text,
            int page,
            int size) {
        runGuard.verify(runId, projectId, architectureId);
        if (linkedTargetId != null && !linkedTargetId.isBlank() && (linkedTargetType == null || linkedTargetType.isBlank())) {
            throw new IllegalArgumentException(
                "linkedTargetId requires linkedTargetType");
        }
        int safePage = Math.max(0, page);
        int safeSize = size <= 0 ? 50 : Math.min(size, 500);
        Pageable pageable = PageRequest.of(safePage, safeSize,
            Sort.by(Sort.Direction.DESC, "createdAt"));

        Page<DiscoveryFindingEntity> result = findingRepository.search(
            runId, projectId, architectureId,
            blankToNull(category),
            blankToNull(findingType),
            blankToNull(severity),
            blankToNull(status),
            blankToNull(source),
            blankToNull(createdByStage),
            blankToNull(text),
            blankToNull(linkedTargetType),
            blankToNull(linkedTargetId),
            pageable);

        List<DiscoveryFindingDto> items = new ArrayList<>(result.getContent().size());
        for (DiscoveryFindingEntity entity : result.getContent()) {
            List<DiscoveryFindingLinkEntity> links =
                linkRepository.findByFindingId(entity.getId());
            items.add(DiscoveryFindingMapper.toDto(entity, links));
        }
        return new DiscoveryFindingSearchResponse(
            items, result.getTotalElements(), safePage, safeSize);
    }

    @Transactional(readOnly = true)
    public DiscoveryFindingDto get(
            UUID projectId, UUID architectureId, UUID runId, UUID findingId) {
        runGuard.verify(runId, projectId, architectureId);
        DiscoveryFindingEntity entity = findScoped(findingId, runId, projectId, architectureId);
        List<DiscoveryFindingLinkEntity> links =
            linkRepository.findByFindingId(findingId);
        return DiscoveryFindingMapper.toDto(entity, links);
    }

    // ---------------------------------------------------------------------
    // Create
    // ---------------------------------------------------------------------

    @Transactional
    public DiscoveryFindingDto create(
            UUID projectId, UUID architectureId, UUID runId,
            CreateDiscoveryFindingRequest request) {
        runGuard.verify(runId, projectId, architectureId);
        if (request == null) {
            throw new IllegalArgumentException("Finding request body is required");
        }
        DiscoveryFindingEntity entity = persistNewFinding(
            projectId, architectureId, runId, request);

        List<DiscoveryFindingLinkEntity> links = persistLinks(
            entity, runId, architectureId, request.links());
        return DiscoveryFindingMapper.toDto(entity, links);
    }

    @Transactional
    public List<DiscoveryFindingDto> bulkCreate(
            UUID projectId, UUID architectureId, UUID runId,
            BulkCreateDiscoveryFindingsRequest request) {
        runGuard.verify(runId, projectId, architectureId);
        if (request == null || request.findings() == null) {
            throw new IllegalArgumentException("Bulk findings request body is required");
        }
        List<CreateDiscoveryFindingRequest> findings = request.findings();
        if (findings.isEmpty()) {
            return List.of();
        }
        if (findings.size() > MAX_BULK_FINDINGS) {
            throw new IllegalArgumentException(
                "Bulk findings request exceeds the per-call cap of "
                    + MAX_BULK_FINDINGS + " (received " + findings.size() + ")");
        }
        List<DiscoveryFindingDto> out = new ArrayList<>(findings.size());
        for (CreateDiscoveryFindingRequest fr : findings) {
            DiscoveryFindingEntity entity = persistNewFinding(
                projectId, architectureId, runId, fr);
            List<DiscoveryFindingLinkEntity> links = persistLinks(
                entity, runId, architectureId, fr.links());
            out.add(DiscoveryFindingMapper.toDto(entity, links));
        }
        return out;
    }

    private DiscoveryFindingEntity persistNewFinding(
            UUID projectId, UUID architectureId, UUID runId,
            CreateDiscoveryFindingRequest r) {
        return persistFindingEntity(projectId, architectureId, runId, null, null, r);
    }

    /**
     * Single internal entry-point for persisting a new finding row,
     * regardless of origin.
     *
     * <p>Enforces the exactly-one-of-origin invariant (mirrors the DB
     * {@code discovery_finding_exactly_one_origin} CHECK for fail-fast
     * service-layer errors):</p>
     *
     * <ul>
     *   <li>passing BOTH {@code runId} AND {@code apiBehaviourDiffId} non-null
     *       throws {@link IllegalArgumentException}</li>
     *   <li>passing NEITHER throws {@link IllegalArgumentException}</li>
     *   <li>passing exactly one is accepted and the entity is persisted</li>
     * </ul>
     */
    private DiscoveryFindingEntity persistFindingEntity(
            UUID projectId, UUID architectureId,
            UUID runId, UUID apiBehaviourDiffId, UUID apiBehaviourCaptureSessionId,
            CreateDiscoveryFindingRequest r) {
        requireNonBlank(r.findingType(), "findingType");
        requireNonBlank(r.category(), "category");
        requireNonBlank(r.severity(), "severity");
        requireNonBlank(r.title(), "title");
        validateExactlyOneOrigin(runId, apiBehaviourDiffId, apiBehaviourCaptureSessionId);
        String reviewStatus = r.reviewStatus() == null ? "pending_review" : r.reviewStatus();
        if (!ALLOWED_STATUSES.contains(reviewStatus)) {
            throw new IllegalArgumentException(
                "review_status '" + reviewStatus + "' is not in the allowed set " + ALLOWED_STATUSES);
        }
        DiscoveryFindingEntity entity = DiscoveryFindingEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .apiBehaviourDiffId(apiBehaviourDiffId)
            .apiBehaviourCaptureSessionId(apiBehaviourCaptureSessionId)
            .projectId(projectId)
            .architectureId(architectureId)
            .findingType(r.findingType())
            .category(r.category())
            .severity(r.severity())
            .confidence(r.confidence())
            .reviewStatus(reviewStatus)
            .title(r.title())
            .summary(r.summary())
            .detailJson(r.detailJson())
            .source(r.source())
            .createdByStage(r.createdByStage())
            .reviewerNotes(r.reviewerNotes())
            .build();
        return findingRepository.saveAndFlush(entity);
    }

    /**
     * Three-way exactly-one-of-origin invariant (changeset 179 -- Spec:
     * Model-Seeded Capture Inventory, 2026-06-11): exactly ONE of
     * {@code runId} / {@code apiBehaviourDiffId} /
     * {@code apiBehaviourCaptureSessionId} must be non-null. Mirrors the
     * re-created DB {@code discovery_finding_exactly_one_origin} CHECK for
     * fail-fast service-layer errors.
     */
    private static void validateExactlyOneOrigin(
            UUID runId, UUID apiBehaviourDiffId, UUID apiBehaviourCaptureSessionId) {
        int originsSet = (runId != null ? 1 : 0)
            + (apiBehaviourDiffId != null ? 1 : 0)
            + (apiBehaviourCaptureSessionId != null ? 1 : 0);
        if (originsSet != 1) {
            throw new IllegalArgumentException(
                "Exactly one of runId / apiBehaviourDiffId / apiBehaviourCaptureSessionId "
                    + "must be non-null on a discovery_findings row (" + originsSet
                    + " were set). Mirrors the DB discovery_finding_exactly_one_origin "
                    + "CHECK constraint.");
        }
    }

    // ---------------------------------------------------------------------
    // Update + review
    // ---------------------------------------------------------------------

    @Transactional
    public DiscoveryFindingDto update(
            UUID projectId, UUID architectureId, UUID runId, UUID findingId,
            UpdateDiscoveryFindingRequest request) {
        runGuard.verify(runId, projectId, architectureId);
        if (request == null) {
            throw new IllegalArgumentException("Finding update body is required");
        }
        DiscoveryFindingEntity entity = findScoped(findingId, runId, projectId, architectureId);
        applyUpdate(entity, request);
        DiscoveryFindingEntity saved = findingRepository.saveAndFlush(entity);
        List<DiscoveryFindingLinkEntity> links = linkRepository.findByFindingId(findingId);
        return DiscoveryFindingMapper.toDto(saved, links);
    }

    @Transactional
    public DiscoveryFindingDto review(
            UUID projectId, UUID architectureId, UUID runId, UUID findingId,
            ReviewDiscoveryFindingRequest request) {
        runGuard.verify(runId, projectId, architectureId);
        if (request == null) {
            throw new IllegalArgumentException("Review request body is required");
        }
        requireNonBlank(request.reviewStatus(), "review_status");
        DiscoveryFindingEntity entity = findScoped(findingId, runId, projectId, architectureId);
        applyStatusChange(entity, request.reviewStatus(), true);
        if (request.reviewerNotes() != null) {
            entity.setReviewerNotes(request.reviewerNotes());
        }
        DiscoveryFindingEntity saved = findingRepository.saveAndFlush(entity);
        List<DiscoveryFindingLinkEntity> links = linkRepository.findByFindingId(findingId);
        return DiscoveryFindingMapper.toDto(saved, links);
    }

    // ---------------------------------------------------------------------
    // Bulk review (2026-05-28; normalized by Spec F 2026-06-02)
    // ---------------------------------------------------------------------

    /**
     * Bulk-transition many findings to the same reviewer disposition in a
     * single transaction.
     *
     * <p>Candidate resolution:</p>
     * <ul>
     *   <li>{@code ids} supplied -- fetch each by id and verify the
     *       {@code (projectId, architectureId, runId)} triple matches the
     *       path; any foreign id throws {@link ResourceNotFoundException}
     *       (404) and rolls the transaction back. Cross-run id injection
     *       cannot mutate rows from another run.</li>
     *   <li>{@code filter} supplied -- delegate to
     *       {@code DiscoveryFindingRepository.search(...)} with the 12
     *       nullable filter params and {@link Pageable#unpaged()}.</li>
     *   <li>Neither supplied -- load every finding for the
     *       {@code (projectId, architectureId, runId)} triple.</li>
     * </ul>
     *
     * <p>Per-row loop (Spec F: transitions are unrestricted, any-&gt;any):</p>
     * <ul>
     *   <li>Same-disposition rows (current == requested) are counted into
     *       {@code skippedByReason.alreadyInTarget} and not saved.</li>
     *   <li>Every other row is actioned: the pre-mutation
     *       {@code entity.getReviewStatus()} is captured into
     *       {@code deltaByFromStatus} and {@link #applyStatusChange} mutates
     *       the entity in-place (stamping {@code previous_review_status} +
     *       {@code reviewed_at}). There is no forbidden-transition skip path
     *       under Spec F; {@code skippedByReason.transitionNotAllowed} is
     *       retained for response-shape stability but is always {@code 0}.</li>
     *   <li>{@code reviewerNotes} is overwritten when supplied as non-empty
     *       after {@code .trim()}; preserved when omitted or null
     *       (accepted Q5). Notes are applied to UPDATED rows only.</li>
     * </ul>
     *
     * <p>Commit shape (accepted Q12): a single
     * {@code findingRepository.saveAll(updatedEntities)} followed by a
     * flush at the end of the method. Per-row {@code saveAndFlush} is
     * intentionally avoided. The whole method is wrapped in one
     * {@link Transactional} boundary for atomicity.</p>
     *
     * <p>Spec: Bulk Findings Actions (2026-05-28) -- Task Group 1; normalized
     * by Normalize Findings Review Actions (Spec F, 2026-06-02).</p>
     */
    @Transactional
    public BulkReviewDiscoveryFindingsResponse bulkReview(
            UUID projectId, UUID architectureId, UUID runId,
            BulkReviewDiscoveryFindingsRequest request) {
        runGuard.verify(runId, projectId, architectureId);
        if (request == null) {
            throw new IllegalArgumentException("Bulk review request body is required");
        }
        requireNonBlank(request.reviewStatus(), "review_status");
        String requestedStatus = request.reviewStatus();
        if (!ALLOWED_REVIEWER_STATUSES.contains(requestedStatus)) {
            throw new IllegalArgumentException(
                "review_status '" + requestedStatus + "' is not a valid reviewer status; "
                    + "allowed: " + ALLOWED_REVIEWER_STATUSES);
        }

        boolean idsSupplied = request.ids() != null && !request.ids().isEmpty();
        boolean filterSupplied = request.filter() != null && hasAnyFilterField(request.filter());
        if (idsSupplied && filterSupplied) {
            throw new IllegalArgumentException(
                "mutually_exclusive_inputs: 'ids' and 'filter' cannot both be supplied");
        }

        List<DiscoveryFindingEntity> candidates =
            resolveCandidates(projectId, architectureId, runId, request,
                idsSupplied, filterSupplied);

        String trimmedNotes = null;
        if (request.reviewerNotes() != null) {
            String t = request.reviewerNotes().trim();
            if (!t.isEmpty()) {
                trimmedNotes = t;
            }
        }

        int alreadyInTarget = 0;
        Map<String, Integer> deltaByFromStatus = new LinkedHashMap<>();
        List<DiscoveryFindingEntity> toSave = new ArrayList<>(candidates.size());

        for (DiscoveryFindingEntity entity : candidates) {
            String current = entity.getReviewStatus();
            if (requestedStatus.equals(current)) {
                alreadyInTarget++;
                continue;
            }
            // Spec F: transitions are unrestricted (any->any). Capture the
            // pre-mutation disposition before applyStatusChange writes.
            deltaByFromStatus.merge(current, 1, Integer::sum);
            applyStatusChange(entity, requestedStatus, true);
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
        // transitionNotAllowed is retained for response-shape stability but is
        // ALWAYS 0 under Spec F (unrestricted transitions).
        int skippedCount = alreadyInTarget;
        return new BulkReviewDiscoveryFindingsResponse(
            updatedCount,
            skippedCount,
            new BulkReviewDiscoveryFindingsResponse.SkippedByReason(
                alreadyInTarget, 0),
            deltaByFromStatus
        );
    }

    private List<DiscoveryFindingEntity> resolveCandidates(
            UUID projectId, UUID architectureId, UUID runId,
            BulkReviewDiscoveryFindingsRequest request,
            boolean idsSupplied, boolean filterSupplied) {
        if (idsSupplied) {
            List<UUID> ids = request.ids();
            List<DiscoveryFindingEntity> loaded = findingRepository.findAllById(ids);
            // Detect any id that did not load OR loaded outside the
            // (project, architecture, run) scope. Cross-run id injection
            // returns 404 -- the entity is invisible from this scope.
            if (loaded.size() != ids.size()) {
                throw new ResourceNotFoundException(
                    "One or more discovery finding ids not found in scope");
            }
            for (DiscoveryFindingEntity entity : loaded) {
                if (!runId.equals(entity.getRunId())
                        || !projectId.equals(entity.getProjectId())
                        || !architectureId.equals(entity.getArchitectureId())) {
                    throw new ResourceNotFoundException(
                        "Discovery finding " + entity.getId()
                            + " not found in the requested scope");
                }
            }
            return loaded;
        }
        if (filterSupplied) {
            BulkReviewDiscoveryFindingsRequest.Filter f = request.filter();
            if (f.linkedTargetId() != null && !f.linkedTargetId().isBlank()
                    && (f.linkedTargetType() == null || f.linkedTargetType().isBlank())) {
                throw new IllegalArgumentException(
                    "linkedTargetId requires linkedTargetType");
            }
            Page<DiscoveryFindingEntity> page = findingRepository.search(
                runId, projectId, architectureId,
                blankToNull(f.category()),
                blankToNull(f.findingType()),
                blankToNull(f.severity()),
                blankToNull(f.reviewStatus()),
                blankToNull(f.source()),
                blankToNull(f.createdByStage()),
                blankToNull(f.text()),
                blankToNull(f.linkedTargetType()),
                blankToNull(f.linkedTargetId()),
                Pageable.unpaged());
            return new ArrayList<>(page.getContent());
        }
        // Neither ids nor filter: every finding in the run scope.
        return findingRepository.findByRunIdAndProjectIdAndArchitectureId(
            runId, projectId, architectureId);
    }

    private static boolean hasAnyFilterField(BulkReviewDiscoveryFindingsRequest.Filter f) {
        if (f == null) {
            return false;
        }
        return !blank(f.category())
            || !blank(f.findingType())
            || !blank(f.severity())
            || !blank(f.reviewStatus())
            || !blank(f.source())
            || !blank(f.createdByStage())
            || !blank(f.linkedTargetType())
            || !blank(f.linkedTargetId())
            || !blank(f.text());
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    @Transactional
    public void delete(
            UUID projectId, UUID architectureId, UUID runId, UUID findingId) {
        runGuard.verify(runId, projectId, architectureId);
        DiscoveryFindingEntity entity = findScoped(findingId, runId, projectId, architectureId);
        findingRepository.delete(entity);
    }

    // ---------------------------------------------------------------------
    // Links
    // ---------------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<DiscoveryFindingLinkDto> listLinks(
            UUID projectId, UUID architectureId, UUID runId, UUID findingId) {
        runGuard.verify(runId, projectId, architectureId);
        findScoped(findingId, runId, projectId, architectureId);
        return linkRepository.findByFindingId(findingId).stream()
            .map(DiscoveryFindingMapper::toDto)
            .toList();
    }

    @Transactional
    public DiscoveryFindingLinkDto addLink(
            UUID projectId, UUID architectureId, UUID runId, UUID findingId,
            CreateDiscoveryFindingLinkRequest request) {
        runGuard.verify(runId, projectId, architectureId);
        if (request == null) {
            throw new IllegalArgumentException("Link request body is required");
        }
        DiscoveryFindingEntity finding = findScoped(findingId, runId, projectId, architectureId);
        DiscoveryFindingLinkEntity entity = persistLink(finding, runId, architectureId, request);
        return DiscoveryFindingMapper.toDto(entity);
    }

    @Transactional
    public void removeLink(
            UUID projectId, UUID architectureId, UUID runId, UUID findingId, UUID linkId) {
        runGuard.verify(runId, projectId, architectureId);
        findScoped(findingId, runId, projectId, architectureId);
        DiscoveryFindingLinkEntity entity = linkRepository.findById(linkId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Discovery finding link not found: " + linkId));
        if (!entity.getFindingId().equals(findingId)) {
            throw new ResourceNotFoundException(
                "Discovery finding link " + linkId + " does not belong to finding " + findingId);
        }
        linkRepository.delete(entity);
    }

    // =====================================================================
    // Diff-scoped surface (2026-05-25)
    // =====================================================================

    /**
     * Create a diff-sourced finding directly (no parent run).
     *
     * <p>Project + architecture are NOT verified against any external row
     * here -- callers are expected to pass them already-validated from the
     * diff entity. The exactly-one-of-origin invariant is enforced via
     * {@link #persistFindingEntity}.</p>
     */
    @Transactional
    public DiscoveryFindingDto createForDiff(
            UUID projectId, UUID architectureId, UUID diffId,
            CreateDiscoveryFindingRequest request) {
        if (diffId == null) {
            throw new IllegalArgumentException("diffId is required");
        }
        if (request == null) {
            throw new IllegalArgumentException("Finding request body is required");
        }
        DiscoveryFindingEntity entity = persistFindingEntity(
            projectId, architectureId, null, diffId, null, request);
        List<DiscoveryFindingLinkEntity> links = persistLinksForDiff(
            entity, architectureId, request.links());
        return DiscoveryFindingMapper.toDto(entity, links);
    }

    // =====================================================================
    // Capture-session-scoped surface (Spec: Model-Seeded Capture Inventory,
    // 2026-06-11 -- Task Group 1)
    // =====================================================================

    /**
     * Create a reconciliation-sourced finding directly (no parent run, no
     * diff). Third origin: {@code api_behaviour_capture_session_id}.
     *
     * <p>Project + architecture are NOT verified against any external row
     * here -- the caller (the AMS inventory-reconciliation endpoint) passes
     * them already-validated from the session entity. The three-way
     * exactly-one-of-origin invariant is enforced via
     * {@link #persistFindingEntity}.</p>
     */
    @Transactional
    public DiscoveryFindingDto createForCaptureSession(
            UUID projectId, UUID architectureId, UUID captureSessionId,
            CreateDiscoveryFindingRequest request) {
        if (captureSessionId == null) {
            throw new IllegalArgumentException("captureSessionId is required");
        }
        if (request == null) {
            throw new IllegalArgumentException("Finding request body is required");
        }
        DiscoveryFindingEntity entity = persistFindingEntity(
            projectId, architectureId, null, null, captureSessionId, request);
        List<DiscoveryFindingLinkEntity> links = persistLinksForDiff(
            entity, architectureId, request.links());
        return DiscoveryFindingMapper.toDto(entity, links);
    }

    /**
     * Bulk delete of all findings sourced from the given capture session
     * inventory reconciliation.
     *
     * <p><b>Load-bearing for reconciliation re-runs -- NOT defensive</b>
     * (diffRunner Q6 precedent): the
     * {@code api_behaviour_capture_session_id ON DELETE CASCADE} only fires
     * on session-row deletion; a reconciliation re-run keeps the session row
     * alive, so the AMS inventory-reconciliation endpoint MUST call this
     * BEFORE re-emitting. Without it, findings would accumulate across
     * re-runs (2x after one re-run, 3x after two, ...).</p>
     *
     * <p>Returns the number of finding rows deleted (for diagnostics /
     * logging). Same load-then-delete shape as
     * {@link #deleteFindingsByApiBehaviourDiffId} so per-finding link
     * cleanup behaves identically under H2 test runs.</p>
     */
    @Transactional
    public int deleteFindingsByCaptureSessionId(UUID captureSessionId) {
        if (captureSessionId == null) {
            throw new IllegalArgumentException("captureSessionId is required");
        }
        List<DiscoveryFindingEntity> toDelete =
            findingRepository.findByApiBehaviourCaptureSessionIdOrderByCreatedAtAsc(
                captureSessionId);
        if (toDelete.isEmpty()) {
            return 0;
        }
        for (DiscoveryFindingEntity entity : toDelete) {
            List<DiscoveryFindingLinkEntity> links =
                linkRepository.findByFindingId(entity.getId());
            if (!links.isEmpty()) {
                linkRepository.deleteAll(links);
            }
            findingRepository.delete(entity);
        }
        findingRepository.flush();
        return toDelete.size();
    }

    /** Diff-scoped list: all findings emitted by the given diff, ascending created_at. */
    @Transactional(readOnly = true)
    public List<DiscoveryFindingDto> listForDiff(UUID diffId) {
        if (diffId == null) {
            throw new IllegalArgumentException("diffId is required");
        }
        List<DiscoveryFindingEntity> entities =
            findingRepository.findByApiBehaviourDiffIdOrderByCreatedAtAsc(diffId);
        List<DiscoveryFindingDto> out = new ArrayList<>(entities.size());
        for (DiscoveryFindingEntity entity : entities) {
            List<DiscoveryFindingLinkEntity> links =
                linkRepository.findByFindingId(entity.getId());
            out.add(DiscoveryFindingMapper.toDto(entity, links));
        }
        return out;
    }

    /**
     * Diff-scoped detail. Returns 404 if the finding does not exist OR its
     * {@code api_behaviour_diff_id} does not match {@code diffId} (scoping
     * sanity, mirrors {@link #findScoped} for run-sourced findings).
     */
    @Transactional(readOnly = true)
    public DiscoveryFindingDto getForDiff(UUID diffId, UUID findingId) {
        DiscoveryFindingEntity entity = findScopedToDiff(findingId, diffId);
        List<DiscoveryFindingLinkEntity> links =
            linkRepository.findByFindingId(findingId);
        return DiscoveryFindingMapper.toDto(entity, links);
    }

    /**
     * Diff-scoped PATCH (reviewer disposition transitions + edits).
     *
     * <p>Same body shape as {@link #update}; the only difference is the
     * scoping path (diff-id instead of run-id).</p>
     */
    @Transactional
    public DiscoveryFindingDto updateForDiff(
            UUID diffId, UUID findingId, UpdateDiscoveryFindingRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Finding update body is required");
        }
        DiscoveryFindingEntity entity = findScopedToDiff(findingId, diffId);
        applyUpdate(entity, request);
        DiscoveryFindingEntity saved = findingRepository.saveAndFlush(entity);
        List<DiscoveryFindingLinkEntity> links = linkRepository.findByFindingId(findingId);
        return DiscoveryFindingMapper.toDto(saved, links);
    }

    /** Diff-scoped review convenience (disposition + notes + reviewed_at stamp). */
    @Transactional
    public DiscoveryFindingDto reviewForDiff(
            UUID diffId, UUID findingId, ReviewDiscoveryFindingRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Review request body is required");
        }
        requireNonBlank(request.reviewStatus(), "review_status");
        DiscoveryFindingEntity entity = findScopedToDiff(findingId, diffId);
        applyStatusChange(entity, request.reviewStatus(), true);
        if (request.reviewerNotes() != null) {
            entity.setReviewerNotes(request.reviewerNotes());
        }
        DiscoveryFindingEntity saved = findingRepository.saveAndFlush(entity);
        List<DiscoveryFindingLinkEntity> links = linkRepository.findByFindingId(findingId);
        return DiscoveryFindingMapper.toDto(saved, links);
    }

    /**
     * Findings linked to a specific diff_item via
     * {@code discovery_finding_links} (target_type =
     * {@code api_behaviour_diff_item}). Used by the per-row badge on the
     * Drift report tab.
     *
     * <p>Returned findings are additionally filtered to those that belong
     * to the supplied {@code diffId} -- a safety filter against stale link
     * rows or cross-diff link pollution (should not happen in v1 but is
     * cheap to enforce).</p>
     */
    @Transactional(readOnly = true)
    public List<DiscoveryFindingDto> findingsByDiffItem(UUID diffId, UUID diffItemId) {
        if (diffId == null) {
            throw new IllegalArgumentException("diffId is required");
        }
        if (diffItemId == null) {
            throw new IllegalArgumentException("diffItemId is required");
        }
        List<DiscoveryFindingLinkEntity> links =
            linkRepository.findByTargetTypeAndTargetId(
                "api_behaviour_diff_item", diffItemId.toString());
        if (links.isEmpty()) {
            return List.of();
        }
        List<DiscoveryFindingDto> out = new ArrayList<>(links.size());
        for (DiscoveryFindingLinkEntity link : links) {
            findingRepository.findById(link.getFindingId()).ifPresent(entity -> {
                if (diffId.equals(entity.getApiBehaviourDiffId())) {
                    List<DiscoveryFindingLinkEntity> entityLinks =
                        linkRepository.findByFindingId(entity.getId());
                    out.add(DiscoveryFindingMapper.toDto(entity, entityLinks));
                }
            });
        }
        return out;
    }

    /**
     * Bulk delete of all findings sourced from the given diff.
     *
     * <p><b>Load-bearing for diff recompute -- NOT defensive (accepted
     * Q6).</b> The {@code api_behaviour_diff_id ON DELETE CASCADE} only
     * fires on diff-row deletion; recompute keeps the diff row alive
     * while replacing diff_items, so this method MUST be called by
     * {@code diffRunner.ts} BEFORE re-emit. Without it, findings would
     * accumulate across recomputes (2x after one recompute, 3x after two,
     * ...).</p>
     *
     * <p>Returns the number of finding rows deleted (for diagnostics /
     * logging). Caller is responsible for cascading delete of
     * {@code discovery_finding_links} via JPA orphan removal if needed --
     * v1 keeps links via the FK CASCADE on the link table.</p>
     */
    @Transactional
    public int deleteFindingsByApiBehaviourDiffId(UUID diffId) {
        if (diffId == null) {
            throw new IllegalArgumentException("diffId is required");
        }
        // Load + delete-by-id so per-finding link CASCADE fires correctly
        // under H2 test runs (the bulk JPQL DELETE skips lifecycle
        // callbacks and may bypass the link-table cascade under
        // Hibernate-generated DDL). Production PostgreSQL honours the
        // FK CASCADE on discovery_finding_links.finding_id either way.
        List<DiscoveryFindingEntity> toDelete =
            findingRepository.findByApiBehaviourDiffIdOrderByCreatedAtAsc(diffId);
        if (toDelete.isEmpty()) {
            return 0;
        }
        for (DiscoveryFindingEntity entity : toDelete) {
            // Remove link rows defensively so test runs without a live FK
            // CASCADE see the same observable outcome as production.
            List<DiscoveryFindingLinkEntity> links =
                linkRepository.findByFindingId(entity.getId());
            if (!links.isEmpty()) {
                linkRepository.deleteAll(links);
            }
            findingRepository.delete(entity);
        }
        findingRepository.flush();
        return toDelete.size();
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    private void applyUpdate(
            DiscoveryFindingEntity entity, UpdateDiscoveryFindingRequest request) {
        if (request.findingType() != null) {
            entity.setFindingType(request.findingType());
        }
        if (request.category() != null) {
            entity.setCategory(request.category());
        }
        if (request.severity() != null) {
            entity.setSeverity(request.severity());
        }
        // Boxed Double: null means "field omitted" -- DO NOT wipe to 0.
        // project_primitive_double_dto_overwrite.md
        if (request.confidence() != null) {
            entity.setConfidence(request.confidence());
        }
        if (request.reviewStatus() != null) {
            applyStatusChange(entity, request.reviewStatus(), false);
        }
        if (request.title() != null) {
            entity.setTitle(request.title());
        }
        if (request.summary() != null) {
            entity.setSummary(request.summary());
        }
        if (request.detailJson() != null) {
            entity.setDetailJson(request.detailJson());
        }
        if (request.source() != null) {
            entity.setSource(request.source());
        }
        if (request.createdByStage() != null) {
            entity.setCreatedByStage(request.createdByStage());
        }
        if (request.reviewerNotes() != null) {
            // Reviewer-notes-only updates are explicitly allowed without disposition change.
            entity.setReviewerNotes(request.reviewerNotes());
        }
    }

    private DiscoveryFindingEntity findScoped(
            UUID findingId, UUID runId, UUID projectId, UUID architectureId) {
        DiscoveryFindingEntity entity = findingRepository.findById(findingId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Discovery finding not found: " + findingId));
        if (!runId.equals(entity.getRunId())
                || !projectId.equals(entity.getProjectId())
                || !architectureId.equals(entity.getArchitectureId())) {
            throw new ResourceNotFoundException(
                "Discovery finding " + findingId + " not found in the requested scope");
        }
        return entity;
    }

    /**
     * Diff-scoped variant of {@link #findScoped}. The finding's
     * {@code api_behaviour_diff_id} MUST match {@code diffId}; project +
     * architecture are NOT re-verified here (the diff guard checks the diff
     * belongs to project+architecture before this method is called).
     */
    private DiscoveryFindingEntity findScopedToDiff(UUID findingId, UUID diffId) {
        DiscoveryFindingEntity entity = findingRepository.findById(findingId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Discovery finding not found: " + findingId));
        if (!diffId.equals(entity.getApiBehaviourDiffId())) {
            throw new ResourceNotFoundException(
                "Discovery finding " + findingId + " not found in the requested diff scope");
        }
        return entity;
    }

    /**
     * Apply a reviewer disposition change.
     *
     * <p>Spec F: transitions are UNRESTRICTED (any-&gt;any) -- there is no
     * transition graph. The requested disposition is validated against
     * {@link #ALLOWED_STATUSES}; a same-disposition request is a no-op (still
     * stamps {@code reviewed_at} when invoked via the review endpoint). On a
     * real change, the prior value is captured into
     * {@code previous_review_status} (mirrors
     * {@code DiscoveryCandidateService.reviewCandidate}) before the overwrite,
     * and {@code reviewed_at} is stamped.</p>
     */
    private void applyStatusChange(
            DiscoveryFindingEntity entity, String requestedStatus, boolean stampReviewedAt) {
        if (!ALLOWED_STATUSES.contains(requestedStatus)) {
            throw new IllegalArgumentException(
                "review_status '" + requestedStatus + "' is not in the allowed set "
                    + ALLOWED_STATUSES);
        }
        String current = entity.getReviewStatus();
        if (current != null && current.equals(requestedStatus)) {
            // No-op transition; still record review timestamp if explicitly
            // invoked via the review endpoint.
            if (stampReviewedAt) {
                entity.setReviewedAt(Instant.now());
            }
            return;
        }
        // Capture the prior disposition before overwriting (audit / re-open
        // trail) -- mirrors DiscoveryCandidateService.reviewCandidate.
        entity.setPreviousReviewStatus(current);
        entity.setReviewStatus(requestedStatus);
        entity.setReviewedAt(Instant.now());
    }

    private List<DiscoveryFindingLinkEntity> persistLinks(
            DiscoveryFindingEntity finding,
            UUID runId, UUID architectureId,
            List<CreateDiscoveryFindingLinkRequest> requests) {
        if (requests == null || requests.isEmpty()) {
            return List.of();
        }
        List<DiscoveryFindingLinkEntity> out = new ArrayList<>(requests.size());
        for (CreateDiscoveryFindingLinkRequest req : requests) {
            out.add(persistLink(finding, runId, architectureId, req));
        }
        return out;
    }

    /**
     * Variant for diff-sourced findings -- the parent finding has no
     * {@code runId} so run-scoped target-type checks would always fail.
     * Only non-run-scoped target types are accepted from this path
     * (typically just {@code api_behaviour_diff_item}). Run-scoped target
     * types are rejected when there is no parent run to bind them to.
     */
    private List<DiscoveryFindingLinkEntity> persistLinksForDiff(
            DiscoveryFindingEntity finding,
            UUID architectureId,
            List<CreateDiscoveryFindingLinkRequest> requests) {
        if (requests == null || requests.isEmpty()) {
            return List.of();
        }
        List<DiscoveryFindingLinkEntity> out = new ArrayList<>(requests.size());
        for (CreateDiscoveryFindingLinkRequest req : requests) {
            if (req == null) {
                throw new IllegalArgumentException("Link request is required");
            }
            if (RUN_SCOPED_TARGET_TYPES.contains(req.targetType())) {
                throw new InvalidFindingLinkTargetException(
                    req.targetType(), req.targetId(),
                    "run-scoped target_type not permitted on a diff-sourced finding "
                        + "(no parent run to bind the target to)");
            }
            out.add(persistLink(finding, null, architectureId, req));
        }
        return out;
    }

    private DiscoveryFindingLinkEntity persistLink(
            DiscoveryFindingEntity finding,
            UUID runId, UUID architectureId,
            CreateDiscoveryFindingLinkRequest req) {
        if (req == null) {
            throw new IllegalArgumentException("Link request is required");
        }
        requireNonBlank(req.linkType(), "linkType");
        requireNonBlank(req.targetType(), "targetType");
        requireNonBlank(req.targetId(), "targetId");
        validateLinkTarget(req.targetType(), req.targetId(), runId, architectureId);
        DiscoveryFindingLinkEntity entity = DiscoveryFindingLinkEntity.builder()
            .id(UUID.randomUUID())
            .findingId(finding.getId())
            .linkType(req.linkType())
            .targetType(req.targetType())
            .targetId(req.targetId())
            .label(req.label())
            .build();
        return linkRepository.saveAndFlush(entity);
    }

    /**
     * D6 hard-reject. Validates that the link target exists AND is in scope.
     *
     * <ul>
     *   <li>For run-scoped target types the target row is looked up by UUID
     *       and its {@code run_id} must match.</li>
     *   <li>For {@code architecture_element} the target_id is parsed as a
     *       UUID; cross-table existence checking is not performed (no single
     *       registry of element ids), but the parent finding is scoped to
     *       the architecture by construction so an out-of-architecture link
     *       cannot be created via this controller surface.</li>
     *   <li>For {@code api_behaviour_diff_item} (activated 2026-05-25) the
     *       target_id is parsed as a UUID; existence is the caller's
     *       responsibility (the validation-service diff runner has just
     *       persisted the diff_item, so a back-lookup is redundant).</li>
     *   <li>Documented-but-unused v1 target types ({@code work_item},
     *       {@code api_behaviour_baseline}) are rejected when submitted --
     *       enforced by the {@link #ALLOWED_LINK_TARGET_TYPES} membership
     *       check above.</li>
     * </ul>
     */
    private void validateLinkTarget(
            String targetType, String targetId, UUID runId, UUID architectureId) {
        if (!ALLOWED_LINK_TARGET_TYPES.contains(targetType)) {
            throw new InvalidFindingLinkTargetException(targetType, targetId,
                "target_type not in the v1 allowed set " + ALLOWED_LINK_TARGET_TYPES);
        }
        if (RUN_SCOPED_TARGET_TYPES.contains(targetType)) {
            if (runId == null) {
                throw new InvalidFindingLinkTargetException(targetType, targetId,
                    "run-scoped target_type requires a parent run");
            }
            UUID targetUuid = parseUuidOrThrow(targetType, targetId);
            UUID targetRunId = lookupRunIdForTarget(targetType, targetUuid);
            if (targetRunId == null) {
                throw new InvalidFindingLinkTargetException(targetType, targetId,
                    "target does not exist");
            }
            if (!targetRunId.equals(runId)) {
                throw new InvalidFindingLinkTargetException(targetType, targetId,
                    "target belongs to a different run (" + targetRunId + ")");
            }
            return;
        }
        if ("architecture_element".equals(targetType)) {
            // UUID-shape validation only -- existence-across-element-tables is
            // out of scope here. The architectureId on the parent finding
            // bounds the scope.
            parseUuidOrThrow(targetType, targetId);
            // architectureId is captured by the caller; nothing further to do.
            //noinspection ResultOfMethodCallIgnored
            architectureId.hashCode();
            return;
        }
        if ("api_behaviour_diff_item".equals(targetType)) {
            // UUID-shape validation only -- the caller (typically the
            // validation-service diff runner) has just persisted the
            // diff_item; existence-check via a repository round-trip would
            // be redundant. Cross-diff link pollution is filtered at the
            // read path (findingsByDiffItem).
            parseUuidOrThrow(targetType, targetId);
        }
    }

    private UUID lookupRunIdForTarget(String targetType, UUID targetUuid) {
        switch (targetType) {
            case "discovery_candidate":
                return candidateRepository.findById(targetUuid)
                    .map(DiscoveryCandidateEntity::getRunId).orElse(null);
            case "discovery_decision_task":
                return decisionTaskRepository.findById(targetUuid)
                    .map(DiscoveryDecisionTaskEntity::getRunId).orElse(null);
            case "discovery_evidence":
                return evidenceRepository.findById(targetUuid)
                    .map(DiscoveryEvidenceEntity::getRunId).orElse(null);
            case "discovery_relationship":
                return relationshipRepository.findById(targetUuid)
                    .map(DiscoveryRelationshipEntity::getRunId).orElse(null);
            case "discovery_cluster":
                return clusterRepository.findById(targetUuid)
                    .map(DiscoveryClusterEntity::getRunId).orElse(null);
            default:
                return null;
        }
    }

    private static UUID parseUuidOrThrow(String targetType, String targetId) {
        try {
            return UUID.fromString(targetId);
        } catch (IllegalArgumentException ex) {
            throw new InvalidFindingLinkTargetException(targetType, targetId,
                "target_id is not a valid UUID");
        }
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }

    private static void requireNonBlank(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " is required");
        }
    }

    /** Visible to unit tests for allowed-disposition assertions. */
    static Set<String> snapshotAllowedStatuses() {
        return new HashSet<>(ALLOWED_STATUSES);
    }
}
