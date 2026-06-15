package com.example.architecturemodel.exception;

/**
 * Thrown when a caller attempts to create a {@code discovery_finding_links}
 * row pointing at a target that either does not exist OR lives outside the
 * parent finding's run / architecture (D6 hard-reject).
 *
 * <p>Mapped by {@code GlobalExceptionHandler} to HTTP 400 with a structured
 * envelope including {@code code: "invalid_link_target"} so frontend error
 * toasts can branch on the code.</p>
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 2.</p>
 */
public class InvalidFindingLinkTargetException extends RuntimeException {

    private final String targetType;
    private final String targetId;

    public InvalidFindingLinkTargetException(String targetType, String targetId, String reason) {
        super("Invalid link target (" + targetType + ":" + targetId + "): " + reason);
        this.targetType = targetType;
        this.targetId = targetId;
    }

    public String getTargetType() {
        return targetType;
    }

    public String getTargetId() {
        return targetId;
    }
}
