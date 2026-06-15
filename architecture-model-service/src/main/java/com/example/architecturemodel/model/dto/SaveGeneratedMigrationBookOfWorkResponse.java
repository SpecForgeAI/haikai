package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/**
 * Response body for
 * {@code POST /api/projects/{projectId}/migration-books-of-work/{bookId}/save-to-backlog}.
 *
 * <p>Returns the post-save view so the frontend can render created/saved/skipped
 * counts and per-item {@code saveState} + {@code workItemId} without re-fetching
 * the draft. Mirrors the contract documented in spec.md AMS section.</p>
 *
 * <p>{@code bookOfWorkJson} carries the updated draft hierarchy with per-item
 * {@code saveState} (either {@code 'saved'} or {@code 'failed'} on items that
 * were admitted by the filter; pre-existing {@code 'saved'} on items skipped
 * via idempotency) and the resolved {@code workItemId}. The frontend uses this
 * payload to render the success/failure ribbons in the review workspace.</p>
 *
 * <p>{@code counts} totals admitted/saved/skipped/failed per type plus an
 * {@code overall} bucket so the frontend can show a high-level summary card.</p>
 *
 * <p>Spec: Product Manager Migration Delivery Plan + Draft Book-of-Work
 * Generation (2026-05-17) -- Task Group 8.</p>
 *
 * @param draftId the updated draft id
 * @param draftStatus the new draft-level status ({@code saved}, {@code partially_saved}, or unchanged)
 * @param counts created/saved/skipped/failed counts per type and overall
 * @param bookOfWorkJson the updated book-of-work blob with per-item {@code saveState} + {@code workItemId}
 * @param failedItems a flat array of {@code {itemId, errorMessage}} maps for failed saves
 */
public record SaveGeneratedMigrationBookOfWorkResponse(
    @JsonProperty("draft_id")
    String draftId,

    @JsonProperty("draft_status")
    String draftStatus,

    @JsonProperty("counts")
    Map<String, Object> counts,

    @JsonProperty("book_of_work_json")
    Map<String, Object> bookOfWorkJson,

    @JsonProperty("failed_items")
    List<Map<String, Object>> failedItems
) {}
