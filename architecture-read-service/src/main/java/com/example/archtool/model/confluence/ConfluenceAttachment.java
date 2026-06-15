package com.example.archtool.model.confluence;

/**
 * Represents an attachment on a Confluence page.
 *
 * <p>This is a domain model for internal use, representing attachments
 * retrieved from the Confluence REST API. For draw.io diagrams, the
 * relevant attachments are those with .drawio or .xml extensions.</p>
 *
 * @param id          the Confluence attachment ID
 * @param title       the attachment filename
 * @param downloadUrl the URL to download the attachment content
 * @param mediaType   the MIME type of the attachment (e.g., "application/xml")
 */
public record ConfluenceAttachment(
    String id,
    String title,
    String downloadUrl,
    String mediaType
) {
}
