package com.example.archtool.model.dto;

/**
 * Represents style information for diagram nodes and edges.
 *
 * <p>Draw.io stores style as a semicolon-delimited string of key=value pairs.
 * This DTO extracts known properties while preserving the raw style string
 * for any unrecognized properties.</p>
 *
 * @param rawStyle   the original style string from draw.io (always preserved)
 * @param fillColor  the fill/background color (e.g., "#aaffaa")
 * @param strokeColor the border/stroke color (e.g., "#000000")
 * @param fontColor  the text/font color (e.g., "#333333")
 * @param shape      the shape type (e.g., "rectangle", "ellipse", "rhombus")
 * @param rounded    whether corners are rounded (true/false)
 * @param dashed     whether the stroke is dashed (true/false)
 * @param startArrow the arrow type at the start of an edge (e.g., "none", "classic")
 * @param endArrow   the arrow type at the end of an edge (e.g., "classic", "block")
 * @param fontSize   the font size in points
 * @param fontFamily the font family name (e.g., "Arial", "Helvetica")
 */
public record DiagramStyleDto(
    String rawStyle,
    String fillColor,
    String strokeColor,
    String fontColor,
    String shape,
    Boolean rounded,
    Boolean dashed,
    String startArrow,
    String endArrow,
    Integer fontSize,
    String fontFamily
) {
}
