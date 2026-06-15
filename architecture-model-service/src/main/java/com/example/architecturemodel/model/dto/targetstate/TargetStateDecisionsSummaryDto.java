package com.example.architecturemodel.model.dto.targetstate;

import com.example.architecturemodel.jackson.CamelCaseWire;

import java.time.Instant;
import java.util.List;

/**
 * Aggregation-side summary block for captured target-state decisions, returned
 * as a new top-level field {@code targetStateDecisionsSummary} on
 * {@code MigrationDiscoveryContextDto}.
 *
 * <p>Marked {@code @CamelCaseWire} because the captured-decisions data plane speaks camelCase.</p>
 *
 * <p>Partitions the latest-non-superseded decisions for the project's active
 * target architecture into two lists:</p>
 * <ul>
 *   <li>{@link #architectureWideDecisions} -- decisions where
 *       {@code scopeKind = 'architecture'}; these set defaults for the whole
 *       target.</li>
 *   <li>{@link #scopedOverrides} -- decisions where {@code scopeKind} is
 *       {@code service}, {@code interface}, or {@code element}; these refine
 *       the architecture-wide defaults for specific entities.</li>
 * </ul>
 *
 * <p><b>Empty default shape:</b> {@link #empty()} returns
 * {@code (empty, empty, 0, null)} so consumers see a consistent shape on every
 * aggregation response -- including on projects with no decisions yet. This is
 * the contract spec.md requires: existing consumers see the new field with the
 * empty default rather than {@code null}, so client-side null-guards do not
 * need to be added.</p>
 *
 * <p>{@link #totalDecisionCount} is boxed ({@link Integer}, not {@code int})
 * per {@code project_primitive_double_dto_overwrite.md}.</p>
 */
@CamelCaseWire
public record TargetStateDecisionsSummaryDto(
    List<CapturedDecisionRefDto> architectureWideDecisions,
    List<CapturedDecisionRefDto> scopedOverrides,
    Integer totalDecisionCount,
    Instant lastDecisionAt
) {

    /**
     * Returns the canonical empty-default shape used when no decisions exist
     * for the project's active target architecture (or no active target
     * architecture is defined yet). Returning a populated empty envelope
     * rather than {@code null} keeps the aggregation response shape
     * byte-stable across projects.
     */
    public static TargetStateDecisionsSummaryDto empty() {
        return new TargetStateDecisionsSummaryDto(List.of(), List.of(), 0, null);
    }
}
