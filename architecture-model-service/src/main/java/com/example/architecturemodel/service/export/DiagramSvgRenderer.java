package com.example.architecturemodel.service.export;

import com.example.architecturemodel.model.dto.diagram.*;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Component for rendering DiagramDto to SVG format.
 *
 * Converts canonical diagram data to SVG string without external SVG libraries.
 * Uses StringBuilder for efficient string construction and produces deterministic
 * output based on sorted canonical diagram data.
 *
 * Spec: Export Diagrams as SVG
 */
@Component
public class DiagramSvgRenderer {

    // Default styling constants
    private static final double DEFAULT_PADDING = 50.0;
    private static final String DEFAULT_FILL_COLOR = "#ffffff";
    private static final String DEFAULT_STROKE_COLOR = "#333333";
    private static final String DEFAULT_TEXT_COLOR = "#333333";
    private static final double DEFAULT_STROKE_WIDTH = 1.0;
    private static final double DEFAULT_FONT_SIZE = 12.0;
    private static final double DEFAULT_NODE_WIDTH = 100.0;
    private static final double DEFAULT_NODE_HEIGHT = 60.0;
    private static final double MIN_CANVAS_WIDTH = 200.0;
    private static final double MIN_CANVAS_HEIGHT = 200.0;

    /**
     * Renders a DiagramDto to SVG string.
     *
     * @param diagram The canonical diagram DTO to render
     * @return Complete SVG markup as a string
     */
    public String renderToSvg(DiagramDto diagram) {
        if (diagram == null) {
            return renderEmptySvg();
        }

        // Calculate canvas bounds
        CanvasBounds bounds = calculateBounds(diagram);

        StringBuilder svg = new StringBuilder();

        // SVG root element with xmlns, width, height, viewBox
        svg.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        svg.append("<svg xmlns=\"http://www.w3.org/2000/svg\" ");
        svg.append("width=\"").append(formatNumber(bounds.width)).append("\" ");
        svg.append("height=\"").append(formatNumber(bounds.height)).append("\" ");
        svg.append("viewBox=\"").append(formatNumber(bounds.minX)).append(" ");
        svg.append(formatNumber(bounds.minY)).append(" ");
        svg.append(formatNumber(bounds.width)).append(" ");
        svg.append(formatNumber(bounds.height)).append("\">\n");

        // Defs section for arrow markers
        renderDefs(svg);

        // Render background
        svg.append("  <rect x=\"").append(formatNumber(bounds.minX)).append("\" ");
        svg.append("y=\"").append(formatNumber(bounds.minY)).append("\" ");
        svg.append("width=\"").append(formatNumber(bounds.width)).append("\" ");
        svg.append("height=\"").append(formatNumber(bounds.height)).append("\" ");
        svg.append("fill=\"#fafafa\"/>\n");

        // Render decorations first (background layer)
        if (diagram.decorations() != null) {
            for (DecorationDto decoration : diagram.decorations()) {
                renderDecoration(svg, decoration);
            }
        }

        // Render edges before nodes so nodes appear on top
        if (diagram.diagramEdges() != null) {
            for (DiagramEdgeDto edge : diagram.diagramEdges()) {
                renderEdge(svg, edge, diagram.diagramNodes());
            }
        }

        // Render nodes
        if (diagram.diagramNodes() != null) {
            for (DiagramNodeDto node : diagram.diagramNodes()) {
                renderNode(svg, node);
            }
        }

        svg.append("</svg>\n");

        return svg.toString();
    }

    /**
     * Renders an empty SVG with minimal dimensions.
     */
    private String renderEmptySvg() {
        StringBuilder svg = new StringBuilder();
        svg.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        svg.append("<svg xmlns=\"http://www.w3.org/2000/svg\" ");
        svg.append("width=\"").append(formatNumber(MIN_CANVAS_WIDTH)).append("\" ");
        svg.append("height=\"").append(formatNumber(MIN_CANVAS_HEIGHT)).append("\" ");
        svg.append("viewBox=\"0 0 ").append(formatNumber(MIN_CANVAS_WIDTH)).append(" ");
        svg.append(formatNumber(MIN_CANVAS_HEIGHT)).append("\">\n");
        svg.append("  <rect x=\"0\" y=\"0\" width=\"").append(formatNumber(MIN_CANVAS_WIDTH));
        svg.append("\" height=\"").append(formatNumber(MIN_CANVAS_HEIGHT)).append("\" fill=\"#fafafa\"/>\n");
        svg.append("</svg>\n");
        return svg.toString();
    }

    /**
     * Calculates canvas bounds by scanning all nodes, edges, and decorations.
     */
    private CanvasBounds calculateBounds(DiagramDto diagram) {
        double minX = Double.MAX_VALUE;
        double minY = Double.MAX_VALUE;
        double maxX = Double.MIN_VALUE;
        double maxY = Double.MIN_VALUE;

        boolean hasElements = false;

        // Scan nodes
        if (diagram.diagramNodes() != null) {
            for (DiagramNodeDto node : diagram.diagramNodes()) {
                if (node.posX() != null && node.posY() != null) {
                    hasElements = true;
                    double x = node.posX();
                    double y = node.posY();
                    double w = node.width() != null ? node.width() : DEFAULT_NODE_WIDTH;
                    double h = node.height() != null ? node.height() : DEFAULT_NODE_HEIGHT;

                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x + w);
                    maxY = Math.max(maxY, y + h);
                }
            }
        }

        // Scan edge points
        if (diagram.diagramEdges() != null) {
            for (DiagramEdgeDto edge : diagram.diagramEdges()) {
                if (edge.edgePoints() != null) {
                    for (EdgePointDto point : edge.edgePoints()) {
                        if (point.posX() != null && point.posY() != null) {
                            hasElements = true;
                            minX = Math.min(minX, point.posX());
                            minY = Math.min(minY, point.posY());
                            maxX = Math.max(maxX, point.posX());
                            maxY = Math.max(maxY, point.posY());
                        }
                    }
                }
            }
        }

        // Scan decorations
        if (diagram.decorations() != null) {
            for (DecorationDto decoration : diagram.decorations()) {
                if (decoration.posX() != null && decoration.posY() != null) {
                    hasElements = true;
                    double x = decoration.posX();
                    double y = decoration.posY();
                    double w = decoration.width() != null ? decoration.width() : DEFAULT_NODE_WIDTH;
                    double h = decoration.height() != null ? decoration.height() : DEFAULT_NODE_HEIGHT;

                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x + w);
                    maxY = Math.max(maxY, y + h);
                }

                // Also check line points for line decorations
                // LinePointDto uses x() and y() accessors
                if (decoration.linePoints() != null) {
                    for (LinePointDto point : decoration.linePoints()) {
                        if (point.x() != null && point.y() != null) {
                            hasElements = true;
                            minX = Math.min(minX, point.x());
                            minY = Math.min(minY, point.y());
                            maxX = Math.max(maxX, point.x());
                            maxY = Math.max(maxY, point.y());
                        }
                    }
                }
            }
        }

        if (!hasElements) {
            // Empty diagram - use minimal defaults
            return new CanvasBounds(0, 0, MIN_CANVAS_WIDTH, MIN_CANVAS_HEIGHT);
        }

        // Add padding
        minX -= DEFAULT_PADDING;
        minY -= DEFAULT_PADDING;
        maxX += DEFAULT_PADDING;
        maxY += DEFAULT_PADDING;

        double width = Math.max(maxX - minX, MIN_CANVAS_WIDTH);
        double height = Math.max(maxY - minY, MIN_CANVAS_HEIGHT);

        return new CanvasBounds(minX, minY, width, height);
    }

    /**
     * Renders SVG defs section with arrow markers.
     */
    private void renderDefs(StringBuilder svg) {
        svg.append("  <defs>\n");

        // Standard arrow end marker
        svg.append("    <marker id=\"arrow-end\" markerWidth=\"10\" markerHeight=\"10\" ");
        svg.append("refX=\"9\" refY=\"3\" orient=\"auto\" markerUnits=\"strokeWidth\">\n");
        svg.append("      <path d=\"M0,0 L0,6 L9,3 z\" fill=\"").append(DEFAULT_STROKE_COLOR).append("\"/>\n");
        svg.append("    </marker>\n");

        // Standard arrow start marker
        svg.append("    <marker id=\"arrow-start\" markerWidth=\"10\" markerHeight=\"10\" ");
        svg.append("refX=\"0\" refY=\"3\" orient=\"auto\" markerUnits=\"strokeWidth\">\n");
        svg.append("      <path d=\"M9,0 L9,6 L0,3 z\" fill=\"").append(DEFAULT_STROKE_COLOR).append("\"/>\n");
        svg.append("    </marker>\n");

        // Diamond marker for associations
        svg.append("    <marker id=\"diamond-end\" markerWidth=\"12\" markerHeight=\"12\" ");
        svg.append("refX=\"12\" refY=\"6\" orient=\"auto\" markerUnits=\"strokeWidth\">\n");
        svg.append("      <polygon points=\"0,6 6,0 12,6 6,12\" fill=\"").append(DEFAULT_STROKE_COLOR).append("\"/>\n");
        svg.append("    </marker>\n");

        // Open diamond marker
        svg.append("    <marker id=\"diamond-open-end\" markerWidth=\"12\" markerHeight=\"12\" ");
        svg.append("refX=\"12\" refY=\"6\" orient=\"auto\" markerUnits=\"strokeWidth\">\n");
        svg.append("      <polygon points=\"0,6 6,0 12,6 6,12\" fill=\"white\" stroke=\"");
        svg.append(DEFAULT_STROKE_COLOR).append("\" stroke-width=\"1\"/>\n");
        svg.append("    </marker>\n");

        svg.append("  </defs>\n");
    }

    /**
     * Renders a diagram node as SVG rect with text label.
     */
    private void renderNode(StringBuilder svg, DiagramNodeDto node) {
        if (node == null || node.posX() == null || node.posY() == null) {
            return;
        }

        double x = node.posX();
        double y = node.posY();
        double w = node.width() != null ? node.width() : DEFAULT_NODE_WIDTH;
        double h = node.height() != null ? node.height() : DEFAULT_NODE_HEIGHT;

        String fill = node.backgroundColor() != null ? node.backgroundColor() : DEFAULT_FILL_COLOR;
        String stroke = node.lineColor() != null ? node.lineColor() : DEFAULT_STROKE_COLOR;
        String textColor = node.textColor() != null ? node.textColor() : DEFAULT_TEXT_COLOR;
        double fontSize = parseFontSize(node.textFontSize());
        String fontWeight = node.textFontWeight() != null ? node.textFontWeight() : "normal";
        String fontStyle = node.textFontStyle() != null ? node.textFontStyle() : "normal";

        // Render rect
        svg.append("  <rect ");
        svg.append("x=\"").append(formatNumber(x)).append("\" ");
        svg.append("y=\"").append(formatNumber(y)).append("\" ");
        svg.append("width=\"").append(formatNumber(w)).append("\" ");
        svg.append("height=\"").append(formatNumber(h)).append("\" ");
        svg.append("fill=\"").append(escapeXml(fill)).append("\" ");
        svg.append("stroke=\"").append(escapeXml(stroke)).append("\" ");
        svg.append("stroke-width=\"").append(formatNumber(DEFAULT_STROKE_WIDTH)).append("\" ");
        svg.append("rx=\"2\" ry=\"2\"/>\n");

        // Render text label (entity_id can be used to indicate the node has content)
        if (node.entityId() != null && !node.entityId().isEmpty()) {
            // Calculate text position based on alignment
            double textX = calculateTextX(x, w, node.textHAlign());
            double textY = calculateTextY(y, h, fontSize, node.textVAlign());
            String textAnchor = getTextAnchor(node.textHAlign());

            svg.append("  <text ");
            svg.append("x=\"").append(formatNumber(textX)).append("\" ");
            svg.append("y=\"").append(formatNumber(textY)).append("\" ");
            svg.append("text-anchor=\"").append(textAnchor).append("\" ");
            svg.append("dominant-baseline=\"middle\" ");
            svg.append("font-family=\"Arial, sans-serif\" ");
            svg.append("font-size=\"").append(formatNumber(fontSize)).append("px\" ");
            svg.append("font-weight=\"").append(fontWeight).append("\" ");
            svg.append("font-style=\"").append(fontStyle).append("\" ");
            svg.append("fill=\"").append(escapeXml(textColor)).append("\">");
            // Use entityType as a display name placeholder (actual entity name lookup would need metaModel)
            svg.append(escapeXml(formatEntityLabel(node.entityType(), node.entityId())));
            svg.append("</text>\n");
        }
    }

    /**
     * Renders a diagram edge as polyline/path with optional arrow markers.
     */
    private void renderEdge(StringBuilder svg, DiagramEdgeDto edge, List<DiagramNodeDto> nodes) {
        if (edge == null) {
            return;
        }

        String stroke = edge.lineColor() != null ? edge.lineColor() : DEFAULT_STROKE_COLOR;
        double strokeWidth = DEFAULT_STROKE_WIDTH;

        // Build points list from edge points or from source/target nodes
        List<double[]> points = new ArrayList<>();

        if (edge.edgePoints() != null && !edge.edgePoints().isEmpty()) {
            // Sort edge points by sequence order
            List<EdgePointDto> sortedPoints = new ArrayList<>(edge.edgePoints());
            sortedPoints.sort(Comparator.comparing(
                p -> p.sequenceOrder() != null ? p.sequenceOrder() : 0
            ));

            for (EdgePointDto point : sortedPoints) {
                if (point.posX() != null && point.posY() != null) {
                    points.add(new double[]{point.posX(), point.posY()});
                }
            }
        } else if (nodes != null && edge.sourceNodeId() != null && edge.targetNodeId() != null) {
            // Fall back to calculating points from source/target nodes
            DiagramNodeDto sourceNode = findNode(nodes, edge.sourceNodeId());
            DiagramNodeDto targetNode = findNode(nodes, edge.targetNodeId());

            if (sourceNode != null && targetNode != null) {
                double[] sourceCenter = getNodeCenter(sourceNode);
                double[] targetCenter = getNodeCenter(targetNode);
                points.add(sourceCenter);
                points.add(targetCenter);
            }
        }

        if (points.size() < 2) {
            return; // Not enough points to draw an edge
        }

        // Build polyline points string
        StringBuilder pointsStr = new StringBuilder();
        for (int i = 0; i < points.size(); i++) {
            if (i > 0) pointsStr.append(" ");
            pointsStr.append(formatNumber(points.get(i)[0]));
            pointsStr.append(",");
            pointsStr.append(formatNumber(points.get(i)[1]));
        }

        // Determine line style
        String dashArray = "";
        if ("dashed".equalsIgnoreCase(edge.lineType())) {
            dashArray = " stroke-dasharray=\"5,5\"";
        } else if ("dotted".equalsIgnoreCase(edge.lineType())) {
            dashArray = " stroke-dasharray=\"2,2\"";
        }

        // Determine markers
        String markerEnd = "";
        String markerStart = "";

        if (edge.arrowEnd() != null && !"none".equalsIgnoreCase(edge.arrowEnd())) {
            if ("diamond".equalsIgnoreCase(edge.arrowEnd())) {
                markerEnd = " marker-end=\"url(#diamond-end)\"";
            } else if ("diamond-open".equalsIgnoreCase(edge.arrowEnd())) {
                markerEnd = " marker-end=\"url(#diamond-open-end)\"";
            } else {
                markerEnd = " marker-end=\"url(#arrow-end)\"";
            }
        }

        if (edge.arrowStart() != null && !"none".equalsIgnoreCase(edge.arrowStart())) {
            markerStart = " marker-start=\"url(#arrow-start)\"";
        }

        // Render polyline
        svg.append("  <polyline ");
        svg.append("points=\"").append(pointsStr).append("\" ");
        svg.append("fill=\"none\" ");
        svg.append("stroke=\"").append(escapeXml(stroke)).append("\" ");
        svg.append("stroke-width=\"").append(formatNumber(strokeWidth)).append("\"");
        svg.append(dashArray);
        svg.append(markerEnd);
        svg.append(markerStart);
        svg.append("/>\n");

        // Render edge label if present
        if (edge.labelText() != null && !edge.labelText().isEmpty()) {
            double labelX = edge.labelPosX() != null ? edge.labelPosX() :
                (points.get(0)[0] + points.get(points.size()-1)[0]) / 2;
            double labelY = edge.labelPosY() != null ? edge.labelPosY() :
                (points.get(0)[1] + points.get(points.size()-1)[1]) / 2;
            String textColor = edge.textColor() != null ? edge.textColor() : DEFAULT_TEXT_COLOR;
            double fontSize = parseFontSize(edge.labelFontSize());

            svg.append("  <text ");
            svg.append("x=\"").append(formatNumber(labelX)).append("\" ");
            svg.append("y=\"").append(formatNumber(labelY)).append("\" ");
            svg.append("text-anchor=\"middle\" ");
            svg.append("dominant-baseline=\"middle\" ");
            svg.append("font-family=\"Arial, sans-serif\" ");
            svg.append("font-size=\"").append(formatNumber(fontSize)).append("px\" ");
            svg.append("fill=\"").append(escapeXml(textColor)).append("\">");
            svg.append(escapeXml(edge.labelText()));
            svg.append("</text>\n");
        }
    }

    /**
     * Renders a decoration element.
     */
    private void renderDecoration(StringBuilder svg, DecorationDto decoration) {
        if (decoration == null) {
            return;
        }

        if ("BOX".equalsIgnoreCase(decoration.type()) ||
            "ELLIPSE".equalsIgnoreCase(decoration.type()) ||
            "ROUNDED_RECT".equalsIgnoreCase(decoration.type())) {
            renderShapeDecoration(svg, decoration);
        } else if ("LINE".equalsIgnoreCase(decoration.type())) {
            renderLineDecoration(svg, decoration);
        }
    }

    /**
     * Renders a shape decoration (BOX, ELLIPSE, ROUNDED_RECT).
     */
    private void renderShapeDecoration(StringBuilder svg, DecorationDto decoration) {
        if (decoration.posX() == null || decoration.posY() == null) {
            return;
        }

        double x = decoration.posX();
        double y = decoration.posY();
        double w = decoration.width() != null ? decoration.width() : DEFAULT_NODE_WIDTH;
        double h = decoration.height() != null ? decoration.height() : DEFAULT_NODE_HEIGHT;

        String fill = decoration.backgroundColor() != null ? decoration.backgroundColor() : "transparent";
        String stroke = decoration.lineColor() != null ? decoration.lineColor() : DEFAULT_STROKE_COLOR;
        double strokeWidth = DEFAULT_STROKE_WIDTH;

        if ("ELLIPSE".equalsIgnoreCase(decoration.type())) {
            double cx = x + w / 2;
            double cy = y + h / 2;
            double rx = w / 2;
            double ry = h / 2;

            svg.append("  <ellipse ");
            svg.append("cx=\"").append(formatNumber(cx)).append("\" ");
            svg.append("cy=\"").append(formatNumber(cy)).append("\" ");
            svg.append("rx=\"").append(formatNumber(rx)).append("\" ");
            svg.append("ry=\"").append(formatNumber(ry)).append("\" ");
            svg.append("fill=\"").append(escapeXml(fill)).append("\" ");
            svg.append("stroke=\"").append(escapeXml(stroke)).append("\" ");
            svg.append("stroke-width=\"").append(formatNumber(strokeWidth)).append("\"/>\n");
        } else {
            // BOX or ROUNDED_RECT
            double rx = "ROUNDED_RECT".equalsIgnoreCase(decoration.type()) ? 8 : 0;

            svg.append("  <rect ");
            svg.append("x=\"").append(formatNumber(x)).append("\" ");
            svg.append("y=\"").append(formatNumber(y)).append("\" ");
            svg.append("width=\"").append(formatNumber(w)).append("\" ");
            svg.append("height=\"").append(formatNumber(h)).append("\" ");
            svg.append("fill=\"").append(escapeXml(fill)).append("\" ");
            svg.append("stroke=\"").append(escapeXml(stroke)).append("\" ");
            svg.append("stroke-width=\"").append(formatNumber(strokeWidth)).append("\" ");
            if (rx > 0) {
                svg.append("rx=\"").append(formatNumber(rx)).append("\" ");
                svg.append("ry=\"").append(formatNumber(rx)).append("\" ");
            }
            svg.append("/>\n");
        }

        // Render decoration text
        if (decoration.text() != null && !decoration.text().isEmpty()) {
            double fontSize = decoration.textFontSize() != null ? decoration.textFontSize() : DEFAULT_FONT_SIZE;
            String textColor = decoration.textColor() != null ? decoration.textColor() : DEFAULT_TEXT_COLOR;
            double textX = calculateTextX(x, w, decoration.textHAlign());
            double textY = calculateTextY(y, h, fontSize, decoration.textVAlign());
            String textAnchor = getTextAnchor(decoration.textHAlign());

            svg.append("  <text ");
            svg.append("x=\"").append(formatNumber(textX)).append("\" ");
            svg.append("y=\"").append(formatNumber(textY)).append("\" ");
            svg.append("text-anchor=\"").append(textAnchor).append("\" ");
            svg.append("dominant-baseline=\"middle\" ");
            svg.append("font-family=\"Arial, sans-serif\" ");
            svg.append("font-size=\"").append(formatNumber(fontSize)).append("px\" ");
            svg.append("fill=\"").append(escapeXml(textColor)).append("\">");
            svg.append(escapeXml(decoration.text()));
            svg.append("</text>\n");
        }
    }

    /**
     * Renders a line decoration.
     * LinePointDto uses x() and y() accessors (not posX/posY).
     * Points are processed in list order (no sequenceOrder field).
     */
    private void renderLineDecoration(StringBuilder svg, DecorationDto decoration) {
        if (decoration.linePoints() == null || decoration.linePoints().size() < 2) {
            return;
        }

        String stroke = decoration.lineColor() != null ? decoration.lineColor() : DEFAULT_STROKE_COLOR;
        double strokeWidth = DEFAULT_STROKE_WIDTH;

        // LinePointDto doesn't have sequenceOrder - process in list order
        List<LinePointDto> points = decoration.linePoints();

        StringBuilder pointsStr = new StringBuilder();
        for (LinePointDto point : points) {
            if (point.x() != null && point.y() != null) {
                if (pointsStr.length() > 0) pointsStr.append(" ");
                pointsStr.append(formatNumber(point.x()));
                pointsStr.append(",");
                pointsStr.append(formatNumber(point.y()));
            }
        }

        if (pointsStr.length() == 0) {
            return;
        }

        // Determine markers
        String markerEnd = "";
        String markerStart = "";

        if (decoration.arrowEnd() != null && !"none".equalsIgnoreCase(decoration.arrowEnd())) {
            markerEnd = " marker-end=\"url(#arrow-end)\"";
        }
        if (decoration.arrowStart() != null && !"none".equalsIgnoreCase(decoration.arrowStart())) {
            markerStart = " marker-start=\"url(#arrow-start)\"";
        }

        svg.append("  <polyline ");
        svg.append("points=\"").append(pointsStr).append("\" ");
        svg.append("fill=\"none\" ");
        svg.append("stroke=\"").append(escapeXml(stroke)).append("\" ");
        svg.append("stroke-width=\"").append(formatNumber(strokeWidth)).append("\"");
        svg.append(markerEnd);
        svg.append(markerStart);
        svg.append("/>\n");

        // Render line decoration text/label
        if (decoration.text() != null && !decoration.text().isEmpty()) {
            LinePointDto firstPoint = points.get(0);
            LinePointDto lastPoint = points.get(points.size() - 1);
            double labelX = decoration.labelPosX() != null ? decoration.labelPosX() :
                (firstPoint.x() + lastPoint.x()) / 2;
            double labelY = decoration.labelPosY() != null ? decoration.labelPosY() :
                (firstPoint.y() + lastPoint.y()) / 2;
            double fontSize = decoration.textFontSize() != null ? decoration.textFontSize() : DEFAULT_FONT_SIZE;
            String textColor = decoration.textColor() != null ? decoration.textColor() : DEFAULT_TEXT_COLOR;

            svg.append("  <text ");
            svg.append("x=\"").append(formatNumber(labelX)).append("\" ");
            svg.append("y=\"").append(formatNumber(labelY)).append("\" ");
            svg.append("text-anchor=\"middle\" ");
            svg.append("dominant-baseline=\"middle\" ");
            svg.append("font-family=\"Arial, sans-serif\" ");
            svg.append("font-size=\"").append(formatNumber(fontSize)).append("px\" ");
            svg.append("fill=\"").append(escapeXml(textColor)).append("\">");
            svg.append(escapeXml(decoration.text()));
            svg.append("</text>\n");
        }
    }

    // =========================================
    // Helper Methods
    // =========================================

    private DiagramNodeDto findNode(List<DiagramNodeDto> nodes, String nodeId) {
        if (nodes == null || nodeId == null) return null;
        return nodes.stream()
            .filter(n -> nodeId.equals(n.id()))
            .findFirst()
            .orElse(null);
    }

    private double[] getNodeCenter(DiagramNodeDto node) {
        double x = node.posX() != null ? node.posX() : 0;
        double y = node.posY() != null ? node.posY() : 0;
        double w = node.width() != null ? node.width() : DEFAULT_NODE_WIDTH;
        double h = node.height() != null ? node.height() : DEFAULT_NODE_HEIGHT;
        return new double[]{x + w / 2, y + h / 2};
    }

    private double parseFontSize(String fontSize) {
        if (fontSize == null || fontSize.isEmpty()) {
            return DEFAULT_FONT_SIZE;
        }
        try {
            // Remove 'px' suffix if present
            String cleaned = fontSize.replaceAll("[^0-9.]", "");
            return Double.parseDouble(cleaned);
        } catch (NumberFormatException e) {
            return DEFAULT_FONT_SIZE;
        }
    }

    private double calculateTextX(double boxX, double boxW, String hAlign) {
        if ("LEFT".equalsIgnoreCase(hAlign)) {
            return boxX + 4; // Small padding
        } else if ("RIGHT".equalsIgnoreCase(hAlign)) {
            return boxX + boxW - 4;
        } else {
            return boxX + boxW / 2; // CENTER
        }
    }

    private double calculateTextY(double boxY, double boxH, double fontSize, String vAlign) {
        if ("TOP".equalsIgnoreCase(vAlign)) {
            return boxY + fontSize;
        } else if ("BOTTOM".equalsIgnoreCase(vAlign)) {
            return boxY + boxH - fontSize / 2;
        } else {
            return boxY + boxH / 2; // MIDDLE
        }
    }

    private String getTextAnchor(String hAlign) {
        if ("LEFT".equalsIgnoreCase(hAlign)) {
            return "start";
        } else if ("RIGHT".equalsIgnoreCase(hAlign)) {
            return "end";
        } else {
            return "middle";
        }
    }

    private String formatEntityLabel(String entityType, String entityId) {
        // Create a human-readable label from entity type and truncated ID
        if (entityType == null || entityType.isEmpty()) {
            return entityId != null ? entityId.substring(0, Math.min(8, entityId.length())) : "";
        }
        // Format entity type nicely (e.g., "APPLICATION" -> "Application")
        String formatted = entityType.substring(0, 1).toUpperCase() +
            entityType.substring(1).toLowerCase().replace("_", " ");
        return formatted;
    }

    private String formatNumber(double value) {
        // Format numbers without trailing zeros for cleaner SVG
        if (value == (long) value) {
            return String.valueOf((long) value);
        }
        return String.format("%.2f", value).replaceAll("0+$", "").replaceAll("\\.$", "");
    }

    private String escapeXml(String input) {
        if (input == null) return "";
        return input
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&apos;");
    }

    /**
     * Canvas bounds container.
     */
    private record CanvasBounds(double minX, double minY, double width, double height) {}
}
