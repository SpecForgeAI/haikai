package com.example.architecturemodel.service;

import java.util.*;

/**
 * Utility class providing default typed content structures for typed diagrams.
 *
 * This class defines the default content that should be auto-populated when
 * creating diagrams of specific types (Sequence, ER, Activity, State, UI_SCREEN).
 * General diagrams have no typed content (returns null).
 *
 * Envelope structure for all typed diagrams:
 * {
 *   "type": "Sequence" | "ER" | "Activity" | "State" | "UI_SCREEN",
 *   "version": 1,
 *   "content": { ...type-specific content... }
 * }
 */
public final class TypedContentDefaults {

    /**
     * Current schema version for typed content.
     * All typed content envelopes use this version.
     */
    public static final int CURRENT_VERSION = 1;

    /**
     * Diagram types that require typed content.
     */
    public static final Set<String> TYPED_DIAGRAM_TYPES = Set.of(
        "Sequence", "ER", "Activity", "State", "UI_SCREEN"
    );

    // Private constructor to prevent instantiation
    private TypedContentDefaults() {
        throw new UnsupportedOperationException("Utility class cannot be instantiated");
    }

    /**
     * Returns the default typed content for a diagram type.
     *
     * @param diagramType The diagram type (Sequence, ER, Activity, State, UI_SCREEN, General, or null)
     * @return Map representing the typed content envelope, or null for General/null types
     */
    public static Map<String, Object> getDefaultTypedContent(String diagramType) {
        if (diagramType == null || diagramType.isEmpty() || "General".equals(diagramType)) {
            return null;
        }

        return switch (diagramType) {
            case "Sequence" -> createSequenceDefaultContent();
            case "ER" -> createERDefaultContent();
            case "Activity" -> createActivityDefaultContent();
            case "State" -> createStateDefaultContent();
            case "UI_SCREEN" -> createUIScreenDefaultContent();
            default -> null;  // Unknown types get null typed content
        };
    }

    /**
     * Checks if a diagram type requires typed content.
     *
     * @param diagramType The diagram type to check
     * @return true if the diagram type requires typed content, false otherwise
     */
    public static boolean requiresTypedContent(String diagramType) {
        return diagramType != null && TYPED_DIAGRAM_TYPES.contains(diagramType);
    }

    /**
     * Creates the default typed content envelope for Sequence diagrams.
     *
     * Content structure:
     * {
     *   "participants": [],
     *   "messages": [],
     *   "fragments": [],
     *   "operands": [],
     *   "sequenceNodes": []
     * }
     */
    private static Map<String, Object> createSequenceDefaultContent() {
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("participants", new ArrayList<>());
        content.put("messages", new ArrayList<>());
        content.put("fragments", new ArrayList<>());
        content.put("operands", new ArrayList<>());
        content.put("sequenceNodes", new ArrayList<>());

        return createEnvelope("Sequence", content);
    }

    /**
     * Creates the default typed content envelope for ER diagrams.
     *
     * Content structure:
     * {
     *   "entityRefs": [],
     *   "relationshipRefs": []
     * }
     */
    private static Map<String, Object> createERDefaultContent() {
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("entityRefs", new ArrayList<>());
        content.put("relationshipRefs", new ArrayList<>());

        return createEnvelope("ER", content);
    }

    /**
     * Creates the default typed content envelope for Activity diagrams.
     *
     * Content structure:
     * {
     *   "partitions": [],
     *   "flows": []
     * }
     */
    private static Map<String, Object> createActivityDefaultContent() {
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("partitions", new ArrayList<>());
        content.put("flows", new ArrayList<>());

        return createEnvelope("Activity", content);
    }

    /**
     * Creates the default typed content envelope for State diagrams.
     *
     * Content structure:
     * {
     *   "states": [],
     *   "transitions": []
     * }
     */
    private static Map<String, Object> createStateDefaultContent() {
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("states", new ArrayList<>());
        content.put("transitions", new ArrayList<>());

        return createEnvelope("State", content);
    }

    /**
     * Creates the default typed content envelope for UI_SCREEN diagrams.
     *
     * Content structure:
     * {
     *   "screen_id": null,
     *   "components": [],
     *   "actions": []
     * }
     */
    private static Map<String, Object> createUIScreenDefaultContent() {
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("screen_id", null);
        content.put("components", new ArrayList<>());
        content.put("actions", new ArrayList<>());

        return createEnvelope("UI_SCREEN", content);
    }

    /**
     * Creates the typed content envelope with the given type and content.
     *
     * @param type The diagram type
     * @param content The type-specific content
     * @return The complete envelope structure
     */
    private static Map<String, Object> createEnvelope(String type, Map<String, Object> content) {
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("type", type);
        envelope.put("version", CURRENT_VERSION);
        envelope.put("content", content);
        return envelope;
    }
}
