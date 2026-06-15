package com.example.archtool.model.dto;

import java.util.List;

/**
 * Provides summary statistics and warnings for the API response.
 *
 * <p>This DTO gives consumers a quick overview of what was processed,
 * including any warnings encountered during processing that did not
 * cause the request to fail.</p>
 *
 * @param totalPages    the total number of Confluence pages processed
 * @param totalDiagrams the total number of diagrams parsed
 * @param totalNodes    the total number of nodes across all diagrams
 * @param totalEdges    the total number of edges across all diagrams
 * @param warnings      list of warning messages for non-fatal issues
 */
public record ResponseSummaryDto(
    int totalPages,
    int totalDiagrams,
    int totalNodes,
    int totalEdges,
    List<String> warnings
) {
}
