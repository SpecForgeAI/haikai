package com.example.archtool.model.dto;

import java.util.List;

/**
 * The main API response containing all diagrams from the requested Confluence pages.
 *
 * <p>This is the root response object returned by the GET /api/confluence/diagrams
 * endpoint. It contains the request parameters, all processed pages with their
 * diagrams, and a summary of the processing results.</p>
 *
 * @param rootPageId          the ID of the root Confluence page that was requested
 * @param rootPageTitle       the title of the root page
 * @param includeAllChildPages whether child pages were included in the request
 * @param maxDepth            the maximum depth used for child page traversal
 * @param pages               the list of pages with their diagrams
 * @param summary             summary statistics and any warnings
 */
public record ConfluenceDiagramResponse(
    String rootPageId,
    String rootPageTitle,
    boolean includeAllChildPages,
    int maxDepth,
    List<ConfluencePageDiagramsDto> pages,
    ResponseSummaryDto summary
) {
}
