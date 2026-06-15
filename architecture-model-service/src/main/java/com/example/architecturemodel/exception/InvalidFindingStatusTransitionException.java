package com.example.architecturemodel.exception;

/**
 * Thrown when a caller attempts to move a {@code discovery_findings} row
 * through an illegal status transition (e.g. {@code resolved -> new}).
 *
 * <p>Mapped by {@code GlobalExceptionHandler} to HTTP 422 with a structured
 * envelope including {@code code: "invalid_status_transition"} so frontend
 * error toasts can branch on the code.</p>
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 2.</p>
 */
public class InvalidFindingStatusTransitionException extends RuntimeException {

    private final String fromStatus;
    private final String toStatus;

    public InvalidFindingStatusTransitionException(String fromStatus, String toStatus) {
        super("Illegal status transition for discovery finding: '" + fromStatus
            + "' -> '" + toStatus + "'");
        this.fromStatus = fromStatus;
        this.toStatus = toStatus;
    }

    public String getFromStatus() {
        return fromStatus;
    }

    public String getToStatus() {
        return toStatus;
    }
}
