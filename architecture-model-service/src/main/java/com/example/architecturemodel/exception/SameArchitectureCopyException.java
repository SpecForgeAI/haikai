package com.example.architecturemodel.exception;

/**
 * Thrown when a selective-copy request specifies the same architecture as
 * both source and target.
 *
 * <p>The UI already disables the per-row {@code Copy from...} button on the
 * row that matches {@code activeArchitectureId} (see spec #7 decision #1),
 * so this exception is a defence-in-depth check at the backend in case a
 * stale frontend or a direct API caller still issues such a request.</p>
 *
 * <p>Mapped by {@link GlobalExceptionHandler} to HTTP 422 Unprocessable
 * Entity with an envelope including {@code code: "same_architecture"} so
 * the wizard's footer banner can render the specific message.</p>
 *
 * <p>Spec: Multi-Architecture Selective Cross-Architecture Copy (Spec #7)</p>
 */
public class SameArchitectureCopyException extends RuntimeException {

    public static final String DEFAULT_MESSAGE =
        "Cannot selectively copy into the same architecture";

    public SameArchitectureCopyException() {
        super(DEFAULT_MESSAGE);
    }

    public SameArchitectureCopyException(String message) {
        super(message);
    }
}
