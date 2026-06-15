package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.jackson.CamelCaseWire;

import java.util.UUID;

/**
 * Response body for
 * {@code POST /api/projects/{projectId}/target-architectures/suggest-from-current}.
 *
 * <p>Marked {@code @CamelCaseWire} because the target-state UI speaks camelCase.</p>
 *
 * <p>The frontend uses {@code newDraftId} to auto-select the freshly-created
 * draft in the Drafts panel and to invalidate / refresh the AppShell model
 * cache for the new architecture. {@code resolvedName} echoes the
 * server-side auto-name (with any same-day numeric suffix) so the UI can
 * surface it inline. {@code clonedElementCount} and {@code mappingRowCount}
 * are returned for diagnostics / debug logging.</p>
 *
 * @param newDraftId         id of the freshly-created target draft
 * @param resolvedName       the auto-resolved draft name (e.g.
 *                           {@code "Target State - Suggested 2026-05-24"} or
 *                           with a {@code " (2)"} suffix on same-day repeat)
 * @param clonedElementCount count of elements cloned in Phase 2
 * @param mappingRowCount    count of {@code architecture_element_mappings}
 *                           rows written in Phase 3 (equal to
 *                           {@code clonedElementCount} on success)
 */
@CamelCaseWire
public record SuggestFromCurrentResponse(
    UUID newDraftId,
    String resolvedName,
    int clonedElementCount,
    int mappingRowCount
) {
}
