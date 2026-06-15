package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.exception.EmptyCurrentArchitectureException;
import com.example.architecturemodel.exception.RecentDuplicateSuggestException;
import com.example.architecturemodel.model.dto.SuggestFromCurrentRequest;
import com.example.architecturemodel.model.dto.SuggestFromCurrentResponse;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Deterministic "Suggest target architecture from current" service.
 *
 * <p>Replaces the broken May-20 LLM-driven Suggest flow with a deterministic
 * one-click path that:</p>
 * <ol>
 *   <li><b>Phase 1</b> -- probes the source architecture's
 *       {@code architecture_id}-scoped element-table row counts via direct
 *       JDBC and rejects zero-element sources with HTTP 422 (mapped from
 *       {@link EmptyCurrentArchitectureException}). The spec text describes
 *       this as "load the current architecture via
 *       {@code loadModelByProjectIdAndArchitectureId}" but the only consumer
 *       of the loaded DTO would be the empty check, and a direct JDBC
 *       {@code SELECT COUNT(*)} sum is equivalent in semantics, faster, and
 *       sidesteps a Hibernate eager-fetch cascade.</li>
 *   <li><b>Phase 2</b> -- delegates the deep-copy to
 *       {@link ArchitectureCloneService#cloneArchitecture(UUID, UUID, String, String, List, Set)}
 *       passing an explicit set of diagram-domain tables to EXCLUDE so the
 *       cloned target draft inherits every meta-model entity but no diagram
 *       payload. Resolves the auto-name
 *       {@code "Target State - Suggested YYYY-MM-DD"} with same-day numeric
 *       suffix {@code " (2)"} / {@code " (3)"} / ... and enforces a 5-second
 *       server-side double-click guard via
 *       {@link RecentDuplicateSuggestException} (mapped to HTTP 409). After
 *       the clone returns, the new architecture row is flipped to
 *       {@code kind='target'} + {@code draft_state='draft'}, and every cloned
 *       row on the 4 supertype tables is stamped
 *       {@code provenance='cloned-from'}.</li>
 *   <li><b>Phase 3</b> -- in the SAME {@code @Transactional} boundary, writes
 *       one {@code architecture_element_mappings} row per cloned element
 *       (joined by name within each supertype table) with
 *       {@code mapping_type='equivalent'}, {@code status='confirmed'},
 *       {@code confidence=1.0}, {@code created_by_task='target-state-suggest'}.
 *       Phase 3 failure rolls back Phase 2.</li>
 * </ol>
 *
 * <p>Architecture Model Service note: All user-facing error messages spell out
 * "Architecture Model Service" rather than "AMS" per project naming convention
 * (see {@code feedback_no_invented_acronyms.md}).</p>
 *
 * <p>Spec: Target State Sub-tab + Deterministic Suggest (2026-05-24)
 * -- Task Group 1.</p>
 */
@Service
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class SuggestFromCurrentService {

    /**
     * Auto-name prefix for the new draft. Same-day repeats append
     * {@code " (2)"}, {@code " (3)"}, etc.
     */
    static final String AUTO_NAME_PREFIX = "Target State - Suggested";

    /**
     * Date format embedded in the auto-name. UTC to match the existing
     * {@link TargetArchitectureSeedService#resolveDraftName} convention.
     */
    static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    /**
     * Window (seconds) inside which a draft with the resolved auto-name is
     * treated as a same-click double-tap and rejected with HTTP 409 via
     * {@link RecentDuplicateSuggestException}.
     */
    static final Duration DOUBLE_CLICK_WINDOW = Duration.ofSeconds(5);

    /**
     * Diagram-domain tables passed to {@link ArchitectureCloneService} as the
     * {@code excludedTables} argument so the cloned target draft has zero
     * diagram payload. Matches the existing Selective Copy exclusion AND the
     * spec's "drop Diagram View" decision.
     *
     * <p>Includes both base diagram tables and dependent diagram tables so
     * the FK-rewiring map never holds entries for diagram parents.</p>
     */
    static final Set<String> DIAGRAM_TABLES_TO_EXCLUDE = Set.of(
        // Sequence-diagram domain
        "sequence_diagrams",
        "sequence_participants",
        "sequence_messages",
        "sequence_fragments",
        "sequence_operands",
        "sequence_nodes",
        // Generic-diagram domain
        "diagrams",
        "diagram_nodes",
        "diagram_decorations",
        "diagram_edges",
        "diagram_interaction_edges",
        // Project-direct temporary diagrams
        "temporary_diagrams"
    );

    /**
     * The four element supertype tables that carry the {@code provenance}
     * column (added by changeset 145). After the clone returns, every cloned
     * row on these four tables is stamped {@code provenance='cloned-from'}.
     * Mirrors {@link TargetArchitectureSeedService#ELEMENT_SUPERTYPE_TABLES}.
     */
    static final List<String> PROVENANCE_TABLES = List.of(
        "application_components",
        "interfaces",
        "data_entity_points",
        "infrastructure_points"
    );

    /**
     * Element-level tables whose cloned rows get one
     * {@code architecture_element_mappings} row each in Phase 3.
     *
     * <p>Broader than {@link #PROVENANCE_TABLES} because the spec's Phase 3
     * contract ("one mapping row per cloned element") covers every meta-model
     * entity table, not just the four supertype tables. Pairing source-to-new
     * rows is done by name within each table (the clone service preserves
     * names verbatim, so a name-based join is reliable for clone-current).</p>
     *
     * <p>Tables in this list that do not have a {@code name} column at
     * runtime (e.g. {@code data_entity_points} is identity-by-FK, not
     * name-keyed) are skipped at mapping time -- see
     * {@link #stampProvenanceOnly} / {@link #createMappingsById}. Joins
     * tables, relationship tables, and diagram tables are NOT in this list:
     * mappings are an element-level concept and diagram payload is excluded
     * from the clone.</p>
     *
     * <p>Curated from {@link ArchitectureCloneService#IN_SCOPE_TABLES_IN_ORDER}
     * by keeping every base-entity table that has a user-visible {@code name}
     * column.</p>
     */
    static final List<String> MAPPABLE_ELEMENT_TABLES = List.of(
        // BUSINESS domain
        "business_users",
        "business_processes",
        "process_activities",
        "business_points",
        "business_logics",
        "user_journeys",
        // DATA domain. data_entity_points is FK-only (no name column) but is
        // now mapped via the clone id-correlation (not by name), so it is
        // included -- the right-side Unmapped/Compare panels query it.
        "logical_data_entities",
        "logical_data_attributes",
        "physical_data_entities",
        "physical_data_attributes",
        "data_entity_points",
        // APPLICATION domain
        "applications",
        "application_components",
        "package_sets",
        "packages",
        "services",
        "libraries",
        "interfaces",
        "endpoints",
        "application_points",
        "classes",
        "methods",
        // INTERACTION domain
        "app_business_points",
        "interactions",
        // BEHAVIOURAL domain
        "events",
        "states",
        "activities",
        "activity_partitions",
        // UI domain
        "ui_screens",
        "ui_components",
        "ui_contracts",
        "ui_actions",
        "ui_characteristics",
        // INFRASTRUCTURE domain
        "environments",
        "cloud_accounts",
        "locations",
        "networks",
        "subnets",
        "compute_clusters",
        "compute_resources",
        "deployment_units",
        "load_balancers",
        "listeners",
        "data_store_instances",
        "infrastructure_resources",
        "iac_sources",
        "infrastructure_points"
    );

    /** Provenance vocabulary value stamped on cloned elements. */
    static final String PROVENANCE_VALUE = "cloned-from";

    /** Mapping fields per the spec's Phase 3 contract. */
    static final String MAPPING_TYPE_EQUIVALENT = "equivalent";
    static final String MAPPING_STATUS_CONFIRMED = "confirmed";
    static final double MAPPING_CONFIDENCE = 1.0d;
    static final String MAPPING_CREATED_BY_TASK = "target-state-suggest";

    /** New draft kind / draft_state stamps. */
    static final String DRAFT_KIND_TARGET = "target";
    static final String DRAFT_STATE_DRAFT = "draft";

    private final ArchitectureRepository architectureRepository;
    private final ArchitectureCloneService architectureCloneService;
    private final ArchitectureElementMappingRepository mappingRepository;
    private final JdbcTemplate jdbcTemplate;

    public SuggestFromCurrentService(
            ArchitectureRepository architectureRepository,
            ArchitectureCloneService architectureCloneService,
            ArchitectureElementMappingRepository mappingRepository,
            JdbcTemplate jdbcTemplate) {
        this.architectureRepository = architectureRepository;
        this.architectureCloneService = architectureCloneService;
        this.mappingRepository = mappingRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * Suggests a new target draft by cloning the supplied current architecture
     * 1:1 and writing equivalence mapping rows from every source element to
     * its cloned counterpart.
     *
     * <p>All three phases share one {@code @Transactional} boundary: any
     * exception (validation, JDBC failure, mapping-insert failure) triggers a
     * full rollback so the new draft, its cloned rows, and any mapping rows
     * either all commit or all roll back together.</p>
     *
     * @param projectId the project the source architecture must belong to
     * @param request   the request body carrying the source
     *                  {@code currentArchitectureId}
     * @return the response DTO with the new draft id + resolved name + cloned
     *         element / mapping row counts
     * @throws EmptyCurrentArchitectureException
     *     if the source architecture has zero in-scope elements (mapped to 422
     *     {@code empty_current_architecture})
     * @throws RecentDuplicateSuggestException
     *     if a draft with the resolved auto-name was created within the last
     *     5 seconds (mapped to 409 {@code recent_duplicate_suggest})
     * @throws ArchitectureNotFoundException
     *     if {@code currentArchitectureId} is missing / cross-project
     *     (mapped to 404 by the existing handler)
     */
    @Transactional
    public SuggestFromCurrentResponse suggestFromCurrent(UUID projectId,
                                                         SuggestFromCurrentRequest request) {
        Objects.requireNonNull(projectId, "projectId is required");
        Objects.requireNonNull(request, "request body is required");
        UUID sourceArchitectureId = request.currentArchitectureId();
        if (sourceArchitectureId == null) {
            throw new IllegalArgumentException(
                "currentArchitectureId is required so the Architecture Model Service can "
                    + "deterministically clone the user's intended source architecture");
        }

        // ----- Pre-flight: source exists + belongs to project (404 if not) -----
        ArchitectureEntity source = architectureRepository.findById(sourceArchitectureId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Architecture not found: " + sourceArchitectureId));
        if (!projectId.equals(source.getProjectId())) {
            throw new ArchitectureNotFoundException(
                "Architecture " + sourceArchitectureId + " not found in project " + projectId);
        }

        // ----- Phase 1: empty-source guard via JDBC element-count probe -----
        //
        // The spec language reads "load the current architecture via
        // loadModelByProjectIdAndArchitectureId" but the only consumer of the
        // loaded DTO here is the zero-element check. A direct JDBC sum over the
        // model_files-anchored element tables is equivalent for the empty-check
        // purpose and:
        //   (a) avoids the Hibernate eager-fetch cascade that would marshal
        //       every entity DTO just to count them, and
        //   (b) sidesteps the H2 test-fixture quirk where the H2Dialect emits
        //       unquoted SQL for reserved-keyword columns (e.g.
        //       ui_characteristics.key), which breaks the deep load even though
        //       PostgreSQL handles it fine in production.
        int sourceElementCount = countElementsByJdbc(sourceArchitectureId);
        log.info("Suggest-from-current Phase 1: project={}, source={}, sourceElementCount={}",
            projectId, sourceArchitectureId, sourceElementCount);
        if (sourceElementCount == 0) {
            // The Architecture Model Service refuses to suggest from an empty source
            // because the user-visible target would be indistinguishable from a blank
            // draft (HTTP 422 with the exact message the frontend matches against).
            throw new EmptyCurrentArchitectureException();
        }

        // ----- Phase 2: resolve auto-name + double-click guard, then clone -----
        String resolvedName = resolveAutoName(projectId);
        log.info("Suggest-from-current Phase 2: project={}, source={}, resolvedName='{}'",
            projectId, sourceArchitectureId, resolvedName);

        var cloneResult = architectureCloneService.cloneArchitectureWithIdMap(
            projectId,
            sourceArchitectureId,
            resolvedName,
            /* description */ "Suggested 1:1 clone of the current architecture, "
                + "created by the Architecture Model Service deterministic Suggest path. "
                + "Every cloned element has provenance='" + PROVENANCE_VALUE + "' and is "
                + "paired with its source via an architecture_element_mappings row.",
            /* tags */ List.of(),
            DIAGRAM_TABLES_TO_EXCLUDE);
        var cloned = cloneResult.dto();

        UUID newDraftId = cloned.id();

        // Invert the clone's id correlation (oldId -> newId) to newId -> oldId so
        // the mapping pass below pairs each cloned element with its source by
        // STABLE id, not by name -- robust to duplicate names + FK-only tables.
        Map<String, String> newIdToSourceId = new HashMap<>(cloneResult.idMap().size());
        for (Map.Entry<String, String> e : cloneResult.idMap().entrySet()) {
            newIdToSourceId.put(e.getValue(), e.getKey());
        }

        // ----- Flip new architecture to kind='target' + draft_state='draft' -----
        ArchitectureEntity newArch = architectureRepository.findById(newDraftId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Cloned architecture missing post-clone: " + newDraftId));
        newArch.setKind(DRAFT_KIND_TARGET);
        newArch.setDraftState(DRAFT_STATE_DRAFT);
        architectureRepository.saveAndFlush(newArch);

        // ----- Stamp provenance on the four supertype tables -----
        int totalStamped = 0;
        for (String table : PROVENANCE_TABLES) {
            totalStamped += stampProvenanceOnly(table, newDraftId);
        }

        // ----- Phase 3: write one mapping row per cloned element across the
        //                broader set of mappable element tables -----
        int totalCloned = 0;
        int totalMappings = 0;
        for (String table : MAPPABLE_ELEMENT_TABLES) {
            StampAndMapResult result = createMappingsById(
                projectId, table, sourceArchitectureId, newDraftId, newIdToSourceId);
            totalCloned += result.stampedRows;
            totalMappings += result.mappingRows;
        }

        log.info("Suggest-from-current Phase 3: project={}, newDraftId={}, "
                + "provenanceStamped={}, clonedElementCount={}, mappingRowCount={}",
            projectId, newDraftId, totalStamped, totalCloned, totalMappings);

        return new SuggestFromCurrentResponse(newDraftId, resolvedName, totalCloned, totalMappings);
    }

    // ------------------------------------------------------------------------
    // Auto-name resolution + double-click guard
    // ------------------------------------------------------------------------

    /**
     * Resolves the auto-generated draft name with same-day numeric suffix and
     * a 5-second double-click guard.
     *
     * <p>Algorithm:</p>
     * <ol>
     *   <li>Start with {@code candidate = "Target State - Suggested YYYY-MM-DD"}.</li>
     *   <li>If no draft with that name exists in the project, return it.</li>
     *   <li>If a draft with that name exists AND was created within the last
     *       5 seconds, throw {@link RecentDuplicateSuggestException} (409).</li>
     *   <li>Otherwise, increment the suffix ({@code (2)}, {@code (3)}, ...) and
     *       repeat from step 2 with the new candidate.</li>
     * </ol>
     *
     * <p>The suffix loop is bounded at 1000 iterations to defend against a
     * pathological project state; in practice fewer than 10 same-day repeats
     * is the normal upper bound.</p>
     */
    String resolveAutoName(UUID projectId) {
        String datePart = LocalDate.now(ZoneOffset.UTC).format(DATE_FORMAT);
        String base = AUTO_NAME_PREFIX + " " + datePart;

        Instant now = Instant.now();
        for (int suffix = 1; suffix <= 1000; suffix++) {
            String candidate = suffix == 1
                ? base
                : String.format(Locale.ROOT, "%s (%d)", base, suffix);

            Optional<ArchitectureEntity> existing =
                architectureRepository.findFirstByProjectIdAndNameIgnoreCase(projectId, candidate);
            if (existing.isEmpty()) {
                return candidate;
            }

            // Existing draft with this name -- check the 5-second window.
            Instant createdAt = existing.get().getCreatedAt();
            if (createdAt != null) {
                Duration age = Duration.between(createdAt, now);
                if (!age.isNegative() && age.compareTo(DOUBLE_CLICK_WINDOW) < 0) {
                    // Within the double-click window: refuse with 409.
                    log.warn("Suggest-from-current double-click guard fired: name='{}', "
                            + "existingDraftId={}, ageSeconds={}",
                        candidate, existing.get().getId(), age.toSeconds());
                    throw new RecentDuplicateSuggestException(candidate);
                }
            }
            // Older than the double-click window: move on to the next suffix.
        }
        // Effectively unreachable in any sane project state, but fail loudly
        // rather than spinning forever if the suffix space is exhausted.
        throw new IllegalStateException(
            "Failed to resolve a unique auto-generated draft name for project " + projectId
                + " after 1000 suffix attempts (base='" + base + "')");
    }

    // ------------------------------------------------------------------------
    // Phase 3: provenance stamp + mapping-row generation per supertype table
    // ------------------------------------------------------------------------

    /**
     * Stamps {@code provenance='cloned-from'} on every row of the
     * supplied supertype table tied to the new architecture (via the
     * {@code model_files} join). No-op if the table is empty for the new
     * architecture.
     *
     * @return the count of rows stamped
     */
    int stampProvenanceOnly(String table, UUID newArchitectureId) {
        int stamped = jdbcTemplate.update(
            "UPDATE " + table
                + " SET provenance = ? "
                + " WHERE model_file_id IN ("
                + "    SELECT id FROM model_files WHERE architecture_id = ?"
                + " )"
                + " AND provenance IS NULL",
            PROVENANCE_VALUE,
            newArchitectureId);
        if (stamped == 0) {
            log.debug("No provenance stamps on table '{}' for new architecture {}",
                table, newArchitectureId);
        } else {
            log.debug("Stamped provenance on {} rows in '{}' for new architecture {}",
                stamped, table, newArchitectureId);
        }
        return stamped;
    }

    /**
     * Writes one {@code architecture_element_mappings} row per cloned element in
     * {@code table}, pairing each new row with its source row via the clone's
     * STABLE id correlation map ({@code newIdToSourceId}) rather than by name.
     *
     * <p>Why id correlation, not name: pairing by name (the previous approach)
     * collapsed duplicate names within a table -- two
     * {@code physical_data_attributes} called "ValidFrom" would map to a single
     * source, leaving the other current element with no mapping (and so flagged
     * "decommissioned in target"). It also could not map the FK-only supertype
     * tables ({@code data_entity_points}, {@code infrastructure_points}) which
     * have no name column at all. The clone's {@code oldId -> newId} map, here
     * inverted to {@code newId -> oldId}, pairs every cloned row with its exact
     * source regardless of name.</p>
     *
     * <p>Resilience: a missing table at runtime (older H2 fixture) is caught and
     * returns zero; a new row with no source correlation (should not happen
     * post-clone) is logged and skipped rather than failing the transaction.</p>
     *
     * @return the (new-row-count, mapping-row-count) pair.
     */
    StampAndMapResult createMappingsById(
            UUID projectId,
            String table,
            UUID sourceArchitectureId,
            UUID newArchitectureId,
            Map<String, String> newIdToSourceId) {

        List<Map<String, Object>> newRows;
        try {
            newRows = jdbcTemplate.queryForList(
                "SELECT t.id AS id FROM " + table + " t "
                    + " WHERE t.model_file_id IN ("
                    + "    SELECT id FROM model_files WHERE architecture_id = ?"
                    + " )",
                newArchitectureId);
        } catch (org.springframework.jdbc.BadSqlGrammarException ex) {
            log.debug("Skipping mapping for table '{}': not present at runtime ({})",
                table, ex.getMessage());
            return new StampAndMapResult(0, 0);
        }
        if (newRows.isEmpty()) {
            return new StampAndMapResult(0, 0);
        }

        List<ArchitectureElementMappingEntity> mappings = new ArrayList<>();
        Instant now = Instant.now();
        for (Map<String, Object> row : newRows) {
            Object newIdObj = row.get("id");
            if (newIdObj == null) {
                continue;
            }
            String newId = newIdObj.toString();
            String sourceId = newIdToSourceId.get(newId);
            if (sourceId == null) {
                log.warn("Suggest-from-current mapping skipped: no source id correlation "
                        + "for cloned element {} on table '{}'", newId, table);
                continue;
            }
            mappings.add(ArchitectureElementMappingEntity.builder()
                .id(UUID.randomUUID())
                .projectId(projectId)
                .sourceArchitectureId(sourceArchitectureId)
                .targetArchitectureId(newArchitectureId)
                .sourceElementType(table)
                .sourceElementId(sourceId)
                .targetElementType(table)
                .targetElementId(newId)
                .mappingType(MAPPING_TYPE_EQUIVALENT)
                .status(MAPPING_STATUS_CONFIRMED)
                .createdByTask(MAPPING_CREATED_BY_TASK)
                .createdAt(now)
                .updatedAt(now)
                .confidence(MAPPING_CONFIDENCE)
                .build());
        }

        int mappingCount = 0;
        if (!mappings.isEmpty()) {
            mappingRepository.saveAll(mappings);
            mappingRepository.flush();
            mappingCount = mappings.size();
            log.debug("Inserted {} suggest-from-current mappings for table '{}'",
                mappingCount, table);
        }
        return new StampAndMapResult(newRows.size(), mappingCount);
    }

    /** Pair carrying per-table phase 3 counts back to the caller. */
    record StampAndMapResult(int stampedRows, int mappingRows) { }

    // ------------------------------------------------------------------------
    // Phase 1: empty-element count helpers
    // ------------------------------------------------------------------------

    /**
     * Counts every element row across the {@link #MAPPABLE_ELEMENT_TABLES} set
     * that belongs to the architecture, scoped via the {@code model_files} join
     * (the SAME scoping {@link #stampProvenanceOnly} / {@link #createMappingsById}
     * use). Used by Phase 1 to decide whether to reject with HTTP 422.
     *
     * <p>CRITICAL: the probe MUST scope through {@code model_file_id}, NOT a
     * direct {@code architecture_id} column. Only the four supertype tables
     * carry a denormalised {@code architecture_id}; the rest are
     * model-file-anchored. A {@code WHERE architecture_id = ?} probe against a
     * table without that column raises "column does not exist" on PostgreSQL,
     * which ABORTS THE ENTIRE TRANSACTION -- every later statement (e.g. the
     * auto-name lookup in {@link #resolveAutoName}) then fails with "current
     * transaction is aborted" and the whole Suggest call 500s. H2 tolerates the
     * bad column within a transaction, so this only surfaced in production. The
     * per-table {@code catch} below is a last-resort guard for a genuinely
     * missing table in a fixture; it does NOT (and cannot) un-abort a poisoned
     * PostgreSQL transaction, so the query itself must be valid against every
     * listed table.</p>
     */
    int countElementsByJdbc(UUID architectureId) {
        int total = 0;
        for (String table : MAPPABLE_ELEMENT_TABLES) {
            try {
                Long c = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM " + table
                        + " WHERE model_file_id IN ("
                        + "    SELECT id FROM model_files WHERE architecture_id = ?"
                        + " )",
                    Long.class, architectureId);
                if (c != null) {
                    total += c.intValue();
                }
            } catch (org.springframework.dao.DataAccessException ex) {
                log.debug("Element-count probe skipped for missing/inaccessible table '{}': {}",
                    table, ex.getMessage());
            }
        }
        return total;
    }

}
