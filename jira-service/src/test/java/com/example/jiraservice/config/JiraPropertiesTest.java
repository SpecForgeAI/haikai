package com.example.jiraservice.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for {@link JiraProperties}.
 *
 * Verifies compact constructor validation, timeout defaulting,
 * and AuthMode enum resolution.
 */
class JiraPropertiesTest {

    @Test
    @DisplayName("Null baseUrl throws NullPointerException")
    void nullBaseUrlThrowsNullPointerException() {
        assertThrows(NullPointerException.class,
            () -> new JiraProperties(
                null,
                JiraProperties.AuthMode.BEARER,
                "token",
                "user",
                "api-token",
                5000,
                30000,
                Map.of(),
                Map.of(),
                Map.of()
            ),
            "Null baseUrl must throw NullPointerException");
    }

    @Test
    @DisplayName("Non-positive timeouts default to 5000 and 30000")
    void nonPositiveTimeoutsDefaultToStandardValues() {
        JiraProperties props = new JiraProperties(
            "https://example.atlassian.net",
            JiraProperties.AuthMode.BEARER,
            "token",
            "user",
            "api-token",
            0,    // non-positive connect timeout
            -1,   // non-positive read timeout
            Map.of(),
            Map.of(),
            Map.of()
        );

        assertEquals(JiraProperties.DEFAULT_CONNECT_TIMEOUT_MS, props.connectTimeoutMs(),
            "Non-positive connectTimeoutMs should default to " + JiraProperties.DEFAULT_CONNECT_TIMEOUT_MS);
        assertEquals(JiraProperties.DEFAULT_READ_TIMEOUT_MS, props.readTimeoutMs(),
            "Non-positive readTimeoutMs should default to " + JiraProperties.DEFAULT_READ_TIMEOUT_MS);
    }

    @Test
    @DisplayName("AuthMode BEARER and BASIC enum values exist and are resolved")
    void authModeBearerAndBasicEnumValuesExist() {
        // Verify BEARER
        JiraProperties bearerProps = new JiraProperties(
            "https://example.atlassian.net",
            JiraProperties.AuthMode.BEARER,
            "my-bearer-token",
            null,
            null,
            5000,
            30000,
            Map.of(),
            Map.of(),
            Map.of()
        );
        assertEquals(JiraProperties.AuthMode.BEARER, bearerProps.authMode(),
            "AuthMode should be BEARER");

        // Verify BASIC
        JiraProperties basicProps = new JiraProperties(
            "https://example.atlassian.net",
            JiraProperties.AuthMode.BASIC,
            null,
            "user@example.com",
            "api-token-123",
            5000,
            30000,
            Map.of(),
            Map.of(),
            Map.of()
        );
        assertEquals(JiraProperties.AuthMode.BASIC, basicProps.authMode(),
            "AuthMode should be BASIC");

        // Verify valueOf resolution
        assertEquals(JiraProperties.AuthMode.BEARER, JiraProperties.AuthMode.valueOf("BEARER"));
        assertEquals(JiraProperties.AuthMode.BASIC, JiraProperties.AuthMode.valueOf("BASIC"));

        // Verify all enum values are exactly BEARER and BASIC
        JiraProperties.AuthMode[] values = JiraProperties.AuthMode.values();
        assertEquals(2, values.length, "AuthMode should have exactly 2 values");
    }
}
