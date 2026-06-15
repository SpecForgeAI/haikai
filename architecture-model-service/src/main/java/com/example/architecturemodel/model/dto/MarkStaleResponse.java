package com.example.architecturemodel.model.dto;

/**
 * Response body for
 * {@code POST /api/projects/{projectId}/specs/mark-stale} and the embedded
 * stale-mark step of the promote handler.
 *
 * <p>Reports whether the call was actually executed (it may have been
 * skipped by the AMS-side debounce on the active-target save path), and the
 * count of spec-generation rows flipped to {@code stale=true} by the run.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 3.</p>
 *
 * @param markedCount    number of {@code migration_story_spec_generations}
 *                       rows that were flipped to {@code stale=true} (or had
 *                       their {@code stale_marked_at} bumped, for the
 *                       idempotent already-stale case)
 * @param debounceSkipped true when the AMS-side debounce window (default 5s)
 *                       was hit on the active-target save path and the
 *                       stale-mark was intentionally skipped. False for the
 *                       promote path (which always fires) and for the
 *                       initial mark on an active target. When true,
 *                       {@code markedCount} is always 0.
 */
public record MarkStaleResponse(
    int markedCount,
    boolean debounceSkipped
) {
}
