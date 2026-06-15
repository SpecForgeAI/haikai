package com.example.archtool.exception;

/**
 * Exception thrown when parsing a draw.io diagram fails.
 *
 * <p>This exception captures information about which diagram failed to parse
 * and the specific error that occurred, allowing for detailed error reporting
 * while maintaining graceful degradation (other diagrams can still be processed).</p>
 *
 * <p>Common parsing errors:</p>
 * <ul>
 *   <li>Invalid or malformed XML</li>
 *   <li>Missing required elements (mxfile, diagram, mxGraphModel)</li>
 *   <li>Encoding/decompression failures</li>
 *   <li>Unexpected XML structure</li>
 * </ul>
 */
public class DiagramParsingException extends RuntimeException {

    private final String diagramSource;
    private final String parseError;

    /**
     * Creates a new DiagramParsingException with source and error information.
     *
     * @param diagramSource identifies which diagram failed (e.g., "pageId/attachmentId/filename")
     * @param parseError    describes what went wrong during parsing
     */
    public DiagramParsingException(String diagramSource, String parseError) {
        super(formatMessage(diagramSource, parseError));
        this.diagramSource = diagramSource;
        this.parseError = parseError;
    }

    /**
     * Creates a new DiagramParsingException with source, error, and underlying cause.
     *
     * @param diagramSource identifies which diagram failed (e.g., "pageId/attachmentId/filename")
     * @param parseError    describes what went wrong during parsing
     * @param cause         the underlying exception that caused the parsing failure
     */
    public DiagramParsingException(String diagramSource, String parseError, Throwable cause) {
        super(formatMessage(diagramSource, parseError), cause);
        this.diagramSource = diagramSource;
        this.parseError = parseError;
    }

    /**
     * Returns the identifier of the diagram that failed to parse.
     *
     * <p>This typically includes the page ID, attachment ID, and/or filename
     * to help identify which diagram in a batch operation failed.</p>
     *
     * @return the diagram source identifier
     */
    public String getDiagramSource() {
        return diagramSource;
    }

    /**
     * Returns the specific error that occurred during parsing.
     *
     * @return the parse error description
     */
    public String getParseError() {
        return parseError;
    }

    /**
     * Formats the exception message to include both source and error information.
     *
     * @param diagramSource the diagram source identifier
     * @param parseError    the parse error description
     * @return a formatted message string
     */
    private static String formatMessage(String diagramSource, String parseError) {
        return String.format("Failed to parse diagram '%s': %s", diagramSource, parseError);
    }
}
