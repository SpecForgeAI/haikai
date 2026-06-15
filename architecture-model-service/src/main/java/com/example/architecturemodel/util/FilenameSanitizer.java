package com.example.architecturemodel.util;

import java.nio.file.Path;

/**
 * Utility class for sanitizing filenames to ensure safe filesystem operations.
 * Provides methods to sanitize input strings and validate paths against traversal attacks.
 */
public final class FilenameSanitizer {

    /**
     * Characters that are invalid in filenames on most filesystems.
     */
    private static final String INVALID_CHARS_REGEX = "[/\\\\:*?\"<>|]";

    /**
     * Pattern for collapsing multiple consecutive dashes.
     */
    private static final String MULTIPLE_DASHES_REGEX = "-{2,}";

    /**
     * Pattern for leading/trailing dashes.
     */
    private static final String LEADING_TRAILING_DASHES_REGEX = "^-+|-+$";

    private FilenameSanitizer() {
        // Utility class, prevent instantiation
    }

    /**
     * Sanitizes an input string to create a safe filename.
     * <p>
     * Sanitization rules:
     * <ul>
     *   <li>Replace invalid characters ({@code / \ : * ? " < > |}) with {@code -}</li>
     *   <li>Trim leading/trailing whitespace</li>
     *   <li>Collapse multiple consecutive {@code -} into single {@code -}</li>
     *   <li>Trim leading/trailing {@code -}</li>
     * </ul>
     *
     * @param input the input string to sanitize
     * @return the sanitized filename
     * @throws IllegalArgumentException if the input is null, empty, or results in an empty filename after sanitization
     */
    public static String sanitize(String input) {
        if (input == null || input.trim().isEmpty()) {
            throw new IllegalArgumentException("Input cannot be null or empty");
        }

        // Check for path traversal patterns in input
        if (input.contains("..")) {
            throw new IllegalArgumentException("Input contains path traversal pattern");
        }

        // Replace invalid characters with dash
        String sanitized = input.replaceAll(INVALID_CHARS_REGEX, "-");

        // Trim whitespace
        sanitized = sanitized.trim();

        // Collapse multiple consecutive dashes
        sanitized = sanitized.replaceAll(MULTIPLE_DASHES_REGEX, "-");

        // Trim leading/trailing dashes
        sanitized = sanitized.replaceAll(LEADING_TRAILING_DASHES_REGEX, "");

        // Final whitespace trim in case dash removal left any
        sanitized = sanitized.trim();

        // Check if result is empty
        if (sanitized.isEmpty()) {
            throw new IllegalArgumentException("Interface name cannot be sanitized to a valid filename");
        }

        return sanitized;
    }

    /**
     * Validates that a resolved path does not escape the base path (path traversal prevention).
     * <p>
     * This method normalizes both paths and verifies that the resolved path
     * starts with the base path.
     *
     * @param basePath the base directory path
     * @param resolvedPath the resolved path to validate
     * @throws IllegalArgumentException if the resolved path escapes the base path
     */
    public static void validateNoPathTraversal(Path basePath, Path resolvedPath) {
        if (basePath == null || resolvedPath == null) {
            throw new IllegalArgumentException("Paths cannot be null");
        }

        Path normalizedBase = basePath.toAbsolutePath().normalize();
        Path normalizedResolved = resolvedPath.toAbsolutePath().normalize();

        if (!normalizedResolved.startsWith(normalizedBase)) {
            throw new IllegalArgumentException("Path traversal detected: resolved path escapes base directory");
        }
    }
}
