package com.example.architecturemodel.exception;

/**
 * Thrown by {@code SuggestFromCurrentService} when a draft with the resolved
 * auto-generated name already exists and was created within the last 5 seconds
 * (server-side double-click guard complementing the frontend pending-disable).
 *
 * <p>Mapped to HTTP 409 by
 * {@link GlobalExceptionHandler#handleRecentDuplicateSuggestException} with
 * envelope including {@code code: "recent_duplicate_suggest"} so the Target
 * State sub-tab can surface a "draft already created in the last few seconds"
 * message via the existing error banner.</p>
 *
 * <p>Spec: Target State Sub-tab + Deterministic Suggest (2026-05-24).</p>
 */
public class RecentDuplicateSuggestException extends RuntimeException {
    public RecentDuplicateSuggestException(String draftName) {
        super("A target draft with the auto-generated name '" + draftName
            + "' was just created. Please wait a moment before trying again.");
    }
}
