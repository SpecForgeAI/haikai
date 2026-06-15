package com.example.architecturemodel.exception;

/**
 * Thrown when an architecture lookup by id (optionally scoped to a project)
 * does not find a matching row. This includes the case where the architecture
 * exists but belongs to a different project than the one in the URL path
 * (treated as "not found" to avoid leaking cross-project information).
 *
 * Mapped by {@link GlobalExceptionHandler} to HTTP 404 Not Found via the
 * existing {@link ResourceNotFoundException} handler (this class extends it
 * so existing 404 mapping continues to apply without a new handler).
 *
 * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
 */
public class ArchitectureNotFoundException extends ResourceNotFoundException {

    public ArchitectureNotFoundException(String message) {
        super(message);
    }

    public ArchitectureNotFoundException(String message, Throwable cause) {
        super(message, cause);
    }
}
