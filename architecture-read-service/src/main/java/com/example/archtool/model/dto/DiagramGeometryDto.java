package com.example.archtool.model.dto;

/**
 * Represents the geometric properties of a diagram node.
 *
 * <p>All fields use {@code Double} wrapper types to support nullable values,
 * which is common when geometry is only partially specified in draw.io files.</p>
 *
 * @param x      the x-coordinate of the node's position (nullable)
 * @param y      the y-coordinate of the node's position (nullable)
 * @param width  the width of the node (nullable)
 * @param height the height of the node (nullable)
 */
public record DiagramGeometryDto(
    Double x,
    Double y,
    Double width,
    Double height
) {
}
