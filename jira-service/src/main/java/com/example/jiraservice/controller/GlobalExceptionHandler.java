package com.example.jiraservice.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Global exception handler for the Jira Service REST API.
 *
 * <p>Provides consistent structured JSON error responses across all controller
 * endpoints. Handles upstream Jira API errors, network failures, and
 * validation errors with appropriate HTTP status codes.</p>
 */
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    /**
     * Handles HTTP 4xx client errors from the Jira REST API.
     *
     * <p>Forwards the upstream status code and includes a structured error response
     * with the original error details from Jira Cloud.</p>
     *
     * @param ex the client error exception from RestClient
     * @return ResponseEntity with the upstream status code and structured error body
     */
    @ExceptionHandler(HttpClientErrorException.class)
    public ResponseEntity<Map<String, Object>> handleHttpClientError(HttpClientErrorException ex) {
        log.warn("Jira API client error: {} {}", ex.getStatusCode(), ex.getMessage());
        return buildErrorResponse(
            ex.getStatusCode().value(),
            ex.getStatusText(),
            "Jira API client error: " + ex.getMessage()
        );
    }

    /**
     * Handles HTTP 5xx server errors from the Jira REST API.
     *
     * <p>Forwards the upstream status code and includes a structured error response.</p>
     *
     * @param ex the server error exception from RestClient
     * @return ResponseEntity with the upstream status code and structured error body
     */
    @ExceptionHandler(HttpServerErrorException.class)
    public ResponseEntity<Map<String, Object>> handleHttpServerError(HttpServerErrorException ex) {
        log.error("Jira API server error: {} {}", ex.getStatusCode(), ex.getMessage());
        return buildErrorResponse(
            ex.getStatusCode().value(),
            ex.getStatusText(),
            "Jira API server error: " + ex.getMessage()
        );
    }

    /**
     * Handles network timeouts and connection failures to Jira Cloud.
     *
     * <p>Returns HTTP 503 Service Unavailable with a descriptive message
     * when the service cannot reach Jira Cloud.</p>
     *
     * @param ex the resource access exception indicating network failure
     * @return ResponseEntity with HTTP 503 and structured error body
     */
    @ExceptionHandler(ResourceAccessException.class)
    public ResponseEntity<Map<String, Object>> handleResourceAccessException(ResourceAccessException ex) {
        log.error("Unable to connect to Jira Cloud: {}", ex.getMessage());
        return buildErrorResponse(
            HttpStatus.SERVICE_UNAVAILABLE.value(),
            "Service Unavailable",
            "Unable to connect to Jira Cloud: " + ex.getMessage()
        );
    }

    /**
     * Handles illegal argument exceptions for missing or blank required parameters.
     *
     * <p>Returns HTTP 400 Bad Request with a descriptive message.</p>
     *
     * @param ex the illegal argument exception with validation details
     * @return ResponseEntity with HTTP 400 and structured error body
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalArgumentException(IllegalArgumentException ex) {
        log.warn("Bad request: {}", ex.getMessage());
        return buildErrorResponse(
            HttpStatus.BAD_REQUEST.value(),
            "Bad Request",
            ex.getMessage()
        );
    }

    /**
     * Builds a consistent structured error response.
     *
     * @param status  the HTTP status code
     * @param error   the error type description
     * @param message the detailed error message
     * @return ResponseEntity with the structured error body
     */
    private ResponseEntity<Map<String, Object>> buildErrorResponse(int status, String error, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", error);
        body.put("status", status);
        body.put("message", message);
        return ResponseEntity.status(status).body(body);
    }
}
