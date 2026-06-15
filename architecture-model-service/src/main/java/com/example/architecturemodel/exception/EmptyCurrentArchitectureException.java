package com.example.architecturemodel.exception;

/**
 * Thrown by {@code SuggestFromCurrentService} when the current architecture
 * supplied to the deterministic Suggest-from-current endpoint has zero
 * in-scope elements across every meta-model domain.
 *
 * <p>Mapped to HTTP 422 by
 * {@link GlobalExceptionHandler#handleEmptyCurrentArchitectureException} with
 * envelope including {@code code: "empty_current_architecture"} so the
 * Target State sub-tab can render the message inline.</p>
 *
 * <p>Spec: Target State Sub-tab + Deterministic Suggest (2026-05-24).</p>
 */
public class EmptyCurrentArchitectureException extends RuntimeException {
    public EmptyCurrentArchitectureException() {
        super("Current architecture has no elements to suggest from");
    }
}
