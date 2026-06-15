package com.example.architecturemodel.service;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Validator for typed content on diagram save operations.
 *
 * Performs light validation of the typedContent envelope structure:
 * - Validates typedContent.type matches diagram.diagram_type
 * - Validates typedContent.version is present and equals 1
 * - For Sequence diagrams: validates content has required array fields
 *
 * Deep validation of individual items in arrays is NOT performed
 * (out of scope per spec).
 */
public final class TypedContentValidator {

    /**
     * Required fields in Sequence diagram content.
     */
    private static final Set<String> SEQUENCE_REQUIRED_FIELDS = Set.of(
        "participants", "messages", "fragments", "operands", "sequenceNodes"
    );

    /**
     * Required fields in ER diagram content.
     */
    private static final Set<String> ER_REQUIRED_FIELDS = Set.of(
        "entityRefs", "relationshipRefs"
    );

    /**
     * Required fields in Activity diagram content.
     */
    private static final Set<String> ACTIVITY_REQUIRED_FIELDS = Set.of(
        "partitions", "flows"
    );

    /**
     * Required fields in State diagram content.
     */
    private static final Set<String> STATE_REQUIRED_FIELDS = Set.of(
        "states", "transitions"
    );

    // Private constructor to prevent instantiation
    private TypedContentValidator() {
        throw new UnsupportedOperationException("Utility class cannot be instantiated");
    }

    /**
     * Validates typed content for a diagram save operation.
     *
     * @param typedContent The typedContent from the diagram DTO (may be null)
     * @param diagramType The diagram type (e.g., "Sequence", "ER", "General")
     * @throws IllegalArgumentException if validation fails
     */
    public static void validate(Map<String, Object> typedContent, String diagramType) {
        // General diagrams should not have typed content
        if ("General".equals(diagramType) || diagramType == null || diagramType.isEmpty()) {
            // For General diagrams, typedContent should ideally be null
            // but we don't enforce this on save - we just ignore it
            return;
        }

        // Typed diagrams require typedContent
        if (!TypedContentDefaults.requiresTypedContent(diagramType)) {
            // Unknown diagram type - no validation required
            return;
        }

        // If typedContent is null for a typed diagram, validation passes
        // (it will be auto-populated with defaults during save)
        if (typedContent == null) {
            return;
        }

        // Validate envelope structure
        validateEnvelopeType(typedContent, diagramType);
        validateEnvelopeVersion(typedContent);
        validateContent(typedContent, diagramType);
    }

    /**
     * Validates that typedContent.type matches the diagram type.
     *
     * @param typedContent The typedContent envelope
     * @param diagramType The expected diagram type
     * @throws IllegalArgumentException if types don't match
     */
    private static void validateEnvelopeType(Map<String, Object> typedContent, String diagramType) {
        Object typeValue = typedContent.get("type");

        if (typeValue == null) {
            throw new IllegalArgumentException(
                "typedContent.type is required but was null"
            );
        }

        if (!(typeValue instanceof String)) {
            throw new IllegalArgumentException(
                "typedContent.type must be a String, but was: " + typeValue.getClass().getSimpleName()
            );
        }

        String contentType = (String) typeValue;
        if (!contentType.equals(diagramType)) {
            throw new IllegalArgumentException(
                "typedContent.type mismatch: expected '" + diagramType +
                "' but was '" + contentType + "'. " +
                "typedContent.type must match diagram.diagram_type"
            );
        }
    }

    /**
     * Validates that typedContent.version is present and equals 1.
     *
     * @param typedContent The typedContent envelope
     * @throws IllegalArgumentException if version is invalid
     */
    private static void validateEnvelopeVersion(Map<String, Object> typedContent) {
        Object versionValue = typedContent.get("version");

        if (versionValue == null) {
            throw new IllegalArgumentException(
                "typedContent.version is required but was null"
            );
        }

        int version;
        if (versionValue instanceof Integer) {
            version = (Integer) versionValue;
        } else if (versionValue instanceof Number) {
            version = ((Number) versionValue).intValue();
        } else {
            throw new IllegalArgumentException(
                "typedContent.version must be a number, but was: " + versionValue.getClass().getSimpleName()
            );
        }

        if (version != TypedContentDefaults.CURRENT_VERSION) {
            throw new IllegalArgumentException(
                "typedContent.version must be " + TypedContentDefaults.CURRENT_VERSION +
                " but was " + version + ". Version " + version + " is not supported."
            );
        }
    }

    /**
     * Validates the content structure for the specific diagram type.
     *
     * Light validation only - checks that required array fields exist.
     * Does NOT deep-validate individual items in arrays.
     *
     * @param typedContent The typedContent envelope
     * @param diagramType The diagram type
     * @throws IllegalArgumentException if content structure is invalid
     */
    private static void validateContent(Map<String, Object> typedContent, String diagramType) {
        Object contentValue = typedContent.get("content");

        if (contentValue == null) {
            throw new IllegalArgumentException(
                "typedContent.content is required but was null"
            );
        }

        if (!(contentValue instanceof Map)) {
            throw new IllegalArgumentException(
                "typedContent.content must be an object, but was: " + contentValue.getClass().getSimpleName()
            );
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> content = (Map<String, Object>) contentValue;

        Set<String> requiredFields = getRequiredFields(diagramType);
        if (requiredFields != null) {
            validateRequiredArrayFields(content, requiredFields, diagramType);
        }
    }

    /**
     * Returns the required content fields for a diagram type.
     *
     * @param diagramType The diagram type
     * @return Set of required field names, or null if no specific requirements
     */
    private static Set<String> getRequiredFields(String diagramType) {
        return switch (diagramType) {
            case "Sequence" -> SEQUENCE_REQUIRED_FIELDS;
            case "ER" -> ER_REQUIRED_FIELDS;
            case "Activity" -> ACTIVITY_REQUIRED_FIELDS;
            case "State" -> STATE_REQUIRED_FIELDS;
            default -> null;
        };
    }

    /**
     * Validates that required array fields exist in the content.
     *
     * @param content The content object
     * @param requiredFields Set of required field names
     * @param diagramType The diagram type (for error messages)
     * @throws IllegalArgumentException if required fields are missing or not arrays
     */
    private static void validateRequiredArrayFields(
            Map<String, Object> content,
            Set<String> requiredFields,
            String diagramType) {

        for (String fieldName : requiredFields) {
            Object fieldValue = content.get(fieldName);

            if (fieldValue == null) {
                throw new IllegalArgumentException(
                    diagramType + " diagram content is missing required field: '" + fieldName + "'"
                );
            }

            if (!(fieldValue instanceof List)) {
                throw new IllegalArgumentException(
                    diagramType + " diagram content field '" + fieldName +
                    "' must be an array, but was: " + fieldValue.getClass().getSimpleName()
                );
            }
        }
    }
}
