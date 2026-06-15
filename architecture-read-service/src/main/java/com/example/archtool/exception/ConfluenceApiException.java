package com.example.archtool.exception;

/**
 * Exception thrown when Confluence API returns an error response.
 *
 * <p>This exception captures the HTTP status code and error message from
 * the Confluence API response, allowing the global exception handler to
 * map it to an appropriate HTTP response for the client.</p>
 *
 * <p>Common HTTP status codes from Confluence:</p>
 * <ul>
 *   <li>401 - Invalid credentials or expired token</li>
 *   <li>403 - User does not have permission to access the resource</li>
 *   <li>404 - Page or resource not found</li>
 *   <li>500 - Confluence server error</li>
 * </ul>
 */
public class ConfluenceApiException extends RuntimeException {

    private final int statusCode;
    private final String confluenceError;

    /**
     * Creates a new ConfluenceApiException with the given HTTP status and error message.
     *
     * @param statusCode      the HTTP status code from the Confluence response
     * @param confluenceError the error message from Confluence (or a descriptive message)
     */
    public ConfluenceApiException(int statusCode, String confluenceError) {
        super(confluenceError);
        this.statusCode = statusCode;
        this.confluenceError = confluenceError;
    }

    /**
     * Creates a new ConfluenceApiException with the given HTTP status, error message, and cause.
     *
     * @param statusCode      the HTTP status code from the Confluence response
     * @param confluenceError the error message from Confluence (or a descriptive message)
     * @param cause           the underlying exception that caused this error
     */
    public ConfluenceApiException(int statusCode, String confluenceError, Throwable cause) {
        super(confluenceError, cause);
        this.statusCode = statusCode;
        this.confluenceError = confluenceError;
    }

    /**
     * Returns the HTTP status code from the Confluence response.
     *
     * @return the HTTP status code
     */
    public int getStatusCode() {
        return statusCode;
    }

    /**
     * Returns the error message from the Confluence response.
     *
     * @return the error message
     */
    public String getConfluenceError() {
        return confluenceError;
    }

    /**
     * Checks if this exception represents a 404 Not Found response.
     *
     * @return true if the status code is 404
     */
    public boolean isNotFound() {
        return statusCode == 404;
    }

    /**
     * Checks if this exception represents a 401 Unauthorized response.
     *
     * @return true if the status code is 401
     */
    public boolean isUnauthorized() {
        return statusCode == 401;
    }

    /**
     * Checks if this exception represents a 403 Forbidden response.
     *
     * @return true if the status code is 403
     */
    public boolean isForbidden() {
        return statusCode == 403;
    }
}
