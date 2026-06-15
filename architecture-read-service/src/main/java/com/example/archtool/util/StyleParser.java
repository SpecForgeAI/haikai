package com.example.archtool.util;

import com.example.archtool.model.dto.DiagramStyleDto;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * Utility class for parsing draw.io style strings into structured DTOs.
 *
 * <p>Draw.io stores styles as semicolon-delimited key=value pairs, e.g.:</p>
 * <pre>
 * rounded=1;fillColor=#aaffaa;strokeColor=#000000;fontFamily=Arial;
 * </pre>
 *
 * <p>Some style keys indicate the shape type without an explicit value, e.g.:</p>
 * <pre>
 * ellipse;fillColor=#ff0000;  (shape is ellipse)
 * rhombus;fillColor=#00ff00;  (shape is rhombus)
 * </pre>
 */
public final class StyleParser {

    private StyleParser() {
        // Utility class - prevent instantiation
    }

    /**
     * Shape keywords that can appear as standalone style keys (without =value).
     */
    private static final Set<String> SHAPE_KEYWORDS = Set.of(
        "ellipse",
        "rhombus",
        "triangle",
        "parallelogram",
        "hexagon",
        "cylinder",
        "cloud",
        "actor",
        "swimlane",
        "process",
        "diamond",
        "trapezoid",
        "callout",
        "note",
        "card",
        "document",
        "tape",
        "step",
        "plus",
        "or",
        "xor",
        "cube",
        "folder",
        "umlActor"
    );

    /**
     * Parses a draw.io style string into a structured DiagramStyleDto.
     *
     * @param styleString the raw style string from draw.io (may be null or empty)
     * @return a DiagramStyleDto with extracted properties, or a DTO with only rawStyle if null/empty
     */
    public static DiagramStyleDto parseStyle(String styleString) {
        if (styleString == null || styleString.isEmpty()) {
            return new DiagramStyleDto(
                styleString,
                null, null, null, null,
                null, null, null, null,
                null, null
            );
        }

        Map<String, String> properties = parseToMap(styleString);

        String shape = extractShape(properties, styleString);
        Boolean rounded = extractBoolean(properties, "rounded");
        Boolean dashed = extractBoolean(properties, "dashed");
        Integer fontSize = extractInteger(properties, "fontSize");

        return new DiagramStyleDto(
            styleString,
            properties.get("fillColor"),
            properties.get("strokeColor"),
            properties.get("fontColor"),
            shape,
            rounded,
            dashed,
            properties.get("startArrow"),
            properties.get("endArrow"),
            fontSize,
            properties.get("fontFamily")
        );
    }

    /**
     * Parses a style string into a map of key-value pairs.
     *
     * @param styleString the style string to parse
     * @return a map of property names to values
     */
    private static Map<String, String> parseToMap(String styleString) {
        Map<String, String> properties = new HashMap<>();

        if (styleString == null || styleString.isEmpty()) {
            return properties;
        }

        // Split by semicolon
        String[] parts = styleString.split(";");
        for (String part : parts) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) {
                continue;
            }

            int equalsIndex = trimmed.indexOf('=');
            if (equalsIndex > 0) {
                // Key=value pair
                String key = trimmed.substring(0, equalsIndex).trim();
                String value = trimmed.substring(equalsIndex + 1).trim();
                properties.put(key, value);
            } else {
                // Standalone key (often indicates shape)
                // Store as key with empty value to track it
                properties.put(trimmed, "");
            }
        }

        return properties;
    }

    /**
     * Extracts the shape from parsed properties.
     *
     * <p>First checks for an explicit "shape" property, then looks for
     * shape keywords in the style string.</p>
     *
     * @param properties  the parsed properties map
     * @param styleString the original style string
     * @return the shape type, or "rectangle" as default for vertices
     */
    private static String extractShape(Map<String, String> properties, String styleString) {
        // Check for explicit shape property
        String explicitShape = properties.get("shape");
        if (explicitShape != null && !explicitShape.isEmpty()) {
            return explicitShape;
        }

        // Check for shape keywords in style string
        for (String shapeKeyword : SHAPE_KEYWORDS) {
            if (properties.containsKey(shapeKeyword)) {
                return shapeKeyword;
            }
        }

        // No specific shape found - could be default rectangle
        // Return null and let caller decide on default
        return null;
    }

    /**
     * Extracts a boolean property from the map.
     *
     * @param properties   the parsed properties map
     * @param propertyName the property name to extract
     * @return Boolean.TRUE if "1" or "true", Boolean.FALSE if "0" or "false", null if not present
     */
    private static Boolean extractBoolean(Map<String, String> properties, String propertyName) {
        String value = properties.get(propertyName);
        if (value == null) {
            return null;
        }
        if ("1".equals(value) || "true".equalsIgnoreCase(value)) {
            return Boolean.TRUE;
        }
        if ("0".equals(value) || "false".equalsIgnoreCase(value)) {
            return Boolean.FALSE;
        }
        return null;
    }

    /**
     * Extracts an integer property from the map.
     *
     * @param properties   the parsed properties map
     * @param propertyName the property name to extract
     * @return the integer value, or null if not present or invalid
     */
    private static Integer extractInteger(Map<String, String> properties, String propertyName) {
        String value = properties.get(propertyName);
        if (value == null || value.isEmpty()) {
            return null;
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
