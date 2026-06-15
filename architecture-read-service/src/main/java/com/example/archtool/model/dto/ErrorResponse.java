package com.example.archtool.model.dto;

import java.time.Instant;

/**
 * Standard error response for all API errors.
 *
 * <p>This DTO provides a consistent error response format across all
 * error conditions, including validation errors, authentication failures,
 * and internal server errors.</p>
 *
 * @param error     the error code (e.g., "BAD_REQUEST", "UNAUTHORIZED", "NOT_FOUND")
 * @param message   a human-readable description of the error
 * @param timestamp the timestamp when the error occurred
 */
public record ErrorResponse(
    String error,
    String message,
    Instant timestamp
) {

    /** Error code for bad request (400) */
    public static final String BAD_REQUEST = "BAD_REQUEST";

    /** Error code for unauthorized access (401) */
    public static final String UNAUTHORIZED = "UNAUTHORIZED";

    /** Error code for forbidden access (403) */
    public static final String FORBIDDEN = "FORBIDDEN";

    /** Error code for resource not found (404) */
    public static final String NOT_FOUND = "NOT_FOUND";

    /** Error code for internal server error (500) */
    public static final String INTERNAL_ERROR = "INTERNAL_ERROR";

    /**
     * Creates an error response with the current timestamp.
     *
     * @param error   the error code
     * @param message the error message
     * @return a new ErrorResponse with the current timestamp
     */
    public static ErrorResponse of(String error, String message) {
        return new ErrorResponse(error, message, Instant.now());
    }
}
