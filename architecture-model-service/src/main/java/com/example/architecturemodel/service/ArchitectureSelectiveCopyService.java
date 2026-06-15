package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.exception.ArchivedArchitectureSourceException;
import com.example.architecturemodel.exception.SameArchitectureCopyException;
import com.example.architecturemodel.exception.UnresolvedMissingReferenceException;
import com.example.architecturemodel.model.dto.SelectiveCopyCommitRequest;
import com.example.architecturemodel.model.dto.SelectiveCopyCommitRequest.ResolutionItem;
import com.example.architecturemodel.model.dto.SelectiveCopyCommitResponse;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightRequest;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightResponse;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightResponse.AutoIncludedItem;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightResponse.ConflictItem;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightResponse.Summary;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import com.example.architecturemodel.repository.ArchitectureRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Service that performs selective cross-architecture copy of a chosen subset
 * of elements (entities, relationships, diagrams) from one architecture into
 * another within the same project.
 *
 * <h2>Two-phase API</h2>
 *
 * <p>The service exposes two methods that mirror the user-facing wizard's
 * preflight -> commit progression:</p>
 *
 * <ul>
 *   <li>{@link #preflight(UUID, UUID, SelectiveCopyPreflightRequest)} —
 *       read-only; computes the conflict report and the auto-include set.</li>
 *   <li>{@link #commit(UUID, UUID, SelectiveCopyCommitRequest)} — wrapped in
 *       a single Spring {@link Transactional} boundary; applies the user's
 *       per-element resolution decisions and writes the resulting INSERT /
 *       UPDATE statements atomically (any failure rolls back the whole
 *       copy — safety property (a)).</li>
 * </ul>
 *
 * <h2>In-scope table list</h2>
 *
 * <p>The same 60 architecture-scoped tables enumerated in
 * {@link ArchitectureCloneService#IN_SCOPE_TABLES_IN_ORDER} apply here
 * verbatim. Selective copy is the per-element variant of full clone — both
 * services walk the same tables in the same dependency order so dependent
 * rows can find their parents in the FK rewiring map.</p>
 *
 * <h2>Excluded scopes (safety property (g))</h2>
 *
 * <p>Selective copy NEVER touches:</p>
 * <ul>
 *   <li><b>Threads</b> — file-based, project-scoped; not in DB.</li>
 *   <li><b>{@code discovery_*} tables</b> — Discovery's locked
 *       "one run -> one architecture" rule + immutable provenance.</li>
 *   <li><b>Project-scoped tables</b> — {@code project},
 *       {@code delivery_teams}, {@code organisations}, {@code work_item*},
 *       {@code project_artifact}, {@code product_definitions}.</li>
 * </ul>
 *
 * <h2>Conflict detection</h2>
 *
 * <p>For every element id in the resolved copy set (selected +
 * auto-included), the service queries the corresponding source table for
 * the row, then queries the target architecture for the same id. If a
 * target row exists with the same id, the element is flagged as a
 * {@code same_uuid} conflict (safety property (b)). The globally-unique
 * UUID rule from spec #1 means the same id IS the same conceptual element.</p>
 *
 * <h2>Smart cascading auto-include (safety property (d))</h2>
 *
 * <p>For every element in the copy set, the service walks its FK columns
 * (any String-typed column whose value matches the id of another in-scope
 * row in the source architecture) and resolves each reference:</p>
 *
 * <ul>
 *   <li>If the referenced id already exists in the target by UUID match ->
 *       silently reuse (no conflict, no auto-include entry).</li>
 *   <li>If the referenced id is missing in the target AND not already in
 *       the user's selection -> auto-include with
 *       {@code includedBecause: <parent name>}.</li>
 * </ul>
 *
 * <p>Auto-included elements are themselves walked transitively, so a
 * relationship that pulls in an entity which itself references another
 * missing entity will pull both in.</p>
 *
 * <h2>Resolution semantics (safety property (c))</h2>
 *
 * <ul>
 *   <li><b>{@code skip}</b> — element not copied. FK refs from other
 *       copied elements pointing at this id remain pointing at the existing
 *       target row (which already has that id by definition of the
 *       conflict).</li>
 *   <li><b>{@code overwrite}</b> — target row UPDATEd in place using the
 *       source row's column values; id preserved.</li>
 *   <li><b>{@code duplicate}</b> — element copied with a freshly generated
 *       UUID; FK refs from OTHER copied elements pointing at the original
 *       id are rewired to the new id via an in-memory {@code Map<String,
 *       String>} (oldId -> newId). The map is per-call only — never
 *       persisted, never leaked.</li>
 * </ul>
 *
 * <h2>Out-of-scope FK columns (Hotfix #2)</h2>
 *
 * <p>{@link #NON_FK_STRING_COLUMNS} lists the columns whose value MUST NOT
 * be substituted via the per-call FK rewire map even if the value happens
 * to appear as a key in the map. Today this set covers {@code id},
 * {@code architecture_id} and {@code project_id}. The {@code project_id}
 * entry is load-bearing — without it, copying an element from the Default
 * architecture (whose id equals the project id by spec #1's deterministic
 * rule) could rewrite the {@code model_files.project_id} column to a
 * non-existent UUID, tripping the {@code fk_model_files_project} FK in
 * production PostgreSQL. See the audit comment on
 * {@link #NON_FK_STRING_COLUMNS} for details on why no other in-scope FK
 * column needs the same treatment.</p>
 *
 * <h2>UUID column type-binding (PostgreSQL strict-mode hotfix)</h2>
 *
 * <p>A small subset of columns are declared as native PostgreSQL
 * {@code uuid} (not TEXT): {@code architecture_id} on every in-scope table
 * (Liquibase 089) and {@code project_id} on {@code model_files} +
 * {@code temporary_diagrams}. PostgreSQL refuses {@code uuid = varchar}
 * comparisons strictly; H2 in PostgreSQL mode silently coerces. To stay
 * portable, the service:</p>
 * <ul>
 *   <li>Binds {@code sourceArchitectureId} / {@code targetArchitectureId}
 *       as {@link UUID} objects in every SELECT.</li>
 *   <li>Walks declared column types via {@link DatabaseMetaData} and
 *       coerces String UUIDs -> {@link UUID} at INSERT / UPDATE bind
 *       time for any column whose declared type is UUID.</li>
 *   <li>Treats incoming {@code value instanceof UUID} the same as
 *       {@code value instanceof String} during FK detection (PostgreSQL
 *       returns native UUID columns as {@link UUID} from
 *       {@link JdbcTemplate#queryForList}).</li>
 * </ul>
 *
 * <h2>Architecture-scope read path (Spec 2026-05-22)</h2>
 *
 * <p>Every {@code WHERE architecture_id = ?} READ predicate (the
 * cascading walk's source lookup, target existence probe, and the
 * conflict-resolution UPDATE statement) routes through
 * {@link ArchitectureScopeResolver} so the row's architecture-scope
 * is derived from its <b>parent</b> ({@code model_files},
 * {@code sequence_diagrams}, or {@code sequence_fragments}) rather
 * than from the denormalised leaf {@code architecture_id} column on
 * the row itself. The leaf column can drift from the parent (no UPDATE
 * trigger keeps it in sync; legacy / raw-SQL writes may set it
 * inconsistently) so the read path now mirrors the canonical
 * {@link ModelService#loadModelByFileId} surface.</p>
 *
 * <p>The <b>write</b> path is unchanged: every INSERT / UPDATE still
 * SETs the leaf {@code architecture_id} column to the target
 * architecture id explicitly (via
 * {@link #projectColumnValue}), so newly-copied or freshly-updated
 * rows start with a correct leaf value even though no reader trusts
 * it.</p>
 *
 * <p>Spec: Multi-Architecture Selective Cross-Architecture Copy (Spec #7);
 * read-path fix per spec 2026-05-22-architecture-scope-via-parent-not-leaf.</p>
 */
@Service
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ArchitectureSelectiveCopyService {

    /** Sentinel resolution action names — must match the wire contract. */
    static final String ACTION_SKIP = "skip";
    static final String ACTION_OVERWRITE = "overwrite";
    static final String ACTION_DUPLICATE = "duplicate";

    /**
     * Sentinel conflict reason — must match the wire contract.
     *
     * <p><b>Production reachability note (Group 11 finding, spec #7
     * documentation safety property (k)):</b> the production schema enforces
     * a global single-column PRIMARY KEY on the {@code id} column for every
     * architecture-scoped table. Two rows with the same {@code id} value —
     * the precondition for a {@code same_uuid} conflict — are therefore
     * physically rejected by the PK constraint long before this service has
     * a chance to detect them. The {@code same_uuid} branch is consequently
     * essentially unreachable in normal production flow.</p>
     *
     * <p>The branch is retained as <b>defence-in-depth</b> for three reasons:</p>
     *
     * <ol>
     *   <li>It future-proofs the service against schema changes — if the
     *       global PK is ever relaxed to a composite {@code (id,
     *       architecture_id)} key (e.g. to allow legitimate cross-architecture
     *       UUID reuse), the conflict-detection path is already in place and
     *       tested.</li>
     *   <li>It catches UUID collisions inserted via raw SQL or import paths
     *       that bypass the JPA layer (e.g. a future bulk-import feature, a
     *       data-migration script, or a Liquibase data changeset).</li>
     *   <li>It makes the user-facing wizard's resolution UI testable end-to-end
     *       (the {@link com.example.architecturemodel.integration.ArchitectureSelectiveCopyIntegrationTest}
     *       relaxes the H2 PK to composite for exactly this reason).</li>
     * </ol>
     *
     * <p>Schema changes to enable production reachability of this path are
     * tracked separately and are explicitly out of scope for spec #7.</p>
     */
    static final String REASON_SAME_UUID = "same_uuid";

    /**
     * Columns that are NEVER followed during the cascading walk AND NEVER
     * substituted via the per-call FK rewire map at INSERT / UPDATE bind
     * time (Hotfix #2).
     *
     * <ul>
     *   <li>{@code id} IS the row's own id and is rewritten via an explicit
     *       branch in {@link #projectColumnValue}.</li>
     *   <li>{@code architecture_id} points at the architecture itself and is
     *       always rewritten to the target architecture id via an explicit
     *       branch in {@link #projectColumnValue}.</li>
     *   <li>{@code project_id} points at an out-of-scope row (the
     *       {@code project} table) and must therefore pass through verbatim.
     *       Without this exclusion, a copy of an element from the Default
     *       architecture (whose id equals the project id by spec #1's
     *       deterministic rule) could see its {@code project_id} column
     *       coincidentally appear as a key in the rewire map and be
     *       rewritten to a non-existent UUID, tripping
     *       {@code fk_model_files_project} on insert.</li>
     * </ul>
     *
     * <p><b>Audit (sweep of the 60 in-scope tables performed for
     * Hotfix #2):</b> no other column on any in-scope table references an
     * out-of-scope table. Specifically there is no {@code work_item_id},
     * {@code organisation_id}, {@code delivery_team_id} or
     * {@code product_definition_id} column on any in-scope table — verified
     * by grepping every {@code ALTER TABLE ... ADD COLUMN} migration after
     * the baseline schema and re-confirming the baseline {@code REFERENCES}
     * clauses (the only cross-table FK on the user_journeys row is
     * {@code user_id REFERENCES business_users(id)}, which is IN-scope and
     * therefore correctly rewired).</p>
     *
     * <p>If a future migration adds a new out-of-scope FK column to any
     * in-scope table, it MUST be added to this set or the selective copy
     * will silently rewrite it to a non-existent id whenever the value
     * collides with a duplicate-action element id.</p>
     */
    private static final Set<String> NON_FK_STRING_COLUMNS = Set.of(
        "id",
        "architecture_id",
        "project_id"
    );

    private final ArchitectureRepository architectureRepository;
    private final JdbcTemplate jdbcTemplate;
    private final ArchitectureElementMappingRepository mappingRepository;

    public ArchitectureSelectiveCopyService(ArchitectureRepository architectureRepository,
                                            JdbcTemplate jdbcTemplate,
                                            ArchitectureElementMappingRepository mappingRepository) {
        this.architectureRepository = architectureRepository;
        this.jdbcTemplate = jdbcTemplate;
        this.mappingRepository = mappingRepository;
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Computes the preflight conflict + auto-include report for a proposed
     * selective copy. Read-only — no writes are performed.
     *
     * @param projectId             project both architectures must belong to.
     * @param targetArchitectureId  architecture the user is copying INTO
     *                              (the currently active one in the wizard).
     * @param request               the source architecture id + the user's
     *                              tick-set from the picker tree.
     * @return the preflight report (conflicts + auto-includes + summary).
     * @throws ArchitectureNotFoundException     if either architecture is
     *           missing or cross-project (mapped to 404).
     * @throws SameArchitectureCopyException     if source == target (mapped
     *           to 422 {@code same_architecture}).
     * @throws ArchivedArchitectureSourceException if the source is archived
     *           (mapped to 422 {@code archived_source}).
     */
    @Transactional(readOnly = true)
    public SelectiveCopyPreflightResponse preflight(UUID projectId,
                                                    UUID targetArchitectureId,
                                                    SelectiveCopyPreflightRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Selective-copy preflight request body is required");
        }
        UUID sourceArchitectureId = request.sourceArchitectureId();
        if (sourceArchitectureId == null) {
            throw new IllegalArgumentException("sourceArchitectureId is required");
        }
        List<UUID> rawIds = request.elementIds() == null ? List.of() : request.elementIds();

        log.debug("Selective-copy preflight: project={}, source={}, target={}, selected={}",
            projectId, sourceArchitectureId, targetArchitectureId, rawIds.size());

        // 1. Load + validate architectures.
        validateArchitectures(projectId, sourceArchitectureId, targetArchitectureId);

        // 2. Build the per-call walk state. Every elementId provided by the
        //    user is added to the working set; the cascading walk extends
        //    it with auto-includes.
        WalkState state = new WalkState(sourceArchitectureId, targetArchitectureId);
        for (UUID id : rawIds) {
            if (id == null) continue;
            state.userSelected.add(id.toString());
        }

        // 3. Cascading walk: for each element, look up its source row,
        //    detect FK refs, and queue auto-includes for missing target
        //    references.
        Deque<String> queue = new ArrayDeque<>(state.userSelected);
        while (!queue.isEmpty()) {
            String currentId = queue.poll();
            if (state.resolved.contains(currentId)) {
                continue;
            }
            ResolvedElement resolved = locateInSource(currentId, state);
            if (resolved == null) {
                // The id doesn't exist in any in-scope source table.
                // Treat user-supplied ids as a 400; treat auto-include
                // candidates as orphan refs (skip silently — happens when
                // a row references something outside our 60 in-scope tables,
                // e.g. a project_id which we filtered out via NON_FK_STRING_COLUMNS).
                if (state.userSelected.contains(currentId)) {
                    throw new IllegalArgumentException(
                        "Element id " + currentId + " not found in source architecture "
                            + sourceArchitectureId);
                }
                continue;
            }
            state.resolved.add(currentId);
            state.elementsByTable
                .computeIfAbsent(resolved.table, t -> new LinkedHashMap<>())
                .put(currentId, resolved);

            // Walk FK refs.
            for (Map.Entry<String, Object> col : resolved.row.entrySet()) {
                String colName = col.getKey();
                if (NON_FK_STRING_COLUMNS.contains(colName)) continue;
                Object value = col.getValue();
                String s = stringifyIdLike(value);
                if (s == null) continue;
                if (!looksLikeUuid(s)) continue;
                if (state.userSelected.contains(s)) {
                    // user already ticked it — fine; the queue will pick it up.
                    continue;
                }
                if (state.resolved.contains(s)) {
                    continue;
                }
                if (state.autoIncluded.containsKey(s)) {
                    continue;
                }
                // Is this id in the target architecture by UUID match?
                if (existsInTargetByUuid(s, state)) {
                    // Silently reuse — no conflict, no auto-include.
                    state.targetReuses.add(s);
                    continue;
                }
                // Is it actually a row in some in-scope source table at all?
                ResolvedElement child = locateInSource(s, state);
                if (child == null) {
                    // Out-of-scope reference (e.g. cross-architecture or
                    // points at something we don't track) — skip silently.
                    continue;
                }
                // Auto-include with parent name as the included-because.
                state.autoIncluded.put(s, new AutoIncludeRecord(child, resolved.displayName));
                queue.add(s);
            }
        }

        // 4. Detect same-UUID conflicts for every element in the resolved
        //    set (selected + auto-included). Auto-included elements should
        //    NEVER conflict in practice (they were missing from the target
        //    by definition) — assert this as a safety check and only flag
        //    selected-element conflicts.
        List<ConflictItem> conflicts = new ArrayList<>();
        for (String id : state.resolved) {
            ResolvedElement el = lookupResolved(id, state);
            if (el == null) continue;
            if (existsInTargetByUuid(id, state)) {
                conflicts.add(new ConflictItem(
                    UUID.fromString(id),
                    el.table,
                    el.displayName,
                    REASON_SAME_UUID
                ));
            }
        }

        // 5. Build response.
        List<AutoIncludedItem> autoIncludedList = new ArrayList<>(state.autoIncluded.size());
        for (Map.Entry<String, AutoIncludeRecord> entry : state.autoIncluded.entrySet()) {
            AutoIncludeRecord rec = entry.getValue();
            autoIncludedList.add(new AutoIncludedItem(
                UUID.fromString(entry.getKey()),
                rec.element.table,
                rec.element.displayName,
                rec.parentName
            ));
        }

        Summary summary = new Summary(
            state.userSelected.size(),
            conflicts.size(),
            autoIncludedList.size(),
            state.userSelected.size() + autoIncludedList.size()
        );

        return new SelectiveCopyPreflightResponse(conflicts, autoIncludedList, summary);
    }

    /**
     * Atomically commits the selective copy. Wrapped in a single Spring
     * {@link Transactional} boundary — any thrown exception (validation,
     * JDBC failure, etc.) triggers a full rollback (safety property (a)).
     *
     * @param projectId             project both architectures must belong to.
     * @param targetArchitectureId  architecture being copied INTO.
     * @param request               source id + element id list + per-conflict
     *                              resolution decisions.
     * @return summary counts for the post-copy toast.
     * @throws ArchitectureNotFoundException     if either architecture is
     *           missing or cross-project (404).
     * @throws SameArchitectureCopyException     if source == target (422
     *           {@code same_architecture}).
     * @throws ArchivedArchitectureSourceException if the source is archived
     *           (422 {@code archived_source}).
     * @throws UnresolvedMissingReferenceException if any selected element
     *           still has a missing FK reference at submit time (422
     *           {@code missing_reference}).
     */
    @Transactional
    public SelectiveCopyCommitResponse commit(UUID projectId,
                                              UUID targetArchitectureId,
                                              SelectiveCopyCommitRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Selective-copy commit request body is required");
        }
        UUID sourceArchitectureId = request.sourceArchitectureId();
        if (sourceArchitectureId == null) {
            throw new IllegalArgumentException("sourceArchitectureId is required");
        }
        List<UUID> rawIds = request.elementIds() == null ? List.of() : request.elementIds();
        List<ResolutionItem> resolutions = request.resolutions() == null
            ? List.of()
            : request.resolutions();

        log.info("Selective-copy commit: project={}, source={}, target={}, selected={}, resolutions={}",
            projectId, sourceArchitectureId, targetArchitectureId,
            rawIds.size(), resolutions.size());

        // 1. Re-validate (defence in depth).
        validateArchitectures(projectId, sourceArchitectureId, targetArchitectureId);

        // 2. Re-run the cascading walk to get a fresh resolved id set + auto
        //    include set. We deliberately don't trust the preflight result
        //    sent by the client — the user might have re-clicked between
        //    preflight and commit.
        SelectiveCopyPreflightRequest preflightReq =
            new SelectiveCopyPreflightRequest(sourceArchitectureId, rawIds);
        SelectiveCopyPreflightResponse fresh =
            preflight(projectId, targetArchitectureId, preflightReq);

        // Detect un-tick-an-auto-include scenario: re-run walk in commit
        // mode. If any selected element references an id that is NEITHER in
        // the user's selection NOR in the target NOR in the auto-include
        // set, fail with 422 missing_reference.
        // (The preflight walk implicitly auto-includes all such missing
        // refs, so the only way to reach this state is for the auto-includer
        // itself to bail because the missing ref points at an out-of-scope
        // source row. We surface that as the missing_reference exception.)
        WalkState state = rebuildWalkState(sourceArchitectureId, targetArchitectureId, rawIds);
        for (Map.Entry<String, ResolvedElement> entry : flattenResolved(state).entrySet()) {
            String parentId = entry.getKey();
            ResolvedElement el = entry.getValue();
            for (Map.Entry<String, Object> col : el.row.entrySet()) {
                String colName = col.getKey();
                if (NON_FK_STRING_COLUMNS.contains(colName)) continue;
                Object value = col.getValue();
                String s = stringifyIdLike(value);
                if (s == null) continue;
                if (!looksLikeUuid(s)) continue;
                if (state.userSelected.contains(s)) continue;
                if (state.autoIncluded.containsKey(s)) continue;
                if (state.targetReuses.contains(s)) continue;
                if (existsInTargetByUuid(s, state)) {
                    state.targetReuses.add(s);
                    continue;
                }
                // Try to locate it in source — if found, this is a missing
                // reference the user un-ticked.
                ResolvedElement child = locateInSource(s, state);
                if (child != null) {
                    log.warn(
                        "Selective copy commit refused: element {} in {} references {} which is missing from target and was un-ticked from auto-include",
                        parentId, el.table, s);
                    throw new UnresolvedMissingReferenceException(
                        "Element " + parentId + " (" + el.displayName
                            + ") references missing element " + s
                            + " — re-run preflight to auto-include it.");
                }
                // Otherwise, the reference points at something out of our
                // 60-table scope (e.g. project-scoped) — silently allowed.
            }
        }

        // 3. Build the resolution map, defaulting unspecified conflicts to skip.
        Map<String, String> resolutionByElement = new HashMap<>();
        for (ResolutionItem r : resolutions) {
            if (r == null || r.elementId() == null || r.action() == null) continue;
            String action = r.action().toLowerCase(Locale.ROOT);
            if (!ACTION_SKIP.equals(action)
                && !ACTION_OVERWRITE.equals(action)
                && !ACTION_DUPLICATE.equals(action)) {
                throw new IllegalArgumentException(
                    "Unknown resolution action '" + r.action() + "' for element "
                        + r.elementId());
            }
            resolutionByElement.put(r.elementId().toString(), action);
        }

        // 4. Build the FK rewire map for elements that will get a fresh UUID.
        Map<String, String> fkRewireMap = new HashMap<>();
        // Architecture id rewriting is automatic: every copied row's
        // architecture_id is set to the target id explicitly.
        // Track which conflicting ids were resolved which way so we can
        // count and apply correctly.
        Set<String> conflictingIds = new HashSet<>();
        Map<String, String> conflictResolution = new LinkedHashMap<>();
        for (ConflictItem c : fresh.conflicts()) {
            String id = c.elementId().toString();
            conflictingIds.add(id);
            String action = resolutionByElement.getOrDefault(id, ACTION_SKIP);
            conflictResolution.put(id, action);
            if (ACTION_DUPLICATE.equals(action)) {
                fkRewireMap.put(id, UUID.randomUUID().toString());
            }
        }

        // 5. Walk in-scope tables in dependency order, applying writes.
        //    autoMap path: track per-element (sourceId, newTargetId, table)
        //    triples so a single batch insert into architecture_element_mappings
        //    can run after the walk completes -- under the same @Transactional
        //    boundary so a failure rolls back both the copy and any mappings.
        boolean autoMap = Boolean.TRUE.equals(request.autoMap());
        int copied = 0;
        int skipped = 0;
        int overwritten = 0;
        int duplicated = 0;
        int autoIncludedCount = state.autoIncluded.size();
        List<MappingWrite> mappingWrites = autoMap ? new ArrayList<>() : null;

        for (String table : ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER) {
            Map<String, ResolvedElement> elementsForTable = state.elementsByTable.get(table);
            if (elementsForTable == null || elementsForTable.isEmpty()) {
                continue;
            }
            Map<String, Integer> columnTypes = discoverColumnTypes(table);
            if (columnTypes.isEmpty() || !columnTypes.containsKey("id")) {
                log.debug("Selective copy skipping table '{}' — columns not discoverable", table);
                continue;
            }
            List<String> columns = new ArrayList<>(columnTypes.keySet());
            for (Map.Entry<String, ResolvedElement> entry : elementsForTable.entrySet()) {
                String elementId = entry.getKey();
                ResolvedElement el = entry.getValue();
                String action = conflictResolution.get(elementId);
                if (action == null) {
                    // Not a conflict — INSERT verbatim with id preserved.
                    insertRow(table, columns, columnTypes, el.row, elementId, fkRewireMap, state);
                    copied++;
                    if (autoMap) {
                        // Verbatim insert: source id == new target id.
                        mappingWrites.add(new MappingWrite(table, elementId, elementId));
                    }
                } else if (ACTION_SKIP.equals(action)) {
                    skipped++;
                    // No mapping produced for skipped rows (per spec).
                } else if (ACTION_OVERWRITE.equals(action)) {
                    updateRow(table, columns, columnTypes, el.row, elementId, fkRewireMap, state);
                    overwritten++;
                    copied++;
                    // No mapping produced for overwritten-without-id-change rows.
                } else if (ACTION_DUPLICATE.equals(action)) {
                    String newId = fkRewireMap.get(elementId);
                    insertRow(table, columns, columnTypes, el.row, newId, fkRewireMap, state);
                    duplicated++;
                    copied++;
                    if (autoMap) {
                        // Duplicate insert: source id -> freshly-generated target id.
                        mappingWrites.add(new MappingWrite(table, elementId, newId));
                    }
                }
            }
        }

        // 6. Auto-map: under the same @Transactional boundary, write one
        //    mapping row per element actually copied. mapping_type=equivalent,
        //    status=confirmed, confidence=1.0, created_by_task=selective-copy-with-auto-map.
        int createdMappingCount = 0;
        if (autoMap && mappingWrites != null && !mappingWrites.isEmpty()) {
            List<ArchitectureElementMappingEntity> mappingEntities = new ArrayList<>(mappingWrites.size());
            for (MappingWrite mw : mappingWrites) {
                mappingEntities.add(ArchitectureElementMappingEntity.builder()
                    .id(UUID.randomUUID())
                    .projectId(projectId)
                    .sourceArchitectureId(sourceArchitectureId)
                    .targetArchitectureId(targetArchitectureId)
                    .sourceElementType(mw.elementType)
                    .sourceElementId(mw.sourceId)
                    .targetElementType(mw.elementType)
                    .targetElementId(mw.newTargetId)
                    .mappingType("equivalent")
                    .status("confirmed")
                    .createdByTask("selective-copy-with-auto-map")
                    .confidence(Double.valueOf(1.0))
                    .build());
            }
            mappingRepository.saveAll(mappingEntities);
            createdMappingCount = mappingEntities.size();
        }

        log.info("Selective copy completed: copied={} skipped={} overwritten={} duplicated={} autoIncluded={} createdMappingCount={}",
            copied, skipped, overwritten, duplicated, autoIncludedCount, createdMappingCount);

        return new SelectiveCopyCommitResponse(
            copied, skipped, overwritten, duplicated, autoIncludedCount, createdMappingCount);
    }

    /**
     * Per-element record used to defer mapping inserts until after the
     * cascading walk completes. Holds the (element_type, sourceId, newTargetId)
     * triple — element_type is the source-table name from the in-scope list,
     * which serves as both the source and target element type per the
     * shaping decision (no separate element-type registry in v1).
     */
    private record MappingWrite(String elementType, String sourceId, String newTargetId) {}

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    private void validateArchitectures(UUID projectId,
                                       UUID sourceArchitectureId,
                                       UUID targetArchitectureId) {
        // Target must exist in project.
        ArchitectureEntity target = architectureRepository.findById(targetArchitectureId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Architecture not found: " + targetArchitectureId));
        if (!projectId.equals(target.getProjectId())) {
            throw new ArchitectureNotFoundException(
                "Architecture " + targetArchitectureId + " not found in project " + projectId);
        }

        // Source must exist in project.
        ArchitectureEntity source = architectureRepository.findById(sourceArchitectureId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Architecture not found: " + sourceArchitectureId));
        if (!projectId.equals(source.getProjectId())) {
            throw new ArchitectureNotFoundException(
                "Architecture " + sourceArchitectureId + " not found in project " + projectId);
        }

        // Same-architecture refusal — defence in depth (UI also disables
        // the per-row Copy from... button on the active architecture).
        if (sourceArchitectureId.equals(targetArchitectureId)) {
            throw new SameArchitectureCopyException();
        }

        // Archived-source refusal.
        if (Boolean.TRUE.equals(source.getArchived())) {
            throw new ArchivedArchitectureSourceException();
        }
    }

    /**
     * Rebuilds a fresh {@link WalkState} as if {@code preflight} had been
     * called. Only used by the commit path's defence-in-depth re-walk.
     */
    private WalkState rebuildWalkState(UUID sourceArchitectureId,
                                       UUID targetArchitectureId,
                                       List<UUID> rawIds) {
        WalkState state = new WalkState(sourceArchitectureId, targetArchitectureId);
        for (UUID id : rawIds) {
            if (id == null) continue;
            state.userSelected.add(id.toString());
        }
        Deque<String> queue = new ArrayDeque<>(state.userSelected);
        while (!queue.isEmpty()) {
            String currentId = queue.poll();
            if (state.resolved.contains(currentId)) continue;
            ResolvedElement resolved = locateInSource(currentId, state);
            if (resolved == null) {
                if (state.userSelected.contains(currentId)) {
                    throw new IllegalArgumentException(
                        "Element id " + currentId + " not found in source architecture "
                            + sourceArchitectureId);
                }
                continue;
            }
            state.resolved.add(currentId);
            state.elementsByTable
                .computeIfAbsent(resolved.table, t -> new LinkedHashMap<>())
                .put(currentId, resolved);
            for (Map.Entry<String, Object> col : resolved.row.entrySet()) {
                String colName = col.getKey();
                if (NON_FK_STRING_COLUMNS.contains(colName)) continue;
                Object value = col.getValue();
                String s = stringifyIdLike(value);
                if (s == null) continue;
                if (!looksLikeUuid(s)) continue;
                if (state.userSelected.contains(s) || state.resolved.contains(s)
                    || state.autoIncluded.containsKey(s)) {
                    continue;
                }
                if (existsInTargetByUuid(s, state)) {
                    state.targetReuses.add(s);
                    continue;
                }
                ResolvedElement child = locateInSource(s, state);
                if (child == null) continue;
                state.autoIncluded.put(s, new AutoIncludeRecord(child, resolved.displayName));
                queue.add(s);
            }
        }
        return state;
    }

    private Map<String, ResolvedElement> flattenResolved(WalkState state) {
        Map<String, ResolvedElement> flat = new LinkedHashMap<>();
        for (Map<String, ResolvedElement> perTable : state.elementsByTable.values()) {
            flat.putAll(perTable);
        }
        return flat;
    }

    private ResolvedElement lookupResolved(String id, WalkState state) {
        for (Map<String, ResolvedElement> perTable : state.elementsByTable.values()) {
            ResolvedElement el = perTable.get(id);
            if (el != null) return el;
        }
        return null;
    }

    /**
     * Searches the in-scope source tables (in dependency order) for a row
     * whose primary key matches {@code id} and whose architecture-scope
     * resolves (via the parent chain in
     * {@link ArchitectureScopeResolver}) to the source architecture.
     * Returns the first match — element ids are globally-unique UUIDs
     * (spec #1) so at most one match exists.
     *
     * <p>Read path uses the parent-chain join (spec
     * 2026-05-22-architecture-scope-via-parent-not-leaf), so a row whose
     * leaf {@code architecture_id} column has drifted from its parent's
     * value is still surfaced under the correct (parent-derived)
     * architecture.</p>
     *
     * <p>Tables outside the resolver's three chains (today only
     * {@code model_files} and {@code temporary_diagrams}, which carry
     * their architecture_id directly) fall back to the legacy leaf-column
     * query — those tables ARE the canonical source of truth for their
     * own architecture-id, so reading the leaf is correct.</p>
     */
    private ResolvedElement locateInSource(String id, WalkState state) {
        ResolvedElement cached = state.sourceLookupCache.get(id);
        if (cached != null) return cached;
        if (state.sourceLookupMisses.contains(id)) return null;

        for (String table : ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER) {
            Map<String, Integer> columnTypes = discoverColumnTypes(table);
            if (columnTypes.isEmpty() || !columnTypes.containsKey("id")) continue;
            List<String> columns = new ArrayList<>(columnTypes.keySet());
            String sql = buildLookupSql(table, columns);
            try {
                // architecture_id is a UUID column in production PG; bind
                // sourceArchitectureId as a UUID object. id is TEXT in
                // every in-scope table so binding as a String is fine.
                List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                    sql, id, state.sourceArchitectureId);
                if (rows.isEmpty()) continue;
                Map<String, Object> row = rows.get(0);
                String displayName = resolveDisplayName(row, id);
                ResolvedElement element = new ResolvedElement(
                    table, id, displayName, row, columns, columnTypes);
                state.sourceLookupCache.put(id, element);
                return element;
            } catch (BadSqlGrammarException ex) {
                log.debug("Selective copy probe skipped table '{}' (bad grammar): {}",
                    table, ex.getMessage());
            } catch (DataAccessException ex) {
                log.warn("Selective copy probe skipped table '{}' due to DB error: {}",
                    table, ex.getMessage());
            }
        }
        state.sourceLookupMisses.add(id);
        return null;
    }

    /**
     * Builds the per-table single-row lookup SQL for the cascading walk.
     * Routes through {@link ArchitectureScopeResolver} when the table has
     * a registered parent chain (the common case — 79 element tables),
     * else falls back to the legacy leaf {@code architecture_id = ?}
     * predicate (today only {@code model_files} and
     * {@code temporary_diagrams}, which carry the column directly).
     *
     * <p>Bind order in both cases is {@code (id, architectureId)}.</p>
     */
    private String buildLookupSql(String table, List<String> columns) {
        if (ArchitectureScopeResolver.hasParent(table)) {
            ArchitectureScopeResolver.ParentLink link =
                ArchitectureScopeResolver.parentLinkFor(table);
            // Project each column qualified with the element-table alias so
            // the join's parent-side columns never collide with the
            // element-side ones (both tables have `id`).
            String qualifiedCols = String.join(", ",
                columns.stream().map(c -> "t." + c).toList());
            return "SELECT " + qualifiedCols
                + " FROM " + table + " t"
                + " JOIN " + link.parentTable() + " p ON p.id = t." + link.fkColumn()
                + " WHERE t.id = ? AND p.architecture_id = ?";
        }
        // Fallback path: out-of-scope tables (model_files, temporary_diagrams)
        // carry their architecture_id directly.
        return "SELECT " + String.join(", ", columns)
            + " FROM " + table
            + " WHERE id = ? AND architecture_id = ?";
    }

    /**
     * Returns {@code true} iff a row with this id exists under the target
     * architecture, derived via the parent chain (spec
     * 2026-05-22-architecture-scope-via-parent-not-leaf) — NOT via the
     * leaf {@code architecture_id} column on the row itself.
     */
    private boolean existsInTargetByUuid(String id, WalkState state) {
        Boolean cached = state.targetExistenceCache.get(id);
        if (cached != null) return cached;
        for (String table : ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER) {
            Map<String, Integer> columnTypes = discoverColumnTypes(table);
            if (columnTypes.isEmpty() || !columnTypes.containsKey("id")) {
                continue;
            }
            // For parent-chained tables, route via the resolver. For the
            // few out-of-scope tables (model_files, temporary_diagrams)
            // fall back to the leaf column — they carry it directly.
            String sql;
            if (ArchitectureScopeResolver.hasParent(table)) {
                ArchitectureScopeResolver.ParentLink link =
                    ArchitectureScopeResolver.parentLinkFor(table);
                // Skip if the FK column is missing on the active schema
                // (defensive — production has every column).
                if (!columnTypes.containsKey(link.fkColumn())) {
                    continue;
                }
                sql = "SELECT 1 FROM " + table + " t"
                    + " JOIN " + link.parentTable() + " p ON p.id = t." + link.fkColumn()
                    + " WHERE t.id = ? AND p.architecture_id = ?";
            } else {
                if (!columnTypes.containsKey("architecture_id")) {
                    continue;
                }
                sql = "SELECT 1 FROM " + table
                    + " WHERE id = ? AND architecture_id = ?";
            }
            try {
                // architecture_id is a UUID column in production PG; bind
                // targetArchitectureId as a UUID object.
                List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                    sql, id, state.targetArchitectureId);
                if (!rows.isEmpty()) {
                    state.targetExistenceCache.put(id, Boolean.TRUE);
                    return true;
                }
            } catch (BadSqlGrammarException ex) {
                log.debug("Target existence probe skipped table '{}' (bad grammar): {}",
                    table, ex.getMessage());
            } catch (DataAccessException ex) {
                log.warn("Target existence probe skipped table '{}' due to DB error: {}",
                    table, ex.getMessage());
            }
        }
        state.targetExistenceCache.put(id, Boolean.FALSE);
        return false;
    }

    private void insertRow(String table,
                           List<String> columns,
                           Map<String, Integer> columnTypes,
                           Map<String, Object> sourceRow,
                           String newId,
                           Map<String, String> fkRewireMap,
                           WalkState state) {
        String selectColumns = String.join(", ", columns);
        String insertSql = "INSERT INTO " + table + " (" + selectColumns
            + ") VALUES (" + String.join(", ", Collections.nCopies(columns.size(), "?")) + ")";
        Object[] args = new Object[columns.size()];
        for (int c = 0; c < columns.size(); c++) {
            String col = columns.get(c);
            int sqlType = columnTypes.getOrDefault(col, Types.OTHER);
            args[c] = ArchitectureCloneService.coerceForSqlType(
                projectColumnValue(col, sourceRow.get(col), newId, fkRewireMap, state),
                sqlType);
        }
        jdbcTemplate.update(insertSql, args);
    }

    /**
     * UPDATEs the row in {@code table} with id {@code existingId} under
     * the target architecture, using the source row's column values.
     *
     * <p>The WHERE-clause architecture predicate is routed through the
     * parent chain (spec 2026-05-22-architecture-scope-via-parent-not-leaf)
     * so a target row whose leaf {@code architecture_id} has drifted is
     * still matched by parent-chain resolution. The SET clause writes the
     * leaf {@code architecture_id} column to the target architecture id
     * explicitly (via {@link #projectColumnValue}), keeping the leaf
     * eventually-correct for newly-touched rows.</p>
     */
    private void updateRow(String table,
                           List<String> columns,
                           Map<String, Integer> columnTypes,
                           Map<String, Object> sourceRow,
                           String existingId,
                           Map<String, String> fkRewireMap,
                           WalkState state) {
        // UPDATE every column except id (which we use in the WHERE clause).
        List<String> updatableColumns = new ArrayList<>(columns.size());
        for (String c : columns) {
            if (!"id".equals(c)) updatableColumns.add(c);
        }
        if (updatableColumns.isEmpty()) {
            return;
        }
        String setClause = String.join(", ",
            updatableColumns.stream().map(c -> c + " = ?").toList());

        // Architecture-scope predicate via the resolver when the table has
        // a parent chain (the common case); leaf-column fallback for the
        // two out-of-scope tables (model_files, temporary_diagrams).
        String archPredicate;
        if (ArchitectureScopeResolver.hasParent(table)) {
            archPredicate = ArchitectureScopeResolver.buildScopedWherePredicate(table);
        } else {
            archPredicate = "architecture_id = ?";
        }
        String updateSql = "UPDATE " + table + " SET " + setClause
            + " WHERE id = ? AND " + archPredicate;

        Object[] args = new Object[updatableColumns.size() + 2];
        for (int c = 0; c < updatableColumns.size(); c++) {
            String col = updatableColumns.get(c);
            int sqlType = columnTypes.getOrDefault(col, Types.OTHER);
            args[c] = ArchitectureCloneService.coerceForSqlType(
                projectColumnValue(col, sourceRow.get(col), existingId, fkRewireMap, state),
                sqlType);
        }
        // WHERE id = ? — id is TEXT in every in-scope table, bind as String.
        args[updatableColumns.size()] = existingId;
        // The architecture predicate binds the target architecture UUID —
        // whether it falls under p.architecture_id = ? (parent chain) or
        // the legacy architecture_id = ? (fallback) the bind shape is the
        // same single UUID.
        args[updatableColumns.size() + 1] = state.targetArchitectureId;
        jdbcTemplate.update(updateSql, args);
    }

    /**
     * Resolves the value to bind for a single column during INSERT / UPDATE,
     * BEFORE the SQL-type-driven coercion in
     * {@link ArchitectureCloneService#coerceForSqlType(Object, int)} is
     * applied. Returns the raw value (possibly a {@link UUID} from a PG
     * uuid column or a {@link String} from an H2 TEXT column) — the caller
     * coerces to the column's declared SQL type before binding.
     *
     * <p>Hotfix #2: any column listed in {@link #NON_FK_STRING_COLUMNS}
     * passes through verbatim — never substituted via {@code fkRewireMap}.
     * This prevents the {@code project_id} column from being silently
     * rewritten to a non-existent UUID when its value happens to coincide
     * with a duplicate-action element id (which is possible because the
     * Default architecture's id equals the project id by spec #1's
     * deterministic rule).</p>
     */
    private Object projectColumnValue(String column,
                                      Object value,
                                      String rowIdForInsertOrUpdate,
                                      Map<String, String> fkRewireMap,
                                      WalkState state) {
        if ("id".equals(column)) {
            return rowIdForInsertOrUpdate;
        }
        if ("architecture_id".equals(column)) {
            // Always rewire to the target architecture; coerceForSqlType
            // will turn this into a UUID object for the bind.
            return state.targetArchitectureId;
        }
        if (NON_FK_STRING_COLUMNS.contains(column)) {
            // project_id (and any future out-of-scope FK column listed in
            // NON_FK_STRING_COLUMNS) must pass through verbatim — never
            // substituted via the per-call FK rewire map. See the audit
            // comment on NON_FK_STRING_COLUMNS for the column-by-column
            // justification.
            return value;
        }
        // FK rewiring — handle both String- and UUID-shaped incoming values.
        String idStr = stringifyIdLike(value);
        if (idStr != null && fkRewireMap.containsKey(idStr)) {
            return fkRewireMap.get(idStr);
        }
        return value;
    }

    private Map<String, Integer> discoverColumnTypes(String table) {
        DataSource ds = jdbcTemplate.getDataSource();
        if (ds == null) {
            throw new IllegalStateException("JdbcTemplate has no DataSource");
        }
        try (Connection conn = ds.getConnection()) {
            DatabaseMetaData md = conn.getMetaData();
            Map<String, Integer> columns = readColumnTypes(md, table);
            if (columns.isEmpty()) {
                columns = readColumnTypes(md, table.toUpperCase(Locale.ROOT));
            }
            return columns;
        } catch (SQLException e) {
            throw new IllegalStateException(
                "Failed to discover columns for table '" + table + "': " + e.getMessage(), e);
        }
    }

    private Map<String, Integer> readColumnTypes(DatabaseMetaData md, String table) throws SQLException {
        Map<String, Integer> ordered = new LinkedHashMap<>();
        try (ResultSet rs = md.getColumns(null, null, table, null)) {
            while (rs.next()) {
                String name = rs.getString("COLUMN_NAME");
                if (name == null) continue;
                String lower = name.toLowerCase(Locale.ROOT);
                if (ordered.containsKey(lower)) continue;
                int type = rs.getInt("DATA_TYPE");
                String typeName = rs.getString("TYPE_NAME");
                if (typeName != null && "uuid".equalsIgnoreCase(typeName.trim())) {
                    type = Types.OTHER;
                }
                ordered.put(lower, type);
            }
        }
        return ordered;
    }

    private String resolveDisplayName(Map<String, Object> row, String fallback) {
        Object name = row.get("name");
        if (name == null) {
            return fallback;
        }
        String s = name.toString();
        return s.isEmpty() ? fallback : s;
    }

    private static boolean looksLikeUuid(String s) {
        if (s == null || s.length() != 36) return false;
        try {
            UUID.fromString(s);
            return true;
        } catch (IllegalArgumentException ex) {
            return false;
        }
    }

    /**
     * Returns the supplied value as a String iff it is a {@link String} or
     * a {@link UUID}; returns {@code null} otherwise. Used by the FK
     * rewiring branch so values returned as {@code UUID} from a native PG
     * uuid column are still recognisable as map keys.
     */
    private static String stringifyIdLike(Object value) {
        if (value == null) return null;
        if (value instanceof UUID u) return u.toString();
        if (value instanceof String s) return s;
        return null;
    }

    // =========================================================================
    // INNER STATE TYPES
    // =========================================================================

    /**
     * Per-call walk state. Tracks the user's selection, the auto-include
     * set, target-existence reuse hits, and the table-partitioned resolved
     * row cache. All maps are local to the call — never persisted, never
     * leaked.
     */
    private static final class WalkState {
        final UUID sourceArchitectureId;
        final UUID targetArchitectureId;
        final LinkedHashSet<String> userSelected = new LinkedHashSet<>();
        final LinkedHashSet<String> resolved = new LinkedHashSet<>();
        final LinkedHashMap<String, AutoIncludeRecord> autoIncluded = new LinkedHashMap<>();
        final LinkedHashSet<String> targetReuses = new LinkedHashSet<>();
        /** Per-table id -> resolved-row, in in-scope-table order. */
        final LinkedHashMap<String, Map<String, ResolvedElement>> elementsByTable = new LinkedHashMap<>();
        /** Source row lookups are expensive; cache hits + misses. */
        final Map<String, ResolvedElement> sourceLookupCache = new HashMap<>();
        final Set<String> sourceLookupMisses = new HashSet<>();
        /** Target existence probes — cached because we ask multiple times per id. */
        final Map<String, Boolean> targetExistenceCache = new HashMap<>();

        WalkState(UUID sourceArchitectureId, UUID targetArchitectureId) {
            this.sourceArchitectureId = sourceArchitectureId;
            this.targetArchitectureId = targetArchitectureId;
        }
    }

    /** A row located in the source architecture, with its display name + columns. */
    private static final class ResolvedElement {
        final String table;
        final String id;
        final String displayName;
        final Map<String, Object> row;
        final List<String> columns;
        final Map<String, Integer> columnTypes;

        ResolvedElement(String table, String id, String displayName,
                        Map<String, Object> row, List<String> columns,
                        Map<String, Integer> columnTypes) {
            this.table = table;
            this.id = id;
            this.displayName = displayName;
            this.row = row;
            this.columns = columns;
            this.columnTypes = columnTypes;
        }
    }

    /** An auto-included element, paired with the parent that pulled it in. */
    private static final class AutoIncludeRecord {
        final ResolvedElement element;
        final String parentName;

        AutoIncludeRecord(ResolvedElement element, String parentName) {
            this.element = element;
            this.parentName = parentName;
        }
    }

}
