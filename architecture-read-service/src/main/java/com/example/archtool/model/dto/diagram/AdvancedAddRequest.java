package com.example.archtool.model.dto.diagram;

import java.util.List;

/**
 * Request body for the advanced-add-expansion API endpoint.
 *
 * <p>This DTO encapsulates the parameters needed to compute what nodes and edges
 * should be added to a diagram when the user invokes the Advanced Add feature.</p>
 *
 * @param rootEntityType Type of the root entity (e.g., "APPLICATION", "BUSINESS_PROCESS")
 * @param rootEntityId ID of the root entity in the meta-model
 * @param diagramId ID of the target diagram
 * @param selections List of selected relationship paths to expand
 */
public record AdvancedAddRequest(
    String rootEntityType,
    String rootEntityId,
    String diagramId,
    List<SelectionDescriptor> selections
) {
    /**
     * Validates the request parameters.
     *
     * @throws IllegalArgumentException if any required field is null or empty
     */
    public void validate() {
        if (rootEntityType == null || rootEntityType.isBlank()) {
            throw new IllegalArgumentException("rootEntityType is required");
        }
        if (rootEntityId == null || rootEntityId.isBlank()) {
            throw new IllegalArgumentException("rootEntityId is required");
        }
        if (diagramId == null || diagramId.isBlank()) {
            throw new IllegalArgumentException("diagramId is required");
        }
        if (selections == null) {
            throw new IllegalArgumentException("selections is required");
        }
    }

    /**
     * Creates an AdvancedAddRequest for simple testing.
     *
     * @param rootEntityType The root entity type
     * @param rootEntityId The root entity ID
     * @param diagramId The diagram ID
     * @return A new AdvancedAddRequest with empty selections
     */
    public static AdvancedAddRequest of(String rootEntityType, String rootEntityId, String diagramId) {
        return new AdvancedAddRequest(rootEntityType, rootEntityId, diagramId, List.of());
    }
}
