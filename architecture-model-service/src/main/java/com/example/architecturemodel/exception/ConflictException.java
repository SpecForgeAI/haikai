package com.example.architecturemodel.exception;

/**
 * Exception thrown when a conflict is detected during an operation.
 *
 * This exception is mapped to HTTP 409 Conflict status code.
 *
 * Typical use cases:
 * - Duplicate project names during import
 * - ID collisions for work items or artifacts
 * - Unique constraint violations
 *
 * Spec 2026-01-06: Project Snapshot JSON Import
 */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }

    public ConflictException(String message, Throwable cause) {
        super(message, cause);
    }
}
