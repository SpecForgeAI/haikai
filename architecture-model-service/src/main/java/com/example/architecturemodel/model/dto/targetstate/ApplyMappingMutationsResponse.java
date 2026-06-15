package com.example.architecturemodel.model.dto.targetstate;

import com.example.architecturemodel.jackson.CamelCaseWire;

import java.util.List;

/**
 * Response body for
 * {@code POST /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions/{decisionId}/apply-mapping-mutations}.
 *
 * <p>Marked {@code @CamelCaseWire} because the captured-decisions data plane speaks camelCase.</p>
 *
 * <p>Summarises the work that ran inside the endpoint's single
 * {@code @Transactional} boundary so the gateway can build a
 * {@code mapping-mutation-summary} conversation turn carrying per-table-set
 * counts without re-reading the database. The aggregate counts at the top
 * level are the sum of the per-table-set entries (provided for convenience
 * so callers do not have to fold the list themselves).</p>
 *
 * <p>Field meanings:</p>
 * <ul>
 *   <li>{@code affectedMappings} -- Total number of mapping rows touched
 *       (every row in {@code tableSetSummary}'s {@code affectedMappings}
 *       summed).</li>
 *   <li>{@code mappingTypeChanges} -- Total number of rows whose
 *       {@code mapping_type} column changed value. Rows where the column was
 *       already at the requested value count here too (per the idempotent
 *       {@code keep-equivalent} semantics).</li>
 *   <li>{@code notesDecorations} -- Total number of rows whose {@code notes}
 *       gained the {@code [decision:<code>]} tag (or had it already; the
 *       decorator is idempotent so re-running the endpoint does not
 *       duplicate).</li>
 *   <li>{@code tableSetSummary} -- One entry per affected supertype table
 *       set. Empty list when the rule was notes-only (no
 *       {@code affectedTableSets}).</li>
 * </ul>
 *
 * <p>All numeric fields are boxed types ({@link Long}) so a future evolution
 * to PATCH semantics will not silently zero-overwrite (per
 * {@code project_primitive_double_dto_overwrite.md}). The same applies to the
 * per-table-set summary record.</p>
 */
@CamelCaseWire
public record ApplyMappingMutationsResponse(
    Long affectedMappings,
    Long mappingTypeChanges,
    Long notesDecorations,
    List<TableSetSummary> tableSetSummary
) {

    /**
     * Per-table-set summary entry. {@code tableSet} is the singular supertype
     * identifier the gateway sent in {@code affectedTableSets} verbatim (e.g.
     * {@code "service"}, {@code "interface"}). The numeric fields are boxed
     * for PATCH safety per the file-level note.
     */
    @CamelCaseWire
    public record TableSetSummary(
        String tableSet,
        Long affectedMappings,
        Long mappingTypeChanges,
        Long notesDecorations
    ) {}
}
