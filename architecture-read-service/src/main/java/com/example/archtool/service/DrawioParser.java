package com.example.archtool.service;

import com.example.archtool.exception.DiagramParsingException;
import com.example.archtool.model.dto.*;
import com.example.archtool.util.StyleParser;
import com.example.archtool.util.XmlUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Service for parsing draw.io XML files into structured diagram graphs.
 *
 * <p>Handles both single-tab and multi-tab draw.io files, extracting
 * nodes (vertices), edges, geometry, and style information.</p>
 *
 * <p>Draw.io XML structure:</p>
 * <pre>
 * &lt;mxfile&gt;
 *   &lt;diagram id="..." name="Tab Name"&gt;
 *     &lt;mxGraphModel&gt;
 *       &lt;root&gt;
 *         &lt;mxCell id="0"/&gt;
 *         &lt;mxCell id="1" parent="0"/&gt;
 *         &lt;mxCell vertex="1" ...&gt;...&lt;/mxCell&gt;  (nodes)
 *         &lt;mxCell edge="1" ...&gt;...&lt;/mxCell&gt;    (edges)
 *       &lt;/root&gt;
 *     &lt;/mxGraphModel&gt;
 *   &lt;/diagram&gt;
 * &lt;/mxfile&gt;
 * </pre>
 */
@Service
public class DrawioParser {

    private static final Logger log = LoggerFactory.getLogger(DrawioParser.class);

    /**
     * Parses draw.io XML content into a list of diagram graphs.
     *
     * <p>Each tab in the draw.io file becomes a separate DiagramGraphDto.
     * Single-tab files return a list with one element.</p>
     *
     * @param xmlContent the raw XML content of the draw.io file
     * @param source     the source information for traceability
     * @return a list of DiagramGraphDto, one per tab in the file
     * @throws DiagramParsingException if the XML is invalid or cannot be parsed
     */
    public List<DiagramGraphDto> parse(byte[] xmlContent, DiagramSourceDto source) {
        String sourceId = formatSourceId(source);
        log.debug("Parsing draw.io file: {}", sourceId);

        // Parse XML
        Document document = XmlUtils.parseXmlBytes(xmlContent, sourceId);

        // Validate root element
        Element root = document.getDocumentElement();
        if (root == null || !"mxfile".equals(root.getTagName())) {
            throw new DiagramParsingException(sourceId, "Root element must be <mxfile>");
        }

        // Extract all diagram tabs
        List<DiagramGraphDto> diagrams = new ArrayList<>();
        NodeList diagramElements = root.getElementsByTagName("diagram");

        if (diagramElements.getLength() == 0) {
            throw new DiagramParsingException(sourceId, "No <diagram> elements found in mxfile");
        }

        for (int tabIndex = 0; tabIndex < diagramElements.getLength(); tabIndex++) {
            Element diagramElement = (Element) diagramElements.item(tabIndex);
            DiagramGraphDto diagram = parseDiagramTab(diagramElement, tabIndex, source);
            diagrams.add(diagram);
        }

        log.debug("Parsed {} tabs from draw.io file: {}", diagrams.size(), sourceId);
        return diagrams;
    }

    /**
     * Parses a single diagram tab into a DiagramGraphDto.
     *
     * @param diagramElement the &lt;diagram&gt; XML element
     * @param tabIndex      the zero-based index of this tab
     * @param source        the source information for traceability
     * @return the parsed DiagramGraphDto
     */
    private DiagramGraphDto parseDiagramTab(Element diagramElement, int tabIndex, DiagramSourceDto source) {
        String tabName = XmlUtils.getAttribute(diagramElement, "name", "Untitled");
        String diagramId = generateDiagramId(source.pageId(), source.attachmentId(), tabIndex);

        log.debug("Parsing tab {} ({}): {}", tabIndex, tabName, diagramId);

        // Find mxGraphModel > root
        Element rootElement = findGraphRoot(diagramElement, formatSourceId(source));

        // Extract nodes and edges
        List<DiagramNodeDto> nodes = new ArrayList<>();
        List<DiagramEdgeDto> edges = new ArrayList<>();

        NodeList cellElements = rootElement.getElementsByTagName("mxCell");
        for (int i = 0; i < cellElements.getLength(); i++) {
            Element cell = (Element) cellElements.item(i);

            if (XmlUtils.getBooleanAttribute(cell, "vertex")) {
                DiagramNodeDto node = parseNode(cell);
                if (node != null) {
                    nodes.add(node);
                }
            } else if (XmlUtils.getBooleanAttribute(cell, "edge")) {
                DiagramEdgeDto edge = parseEdge(cell);
                if (edge != null) {
                    edges.add(edge);
                }
            }
        }

        log.debug("Tab {} contains {} nodes and {} edges", tabIndex, nodes.size(), edges.size());

        return new DiagramGraphDto(
            diagramId,
            source.attachmentFileName(),
            tabIndex,
            tabName,
            source,
            nodes,
            edges
        );
    }

    /**
     * Finds the root element containing mxCell elements.
     *
     * <p>Navigates from &lt;diagram&gt; through &lt;mxGraphModel&gt; to &lt;root&gt;.</p>
     *
     * @param diagramElement the diagram element
     * @param sourceId       identifier for error messages
     * @return the root element
     * @throws DiagramParsingException if the expected structure is not found
     */
    private Element findGraphRoot(Element diagramElement, String sourceId) {
        // Find mxGraphModel
        NodeList graphModelList = diagramElement.getElementsByTagName("mxGraphModel");
        if (graphModelList.getLength() == 0) {
            throw new DiagramParsingException(sourceId, "Missing <mxGraphModel> element");
        }

        Element graphModel = (Element) graphModelList.item(0);

        // Find root
        NodeList rootList = graphModel.getElementsByTagName("root");
        if (rootList.getLength() == 0) {
            throw new DiagramParsingException(sourceId, "Missing <root> element in mxGraphModel");
        }

        return (Element) rootList.item(0);
    }

    /**
     * Parses an mxCell element with vertex="1" into a DiagramNodeDto.
     *
     * @param cell the mxCell element
     * @return the parsed node, or null if it's a structural cell (id="0" or id="1")
     */
    private DiagramNodeDto parseNode(Element cell) {
        String id = XmlUtils.getAttribute(cell, "id");

        // Skip structural cells (root containers)
        if ("0".equals(id) || "1".equals(id)) {
            return null;
        }

        String rawLabel = XmlUtils.getAttribute(cell, "value");
        String label = XmlUtils.unescapeHtmlEntities(rawLabel);
        String parentId = XmlUtils.getAttribute(cell, "parent");
        String styleString = XmlUtils.getAttribute(cell, "style");

        // Parse geometry
        DiagramGeometryDto geometry = parseGeometry(cell);

        // Parse style
        DiagramStyleDto style = StyleParser.parseStyle(styleString);

        return new DiagramNodeDto(id, label, geometry, style, parentId);
    }

    /**
     * Parses an mxCell element with edge="1" into a DiagramEdgeDto.
     *
     * @param cell the mxCell element
     * @return the parsed edge, or null if it's a structural cell
     */
    private DiagramEdgeDto parseEdge(Element cell) {
        String id = XmlUtils.getAttribute(cell, "id");

        // Skip structural cells
        if ("0".equals(id) || "1".equals(id)) {
            return null;
        }

        String sourceId = XmlUtils.getAttribute(cell, "source");
        String targetId = XmlUtils.getAttribute(cell, "target");
        String rawLabel = XmlUtils.getAttribute(cell, "value");
        String label = XmlUtils.unescapeHtmlEntities(rawLabel);
        String styleString = XmlUtils.getAttribute(cell, "style");

        // Parse edge points
        List<DiagramPointDto> points = parseEdgePoints(cell);

        // Parse style
        DiagramStyleDto style = StyleParser.parseStyle(styleString);

        return new DiagramEdgeDto(id, sourceId, targetId, label, points, style);
    }

    /**
     * Parses geometry information from an mxCell element.
     *
     * @param cell the mxCell element
     * @return the geometry DTO, or null if no mxGeometry child exists
     */
    private DiagramGeometryDto parseGeometry(Element cell) {
        NodeList geometryList = cell.getElementsByTagName("mxGeometry");
        if (geometryList.getLength() == 0) {
            return null;
        }

        Element geometry = (Element) geometryList.item(0);

        Double x = XmlUtils.getDoubleAttribute(geometry, "x");
        Double y = XmlUtils.getDoubleAttribute(geometry, "y");
        Double width = XmlUtils.getDoubleAttribute(geometry, "width");
        Double height = XmlUtils.getDoubleAttribute(geometry, "height");

        return new DiagramGeometryDto(x, y, width, height);
    }

    /**
     * Parses edge routing points from an mxCell element.
     *
     * <p>Extracts points from:</p>
     * <ul>
     *   <li>&lt;mxPoint as="sourcePoint"&gt; - source connection point</li>
     *   <li>&lt;mxPoint as="targetPoint"&gt; - target connection point</li>
     *   <li>&lt;Array as="points"&gt;&lt;mxPoint&gt; - intermediate waypoints</li>
     * </ul>
     *
     * @param cell the mxCell element
     * @return list of points defining the edge path
     */
    private List<DiagramPointDto> parseEdgePoints(Element cell) {
        List<DiagramPointDto> points = new ArrayList<>();

        NodeList geometryList = cell.getElementsByTagName("mxGeometry");
        if (geometryList.getLength() == 0) {
            return points;
        }

        Element geometry = (Element) geometryList.item(0);

        // Extract source point
        DiagramPointDto sourcePoint = extractNamedPoint(geometry, "sourcePoint");
        if (sourcePoint != null) {
            points.add(sourcePoint);
        }

        // Extract intermediate points from Array
        points.addAll(extractIntermediatePoints(geometry));

        // Extract target point
        DiagramPointDto targetPoint = extractNamedPoint(geometry, "targetPoint");
        if (targetPoint != null) {
            points.add(targetPoint);
        }

        return points;
    }

    /**
     * Extracts a named point (sourcePoint or targetPoint) from geometry.
     *
     * @param geometry the mxGeometry element
     * @param pointName the point name ("sourcePoint" or "targetPoint")
     * @return the point, or null if not found
     */
    private DiagramPointDto extractNamedPoint(Element geometry, String pointName) {
        NodeList pointElements = geometry.getElementsByTagName("mxPoint");
        for (int i = 0; i < pointElements.getLength(); i++) {
            Element point = (Element) pointElements.item(i);
            String as = XmlUtils.getAttribute(point, "as");
            if (pointName.equals(as)) {
                Double x = XmlUtils.getDoubleAttribute(point, "x");
                Double y = XmlUtils.getDoubleAttribute(point, "y");
                if (x != null && y != null) {
                    return new DiagramPointDto(x, y);
                }
            }
        }
        return null;
    }

    /**
     * Extracts intermediate waypoints from an Array element within geometry.
     *
     * @param geometry the mxGeometry element
     * @return list of intermediate points
     */
    private List<DiagramPointDto> extractIntermediatePoints(Element geometry) {
        List<DiagramPointDto> points = new ArrayList<>();

        NodeList arrayElements = geometry.getElementsByTagName("Array");
        for (int i = 0; i < arrayElements.getLength(); i++) {
            Element array = (Element) arrayElements.item(i);
            String as = XmlUtils.getAttribute(array, "as");
            if ("points".equals(as)) {
                NodeList pointElements = array.getElementsByTagName("mxPoint");
                for (int j = 0; j < pointElements.getLength(); j++) {
                    Element point = (Element) pointElements.item(j);
                    Double x = XmlUtils.getDoubleAttribute(point, "x");
                    Double y = XmlUtils.getDoubleAttribute(point, "y");
                    if (x != null && y != null) {
                        points.add(new DiagramPointDto(x, y));
                    }
                }
            }
        }

        return points;
    }

    /**
     * Generates a unique diagram ID.
     *
     * <p>Format: diag_{pageId}_{attachmentId}_{tabIndex}</p>
     *
     * @param pageId       the Confluence page ID
     * @param attachmentId the attachment ID
     * @param tabIndex     the zero-based tab index
     * @return the generated diagram ID
     */
    private String generateDiagramId(String pageId, String attachmentId, int tabIndex) {
        return String.format("diag_%s_%s_%d",
            sanitizeIdComponent(pageId),
            sanitizeIdComponent(attachmentId),
            tabIndex);
    }

    /**
     * Sanitizes an ID component for use in diagram IDs.
     *
     * @param component the component to sanitize
     * @return the sanitized component, or "unknown" if null/empty
     */
    private String sanitizeIdComponent(String component) {
        if (component == null || component.isEmpty()) {
            return "unknown";
        }
        // Replace any characters that might cause issues
        return component.replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    /**
     * Formats a source identifier for use in error messages.
     *
     * @param source the diagram source
     * @return a human-readable source identifier
     */
    private String formatSourceId(DiagramSourceDto source) {
        if (source == null) {
            return "unknown";
        }
        return String.format("%s/%s/%s",
            source.pageId() != null ? source.pageId() : "?",
            source.attachmentId() != null ? source.attachmentId() : "?",
            source.attachmentFileName() != null ? source.attachmentFileName() : "?");
    }
}
