package com.example.archtool.exception;

import com.example.archtool.model.dto.ErrorResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.BindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;

import java.lang.reflect.Method;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Tests for exception handling layer.
 *
 * <p>These tests verify that:
 * <ul>
 *   <li>ConfluenceApiException maps to correct HTTP status based on Confluence error code</li>
 *   <li>DiagramParsingException includes diagram source information</li>
 *   <li>GlobalExceptionHandler returns proper ErrorResponse format</li>
 *   <li>Validation errors return 400 with descriptive message</li>
 * </ul>
 */
class ExceptionHandlingTest {

    private GlobalExceptionHandler exceptionHandler;

    @BeforeEach
    void setUp() {
        exceptionHandler = new GlobalExceptionHandler();
    }

    @Test
    @DisplayName("ConfluenceApiException maps to correct HTTP status based on Confluence error code")
    void confluenceApiExceptionMapsToCorrectHttpStatus() {
        // Test 401 Unauthorized
        ConfluenceApiException unauthorized = new ConfluenceApiException(401, "Invalid credentials");
        assertTrue(unauthorized.isUnauthorized());
        assertFalse(unauthorized.isForbidden());
        assertFalse(unauthorized.isNotFound());
        assertEquals(401, unauthorized.getStatusCode());
        assertEquals("Invalid credentials", unauthorized.getConfluenceError());

        // Test 403 Forbidden
        ConfluenceApiException forbidden = new ConfluenceApiException(403, "Access denied to page");
        assertFalse(forbidden.isUnauthorized());
        assertTrue(forbidden.isForbidden());
        assertFalse(forbidden.isNotFound());
        assertEquals(403, forbidden.getStatusCode());

        // Test 404 Not Found
        ConfluenceApiException notFound = new ConfluenceApiException(404, "Page not found");
        assertFalse(notFound.isUnauthorized());
        assertFalse(notFound.isForbidden());
        assertTrue(notFound.isNotFound());
        assertEquals(404, notFound.getStatusCode());

        // Test 500 Internal Server Error (other status codes)
        ConfluenceApiException serverError = new ConfluenceApiException(500, "Internal server error");
        assertFalse(serverError.isUnauthorized());
        assertFalse(serverError.isForbidden());
        assertFalse(serverError.isNotFound());
        assertEquals(500, serverError.getStatusCode());

        // Test handler mapping
        ResponseEntity<ErrorResponse> response401 = exceptionHandler.handleConfluenceApiException(unauthorized);
        assertEquals(HttpStatus.UNAUTHORIZED, response401.getStatusCode());
        assertEquals(ErrorResponse.UNAUTHORIZED, response401.getBody().error());

        ResponseEntity<ErrorResponse> response403 = exceptionHandler.handleConfluenceApiException(forbidden);
        assertEquals(HttpStatus.FORBIDDEN, response403.getStatusCode());
        assertEquals(ErrorResponse.FORBIDDEN, response403.getBody().error());

        ResponseEntity<ErrorResponse> response404 = exceptionHandler.handleConfluenceApiException(notFound);
        assertEquals(HttpStatus.NOT_FOUND, response404.getStatusCode());
        assertEquals(ErrorResponse.NOT_FOUND, response404.getBody().error());

        ResponseEntity<ErrorResponse> response500 = exceptionHandler.handleConfluenceApiException(serverError);
        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response500.getStatusCode());
        assertEquals(ErrorResponse.INTERNAL_ERROR, response500.getBody().error());
    }

    @Test
    @DisplayName("DiagramParsingException includes diagram source information")
    void diagramParsingExceptionIncludesDiagramSourceInformation() {
        // Given: A diagram parsing exception with source information
        String diagramSource = "page123/attachment456/diagram.drawio";
        String parseError = "Invalid XML: Unclosed tag at line 15";

        // When: Creating the exception
        DiagramParsingException exception = new DiagramParsingException(diagramSource, parseError);

        // Then: Source information is accessible
        assertEquals(diagramSource, exception.getDiagramSource());
        assertEquals(parseError, exception.getParseError());

        // And: The exception message includes both source and error
        assertTrue(exception.getMessage().contains(diagramSource));
        assertTrue(exception.getMessage().contains(parseError));

        // And: Handler returns 500 with details
        ResponseEntity<ErrorResponse> response = exceptionHandler.handleDiagramParsingException(exception);
        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
        assertEquals(ErrorResponse.INTERNAL_ERROR, response.getBody().error());
        assertTrue(response.getBody().message().contains(diagramSource));
    }

    @Test
    @DisplayName("GlobalExceptionHandler returns proper ErrorResponse format")
    void globalExceptionHandlerReturnsProperErrorResponseFormat() {
        // Given: Various exceptions
        ConfluenceApiException confluenceError = new ConfluenceApiException(404, "Page 12345 not found");
        DiagramParsingException parsingError = new DiagramParsingException("test.drawio", "Malformed XML");
        Exception genericError = new RuntimeException("Something went wrong");

        // When: Handling Confluence API exception
        ResponseEntity<ErrorResponse> confluenceResponse = exceptionHandler.handleConfluenceApiException(confluenceError);

        // Then: Response has proper format
        assertNotNull(confluenceResponse.getBody());
        assertNotNull(confluenceResponse.getBody().error());
        assertNotNull(confluenceResponse.getBody().message());
        assertNotNull(confluenceResponse.getBody().timestamp());
        assertEquals(ErrorResponse.NOT_FOUND, confluenceResponse.getBody().error());
        assertEquals("Page 12345 not found", confluenceResponse.getBody().message());

        // When: Handling diagram parsing exception
        ResponseEntity<ErrorResponse> parsingResponse = exceptionHandler.handleDiagramParsingException(parsingError);

        // Then: Response has proper format
        assertNotNull(parsingResponse.getBody());
        assertEquals(ErrorResponse.INTERNAL_ERROR, parsingResponse.getBody().error());
        assertNotNull(parsingResponse.getBody().timestamp());

        // When: Handling generic exception
        ResponseEntity<ErrorResponse> genericResponse = exceptionHandler.handleGenericException(genericError);

        // Then: Response has proper format with safe message
        assertNotNull(genericResponse.getBody());
        assertEquals(ErrorResponse.INTERNAL_ERROR, genericResponse.getBody().error());
        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, genericResponse.getStatusCode());
        // Generic handler should return safe message, not expose internal details
        assertNotNull(genericResponse.getBody().message());
        assertNotNull(genericResponse.getBody().timestamp());
    }

    @Test
    @DisplayName("Validation errors return 400 with descriptive message")
    void validationErrorsReturn400WithDescriptiveMessage() throws NoSuchMethodException {
        // Given: A MethodArgumentNotValidException with field errors
        // We need a real MethodParameter to avoid NPE, so we use a dummy method
        Method dummyMethod = this.getClass().getDeclaredMethod("dummyMethodForTest", String.class);
        org.springframework.core.MethodParameter methodParameter =
            new org.springframework.core.MethodParameter(dummyMethod, 0);

        BindingResult bindingResult = mock(BindingResult.class);

        FieldError fieldError1 = new FieldError("request", "pageId", "pageId is required");
        FieldError fieldError2 = new FieldError("request", "maxDepth", "maxDepth must be positive");

        when(bindingResult.getFieldErrors()).thenReturn(List.of(fieldError1, fieldError2));

        MethodArgumentNotValidException validationException = new MethodArgumentNotValidException(
            methodParameter, bindingResult
        );

        // When: Handling the validation exception
        ResponseEntity<ErrorResponse> response = exceptionHandler.handleValidationException(validationException);

        // Then: Returns 400 BAD_REQUEST
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(ErrorResponse.BAD_REQUEST, response.getBody().error());

        // And: Message contains field error descriptions
        String message = response.getBody().message();
        assertNotNull(message);
        assertTrue(message.contains("pageId") && message.contains("pageId is required"),
            "Message should contain pageId error: " + message);
        assertTrue(message.contains("maxDepth") && message.contains("maxDepth must be positive"),
            "Message should contain maxDepth error: " + message);

        // And: Timestamp is present
        assertNotNull(response.getBody().timestamp());
    }

    /**
     * Dummy method used to create a real MethodParameter for testing.
     * This avoids NPE when MethodArgumentNotValidException.getMessage() is called.
     */
    @SuppressWarnings("unused")
    private void dummyMethodForTest(String param) {
        // This method exists only to provide a real Method object for testing
    }
}
