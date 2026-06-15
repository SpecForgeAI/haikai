package com.example.archtool.model.dto;

import java.util.List;

/**
 * Represents an edge (connection) between nodes in a diagram graph.
 *
 * <p>Edges connect source and target nodes and may have routing points
 * that define the path of the connection. Labels can be attached to edges
 * to describe the relationship.</p>
 *
 * @param id       the unique identifier of the edge within the diagram
 * @param sourceId the ID of the source node (may be null if source is floating)
 * @param targetId the ID of the target node (may be null if target is floating)
 * @param label    the text label displayed on the edge (may be null)
 * @param points   the list of routing points defining the edge path
 * @param style    the visual styling of the edge (colors, arrows, dashed, etc.)
 */
public record DiagramEdgeDto(
    String id,
    String sourceId,
    String targetId,
    String label,
    List<DiagramPointDto> points,
    DiagramStyleDto style
) {
}
