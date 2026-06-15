package com.example.architecturemodel.exception;

/**
 * Thrown by validation logic in service-layer code (e.g. ModelService) when an
 * entity or relationship fails a domain rule. The {entityType, code, field}
 * triple lets the frontend route the error inline (pre-save validation panel)
 * instead of as a generic toast.
 *
 * Spec: Step 4 of the save-validation improvement series (2026-05-08).
 *
 * Handled by {@link GlobalExceptionHandler#handleValidationException} which
 * maps it to HTTP 400 with a structured JSON envelope containing the
 * snake_case fields {@code entity_type}, {@code code}, {@code field},
 * {@code entity_id}, {@code entity_name}, {@code message}.
 */
public class ValidationException extends RuntimeException {
    private final String entityType;
    private final String code;
    private final String field;
    private final String entityId;
    private final String entityName;

    public ValidationException(String entityType, String code, String field,
                               String entityId, String entityName, String message) {
        super(message);
        this.entityType = entityType;
        this.code = code;
        this.field = field;
        this.entityId = entityId;
        this.entityName = entityName;
    }

    public String getEntityType() { return entityType; }
    public String getCode() { return code; }
    public String getField() { return field; }
    public String getEntityId() { return entityId; }
    public String getEntityName() { return entityName; }
}
