package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.MarkStaleResponse;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * AMS-side stale-marking pipeline for migration shape-spec generation rows.
 *
 * <p>Frontend coordination is intentionally avoided: the AMS-side debounce
 * stamp on {@link ArchitectureEntity#getLastMarkedStaleAt()} is the durable
 * choice (per spec direction). The gateway proxy passes saves straight
 * through; AMS gates the actual mark-stale work.</p>
 *
 * <h3>Trigger semantics (per spec.md "Stale-flag trigger semantics")</h3>
 * <ul>
 *   <li>Fires on every successful promote -- ALWAYS, regardless of element
 *       changes ({@link #markStaleForPromote(UUID, UUID, Collection)}).</li>
 *   <li>Fires on save to the active target, debounced server-side: within
 *       {@link #DEBOUNCE_SECONDS} seconds of the prior fire the call is
 *       skipped ({@link #markStaleIfActiveAndDebounced(UUID, UUID, Collection)}).</li>
 *   <li>NEVER fires for draft edits: the same entry point checks
 *       {@code kind='target' AND draft_state='active'} and short-circuits
 *       to {@code marked=0, skipped=false} when the architecture is a draft.</li>
 * </ul>
 *
 * <h3>Stale-marking query</h3>
 * <p>The match rule (spec.md): a spec is stale when its
 * {@code focused_context_refs_json.architecture_element_ids} (or transitively
 * {@code mapping_refs}) intersects the changed-element set. The
 * focused_context_refs blob is owned by the gateway (every generation row
 * writes it via {@code migrationShapeSpecGenerationHandler.ctxToRefsBlob}),
 * so this service performs the intersection in Java rather than database
 * JSON path queries -- this keeps the implementation portable across H2 and
 * Postgres (the JSONB operators differ) and keeps the row count bounded by
 * the project's spec count.</p>
 *
 * <p>The query is project-scoped via
 * {@link MigrationStorySpecGenerationRepository#findByProjectId(UUID)} so a
 * project's stale pipeline never touches another project's rows.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 3.</p>
 */
@Service
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class TargetArchitectureStaleMarkService {

    /**
     * Debounce window applied to active-target saves. Fixed in v1 per spec
     * (no UI knob, no per-project config). Promote always fires regardless.
     */
    static final long DEBOUNCE_SECONDS = 5L;

    /**
     * Top-level key in {@code focused_context_refs_json} that holds the set of
     * architecture element ids cited by the spec. Written by the gateway's
     * focused-context bundler; AMS only reads it.
     */
    static final String REFS_ELEMENT_IDS_KEY = "architecture_element_ids";

    /**
     * Top-level key in {@code focused_context_refs_json} that holds the set of
     * mapping refs. Each mapping row carries source / target element ids on
     * itself, so a spec citing a mapping is transitively affected by changes
     * to either side. Written by the gateway's focused-context bundler.
     */
    static final String REFS_MAPPING_REFS_KEY = "mapping_refs";

    /**
     * Sub-key inside each mapping_refs entry, when entries are objects (e.g.
     * {@code { id, sourceElementId, targetElementId }}). When mapping_refs is
     * a flat list of strings the strings ARE the source/target ids so we
     * intersect them directly.
     */
    static final List<String> MAPPING_REF_ELEMENT_KEYS = List.of(
        "sourceElementId",
        "targetElementId",
        "source_element_id",
        "target_element_id"
    );

    private final MigrationStorySpecGenerationRepository specRepository;
    private final ArchitectureRepository architectureRepository;

    public TargetArchitectureStaleMarkService(
            MigrationStorySpecGenerationRepository specRepository,
            ArchitectureRepository architectureRepository) {
        this.specRepository = specRepository;
        this.architectureRepository = architectureRepository;
    }

    /**
     * Promote-path entry point: fires the stale-mark UNCONDITIONALLY, ignores
     * the debounce stamp on the new active target, and updates that stamp
     * after a successful run.
     *
     * <p>Per spec.md: promote always fires. Even when no element ids changed
     * between the prior active and the new active, the spec count is bumped
     * to zero (the response indicates {@code markedCount=0}); we still bump
     * the {@code last_marked_stale_at} stamp so a save immediately after
     * promote sees the debounce window.</p>
     *
     * @param projectId             the project the architecture belongs to
     * @param newActiveTargetArchId the new active target architecture id
     * @param changedElementIds     elements whose mapping (or presence)
     *                              differs between the prior and new active
     *                              target
     * @return mark-stale result; {@code debounceSkipped} is always false
     */
    @Transactional
    public MarkStaleResponse markStaleForPromote(
            UUID projectId,
            UUID newActiveTargetArchId,
            Collection<String> changedElementIds) {
        Objects.requireNonNull(projectId, "projectId is required");
        Objects.requireNonNull(newActiveTargetArchId, "newActiveTargetArchId is required");

        int marked = markStaleNow(projectId, changedElementIds);

        // Bump the debounce stamp on the new active target row so a save
        // immediately after promote sees the debounce window.
        architectureRepository.findById(newActiveTargetArchId).ifPresent(arch -> {
            arch.setLastMarkedStaleAt(Instant.now());
            architectureRepository.save(arch);
        });

        log.info(
            "mark-stale (promote): project={}, newActiveTargetArch={}, changedElements={}, marked={}",
            projectId, newActiveTargetArchId,
            changedElementIds == null ? 0 : changedElementIds.size(), marked);

        return new MarkStaleResponse(marked, false);
    }

    /**
     * Active-target save entry point with the debounce guardrail.
     *
     * <p>Behaviour:</p>
     * <ul>
     *   <li>If the architecture is missing -> returns
     *       {@code (0, false)} (caller has bigger problems).</li>
     *   <li>If the architecture is NOT {@code kind='target'} OR NOT
     *       {@code draft_state='active'} -> returns {@code (0, false)} without
     *       bumping the stamp. Draft edits and current-arch edits flow
     *       through here harmlessly.</li>
     *   <li>If the architecture is active-target but
     *       {@code now() - lastMarkedStaleAt < DEBOUNCE_SECONDS} -> returns
     *       {@code (0, true)} WITHOUT touching the stamp or any spec rows.</li>
     *   <li>Otherwise fires the mark-stale and bumps the stamp.</li>
     * </ul>
     *
     * @param projectId         the project the architecture belongs to
     * @param architectureId    the architecture id receiving the save
     * @param changedElementIds elements whose mapping was touched in this save
     * @return mark-stale result; {@code debounceSkipped=true} when the window
     *         was hit
     */
    @Transactional
    public MarkStaleResponse markStaleIfActiveAndDebounced(
            UUID projectId,
            UUID architectureId,
            Collection<String> changedElementIds) {
        Objects.requireNonNull(projectId, "projectId is required");
        Objects.requireNonNull(architectureId, "architectureId is required");

        ArchitectureEntity arch = architectureRepository.findById(architectureId).orElse(null);
        if (arch == null) {
            log.debug("mark-stale (save): architecture missing id={}; skipping", architectureId);
            return new MarkStaleResponse(0, false);
        }
        if (!projectId.equals(arch.getProjectId())) {
            log.warn(
                "mark-stale (save): architecture {} belongs to project {}, not requested project {}; skipping",
                architectureId, arch.getProjectId(), projectId);
            return new MarkStaleResponse(0, false);
        }
        if (!"target".equalsIgnoreCase(arch.getKind())
                || !"active".equalsIgnoreCase(arch.getDraftState())) {
            log.debug(
                "mark-stale (save): architecture {} is not the active target (kind={}, draftState={}); skipping",
                architectureId, arch.getKind(), arch.getDraftState());
            return new MarkStaleResponse(0, false);
        }

        Instant now = Instant.now();
        Instant priorStamp = arch.getLastMarkedStaleAt();
        if (priorStamp != null) {
            long elapsed = Duration.between(priorStamp, now).toSeconds();
            if (elapsed >= 0 && elapsed < DEBOUNCE_SECONDS) {
                log.debug(
                    "mark-stale (save): debounce window hit (elapsed={}s, window={}s); skipping",
                    elapsed, DEBOUNCE_SECONDS);
                return new MarkStaleResponse(0, true);
            }
        }

        int marked = markStaleNow(projectId, changedElementIds);
        arch.setLastMarkedStaleAt(now);
        architectureRepository.save(arch);

        log.info(
            "mark-stale (save): project={}, activeTargetArch={}, changedElements={}, marked={}",
            projectId, architectureId,
            changedElementIds == null ? 0 : changedElementIds.size(), marked);

        return new MarkStaleResponse(marked, false);
    }

    /**
     * Pure mark-stale primitive: scans every spec-generation row for the
     * project, flips {@code stale=true} on each row whose
     * {@code focused_context_refs_json} intersects {@code changedElementIds},
     * and bumps {@code stale_marked_at}. Idempotent -- a re-call on the same
     * set leaves {@code stale=true} alone but bumps the timestamp.
     *
     * <p>Performance: this is project-scoped and bounded by the project's
     * spec count (one row per saved story per generation pass). For the v1
     * spec scale (tens to low hundreds of rows) the in-memory intersection is
     * preferable to JSON path queries which differ between H2 and Postgres.</p>
     *
     * @param projectId         the project to scope the scan
     * @param changedElementIds the changed-element set (null / empty -> no-op
     *                          returning 0)
     * @return number of rows whose {@code stale_marked_at} was bumped
     */
    int markStaleNow(UUID projectId, Collection<String> changedElementIds) {
        if (changedElementIds == null || changedElementIds.isEmpty()) {
            return 0;
        }
        Set<String> changed = new HashSet<>();
        for (String id : changedElementIds) {
            if (id != null && !id.isBlank()) {
                changed.add(id);
            }
        }
        if (changed.isEmpty()) {
            return 0;
        }

        List<MigrationStorySpecGenerationEntity> rows = specRepository.findByProjectId(projectId);
        if (rows == null || rows.isEmpty()) {
            return 0;
        }

        Instant now = Instant.now();
        int marked = 0;
        for (MigrationStorySpecGenerationEntity row : rows) {
            if (!intersects(row.getFocusedContextRefsJson(), changed)) {
                continue;
            }
            row.setStale(Boolean.TRUE);
            row.setStaleMarkedAt(now);
            marked++;
        }
        if (marked > 0) {
            specRepository.saveAll(rows);
        }
        return marked;
    }

    /**
     * Dry-run companion to {@link #markStaleNow(UUID, Collection)}.
     *
     * <p>Returns the count of spec-generation rows that WOULD be flipped to
     * {@code stale=true} if the supplied {@code changedElementIds} were passed
     * to the mark-stale pipeline, WITHOUT touching any row. Used by the
     * promote-to-active confirm modal: the UI shows the impact-preview line
     * "Promoting this draft will mark N specs stale. Continue?" BEFORE the
     * user confirms, then the commit path returns the actual marked count
     * which equals this preview when no concurrent writes intervene.</p>
     *
     * @param projectId         the project to scope the scan
     * @param changedElementIds the changed-element set (null / empty -> 0)
     * @return number of rows whose {@code focused_context_refs_json} intersects
     *         {@code changedElementIds}; no row is mutated
     */
    @Transactional(readOnly = true)
    public int countSpecsCoveringElements(UUID projectId, Collection<String> changedElementIds) {
        if (changedElementIds == null || changedElementIds.isEmpty()) {
            return 0;
        }
        Set<String> changed = new HashSet<>();
        for (String id : changedElementIds) {
            if (id != null && !id.isBlank()) {
                changed.add(id);
            }
        }
        if (changed.isEmpty()) {
            return 0;
        }

        List<MigrationStorySpecGenerationEntity> rows = specRepository.findByProjectId(projectId);
        if (rows == null || rows.isEmpty()) {
            return 0;
        }

        int matched = 0;
        for (MigrationStorySpecGenerationEntity row : rows) {
            if (intersects(row.getFocusedContextRefsJson(), changed)) {
                matched++;
            }
        }
        return matched;
    }

    /**
     * Returns true when the {@code focused_context_refs_json} cites any id in
     * {@code changed}. Recognises two top-level keys:
     *
     * <ul>
     *   <li>{@code architecture_element_ids} -- direct list of element ids
     *       (the canonical reference set).</li>
     *   <li>{@code mapping_refs} -- list of mapping refs. Each entry may be a
     *       string (the mapping id, treated as opaque) or an object with
     *       {@code sourceElementId}/{@code targetElementId} (or snake_case
     *       variants). When the object form is present, we intersect those
     *       element ids against the changed set; this is the "transitive via
     *       mappings" coverage described in spec.md.</li>
     * </ul>
     */
    boolean intersects(Map<String, Object> refs, Set<String> changed) {
        if (refs == null || refs.isEmpty()) {
            return false;
        }
        Object directIds = refs.get(REFS_ELEMENT_IDS_KEY);
        if (directIds instanceof Collection<?> ids) {
            for (Object id : ids) {
                if (id != null && changed.contains(id.toString())) {
                    return true;
                }
            }
        }
        Object mappings = refs.get(REFS_MAPPING_REFS_KEY);
        if (mappings instanceof Collection<?> mappingList) {
            for (Object m : mappingList) {
                if (m == null) {
                    continue;
                }
                if (m instanceof String s) {
                    if (changed.contains(s)) {
                        return true;
                    }
                    continue;
                }
                if (m instanceof Map<?, ?> mappingObj) {
                    for (String k : MAPPING_REF_ELEMENT_KEYS) {
                        Object v = mappingObj.get(k);
                        if (v != null && changed.contains(v.toString())) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }
}
