package com.example.archtool.model.dto;

import java.util.List;

/**
 * Represents a single diagram graph parsed from a draw.io file.
 *
 * <p>A draw.io file can contain multiple tabs/diagrams. Each tab is represented
 * as a separate {@code DiagramGraphDto} instance. The diagram contains the
 * complete graph structure with all nodes and edges.</p>
 *
 * @param diagramId   unique identifier in format "diag_{pageId}_{attachmentId}_{tabIndex}"
 * @param diagramName the user-defined name of the diagram (from attachment filename)
 * @param tabIndex    the zero-based index of this tab within the draw.io file
 * @param tabName     the name of this tab/page as defined in draw.io
 * @param source      the source information for traceability
 * @param nodes       the list of nodes (vertices) in the diagram
 * @param edges       the list of edges (connections) in the diagram
 */
public record DiagramGraphDto(
    String diagramId,
    String diagramName,
    int tabIndex,
    String tabName,
    DiagramSourceDto source,
    List<DiagramNodeDto> nodes,
    List<DiagramEdgeDto> edges
) {
}
