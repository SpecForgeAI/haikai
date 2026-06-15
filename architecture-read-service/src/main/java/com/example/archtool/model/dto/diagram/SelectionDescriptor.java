package com.example.archtool.model.dto.diagram;

import java.util.List;

/**
 * Describes a selection in the Advanced Add tree.
 * Sent from the frontend to specify what should be expanded.
 *
 * @param relationshipType The type of relationship to traverse (e.g., "app_components")
 * @param direction Direction of traversal ("CHILD", "PARENT", or "ASSOCIATION")
 * @param depth Depth of traversal (1 = immediate children only)
 * @param selectedEntityIds Optional list of specific entity IDs that were selected
 */
public record SelectionDescriptor(
    String relationshipType,
    String direction,
    int depth,
    List<String> selectedEntityIds
) {
    /**
     * Creates a SelectionDescriptor with default values.
     *
     * @param relationshipType The type of relationship
     * @param direction The direction of traversal
     * @return A new SelectionDescriptor with depth=1 and no specific entity IDs
     */
    public static SelectionDescriptor of(String relationshipType, String direction) {
        return new SelectionDescriptor(relationshipType, direction, 1, null);
    }

    /**
     * Creates a SelectionDescriptor with specific entity IDs.
     *
     * @param relationshipType The type of relationship
     * @param direction The direction of traversal
     * @param selectedEntityIds The specific entity IDs to include
     * @return A new SelectionDescriptor
     */
    public static SelectionDescriptor of(String relationshipType, String direction, List<String> selectedEntityIds) {
        return new SelectionDescriptor(relationshipType, direction, 1, selectedEntityIds);
    }
}
