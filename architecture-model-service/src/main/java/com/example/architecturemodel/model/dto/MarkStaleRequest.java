package com.example.architecturemodel.model.dto;

import java.util.List;
import java.util.UUID;

/**
 * Request body for
 * {@code POST /api/projects/{projectId}/specs/mark-stale}.
 *
 * <p>The active-target write path or the promote handler invokes this
 * endpoint with the set of architecture element ids whose mapping changed
 * between the prior active target and the new active target (or, on save,
 * the ids written in the save). Every
 * {@code migration_story_spec_generations} row whose
 * {@code focused_context_refs_json.architecture_element_ids} (or
 * {@code mapping_refs}) intersects this set is flipped to {@code stale=true}
 * with {@code stale_marked_at=now()}.</p>
 *
 * <p>Idempotency: a second call on the same set is a no-op for already-stale
 * rows but DOES bump {@code stale_marked_at}.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 3.</p>
 *
 * @param activeTargetArchId  the active-target architecture id. The caller is
 *                            expected to validate this is in fact the project's
 *                            active target; the AMS handler treats it as an
 *                            informational anchor for debounce / logging
 *                            purposes. May be null when invoked from the
 *                            promote path before the new architecture is
 *                            transitioned (debounce stamp is updated on the
 *                            new active row only).
 * @param changedElementIds   the set of element ids whose mapping changed
 *                            (clone-current uses element ids natively as
 *                            strings; the AMS row id is the canonical form
 *                            persisted on every element table)
 */
public record MarkStaleRequest(
    UUID activeTargetArchId,
    List<String> changedElementIds
) {
}
