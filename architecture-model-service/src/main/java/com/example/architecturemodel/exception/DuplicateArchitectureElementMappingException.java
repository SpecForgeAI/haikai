package com.example.architecturemodel.exception;

/**
 * Thrown when a request to create an architecture-element mapping would
 * collide with an existing row on the unique constraint
 * {@code (project_id, source_arch, target_arch, source_type, source_id,
 * target_type, target_id, mapping_type)}.
 *
 * <p>Mapped by {@link GlobalExceptionHandler} to HTTP 422 Unprocessable
 * Entity with envelope including {@code code: "duplicate_mapping"} so the
 * Mapping Review modal can branch on the structured error code.</p>
 *
 * <p>Spec: Create Target Baseline from Current State (2026-05-15)</p>
 */
public class DuplicateArchitectureElementMappingException extends RuntimeException {

    public static final String DEFAULT_MESSAGE =
        "An architecture-element mapping with these source/target identifiers already exists";

    public DuplicateArchitectureElementMappingException() {
        super(DEFAULT_MESSAGE);
    }

    public DuplicateArchitectureElementMappingException(String message) {
        super(message);
    }
}
