package com.example.archtool.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for ConfluenceProperties configuration validation.
 *
 * <p>Tests verify that:
 * <ul>
 *   <li>ConfluenceProperties loads correctly without uiAndFileBaseUrl</li>
 *   <li>Required properties (apiBaseUrl) are validated</li>
 *   <li>Default values are applied for optional properties</li>
 * </ul>
 */
class ConfluencePropertiesTest {

    private static final String API_BASE_URL = "https://api.atlassian.com/ex/confluence/12345/wiki";
    private static final String USERNAME = "user@example.com";
    private static final String API_TOKEN = "test-token";

    @Test
    @DisplayName("Should require apiBaseUrl - throws NullPointerException when null")
    void shouldRequireApiBaseUrl() {
        NullPointerException exception = assertThrows(NullPointerException.class, () ->
            new ConfluenceProperties(
                null,  // apiBaseUrl is null
                USERNAME,
                API_TOKEN,
                5000,
                30000,
                10
            )
        );
        assertEquals("apiBaseUrl must not be null", exception.getMessage());
    }

    @Test
    @DisplayName("Should load correctly without uiAndFileBaseUrl - single API base URL only")
    void shouldLoadCorrectlyWithoutUiAndFileBaseUrl() {
        // Given: Properties with only API base URL (no uiAndFileBaseUrl field)
        ConfluenceProperties props = new ConfluenceProperties(
            API_BASE_URL,
            USERNAME,
            API_TOKEN,
            10000,
            60000,
            5
        );

        // Then: Properties are correctly populated
        assertEquals(API_BASE_URL, props.apiBaseUrl());
        assertEquals(USERNAME, props.username());
        assertEquals(API_TOKEN, props.apiToken());
        assertEquals(10000, props.connectTimeoutMs());
        assertEquals(60000, props.readTimeoutMs());
        assertEquals(5, props.maxPageDepth());
    }

    @Test
    @DisplayName("Should apply default values for timeout when non-positive values provided")
    void shouldApplyDefaultsForTimeouts() {
        ConfluenceProperties props = new ConfluenceProperties(
            API_BASE_URL,
            USERNAME,
            API_TOKEN,
            0,   // non-positive connectTimeoutMs
            -1,  // negative readTimeoutMs
            0    // non-positive maxPageDepth
        );

        assertEquals(ConfluenceProperties.DEFAULT_CONNECT_TIMEOUT_MS, props.connectTimeoutMs());
        assertEquals(ConfluenceProperties.DEFAULT_READ_TIMEOUT_MS, props.readTimeoutMs());
        assertEquals(ConfluenceProperties.DEFAULT_MAX_PAGE_DEPTH, props.maxPageDepth());
    }

    @Test
    @DisplayName("Should allow null credentials for optional authentication")
    void shouldAllowNullCredentials() {
        // Given: Properties with null username and token (optional for some scenarios)
        ConfluenceProperties props = new ConfluenceProperties(
            API_BASE_URL,
            null,  // username is null
            null,  // apiToken is null
            5000,
            30000,
            10
        );

        // Then: Properties are created successfully
        assertEquals(API_BASE_URL, props.apiBaseUrl());
        assertNull(props.username());
        assertNull(props.apiToken());
    }
}
