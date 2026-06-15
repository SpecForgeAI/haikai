package com.example.archtool.model.confluence;

/**
 * Represents a Confluence page retrieved from the Confluence REST API.
 *
 * <p>This is a domain model for internal use, not a response DTO.
 * It captures the essential page information needed for diagram extraction.</p>
 *
 * @param id          the Confluence page ID
 * @param title       the page title
 * @param bodyStorage the page body content in Confluence storage format (XHTML)
 * @param version     the page version number (for optimistic locking, if needed)
 */
public record ConfluencePage(
    String id,
    String title,
    String bodyStorage,
    int version
) {
}
