package com.example.architecturemodel.exception;

/**
 * Thrown when a clone operation targets an archived source architecture.
 *
 * The UI already filters archived rows out of the Manage Architectures
 * modal (the only entry point to the clone workflow per spec #6 decision
 * #1), so this exception is a defence-in-depth check at the backend in
 * case a stale frontend or race condition still issues the request.
 *
 * Mapped by {@link GlobalExceptionHandler} to HTTP 422 Unprocessable
 * Entity with an envelope including {@code code: "archived_source"} so
 * the frontend can surface a footer banner in the Clone modal.
 *
 * Spec: Multi-Architecture Full Clone (Spec #6)
 */
public class ArchivedArchitectureSourceException extends RuntimeException {

    public static final String DEFAULT_MESSAGE =
        "Archived architectures cannot be cloned.";

    public ArchivedArchitectureSourceException() {
        super(DEFAULT_MESSAGE);
    }

    public ArchivedArchitectureSourceException(String message) {
        super(message);
    }
}
