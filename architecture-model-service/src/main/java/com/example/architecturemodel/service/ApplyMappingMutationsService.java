package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.targetstate.ApplyMappingMutationsRequest;
import com.example.architecturemodel.model.dto.targetstate.ApplyMappingMutationsResponse;
import com.example.architecturemodel.model.dto.targetstate.ApplyMappingMutationsResponse.TableSetSummary;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.TargetStateCapturedDecisionEntity;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Service that applies the deterministic mapping mutations side-effects of a
 * single captured architect decision, inside one {@code @Transactional}
 * boundary per Q13.
 *
 * <p>Spec: Target State Architect-Persona Conversation
 * (2026-05-24-target-state-architect-conversation) -- Task Group 4.</p>
 *
 * <h2>Responsibility split with the gateway</h2>
 *
 * <p>The gateway owns the mutation rules
 * ({@code gateway/src/config/architect-conversation/mappingMutationRules.ts})
 * and forwards the rule subset for the captured decision's {@code decisionCode}
 * here. This service is the executor: it does NOT look up rules by code, it
 * applies what the request body carries:</p>
 * <ul>
 *   <li>Decorates the {@code notes} field of every affected mapping with
 *       {@code [decision:<code>]} via
 *       {@link ArchitectureElementMappingNotesDecorator#decorateWithDecision}
 *       (idempotent -- re-running the endpoint does not duplicate the tag).</li>
 *   <li>Sets {@code mapping_type} to the value implied by
 *       {@link ApplyMappingMutationsRequest#defaultMappingTypeChange} when it is
 *       a real change ({@code "keep-equivalent"}, {@code "replaced_by"},
 *       {@code "renamed"}, {@code "merged"}, {@code "split"}); {@code "none"}
 *       is notes-only.</li>
 *   <li>Never touches {@code created_by_task} (per Q14). The original task
 *       attribution stays intact across mapping-mutation runs.</li>
 * </ul>
 *
 * <h2>Affected-set scoping (per Q15 parent-not-leaf)</h2>
 *
 * <p>v1 narrows the affected set to mappings whose
 * {@code target_architecture_id} matches the captured decision's
 * {@code target_architecture_id} (the canonical scope). Per the
 * 2026-05-22 architecture-scope-via-parent-not-leaf spec the leaf
 * {@code architecture_id} column is not authoritative for reads, but
 * {@code architecture_element_mappings} itself is a direct project /
 * architecture table -- there is no parent chain to walk for this particular
 * table per
 * {@link ArchitectureScopeResolver}'s "Tables NOT in this map" comment
 * (it lists {@code architecture_element_mappings} explicitly). So
 * {@code target_architecture_id = ?} is the canonical scope filter here.</p>
 *
 * <p>Per-element exception narrowing: when the request carries
 * {@code elementRefType + elementRefId} (the captured decision was scoped to
 * a single element), the affected set is narrowed to a single row matching
 * {@code source_element_type = <elementRefType-plural>} AND
 * {@code source_element_id = <elementRefId>} within the target architecture.</p>
 *
 * <h2>Element-type singular-to-plural conversion</h2>
 *
 * <p>The mapping rules express table sets as singulars (e.g.
 * {@code "service"}, {@code "interface"}, {@code "endpoint"}) -- those are
 * the {@code scope_ref_type} closed set values from Q12. The mapping table
 * stores {@code source_element_type} / {@code target_element_type} as the
 * plural snake_case table names (e.g. {@code "services"},
 * {@code "interfaces"}, {@code "endpoints"}, {@code "applications"}). This
 * service converts via the static map below; unknown singular values raise
 * {@link IllegalArgumentException} (programmer-error guard rail -- mapped to
 * HTTP 400 by {@code GlobalExceptionHandler}).</p>
 *
 * <p>{@code "data_entity_points"} is already plural by convention -- it is in
 * the affected-table set for {@code db.engine} but is not a
 * {@code scope_ref_type} value, so it is passed through unchanged.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApplyMappingMutationsService {

    /** Notes-only change marker -- mapping_type is preserved as-is. */
    public static final String CHANGE_NONE = "none";

    /** Idempotent change: mapping_type is set to {@code "equivalent"}. */
    public static final String CHANGE_KEEP_EQUIVALENT = "keep-equivalent";

    /** Allowed change kinds the request body's {@code defaultMappingTypeChange} may carry. */
    public static final Set<String> ALLOWED_CHANGE_KINDS = Set.of(
        CHANGE_NONE,
        CHANGE_KEEP_EQUIVALENT,
        "replaced_by",
        "renamed",
        "merged",
        "split"
    );

    /**
     * Singular {@code scope_ref_type} -> plural element-type column value
     * (the canonical mapping for the closed Q12 set + the {@code db.engine}
     * extras). New entries here are an additive change.
     */
    private static final Map<String, String> SINGULAR_TO_PLURAL = buildSingularToPlural();

    private final TargetStateCapturedDecisionService capturedDecisionService;
    private final ArchitectureElementMappingRepository mappingRepository;

    private static Map<String, String> buildSingularToPlural() {
        Map<String, String> m = new LinkedHashMap<>();
        // Q12 closed set
        m.put("service", "services");
        m.put("interface", "interfaces");
        m.put("endpoint", "endpoints");
        m.put("physical_data_entity", "physical_data_entities");
        m.put("physical_data_attribute", "physical_data_attributes");
        m.put("method", "methods");
        m.put("class", "classes");
        // db.engine extras (already plural by convention)
        m.put("data_entity_points", "data_entity_points");
        return Collections.unmodifiableMap(m);
    }

    /**
     * Applies the mutation rule subset to all mappings under the target
     * architecture, scoped by table set and (optionally) by element ref.
     *
     * <p>Runs inside a single {@code @Transactional} boundary so either all
     * affected rows commit together or all roll back together (per Q13).</p>
     *
     * @param projectId             path-scoped project id; the decision row
     *                              must match.
     * @param targetArchitectureId  path-scoped target architecture id; the
     *                              decision row must match; the affected
     *                              mapping set is filtered to this architecture.
     * @param decisionId            the captured decision whose code drives the
     *                              {@code [decision:<code>]} notes decoration.
     * @param request               the rule subset forwarded by the gateway.
     * @return                      per-table-set + aggregate summary for the
     *                              gateway to convert into a
     *                              {@code mapping-mutation-summary} turn.
     * @throws ResourceNotFoundException with HTTP 404 envelope when the
     *         {@code decisionId} does not exist OR when the loaded decision's
     *         {@code project_id} / {@code target_architecture_id} do not match
     *         the path (cross-project leak guard per Q15-style 404 not 403).
     * @throws IllegalArgumentException on malformed request (e.g. unknown
     *         change kind, mixed elementRefType/elementRefId presence). Mapped
     *         to HTTP 400 by {@code GlobalExceptionHandler}.
     */
    @Transactional
    public ApplyMappingMutationsResponse applyMutations(
            UUID projectId,
            UUID targetArchitectureId,
            UUID decisionId,
            ApplyMappingMutationsRequest request) {

        if (request == null) {
            throw new IllegalArgumentException(
                "Architecture Model Service apply-mapping-mutations requires a request body");
        }
        if (projectId == null || targetArchitectureId == null || decisionId == null) {
            throw new IllegalArgumentException(
                "Architecture Model Service apply-mapping-mutations requires non-null projectId, "
                    + "targetArchitectureId, and decisionId");
        }
        validateRequest(request);

        // Cross-project leak guard mirrors Spec 2's pattern -- the service
        // collapses cross-project / cross-architecture misses to
        // ResourceNotFoundException (HTTP 404, not 403) so we never confirm
        // existence of a row in a sibling project to an attacker guessing
        // UUIDs.
        TargetStateCapturedDecisionEntity decision = capturedDecisionService
            .findById(projectId, targetArchitectureId, decisionId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Architecture Model Service captured-decision row " + decisionId
                    + " not found for project " + projectId
                    + " and target architecture " + targetArchitectureId));

        String decisionCode = decision.getDecisionCode();
        log.info(
            "Architecture Model Service apply-mapping-mutations: "
            + "project={}, targetArchitecture={}, decisionId={}, decisionCode={}, "
            + "tableSets={}, change={}, scopeBoundary={}, elementRef={}/{}",
            projectId, targetArchitectureId, decisionId, decisionCode,
            request.affectedTableSets(),
            request.defaultMappingTypeChange(),
            request.scopeBoundary(),
            request.elementRefType(), request.elementRefId());

        List<String> tableSets = request.affectedTableSets() == null
            ? List.of()
            : request.affectedTableSets();
        String change = request.defaultMappingTypeChange();
        String elementRefType = request.elementRefType();
        String elementRefId = request.elementRefId();

        // Notes-only fallback: when the rule lists no table sets we still
        // decorate ALL mappings under the target architecture (the decision
        // is architecture-wide -- the audit linkage matters even when no
        // mapping_type changes). Element-scoped exception narrows this to the
        // single matching row.
        long totalAffected = 0L;
        long totalMappingTypeChanges = 0L;
        long totalNotesDecorations = 0L;
        List<TableSetSummary> perTableSet = new ArrayList<>();

        if (tableSets.isEmpty()) {
            MutationCounts counts = applyToFilteredRows(
                targetArchitectureId, decisionCode, change, null, elementRefType, elementRefId);
            totalAffected += counts.affected;
            totalMappingTypeChanges += counts.mappingTypeChanges;
            totalNotesDecorations += counts.notesDecorations;
            // No per-table-set entry -- the gateway interprets the empty list
            // as "notes-only" and renders the aggregates verbatim.
        } else {
            for (String singularTable : tableSets) {
                String pluralTable = toPluralTable(singularTable);
                MutationCounts counts = applyToFilteredRows(
                    targetArchitectureId, decisionCode, change,
                    pluralTable, elementRefType, elementRefId);
                totalAffected += counts.affected;
                totalMappingTypeChanges += counts.mappingTypeChanges;
                totalNotesDecorations += counts.notesDecorations;
                perTableSet.add(new TableSetSummary(
                    singularTable,
                    counts.affected,
                    counts.mappingTypeChanges,
                    counts.notesDecorations));
            }
        }

        return new ApplyMappingMutationsResponse(
            totalAffected,
            totalMappingTypeChanges,
            totalNotesDecorations,
            perTableSet);
    }

    /**
     * Loads the affected mapping rows from the database (already filtered by
     * target architecture) and applies the in-place mutations. The transaction
     * boundary on the public {@code applyMutations} method covers this
     * private call, so the save-flush-and-decorate cycle commits or rolls back
     * with the rest of the rule application.
     */
    private MutationCounts applyToFilteredRows(
            UUID targetArchitectureId,
            String decisionCode,
            String change,
            String pluralElementTableFilter,
            String elementRefType,
            String elementRefId) {

        List<ArchitectureElementMappingEntity> rows =
            loadCandidateMappings(targetArchitectureId, pluralElementTableFilter,
                elementRefType, elementRefId);

        long affected = 0L;
        long mappingTypeChanges = 0L;
        long notesDecorations = 0L;
        for (ArchitectureElementMappingEntity row : rows) {
            // Snapshot created_by_task -- Q14 requires it never change. The
            // private save call below does not touch the field, but we assert
            // the invariant post-mutation as defence-in-depth.
            String originalCreatedByTask = row.getCreatedByTask();

            String currentNotes = row.getNotes();
            String decoratedNotes = ArchitectureElementMappingNotesDecorator
                .decorateWithDecision(currentNotes, decisionCode);
            boolean notesChanged = !Objects.equals(currentNotes, decoratedNotes);
            row.setNotes(decoratedNotes);
            // Count as a decoration when the tag was applied THIS run. The
            // decorator is idempotent so re-running the endpoint on rows
            // already tagged returns the same string -- those rows do NOT
            // contribute to notesDecorations on the re-run (v1 chooses
            // "applied THIS run" semantics so the gateway summary reflects
            // work actually done).
            if (notesChanged) {
                notesDecorations += 1L;
            }

            boolean mappingTypeChanged = false;
            if (!CHANGE_NONE.equals(change)) {
                String newMappingType = resolveMappingTypeForChange(change);
                if (!Objects.equals(row.getMappingType(), newMappingType)) {
                    row.setMappingType(newMappingType);
                    mappingTypeChanged = true;
                }
            }
            if (mappingTypeChanged) {
                mappingTypeChanges += 1L;
            }

            // Q14: created_by_task untouched.
            if (!Objects.equals(originalCreatedByTask, row.getCreatedByTask())) {
                throw new IllegalStateException(
                    "Architecture Model Service apply-mapping-mutations attempted to overwrite "
                        + "created_by_task on mapping " + row.getId()
                        + " (this is a Q14 invariant violation)");
            }

            if (notesChanged || mappingTypeChanged) {
                mappingRepository.save(row);
                affected += 1L;
            }
        }
        return new MutationCounts(affected, mappingTypeChanges, notesDecorations);
    }

    /**
     * Loads candidate mapping rows for the given target architecture, then
     * filters in-memory by the optional element-type and element-ref
     * constraints. v1 reads the full set per target architecture and filters
     * in-process; the repository's existing
     * {@code findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId}
     * indexes by {@code (project_id, source_architecture_id,
     * target_architecture_id)} so a future optimisation could push the filter
     * down. The set is bounded by the number of mappings per target draft,
     * which is small (tens to low hundreds) in typical use.
     *
     * <p>Filter shape:</p>
     * <ul>
     *   <li>{@code pluralElementTableFilter} non-null: only rows with
     *       {@code source_element_type = <plural>} OR
     *       {@code target_element_type = <plural>}. Mapping rows are
     *       symmetric -- a single row connects a source element to a target
     *       element; we want both sides considered so a service-typed
     *       decision can flow through both directions.</li>
     *   <li>{@code elementRefType + elementRefId} both non-null: further
     *       narrow to rows matching the source-side ref (architecture
     *       exception is anchored to the source-side element).</li>
     * </ul>
     */
    private List<ArchitectureElementMappingEntity> loadCandidateMappings(
            UUID targetArchitectureId,
            String pluralElementTableFilter,
            String elementRefType,
            String elementRefId) {

        // Pull every mapping bound to the target architecture. The repository
        // does not expose a project-agnostic find-by-target-arch, so we use
        // findAll() + a filter; the result set is bounded by the number of
        // mappings per target draft.
        List<ArchitectureElementMappingEntity> allForTarget = mappingRepository
            .findAll()
            .stream()
            .filter(m -> targetArchitectureId.equals(m.getTargetArchitectureId()))
            .toList();

        if (pluralElementTableFilter == null && elementRefType == null) {
            return allForTarget;
        }

        List<ArchitectureElementMappingEntity> filtered = new ArrayList<>(allForTarget.size());
        String pluralElementRefTable = elementRefType == null
            ? null
            : toPluralTable(elementRefType);
        for (ArchitectureElementMappingEntity m : allForTarget) {
            boolean tableMatches = pluralElementTableFilter == null
                || pluralElementTableFilter.equals(m.getSourceElementType())
                || pluralElementTableFilter.equals(m.getTargetElementType());
            if (!tableMatches) continue;

            if (pluralElementRefTable != null) {
                boolean refMatches =
                    pluralElementRefTable.equals(m.getSourceElementType())
                        && Objects.equals(elementRefId, m.getSourceElementId());
                if (!refMatches) continue;
            }

            filtered.add(m);
        }
        return filtered;
    }

    private static String resolveMappingTypeForChange(String change) {
        // keep-equivalent is the explicit "set to equivalent" semantics.
        // The other change kinds line up 1:1 with mapping_type values.
        if (CHANGE_KEEP_EQUIVALENT.equals(change)) {
            return "equivalent";
        }
        return change;
    }

    private void validateRequest(ApplyMappingMutationsRequest request) {
        String change = request.defaultMappingTypeChange();
        if (change == null || change.isBlank()) {
            throw new IllegalArgumentException(
                "defaultMappingTypeChange is required (one of " + ALLOWED_CHANGE_KINDS + ")");
        }
        if (!ALLOWED_CHANGE_KINDS.contains(change)) {
            throw new IllegalArgumentException(
                "defaultMappingTypeChange '" + change + "' is not in the allowed set "
                    + ALLOWED_CHANGE_KINDS);
        }
        String elementRefType = request.elementRefType();
        String elementRefId = request.elementRefId();
        if ((elementRefType == null) != (elementRefId == null)) {
            throw new IllegalArgumentException(
                "elementRefType and elementRefId must both be present or both absent");
        }
        if (elementRefType != null && !SINGULAR_TO_PLURAL.containsKey(elementRefType)) {
            throw new IllegalArgumentException(
                "elementRefType '" + elementRefType + "' is not in the allowed scope set "
                    + SINGULAR_TO_PLURAL.keySet());
        }
        if (request.affectedTableSets() != null) {
            for (String t : request.affectedTableSets()) {
                if (!SINGULAR_TO_PLURAL.containsKey(t)) {
                    throw new IllegalArgumentException(
                        "affectedTableSets entry '" + t + "' is not a known element-type singular "
                            + "(known: " + SINGULAR_TO_PLURAL.keySet() + ")");
                }
            }
        }
    }

    private static String toPluralTable(String singularOrPlural) {
        String plural = SINGULAR_TO_PLURAL.get(singularOrPlural);
        if (plural == null) {
            throw new IllegalArgumentException(
                "Unknown element-type singular '" + singularOrPlural
                    + "' (allowed: " + SINGULAR_TO_PLURAL.keySet() + ")");
        }
        return plural;
    }

    /** Internal counter record for accumulating per-call mutation statistics. */
    private record MutationCounts(long affected, long mappingTypeChanges, long notesDecorations) {}
}
