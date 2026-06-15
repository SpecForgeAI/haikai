package com.example.archtool.model.dto.diagram;

/**
 * Describes an edge to be added to the diagram.
 *
 * <p>This DTO represents a relationship that should be added to the diagram as an edge.
 * It includes information about the relationship type, identity, endpoints, and whether
 * it already exists on the target diagram.</p>
 *
 * @param relationshipType Relationship type (e.g., "APPLICATION_POINT_BUSINESS_PROCESS")
 * @param relationshipId Relationship ID in the meta-model
 * @param sourceEntityId Source entity ID
 * @param targetEntityId Target entity ID
 * @param alreadyOnDiagram Whether this relationship already has an edge on the diagram
 */
public record EdgeDescriptor(
    String relationshipType,
    String relationshipId,
    String sourceEntityId,
    String targetEntityId,
    boolean alreadyOnDiagram
) {
    /**
     * Creates an EdgeDescriptor for a new relationship (not already on diagram).
     *
     * @param relationshipType The relationship type
     * @param relationshipId The relationship ID
     * @param sourceEntityId The source entity ID
     * @param targetEntityId The target entity ID
     * @return A new EdgeDescriptor with alreadyOnDiagram=false
     */
    public static EdgeDescriptor newEdge(
        String relationshipType,
        String relationshipId,
        String sourceEntityId,
        String targetEntityId
    ) {
        return new EdgeDescriptor(relationshipType, relationshipId, sourceEntityId, targetEntityId, false);
    }

    /**
     * Creates an EdgeDescriptor for a relationship already on the diagram.
     *
     * @param relationshipType The relationship type
     * @param relationshipId The relationship ID
     * @param sourceEntityId The source entity ID
     * @param targetEntityId The target entity ID
     * @return A new EdgeDescriptor with alreadyOnDiagram=true
     */
    public static EdgeDescriptor existingEdge(
        String relationshipType,
        String relationshipId,
        String sourceEntityId,
        String targetEntityId
    ) {
        return new EdgeDescriptor(relationshipType, relationshipId, sourceEntityId, targetEntityId, true);
    }
}
