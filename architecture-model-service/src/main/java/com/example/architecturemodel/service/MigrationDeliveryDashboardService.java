package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.MigrationDeliveryBacklogSaveSummaryDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryDashboardDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryEvidenceSummaryDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryHierarchyNodeDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryImplementationSummaryDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryNeedsAttentionItemDto;
import com.example.architecturemodel.model.dto.MigrationDeliverySpecGenerationSummaryDto;
import com.example.architecturemodel.model.dto.MigrationDeliverySummaryDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryWorkstreamSummaryDto;
import com.example.architecturemodel.model.dto.MissingInputEntry;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.entity.WorkItemImplementWorkspaceEntity;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.WorkItemImplementWorkspaceRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Read-only aggregation service that rolls up a single
 * {@link GeneratedMigrationBookOfWorkEntity} into a
 * {@link MigrationDeliveryDashboardDto} for the new delivery-dashboard
 * endpoint.
 *
 * <p><b>Strict no-N+1 invariant (AC 18).</b> Hierarchy comes from
 * {@code book_of_work_json} (in-memory parse). Joined data is fetched in
 * exactly three batched repository calls:</p>
 * <ol>
 *   <li>{@link WorkItemRepository#findAllById(Iterable)} -- one round-trip for
 *       every stored {@code workItemId} on the book.</li>
 *   <li>{@code MigrationStorySpecGenerationRepository.findByBookOfWorkId(bookId)}
 *       -- one round-trip for the spec-generation rows;
 *       latest-attempt-per-workItem is reduced in memory.</li>
 *   <li>{@code WorkItemImplementWorkspaceRepository.findAll()} filtered to the
 *       matched WorkItem ids -- one round-trip.</li>
 * </ol>
 *
 * <p><b>Hierarchy source.</b> Built exclusively from
 * {@code book_of_work_json.items[]} (AC 4). The service NEVER walks the
 * WorkItem table to derive structure.</p>
 *
 * <p><b>WorkItem linkage (Addition B, AC 14).</b> Each book-item is joined to
 * its WorkItem strictly by the stored {@code workItemId} field on the JSONB
 * payload. Title-matching is forbidden. An orphan (stored id with no matching
 * WorkItem row) renders as {@code backlogStatus='not_saved_to_backlog'} AND
 * appends a {@code warnings[]} entry naming the affected item. The orphan id
 * is NOT auto-repaired (Q-5, AC 15).</p>
 *
 * <p><b>Workstream roll-up (AC 6).</b> Per-workstream totals + status
 * breakdowns are computed from the same in-memory items / WorkItem /
 * spec-generation / workspace data; no additional repository calls --
 * preserves the no-N+1 batch-fetch invariant.</p>
 *
 * <p><b>Addition C surfacing.</b> Spec-generation rows with
 * {@code status='insufficient_context'} project their {@code missing_inputs_json[]}
 * entries verbatim into:</p>
 * <ul>
 *   <li>{@link MigrationDeliveryNeedsAttentionItemDto#missingInputs()} on the
 *       corresponding needs-attention row.</li>
 *   <li>{@link MigrationDeliveryHierarchyNodeDto#missingInputsCount()} on the
 *       corresponding hierarchy node.</li>
 * </ul>
 *
 * <p><b>Needs-attention priority (AC 7, Q-1).</b> Rows are sorted by
 * {@code failed > insufficient_context > blocked > not_saved_to_backlog
 * > generated_with_warnings}. {@code generated_with_warnings} rows are
 * suppressed once the corresponding implementation activity is past
 * {@code not_started} (Q-1).</p>
 *
 * <p><b>14-day staleness window (Q-1).</b> A story counts as "active" if its
 * {@code WorkItem.updatedAt} is within the last 14 days at dashboard read
 * time.</p>
 *
 * <p><b>Partial roll-up tolerance (Q-11, AC 16).</b> Each subsection's
 * computation is wrapped: if it throws, the service appends a
 * {@code warnings[]} entry naming the subsection and the dashboard returns
 * with the other sections populated. The service NEVER throws past this
 * boundary; the endpoint contract is 200 + warnings, not 5xx.</p>
 *
 * <p><b>Soft-warning at >500 stories (Q-2, AC 17).</b> If the total story
 * count exceeds {@link #SOFT_WARNING_STORY_THRESHOLD}, the service appends a
 * soft-warning entry. The frontend uses this to display the size banner; the
 * full payload is still returned.</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * {@code agent-os/specs/2026-05-19-migration-delivery-progress-and-evidence-tracking/spec.md}.
 * Task Group 3.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class MigrationDeliveryDashboardService {

    /**
     * Sizing threshold (Q-2, AC 17). When the book contains more than this
     * number of stories the service emits a soft-warning entry advising the
     * frontend to display the size banner. The full payload is still
     * returned; v1 does NOT introduce server-side pagination.
     */
    static final long SOFT_WARNING_STORY_THRESHOLD = 500L;

    /**
     * 14-day staleness window per Q-1: a story is considered "active" if its
     * {@code WorkItem.updatedAt} is within this window of dashboard read time.
     */
    static final Duration ACTIVE_STALENESS_WINDOW = Duration.ofDays(14);

    /**
     * Priority order for needs-attention rows (AC 7). The lower the index,
     * the higher the priority.
     */
    private static final List<String> NEEDS_ATTENTION_PRIORITY = List.of(
        "failed",
        "insufficient_context",
        "blocked",
        "not_saved_to_backlog",
        "generated_with_warnings"
    );

    private final GeneratedMigrationBookOfWorkRepository bookRepository;
    private final WorkItemRepository workItemRepository;
    private final MigrationStorySpecGenerationRepository specGenerationRepository;
    private final WorkItemImplementWorkspaceRepository workspaceRepository;

    /**
     * Load the delivery dashboard for a single book of work.
     *
     * <p>Returns a fully-populated {@link MigrationDeliveryDashboardDto}. On
     * subsection-level failures, the dashboard still returns successfully --
     * the failed subsection is named in {@code warnings[]} and the rest of
     * the payload is populated as far as the data allowed (Q-11, AC 16).</p>
     *
     * @param projectId the owning project UUID
     * @param bookId the book of work UUID
     * @return the populated dashboard DTO
     * @throws ResourceNotFoundException if the book does not exist or does
     *         not belong to the project
     */
    @Transactional(readOnly = true)
    public MigrationDeliveryDashboardDto loadDashboard(UUID projectId, UUID bookId) {
        Instant startedAt = Instant.now();
        log.info("[diag-ams] delivery_dashboard load_started bookId={} projectId={}", bookId, projectId);

        // Step 1: load + validate ownership. A 404 here is an intentional contract
        // (vs the partial-roll-up tolerance which only applies AFTER the book
        // has been resolved successfully).
        GeneratedMigrationBookOfWorkEntity book = requireBook(projectId, bookId);

        List<String> warnings = new ArrayList<>();

        // Step 2: parse book_of_work_json -> raw items list (in-memory only).
        List<Map<String, Object>> items;
        try {
            items = extractItems(book.getBookOfWorkJson());
        } catch (RuntimeException ex) {
            log.warn("[diag-ams] delivery_dashboard subsection_failed bookId={} subsection=hierarchy_parse error={}",
                bookId, ex.toString());
            warnings.add("Could not load hierarchy: " + ex.getMessage());
            items = new ArrayList<>();
        }
        final List<Map<String, Object>> finalItems = items;

        // Step 3: batch-fetch WorkItems for every stored workItemId. Capture
        // the set of stored ids to detect orphans below.
        Set<UUID> storedWorkItemIds = collectStoredWorkItemIds(finalItems);
        Map<UUID, WorkItemEntity> workItemsById = safeLoadSubsection(
            "work_items",
            warnings,
            () -> batchFetchWorkItems(storedWorkItemIds),
            Collections.emptyMap()
        );

        // Step 4: batch-fetch spec-generation rows for the book; reduce to
        // latest-attempt per WorkItem in memory (single SQL round-trip).
        Map<UUID, MigrationStorySpecGenerationEntity> latestSpecByWorkItem = safeLoadSubsection(
            "spec_generations",
            warnings,
            () -> latestSpecGenerationsPerWorkItem(bookId),
            Collections.emptyMap()
        );

        // Step 5: batch-fetch implementation workspaces for the matched
        // WorkItems. We fetch all-project rows once and key by workItemId in
        // memory to avoid N per-item lookups.
        Map<UUID, WorkItemImplementWorkspaceEntity> workspacesByWorkItem = safeLoadSubsection(
            "implementation_workspaces",
            warnings,
            () -> batchFetchWorkspaces(projectId, workItemsById.keySet()),
            Collections.emptyMap()
        );

        // Step 6+: build per-item derived state. We compute saved/unsaved
        // (Step 6), spec status (Step 7), missingInputsCount (Step 8),
        // implementation status (Step 9), evidence coverage (Step 10) all in
        // a single pass over items to keep the in-memory shape minimal.
        Instant readTime = Instant.now();
        Map<String, ItemDerivedState> derivedStateByItemId = new LinkedHashMap<>();
        for (Map<String, Object> item : finalItems) {
            String itemId = stringField(item, "id");
            if (itemId == null) continue;
            try {
                ItemDerivedState s = deriveItemState(
                    item, workItemsById, latestSpecByWorkItem, workspacesByWorkItem,
                    readTime, warnings);
                derivedStateByItemId.put(itemId, s);
            } catch (RuntimeException ex) {
                // Per-item derivation should not blow up the whole dashboard.
                // Log and skip the item -- it will be omitted from the
                // hierarchy / summaries / needs-attention.
                log.warn("[diag-ams] delivery_dashboard item_derivation_failed bookId={} itemId={} error={}",
                    bookId, itemId, ex.toString());
            }
        }

        // Step 2/8: build the hierarchy node tree from items + derived state.
        List<MigrationDeliveryHierarchyNodeDto> hierarchy = safeLoadSubsection(
            "hierarchy",
            warnings,
            () -> buildHierarchy(finalItems, derivedStateByItemId),
            Collections.emptyList()
        );

        // Step 12: build needs-attention rows in priority order with
        // generated_with_warnings suppression.
        List<MigrationDeliveryNeedsAttentionItemDto> needsAttention = safeLoadSubsection(
            "needs_attention",
            warnings,
            () -> buildNeedsAttention(finalItems, derivedStateByItemId),
            Collections.emptyList()
        );

        // Step 13: build all 5 sibling *Summary DTOs.
        MigrationDeliverySummaryDto summary = safeLoadSubsection(
            "summary",
            warnings,
            () -> buildSummary(finalItems, needsAttention),
            emptySummary()
        );
        MigrationDeliveryBacklogSaveSummaryDto backlogSaveSummary = safeLoadSubsection(
            "backlog_save_summary",
            warnings,
            () -> buildBacklogSaveSummary(finalItems, derivedStateByItemId),
            emptyBacklogSaveSummary()
        );
        MigrationDeliverySpecGenerationSummaryDto specGenerationSummary = safeLoadSubsection(
            "spec_generation_summary",
            warnings,
            () -> buildSpecGenerationSummary(finalItems, derivedStateByItemId),
            emptySpecGenerationSummary()
        );
        MigrationDeliveryImplementationSummaryDto implementationSummary = safeLoadSubsection(
            "implementation_summary",
            warnings,
            () -> buildImplementationSummary(finalItems, derivedStateByItemId),
            emptyImplementationSummary()
        );
        MigrationDeliveryEvidenceSummaryDto evidenceSummary = safeLoadSubsection(
            "evidence_summary",
            warnings,
            () -> buildEvidenceSummary(finalItems),
            emptyEvidenceSummary()
        );
        List<MigrationDeliveryWorkstreamSummaryDto> workstreamSummaries = safeLoadSubsection(
            "workstream_summaries",
            warnings,
            () -> buildWorkstreamSummaries(finalItems, derivedStateByItemId, needsAttention),
            Collections.emptyList()
        );

        // Step 14: soft warning for >500 stories. The frontend renders the
        // banner; the full payload is still returned.
        long storyCount = countStories(finalItems);
        if (storyCount > SOFT_WARNING_STORY_THRESHOLD) {
            warnings.add(String.format(
                "This book contains %d stories; rendering may be slow.",
                storyCount));
        }

        long durationMs = Duration.between(startedAt, Instant.now()).toMillis();
        log.info(
            "[diag-ams] delivery_dashboard load_completed bookId={} itemCount={} warningsCount={} durationMs={}",
            bookId, finalItems.size(), warnings.size(), durationMs);

        return new MigrationDeliveryDashboardDto(
            book.getId(),
            book.getProjectId(),
            book.getCurrentArchitectureId(),
            book.getTargetArchitectureId(),
            book.getTitle(),
            book.getStatus(),
            book.getCreatedAt() == null ? null : book.getCreatedAt().toString(),
            summary,
            hierarchy,
            workstreamSummaries,
            specGenerationSummary,
            backlogSaveSummary,
            implementationSummary,
            evidenceSummary,
            needsAttention,
            warnings
        );
    }

    // -----------------------------------------------------------------------
    // Step 1 -- book load + ownership validation
    // -----------------------------------------------------------------------

    private GeneratedMigrationBookOfWorkEntity requireBook(UUID projectId, UUID bookId) {
        if (projectId == null || bookId == null) {
            throw new ResourceNotFoundException(
                "Migration book of work not found: " + bookId);
        }
        Optional<GeneratedMigrationBookOfWorkEntity> opt = bookRepository.findById(bookId);
        if (opt.isEmpty() || !projectId.equals(opt.get().getProjectId())) {
            throw new ResourceNotFoundException(
                "Migration book of work not found: " + bookId);
        }
        return opt.get();
    }

    // -----------------------------------------------------------------------
    // Step 2 -- parse book_of_work_json
    // -----------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> extractItems(Map<String, Object> bookOfWork) {
        if (bookOfWork == null) return new ArrayList<>();
        Object raw = bookOfWork.get("items");
        if (!(raw instanceof List<?> rawList)) return new ArrayList<>();
        List<Map<String, Object>> out = new ArrayList<>(rawList.size());
        for (Object o : rawList) {
            if (o instanceof Map<?, ?> m) {
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

    // -----------------------------------------------------------------------
    // Step 3 -- batch fetch WorkItems
    // -----------------------------------------------------------------------

    private static Set<UUID> collectStoredWorkItemIds(List<Map<String, Object>> items) {
        Set<UUID> out = new LinkedHashSet<>();
        for (Map<String, Object> item : items) {
            UUID id = parseStoredWorkItemId(item);
            if (id != null) out.add(id);
        }
        return out;
    }

    private static UUID parseStoredWorkItemId(Map<String, Object> item) {
        Object raw = item.get("workItemId");
        if (raw == null) return null;
        if (raw instanceof UUID u) return u;
        if (raw instanceof String s) {
            try {
                return UUID.fromString(s);
            } catch (IllegalArgumentException ignore) {
                // legacy non-UUID workItemId on the blob -- treat as absent
                return null;
            }
        }
        return null;
    }

    private Map<UUID, WorkItemEntity> batchFetchWorkItems(Collection<UUID> ids) {
        if (ids == null || ids.isEmpty()) {
            return Collections.emptyMap();
        }
        List<WorkItemEntity> rows = workItemRepository.findAllById(ids);
        Map<UUID, WorkItemEntity> byId = new HashMap<>(rows.size());
        for (WorkItemEntity row : rows) {
            byId.put(row.getId(), row);
        }
        return byId;
    }

    // -----------------------------------------------------------------------
    // Step 4 -- batch fetch spec generations, reduce to latest-per-WorkItem
    // -----------------------------------------------------------------------

    private Map<UUID, MigrationStorySpecGenerationEntity> latestSpecGenerationsPerWorkItem(UUID bookId) {
        List<MigrationStorySpecGenerationEntity> rows = specGenerationRepository.findByBookOfWorkId(bookId);
        if (rows == null || rows.isEmpty()) {
            return Collections.emptyMap();
        }
        Map<UUID, MigrationStorySpecGenerationEntity> latest = new HashMap<>();
        for (MigrationStorySpecGenerationEntity row : rows) {
            UUID wid = row.getWorkItemId();
            if (wid == null) continue;
            MigrationStorySpecGenerationEntity existing = latest.get(wid);
            if (existing == null
                || compareAttempt(row, existing) > 0) {
                latest.put(wid, row);
            }
        }
        return latest;
    }

    private static int compareAttempt(
        MigrationStorySpecGenerationEntity a,
        MigrationStorySpecGenerationEntity b) {
        Integer aN = a.getGenerationAttemptNumber();
        Integer bN = b.getGenerationAttemptNumber();
        int byNumber = Integer.compare(aN == null ? 0 : aN, bN == null ? 0 : bN);
        if (byNumber != 0) return byNumber;
        Instant aT = a.getCreatedAt();
        Instant bT = b.getCreatedAt();
        if (aT == null && bT == null) return 0;
        if (aT == null) return -1;
        if (bT == null) return 1;
        return aT.compareTo(bT);
    }

    // -----------------------------------------------------------------------
    // Step 5 -- batch fetch workspaces for matched WorkItems
    // -----------------------------------------------------------------------

    private Map<UUID, WorkItemImplementWorkspaceEntity> batchFetchWorkspaces(
        UUID projectId, Collection<UUID> workItemIds) {
        if (workItemIds == null || workItemIds.isEmpty()) {
            return Collections.emptyMap();
        }
        // Single round-trip: load every workspace for the project, then key by
        // workItemId in memory. The set of workItemIds we'll inspect is bounded
        // by the matched WorkItems map -- typically small relative to the
        // overall project workspace count, so this is acceptable for v1's
        // ~500-story ceiling.
        List<WorkItemImplementWorkspaceEntity> rows = workspaceRepository.findAll();
        Map<UUID, WorkItemImplementWorkspaceEntity> byWorkItem = new HashMap<>();
        Set<UUID> filter = new HashSet<>(workItemIds);
        for (WorkItemImplementWorkspaceEntity row : rows) {
            if (row.getProjectId() == null || !row.getProjectId().equals(projectId)) continue;
            if (!filter.contains(row.getWorkItemId())) continue;
            byWorkItem.put(row.getWorkItemId(), row);
        }
        return byWorkItem;
    }

    // -----------------------------------------------------------------------
    // Steps 6-10 -- per-item state derivation
    // -----------------------------------------------------------------------

    /**
     * Holds the derived state for one book item -- the set of computed values
     * the hierarchy / needs-attention / summary builders share.
     */
    private record ItemDerivedState(
        String itemId,
        String parentId,
        String type,
        String title,
        String workstream,
        Integer sequenceOrder,
        UUID workItemId,
        boolean workItemFound,
        String backlogStatus,
        String specGenerationStatus,
        String specGenerationConfidence,
        String staleReason,
        String qualityGrade,
        Boolean manuallyEdited,
        List<MissingInputEntry> missingInputs,
        long missingInputsCount,
        String implementationStatus,
        boolean implementationPastNotStarted,
        boolean activeWithinWindow,
        boolean blocked,
        String evidenceStatus,
        boolean anyEvidenceCoverage,
        String needsAttentionType,
        String needsAttentionReason
    ) {}

    private ItemDerivedState deriveItemState(
        Map<String, Object> item,
        Map<UUID, WorkItemEntity> workItemsById,
        Map<UUID, MigrationStorySpecGenerationEntity> latestSpecByWorkItem,
        Map<UUID, WorkItemImplementWorkspaceEntity> workspacesByWorkItem,
        Instant readTime,
        List<String> warnings) {

        String itemId = stringField(item, "id");
        String parentId = stringField(item, "parentId");
        String type = stringField(item, "type");
        String title = stringField(item, "title");
        String workstream = stringField(item, "workstream");
        Integer sequenceOrder = sequenceOrderOf(item);

        UUID storedWorkItemId = parseStoredWorkItemId(item);
        WorkItemEntity workItem = (storedWorkItemId == null)
            ? null
            : workItemsById.get(storedWorkItemId);

        // Step 6: backlog-save derivation.
        // - stored id + matching WorkItem found  -> 'saved'
        // - stored id, no match (orphan)         -> 'not_saved_to_backlog' + warning
        // - no stored id                         -> 'not_saved_to_backlog'
        String backlogStatus;
        if (storedWorkItemId != null && workItem != null) {
            backlogStatus = "saved";
        } else {
            backlogStatus = "not_saved_to_backlog";
            if (storedWorkItemId != null) {
                // Orphan: id present on the JSONB blob but WorkItem missing.
                warnings.add(String.format(
                    "Orphan workItemId %s on item '%s' has no matching WorkItem; rendered as not_saved_to_backlog.",
                    storedWorkItemId, title == null ? itemId : title));
            }
        }

        // Step 7: spec-generation status + Addition C missing inputs.
        MigrationStorySpecGenerationEntity latestSpec = (workItem == null)
            ? null
            : latestSpecByWorkItem.get(workItem.getId());
        String specGenerationStatus = latestSpec == null ? null : latestSpec.getStatus();
        String specGenerationConfidence = latestSpec == null ? null : latestSpec.getConfidence();
        // staleReason surfaces the latest spec-generation row's discriminator
        // (target_architecture_changed or resolution_reset) so the dashboard's
        // stale-specs panel can render the per-WorkItem chip variant directly
        // from the node DTO. NULL when the row isn't stale or no spec exists.
        String staleReason = latestSpec == null ? null : latestSpec.getStaleReason();
        // qualityGrade surfaces the latest spec-generation row's letter band
        // (A|B|C|D|F) so the dashboard's hierarchy tree can render the per-
        // story quality chip directly from the node DTO. NULL when no spec
        // exists, the latest spec is insufficient_context / failed (scoring
        // skipped per Spec Quality Scoring policy), or the row pre-dates the
        // 2026-05-20 quality-scoring deploy and has not yet been caught up.
        String qualityGrade = latestSpec == null ? null : latestSpec.getQualityGrade();
        // manuallyEdited surfaces the latest spec-generation row's manually_edited
        // flag so the dashboard's hierarchy tree can render the per-story "Edited"
        // chip directly from the node DTO (no extra fetch per node). NULL when no
        // spec row exists; FALSE for never-edited rows; TRUE once a user has saved
        // a manual edit through the drawer (cleared back to FALSE on a successful
        // overwrite-regenerate). Spec: In-Product Spec Editor + Confirm-Overwrite
        // (2026-05-20) -- Task Group 4.
        Boolean manuallyEdited = latestSpec == null ? null : latestSpec.getManuallyEdited();

        List<MissingInputEntry> missingInputs = Collections.emptyList();
        if (latestSpec != null
            && MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT.equals(latestSpec.getStatus())
            && latestSpec.getMissingInputsJson() != null) {
            missingInputs = latestSpec.getMissingInputsJson().stream()
                .map(MigrationDeliveryDashboardService::mapToMissingInputEntry)
                .toList();
        }

        // Step 8: missingInputsCount lives on the hierarchy node for
        // insufficient-context rows (Addition C).
        long missingInputsCount = missingInputs.size();

        // Step 9: implementation status derived strictly from workspace fields.
        WorkItemImplementWorkspaceEntity workspace = (workItem == null)
            ? null
            : workspacesByWorkItem.get(workItem.getId());
        ImplementationDerived impl = deriveImplementationStatus(workspace);

        // Step 11: 14-day staleness window for "active" determination.
        boolean activeWithinWindow = isActiveWithinWindow(workItem, readTime);

        // Q-1: status=blocked surfaces only when explicitly set. The blocked
        // flag is read from the workspace; we never infer it.
        boolean blocked = impl.blocked();

        // Step 10: evidence coverage from book item metadata only.
        EvidenceDerived ev = deriveEvidenceCoverage(item);

        // Compose needs-attention category + reason. Selection happens in the
        // builder; this provides the candidate label that may or may not
        // qualify after the priority + suppression rules apply.
        String needsAttentionType = null;
        String needsAttentionReason = null;
        if (MigrationStorySpecGenerationStatus.FAILED.equals(specGenerationStatus)) {
            needsAttentionType = "failed";
            needsAttentionReason = "Spec generation failed.";
        } else if (MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT.equals(specGenerationStatus)) {
            needsAttentionType = "insufficient_context";
            needsAttentionReason = "Spec generation reported insufficient context.";
        } else if (blocked) {
            needsAttentionType = "blocked";
            needsAttentionReason = "Implementation workspace is explicitly blocked.";
        } else if ("not_saved_to_backlog".equals(backlogStatus)) {
            needsAttentionType = "not_saved_to_backlog";
            needsAttentionReason = "Story has not been saved to the backlog.";
        } else if (MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS.equals(specGenerationStatus)) {
            needsAttentionType = "generated_with_warnings";
            needsAttentionReason = "Spec generated with warnings.";
        }

        return new ItemDerivedState(
            itemId,
            parentId,
            type,
            title,
            workstream,
            sequenceOrder,
            storedWorkItemId,
            workItem != null,
            backlogStatus,
            specGenerationStatus,
            specGenerationConfidence,
            staleReason,
            qualityGrade,
            manuallyEdited,
            missingInputs,
            missingInputsCount,
            impl.status(),
            impl.pastNotStarted(),
            activeWithinWindow,
            blocked,
            ev.status(),
            ev.anyCoverage(),
            needsAttentionType,
            needsAttentionReason
        );
    }

    private record ImplementationDerived(String status, boolean pastNotStarted, boolean blocked) {}

    private static ImplementationDerived deriveImplementationStatus(
        WorkItemImplementWorkspaceEntity workspace) {
        if (workspace == null || workspace.getWorkspaceState() == null) {
            return new ImplementationDerived("not_started", false, false);
        }
        Map<String, Object> state = workspace.getWorkspaceState();

        // Default status is "not_started" unless the workspace has surfaced
        // explicit progression. We never invent completion state.
        String status = "not_started";

        Object explicitStatus = state.get("status");
        if (explicitStatus instanceof String s && !s.isBlank()) {
            status = s;
        } else {
            // Heuristic: if implementationMode is true (user has opened the
            // Implement tab past the initial setup), treat as in_progress.
            // The workspace JSONB shape on Spec 2026-01-23 carries
            // implementationMode as the canonical 'has user started' flag.
            Object implMode = state.get("implementationMode");
            if (implMode instanceof Boolean b && b) {
                status = "in_progress";
            }
            Object completed = state.get("completed");
            if (completed instanceof Boolean b && b) {
                status = "completed";
            }
        }

        boolean blocked = "blocked".equals(status);
        boolean pastNotStarted = !"not_started".equals(status);
        return new ImplementationDerived(status, pastNotStarted, blocked);
    }

    private static boolean isActiveWithinWindow(WorkItemEntity workItem, Instant readTime) {
        if (workItem == null || workItem.getUpdatedAt() == null) return false;
        Instant cutoff = readTime.minus(ACTIVE_STALENESS_WINDOW);
        return workItem.getUpdatedAt().isAfter(cutoff);
    }

    private record EvidenceDerived(String status, boolean anyCoverage,
                                   boolean hasEvidence, boolean hasDiscovery,
                                   boolean hasApiBaseline, boolean hasMapping,
                                   boolean hasArchitecture) {}

    private static EvidenceDerived deriveEvidenceCoverage(Map<String, Object> item) {
        boolean ev = hasNonEmptyListLike(item.get("evidenceReferences"));
        boolean df = hasNonEmptyListLike(item.get("discoveryFindingReferences"));
        boolean ab = hasNonEmptyListLike(item.get("apiBaselineReferences"));
        boolean mp = hasNonEmptyListLike(item.get("mappingReferences"));
        boolean ar = hasNonEmptyListLike(item.get("architectureReferences"));
        boolean any = ev || df || ab || mp || ar;
        String status = any ? "has_coverage" : "no_coverage";
        return new EvidenceDerived(status, any, ev, df, ab, mp, ar);
    }

    private static boolean hasNonEmptyListLike(Object v) {
        if (v == null) return false;
        if (v instanceof Collection<?> c) return !c.isEmpty();
        return false;
    }

    @SuppressWarnings("unchecked")
    private static MissingInputEntry mapToMissingInputEntry(Map<String, Object> raw) {
        if (raw == null) return new MissingInputEntry(null, null, null);
        Object kind = raw.get("kind");
        Object id = raw.get("id");
        Object reason = raw.get("reason");
        return new MissingInputEntry(
            kind == null ? null : kind.toString(),
            id == null ? null : id.toString(),
            reason == null ? null : reason.toString()
        );
    }

    // -----------------------------------------------------------------------
    // Step 2/8 -- hierarchy build from book_of_work_json
    // -----------------------------------------------------------------------

    private List<MigrationDeliveryHierarchyNodeDto> buildHierarchy(
        List<Map<String, Object>> items,
        Map<String, ItemDerivedState> derivedStateByItemId) {
        // Group items by parentId, preserving the source list order which
        // respects the sequenceOrder convention written by the book generator.
        Map<String, List<String>> childrenByParent = new LinkedHashMap<>();
        for (Map<String, Object> item : items) {
            String id = stringField(item, "id");
            if (id == null) continue;
            String parentId = stringField(item, "parentId");
            childrenByParent.computeIfAbsent(parentId, k -> new ArrayList<>()).add(id);
        }

        // Precompute per-node needs-attention counts (own + descendants).
        Map<String, Long> needsAttentionCountByItemId = new HashMap<>();
        for (ItemDerivedState s : derivedStateByItemId.values()) {
            if (s.needsAttentionType() != null) {
                // Count "own"; descendants are aggregated below.
                needsAttentionCountByItemId.merge(s.itemId(), 1L, Long::sum);
            }
        }
        // Aggregate up the parent chain.
        for (ItemDerivedState s : derivedStateByItemId.values()) {
            if (s.needsAttentionType() == null) continue;
            String pid = s.parentId();
            int depth = 0;
            while (pid != null && depth < 8) {
                final String captured = pid;
                needsAttentionCountByItemId.merge(captured, 1L, Long::sum);
                ItemDerivedState parent = derivedStateByItemId.get(pid);
                if (parent == null) break;
                pid = parent.parentId();
                depth++;
            }
        }

        // Identify root items (parentId == null) and build recursively.
        List<String> rootIds = childrenByParent.getOrDefault(null, Collections.emptyList());
        List<MigrationDeliveryHierarchyNodeDto> roots = new ArrayList<>(rootIds.size());
        for (String rootId : rootIds) {
            roots.add(buildNode(rootId, childrenByParent, derivedStateByItemId, needsAttentionCountByItemId));
        }
        return roots;
    }

    private MigrationDeliveryHierarchyNodeDto buildNode(
        String itemId,
        Map<String, List<String>> childrenByParent,
        Map<String, ItemDerivedState> derivedStateByItemId,
        Map<String, Long> needsAttentionCountByItemId) {
        ItemDerivedState s = derivedStateByItemId.get(itemId);
        if (s == null) {
            // Item parsed but state-derivation skipped (logged earlier). Render
            // a minimal placeholder so the tree is still walkable.
            return new MigrationDeliveryHierarchyNodeDto(
                itemId, null, null, null, null, null, null,
                "not_saved_to_backlog", null, null, null, "no_coverage",
                0L, 0L, Collections.emptyList());
        }
        List<String> childIds = childrenByParent.getOrDefault(itemId, Collections.emptyList());
        List<MigrationDeliveryHierarchyNodeDto> children = new ArrayList<>(childIds.size());
        for (String childId : childIds) {
            children.add(buildNode(childId, childrenByParent, derivedStateByItemId, needsAttentionCountByItemId));
        }
        long needsCount = needsAttentionCountByItemId.getOrDefault(itemId, 0L);
        return new MigrationDeliveryHierarchyNodeDto(
            s.itemId(),
            s.parentId(),
            s.type(),
            s.title(),
            s.workstream(),
            s.sequenceOrder(),
            s.workItemId(),
            s.backlogStatus(),
            s.specGenerationStatus(),
            s.specGenerationConfidence(),
            s.implementationStatus(),
            s.evidenceStatus(),
            needsCount,
            s.missingInputsCount(),
            s.staleReason(),
            s.qualityGrade(),
            s.manuallyEdited(),
            children
        );
    }

    // -----------------------------------------------------------------------
    // Step 12 -- needs-attention list with priority + suppression
    // -----------------------------------------------------------------------

    private List<MigrationDeliveryNeedsAttentionItemDto> buildNeedsAttention(
        List<Map<String, Object>> items,
        Map<String, ItemDerivedState> derivedStateByItemId) {
        List<MigrationDeliveryNeedsAttentionItemDto> out = new ArrayList<>();

        for (Map<String, Object> item : items) {
            String itemId = stringField(item, "id");
            if (itemId == null) continue;
            ItemDerivedState s = derivedStateByItemId.get(itemId);
            if (s == null || s.needsAttentionType() == null) continue;

            // Suppress generated_with_warnings once implementation activity is
            // past not_started (Q-1).
            if ("generated_with_warnings".equals(s.needsAttentionType())
                && s.implementationPastNotStarted()) {
                continue;
            }

            int rank = NEEDS_ATTENTION_PRIORITY.indexOf(s.needsAttentionType());
            if (rank < 0) rank = NEEDS_ATTENTION_PRIORITY.size();

            List<MissingInputEntry> missing = "insufficient_context".equals(s.needsAttentionType())
                ? s.missingInputs()
                : null;

            out.add(new MigrationDeliveryNeedsAttentionItemDto(
                s.itemId(),
                s.workItemId(),
                s.needsAttentionType(),
                rank,
                s.title(),
                s.workstream(),
                s.specGenerationStatus(),
                s.specGenerationConfidence(),
                s.implementationStatus(),
                s.needsAttentionReason(),
                missing
            ));
        }

        out.sort(Comparator
            .comparingInt(MigrationDeliveryNeedsAttentionItemDto::priorityRank)
            .thenComparing(MigrationDeliveryNeedsAttentionItemDto::bookItemId,
                Comparator.nullsLast(Comparator.naturalOrder())));
        return out;
    }

    // -----------------------------------------------------------------------
    // Step 13 -- summary DTOs (5 sibling summaries + umbrella)
    // -----------------------------------------------------------------------

    private MigrationDeliverySummaryDto buildSummary(
        List<Map<String, Object>> items,
        List<MigrationDeliveryNeedsAttentionItemDto> needsAttention) {
        long initiatives = countByType(items, "initiative");
        long epics = countByType(items, "epic");
        long features = countByType(items, "feature");
        long stories = countByType(items, "story");
        long needsCount = needsAttention == null ? 0L : needsAttention.size();
        return new MigrationDeliverySummaryDto(initiatives, epics, features, stories, needsCount);
    }

    private MigrationDeliveryBacklogSaveSummaryDto buildBacklogSaveSummary(
        List<Map<String, Object>> items,
        Map<String, ItemDerivedState> derivedStateByItemId) {
        long saved = 0, notSaved = 0;
        for (Map<String, Object> item : items) {
            if (!isStory(item)) continue;
            ItemDerivedState s = derivedStateByItemId.get(stringField(item, "id"));
            if (s == null) {
                notSaved++;
                continue;
            }
            if ("saved".equals(s.backlogStatus())) saved++;
            else notSaved++;
        }
        return new MigrationDeliveryBacklogSaveSummaryDto(saved, notSaved);
    }

    private MigrationDeliverySpecGenerationSummaryDto buildSpecGenerationSummary(
        List<Map<String, Object>> items,
        Map<String, ItemDerivedState> derivedStateByItemId) {
        long notAttempted = 0, generated = 0, generatedWith = 0,
            insufficient = 0, failed = 0, skipped = 0;
        for (Map<String, Object> item : items) {
            if (!isStory(item)) continue;
            ItemDerivedState s = derivedStateByItemId.get(stringField(item, "id"));
            String status = s == null ? null : s.specGenerationStatus();
            if (status == null) {
                notAttempted++;
            } else switch (status) {
                case MigrationStorySpecGenerationStatus.GENERATED -> generated++;
                case MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS -> generatedWith++;
                case MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT -> insufficient++;
                case MigrationStorySpecGenerationStatus.FAILED -> failed++;
                case MigrationStorySpecGenerationStatus.SKIPPED_BLOCKED -> skipped++;
                default -> notAttempted++;
            }
        }
        return new MigrationDeliverySpecGenerationSummaryDto(
            notAttempted, generated, generatedWith, insufficient, failed, skipped);
    }

    private MigrationDeliveryImplementationSummaryDto buildImplementationSummary(
        List<Map<String, Object>> items,
        Map<String, ItemDerivedState> derivedStateByItemId) {
        long notStarted = 0, inProgress = 0, blocked = 0, completed = 0, active = 0;
        for (Map<String, Object> item : items) {
            if (!isStory(item)) continue;
            ItemDerivedState s = derivedStateByItemId.get(stringField(item, "id"));
            if (s == null) {
                notStarted++;
                continue;
            }
            String st = s.implementationStatus();
            if (st == null || "not_started".equals(st)) notStarted++;
            else if ("blocked".equals(st)) blocked++;
            else if ("completed".equals(st)) completed++;
            else inProgress++; // catch-all "in_progress" / other progressed states
            if (s.activeWithinWindow()) active++;
        }
        return new MigrationDeliveryImplementationSummaryDto(
            notStarted, inProgress, blocked, completed, active);
    }

    private MigrationDeliveryEvidenceSummaryDto buildEvidenceSummary(List<Map<String, Object>> items) {
        long ev = 0, df = 0, ab = 0, mp = 0, ar = 0, any = 0;
        for (Map<String, Object> item : items) {
            if (!isStory(item)) continue;
            EvidenceDerived e = deriveEvidenceCoverage(item);
            if (e.hasEvidence()) ev++;
            if (e.hasDiscovery()) df++;
            if (e.hasApiBaseline()) ab++;
            if (e.hasMapping()) mp++;
            if (e.hasArchitecture()) ar++;
            if (e.anyCoverage()) any++;
        }
        return new MigrationDeliveryEvidenceSummaryDto(ev, df, ab, mp, ar, any);
    }

    private List<MigrationDeliveryWorkstreamSummaryDto> buildWorkstreamSummaries(
        List<Map<String, Object>> items,
        Map<String, ItemDerivedState> derivedStateByItemId,
        List<MigrationDeliveryNeedsAttentionItemDto> needsAttention) {

        // Use a LinkedHashMap keyed by workstream label to preserve first-seen
        // order across stories. Each workstream's counts accumulate as we
        // walk story items.
        Map<String, long[]> accByWorkstream = new LinkedHashMap<>();
        // index layout: [total, saved, specGenerated, implActive, evidence, needsAttention]
        for (Map<String, Object> item : items) {
            if (!isStory(item)) continue;
            String ws = stringField(item, "workstream");
            long[] acc = accByWorkstream.computeIfAbsent(ws, k -> new long[6]);
            acc[0]++;
            ItemDerivedState s = derivedStateByItemId.get(stringField(item, "id"));
            if (s == null) continue;
            if ("saved".equals(s.backlogStatus())) acc[1]++;
            if (MigrationStorySpecGenerationStatus.GENERATED.equals(s.specGenerationStatus())
                || MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS.equals(s.specGenerationStatus())) {
                acc[2]++;
            }
            if (s.implementationPastNotStarted()) acc[3]++;
            if (s.anyEvidenceCoverage()) acc[4]++;
        }

        // Roll up needs-attention counts per workstream from the already-built
        // (priority-ordered, suppression-applied) needs-attention list.
        if (needsAttention != null) {
            for (MigrationDeliveryNeedsAttentionItemDto row : needsAttention) {
                String ws = row.workstream();
                long[] acc = accByWorkstream.get(ws);
                if (acc != null) acc[5]++;
            }
        }

        List<MigrationDeliveryWorkstreamSummaryDto> out = new ArrayList<>(accByWorkstream.size());
        for (Map.Entry<String, long[]> e : accByWorkstream.entrySet()) {
            long[] a = e.getValue();
            out.add(new MigrationDeliveryWorkstreamSummaryDto(
                e.getKey(), a[0], a[1], a[2], a[3], a[4], a[5]));
        }
        return out;
    }

    // -----------------------------------------------------------------------
    // Partial-roll-up tolerance (Q-11)
    // -----------------------------------------------------------------------

    /**
     * Run a sub-section builder; if it throws, append a warning naming the
     * subsection and return the supplied fallback. NEVER lets the exception
     * propagate out of {@link #loadDashboard(UUID, UUID)} -- the contract is
     * 200 + warnings (AC 16), never 5xx.
     */
    private <T> T safeLoadSubsection(
        String subsectionName,
        List<String> warnings,
        java.util.function.Supplier<T> body,
        T fallback) {
        try {
            return body.get();
        } catch (RuntimeException ex) {
            log.warn(
                "[diag-ams] delivery_dashboard subsection_failed subsection={} error={}",
                subsectionName, ex.toString());
            warnings.add(String.format(
                "Could not load %s: %s", subsectionName, ex.getMessage()));
            return fallback;
        }
    }

    // -----------------------------------------------------------------------
    // Helpers + fallback empties
    // -----------------------------------------------------------------------

    private static long countStories(List<Map<String, Object>> items) {
        return items.stream().filter(MigrationDeliveryDashboardService::isStory).count();
    }

    private static long countByType(List<Map<String, Object>> items, String type) {
        return items.stream()
            .filter(i -> typeMatches(i, type))
            .count();
    }

    private static boolean typeMatches(Map<String, Object> item, String expected) {
        String t = stringField(item, "type");
        return t != null && t.equalsIgnoreCase(expected);
    }

    private static boolean isStory(Map<String, Object> item) {
        return typeMatches(item, "story");
    }

    private static String stringField(Map<String, Object> m, String key) {
        if (m == null) return null;
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

    private static MigrationDeliverySummaryDto emptySummary() {
        return new MigrationDeliverySummaryDto(0L, 0L, 0L, 0L, 0L);
    }

    private static MigrationDeliveryBacklogSaveSummaryDto emptyBacklogSaveSummary() {
        return new MigrationDeliveryBacklogSaveSummaryDto(0L, 0L);
    }

    private static MigrationDeliverySpecGenerationSummaryDto emptySpecGenerationSummary() {
        return new MigrationDeliverySpecGenerationSummaryDto(0L, 0L, 0L, 0L, 0L, 0L);
    }

    private static MigrationDeliveryImplementationSummaryDto emptyImplementationSummary() {
        return new MigrationDeliveryImplementationSummaryDto(0L, 0L, 0L, 0L, 0L);
    }

    private static MigrationDeliveryEvidenceSummaryDto emptyEvidenceSummary() {
        return new MigrationDeliveryEvidenceSummaryDto(0L, 0L, 0L, 0L, 0L, 0L);
    }
}
