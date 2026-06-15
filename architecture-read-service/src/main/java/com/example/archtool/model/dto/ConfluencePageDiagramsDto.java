package com.example.archtool.model.dto;

import java.util.List;

/**
 * Groups all diagrams found on a single Confluence page.
 *
 * <p>This DTO provides the page context for a collection of diagrams,
 * allowing consumers to understand which Confluence page the diagrams
 * came from.</p>
 *
 * @param pageId    the Confluence page ID
 * @param pageTitle the title of the Confluence page
 * @param diagrams  the list of diagrams found on this page
 */
public record ConfluencePageDiagramsDto(
    String pageId,
    String pageTitle,
    List<DiagramGraphDto> diagrams
) {
}
