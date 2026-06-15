package com.example.architecturemodel.model.dto.targetstate;

import com.example.architecturemodel.jackson.CamelCaseWire;

import java.util.List;

/**
 * Request body for
 * {@code POST /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions/{decisionId}/apply-mapping-mutations}.
 *
 * <p>Marked {@code @CamelCaseWire} because the captured-decisions data plane speaks camelCase.</p>
 *
 * <p>The gateway owns the mapping-mutation rules in
 * {@code gateway/src/config/architect-conversation/mappingMutationRules.ts}
 * and forwards the rule subset for the captured-decision's {@code decisionCode}
 * here. AMS is the executor: it does not look up rules itself, it just applies
 * what the gateway sends inside one {@code @Transactional} boundary (per Q13).</p>
 *
 * <p>Field meanings (mirror the gateway's
 * {@code MappingMutationRule} type verbatim):</p>
 * <ul>
 *   <li>{@code affectedTableSets} -- The supertype element-type identifiers
 *       whose mappings this decision affects. Empty list means notes-only
 *       decoration for every mapping under the architecture scope (the
 *       fallback for all but 4 of the 51 decision codes). Element-type values
 *       are the singular forms documented in spec.md (e.g. {@code "service"},
 *       {@code "interface"}, {@code "endpoint"}, {@code "physical_data_entity"},
 *       {@code "method"}, {@code "class"}, plus {@code "data_entity_points"}
 *       which is already plural by convention). The AMS service converts
 *       these to the plural-snake_case table names actually stored in the
 *       {@code source_element_type}/{@code target_element_type} columns on
 *       {@code architecture_element_mappings}.</li>
 *   <li>{@code defaultMappingTypeChange} -- One of {@code "none"} /
 *       {@code "keep-equivalent"} / {@code "replaced_by"} / {@code "renamed"} /
 *       {@code "merged"} / {@code "split"}. {@code "none"} = notes-only
 *       (decorate notes idempotently but do not touch {@code mapping_type}).
 *       Everything else writes the named value into {@code mapping_type}.
 *       {@code "keep-equivalent"} is idempotent (the existing value is already
 *       {@code "equivalent"} -- AMS still re-writes it so callers can rely on
 *       a single deterministic post-condition).</li>
 *   <li>{@code scopeBoundary} -- Always {@code "parent-not-leaf"} in v1 per
 *       Q15. The field is accepted but not branched on; future per-spec
 *       changes might add a {@code "leaf-only"} option.</li>
 *   <li>{@code elementRefType} / {@code elementRefId} -- Optional. When the
 *       captured decision was a per-element exception (scope_kind = element)
 *       these narrow the affected-mapping set to a single row matching
 *       {@code source_element_type = <elementRefType>}
 *       AND {@code source_element_id = <elementRefId>}. Both must be present
 *       or both null; mixed shapes return HTTP 400.</li>
 * </ul>
 *
 * <p>All fields are reference types ({@link String}, {@link List}). No
 * primitives appear -- staying consistent with
 * {@code project_primitive_double_dto_overwrite.md} so a future PATCH variant
 * cannot silently zero-overwrite.</p>
 */
@CamelCaseWire
public record ApplyMappingMutationsRequest(
    List<String> affectedTableSets,
    String defaultMappingTypeChange,
    String scopeBoundary,
    String elementRefType,
    String elementRefId
) {}
