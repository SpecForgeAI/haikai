package com.example.archtool.exception;

import com.example.archtool.model.dto.ErrorResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.stream.Collectors;

/**
 * Global exception handler for the REST API.
 *
 * <p>This handler intercepts exceptions thrown by controllers and services,
 * mapping them to appropriate HTTP responses with consistent error format.</p>
 *
 * <p>HTTP status mapping:</p>
 * <ul>
 *   <li>400 BAD_REQUEST - Validation errors, invalid parameters</li>
 *   <li>401 UNAUTHORIZED - Invalid Confluence credentials</li>
 *   <li>403 FORBIDDEN - No permission to access Confluence resource</li>
 *   <li>404 NOT_FOUND - Confluence page or attachment not found</li>
 *   <li>500 INTERNAL_SERVER_ERROR - Parsing failures, unexpected errors</li>
 * </ul>
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /**
     * Handles ConfluenceApiException and maps to appropriate HTTP status.
     *
     * @param ex the Confluence API exception
     * @return ResponseEntity with ErrorResponse and appropriate HTTP status
     */
    @ExceptionHandler(ConfluenceApiException.class)
    public ResponseEntity<ErrorResponse> handleConfluenceApiException(ConfluenceApiException ex) {
        log.warn("Confluence API error: status={}, message={}", ex.getStatusCode(), ex.getConfluenceError());

        HttpStatus status;
        String errorCode;

        if (ex.isUnauthorized()) {
            status = HttpStatus.UNAUTHORIZED;
            errorCode = ErrorResponse.UNAUTHORIZED;
        } else if (ex.isForbidden()) {
            status = HttpStatus.FORBIDDEN;
            errorCode = ErrorResponse.FORBIDDEN;
        } else if (ex.isNotFound()) {
            status = HttpStatus.NOT_FOUND;
            errorCode = ErrorResponse.NOT_FOUND;
        } else {
            status = HttpStatus.INTERNAL_SERVER_ERROR;
            errorCode = ErrorResponse.INTERNAL_ERROR;
        }

        ErrorResponse errorResponse = ErrorResponse.of(errorCode, ex.getConfluenceError());
        return ResponseEntity.status(status).body(errorResponse);
    }

    /**
     * Handles DiagramParsingException and returns 500 with details.
     *
     * @param ex the diagram parsing exception
     * @return ResponseEntity with ErrorResponse and 500 status
     */
    @ExceptionHandler(DiagramParsingException.class)
    public ResponseEntity<ErrorResponse> handleDiagramParsingException(DiagramParsingException ex) {
        log.error("Diagram parsing error: source={}, error={}", ex.getDiagramSource(), ex.getParseError(), ex);

        String message = String.format("Failed to parse diagram '%s': %s",
            ex.getDiagramSource(), ex.getParseError());

        ErrorResponse errorResponse = ErrorResponse.of(ErrorResponse.INTERNAL_ERROR, message);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
    }

    /**
     * Handles validation errors from @Valid annotated parameters.
     *
     * @param ex the validation exception
     * @return ResponseEntity with ErrorResponse and 400 status
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidationException(MethodArgumentNotValidException ex) {
        // Extract field errors to build the message
        String message = ex.getBindingResult().getFieldErrors().stream()
            .map(error -> error.getField() + ": " + error.getDefaultMessage())
            .collect(Collectors.joining("; "));

        if (message.isEmpty()) {
            message = "Validation failed";
        }

        log.warn("Validation error: {}", message);

        ErrorResponse errorResponse = ErrorResponse.of(ErrorResponse.BAD_REQUEST, message);
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorResponse);
    }

    /**
     * Handles all other unexpected exceptions.
     *
     * <p>This handler ensures that internal implementation details are not
     * exposed to API consumers. A generic error message is returned while
     * the full exception is logged for debugging.</p>
     *
     * @param ex the unexpected exception
     * @return ResponseEntity with ErrorResponse and 500 status
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGenericException(Exception ex) {
        log.error("Unexpected error occurred", ex);

        // Return a safe, generic message to avoid exposing internal details
        ErrorResponse errorResponse = ErrorResponse.of(
            ErrorResponse.INTERNAL_ERROR,
            "An unexpected error occurred while processing the request"
        );
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
    }
}
