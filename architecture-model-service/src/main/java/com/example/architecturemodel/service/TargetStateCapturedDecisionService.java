package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.targetstate.CreateTargetStateCapturedDecisionRequest;
import com.example.architecturemodel.model.entity.TargetStateCapturedDecisionEntity;
import com.example.architecturemodel.repository.entity.TargetStateCapturedDecisionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Service layer for the {@code target_state_captured_decisions} table.
 *
 * <p>Spec: Target State Captured Decisions -- Data Plane
 * (2026-05-24-target-state-captured-decisions-data-plane) -- Task Group 2.</p>
 *
 * <p>Responsibilities:</p>
 * <ul>
 *   <li><b>Atomic supersession on create:</b> {@link #createDecision} resolves
 *       the prior non-superseded row for the same
 *       {@code (project_id, target_architecture_id, decision_code, scope_kind,
 *       scope_ref_id)} tuple BEFORE inserting the new row, then inserts the
 *       new row, then -- inside the same {@code @Transactional} boundary
 *       (Spring default propagation; no {@code REQUIRES_NEW}) -- sets the
 *       prior row's {@code superseded_by_id} to the new row's id. The
 *       lookup-then-insert-then-update sequencing avoids the new row matching
 *       its own "latest non-superseded" filter. The invariant "at any
 *       consistent read, at most one row per tuple has
 *       {@code superseded_by_id IS NULL}" is enforced by this flow.</li>
 *   <li><b>Latest-only reads</b> for the default GET surfaces
 *       ({@link #listLatestDecisions}, {@link #findByDecisionCode}) and a
 *       full-audit read ({@link #listAllDecisions}) for the
 *       {@code ?includeSuperseded=true} path.</li>
 *   <li><b>Cross-project leak guard:</b> {@link #findById} loads by id then
 *       verifies the loaded row's {@code project_id} and
 *       {@code target_architecture_id} match the path values; on mismatch
 *       returns {@link Optional#empty()} so the controller translates the
 *       result into HTTP 404 (NOT 403 -- avoids leaking row existence to an
 *       attacker who guesses a sibling project's UUID; per Q15 in
 *       {@code planning/requirements.md}).</li>
 * </ul>
 *
 * <p>Writes are POST-only at the data plane (per Q3 and spec.md): there is
 * no PATCH, PUT, or DELETE on captured decisions. To "change" a decision the
 * caller inserts a new row, which atomically supersedes the prior matching
 * tuple.</p>
 *
 * <p>User-facing log and error messages spell out "Architecture Model Service"
 * (per {@code feedback_no_invented_acronyms.md}) -- internal Java identifiers
 * follow the existing project conventions.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class TargetStateCapturedDecisionService {

    private final TargetStateCapturedDecisionRepository repository;

    /**
     * Creates a new captured-decision row and atomically supersedes any prior
     * non-superseded row for the same tuple.
     *
     * <p>Single transactional boundary: the prior-row lookup, the new-row
     * insert, and the {@code superseded_by_id} update on the prior row commit
     * or roll back together. Spring's default propagation is used deliberately
     * -- the spec forbids {@code REQUIRES_NEW} here (per Implementation Notes)
     * because the supersession write MUST share fate with the new insert.</p>
     *
     * <p><b>Ordering matters:</b> the prior-row lookup happens BEFORE the new
     * insert so the new row (which has {@code superseded_by_id IS NULL} the
     * moment it is saved) cannot match its own "latest non-superseded"
     * predicate. With the lookup first, at most one row matches the tuple
     * filter; if present, it is the genuine prior row to supersede.</p>
     *
     * @param projectId               the path-scoped project id; persisted on
     *                                the new row
     * @param targetArchitectureId    the path-scoped target architecture id;
     *                                persisted on the new row
     * @param request                 the create-request payload supplying the
     *                                decision code, scope, answer fields, and
     *                                {@code createdByTask}
     * @return the newly inserted entity (with server-set id and createdAt)
     */
    @Transactional
    public TargetStateCapturedDecisionEntity createDecision(
            UUID projectId,
            UUID targetArchitectureId,
            CreateTargetStateCapturedDecisionRequest request) {

        if (request == null) {
            throw new IllegalArgumentException(
                "Architecture Model Service captured-decision create requires a request body");
        }
        if (projectId == null) {
            throw new IllegalArgumentException(
                "Architecture Model Service captured-decision create requires a projectId");
        }
        if (targetArchitectureId == null) {
            throw new IllegalArgumentException(
                "Architecture Model Service captured-decision create requires a targetArchitectureId");
        }

        // Look up the prior non-superseded row for the same tuple BEFORE
        // inserting the new row. If we inserted first the new row's own
        // superseded_by_id (null at insert time) would match the "latest
        // non-superseded" filter and the lookup would return two rows. The
        // composite index (project_id, target_architecture_id, decision_code,
        // scope_kind, scope_ref_id) exists to make this lookup cheap.
        Optional<TargetStateCapturedDecisionEntity> prior =
            repository.findLatestNonSupersededByTuple(
                projectId,
                targetArchitectureId,
                request.decisionCode(),
                request.scopeKind(),
                request.scopeRefId());

        UUID newId = UUID.randomUUID();
        TargetStateCapturedDecisionEntity newRow = TargetStateCapturedDecisionEntity.builder()
            .id(newId)
            .projectId(projectId)
            .targetArchitectureId(targetArchitectureId)
            .decisionCode(request.decisionCode())
            .scopeKind(request.scopeKind())
            .scopeRefType(request.scopeRefType())
            .scopeRefId(request.scopeRefId())
            .answerValue(request.answerValue())
            .answerSummary(request.answerSummary())
            .standardsLookupRef(request.standardsLookupRef())
            .conversationThreadId(request.conversationThreadId())
            .conversationTurnRef(request.conversationTurnRef())
            .createdByTask(request.createdByTask())
            .createdAt(Instant.now())
            .supersededById(null)
            .build();

        TargetStateCapturedDecisionEntity saved = repository.save(newRow);

        // Atomic supersession: update the prior row inside the SAME
        // @Transactional boundary so insert + supersession commit or roll
        // back together.
        if (prior.isPresent()) {
            TargetStateCapturedDecisionEntity priorRow = prior.get();
            priorRow.setSupersededById(saved.getId());
            repository.save(priorRow);
            log.info(
                "Architecture Model Service captured-decision supersession: "
                + "project={}, targetArchitecture={}, decisionCode={}, "
                + "scope=({},{}), priorId={}, supersedingId={}",
                projectId, targetArchitectureId, request.decisionCode(),
                request.scopeKind(), request.scopeRefId(),
                priorRow.getId(), saved.getId());
        }

        return saved;
    }

    /**
     * Returns the latest (non-superseded) decisions for the given target
     * architecture. Drives the default
     * {@code GET .../captured-decisions} surface (without
     * {@code ?includeSuperseded=true}) and the gateway resolver feed.
     */
    @Transactional(readOnly = true)
    public List<TargetStateCapturedDecisionEntity> listLatestDecisions(
            UUID projectId, UUID targetArchitectureId) {
        return repository.findLatestNonSupersededForTarget(projectId, targetArchitectureId);
    }

    /**
     * Returns ALL decisions for the given target architecture, including
     * superseded rows. Drives the
     * {@code GET .../captured-decisions?includeSuperseded=true} audit path.
     */
    @Transactional(readOnly = true)
    public List<TargetStateCapturedDecisionEntity> listAllDecisions(
            UUID projectId, UUID targetArchitectureId) {
        return repository.findAllForTarget(projectId, targetArchitectureId);
    }

    /**
     * Returns the latest (non-superseded) decisions for one decision code
     * across all scopes for the given target architecture. Drives the
     * {@code GET .../captured-decisions/by-code/{decisionCode}} surface.
     */
    @Transactional(readOnly = true)
    public List<TargetStateCapturedDecisionEntity> findByDecisionCode(
            UUID projectId, UUID targetArchitectureId, String decisionCode) {
        return repository.findLatestNonSupersededByDecisionCode(
            projectId, targetArchitectureId, decisionCode);
    }

    /**
     * Loads a single decision by id with a cross-project leak guard.
     *
     * <p>If the row exists but its {@code project_id} or
     * {@code target_architecture_id} do not match the path values, returns
     * {@link Optional#empty()} so the controller layer returns HTTP 404 --
     * never 403. We deliberately do not differentiate "row exists in another
     * project" from "row does not exist" to avoid leaking existence to an
     * attacker who guesses sibling project / architecture UUIDs (per Q15).</p>
     */
    @Transactional(readOnly = true)
    public Optional<TargetStateCapturedDecisionEntity> findById(
            UUID projectId, UUID targetArchitectureId, UUID decisionId) {
        return repository.findById(decisionId)
            .filter(row -> projectId != null && projectId.equals(row.getProjectId()))
            .filter(row -> targetArchitectureId != null
                && targetArchitectureId.equals(row.getTargetArchitectureId()));
    }

    /**
     * Convenience read that throws {@link ResourceNotFoundException} on miss
     * (translated to HTTP 404 by {@code GlobalExceptionHandler}). Used by the
     * single-row GET endpoint to convert the {@link Optional#empty()} guard
     * into the conventional 404 envelope.
     */
    @Transactional(readOnly = true)
    public TargetStateCapturedDecisionEntity getByIdOrThrow(
            UUID projectId, UUID targetArchitectureId, UUID decisionId) {
        return findById(projectId, targetArchitectureId, decisionId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Architecture Model Service captured-decision row " + decisionId
                    + " not found for project " + projectId
                    + " and target architecture " + targetArchitectureId));
    }
}
