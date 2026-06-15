package com.example.archtool.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.Objects;

/**
 * Configuration properties for Confluence API connectivity.
 *
 * <p>Binds to the {@code archtool.confluence} prefix in application configuration.
 * Required fields are validated in the compact constructor, and sensible defaults
 * are applied for optional timeout and depth settings.</p>
 *
 * <p>All Confluence HTTP calls (including attachment downloads) use the single
 * {@code apiBaseUrl} which points to the Confluence REST API endpoint.</p>
 */
@ConfigurationProperties(prefix = "archtool.confluence")
public record ConfluenceProperties(
    String apiBaseUrl,
    String username,
    String apiToken,
    int connectTimeoutMs,
    int readTimeoutMs,
    int maxPageDepth
) {

    /** Default connection timeout in milliseconds */
    public static final int DEFAULT_CONNECT_TIMEOUT_MS = 5000;

    /** Default read timeout in milliseconds */
    public static final int DEFAULT_READ_TIMEOUT_MS = 30000;

    /** Default maximum page depth for child page traversal */
    public static final int DEFAULT_MAX_PAGE_DEPTH = 10;

    /**
     * Compact constructor that validates required fields and applies defaults.
     */
    public ConfluenceProperties {
        Objects.requireNonNull(apiBaseUrl, "apiBaseUrl must not be null");

        // Apply defaults for non-positive timeout values
        if (connectTimeoutMs <= 0) {
            connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS;
        }
        if (readTimeoutMs <= 0) {
            readTimeoutMs = DEFAULT_READ_TIMEOUT_MS;
        }
        if (maxPageDepth <= 0) {
            maxPageDepth = DEFAULT_MAX_PAGE_DEPTH;
        }
    }
}
