package com.example.archtool.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration test that verifies the Spring application context loads correctly
 * with valid configuration properties.
 *
 * <p>Tests that the application context starts successfully with the single
 * API base URL configuration (no uiAndFileBaseUrl).</p>
 */
@SpringBootTest
@TestPropertySource(properties = {
    "archtool.confluence.api-base-url=https://api.atlassian.com/ex/confluence/12345/wiki",
    "archtool.confluence.username=test-user",
    "archtool.confluence.api-token=test-token"
})
class ApplicationContextTest {

    @Autowired
    private ConfluenceProperties confluenceProperties;

    @Test
    @DisplayName("Application context loads with valid configuration")
    void applicationContextLoadsWithValidConfiguration() {
        // Then: Properties should be loaded and bound correctly
        assertNotNull(confluenceProperties, "ConfluenceProperties should be autowired");
        assertEquals("https://api.atlassian.com/ex/confluence/12345/wiki", confluenceProperties.apiBaseUrl());
        assertEquals("test-user", confluenceProperties.username());
        assertEquals("test-token", confluenceProperties.apiToken());

        // Verify defaults are applied (since we didn't specify them in properties)
        assertTrue(confluenceProperties.connectTimeoutMs() > 0, "connectTimeoutMs should have a positive value");
        assertTrue(confluenceProperties.readTimeoutMs() > 0, "readTimeoutMs should have a positive value");
        assertTrue(confluenceProperties.maxPageDepth() > 0, "maxPageDepth should have a positive value");
    }
}
