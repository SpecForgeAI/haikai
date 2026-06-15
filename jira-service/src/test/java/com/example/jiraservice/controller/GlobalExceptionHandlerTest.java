package com.example.jiraservice.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.ResourceAccessException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for {@link GlobalExceptionHandler}.
 *
 * <p>Verifies that Jira API errors and network failures are caught and
 * returned with appropriate HTTP status codes and structured JSON bodies.</p>
 */
class GlobalExceptionHandlerTest {

    private GlobalExceptionHandler exceptionHandler;

    @BeforeEach
    void setUp() {
        exceptionHandler = new GlobalExceptionHandler();
    }

    // ---- Test 6 (unit): Jira API 4xx error is caught and returned with upstream status code ----

    @Test
    @DisplayName("Jira API 4xx error is caught and returned with upstream status code")
    void jiraApi4xxErrorReturnedWithUpstreamStatusCode() {
        // Arrange
        HttpClientErrorException ex = HttpClientErrorException.create(
            HttpStatus.FORBIDDEN,
            "Forbidden",
            HttpHeaders.EMPTY,
            "Access denied".getBytes(StandardCharsets.UTF_8),
            StandardCharsets.UTF_8
        );

        // Act
        ResponseEntity<Map<String, Object>> response = exceptionHandler.handleHttpClientError(ex);

        // Assert
        assertEquals(403, response.getStatusCode().value(),
            "Response status code must match the upstream Jira error status");
        assertNotNull(response.getBody());
        assertEquals(403, response.getBody().get("status"),
            "Body 'status' field must match the upstream status code");
        assertEquals("Forbidden", response.getBody().get("error"),
            "Body 'error' field must contain the status text");
        assertNotNull(response.getBody().get("message"),
            "Body must contain a 'message' field");
    }

    // ---- Test 7 (unit): Network timeout to Jira returns 503 with descriptive message ----

    @Test
    @DisplayName("Network timeout to Jira returns 503 with descriptive message")
    void networkTimeoutReturns503WithDescriptiveMessage() {
        // Arrange
        ResourceAccessException ex = new ResourceAccessException(
            "I/O error on GET request for \"https://test-jira.atlassian.net/rest/api/3/search\": Read timed out",
            new IOException("Read timed out")
        );

        // Act
        ResponseEntity<Map<String, Object>> response = exceptionHandler.handleResourceAccessException(ex);

        // Assert
        assertEquals(503, response.getStatusCode().value(),
            "Response status code must be 503 Service Unavailable");
        assertNotNull(response.getBody());
        assertEquals(503, response.getBody().get("status"),
            "Body 'status' field must be 503");
        assertEquals("Service Unavailable", response.getBody().get("error"),
            "Body 'error' field must be 'Service Unavailable'");
        String message = (String) response.getBody().get("message");
        assertNotNull(message, "Body must contain a 'message' field");
        assertTrue(message.contains("Unable to connect to Jira Cloud"),
            "Message must contain descriptive text about Jira connectivity failure");
    }
}
