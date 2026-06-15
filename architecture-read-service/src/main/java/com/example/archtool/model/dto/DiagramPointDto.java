package com.example.archtool.model.dto;

/**
 * Represents a point in a diagram, typically used for edge routing points.
 *
 * <p>Uses primitive {@code double} types since edge points should always
 * have defined coordinates.</p>
 *
 * @param x the x-coordinate of the point
 * @param y the y-coordinate of the point
 */
public record DiagramPointDto(
    double x,
    double y
) {
}
