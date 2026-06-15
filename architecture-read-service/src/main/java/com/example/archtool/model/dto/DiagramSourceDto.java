package com.example.archtool.model.dto;

/**
 * Identifies the source of a diagram, providing traceability back to Confluence.
 *
 * <p>This DTO captures where the diagram came from, enabling consumers of the API
 * to navigate back to the original source in Confluence.</p>
 *
 * @param type               the type of source (e.g., "CONFLUENCE_DRAWIO_ATTACHMENT")
 * @param pageId             the Confluence page ID containing the attachment
 * @param attachmentId       the Confluence attachment ID
 * @param attachmentFileName the original filename of the draw.io attachment
 */
public record DiagramSourceDto(
    String type,
    String pageId,
    String attachmentId,
    String attachmentFileName
) {

    /** Source type for draw.io attachments from Confluence */
    public static final String TYPE_CONFLUENCE_DRAWIO_ATTACHMENT = "CONFLUENCE_DRAWIO_ATTACHMENT";
}
