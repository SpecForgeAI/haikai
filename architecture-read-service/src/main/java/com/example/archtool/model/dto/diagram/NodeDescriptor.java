package com.example.archtool.model.dto.diagram;

/**
 * Describes a node to be added to the diagram.
 *
 * <p>This DTO represents an entity that should be added to the diagram as a node.
 * It includes information about the entity type, identity, and whether it already
 * exists on the target diagram.</p>
 *
 * @param entityType Entity type (e.g., "APPLICATION", "APP_COMPONENT")
 * @param entityId Entity ID in the meta-model
 * @param entityName Entity name for display
 * @param alreadyOnDiagram Whether this entity already has a node on the diagram
 * @param parentEntityId Parent entity ID for containment relationships (optional)
 */
public record NodeDescriptor(
    String entityType,
    String entityId,
    String entityName,
    boolean alreadyOnDiagram,
    String parentEntityId
) {
    /**
     * Creates a NodeDescriptor for a new entity (not already on diagram).
     *
     * @param entityType The entity type
     * @param entityId The entity ID
     * @param entityName The entity name
     * @return A new NodeDescriptor with alreadyOnDiagram=false
     */
    public static NodeDescriptor newNode(String entityType, String entityId, String entityName) {
        return new NodeDescriptor(entityType, entityId, entityName, false, null);
    }

    /**
     * Creates a NodeDescriptor for a new entity with a parent.
     *
     * @param entityType The entity type
     * @param entityId The entity ID
     * @param entityName The entity name
     * @param parentEntityId The parent entity ID
     * @return A new NodeDescriptor with parent reference
     */
    public static NodeDescriptor newChildNode(String entityType, String entityId, String entityName, String parentEntityId) {
        return new NodeDescriptor(entityType, entityId, entityName, false, parentEntityId);
    }

    /**
     * Creates a NodeDescriptor for an entity already on the diagram.
     *
     * @param entityType The entity type
     * @param entityId The entity ID
     * @param entityName The entity name
     * @return A new NodeDescriptor with alreadyOnDiagram=true
     */
    public static NodeDescriptor existingNode(String entityType, String entityId, String entityName) {
        return new NodeDescriptor(entityType, entityId, entityName, true, null);
    }
}
