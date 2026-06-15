package com.example.architecturemodel.exception;

/**
 * Thrown when a create or update operation attempts to set an architecture
 * name that already exists (case-insensitive) within the same project.
 *
 * Mapped by {@link GlobalExceptionHandler} to HTTP 409 Conflict with an
 * envelope including {@code code: "duplicate_name"} and {@code field: "name"}
 * so the frontend can render the error inline next to the Name field.
 *
 * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
 */
public class DuplicateArchitectureNameException extends RuntimeException {

    private final String name;

    public DuplicateArchitectureNameException(String name) {
        super("An architecture named '" + name + "' already exists in this project.");
        this.name = name;
    }

    public String getName() {
        return name;
    }
}
