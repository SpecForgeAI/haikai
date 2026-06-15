package com.example.architecturemodel.model.dto.migration;

import java.util.UUID;

/**
 * Per-epic count summary returned by the bulk
 * {@code GET .../captured-decisions/summary} endpoint.
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Follow-up #3 (replaces the dashboard's O(N) per-epic GETs).</p>
 *
 * <p>Counts are boxed types so the wire shape stays stable even if a future
 * status is added with a zero-count default.</p>
 */
public record EpicCapturedDecisionsCountByEpicDto(
    UUID epicWorkItemId,
    Integer draftCount,
    Integer confirmedCount,
    Integer supersededCount
) {}
