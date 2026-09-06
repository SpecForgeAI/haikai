package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.MigrationExecutionRunItemMapper;
import com.example.architecturemodel.mapper.MigrationExecutionRunMapper;
import com.example.architecturemodel.model.dto.MigrationExecutionRunDto;
import com.example.architecturemodel.model.dto.MigrationExecutionRunItemDto;
import com.example.architecturemodel.model.entity.MigrationExecutionRunEntity;
import com.example.architecturemodel.model.entity.MigrationExecutionRunItemEntity;
import com.example.architecturemodel.model.entity.MigrationExecutionRunItemStatus;
import com.example.architecturemodel.model.entity.MigrationExecutionRunStatus;
import com.example.architecturemodel.repository.entity.MigrationExecutionRunItemRepository;
import com.example.architecturemodel.repository.entity.MigrationExecutionRunRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Service for the Migration Execution run-state persistence endpoints
 * (Task Group 1).
 *
 * <p>Wraps {@link MigrationExecutionRunRepository} and
 * {@link MigrationExecutionRunItemRepository} with the gateway-Driver-facing
 * surface (Groups 2/3/4 call these):</p>
 * <ul>
 *   <li>{@link #createRun(UUID, CreateRunRequest)} -- persist a run AND its
 *       ordered run-items atomically (records the pinned {@code kind='current'}
 *       baseline id + the {@code deploy_on_complete} markers).</li>
 *   <li>{@link #getRunState(UUID)} -- read a run + its ordered items for the
 *       run-progress view.</li>
 *   <li>{@link #getLatestRunForBook(UUID)} -- the most-recent run + items for a
 *       book of work (the dashboard's run-progress lookup).</li>
 *   <li>{@link #updateRunItem(UUID, MigrationExecutionRunItemDto)} -- PATCH a
 *       run-item (dispatched / job_id / outcome / branch / pr_url / decision-log
 *       append) with null-guarded semantics.</li>
 *   <li>{@link #updateRun(UUID, MigrationExecutionRunDto)} -- PATCH the run
 *       (status / current position / target_base_url / decision-log) with
 *       null-guarded semantics.</li>
 *   <li>{@link #findRunItemByJobId(String)} -- the build-results callback
 *       correlation lookup (Group 3).</li>
 * </ul>
 *
 * <p>Status values are service-layer validated against
 * {@link MigrationExecutionRunStatus#ALL} /
 * {@link MigrationExecutionRunItemStatus#ALL} (no DB enum, matching the AMS
 * status-as-TEXT convention). The mappers own the null-guarded PATCH semantics
 * (boxed reference types per {@code project_primitive_double_dto_overwrite.md}).</p>
 *
 * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class MigrationExecutionRunService {

    private final MigrationExecutionRunRepository runRepository;
    private final MigrationExecutionRunItemRepository runItemRepository;

    /**
     * Create-run request: the run header DTO plus the ordered per-spec
     * run-items. The Driver (Group 2) builds the items from the
     * {@code (depth, sequenceOrder)} walk of {@code book_of_work_json} (CD-5),
     * marking only the FINAL item {@code deploy_on_complete=true}.
     *
     * @param run   the run header (book_of_work_id, status, pinned baseline id)
     * @param items the ordered run-items (one per dispatched spec)
     */
    public record CreateRunRequest(
        MigrationExecutionRunDto run,
        List<MigrationExecutionRunItemDto> items
    ) {}

    /**
     * Persist a run AND its ordered run-items atomically. The {@code projectId}
     * comes from the URL path and overrides whatever the DTO carries. Each
     * run-item is bound to the freshly-created run id (never the DTO body's
     * {@code run_id}).
     *
     * @param projectId the owning project UUID (from the URL path)
     * @param request   the run header + ordered items
     * @return the persisted run with its ordered items populated
     * @throws IllegalArgumentException if the run / an item carries an invalid status
     */
    @Transactional
    public MigrationExecutionRunDto createRun(UUID projectId, CreateRunRequest request) {
        if (request == null || request.run() == null) {
            throw new IllegalArgumentException("Create-run request and its run header are required");
        }
        MigrationExecutionRunDto runDto = request.run();
        if (runDto.bookOfWorkId() == null) {
            throw new IllegalArgumentException("book_of_work_id is required to create a run");
        }
        validateRunStatus(runDto.status());

        MigrationExecutionRunEntity runEntity =
            MigrationExecutionRunMapper.toNewEntity(runDto, projectId);
        if (runEntity.getStatus() == null) {
            runEntity.setStatus(MigrationExecutionRunStatus.STARTED);
        }
        MigrationExecutionRunEntity savedRun = runRepository.save(runEntity);

        List<MigrationExecutionRunItemEntity> savedItems;
        if (request.items() == null || request.items().isEmpty()) {
            savedItems = List.of();
        } else {
            for (MigrationExecutionRunItemDto itemDto : request.items()) {
                validateRunItemStatus(itemDto.status());
            }
            List<MigrationExecutionRunItemEntity> itemEntities = request.items().stream()
                .map(itemDto -> {
                    MigrationExecutionRunItemEntity e =
                        MigrationExecutionRunItemMapper.toNewEntity(itemDto, savedRun.getId());
                    if (e.getStatus() == null) {
                        e.setStatus(MigrationExecutionRunItemStatus.PENDING);
                    }
                    return e;
                })
                .toList();
            savedItems = runItemRepository.saveAll(itemEntities);
        }

        log.debug("[diag-ams] migration_execution_run created runId={} bookOfWorkId={} items={}",
            savedRun.getId(), savedRun.getBookOfWorkId(), savedItems.size());

        return MigrationExecutionRunMapper.toDtoWithItems(savedRun, savedItems);
    }

    /**
     * Read a run + its ordered items for the run-progress view.
     *
     * @param runId the run UUID
     * @return the run with ordered items populated
     * @throws ResourceNotFoundException if the run does not exist
     */
    @Transactional(readOnly = true)
    public MigrationExecutionRunDto getRunState(UUID runId) {
        MigrationExecutionRunEntity run = runRepository.findById(runId)
            .orElseThrow(() -> new ResourceNotFoundException("Migration execution run not found: " + runId));
        List<MigrationExecutionRunItemEntity> items =
            runItemRepository.findByRunIdOrderBySequencePositionAsc(runId);
        return MigrationExecutionRunMapper.toDtoWithItems(run, items);
    }

    /**
     * The most-recent run + its ordered items for a book of work (the
     * dashboard's run-progress lookup). Returns {@link Optional#empty()} when no
     * run has been kicked off for the book yet.
     *
     * @param bookOfWorkId the book-of-work UUID
     * @return the latest run with items, or empty
     */
    @Transactional(readOnly = true)
    public Optional<MigrationExecutionRunDto> getLatestRunForBook(UUID bookOfWorkId) {
        List<MigrationExecutionRunEntity> runs =
            runRepository.findByBookOfWorkIdOrderByCreatedAtDesc(bookOfWorkId);
        if (runs.isEmpty()) {
            return Optional.empty();
        }
        MigrationExecutionRunEntity latest = runs.get(0);
        List<MigrationExecutionRunItemEntity> items =
            runItemRepository.findByRunIdOrderBySequencePositionAsc(latest.getId());
        return Optional.of(MigrationExecutionRunMapper.toDtoWithItems(latest, items));
    }

    /**
     * PATCH a run-item: set {@code dispatched} / {@code job_id} / {@code outcome}
     * / {@code branch} / {@code pr_url} / {@code status} / append to the inline
     * decision log. Null-guarded -- an omitted field leaves its column intact
     * (the load-bearing guard for the Driver's per-spec advance).
     *
     * @param runItemId the run-item UUID
     * @param dto       the PATCH DTO (omitted fields = no-op)
     * @return the updated run-item
     * @throws ResourceNotFoundException if the run-item does not exist
     * @throws IllegalArgumentException  if a provided status is invalid
     */
    @Transactional
    public MigrationExecutionRunItemDto updateRunItem(UUID runItemId, MigrationExecutionRunItemDto dto) {
        MigrationExecutionRunItemEntity entity = runItemRepository.findById(runItemId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Migration execution run-item not found: " + runItemId));
        if (dto != null && dto.status() != null) {
            validateRunItemStatus(dto.status());
        }
        MigrationExecutionRunItemMapper.updateEntityFromDto(entity, dto);
        MigrationExecutionRunItemEntity saved = runItemRepository.save(entity);
        return MigrationExecutionRunItemMapper.toDto(saved);
    }

    /**
     * PATCH the run: set {@code status} / {@code currentSequencePosition} /
     * {@code targetBaseUrl} / append to the run-level decision log. Null-guarded.
     *
     * @param runId the run UUID
     * @param dto   the PATCH DTO (omitted fields = no-op)
     * @return the updated run (header only; no nested items)
     * @throws ResourceNotFoundException if the run does not exist
     * @throws IllegalArgumentException  if a provided status is invalid
     */
    @Transactional
    public MigrationExecutionRunDto updateRun(UUID runId, MigrationExecutionRunDto dto) {
        MigrationExecutionRunEntity entity = runRepository.findById(runId)
            .orElseThrow(() -> new ResourceNotFoundException("Migration execution run not found: " + runId));
        if (dto != null && dto.status() != null) {
            validateRunStatus(dto.status());
        }
        MigrationExecutionRunMapper.updateEntityFromDto(entity, dto);
        MigrationExecutionRunEntity saved = runRepository.save(entity);
        return MigrationExecutionRunMapper.toDto(saved);
    }

    /**
     * The run-item correlated to an orchestration {@code job_id} (the
     * build-results callback correlation key, Group 3). Returns
     * {@link Optional#empty()} for an unknown {@code job_id} -- the door maps
     * that to {@code 404}.
     *
     * <p>Batch-aware (2026-09-06): a batch migrate shares one job_id across N
     * run-items, so the repository returns a list and this method answers the
     * FIRST by sequence position. One item is sufficient for the caller -- the
     * gateway driver uses it only to resolve the run, then re-derives the
     * sibling set from the run's items by job_id -- and the ordering makes the
     * answer deterministic instead of row-order dependent. The
     * {@link Optional} contract (200/404 on the controller) is unchanged.</p>
     *
     * @param jobId the orchestration job id
     * @return the lowest-sequence run-item DTO carrying the job_id, or empty
     */
    @Transactional(readOnly = true)
    public Optional<MigrationExecutionRunItemDto> findRunItemByJobId(String jobId) {
        if (jobId == null || jobId.isBlank()) {
            return Optional.empty();
        }
        return runItemRepository.findByJobIdOrderBySequencePositionAsc(jobId)
            .stream()
            .findFirst()
            .map(MigrationExecutionRunItemMapper::toDto);
    }

    /**
     * CROSS-project in-flight run list (changeset 219, 2026-08-07): every run
     * whose status is {@code started} or {@code dispatching}, newest first —
     * the gateway boot-recovery sweep's discovery source. Header shape only
     * (no nested items); the sweep reads full run-state per run afterwards.
     * {@code awaiting_approval} is deliberately EXCLUDED: that run is paused
     * for a human, nothing is stuck.
     *
     * @return in-flight run headers, newest first
     */
    @Transactional(readOnly = true)
    public List<MigrationExecutionRunDto> listInFlightRuns() {
        return runRepository
            .findByStatusInOrderByCreatedAtDesc(List.of(
                MigrationExecutionRunStatus.STARTED,
                MigrationExecutionRunStatus.DISPATCHING))
            .stream()
            .map(MigrationExecutionRunMapper::toDto)
            .toList();
    }

    /**
     * ALL runs for a book of work WITH their ordered items, newest first
     * (2026-08-07): the gateway driver's plane-aware precedence needs the full
     * run history of a book (which planes already deployed in earlier stage
     * runs), not just the latest run.
     *
     * @param bookOfWorkId the book-of-work UUID
     * @return runs with items, newest first (empty list when none)
     */
    @Transactional(readOnly = true)
    public List<MigrationExecutionRunDto> getRunsForBook(UUID bookOfWorkId) {
        return runRepository.findByBookOfWorkIdOrderByCreatedAtDesc(bookOfWorkId)
            .stream()
            .map(run -> MigrationExecutionRunMapper.toDtoWithItems(
                run,
                runItemRepository.findByRunIdOrderBySequencePositionAsc(run.getId())))
            .toList();
    }

    // ------------------------------------------------------------------
    // Validation helpers (status-as-TEXT, service-layer validated)
    // ------------------------------------------------------------------

    private void validateRunStatus(String status) {
        if (status != null && !MigrationExecutionRunStatus.ALL.contains(status)) {
            throw new IllegalArgumentException(
                "Invalid migration execution run status: " + status
                    + ". Allowed: " + MigrationExecutionRunStatus.ALL);
        }
    }

    private void validateRunItemStatus(String status) {
        if (status != null && !MigrationExecutionRunItemStatus.ALL.contains(status)) {
            throw new IllegalArgumentException(
                "Invalid migration execution run-item status: " + status
                    + ". Allowed: " + MigrationExecutionRunItemStatus.ALL);
        }
    }
}
