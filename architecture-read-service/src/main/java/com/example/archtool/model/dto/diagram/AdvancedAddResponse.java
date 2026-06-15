package com.example.archtool.model.dto.diagram;

import java.util.List;

/**
 * Response from the advanced-add-expansion API endpoint.
 *
 * <p>This DTO contains the computed nodes and edges that should be added to
 * the diagram based on the user's selections in the Advanced Add dialog.</p>
 *
 * @param nodes List of nodes to be added to the diagram
 * @param edges List of edges to be added to the diagram
 */
public record AdvancedAddResponse(
    List<NodeDescriptor> nodes,
    List<EdgeDescriptor> edges
) {
    /**
     * Creates an empty response (no nodes or edges to add).
     *
     * @return A new AdvancedAddResponse with empty lists
     */
    public static AdvancedAddResponse empty() {
        return new AdvancedAddResponse(List.of(), List.of());
    }

    /**
     * Creates a response with only nodes (no edges).
     *
     * @param nodes The nodes to add
     * @return A new AdvancedAddResponse
     */
    public static AdvancedAddResponse withNodes(List<NodeDescriptor> nodes) {
        return new AdvancedAddResponse(nodes, List.of());
    }

    /**
     * Creates a response with both nodes and edges.
     *
     * @param nodes The nodes to add
     * @param edges The edges to add
     * @return A new AdvancedAddResponse
     */
    public static AdvancedAddResponse of(List<NodeDescriptor> nodes, List<EdgeDescriptor> edges) {
        return new AdvancedAddResponse(nodes, edges);
    }

    /**
     * Returns the count of new nodes (not already on diagram).
     *
     * @return Count of new nodes
     */
    public long newNodeCount() {
        return nodes.stream().filter(n -> !n.alreadyOnDiagram()).count();
    }

    /**
     * Returns the count of new edges (not already on diagram).
     *
     * @return Count of new edges
     */
    public long newEdgeCount() {
        return edges.stream().filter(e -> !e.alreadyOnDiagram()).count();
    }

    /**
     * Checks if there are any new items to add.
     *
     * @return true if there are new nodes or edges to add
     */
    public boolean hasNewItems() {
        return newNodeCount() > 0 || newEdgeCount() > 0;
    }
}
