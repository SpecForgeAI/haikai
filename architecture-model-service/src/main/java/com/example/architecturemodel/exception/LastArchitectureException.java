package com.example.architecturemodel.exception;

/**
 * Thrown when an archive operation would leave a project with zero
 * non-archived architectures. Every project must always have at least one
 * live architecture (the "Default" -- the oldest non-archived).
 *
 * Mapped by {@link GlobalExceptionHandler} to HTTP 422 Unprocessable Entity
 * with an envelope including {@code code: "last_architecture"} and the
 * localised message "A project must have at least one architecture."
 *
 * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
 */
public class LastArchitectureException extends RuntimeException {

    public static final String DEFAULT_MESSAGE =
        "A project must have at least one architecture.";

    public LastArchitectureException() {
        super(DEFAULT_MESSAGE);
    }

    public LastArchitectureException(String message) {
        super(message);
    }
}
