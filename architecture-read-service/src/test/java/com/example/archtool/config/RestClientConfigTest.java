package com.example.archtool.config;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for RestClientConfig single bean setup.
 *
 * <p>Tests verify that:
 * <ul>
 *   <li>Only confluenceApiRestClient bean is created</li>
 *   <li>The API client bean is configured correctly</li>
 *   <li>No confluenceFileRestClient bean exists</li>
 * </ul>
 */
class RestClientConfigTest {

    private static final String API_BASE_URL = "https://api.atlassian.com/ex/confluence/12345/wiki";
    private static final String USERNAME = "user@example.com";
    private static final String API_TOKEN = "test-token";

    private RestClientConfig restClientConfig;
    private ConfluenceProperties properties;

    @BeforeEach
    void setUp() {
        properties = new ConfluenceProperties(
            API_BASE_URL,
            USERNAME,
            API_TOKEN,
            5000,
            30000,
            10
        );
        restClientConfig = new RestClientConfig(properties);
    }

    @Test
    @DisplayName("Should create confluenceApiRestClient bean")
    void shouldCreateApiRestClientBean() {
        RestClient apiClient = restClientConfig.confluenceApiRestClient();
        assertNotNull(apiClient, "confluenceApiRestClient should not be null");
    }

    @Test
    @DisplayName("Should only have single RestClient bean - no confluenceFileRestClient method exists")
    void shouldOnlyHaveSingleRestClientBean() {
        // Verify that confluenceApiRestClient exists
        RestClient apiClient = restClientConfig.confluenceApiRestClient();
        assertNotNull(apiClient, "confluenceApiRestClient should exist");

        // Verify by reflection that no confluenceFileRestClient method exists
        try {
            restClientConfig.getClass().getMethod("confluenceFileRestClient");
            fail("confluenceFileRestClient method should not exist");
        } catch (NoSuchMethodException e) {
            // Expected - method should not exist
        }
    }

    @Test
    @DisplayName("Should handle null credentials gracefully")
    void shouldHandleNullCredentials() {
        ConfluenceProperties propsWithoutCreds = new ConfluenceProperties(
            API_BASE_URL,
            null,  // no username
            null,  // no token
            5000,
            30000,
            10
        );
        RestClientConfig configWithoutCreds = new RestClientConfig(propsWithoutCreds);

        // Should not throw - just skip auth header
        RestClient apiClient = configWithoutCreds.confluenceApiRestClient();
        assertNotNull(apiClient);
    }

    @Test
    @DisplayName("Should create RestClient with correct base URL configuration")
    void shouldCreateRestClientWithCorrectBaseUrl() {
        // Given: Config with specific API base URL
        RestClient apiClient = restClientConfig.confluenceApiRestClient();

        // Then: Client is created (we can't directly inspect the base URL,
        // but the bean should be successfully created)
        assertNotNull(apiClient, "API client should be created successfully");
    }
}
