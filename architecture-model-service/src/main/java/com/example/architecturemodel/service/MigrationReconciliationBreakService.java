package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.MigrationReconciliationBreakMapper;
import com.example.architecturemodel.model.dto.MigrationReconciliationBreakDto;
import com.example.architecturemodel.model.entity.MigrationReconciliationBreakEntity;
import com.example.architecturemodel.model.entity.MigrationReconciliationBreakStatus;
import com.example.architecturemodel.repository.entity.MigrationReconciliationBreakRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Service for the Migration Reconciliation break &lt;-&gt; bug lifecycle +
 * disposition persistence endpoints (Task Group 1).
 *
 * <p>Wraps {@link MigrationReconciliationBreakRepository} with the gateway-loop-
 * facing surface (Groups 2/3/4 call these):</p>
 * <ul>
 *   <li>{@link #createBreaks(UUID, List)} -- bulk-persist a batch of breaks for
 *       a run from a completed (full or scoped) reconcile result. Each break is
 *       bound to the run id from the path + carries the pinned-baseline oracle
 *       anchor + the {@code source_baseline_item_id} scope key.</li>
 *   <li>{@link #getBreaksForRun(UUID)} -- read a run's breaks (oldest-first) for
 *       the review surface.</li>
 *   <li>{@link #updateBreak(UUID, MigrationReconciliationBreakDto)} -- PATCH a
 *       break's disposition / flags (null-guarded; boxed types).</li>
 *   <li>{@link #incrementAttempt(UUID)} -- bump the circuit-breaker attempt
 *       counter atomically (read-modify-write under the txn).</li>
 *   <li>{@link #setCircuitBroken(UUID, boolean, boolean, String)} -- trip the
 *       circuit breaker / escalate to human review.</li>
 *   <li>{@link #markSent(String, List)} -- stamp the {@code bug_id} on a batch of
 *       breaks and move them to {@code sent_as_bug} (attempt 1).</li>
 *   <li>{@link #findBreaksByBugId(String)} /
 *       {@link #findBreaksBySourceBaselineItemId(UUID)} -- the callback /
 *       scoped-re-reconcile resolution lookups.</li>
 * </ul>
 *
 * <p>Disposition values are service-layer validated against
 * {@link MigrationReconciliationBreakStatus#ALL} (no DB enum, matching the AMS
 * status-as-TEXT convention). The mapper owns the null-guarded PATCH semantics
 * (boxed reference types per {@code project_primitive_double_dto_overwrite.md}).</p>
 *
 * <p>Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) --
 * Task Group 1.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class MigrationReconciliationBreakService {

    private final MigrationReconciliationBreakRepository breakRepository;

    /**
     * Bulk-persist a batch of breaks for a run from a completed reconcile
     * result. Each break is bound to the supplied {@code runId} (from the URL
     * path; overrides whatever the DTO body carries) and validated for a legal
     * disposition status. A break is born {@code open} unless its DTO carries an
     * explicit disposition.
     *
     * @param runId  the owning reconcile run UUID (from the URL path)
     * @param breaks the breaks to persist (a drifting diff_item each)
     * @return the persisted breaks (oldest-first by creation)
     * @throws IllegalArgumentException if a break carries an invalid disposition status
     */
    @Transactional
    public List<MigrationReconciliationBreakDto> createBreaks(
            UUID runId, List<MigrationReconciliationBreakDto> breaks) {
        if (runId == null) {
            throw new IllegalArgumentException("run_id is required to create breaks");
        }
        if (breaks == null || breaks.isEmpty()) {
            return List.of();
        }
        for (MigrationReconciliationBreakDto dto : breaks) {
            validateDispositionStatus(dto.dispositionStatus());
        }
        List<MigrationReconciliationBreakEntity> entities = breaks.stream()
            .map(dto -> MigrationReconciliationBreakMapper.toNewEntity(dto, runId))
            .toList();
        List<MigrationReconciliationBreakEntity> saved = breakRepository.saveAll(entities);

        log.debug("[diag-ams] migration_reconciliation_break bulk_created runId={} count={}",
            runId, saved.size());

        return saved.stream().map(MigrationReconciliationBreakMapper::toDto).toList();
    }

    /**
     * Read all breaks for a reconcile run, oldest-first (the review-surface list
     * order).
     *
     * @param runId the reconcile run UUID
     * @return the run's breaks (possibly empty)
     */
    @Transactional(readOnly = true)
    public List<MigrationReconciliationBreakDto> getBreaksForRun(UUID runId) {
        return breakRepository.findByRunIdOrderByCreatedAtAsc(runId).stream()
            .map(MigrationReconciliationBreakMapper::toDto)
            .toList();
    }

    /**
     * PATCH a break: set the disposition / {@code bugId} / {@code attemptCount}
     * / {@code circuitBroken} / {@code needsHuman} / {@code errorDetail} /
     * {@code detailJson}. Null-guarded -- an omitted field leaves its column
     * intact (the load-bearing guard so a disposition-only PATCH never resets
     * the attempt counter or clears the bug link).
     *
     * @param breakId the break UUID
     * @param dto     the PATCH DTO (omitted fields = no-op)
     * @return the updated break
     * @throws ResourceNotFoundException if the break does not exist
     * @throws IllegalArgumentException  if a provided disposition status is invalid
     */
    @Transactional
    public MigrationReconciliationBreakDto updateBreak(
            UUID breakId, MigrationReconciliationBreakDto dto) {
        MigrationReconciliationBreakEntity entity = breakRepository.findById(breakId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Migration reconciliation break not found: " + breakId));
        if (dto != null && dto.dispositionStatus() != null) {
            validateDispositionStatus(dto.dispositionStatus());
        }
        MigrationReconciliationBreakMapper.updateEntityFromDto(entity, dto);
        MigrationReconciliationBreakEntity saved = breakRepository.save(entity);
        return MigrationReconciliationBreakMapper.toDto(saved);
    }

    /**
     * Atomically increment a break's circuit-breaker attempt counter
     * (read-modify-write under the transaction). A null counter is treated as 0.
     *
     * @param breakId the break UUID
     * @return the updated break (with the bumped counter)
     * @throws ResourceNotFoundException if the break does not exist
     */
    @Transactional
    public MigrationReconciliationBreakDto incrementAttempt(UUID breakId) {
        MigrationReconciliationBreakEntity entity = breakRepository.findById(breakId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Migration reconciliation break not found: " + breakId));
        int current = entity.getAttemptCount() != null ? entity.getAttemptCount() : 0;
        entity.setAttemptCount(current + 1);
        MigrationReconciliationBreakEntity saved = breakRepository.save(entity);
        return MigrationReconciliationBreakMapper.toDto(saved);
    }

    /**
     * Trip the circuit breaker / escalate a break to human review. Sets the
     * {@code circuit_broken} + {@code needs_human} flags and (when escalating)
     * moves the disposition to {@code circuit_broken_escalated}. Records the
     * optional escalation detail.
     *
     * @param breakId        the break UUID
     * @param circuitBroken  whether the circuit breaker tripped
     * @param needsHuman     whether the break is escalated for human review
     * @param errorDetail    optional escalation / still-broken detail (nullable)
     * @return the updated break
     * @throws ResourceNotFoundException if the break does not exist
     */
    @Transactional
    public MigrationReconciliationBreakDto setCircuitBroken(
            UUID breakId, boolean circuitBroken, boolean needsHuman, String errorDetail) {
        MigrationReconciliationBreakEntity entity = breakRepository.findById(breakId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Migration reconciliation break not found: " + breakId));
        entity.setCircuitBroken(circuitBroken);
        entity.setNeedsHuman(needsHuman);
        if (needsHuman) {
            entity.setDispositionStatus(MigrationReconciliationBreakStatus.CIRCUIT_BROKEN_ESCALATED);
        }
        if (errorDetail != null) {
            entity.setErrorDetail(errorDetail);
        }
        MigrationReconciliationBreakEntity saved = breakRepository.save(entity);
        log.debug("[diag-ams] migration_reconciliation_break circuit_breaker breakId={} circuitBroken={} needsHuman={}",
            breakId, circuitBroken, needsHuman);
        return MigrationReconciliationBreakMapper.toDto(saved);
    }

    /**
     * Stamp the {@code bug_id} on a batch of breaks and move them to
     * {@code sent_as_bug} with {@code attempt_count = 1} (the human-gated send,
     * Group 3). Only breaks that exist are updated; unknown ids are skipped.
     *
     * @param bugId    the bug-report correlation id assigned by the send
     * @param breakIds the user-selected break ids sent in this report
     * @return the updated breaks
     * @throws IllegalArgumentException if {@code bugId} is blank
     */
    @Transactional
    public List<MigrationReconciliationBreakDto> markSent(String bugId, List<UUID> breakIds) {
        if (bugId == null || bugId.isBlank()) {
            throw new IllegalArgumentException("bug_id is required to mark breaks sent");
        }
        if (breakIds == null || breakIds.isEmpty()) {
            return List.of();
        }
        List<MigrationReconciliationBreakEntity> entities = breakRepository.findAllById(breakIds);
        for (MigrationReconciliationBreakEntity entity : entities) {
            entity.setBugId(bugId);
            entity.setDispositionStatus(MigrationReconciliationBreakStatus.SENT_AS_BUG);
            entity.setAttemptCount(1);
        }
        List<MigrationReconciliationBreakEntity> saved = breakRepository.saveAll(entities);
        log.debug("[diag-ams] migration_reconciliation_break marked_sent bugId={} count={}",
            bugId, saved.size());
        return saved.stream().map(MigrationReconciliationBreakMapper::toDto).toList();
    }

    /**
     * The breaks sent under a given {@code bug_id} (the bug-fix build-results
     * callback resolution; Group 4).
     *
     * @param bugId the bug-report correlation id
     * @return the breaks linked to that bug (possibly empty)
     */
    @Transactional(readOnly = true)
    public List<MigrationReconciliationBreakDto> findBreaksByBugId(String bugId) {
        if (bugId == null || bugId.isBlank()) {
            return List.of();
        }
        return breakRepository.findByBugId(bugId).stream()
            .map(MigrationReconciliationBreakMapper::toDto)
            .toList();
    }

    /**
     * The break(s) for a replayable source operation (the CD-6 scoped-re-
     * reconcile resolution key).
     *
     * @param sourceBaselineItemId the source baseline_item UUID
     * @return the breaks for that source operation (possibly empty)
     */
    @Transactional(readOnly = true)
    public List<MigrationReconciliationBreakDto> findBreaksBySourceBaselineItemId(
            UUID sourceBaselineItemId) {
        if (sourceBaselineItemId == null) {
            return List.of();
        }
        return breakRepository.findBySourceBaselineItemId(sourceBaselineItemId).stream()
            .map(MigrationReconciliationBreakMapper::toDto)
            .toList();
    }

    // ------------------------------------------------------------------
    // Validation helper (disposition-as-TEXT, service-layer validated)
    // ------------------------------------------------------------------

    private void validateDispositionStatus(String status) {
        if (status != null && !MigrationReconciliationBreakStatus.ALL.contains(status)) {
            throw new IllegalArgumentException(
                "Invalid migration reconciliation break disposition status: " + status
                    + ". Allowed: " + MigrationReconciliationBreakStatus.ALL);
        }
    }
}
