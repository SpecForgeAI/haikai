package com.example.architecturemodel.util;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for FilenameSanitizer utility class.
 * Verifies filename sanitization and path traversal detection.
 */
class FilenameSanitizerTest {

    @TempDir
    Path tempDir;

    /**
     * Test 1: Sanitization of normal names (should remain unchanged or minimally changed)
     */
    @Test
    void testSanitizationOfNormalNames() {
        // Simple name without special characters
        assertEquals("Order API", FilenameSanitizer.sanitize("Order API"));

        // Name with spaces
        assertEquals("Customer Service", FilenameSanitizer.sanitize("Customer Service"));

        // Name with numbers
        assertEquals("API-v2", FilenameSanitizer.sanitize("API-v2"));

        // Name with underscores
        assertEquals("my_interface", FilenameSanitizer.sanitize("my_interface"));

        // Name with dots
        assertEquals("api.v1.service", FilenameSanitizer.sanitize("api.v1.service"));
    }

    /**
     * Test 2: Replacement of invalid characters with dash
     */
    @Test
    void testReplacementOfInvalidCharacters() {
        // Forward slash
        assertEquals("path-to-api", FilenameSanitizer.sanitize("path/to/api"));

        // Backslash
        assertEquals("path-to-api", FilenameSanitizer.sanitize("path\\to\\api"));

        // Colon
        assertEquals("API-v1", FilenameSanitizer.sanitize("API:v1"));

        // Asterisk
        assertEquals("file-name", FilenameSanitizer.sanitize("file*name"));

        // Question mark
        assertEquals("query-param", FilenameSanitizer.sanitize("query?param"));

        // Double quotes
        assertEquals("quoted-name", FilenameSanitizer.sanitize("quoted\"name"));

        // Less than and greater than
        assertEquals("tag-content-tag", FilenameSanitizer.sanitize("<tag>content</tag>"));

        // Pipe
        assertEquals("option-choice", FilenameSanitizer.sanitize("option|choice"));

        // Multiple invalid characters
        assertEquals("complex-name", FilenameSanitizer.sanitize("complex<>|:name"));
    }

    /**
     * Test 3: Collapse of multiple consecutive dashes
     */
    @Test
    void testCollapseMultipleConsecutiveDashes() {
        // Double dash
        assertEquals("a-b", FilenameSanitizer.sanitize("a--b"));

        // Triple dash
        assertEquals("a-b", FilenameSanitizer.sanitize("a---b"));

        // Many dashes
        assertEquals("a-b", FilenameSanitizer.sanitize("a------b"));

        // Dashes from replaced characters
        assertEquals("path-to-api", FilenameSanitizer.sanitize("path//to//api"));

        // Mixed invalid characters creating dashes
        assertEquals("a-b-c", FilenameSanitizer.sanitize("a:<>b|?c"));
    }

    /**
     * Test 4: Trim leading/trailing dashes and whitespace
     */
    @Test
    void testTrimLeadingTrailingDashesAndWhitespace() {
        // Leading whitespace
        assertEquals("test", FilenameSanitizer.sanitize("  test"));

        // Trailing whitespace
        assertEquals("test", FilenameSanitizer.sanitize("test  "));

        // Leading dash (from replaced character)
        assertEquals("api", FilenameSanitizer.sanitize("/api"));

        // Trailing dash (from replaced character)
        assertEquals("api", FilenameSanitizer.sanitize("api/"));

        // Both leading and trailing
        assertEquals("api", FilenameSanitizer.sanitize("  /api/  "));

        // Multiple leading dashes
        assertEquals("api", FilenameSanitizer.sanitize("///api"));

        // Mixed
        assertEquals("my-api", FilenameSanitizer.sanitize("  --my-api--  "));
    }

    /**
     * Test 5: Empty result after sanitization throws exception
     */
    @Test
    void testEmptyResultAfterSanitizationThrowsException() {
        // All invalid characters
        IllegalArgumentException ex1 = assertThrows(
            IllegalArgumentException.class,
            () -> FilenameSanitizer.sanitize("//\\\\")
        );
        assertTrue(ex1.getMessage().contains("cannot be sanitized to a valid filename"));

        // Only special characters that become dashes then get trimmed
        IllegalArgumentException ex2 = assertThrows(
            IllegalArgumentException.class,
            () -> FilenameSanitizer.sanitize(":*?\"<>|")
        );
        assertTrue(ex2.getMessage().contains("cannot be sanitized to a valid filename"));

        // Null input
        IllegalArgumentException ex3 = assertThrows(
            IllegalArgumentException.class,
            () -> FilenameSanitizer.sanitize(null)
        );
        assertTrue(ex3.getMessage().contains("null or empty"));

        // Empty string
        IllegalArgumentException ex4 = assertThrows(
            IllegalArgumentException.class,
            () -> FilenameSanitizer.sanitize("")
        );
        assertTrue(ex4.getMessage().contains("null or empty"));

        // Only whitespace
        IllegalArgumentException ex5 = assertThrows(
            IllegalArgumentException.class,
            () -> FilenameSanitizer.sanitize("   ")
        );
        assertTrue(ex5.getMessage().contains("null or empty"));
    }

    /**
     * Test 6: Path traversal detection (names containing '..')
     */
    @Test
    void testPathTraversalDetection() {
        // Direct path traversal attempt in input
        IllegalArgumentException ex1 = assertThrows(
            IllegalArgumentException.class,
            () -> FilenameSanitizer.sanitize("..\\secret")
        );
        assertTrue(ex1.getMessage().contains("path traversal"));

        IllegalArgumentException ex2 = assertThrows(
            IllegalArgumentException.class,
            () -> FilenameSanitizer.sanitize("../etc/passwd")
        );
        assertTrue(ex2.getMessage().contains("path traversal"));

        // Hidden traversal
        IllegalArgumentException ex3 = assertThrows(
            IllegalArgumentException.class,
            () -> FilenameSanitizer.sanitize("test/../../../etc")
        );
        assertTrue(ex3.getMessage().contains("path traversal"));

        // Path validation method
        Path basePath = tempDir.resolve("oas-specs");
        Path validPath = basePath.resolve("my-model").resolve("api.yml");

        // Valid path should not throw
        assertDoesNotThrow(() ->
            FilenameSanitizer.validateNoPathTraversal(basePath, validPath)
        );

        // Invalid path (escaping base) should throw
        Path escapingPath = basePath.resolve("..").resolve("secret").resolve("file.txt");
        IllegalArgumentException ex4 = assertThrows(
            IllegalArgumentException.class,
            () -> FilenameSanitizer.validateNoPathTraversal(basePath, escapingPath)
        );
        assertTrue(ex4.getMessage().contains("path escapes base directory"));
    }

    /**
     * Test: validateNoPathTraversal with null paths
     */
    @Test
    void testValidateNoPathTraversalWithNullPaths() {
        Path validPath = tempDir.resolve("test.txt");

        IllegalArgumentException ex1 = assertThrows(
            IllegalArgumentException.class,
            () -> FilenameSanitizer.validateNoPathTraversal(null, validPath)
        );
        assertTrue(ex1.getMessage().contains("Paths cannot be null"));

        IllegalArgumentException ex2 = assertThrows(
            IllegalArgumentException.class,
            () -> FilenameSanitizer.validateNoPathTraversal(tempDir, null)
        );
        assertTrue(ex2.getMessage().contains("Paths cannot be null"));
    }
}
