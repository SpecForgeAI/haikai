package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.GeneratedMigrationBookOfWorkMapper;
import com.example.architecturemodel.model.dto.AppendGeneratedMigrationBookOfWorkItemsRequest;
import com.example.architecturemodel.model.dto.GeneratedMigrationBookOfWorkDto;
import com.example.architecturemodel.model.dto.AppendTestItemRequest;
import com.example.architecturemodel.model.dto.AppendTestItemResponse;
import com.example.architecturemodel.model.dto.AppendCapabilityStoryRequest;
import com.example.architecturemodel.model.dto.AppendCapabilityStoryResponse;
import com.example.architecturemodel.model.dto.AddWorkItemRequest;
import com.example.architecturemodel.model.dto.AddWorkItemResponse;
import com.example.architecturemodel.model.dto.AmendBookItemRequest;
import com.example.architecturemodel.model.dto.AmendBookItemResponse;
import com.example.architecturemodel.model.dto.CiteFindingRequest;
import com.example.architecturemodel.model.dto.CiteFindingResponse;
import com.example.architecturemodel.model.dto.RepairOrphanItemResponse;
import com.example.architecturemodel.model.dto.SaveGeneratedMigrationBookOfWorkRequest;
import com.example.architecturemodel.model.dto.SaveGeneratedMigrationBookOfWorkResponse;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkEntity;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkStatus;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Service for managing {@link GeneratedMigrationBookOfWorkEntity} rows --
 * the AMS persistence half of the Product Manager Migration Delivery Plan flow.
 *
 * <p>Provides four CRUD operations plus the {@code save-to-backlog} action:</p>
 * <ul>
 *   <li>{@link #createDraft(UUID, GeneratedMigrationBookOfWorkDto)} -- insert a
 *       new draft. Implements <b>Q-6 regenerate-on-same-tuple</b>: any prior
 *       active draft for the
 *       {@code (projectId, currentArchitectureId, targetArchitectureId)}
 *       tuple is auto-archived BEFORE the new row is inserted.</li>
 *   <li>{@link #listDrafts(UUID, boolean)} -- list drafts; defaults to active
 *       only ({@code status NOT IN {archived, failed}}).</li>
 *   <li>{@link #getDraft(UUID, UUID)} -- single-row fetch scoped to project.</li>
 *   <li>{@link #updateDraft(UUID, UUID, GeneratedMigrationBookOfWorkDto)} --
 *       PATCH-style update. Null-guarded per
 *       {@code project_primitive_double_dto_overwrite.md}.</li>
 *   <li>{@link #saveToBacklog(UUID, UUID, SaveGeneratedMigrationBookOfWorkRequest)} --
 *       per-item-commit save into {@code work_item}.</li>
 *   <li>{@link #appendItems(UUID, UUID, AppendGeneratedMigrationBookOfWorkItemsRequest)} --
 *       single-transaction server-side merge of one epic's phase-2 expansion
 *       items + expansion state into {@code book_of_work_json} (spec
 *       2026-06-11 Two-Phase Migration Delivery Plan Generation, Task
 *       Group 2). NO schema change.</li>
 * </ul>
 *
 * <p><b>Persistence design-point references:</b></p>
 * <ul>
 *   <li><b>Q-5 -- per-item commit.</b> Each item in
 *       {@link #saveToBacklog(UUID, UUID, SaveGeneratedMigrationBookOfWorkRequest)}
 *       is persisted in its own transaction via {@link GeneratedMigrationBookOfWorkItemSaver}
 *       (the inner {@code @Service} bean below), whose
 *       {@code saveOneItem(...)} method is annotated
 *       {@code @Transactional(propagation = REQUIRES_NEW)}. A separate Spring
 *       bean is required (rather than an inline private method) because Spring
 *       transactional proxies do not apply on self-invocation; calling
 *       {@code saveOneItem} via the injected proxy is what gives us the
 *       per-item commit boundary. Per-item failures are captured as
 *       {@code saveState='failed'} on that single item and do not abort the
 *       overall save.</li>
 *   <li><b>Q-6 -- archive-on-regenerate.</b> {@link #createDraft} archives any
 *       prior active draft on the same tuple before inserting the new row, so
 *       the "active" set per tuple has at most one row.</li>
 *   <li><b>Q-8 -- save filter modes + parent-inclusion rule.</b> The
 *       {@code mode} parameter accepts
 *       {@code all | selected | high_confidence_only | ready_for_spec_only}.
 *       Whichever items the filter selects, every saved item's ancestor chain
 *       (parent feature -> parent epic -> parent initiative) is also included
 *       so the backlog never gets orphans. The frontend dialog previews
 *       parent-inclusive counts before the user confirms.</li>
 *   <li><b>Q-10 -- idempotent additive tags.</b> Re-running save-to-backlog
 *       on an item already at {@code saveState='saved'} is a no-op; running it
 *       against items whose target backlog row already exists yields ADDITIVE
 *       tag merges (existing tags preserved; new prefix-namespaced tags
 *       appended; duplicates collapsed). Backlog rows are never overwritten.</li>
 *   <li><b>Q-14 -- four sibling JSONB columns.</b> The entity carries four
 *       independent nullable JSONB columns: {@code generation_inputs_json},
 *       {@code generation_summary_json}, {@code quality_assessment_json},
 *       {@code book_of_work_json}. Only {@code book_of_work_json} is editable
 *       post-create (PATCH-style via {@link #updateDraft}); the other three
 *       are immutable inputs/snapshots produced at generation time.</li>
 *   <li><b>Addition B (spec 2026-05-19 Migration Delivery Dashboard,
 *       AC 14) -- workItemId writeback.</b> Inside the same
 *       {@code @Transactional} boundary as the {@link WorkItemEntity} create,
 *       the in-memory {@code book_of_work_json.items[]} payload is mutated to
 *       stamp {@code workItemId} on each persisted item, then the
 *       {@link GeneratedMigrationBookOfWorkEntity} is re-saved so JPA flushes
 *       the updated JSONB. The dashboard read-side joins WorkItem rows
 *       strictly by this stored id (never by title), so the writeback is
 *       load-bearing for the dashboard's WorkItem linkage. Every sibling
 *       field on each item -- including any boxed {@code Double / Long /
 *       Boolean} values -- is preserved verbatim. A dedicated structured log
 *       line with the {@code [diag-ams] delivery_dashboard ...} prefix is
 *       emitted on each save-to-backlog completion so the dashboard slice
 *       has its own discoverable log surface.</li>
 * </ul>
 *
 * <p>Modeled structurally on {@link DiscoveryRunService}; identical
 * {@code @ConditionalOnProperty} guard so the bean is omitted when the
 * lightweight no-database profile is active.</p>
 *
 * <p>Structured diagnostic log lines use the {@code [diag-ams] book_of_work ...}
 * prefix declared in the spec, with a single additional
 * {@code [diag-ams] delivery_dashboard ...} line emitted by the Addition B
 * writeback path so it can be traced through the dashboard slice.</p>
 *
 * <p>Spec: Product Manager Migration Delivery Plan + Draft Book-of-Work
 * Generation (2026-05-17) --
 * {@code agent-os/specs/2026-05-17-pm-migration-delivery-plan-book-of-work-draft/spec.md}.
 * Task Groups 7 + 8.</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * {@code agent-os/specs/2026-05-19-migration-delivery-progress-and-evidence-tracking/spec.md}.
 * Task Group 1 (Addition B writeback + delivery_dashboard log line).</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class GeneratedMigrationBookOfWorkService {

    private final GeneratedMigrationBookOfWorkRepository repository;
    private final WorkItemRepository workItemRepository;
    private final GeneratedMigrationBookOfWorkItemSaver itemSaver;
    private final MigrationStorySpecGenerationRepository specGenerationRepository;

    /**
     * Default status applied to created {@code work_item} rows when the caller
     * does not specify one. Matches the existing {@code WorkItemEntity} default
     * (see {@code WorkItemEntity.status}).
     */
    private static final String DEFAULT_WORK_ITEM_STATUS = "PLANNED";

    /**
     * Set of save-mode strings accepted by
     * {@link #saveToBacklog(UUID, UUID, SaveGeneratedMigrationBookOfWorkRequest)}.
     */
    private static final Set<String> ALLOWED_SAVE_MODES = Set.of(
        SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL,
        SaveGeneratedMigrationBookOfWorkRequest.MODE_SELECTED,
        SaveGeneratedMigrationBookOfWorkRequest.MODE_HIGH_CONFIDENCE_ONLY,
        SaveGeneratedMigrationBookOfWorkRequest.MODE_READY_FOR_SPEC_ONLY
    );

    /**
     * Allowed {@code provenance} values for the D5 add-item endpoint
     * ({@link #addItem(UUID, UUID, AddWorkItemRequest)}). Validated at the
     * service layer; the {@code work_item.provenance} column itself stays a
     * plain VARCHAR (no DB enum/CHECK), matching the AMS status-as-string
     * convention. Spec: D5 -- Net-new backlog items + provenance.
     */
    private static final Set<String> ALLOWED_PROVENANCE = Set.of(
        WorkItemEntity.PROVENANCE_CARRY_OVER,
        WorkItemEntity.PROVENANCE_NET_NEW
    );

    /**
     * Allowed {@code kind} prompt-flavour values for the D5 add-item endpoint.
     * The flavour only tunes the gateway's downstream description-grounded
     * spec-gen prompt orientation (API-endpoint vs operational-effect-test); it
     * is NOT a {@code work_item} type and is NOT persisted as a column -- it
     * rides the blob item. Spec: D5 -- Net-new backlog items + provenance.
     */
    private static final Set<String> ALLOWED_KINDS = Set.of(
        AddWorkItemRequest.KIND_API,
        AddWorkItemRequest.KIND_OPERATIONAL
    );

    // -----------------------------------------------------------------
    // CRUD -- Task Group 7
    // -----------------------------------------------------------------

    /**
     * Create a new draft for the given project. Implements the Q-6
     * regenerate-on-same-tuple archive flow: any active draft for the
     * {@code (projectId, currentArchitectureId, targetArchitectureId)} tuple
     * is auto-transitioned to {@code status='archived'} BEFORE the new row is
     * inserted, so the invariant "at most one active draft per tuple" holds.
     *
     * <p>The new row is created with {@code status='draft'} regardless of what
     * the caller sends, unless they explicitly provided a different status (e.g.
     * for tests that need to seed a {@code reviewed} row); the controller layer
     * does NOT pass status through on create in the canonical flow.</p>
     *
     * @param projectId the project UUID
     * @param request the create-request DTO (status defaulted to draft if null)
     * @return the persisted draft as a DTO
     * @throws IllegalArgumentException if the request is null
     */
    @Transactional
    public GeneratedMigrationBookOfWorkDto createDraft(
        UUID projectId, GeneratedMigrationBookOfWorkDto request) {
        if (projectId == null) {
            throw new IllegalArgumentException("projectId is required");
        }
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }

        UUID archivedDraftId = null;
        if (request.currentArchitectureId() != null && request.targetArchitectureId() != null) {
            Optional<GeneratedMigrationBookOfWorkEntity> prior = repository.findActiveDraftForTuple(
                projectId, request.currentArchitectureId(), request.targetArchitectureId());
            if (prior.isPresent()) {
                GeneratedMigrationBookOfWorkEntity priorEntity = prior.get();
                priorEntity.setStatus(GeneratedMigrationBookOfWorkStatus.ARCHIVED);
                priorEntity.setUpdatedAt(Instant.now());
                repository.save(priorEntity);
                archivedDraftId = priorEntity.getId();
                log.info(
                    "[diag-ams] book_of_work stage=archive projectId={} draftId={} reason=regenerate_same_tuple",
                    projectId, archivedDraftId);
            }
        }

        GeneratedMigrationBookOfWorkEntity entity =
            GeneratedMigrationBookOfWorkMapper.toNewEntity(request, projectId);
        GeneratedMigrationBookOfWorkEntity saved = repository.save(entity);
        log.info(
            "[diag-ams] book_of_work stage=create projectId={} draftId={} archivedDraftId={}",
            projectId, saved.getId(), archivedDraftId);
        return GeneratedMigrationBookOfWorkMapper.toDto(saved);
    }

    /**
     * List drafts for a project.
     *
     * @param projectId the project UUID
     * @param includeArchived when {@code true}, include archived rows; when
     *     {@code false} (the default), return only active rows (status not in
     *     {@code {archived}})
     * @return list of DTOs, newest first
     */
    @Transactional(readOnly = true)
    public List<GeneratedMigrationBookOfWorkDto> listDrafts(UUID projectId, boolean includeArchived) {
        if (projectId == null) {
            throw new IllegalArgumentException("projectId is required");
        }
        List<GeneratedMigrationBookOfWorkEntity> rows;
        if (includeArchived) {
            rows = repository.findByProjectIdOrderByCreatedAtDesc(projectId);
        } else {
            // ACTIVE excludes only 'archived' per spec.md ("Defaults to active drafts
            // (status not in {archived})"); failed rows remain visible by default.
            Collection<String> activeStatuses = Set.of(
                GeneratedMigrationBookOfWorkStatus.DRAFT,
                GeneratedMigrationBookOfWorkStatus.REVIEWED,
                GeneratedMigrationBookOfWorkStatus.PARTIALLY_SAVED,
                GeneratedMigrationBookOfWorkStatus.SAVED,
                GeneratedMigrationBookOfWorkStatus.FAILED
            );
            rows = repository.findByProjectIdAndStatusInOrderByCreatedAtDesc(projectId, activeStatuses);
        }
        return rows.stream().map(GeneratedMigrationBookOfWorkMapper::toDto).toList();
    }

    /**
     * Get a single draft by id, scoped to the project.
     *
     * @param projectId the project UUID
     * @param bookId the draft UUID
     * @return the DTO
     * @throws ResourceNotFoundException if the draft does not exist or belongs
     *     to a different project (the 404 path collapses cross-project leakage
     *     into "not found")
     */
    @Transactional(readOnly = true)
    public GeneratedMigrationBookOfWorkDto getDraft(UUID projectId, UUID bookId) {
        GeneratedMigrationBookOfWorkEntity entity = requireDraft(projectId, bookId);
        return GeneratedMigrationBookOfWorkMapper.toDto(entity);
    }

    /**
     * Apply a PATCH-style update to a draft. Fields that are {@code null} on the
     * DTO leave the existing column untouched (per
     * {@code project_primitive_double_dto_overwrite.md}). Editable fields are
     * declared on {@link GeneratedMigrationBookOfWorkMapper#updateEntityFromDto(
     * GeneratedMigrationBookOfWorkEntity, GeneratedMigrationBookOfWorkDto)}.
     *
     * @param projectId the project UUID
     * @param bookId the draft UUID
     * @param patch the PATCH DTO
     * @return the updated DTO
     * @throws ResourceNotFoundException if the draft does not exist
     * @throws IllegalArgumentException if {@code patch.status()} is non-null and
     *     not in {@link GeneratedMigrationBookOfWorkStatus#ALL}
     */
    @Transactional
    public GeneratedMigrationBookOfWorkDto updateDraft(
        UUID projectId, UUID bookId, GeneratedMigrationBookOfWorkDto patch) {
        if (patch == null) {
            throw new IllegalArgumentException("request body is required");
        }
        if (patch.status() != null && !GeneratedMigrationBookOfWorkStatus.ALL.contains(patch.status())) {
            throw new IllegalArgumentException(
                "Invalid status '" + patch.status() + "'; allowed values: "
                    + GeneratedMigrationBookOfWorkStatus.ALL);
        }
        GeneratedMigrationBookOfWorkEntity entity = requireDraft(projectId, bookId);
        GeneratedMigrationBookOfWorkMapper.updateEntityFromDto(entity, patch);
        entity.setUpdatedAt(Instant.now());
        GeneratedMigrationBookOfWorkEntity saved = repository.save(entity);
        log.info(
            "[diag-ams] book_of_work stage=update projectId={} draftId={} status={}",
            projectId, bookId, saved.getStatus());
        return GeneratedMigrationBookOfWorkMapper.toDto(saved);
    }

    // -----------------------------------------------------------------
    // save-to-backlog -- Task Group 8
    // -----------------------------------------------------------------

    /**
     * Save the admitted items from a draft's {@code book_of_work_json} into the
     * {@code work_item} table. Per-item commit per Q-5: each save runs in its
     * own transaction (delegated to {@link GeneratedMigrationBookOfWorkItemSaver})
     * so a single failure cannot abort the whole batch.
     *
     * <p>Behaviour summary (spec.md AMS section + Q-5 / Q-8 / Q-10):</p>
     * <ul>
     *   <li>Apply the save-mode filter ({@code all | selected |
     *       high_confidence_only | ready_for_spec_only}). Parent-inclusion rule:
     *       when a child item passes the filter, its ancestor chain is
     *       auto-included.</li>
     *   <li>Skip items already at {@code saveState='saved'} (idempotent re-run).</li>
     *   <li>Skip items in {@code excludedItemIds}.</li>
     *   <li>For each admitted item: create a {@code work_item} row with
     *       {@code parentId} resolved against the saved parent in the same
     *       batch, {@code status = request.statusForCreatedItems} (default
     *       {@code PLANNED}), tags additive per Q-10.</li>
     *   <li>If {@code includeTraceabilityInDescription} or
     *       {@code includeReadinessInDescription}, append a concise section to
     *       the saved description with a stable marker.</li>
     *   <li>On success: mark the draft item with {@code saveState='saved'} +
     *       {@code workItemId}.</li>
     *   <li>On failure: mark the draft item with {@code saveState='failed'} +
     *       {@code errorMessage}; continue.</li>
     *   <li>Persist the mutated {@code book_of_work_json} back to the draft.</li>
     *   <li>Reconcile draft status: all-success -> {@code saved}, mixed ->
     *       {@code partially_saved}, all-fail -> draft status unchanged +
     *       {@code error_message} populated.</li>
     * </ul>
     *
     * <p><b>Addition B (Migration Delivery Dashboard spec 2026-05-19, AC 14).</b>
     * The {@code workItemId} writeback into {@code book_of_work_json.items[]}
     * occurs inside this same {@code @Transactional} boundary as the WorkItem
     * inserts (delegated through {@link GeneratedMigrationBookOfWorkItemSaver}).
     * On any per-item failure the {@code workItemId} for that item is left
     * absent; on outer-transaction rollback (e.g. {@link WorkItemRepository}
     * blows up mid-batch) both the WorkItem inserts AND the {@code book_of_work_json}
     * mutation are rolled back atomically by Spring's transaction manager,
     * keeping the draft and backlog in sync. The dashboard's join is then
     * exclusively by stored {@code workItemId} -- title-matching is forbidden
     * by the spec because it cannot survive a backlog rename.</p>
     *
     * @param projectId the project UUID
     * @param bookId the draft UUID
     * @param request the request body
     * @return the post-save response
     * @throws ResourceNotFoundException if the draft does not exist
     * @throws IllegalArgumentException if {@code saveMode} is not in
     *     {@link #ALLOWED_SAVE_MODES}
     */
    @Transactional
    public SaveGeneratedMigrationBookOfWorkResponse saveToBacklog(
        UUID projectId, UUID bookId, SaveGeneratedMigrationBookOfWorkRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        String saveMode = request.saveMode();
        if (saveMode == null || !ALLOWED_SAVE_MODES.contains(saveMode)) {
            throw new IllegalArgumentException(
                "Invalid save_mode '" + saveMode + "'; allowed: " + ALLOWED_SAVE_MODES);
        }
        GeneratedMigrationBookOfWorkEntity draft = requireDraft(projectId, bookId);

        // Build a mutable working copy of book_of_work_json so we can stamp
        // saveState + workItemId per item without mutating shared state.
        Map<String, Object> bookOfWork = draft.getBookOfWorkJson();
        if (bookOfWork == null) {
            bookOfWork = new LinkedHashMap<>();
        } else {
            bookOfWork = new LinkedHashMap<>(bookOfWork);
        }
        List<Map<String, Object>> extractedItems = extractItems(bookOfWork);
        final List<Map<String, Object>> items = extractedItems != null ? extractedItems : new ArrayList<>();

        Set<String> excludedIds = toIdSet(request.excludedItemIds());
        Set<String> selectedIds = toIdSet(request.selectedItemIds());

        // Phase 1: decide which items are admitted (filter + parent-inclusion)
        Set<String> admittedIds = computeAdmittedIds(items, saveMode, selectedIds, excludedIds);

        // Phase 2: stable iteration order honouring sequenceOrder for
        // hierarchy fidelity (Q-5/Q-8: parents persist before children).
        List<Map<String, Object>> orderedItems = new ArrayList<>(items);
        orderedItems.sort((a, b) -> {
            int da = depthOf(a, items);
            int db = depthOf(b, items);
            if (da != db) return Integer.compare(da, db);
            Integer sa = sequenceOrderOf(a);
            Integer sb = sequenceOrderOf(b);
            int saVal = sa != null ? sa : Integer.MAX_VALUE;
            int sbVal = sb != null ? sb : Integer.MAX_VALUE;
            return Integer.compare(saVal, sbVal);
        });

        // Maps draft-item id -> newly-created work_item id (used to resolve
        // child parentId references against in-batch parents).
        Map<String, UUID> savedIdMap = new HashMap<>();
        // Maps draft-item id -> the mutated item object so the writer can stamp
        // saveState / workItemId / errorMessage in place.
        Map<String, Map<String, Object>> itemById = new HashMap<>();
        for (Map<String, Object> it : items) {
            String id = stringField(it, "id");
            if (id != null) {
                itemById.put(id, it);
            }
        }

        // Counters per type plus an overall bucket.
        Map<String, Map<String, Integer>> countsByType = new LinkedHashMap<>();
        List<Map<String, Object>> failedItems = new ArrayList<>();

        log.info(
            "[diag-ams] book_of_work stage=save_to_backlog_start draftId={} saveMode={} selected={} excluded={}",
            bookId, saveMode,
            selectedIds.size(), excludedIds.size());

        int savedCount = 0;
        int failedCount = 0;
        int skippedAlreadySavedCount = 0;
        int skippedNotAdmittedCount = 0;
        // Addition B (spec 2026-05-19): count items that received a fresh
        // workItemId stamp in this invocation so the structured log can
        // confirm the writeback happened in the same transaction.
        int workItemIdPersistedCount = 0;

        for (Map<String, Object> item : orderedItems) {
            String itemId = stringField(item, "id");
            if (itemId == null) {
                continue;
            }
            String type = stringField(item, "type");
            // Idempotent skip: re-running save-to-backlog skips already-saved items
            // per Q-5. The work_item is not re-created; the existing workItemId is
            // preserved on the draft.
            if ("saved".equals(stringField(item, "saveState"))) {
                skippedAlreadySavedCount++;
                bumpCount(countsByType, type, "skipped");
                log.info(
                    "[diag-ams] book_of_work stage=save_item_skip_already_saved draftId={} itemId={}",
                    bookId, itemId);
                // Capture existing workItemId so child resolution still finds it.
                Object existing = item.get("workItemId");
                if (existing instanceof String s) {
                    try {
                        savedIdMap.put(itemId, UUID.fromString(s));
                    } catch (IllegalArgumentException ignore) {
                        // legacy non-UUID workItemId on the blob -- ignore for resolution
                    }
                }
                continue;
            }
            if (!admittedIds.contains(itemId)) {
                skippedNotAdmittedCount++;
                continue;
            }

            // Resolve in-batch parent reference (if any) to the newly-created
            // work_item id; if the parent is not in the batch yet, fall back
            // to the raw parentId on the item (which is a draft-item id, not a
            // work_item id -- typically null in that case).
            String draftParentId = stringField(item, "parentId");
            UUID resolvedParentId = null;
            if (draftParentId != null && savedIdMap.containsKey(draftParentId)) {
                resolvedParentId = savedIdMap.get(draftParentId);
            }

            try {
                UUID newWorkItemId = itemSaver.persistOne(
                    projectId,
                    item,
                    resolvedParentId,
                    request);
                // Addition B (Migration Delivery Dashboard spec, AC 14):
                // stamp workItemId on the draft item AS PART of this same
                // outer transaction. Every sibling field on the item (e.g.
                // confidence, readiness, sequenceOrder, traceabilitySummary,
                // any boxed Double / Long / Boolean values) is left in place
                // verbatim -- LinkedHashMap.put on a fresh key appends; on an
                // existing key it replaces only that key.
                item.put("saveState", "saved");
                item.put("workItemId", newWorkItemId.toString());
                item.remove("errorMessage");
                savedIdMap.put(itemId, newWorkItemId);
                savedCount++;
                workItemIdPersistedCount++;
                bumpCount(countsByType, type, "saved");
                log.info(
                    "[diag-ams] book_of_work stage=save_item_ok draftId={} itemId={} workItemId={}",
                    bookId, itemId, newWorkItemId);
            } catch (RuntimeException e) {
                item.put("saveState", "failed");
                item.put("errorMessage", e.getMessage());
                Map<String, Object> failed = new LinkedHashMap<>();
                failed.put("itemId", itemId);
                failed.put("errorMessage", e.getMessage());
                failedItems.add(failed);
                failedCount++;
                bumpCount(countsByType, type, "failed");
                log.warn(
                    "[diag-ams] book_of_work stage=save_item_fail draftId={} itemId={} reason={}",
                    bookId, itemId, e.getMessage());
                // Continue with the next item per Q-5 -- per-item failure does not
                // abort the batch.
            }
        }

        // Persist the mutated book_of_work_json back to the draft.
        bookOfWork.put("items", items);
        draft.setBookOfWorkJson(bookOfWork);

        // Final draft status reconciliation per spec.md.
        int admittedTotal = admittedIds.size();
        if (admittedTotal > 0) {
            if (failedCount == 0) {
                draft.setStatus(GeneratedMigrationBookOfWorkStatus.SAVED);
                draft.setSavedToBacklogAt(Instant.now());
                draft.setErrorMessage(null);
            } else if (savedCount == 0 && skippedAlreadySavedCount == 0) {
                // All admitted items failed -- draft remains at prior status per spec,
                // but the error_message is populated so the reviewer sees the failure
                // surface.
                draft.setErrorMessage(
                    "save-to-backlog: all " + failedCount + " admitted items failed");
            } else {
                draft.setStatus(GeneratedMigrationBookOfWorkStatus.PARTIALLY_SAVED);
                draft.setSavedToBacklogAt(Instant.now());
                draft.setErrorMessage(
                    "save-to-backlog: " + savedCount + " saved, " + failedCount + " failed");
            }
        }
        draft.setUpdatedAt(Instant.now());
        repository.save(draft);

        Map<String, Object> countsTotal = new LinkedHashMap<>();
        countsTotal.put("saved", savedCount);
        countsTotal.put("failed", failedCount);
        countsTotal.put("skipped_already_saved", skippedAlreadySavedCount);
        countsTotal.put("skipped_not_admitted", skippedNotAdmittedCount);
        countsTotal.put("admitted", admittedTotal);
        countsTotal.put("by_type", countsByType);

        log.info(
            "[diag-ams] book_of_work stage=save_to_backlog_complete draftId={} saved={} failed={} skipped={} status={}",
            bookId, savedCount, failedCount,
            (skippedAlreadySavedCount + skippedNotAdmittedCount), draft.getStatus());
        // Addition B (Migration Delivery Dashboard spec 2026-05-19, Task
        // Group 1.3): structured log line emitted from the dashboard-slice
        // prefix so the writeback is independently traceable for the
        // dashboard's delivery_dashboard log namespace.
        log.info(
            "[diag-ams] delivery_dashboard save_to_backlog workItemId_persisted bookId={} itemCount={}",
            bookId, workItemIdPersistedCount);

        return new SaveGeneratedMigrationBookOfWorkResponse(
            bookId.toString(),
            draft.getStatus(),
            countsTotal,
            bookOfWork,
            failedItems
        );
    }

    /**
     * Repair a single orphan book item by clearing its stale
     * {@code workItemId} and re-attempting save-to-backlog for that one item.
     *
     * <p>An item is "orphan" when {@code book_of_work_json.items[].workItemId}
     * is set but the referenced {@link WorkItemEntity} no longer exists. This
     * happens when save-to-backlog wrote the id back and the corresponding
     * WorkItem was later hard-deleted (or never actually committed due to a
     * concurrent failure outside the save transaction). The Migration Delivery
     * Dashboard surfaces orphan items as {@code not_saved_to_backlog} entries
     * with a warning; this method is the one-click repair behind that
     * surface.</p>
     *
     * <p>Behaviour (single {@code @Transactional} boundary):
     * <ol>
     *   <li>Load the draft via {@link #requireDraft(UUID, UUID)}.</li>
     *   <li>Find the item by {@code bookItemId} -- 404 if not present.</li>
     *   <li>Reject (400) if the item has no stored {@code workItemId} (not
     *       an orphan -- caller should use {@code saveToBacklog} instead).</li>
     *   <li>Reject (400) if the stored {@code workItemId} still resolves to
     *       a real WorkItem (not orphan -- repair is a no-op and would create
     *       a duplicate).</li>
     *   <li>Resolve the parent's current {@code workItemId} by looking at
     *       sibling items in the JSONB (the parent must already be saved or
     *       the new WorkItem is created without a parent link).</li>
     *   <li>Clear the stale id + {@code saveState} on the item; call
     *       {@code itemSaver.persistOne(...)} (a {@code REQUIRES_NEW}
     *       transaction) to create a fresh WorkItem.</li>
     *   <li>Stamp the new {@code workItemId} + {@code saveState='saved'} back
     *       on the item and persist the updated {@code book_of_work_json}.</li>
     * </ol>
     *
     * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19)
     * follow-up #2 -- orphan workItemId repair.</p>
     *
     * @param projectId  the project's UUID.
     * @param bookId     the draft book id.
     * @param bookItemId the stable {@code book_of_work_json.items[].id} value
     *                   of the item to repair.
     * @return a {@link RepairOrphanItemResponse} describing the cleared
     *         orphan id and the new WorkItem id.
     * @throws ResourceNotFoundException when the book or the item is not found.
     * @throws IllegalArgumentException when the item is not actually orphan.
     */
    @Transactional
    public RepairOrphanItemResponse repairOrphanItem(
        UUID projectId, UUID bookId, String bookItemId) {
        if (bookItemId == null || bookItemId.isBlank()) {
            throw new IllegalArgumentException("bookItemId is required");
        }
        GeneratedMigrationBookOfWorkEntity draft = requireDraft(projectId, bookId);

        Map<String, Object> bookOfWork = draft.getBookOfWorkJson();
        if (bookOfWork == null) {
            bookOfWork = new LinkedHashMap<>();
        } else {
            bookOfWork = new LinkedHashMap<>(bookOfWork);
        }
        List<Map<String, Object>> items = extractItems(bookOfWork);
        if (items == null) {
            items = new ArrayList<>();
        }

        Map<String, Object> target = null;
        for (Map<String, Object> it : items) {
            if (bookItemId.equals(stringField(it, "id"))) {
                target = it;
                break;
            }
        }
        if (target == null) {
            throw new ResourceNotFoundException(
                "book item not found: " + bookItemId);
        }

        // Read the stored orphan id. Accept either a String (legacy JSONB
        // shape) or a Map/UUID -- defensively only attempt parse on String.
        Object rawStoredId = target.get("workItemId");
        UUID priorWorkItemId = null;
        if (rawStoredId instanceof String s && !s.isBlank()) {
            try {
                priorWorkItemId = UUID.fromString(s);
            } catch (IllegalArgumentException ignore) {
                // legacy non-UUID payload -- treat as no stored id
            }
        } else if (rawStoredId instanceof UUID u) {
            priorWorkItemId = u;
        }
        if (priorWorkItemId == null) {
            throw new IllegalArgumentException(
                "book item has no stored workItemId; use save-to-backlog instead");
        }
        // Verify the stored id is actually orphan (WorkItem missing).
        if (workItemRepository.existsById(priorWorkItemId)) {
            throw new IllegalArgumentException(
                "book item is not orphan; stored workItemId still resolves: "
                    + priorWorkItemId);
        }

        // Resolve in-batch parent id from sibling items (parent must already
        // have a non-orphan workItemId, otherwise the new WorkItem is created
        // without a parent link).
        UUID resolvedParentId = null;
        String draftParentId = stringField(target, "parentId");
        if (draftParentId != null) {
            for (Map<String, Object> sibling : items) {
                if (draftParentId.equals(stringField(sibling, "id"))) {
                    Object sibStored = sibling.get("workItemId");
                    if (sibStored instanceof String ss && !ss.isBlank()) {
                        try {
                            UUID candidate = UUID.fromString(ss);
                            if (workItemRepository.existsById(candidate)) {
                                resolvedParentId = candidate;
                            }
                        } catch (IllegalArgumentException ignore) {
                            // legacy non-UUID id on the sibling -- skip
                        }
                    } else if (sibStored instanceof UUID su
                        && workItemRepository.existsById(su)) {
                        resolvedParentId = su;
                    }
                    break;
                }
            }
        }

        // Clear stale state before the create so the saved-state is
        // unambiguously the new attempt's outcome.
        target.remove("workItemId");
        target.remove("saveState");
        target.remove("errorMessage");

        // Minimal synthetic request: defaults for description-building options
        // (the repair surface does not expose these toggles to the caller).
        SaveGeneratedMigrationBookOfWorkRequest synthetic =
            new SaveGeneratedMigrationBookOfWorkRequest(
                List.of(bookItemId),
                List.of(),
                SaveGeneratedMigrationBookOfWorkRequest.MODE_SELECTED,
                null,
                Boolean.FALSE,
                Boolean.FALSE,
                null
            );

        UUID newWorkItemId;
        try {
            newWorkItemId = itemSaver.persistOne(
                projectId, target, resolvedParentId, synthetic);
        } catch (RuntimeException e) {
            log.warn(
                "[diag-ams] delivery_dashboard repair_orphan_item_failed draftId={} bookItemId={} reason={}",
                bookId, bookItemId, e.getMessage());
            throw e;
        }

        target.put("workItemId", newWorkItemId.toString());
        target.put("saveState", "saved");

        bookOfWork.put("items", items);
        draft.setBookOfWorkJson(bookOfWork);
        draft.setUpdatedAt(Instant.now());
        repository.save(draft);

        log.info(
            "[diag-ams] delivery_dashboard repair_orphan_item_complete draftId={} bookItemId={} priorWorkItemId={} newWorkItemId={}",
            bookId, bookItemId, priorWorkItemId, newWorkItemId);

        return new RepairOrphanItemResponse(
            bookItemId,
            priorWorkItemId,
            newWorkItemId,
            "ok"
        );
    }

    // -----------------------------------------------------------------
    // items/append-test-item -- Holistic Integration/E2E TEST Work Items
    // (2026-06-14, Spec 2 of 4)
    // -----------------------------------------------------------------

    /**
     * Create ONE {@code TEST} {@link WorkItemEntity} AND append its
     * {@code book_of_work_json.items[]} blob item (with the created
     * {@code workItemId} + {@code saveState="saved"} stamped on it) -- all in
     * ONE transaction. This is the AMS half of the Holistic Integration/E2E
     * TEST Work Items flow (Spec 2026-06-14): the gateway calls it once per
     * generated integration/E2E test so the TEST item surfaces in the delivery
     * dashboard tree (built strictly from {@code book_of_work_json}, joined by
     * the stored {@code workItemId}) AND in the flat backlog (the
     * {@code work_item} table).
     *
     * <p>Mirrors the save-to-backlog write-back ({@code persistOne} + the
     * {@code workItemId} stamp) and {@code repairOrphanItem} (single-item create
     * + stamp + persist), but appends a BRAND-NEW non-epic/feature sibling to a
     * SAVED book. Unlike {@link #appendItems} it does NOT require a DRAFT book,
     * an {@code epicId}, or an expansion-state stamp.</p>
     *
     * <p>{@code TEST} is already an allowed {@code WorkItem} type and
     * {@code validateParentRelationship} is intentionally loose (existence +
     * same-project only), so a TEST item parented to a FEATURE (sibling to
     * stories) or an EPIC (sibling to features) is permitted with NO new
     * Liquibase changeset and NO new sub-type column.</p>
     *
     * @param projectId the owning project
     * @param bookId    the (saved) book of work
     * @param request   the TEST-item create + append payload
     * @return the created {@code WorkItem} UUID + the new blob-item id
     * @throws ResourceNotFoundException when the book or the parent blob item is missing
     * @throws IllegalArgumentException  when required fields are missing
     */
    @Transactional
    public AppendTestItemResponse appendTestItem(
        UUID projectId, UUID bookId, AppendTestItemRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        if (request.title() == null || request.title().isBlank()) {
            throw new IllegalArgumentException("title is required");
        }
        if (request.parentBookItemId() == null || request.parentBookItemId().isBlank()) {
            throw new IllegalArgumentException("parent_book_item_id is required");
        }

        GeneratedMigrationBookOfWorkEntity draft = requireDraft(projectId, bookId);

        // Defensive working copy of book_of_work_json (same pattern as
        // saveToBacklog / repairOrphanItem) so the merge never mutates shared state.
        Map<String, Object> bookOfWork = draft.getBookOfWorkJson();
        if (bookOfWork == null) {
            bookOfWork = new LinkedHashMap<>();
        } else {
            bookOfWork = new LinkedHashMap<>(bookOfWork);
        }
        List<Map<String, Object>> items = extractItems(bookOfWork);
        if (items == null) {
            items = new ArrayList<>();
        }

        // The parent FEATURE/EPIC blob item must exist in the stored hierarchy.
        Map<String, Object> parent = findById(request.parentBookItemId(), items);
        if (parent == null) {
            throw new ResourceNotFoundException(
                "parent book item not found: " + request.parentBookItemId());
        }

        // Resolve the parent WorkItem id: prefer the explicit request value,
        // else fall back to the parent blob item's stored workItemId. Only link
        // to a parent that actually resolves (loose validation keeps the create
        // non-fatal when the parent was never saved to backlog).
        UUID resolvedParentId = null;
        if (request.parentWorkItemId() != null && !request.parentWorkItemId().isBlank()) {
            try {
                resolvedParentId = UUID.fromString(request.parentWorkItemId());
            } catch (IllegalArgumentException ignore) {
                resolvedParentId = null;
            }
        }
        if (resolvedParentId == null) {
            Object parentStored = parent.get("workItemId");
            if (parentStored instanceof String ps && !ps.isBlank()) {
                try {
                    resolvedParentId = UUID.fromString(ps);
                } catch (IllegalArgumentException ignore) {
                    resolvedParentId = null;
                }
            }
        }
        if (resolvedParentId != null && !workItemRepository.existsById(resolvedParentId)) {
            // Stale id -- do not link to a non-existent parent.
            resolvedParentId = null;
        }

        // Build the synthetic draft item the per-item saver consumes. type=TEST
        // (uppercased by persistOne#normaliseType); sequenceOrder rides through
        // to work_item.sortOrder AND onto the blob item below.
        int sequenceOrder = request.sequenceOrder() != null ? request.sequenceOrder() : 0;
        String newBlobId = "test-" + UUID.randomUUID();
        Map<String, Object> draftItem = new LinkedHashMap<>();
        draftItem.put("id", newBlobId);
        draftItem.put("type", "TEST");
        draftItem.put("parentId", request.parentBookItemId());
        draftItem.put("title", request.title());
        if (request.description() != null) {
            draftItem.put("description", request.description());
        }
        draftItem.put("sequenceOrder", sequenceOrder);

        // Minimal synthetic request: defaults for description-building toggles
        // (the holistic action does not expose them); status defaults to
        // DEFAULT_WORK_ITEM_STATUS (PLANNED) when null.
        SaveGeneratedMigrationBookOfWorkRequest synthetic =
            new SaveGeneratedMigrationBookOfWorkRequest(
                List.of(newBlobId),
                List.of(),
                SaveGeneratedMigrationBookOfWorkRequest.MODE_SELECTED,
                null,
                Boolean.FALSE,
                Boolean.FALSE,
                null
            );

        UUID newWorkItemId;
        try {
            newWorkItemId = itemSaver.persistOne(
                projectId, draftItem, resolvedParentId, synthetic);
        } catch (RuntimeException e) {
            log.warn(
                "[diag-ams] delivery_dashboard append_test_item_create_failed bookId={} title={} reason={}",
                bookId, request.title(), e.getMessage());
            throw e;
        }

        // Stamp workItemId + saveState onto the blob item AS PART of this same
        // transaction, then append it and persist the mutated book_of_work_json.
        draftItem.put("workItemId", newWorkItemId.toString());
        draftItem.put("saveState", "saved");
        items.add(draftItem);
        bookOfWork.put("items", items);
        draft.setBookOfWorkJson(bookOfWork);
        draft.setUpdatedAt(Instant.now());
        repository.save(draft);

        log.info(
            "[diag-ams] delivery_dashboard append_test_item_ok bookId={} parentBookItemId={} bookItemId={} workItemId={} seq={}",
            bookId, request.parentBookItemId(), newBlobId, newWorkItemId, sequenceOrder);

        return new AppendTestItemResponse(newWorkItemId, newBlobId, "ok");
    }

    // -----------------------------------------------------------------
    // items/append-capability-story -- D3: Internal-behaviour
    // implementation-ready spec generation (2026-06-14, Spec 3 of 6)
    // -----------------------------------------------------------------

    /**
     * Mint ONE {@code STORY} {@link WorkItemEntity} from an approved
     * {@code discovery_capability} AND append its
     * {@code book_of_work_json.items[]} blob item (with the created
     * {@code workItemId} + {@code saveState="saved"} + {@code source_capability_id}
     * stamped on it) -- all in ONE transaction. This is the AMS half of D3's
     * explicit per-capability trigger: the gateway calls it once per approved
     * capability so the resulting story is consumed UNCHANGED by
     * {@code migrationShapeSpecGenerationHandler.selectEligibleStories} (which
     * already gates on {@code type === 'story'} + a non-null {@code workItemId}),
     * generating a modernised, implementation-ready spec + {@code implement-state.json}.
     *
     * <p>Modelled EXACTLY on {@link #appendTestItem(UUID, UUID, AppendTestItemRequest)}
     * ({@code persistOne} + the {@code workItemId}/{@code saveState} stamp + the
     * defensive {@code book_of_work_json} working-copy merge), with two
     * differences:</p>
     * <ul>
     *   <li>the blob item {@code type} is the LOWERCASE {@code "story"} (not
     *       {@code "TEST"}) so the gateway's {@code selectEligibleStories} filter
     *       (which matches {@code it.type === 'story'}) consumes it; the
     *       {@code work_item.type} is uppercased to {@code STORY} by
     *       {@code persistOne#normaliseType}; AND</li>
     *   <li>the parent blob item is OPTIONAL -- a capability story is a top-level
     *       story, not a sibling under a feature/epic -- so when
     *       {@code parent_book_item_id} is absent/unresolved the story is created
     *       with NO parent link (loose, existence-only validation, mirroring
     *       {@code append-test-item}).</li>
     * </ul>
     *
     * <p>The {@code source_capability_id} provenance link rides the blob item
     * with NO DDL (changesets 181 + 184 already exist; D3 adds no changeset),
     * exactly as {@code append-test-item} stamps {@code workItemId}. If the D4
     * coverage gate later needs {@code source_capability_id} promoted to a
     * column, D4 adds that changeset.</p>
     *
     * @param projectId the owning project
     * @param bookId    the (saved) book of work
     * @param request   the capability-story create + append payload
     * @return the created {@code WorkItem} UUID + the new blob-item id + the
     *         stamped {@code source_capability_id}
     * @throws ResourceNotFoundException when the book (or a supplied-but-unknown
     *         parent blob item) is missing
     * @throws IllegalArgumentException  when required fields
     *         ({@code source_capability_id} / {@code title}) are missing
     */
    @Transactional
    public AppendCapabilityStoryResponse appendCapabilityStory(
        UUID projectId, UUID bookId, AppendCapabilityStoryRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        if (request.sourceCapabilityId() == null || request.sourceCapabilityId().isBlank()) {
            throw new IllegalArgumentException("source_capability_id is required");
        }
        if (request.title() == null || request.title().isBlank()) {
            throw new IllegalArgumentException("title is required");
        }

        GeneratedMigrationBookOfWorkEntity draft = requireDraft(projectId, bookId);

        // Defensive working copy of book_of_work_json (same pattern as
        // appendTestItem / saveToBacklog) so the merge never mutates shared state.
        Map<String, Object> bookOfWork = draft.getBookOfWorkJson();
        if (bookOfWork == null) {
            bookOfWork = new LinkedHashMap<>();
        } else {
            bookOfWork = new LinkedHashMap<>(bookOfWork);
        }
        List<Map<String, Object>> items = extractItems(bookOfWork);
        if (items == null) {
            items = new ArrayList<>();
        }

        // Resolve an OPTIONAL parent blob item -> parent WorkItem id. Unlike
        // append-test-item, a missing/unknown parent is NOT an error here -- a
        // capability story is a top-level story by default.
        String parentBookItemId = (request.parentBookItemId() != null
            && !request.parentBookItemId().isBlank()) ? request.parentBookItemId() : null;
        UUID resolvedParentId = null;
        if (parentBookItemId != null) {
            Map<String, Object> parent = findById(parentBookItemId, items);
            if (parent == null) {
                throw new ResourceNotFoundException(
                    "parent book item not found: " + parentBookItemId);
            }
            Object parentStored = parent.get("workItemId");
            if (parentStored instanceof String ps && !ps.isBlank()) {
                try {
                    resolvedParentId = UUID.fromString(ps);
                } catch (IllegalArgumentException ignore) {
                    resolvedParentId = null;
                }
            }
            if (resolvedParentId != null && !workItemRepository.existsById(resolvedParentId)) {
                // Stale id -- do not link to a non-existent parent.
                resolvedParentId = null;
            }
        }

        // Build the synthetic draft item the per-item saver consumes. type=story
        // (uppercased to STORY by persistOne#normaliseType for the work_item row,
        // kept LOWERCASE on the blob so selectEligibleStories matches);
        // sequenceOrder rides through to work_item.sortOrder AND onto the blob.
        int sequenceOrder = request.sequenceOrder() != null ? request.sequenceOrder() : 0;
        String newBlobId = "capstory-" + UUID.randomUUID();
        Map<String, Object> draftItem = new LinkedHashMap<>();
        draftItem.put("id", newBlobId);
        draftItem.put("type", "story");
        if (parentBookItemId != null) {
            draftItem.put("parentId", parentBookItemId);
        }
        draftItem.put("title", request.title());
        if (request.description() != null) {
            draftItem.put("description", request.description());
        }
        draftItem.put("sequenceOrder", sequenceOrder);

        // Minimal synthetic request: defaults for description-building toggles
        // (the capability trigger does not expose them); status defaults to
        // DEFAULT_WORK_ITEM_STATUS (PLANNED) when null.
        SaveGeneratedMigrationBookOfWorkRequest synthetic =
            new SaveGeneratedMigrationBookOfWorkRequest(
                List.of(newBlobId),
                List.of(),
                SaveGeneratedMigrationBookOfWorkRequest.MODE_SELECTED,
                null,
                Boolean.FALSE,
                Boolean.FALSE,
                null
            );

        UUID newWorkItemId;
        try {
            newWorkItemId = itemSaver.persistOne(
                projectId, draftItem, resolvedParentId, synthetic);
        } catch (RuntimeException e) {
            log.warn(
                "[diag-ams] delivery_dashboard append_capability_story_create_failed bookId={} title={} reason={}",
                bookId, request.title(), e.getMessage());
            throw e;
        }

        // D4 (changeset 185): ALSO write the source_capability_id COLUMN on the
        // minted work_item so the carry_over completeness gate's coverage query
        // is a structured JOIN (work_item.source_capability_id ==
        // discovery_capability.id), not a book_of_work_json blob re-parse. The
        // blob stamp below stays unchanged (D3 stays changeset-free on its own);
        // BOTH the blob (D3) and the column (D4's gate join) now carry the
        // provenance. persistOne committed the row in its own REQUIRES_NEW
        // transaction, so it is loadable here; the column-set is persisted as
        // part of THIS append transaction. The source_capability_id was already
        // validated non-blank above; a non-UUID value cannot satisfy the gate
        // join, so it is skipped defensively on the column (the blob still keeps
        // the raw string for the D3 contract).
        try {
            UUID sourceCapabilityUuid = UUID.fromString(request.sourceCapabilityId());
            workItemRepository.findById(newWorkItemId).ifPresent(minted -> {
                minted.setSourceCapabilityId(sourceCapabilityUuid);
                workItemRepository.save(minted);
            });
        } catch (IllegalArgumentException ex) {
            log.warn(
                "[diag-ams] delivery_dashboard append_capability_story_source_capability_id_not_uuid "
                    + "bookId={} workItemId={} sourceCapabilityId={} -- blob stamp retained, column skipped",
                bookId, newWorkItemId, request.sourceCapabilityId());
        }

        // Stamp workItemId + saveState + source_capability_id onto the blob item
        // AS PART of this same transaction, then append it and persist the
        // mutated book_of_work_json. source_capability_id rides the blob (no DDL).
        draftItem.put("workItemId", newWorkItemId.toString());
        draftItem.put("saveState", "saved");
        draftItem.put("source_capability_id", request.sourceCapabilityId());
        items.add(draftItem);
        bookOfWork.put("items", items);
        draft.setBookOfWorkJson(bookOfWork);
        draft.setUpdatedAt(Instant.now());
        repository.save(draft);

        log.info(
            "[diag-ams] delivery_dashboard append_capability_story_ok bookId={} sourceCapabilityId={} bookItemId={} workItemId={} seq={}",
            bookId, request.sourceCapabilityId(), newBlobId, newWorkItemId, sequenceOrder);

        return new AppendCapabilityStoryResponse(
            newWorkItemId, newBlobId, request.sourceCapabilityId(), "ok");
    }

    // -----------------------------------------------------------------
    // items/add-item -- D5: Net-new backlog items + provenance
    // (2026-06-14, Spec 5 of 6)
    // -----------------------------------------------------------------

    /**
     * Add ONE manual {@code STORY} {@link WorkItemEntity} AND append its
     * {@code book_of_work_json.items[]} blob item (with the created
     * {@code workItemId} + {@code saveState="saved"} + {@code provenance}
     * stamped on it) -- all in ONE transaction. This is the AMS half of D5's
     * Migration Delivery Dashboard "Add work item" action: the gateway calls it
     * to add genuinely-new ({@code net_new}) work or undiscoverable like-for-like
     * ({@code carry_over}) work to a SAVED book BEFORE Migrate, then triggers
     * description-grounded spec-gen for the returned {@code workItemId}.
     *
     * <p>Modelled EXACTLY on {@link #appendCapabilityStory(UUID, UUID,
     * AppendCapabilityStoryRequest)} ({@code persistOne} + the
     * {@code workItemId}/{@code saveState} blob stamp + the defensive
     * {@code book_of_work_json} working-copy merge + the optional top-level
     * parent + the COLUMN back-write), with the D5 differences:</p>
     * <ul>
     *   <li>the blob item {@code type} is the LOWERCASE {@code "story"} so the
     *       gateway's {@code selectEligibleStories} ({@code it.type === 'story'} +
     *       non-null {@code workItemId}) consumes it UNCHANGED; the
     *       {@code work_item.type} is uppercased to {@code STORY} by
     *       {@code persistOne#normaliseType}; AND</li>
     *   <li>after {@code persistOne} the minted {@code work_item.provenance}
     *       COLUMN (changeset 186) is set inside this same transaction (load by id,
     *       set, save) -- mirrors how {@code appendCapabilityStory} back-writes
     *       {@code source_capability_id}; the blob carries {@code provenance} too
     *       (column + blob both carry it). The {@code kind} flavour rides the blob
     *       (for the gateway's prompt orientation) but is NOT a persisted column.</li>
     * </ul>
     *
     * <p>The item carries NO {@code source_capability_id} and NO
     * {@code discoveryFindingReferences} (a manual add has no discovered
     * capability/finding) -- this is what keeps it OUT of D4's discovered
     * must-account set with NO gate code. Dispatch stays provenance-blind, so a
     * {@code net_new} spec-ready story dispatches unchanged (D5).</p>
     *
     * @param projectId the owning project
     * @param bookId    the (saved) book of work
     * @param request   the manual add-item create + append payload
     * @return the created {@code WorkItem} UUID + the new blob-item id + the
     *         stamped {@code provenance} + the {@code kind} flavour
     * @throws ResourceNotFoundException when the book (or a supplied-but-unknown
     *         parent blob item) is missing
     * @throws IllegalArgumentException  when required fields ({@code title}) are
     *         missing, or {@code provenance} / {@code kind} is not in the allowed
     *         set
     */
    @Transactional
    public AddWorkItemResponse addItem(
        UUID projectId, UUID bookId, AddWorkItemRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        if (request.title() == null || request.title().isBlank()) {
            throw new IllegalArgumentException("title is required");
        }

        // Resolve + validate provenance (service-layer validation; the column is a
        // plain VARCHAR). Default carry_over when null/blank (D5).
        String provenance = (request.provenance() != null && !request.provenance().isBlank())
            ? request.provenance().trim() : WorkItemEntity.PROVENANCE_CARRY_OVER;
        if (!ALLOWED_PROVENANCE.contains(provenance)) {
            throw new IllegalArgumentException(
                "Invalid provenance '" + provenance + "'; allowed: " + ALLOWED_PROVENANCE);
        }

        // Resolve + validate the prompt-flavour kind. Default api when null/blank.
        String kind = (request.kind() != null && !request.kind().isBlank())
            ? request.kind().trim() : AddWorkItemRequest.KIND_API;
        if (!ALLOWED_KINDS.contains(kind)) {
            throw new IllegalArgumentException(
                "Invalid kind '" + kind + "'; allowed: " + ALLOWED_KINDS);
        }

        GeneratedMigrationBookOfWorkEntity draft = requireDraft(projectId, bookId);

        // Defensive working copy of book_of_work_json (same pattern as
        // appendCapabilityStory / saveToBacklog) so the merge never mutates shared state.
        Map<String, Object> bookOfWork = draft.getBookOfWorkJson();
        if (bookOfWork == null) {
            bookOfWork = new LinkedHashMap<>();
        } else {
            bookOfWork = new LinkedHashMap<>(bookOfWork);
        }
        List<Map<String, Object>> items = extractItems(bookOfWork);
        if (items == null) {
            items = new ArrayList<>();
        }

        // Resolve an OPTIONAL parent blob item -> parent WorkItem id. Like
        // appendCapabilityStory, a manual add is a top-level story by default; a
        // missing/unknown parent is NOT an error unless an id was supplied.
        String parentBookItemId = (request.parentBookItemId() != null
            && !request.parentBookItemId().isBlank()) ? request.parentBookItemId() : null;
        UUID resolvedParentId = null;
        if (parentBookItemId != null) {
            Map<String, Object> parent = findById(parentBookItemId, items);
            if (parent == null) {
                throw new ResourceNotFoundException(
                    "parent book item not found: " + parentBookItemId);
            }
            Object parentStored = parent.get("workItemId");
            if (parentStored instanceof String ps && !ps.isBlank()) {
                try {
                    resolvedParentId = UUID.fromString(ps);
                } catch (IllegalArgumentException ignore) {
                    resolvedParentId = null;
                }
            }
            if (resolvedParentId != null && !workItemRepository.existsById(resolvedParentId)) {
                // Stale id -- do not link to a non-existent parent.
                resolvedParentId = null;
            }
        }

        // Build the synthetic draft item the per-item saver consumes. type=story
        // (uppercased to STORY by persistOne#normaliseType for the work_item row,
        // kept LOWERCASE on the blob so selectEligibleStories matches);
        // sequenceOrder rides through to work_item.sortOrder AND onto the blob.
        int sequenceOrder = request.sequenceOrder() != null ? request.sequenceOrder() : 0;
        String newBlobId = "manual-" + UUID.randomUUID();
        Map<String, Object> draftItem = new LinkedHashMap<>();
        draftItem.put("id", newBlobId);
        draftItem.put("type", "story");
        if (parentBookItemId != null) {
            draftItem.put("parentId", parentBookItemId);
        }
        draftItem.put("title", request.title());
        if (request.description() != null) {
            draftItem.put("description", request.description());
        }
        draftItem.put("sequenceOrder", sequenceOrder);

        // Minimal synthetic request: defaults for description-building toggles
        // (the add-item action does not expose them); status defaults to
        // DEFAULT_WORK_ITEM_STATUS (PLANNED) when null.
        SaveGeneratedMigrationBookOfWorkRequest synthetic =
            new SaveGeneratedMigrationBookOfWorkRequest(
                List.of(newBlobId),
                List.of(),
                SaveGeneratedMigrationBookOfWorkRequest.MODE_SELECTED,
                null,
                Boolean.FALSE,
                Boolean.FALSE,
                null
            );

        UUID newWorkItemId;
        try {
            newWorkItemId = itemSaver.persistOne(
                projectId, draftItem, resolvedParentId, synthetic);
        } catch (RuntimeException e) {
            log.warn(
                "[diag-ams] delivery_dashboard add_item_create_failed bookId={} title={} reason={}",
                bookId, request.title(), e.getMessage());
            throw e;
        }

        // D5 (changeset 186): set the provenance COLUMN on the minted work_item so
        // the reconcile consumer (D6) reads it directly off the row. persistOne
        // committed the row in its own REQUIRES_NEW transaction, so it is loadable
        // here; the column-set is persisted as part of THIS add transaction.
        // Mirrors how appendCapabilityStory back-writes source_capability_id. The
        // item carries NO source_capability_id -- a manual add has no discovered
        // capability/finding, so it is never a D4 carry_over coverage obligation.
        final String provenanceFinal = provenance;
        workItemRepository.findById(newWorkItemId).ifPresent(minted -> {
            minted.setProvenance(provenanceFinal);
            workItemRepository.save(minted);
        });

        // Stamp workItemId + saveState + provenance (+ the kind flavour) onto the
        // blob item AS PART of this same transaction, then append it and persist
        // the mutated book_of_work_json. provenance rides BOTH the column and the
        // blob; kind rides the blob only (prompt-flavour hint, not a column).
        draftItem.put("workItemId", newWorkItemId.toString());
        draftItem.put("saveState", "saved");
        draftItem.put("provenance", provenance);
        draftItem.put("kind", kind);
        // D6: stamp the explicit, human-owned net_new_operations list onto the
        // blob item -- the AUTHORITATIVE match source the reconcile-time
        // auto-disposition pass reads to recognise an additive net_new endpoint's
        // target_only diff as EXPECTED. It rides the blob (NO column / changeset),
        // mirroring provenance/kind/source_capability_id. Scoped to net_new + api
        // only; a null/empty list, or a non-net_new / non-api add, leaves it
        // absent (the reconcile-time reader is the gate, but we never stamp noise).
        List<String> netNewOperations = sanitiseStringList(request.netNewOperations());
        if (WorkItemEntity.PROVENANCE_NET_NEW.equals(provenance)
            && AddWorkItemRequest.KIND_API.equals(kind)
            && !netNewOperations.isEmpty()) {
            draftItem.put("net_new_operations", netNewOperations);
        }
        // Carry-over triage (2026-07-26): OPTIONAL workstream / acceptance
        // criteria / discovery-finding references stamped onto the blob item.
        // workstream drives the execution rail's plane grouping; the finding
        // references are what flip a triage NEW-STORY's originating finding to
        // cited-by-story in the D4 gate. Absent fields leave the original D5
        // out-of-gate behaviour unchanged.
        if (request.workstream() != null && !request.workstream().isBlank()) {
            draftItem.put("workstream", request.workstream().trim());
        }
        List<String> acceptanceCriteria = sanitiseStringList(request.acceptanceCriteria());
        if (!acceptanceCriteria.isEmpty()) {
            draftItem.put("acceptanceCriteria", acceptanceCriteria);
        }
        List<String> findingRefs = sanitiseStringList(request.discoveryFindingReferences());
        if (!findingRefs.isEmpty()) {
            draftItem.put("discoveryFindingReferences", findingRefs);
        }
        items.add(draftItem);
        bookOfWork.put("items", items);
        draft.setBookOfWorkJson(bookOfWork);
        draft.setUpdatedAt(Instant.now());
        repository.save(draft);

        log.info(
            "[diag-ams] delivery_dashboard add_item_ok bookId={} provenance={} kind={} bookItemId={} workItemId={} seq={}",
            bookId, provenance, kind, newBlobId, newWorkItemId, sequenceOrder);

        return new AddWorkItemResponse(
            newWorkItemId, newBlobId, provenance, kind, "ok");
    }

    /**
     * Normalise a caller-supplied string list for stamping onto the blob: drop
     * null entries, trim, drop blanks, and de-duplicate while preserving order.
     * Returns an empty list (never null) when the input is null/empty so the
     * caller can stamp defensively. Originally D6's {@code net_new_operations}
     * sanitiser; reused verbatim for the triage-era {@code acceptance_criteria}
     * and {@code discovery_finding_references} stamps (same clean-and-verbatim
     * contract — any {@code <METHOD> <path>} key normalisation stays the
     * gateway reconcile reader's concern).
     */
    private static List<String> sanitiseStringList(List<String> raw) {
        if (raw == null || raw.isEmpty()) {
            return List.of();
        }
        java.util.LinkedHashSet<String> cleaned = new java.util.LinkedHashSet<>();
        for (String entry : raw) {
            if (entry == null) {
                continue;
            }
            String trimmed = entry.trim();
            if (!trimmed.isEmpty()) {
                cleaned.add(trimmed);
            }
        }
        return new ArrayList<>(cleaned);
    }

    // -----------------------------------------------------------------
    // items/{bookItemId}/cite-finding + items/{bookItemId}/amend --
    // Carry-over triage (2026-07-26)
    // -----------------------------------------------------------------

    /**
     * CITE one {@code discovery_finding} onto an EXISTING story blob item: add
     * the finding id to the item's {@code discoveryFindingReferences} list —
     * the same citation array the plan generator writes and the D4 carry-over
     * gate's {@code collectCitedFindingIds} reads — so the finding flips to
     * {@code cited-by-story}. Idempotent: an already-cited finding is a no-op
     * success. Loads the row with the pessimistic WRITE lock so concurrent
     * cites (e.g. the triage batch apply) serialise rather than
     * last-write-wins on {@code book_of_work_json}. Story-type items only.
     */
    @Transactional
    public CiteFindingResponse citeFindingOnItem(
        UUID projectId, UUID bookId, String bookItemId, CiteFindingRequest request) {
        if (request == null || request.findingId() == null || request.findingId().isBlank()) {
            throw new IllegalArgumentException("finding_id is required");
        }
        String findingId = request.findingId().trim();

        GeneratedMigrationBookOfWorkEntity draft = requireDraftForUpdate(projectId, bookId);
        Map<String, Object> bookOfWork = workingCopyOfBookJson(draft);
        List<Map<String, Object>> items = extractItems(bookOfWork);
        if (items == null) {
            items = new ArrayList<>();
        }
        Map<String, Object> item = requireStoryItem(bookItemId, items);

        boolean alreadyCited = !addFindingReference(item, findingId);

        if (!alreadyCited) {
            bookOfWork.put("items", items);
            draft.setBookOfWorkJson(bookOfWork);
            draft.setUpdatedAt(Instant.now());
            repository.save(draft);
        }
        log.info(
            "[diag-ams] book_of_work stage=cite_finding bookId={} bookItemId={} findingId={} alreadyCited={}",
            bookId, bookItemId, findingId, alreadyCited);
        return new CiteFindingResponse(bookItemId, findingId, alreadyCited, "ok");
    }

    /**
     * AMEND a story so it actually deals with a carry-over finding — one
     * atomic transaction that:
     * <ol>
     *   <li>REPLACES the blob item {@code description} (when a non-blank one is
     *       supplied) and best-effort mirrors it onto the linked
     *       {@code work_item.description};</li>
     *   <li>APPENDS the supplied acceptance criteria to the blob item's
     *       {@code acceptanceCriteria} list;</li>
     *   <li>CITES the finding onto {@code discoveryFindingReferences}
     *       (idempotent — same mechanics as
     *       {@link #citeFindingOnItem(UUID, UUID, String, CiteFindingRequest)});
     *       AND</li>
     *   <li>MARKS the linked work item's spec-generation rows STALE
     *       ({@code stale=TRUE} + {@code stale_reason} + {@code stale_marked_at}
     *       + {@code updated_at} — the
     *       {@code MissingInputResolutionCascadeService} stamping precedent),
     *       so the story drops out of stage spec-readiness
     *       ({@code isStorySpecReady} fails on a non-null {@code stale_reason})
     *       until its spec regenerates with the amendment folded in. The
     *       existing persist-path contract clears the stamp on successful
     *       regeneration.</li>
     * </ol>
     * The amendment must DO something: a request with no description AND no
     * criteria AND no finding id is rejected 400.
     */
    @Transactional
    public AmendBookItemResponse amendStoryItem(
        UUID projectId, UUID bookId, String bookItemId, AmendBookItemRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        String newDescription = (request.description() != null && !request.description().isBlank())
            ? request.description().trim() : null;
        List<String> appendCriteria = sanitiseStringList(request.appendAcceptanceCriteria());
        String findingId = (request.citeFindingId() != null && !request.citeFindingId().isBlank())
            ? request.citeFindingId().trim() : null;
        if (newDescription == null && appendCriteria.isEmpty() && findingId == null) {
            throw new IllegalArgumentException(
                "an amendment must supply a description, acceptance criteria, or a finding to cite");
        }

        GeneratedMigrationBookOfWorkEntity draft = requireDraftForUpdate(projectId, bookId);
        Map<String, Object> bookOfWork = workingCopyOfBookJson(draft);
        List<Map<String, Object>> items = extractItems(bookOfWork);
        if (items == null) {
            items = new ArrayList<>();
        }
        Map<String, Object> item = requireStoryItem(bookItemId, items);

        if (newDescription != null) {
            item.put("description", newDescription);
        }
        if (!appendCriteria.isEmpty()) {
            List<String> merged = new ArrayList<>(readStringList(item.get("acceptanceCriteria")));
            for (String criterion : appendCriteria) {
                if (!merged.contains(criterion)) {
                    merged.add(criterion);
                }
            }
            item.put("acceptanceCriteria", merged);
        }
        if (findingId != null) {
            addFindingReference(item, findingId);
        }

        bookOfWork.put("items", items);
        draft.setBookOfWorkJson(bookOfWork);
        draft.setUpdatedAt(Instant.now());
        repository.save(draft);

        // Best-effort mirror of the amended description onto the linked
        // work_item row (the backlog list renders it) — never blocks the amend.
        String workItemIdRaw = stringField(item, "workItemId");
        UUID workItemId = null;
        if (workItemIdRaw != null) {
            try {
                workItemId = UUID.fromString(workItemIdRaw);
            } catch (IllegalArgumentException ignore) {
                workItemId = null;
            }
        }
        if (workItemId != null && newDescription != null) {
            final String descriptionFinal = newDescription;
            try {
                workItemRepository.findByIdAndProjectId(workItemId, projectId)
                    .ifPresent(wi -> {
                        wi.setDescription(descriptionFinal);
                        workItemRepository.save(wi);
                    });
            } catch (RuntimeException ex) {
                log.warn(
                    "[diag-ams] book_of_work stage=amend_item work_item_mirror_failed "
                        + "bookItemId={} reason={}",
                    bookItemId, ex.getMessage());
            }
        }

        // Mark the story's spec-generation rows stale so it drops out of stage
        // spec-readiness until regenerated. Zero rows (spec never generated) is
        // fine — "no spec" already reads as not-ready.
        String staleReason = (request.staleReason() != null && !request.staleReason().isBlank())
            ? request.staleReason().trim()
            : (findingId != null ? "story_amended_for_finding:" + findingId : "story_amended");
        int specsMarkedStale = 0;
        if (workItemId != null) {
            Instant now = Instant.now();
            List<MigrationStorySpecGenerationEntity> specRows =
                specGenerationRepository.findByWorkItemId(workItemId);
            for (MigrationStorySpecGenerationEntity spec : specRows) {
                if (!projectId.equals(spec.getProjectId())) {
                    continue;
                }
                spec.setStale(Boolean.TRUE);
                spec.setStaleReason(staleReason);
                spec.setStaleMarkedAt(now);
                spec.setUpdatedAt(now);
                specGenerationRepository.save(spec);
                specsMarkedStale++;
            }
        }

        log.info(
            "[diag-ams] book_of_work stage=amend_item bookId={} bookItemId={} findingId={} "
                + "descriptionReplaced={} criteriaAppended={} specsMarkedStale={}",
            bookId, bookItemId, findingId, newDescription != null, appendCriteria.size(),
            specsMarkedStale);

        return new AmendBookItemResponse(
            bookItemId,
            workItemId != null ? workItemId.toString() : null,
            findingId,
            specsMarkedStale,
            "ok");
    }

    /** Defensive working copy of {@code book_of_work_json} (shared pattern). */
    private static Map<String, Object> workingCopyOfBookJson(
        GeneratedMigrationBookOfWorkEntity draft) {
        Map<String, Object> bookOfWork = draft.getBookOfWorkJson();
        return bookOfWork == null ? new LinkedHashMap<>() : new LinkedHashMap<>(bookOfWork);
    }

    /** Resolve a STORY blob item by id — 400 when unknown or not a story. */
    private static Map<String, Object> requireStoryItem(
        String bookItemId, List<Map<String, Object>> items) {
        Map<String, Object> item = findById(bookItemId, items);
        if (item == null) {
            throw new IllegalArgumentException(
                "Unknown item id '" + bookItemId + "' in book_of_work_json");
        }
        if (!"story".equalsIgnoreCase(stringField(item, "type"))) {
            throw new IllegalArgumentException(
                "Only STORY items can cite findings; '" + bookItemId + "' is a "
                    + stringField(item, "type"));
        }
        return item;
    }

    /**
     * Add {@code findingId} to the item's {@code discoveryFindingReferences}
     * list. Returns {@code true} when the reference was ADDED, {@code false}
     * when it was already present (idempotent no-op).
     */
    private static boolean addFindingReference(Map<String, Object> item, String findingId) {
        List<String> refs = new ArrayList<>(readStringList(item.get("discoveryFindingReferences")));
        if (refs.contains(findingId)) {
            return false;
        }
        refs.add(findingId);
        item.put("discoveryFindingReferences", refs);
        return true;
    }

    /** Read a blob value as a clean string list ([] on null / non-list). */
    private static List<String> readStringList(Object raw) {
        if (!(raw instanceof List<?> list)) {
            return List.of();
        }
        List<String> out = new ArrayList<>();
        for (Object o : list) {
            if (o instanceof String s && !s.isBlank()) {
                out.add(s);
            }
        }
        return out;
    }

    // -----------------------------------------------------------------
    // items/append -- Two-Phase Migration Plan Generation (2026-06-11)
    // -----------------------------------------------------------------

    /**
     * Atomically merge one epic's phase-2 expansion result into
     * {@code book_of_work_json}: append the supplied story / feature items
     * under the target epic AND stamp that epic's new expansion state -- all
     * server-side within this single {@code @Transactional} boundary. The
     * client NEVER read-modify-writes the JSON, and the row is loaded with a
     * pessimistic WRITE lock ({@link GeneratedMigrationBookOfWorkRepository#findWithLockById(UUID)}),
     * so concurrent per-epic appends during "Expand all" serialise on the row
     * and cannot lose each other's writes.
     *
     * <p><b>Per-epic expansion-state shape (the ONE shared shape, used by the
     * gateway's skeleton seeding and phase-2 orchestration alike):</b> an
     * {@code expansionState} field on the epic item inside
     * {@code book_of_work_json.items[]}, with vocabulary
     * {@code not_expanded | expanding | expanded | failed} (see
     * {@link AppendGeneratedMigrationBookOfWorkItemsRequest#ALL_EXPANSION_STATES}).
     * Explicitly NO new columns and NO new {@code chk_gmbw_status} values --
     * zero Liquibase change.</p>
     *
     * <p>{@code request.items()} may be null/empty for a STATE-ONLY merge
     * (the gateway marks an epic {@code expanding} before its pipeline runs
     * and {@code failed} when it aborts; {@code expanded} rides with the
     * story append).</p>
     *
     * <p>Validation (controller maps {@link IllegalArgumentException} to 400):</p>
     * <ul>
     *   <li>the book must exist for the project (else 404) and be at
     *       {@code status='draft'};</li>
     *   <li>{@code epic_id} must resolve to an existing epic item in the
     *       stored hierarchy;</li>
     *   <li>every appended item needs a unique, previously-unused {@code id}
     *       and a {@code parentId} resolving to the target epic, an existing
     *       epic/feature in the stored hierarchy, or a feature appended
     *       earlier in this same batch;</li>
     *   <li>{@code expansion_state} must be in the allowed vocabulary.</li>
     * </ul>
     *
     * <p>Other epics' items and expansion states are never touched -- the
     * merge only appends new items and mutates the one target epic.</p>
     *
     * @param projectId the project UUID
     * @param bookId the draft UUID
     * @param request the append request
     * @return the updated draft DTO (merged {@code book_of_work_json} included)
     * @throws ResourceNotFoundException if the draft does not exist
     * @throws IllegalArgumentException on any validation failure (400)
     */
    @Transactional
    public GeneratedMigrationBookOfWorkDto appendItems(
        UUID projectId, UUID bookId, AppendGeneratedMigrationBookOfWorkItemsRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        if (request.epicId() == null || request.epicId().isBlank()) {
            throw new IllegalArgumentException("epic_id is required");
        }
        String expansionState = request.expansionState();
        if (expansionState == null
            || !AppendGeneratedMigrationBookOfWorkItemsRequest.ALL_EXPANSION_STATES
                .contains(expansionState)) {
            throw new IllegalArgumentException(
                "Invalid expansion_state '" + expansionState + "'; allowed values: "
                    + AppendGeneratedMigrationBookOfWorkItemsRequest.ALL_EXPANSION_STATES);
        }

        GeneratedMigrationBookOfWorkEntity draft = requireDraftForUpdate(projectId, bookId);
        if (!GeneratedMigrationBookOfWorkStatus.DRAFT.equals(draft.getStatus())) {
            throw new IllegalArgumentException(
                "items/append is only allowed on a draft book; current status: "
                    + draft.getStatus());
        }

        // Mutable working copy of book_of_work_json (same defensive-copy
        // pattern as saveToBacklog) so the merge never mutates shared state.
        Map<String, Object> bookOfWork = draft.getBookOfWorkJson();
        if (bookOfWork == null) {
            bookOfWork = new LinkedHashMap<>();
        } else {
            bookOfWork = new LinkedHashMap<>(bookOfWork);
        }
        List<Map<String, Object>> extracted = extractItems(bookOfWork);
        List<Map<String, Object>> items = extracted != null ? extracted : new ArrayList<>();

        // Locate the target epic in the stored hierarchy -- 400 when unknown.
        Map<String, Object> epic = findById(request.epicId(), items);
        if (epic == null || !"epic".equalsIgnoreCase(stringField(epic, "type"))) {
            throw new IllegalArgumentException(
                "Unknown epic id '" + request.epicId()
                    + "'; appended items must target an existing epic in book_of_work_json");
        }

        // RE-EXPAND replace (2026-07-19): drop the epic's PRIOR expansion output
        // before appending the fresh stories, so re-expanding an epic replaces
        // its stories instead of duplicating them. "Expansion output" = every
        // descendant story of the epic, plus any descendant tagged
        // `expansionGenerated:true` (catches an injected scaffold feature). The
        // skeleton (epic + its features) is untouched: features carry no tag and
        // are not stories, so a re-expand keeps the structure the pipeline
        // parents its new stories onto. Runs BEFORE the dup-id scan below so the
        // replaced ids are free for the fresh append, all inside the one
        // transaction (a later validation failure rolls the removal back too).
        if (Boolean.TRUE.equals(request.replaceEpicExpansion())) {
            Set<String> descendantIds = collectDescendantIds(request.epicId(), items);
            int before = items.size();
            items.removeIf(it -> {
                String id = stringField(it, "id");
                if (id == null || !descendantIds.contains(id)) {
                    return false;
                }
                boolean isStory = "story".equalsIgnoreCase(stringField(it, "type"));
                boolean tagged = Boolean.TRUE.equals(it.get("expansionGenerated"));
                return isStory || tagged;
            });
            log.info(
                "[diag-ams] book_of_work stage=replace_epic_expansion draftId={} epicId={} removed={}",
                bookId, request.epicId(), before - items.size());
        }

        // Validate every appended item BEFORE mutating anything, so a bad
        // batch leaves the stored JSON untouched (the transaction would roll
        // back anyway; this keeps the failure mode obvious).
        List<Map<String, Object>> toAppend =
            request.items() != null ? request.items() : List.of();
        Set<String> knownIds = new HashSet<>();
        for (Map<String, Object> it : items) {
            String id = stringField(it, "id");
            if (id != null) {
                knownIds.add(id);
            }
        }
        Map<String, String> batchTypesById = new HashMap<>();
        List<Map<String, Object>> appendedCopies = new ArrayList<>(toAppend.size());
        // Tombstone suppression (Phase 1a, 2026-07-20): a user-DELETED story's
        // id lives in book_of_work_json.suppressed_item_ids. Deterministic
        // re-expansion regenerates stories under the SAME ids, so an incoming
        // suppressed id is silently skipped here — deletion survives
        // re-expansion; never an error.
        Set<String> suppressedIds = readSuppressedIds(bookOfWork);
        int skippedSuppressed = 0;
        for (Map<String, Object> rawItem : toAppend) {
            if (rawItem == null) {
                throw new IllegalArgumentException("appended items must be objects");
            }
            Map<String, Object> copy = new LinkedHashMap<>(rawItem);
            String id = stringField(copy, "id");
            if (id == null || id.isBlank()) {
                throw new IllegalArgumentException(
                    "every appended item requires a non-blank 'id'");
            }
            if (suppressedIds.contains(id)) {
                skippedSuppressed++;
                continue;
            }
            if (knownIds.contains(id)) {
                throw new IllegalArgumentException(
                    "appended item id '" + id + "' already exists in book_of_work_json");
            }
            String parentId = stringField(copy, "parentId");
            if (parentId == null || parentId.isBlank()) {
                throw new IllegalArgumentException(
                    "appended item '" + id
                        + "' requires a parentId referencing the epic or one of its features");
            }
            // Parent must be an epic/feature: the target epic itself, an item
            // already in the stored hierarchy, or a feature appended EARLIER
            // in this same batch (features-then-stories ordering).
            String parentType;
            Map<String, Object> storedParent = findById(parentId, items);
            if (storedParent != null) {
                parentType = stringField(storedParent, "type");
            } else {
                parentType = batchTypesById.get(parentId);
            }
            if (parentType == null) {
                throw new IllegalArgumentException(
                    "appended item '" + id + "' references unknown parent '" + parentId + "'");
            }
            if (!"epic".equalsIgnoreCase(parentType) && !"feature".equalsIgnoreCase(parentType)) {
                throw new IllegalArgumentException(
                    "appended item '" + id + "' must parent to an epic or feature; parent '"
                        + parentId + "' is a " + parentType);
            }
            knownIds.add(id);
            String type = stringField(copy, "type");
            if (type != null) {
                batchTypesById.put(id, type);
            }
            appendedCopies.add(copy);
        }

        // Merge: append the new items and stamp the target epic's expansion
        // state. Every OTHER item (and every other epic's expansionState) is
        // carried through verbatim.
        items.addAll(appendedCopies);
        epic.put("expansionState", expansionState);

        bookOfWork.put("items", items);
        draft.setBookOfWorkJson(bookOfWork);
        draft.setUpdatedAt(Instant.now());
        GeneratedMigrationBookOfWorkEntity saved = repository.save(draft);

        log.info(
            "[diag-ams] book_of_work stage=append_items draftId={} epicId={} appended={} "
                + "skippedSuppressed={} expansionState={}",
            bookId, request.epicId(), appendedCopies.size(), skippedSuppressed, expansionState);

        return GeneratedMigrationBookOfWorkMapper.toDto(saved);
    }

    /**
     * Like {@link #requireDraft(UUID, UUID)} but loads the row with a
     * pessimistic WRITE lock so concurrent {@code items/append} merges
     * serialise rather than last-write-wins on {@code book_of_work_json}.
     */
    private GeneratedMigrationBookOfWorkEntity requireDraftForUpdate(UUID projectId, UUID bookId) {
        if (projectId == null || bookId == null) {
            throw new ResourceNotFoundException(
                "Migration book of work not found: " + bookId);
        }
        Optional<GeneratedMigrationBookOfWorkEntity> opt = repository.findWithLockById(bookId);
        if (opt.isEmpty() || !projectId.equals(opt.get().getProjectId())) {
            throw new ResourceNotFoundException(
                "Migration book of work not found: " + bookId);
        }
        return opt.get();
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    private GeneratedMigrationBookOfWorkEntity requireDraft(UUID projectId, UUID bookId) {
        if (projectId == null || bookId == null) {
            throw new ResourceNotFoundException(
                "Migration book of work not found: " + bookId);
        }
        Optional<GeneratedMigrationBookOfWorkEntity> opt = repository.findById(bookId);
        if (opt.isEmpty() || !projectId.equals(opt.get().getProjectId())) {
            throw new ResourceNotFoundException(
                "Migration book of work not found: " + bookId);
        }
        return opt.get();
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> extractItems(Map<String, Object> bookOfWork) {
        if (bookOfWork == null) return null;
        Object raw = bookOfWork.get("items");
        if (raw instanceof List<?> rawList) {
            List<Map<String, Object>> out = new ArrayList<>(rawList.size());
            for (Object o : rawList) {
                if (o instanceof Map<?, ?> m) {
                    // Wrap a defensive LinkedHashMap copy so .put() mutations on the
                    // item later on do not alter shared state on the source map.
                    LinkedHashMap<String, Object> copy = new LinkedHashMap<>();
                    for (Map.Entry<?, ?> e : m.entrySet()) {
                        if (e.getKey() instanceof String k) {
                            copy.put(k, e.getValue());
                        }
                    }
                    out.add(copy);
                }
            }
            return out;
        }
        return null;
    }

    private static String stringField(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v instanceof String ? (String) v : null;
    }

    private static Integer sequenceOrderOf(Map<String, Object> m) {
        Object v = m.get("sequenceOrder");
        if (v instanceof Number n) return n.intValue();
        if (v instanceof String s) {
            try {
                return Integer.parseInt(s);
            } catch (NumberFormatException ignore) {
                return null;
            }
        }
        return null;
    }

    private static int depthOf(Map<String, Object> item, List<Map<String, Object>> all) {
        // Walk parentId chain to compute depth. Capped at 8 to defend against
        // accidental cycles in malformed input -- hierarchy validation in the
        // gateway should already reject cycles before save (see spec.md Group 5).
        int depth = 0;
        String pid = stringField(item, "parentId");
        Set<String> seen = new HashSet<>();
        seen.add(stringField(item, "id"));
        while (pid != null && depth < 8) {
            if (seen.contains(pid)) break;
            seen.add(pid);
            depth++;
            Map<String, Object> parent = findById(pid, all);
            if (parent == null) break;
            pid = stringField(parent, "parentId");
        }
        return depth;
    }

    private static Map<String, Object> findById(String id, List<Map<String, Object>> all) {
        for (Map<String, Object> it : all) {
            if (id.equals(stringField(it, "id"))) return it;
        }
        return null;
    }

    /** The blob-level tombstone list key (Phase 1a story deletion). */
    private static final String SUPPRESSED_ITEM_IDS_KEY = "suppressed_item_ids";

    /** Read the tombstoned item-id set from the blob root ([] when absent). */
    @SuppressWarnings("unchecked")
    private static Set<String> readSuppressedIds(Map<String, Object> bookOfWork) {
        Object raw = bookOfWork.get(SUPPRESSED_ITEM_IDS_KEY);
        if (!(raw instanceof List<?> list)) return Set.of();
        Set<String> out = new HashSet<>();
        for (Object o : list) {
            if (o instanceof String s && !s.isBlank()) out.add(s);
        }
        return out;
    }

    /**
     * DELETE a story from the plan (Phase 1a, 2026-07-20) — the "the plan
     * created something unwanted" escape hatch, distinct from an unresolved
     * problem. Story-type only, one story per call (never bulk). Mechanics:
     * the item is removed from {@code book_of_work_json.items} AND its id is
     * recorded in {@code suppressed_item_ids} so deterministic re-expansion
     * (which regenerates the SAME ids) cannot resurrect it; a linked WorkItem
     * is best-effort archived ({@code status='ARCHIVED'}). The oracle is
     * unshrunk: pack surfaces stay in parity scope, so deleting a story that
     * mattered surfaces as reconcile drift.
     */
    @Transactional
    public GeneratedMigrationBookOfWorkDto deleteStoryItem(
        UUID projectId, UUID bookId, String bookItemId) {
        GeneratedMigrationBookOfWorkEntity draft = repository.findById(bookId)
            .filter(e -> projectId.equals(e.getProjectId()))
            .orElseThrow(() -> new IllegalArgumentException(
                "Unknown book of work '" + bookId + "' for project " + projectId));
        if ("archived".equalsIgnoreCase(draft.getStatus())) {
            throw new IllegalArgumentException(
                "Cannot delete items from an archived book of work");
        }
        Map<String, Object> bookOfWork = draft.getBookOfWorkJson();
        List<Map<String, Object>> extracted = extractItems(bookOfWork);
        List<Map<String, Object>> items = extracted != null ? extracted : new ArrayList<>();

        Map<String, Object> item = findById(bookItemId, items);
        if (item == null) {
            throw new IllegalArgumentException(
                "Unknown item id '" + bookItemId + "' in book_of_work_json");
        }
        if (!"story".equalsIgnoreCase(stringField(item, "type"))) {
            throw new IllegalArgumentException(
                "Only STORY items can be deleted; '" + bookItemId + "' is a "
                    + stringField(item, "type"));
        }

        // Remove + tombstone.
        items.removeIf(it -> bookItemId.equals(stringField(it, "id")));
        List<String> suppressed = new ArrayList<>(readSuppressedIds(bookOfWork));
        if (!suppressed.contains(bookItemId)) suppressed.add(bookItemId);
        bookOfWork.put(SUPPRESSED_ITEM_IDS_KEY, suppressed);
        bookOfWork.put("items", items);

        // Best-effort archive of the linked WorkItem (backlog shows archived
        // items behind its toggle; never blocks the deletion).
        String workItemIdRaw = stringField(item, "workItemId");
        if (workItemIdRaw != null) {
            try {
                UUID workItemId = UUID.fromString(workItemIdRaw);
                workItemRepository.findByIdAndProjectId(workItemId, projectId)
                    .ifPresent(wi -> {
                        wi.setStatus("ARCHIVED");
                        workItemRepository.save(wi);
                    });
            } catch (RuntimeException ex) {
                log.warn(
                    "[diag-ams] book_of_work stage=delete_item work_item_archive_failed "
                        + "bookItemId={} reason={}",
                    bookItemId, ex.getMessage());
            }
        }

        draft.setBookOfWorkJson(bookOfWork);
        draft.setUpdatedAt(Instant.now());
        GeneratedMigrationBookOfWorkEntity saved = repository.save(draft);
        log.info(
            "[diag-ams] book_of_work stage=delete_item draftId={} bookItemId={} "
                + "workItemArchived={} suppressedTotal={}",
            bookId, bookItemId, workItemIdRaw != null, suppressed.size());
        return GeneratedMigrationBookOfWorkMapper.toDto(saved);
    }

    /**
     * All transitive descendant ids of {@code rootId} (children, grandchildren,
     * ...) via the {@code parentId} chain -- the root itself is NOT included.
     * Fixed-point iteration so hierarchy order in the list does not matter.
     */
    private static Set<String> collectDescendantIds(
        String rootId, List<Map<String, Object>> items) {
        Set<String> descendants = new HashSet<>();
        boolean changed = true;
        while (changed) {
            changed = false;
            for (Map<String, Object> it : items) {
                String id = stringField(it, "id");
                String pid = stringField(it, "parentId");
                if (id == null || pid == null || descendants.contains(id)) continue;
                if (rootId.equals(pid) || descendants.contains(pid)) {
                    descendants.add(id);
                    changed = true;
                }
            }
        }
        return descendants;
    }

    private static Set<String> toIdSet(List<String> list) {
        if (list == null) return Set.of();
        return new HashSet<>(list);
    }

    /**
     * Compute the set of admitted item ids after applying the save-mode filter
     * AND the parent-inclusion rule (Q-8): if a descendant passes the filter,
     * its ancestor chain is auto-admitted even if those ancestors would not
     * pass the filter on their own.
     */
    private static Set<String> computeAdmittedIds(
        List<Map<String, Object>> items,
        String saveMode,
        Set<String> selectedIds,
        Set<String> excludedIds) {
        Set<String> admitted = new HashSet<>();
        for (Map<String, Object> it : items) {
            String id = stringField(it, "id");
            if (id == null) continue;
            if (excludedIds.contains(id)) continue;
            if (admittedByMode(it, saveMode, selectedIds)) {
                admitted.add(id);
            }
        }
        // Parent-inclusion rule: walk up each admitted item's parent chain and
        // admit each ancestor (subject to the exclusion list).
        Set<String> ancestorsToAdd = new HashSet<>();
        for (String id : admitted) {
            Map<String, Object> item = findById(id, items);
            if (item == null) continue;
            String pid = stringField(item, "parentId");
            int guard = 0;
            while (pid != null && guard < 8) {
                if (excludedIds.contains(pid)) break;
                ancestorsToAdd.add(pid);
                Map<String, Object> parent = findById(pid, items);
                if (parent == null) break;
                pid = stringField(parent, "parentId");
                guard++;
            }
        }
        admitted.addAll(ancestorsToAdd);
        return admitted;
    }

    private static boolean admittedByMode(Map<String, Object> item, String saveMode, Set<String> selectedIds) {
        switch (saveMode) {
            case SaveGeneratedMigrationBookOfWorkRequest.MODE_ALL:
                return true;
            case SaveGeneratedMigrationBookOfWorkRequest.MODE_SELECTED:
                return selectedIds.contains(stringField(item, "id"));
            case SaveGeneratedMigrationBookOfWorkRequest.MODE_HIGH_CONFIDENCE_ONLY:
                return "high".equals(stringField(item, "confidence"));
            case SaveGeneratedMigrationBookOfWorkRequest.MODE_READY_FOR_SPEC_ONLY:
                return "ready_for_spec".equals(stringField(item, "readiness"));
            default:
                return false;
        }
    }

    private static void bumpCount(
        Map<String, Map<String, Integer>> countsByType, String type, String key) {
        if (type == null) type = "unknown";
        Map<String, Integer> bucket = countsByType.computeIfAbsent(type, k -> {
            Map<String, Integer> b = new LinkedHashMap<>();
            b.put("saved", 0);
            b.put("failed", 0);
            b.put("skipped", 0);
            return b;
        });
        bucket.put(key, bucket.getOrDefault(key, 0) + 1);
    }

    /**
     * Per-item save worker. Spring proxies {@code @Transactional} only when the
     * call crosses a bean boundary -- so the per-item commit must be invoked
     * via this injected collaborator, not via {@code this.persistOne(...)}.
     *
     * <p>Declared {@code @Transactional(propagation = REQUIRES_NEW)} so each
     * item-save runs in its own transaction. A failure in one item does NOT
     * abort the outer orchestration loop in
     * {@link #saveToBacklog(UUID, UUID, SaveGeneratedMigrationBookOfWorkRequest)};
     * the orchestrator catches the RuntimeException, stamps the failure on the
     * draft, and continues with the next item (Q-5).</p>
     */
    @Service
    @ConditionalOnProperty(
        name = "app.features.include-database",
        havingValue = "true",
        matchIfMissing = true
    )
    @RequiredArgsConstructor
    public static class GeneratedMigrationBookOfWorkItemSaver {

        private final WorkItemRepository workItemRepository;

        /**
         * Persist exactly one draft item into the {@code work_item} table.
         * Each invocation runs in its own transaction. Returns the created
         * {@code workItemId} so the caller can record it on the draft AND
         * resolve in-batch parent references.
         */
        @Transactional(propagation = Propagation.REQUIRES_NEW)
        public UUID persistOne(
            UUID projectId,
            Map<String, Object> draftItem,
            UUID resolvedParentId,
            SaveGeneratedMigrationBookOfWorkRequest request) {
            String title = stringField(draftItem, "title");
            if (title == null || title.isBlank()) {
                throw new IllegalArgumentException(
                    "draft item missing required field 'title' (id="
                        + stringField(draftItem, "id") + ")");
            }
            String type = normaliseType(stringField(draftItem, "type"));
            String description = buildDescription(draftItem, request);
            String status = (request.statusForCreatedItems() != null
                && !request.statusForCreatedItems().isBlank())
                ? request.statusForCreatedItems()
                : DEFAULT_WORK_ITEM_STATUS;
            Integer sortOrder = sequenceOrderOf(draftItem);

            WorkItemEntity entity = WorkItemEntity.builder()
                .id(UUID.randomUUID())
                .projectId(projectId)
                .type(type)
                .parentId(resolvedParentId)
                .title(title)
                .description(description)
                .status(status)
                .sortOrder(sortOrder != null ? sortOrder : 0)
                .priority(null)
                .targetWindow(null)
                .tagsJson(buildTagsJson(draftItem, request))
                .externalSystem(null)
                .externalKey(null)
                .externalUrl(null)
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();

            WorkItemEntity saved = workItemRepository.save(entity);
            return saved.getId();
        }

        /**
         * Normalise type casing to the legacy UPPERCASE convention used
         * elsewhere in the codebase (per Group 2 audit). Accepts both
         * lowercase ({@code initiative|epic|feature|story}) and uppercase
         * input.
         */
        private static String normaliseType(String raw) {
            if (raw == null) {
                throw new IllegalArgumentException("draft item missing required field 'type'");
            }
            return raw.toUpperCase();
        }

        /**
         * Build the description for the created work item. Starts with the
         * draft item's description, optionally appending acceptance criteria,
         * traceability summary, and readiness sections. Stable section markers
         * (---) so subsequent edits in the work-item UI can detect generated
         * vs hand-edited content.
         */
        @SuppressWarnings("unchecked")
        private static String buildDescription(
            Map<String, Object> draftItem, SaveGeneratedMigrationBookOfWorkRequest request) {
            StringBuilder sb = new StringBuilder();
            String desc = stringField(draftItem, "description");
            if (desc != null) sb.append(desc);

            Object ac = draftItem.get("acceptanceCriteria");
            if (ac instanceof List<?> acList && !acList.isEmpty()) {
                if (sb.length() > 0) sb.append("\n\n");
                sb.append("---\nAcceptance Criteria:\n");
                for (Object item : acList) {
                    sb.append("- ").append(item == null ? "" : item.toString()).append("\n");
                }
            }

            if (Boolean.TRUE.equals(request.includeTraceabilityInDescription())) {
                String trace = stringField(draftItem, "traceabilitySummary");
                if (trace != null && !trace.isBlank()) {
                    if (sb.length() > 0) sb.append("\n\n");
                    sb.append("---\nTraceability:\n").append(trace);
                }
            }

            if (Boolean.TRUE.equals(request.includeReadinessInDescription())) {
                String readiness = stringField(draftItem, "readiness");
                Object reasons = draftItem.get("readinessReasons");
                if (readiness != null) {
                    if (sb.length() > 0) sb.append("\n\n");
                    sb.append("---\nReadiness: ").append(readiness);
                    if (reasons instanceof List<?> rList && !rList.isEmpty()) {
                        sb.append("\nReasons:\n");
                        for (Object r : rList) {
                            sb.append("- ").append(r == null ? "" : r.toString()).append("\n");
                        }
                    }
                }
            }

            return sb.length() == 0 ? null : sb.toString();
        }

        /**
         * Build the tags JSONB blob, applying {@code tagPrefix} per Q-10. The
         * blob is keyed by tag (not a flat array) so existing tag-set semantics
         * elsewhere in the codebase carry through: same tag -> no-op, different
         * tag with same prefix -> additive. Existing work items are never
         * touched, so "preserving existing tags" trivially holds for the
         * create-only save flow.
         */
        @SuppressWarnings("unchecked")
        private static Map<String, Object> buildTagsJson(
            Map<String, Object> draftItem, SaveGeneratedMigrationBookOfWorkRequest request) {
            Object rawTags = draftItem.get("tags");
            if (!(rawTags instanceof List<?> tagList) || tagList.isEmpty()) {
                return null;
            }
            String prefix = request.tagPrefix();
            Map<String, Object> out = new LinkedHashMap<>();
            for (Object t : tagList) {
                if (t == null) continue;
                String tag = t.toString();
                if (tag.isBlank()) continue;
                String finalTag = (prefix != null && !prefix.isBlank()) ? (prefix + tag) : tag;
                // Idempotent: same tag -> no-op (LinkedHashMap put on existing
                // key is harmless).
                out.put(finalTag, Boolean.TRUE);
            }
            return out.isEmpty() ? null : out;
        }
    }
}
