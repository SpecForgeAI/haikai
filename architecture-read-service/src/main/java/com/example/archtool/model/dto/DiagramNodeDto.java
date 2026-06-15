package com.example.archtool.model.dto;

/**
 * Represents a node (vertex) in a diagram graph.
 *
 * <p>Nodes are visual elements in draw.io that have a position, size, and style.
 * They may be grouped under a parent node for hierarchical organization.</p>
 *
 * @param id       the unique identifier of the node within the diagram
 * @param label    the text label displayed on the node (may contain HTML entities)
 * @param geometry the position and dimensions of the node (nullable if not specified)
 * @param style    the visual styling of the node (colors, shape, etc.)
 * @param parentId the ID of the parent node for grouped elements (null if top-level)
 */
public record DiagramNodeDto(
    String id,
    String label,
    DiagramGeometryDto geometry,
    DiagramStyleDto style,
    String parentId
) {
}
