package com.example.archtool.service;

import com.example.archtool.config.ConfluenceProperties;
import com.example.archtool.exception.ConfluenceApiException;
import com.example.archtool.model.confluence.ConfluenceAttachment;
import com.example.archtool.model.confluence.ConfluencePage;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * Client service for communicating with the Confluence REST API.
 *
 * <p>This service handles all HTTP communication with Confluence, including:
 * <ul>
 *   <li>Fetching page metadata and content</li>
 *   <li>Retrieving child pages recursively</li>
 *   <li>Fetching page attachments with pagination</li>
 *   <li>Downloading attachment content via REST API endpoint</li>
 * </ul>
 *
 * <p>All HTTP calls go through a single RestClient configured with the
 * Confluence API base URL and Basic Authentication.</p>
 */
@Service
public class ConfluenceClient {

    private static final Logger log = LoggerFactory.getLogger(ConfluenceClient.class);
    private static final int DEFAULT_PAGE_LIMIT = 25;
    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final RestClient apiRestClient;
    private final ConfluenceProperties properties;
    private final String authHeader;

    /**
     * Creates a new ConfluenceClient with a single RestClient instance.
     *
     * @param apiRestClient the REST client configured for all Confluence API calls
     * @param properties    the Confluence configuration properties
     */
    public ConfluenceClient(
            @Qualifier("confluenceApiRestClient") RestClient apiRestClient,
            ConfluenceProperties properties) {
        this.apiRestClient = apiRestClient;
        this.properties = properties;
        this.authHeader = createAuthHeader(properties.username(), properties.apiToken());
    }

    /**
     * Fetches a Confluence page by ID, including its body.storage content.
     *
     * <p>Calls: GET /rest/api/content/{id}?expand=body.storage,version</p>
     *
     * @param pageId the Confluence page ID
     * @return the page with body content and version
     * @throws ConfluenceApiException if the API returns an error response
     */
    public ConfluencePage getPage(String pageId) {
        log.debug("Fetching page: {}", pageId);

        String responseBody = apiRestClient.get()
            .uri("/rest/api/content/{id}?expand=body.storage,version", pageId)
            .header("Authorization", authHeader)
            .retrieve()
            .onStatus(HttpStatusCode::isError, (request, response) -> {
                String body = new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8);
                throw new ConfluenceApiException(
                    response.getStatusCode().value(),
                    extractErrorMessage(body, response.getStatusCode().value())
                );
            })
            .body(String.class);

        return parsePageResponse(responseBody);
    }

    /**
     * Fetches all child pages of a given page, recursively up to maxDepth.
     *
     * <p>Calls: GET /rest/api/content/{id}/child/page?expand=body.storage,version</p>
     *
     * @param pageId   the parent page ID
     * @param maxDepth maximum depth for recursive traversal
     * @return flat list of all descendant pages
     * @throws ConfluenceApiException if the API returns an error response
     */
    public List<ConfluencePage> getChildPages(String pageId, int maxDepth) {
        log.debug("Fetching child pages for: {} (maxDepth={})", pageId, maxDepth);

        List<ConfluencePage> allChildPages = new ArrayList<>();
        fetchChildPagesRecursive(pageId, maxDepth, 1, allChildPages);
        return allChildPages;
    }

    /**
     * Fetches all attachments for a page, handling pagination.
     *
     * <p>Calls: GET /rest/api/content/{pageId}/child/attachment</p>
     *
     * @param pageId the page ID to fetch attachments for
     * @return list of all attachments on the page
     * @throws ConfluenceApiException if the API returns an error response
     */
    public List<ConfluenceAttachment> getAttachments(String pageId) {
        log.debug("Fetching attachments for page: {}", pageId);

        List<ConfluenceAttachment> allAttachments = new ArrayList<>();
        String nextPath = "/rest/api/content/" + pageId + "/child/attachment?limit=" + DEFAULT_PAGE_LIMIT;

        while (nextPath != null) {
            String responseBody = apiRestClient.get()
                .uri(nextPath)
                .header("Authorization", authHeader)
                .retrieve()
                .onStatus(HttpStatusCode::isError, (request, response) -> {
                    String body = new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8);
                    throw new ConfluenceApiException(
                        response.getStatusCode().value(),
                        extractErrorMessage(body, response.getStatusCode().value())
                    );
                })
                .body(String.class);

            nextPath = parseAttachmentsResponse(responseBody, allAttachments);
        }

        log.debug("Found {} attachments for page {}", allAttachments.size(), pageId);
        return allAttachments;
    }

    /**
     * Downloads the content of an attachment as a byte array using the REST API endpoint.
     *
     * <p>Uses the Confluence REST API download endpoint:
     * {@code /rest/api/content/{pageId}/child/attachment/{attachmentId}/download}</p>
     *
     * <p>This method ignores the {@code attachment.downloadUrl()} field and constructs
     * the download URL from the pageId and attachment ID for reliable authentication
     * with scoped API tokens.</p>
     *
     * @param pageId     the page ID where the attachment is located
     * @param attachment the attachment to download
     * @return the attachment content as bytes
     * @throws ConfluenceApiException if the download fails
     */
    public byte[] downloadAttachment(String pageId, ConfluenceAttachment attachment) {
        String downloadEndpointPath = "/rest/api/content/" + pageId + "/child/attachment/" + attachment.id() + "/download";
        log.debug("Downloading attachment: {} via REST API path: {}", attachment.title(), downloadEndpointPath);

        return apiRestClient.get()
            .uri(downloadEndpointPath)
            .header("Authorization", authHeader)
            .retrieve()
            .onStatus(HttpStatusCode::isError, (request, response) -> {
                throw new ConfluenceApiException(
                    response.getStatusCode().value(),
                    "Failed to download attachment via REST API: " + attachment.title() +
                        " (pageId=" + pageId + ", attachmentId=" + attachment.id() + ")"
                );
            })
            .body(byte[].class);
    }

    // ========================================================================
    // Private helper methods
    // ========================================================================

    /**
     * Creates the Basic Authentication header value.
     *
     * @param username the Confluence username (usually email)
     * @param apiToken the Confluence API token
     * @return the Authorization header value
     */
    private String createAuthHeader(String username, String apiToken) {
        if (username == null || apiToken == null) {
            log.warn("Confluence credentials not configured");
            return null;
        }
        String credentials = username + ":" + apiToken;
        String encoded = Base64.getEncoder().encodeToString(credentials.getBytes(StandardCharsets.UTF_8));
        return "Basic " + encoded;
    }

    /**
     * Recursively fetches child pages up to maxDepth.
     */
    private void fetchChildPagesRecursive(String parentPageId, int maxDepth, int currentDepth, List<ConfluencePage> accumulator) {
        if (currentDepth > maxDepth) {
            return;
        }

        String nextPath = "/rest/api/content/" + parentPageId + "/child/page?expand=body.storage,version&limit=" + DEFAULT_PAGE_LIMIT;

        while (nextPath != null) {
            String responseBody = apiRestClient.get()
                .uri(nextPath)
                .header("Authorization", authHeader)
                .retrieve()
                .onStatus(HttpStatusCode::isError, (request, response) -> {
                    String body = new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8);
                    throw new ConfluenceApiException(
                        response.getStatusCode().value(),
                        extractErrorMessage(body, response.getStatusCode().value())
                    );
                })
                .body(String.class);

            List<ConfluencePage> thisPageResults = new ArrayList<>();
            nextPath = parseChildPagesResponse(responseBody, thisPageResults);

            // Add to accumulator
            accumulator.addAll(thisPageResults);

            // Recursively fetch children of these pages
            for (ConfluencePage childPage : thisPageResults) {
                fetchChildPagesRecursive(childPage.id(), maxDepth, currentDepth + 1, accumulator);
            }
        }
    }

    /**
     * Parses a single page response JSON into a ConfluencePage.
     */
    private ConfluencePage parsePageResponse(String responseBody) {
        try {
            JsonNode root = objectMapper.readTree(responseBody);
            return extractPageFromJson(root);
        } catch (JsonProcessingException e) {
            throw new ConfluenceApiException(500, "Failed to parse page response: " + e.getMessage(), e);
        }
    }

    /**
     * Parses a child pages response JSON and returns the next page path (if any).
     */
    private String parseChildPagesResponse(String responseBody, List<ConfluencePage> results) {
        try {
            JsonNode root = objectMapper.readTree(responseBody);
            JsonNode resultsArray = root.get("results");

            if (resultsArray != null && resultsArray.isArray()) {
                for (JsonNode pageNode : resultsArray) {
                    results.add(extractPageFromJson(pageNode));
                }
            }

            return extractNextLink(root);
        } catch (JsonProcessingException e) {
            throw new ConfluenceApiException(500, "Failed to parse child pages response: " + e.getMessage(), e);
        }
    }

    /**
     * Parses an attachments response JSON and returns the next page path (if any).
     */
    private String parseAttachmentsResponse(String responseBody, List<ConfluenceAttachment> results) {
        try {
            JsonNode root = objectMapper.readTree(responseBody);
            JsonNode resultsArray = root.get("results");

            if (resultsArray != null && resultsArray.isArray()) {
                for (JsonNode attachmentNode : resultsArray) {
                    results.add(extractAttachmentFromJson(attachmentNode));
                }
            }

            return extractNextLink(root);
        } catch (JsonProcessingException e) {
            throw new ConfluenceApiException(500, "Failed to parse attachments response: " + e.getMessage(), e);
        }
    }

    /**
     * Extracts a ConfluencePage from a JSON node.
     */
    private ConfluencePage extractPageFromJson(JsonNode pageNode) {
        String id = getTextValue(pageNode, "id");
        String title = getTextValue(pageNode, "title");

        // Extract body.storage.value
        String bodyStorage = null;
        JsonNode bodyNode = pageNode.get("body");
        if (bodyNode != null) {
            JsonNode storageNode = bodyNode.get("storage");
            if (storageNode != null) {
                bodyStorage = getTextValue(storageNode, "value");
            }
        }

        // Extract version.number
        int version = 0;
        JsonNode versionNode = pageNode.get("version");
        if (versionNode != null) {
            version = versionNode.has("number") ? versionNode.get("number").asInt() : 0;
        }

        return new ConfluencePage(id, title, bodyStorage, version);
    }

    /**
     * Extracts a ConfluenceAttachment from a JSON node.
     */
    private ConfluenceAttachment extractAttachmentFromJson(JsonNode attachmentNode) {
        String id = getTextValue(attachmentNode, "id");
        String title = getTextValue(attachmentNode, "title");

        // Extract download URL from _links.download
        String downloadUrl = null;
        JsonNode linksNode = attachmentNode.get("_links");
        if (linksNode != null) {
            downloadUrl = getTextValue(linksNode, "download");
        }

        // Extract media type from metadata.mediaType
        String mediaType = null;
        JsonNode metadataNode = attachmentNode.get("metadata");
        if (metadataNode != null) {
            mediaType = getTextValue(metadataNode, "mediaType");
        }

        return new ConfluenceAttachment(id, title, downloadUrl, mediaType);
    }

    /**
     * Extracts the next page link from _links.next.
     */
    private String extractNextLink(JsonNode root) {
        JsonNode linksNode = root.get("_links");
        if (linksNode != null && linksNode.has("next")) {
            return getTextValue(linksNode, "next");
        }
        return null;
    }

    /**
     * Safely gets a text value from a JSON node.
     */
    private String getTextValue(JsonNode node, String fieldName) {
        JsonNode field = node.get(fieldName);
        return (field != null && !field.isNull()) ? field.asText() : null;
    }

    /**
     * Extracts error message from error response body.
     */
    private String extractErrorMessage(String responseBody, int statusCode) {
        try {
            JsonNode root = objectMapper.readTree(responseBody);
            if (root.has("message")) {
                return root.get("message").asText();
            }
        } catch (JsonProcessingException e) {
            // Fall through to default message
        }

        return switch (statusCode) {
            case 401 -> "Confluence authentication failed";
            case 403 -> "Access denied";
            case 404 -> "Resource not found";
            default -> "Confluence API error (status " + statusCode + ")";
        };
    }
}
