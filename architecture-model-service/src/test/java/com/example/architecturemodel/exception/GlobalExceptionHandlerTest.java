package com.example.architecturemodel.exception;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for GlobalExceptionHandler.
 *
 * Spec 2026-01-22: Session-Backed Active Project
 *
 * Tests the exception handler for NoResourceFoundException which returns HTTP 404
 * with the standard JSON error response structure.
 */
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    @DisplayName("NoResourceFoundException returns HTTP 404 with correct JSON structure")
    void testNoResourceFoundExceptionReturns404WithCorrectStructure() {
        // Given
        NoResourceFoundException exception = new NoResourceFoundException(HttpMethod.GET, "/api/projects/active");

        // When
        ResponseEntity<Map<String, Object>> response = handler.handleNoResourceFoundException(exception);

        // Then
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody()).containsKey("timestamp");
        assertThat(response.getBody()).containsKey("status");
        assertThat(response.getBody()).containsKey("error");
        assertThat(response.getBody()).containsKey("message");
    }

    @Test
    @DisplayName("NoResourceFoundException response contains status=404, error='Not Found', message from exception")
    void testNoResourceFoundExceptionResponseContainsCorrectValues() {
        // Given
        NoResourceFoundException exception = new NoResourceFoundException(HttpMethod.GET, "/api/projects/active");

        // When
        ResponseEntity<Map<String, Object>> response = handler.handleNoResourceFoundException(exception);

        // Then
        Map<String, Object> body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("status")).isEqualTo(404);
        assertThat(body.get("error")).isEqualTo("Not Found");
        assertThat(body.get("message")).isEqualTo(exception.getMessage());
        assertThat(body.get("timestamp")).isNotNull();
    }
}
