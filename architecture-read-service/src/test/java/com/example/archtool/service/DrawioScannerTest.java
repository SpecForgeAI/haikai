package com.example.archtool.service;

import com.example.archtool.model.confluence.ConfluenceAttachment;
import com.example.archtool.model.confluence.ConfluencePage;
import com.example.archtool.model.internal.DrawioDiagramSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for DrawioScanner service.
 *
 * <p>These tests verify the scanner's ability to:</p>
 * <ul>
 *     <li>Find draw.io macros in Confluence page body</li>
 *     <li>Extract diagramName parameters from macros</li>
 *     <li>Match macro references to .drawio attachments</li>
 *     <li>Discover .drawio attachments not referenced by macros</li>
 *     <li>Handle pages with no draw.io content</li>
 * </ul>
 */
class DrawioScannerTest {

    private DrawioScanner scanner;

    @BeforeEach
    void setUp() {
        scanner = new DrawioScanner();
    }

    /**
     * Test 1: Finding draw.io macro in Confluence page body
     *
     * Verifies that the scanner can detect draw.io structured macros
     * in the Confluence page body storage format.
     */
    @Test
    @DisplayName("Should find draw.io macro in Confluence page body")
    void shouldFindDrawioMacroInPageBody() throws IOException {
        // Given
        String pageBody = loadTestResource("test-confluence-html/page-with-drawio-macro.html");
        ConfluencePage page = new ConfluencePage("123", "Test Page", pageBody, 1);

        List<ConfluenceAttachment> attachments = List.of(
            new ConfluenceAttachment("att-001", "system-architecture.drawio",
                "/download/attachments/123/system-architecture.drawio", "application/octet-stream")
        );

        // When
        List<DrawioDiagramSource> sources = scanner.scanPage(page, attachments);

        // Then
        assertFalse(sources.isEmpty(), "Should find at least one diagram source");
        assertEquals(1, sources.size(), "Should find exactly one diagram source");

        DrawioDiagramSource source = sources.get(0);
        assertEquals("att-001", source.attachmentId());
        assertEquals("system-architecture.drawio", source.attachmentFileName());
        assertTrue(source.referencedByMacro(), "Source should be marked as referenced by macro");
    }

    /**
     * Test 2: Extracting diagramName parameter from macro
     *
     * Verifies that the scanner correctly extracts the diagramName parameter
     * from draw.io macro elements.
     */
    @Test
    @DisplayName("Should extract diagramName parameter from macro")
    void shouldExtractDiagramNameParameter() throws IOException {
        // Given
        String pageBody = loadTestResource("test-confluence-html/page-with-multiple-macros.html");

        // When
        List<String> filenames = scanner.extractMacroFilenames(pageBody);

        // Then
        assertEquals(3, filenames.size(), "Should extract 3 diagram names");
        assertTrue(filenames.contains("high-level-architecture.drawio"),
            "Should extract high-level-architecture.drawio");
        assertTrue(filenames.contains("data-flow-diagram.drawio"),
            "Should extract data-flow-diagram.drawio from diagrams.net macro");
        assertTrue(filenames.contains("deployment.xml"),
            "Should extract deployment.xml");
    }

    /**
     * Test 3: Matching macro reference to .drawio attachment
     *
     * Verifies that macro filename references are correctly matched
     * with corresponding attachment files.
     */
    @Test
    @DisplayName("Should match macro reference to .drawio attachment")
    void shouldMatchMacroReferenceToAttachment() throws IOException {
        // Given
        String pageBody = loadTestResource("test-confluence-html/page-with-multiple-macros.html");
        ConfluencePage page = new ConfluencePage("456", "Multi Diagram Page", pageBody, 1);

        List<ConfluenceAttachment> attachments = List.of(
            new ConfluenceAttachment("att-001", "high-level-architecture.drawio",
                "/download/att-001", "application/octet-stream"),
            new ConfluenceAttachment("att-002", "data-flow-diagram.drawio",
                "/download/att-002", "application/octet-stream"),
            new ConfluenceAttachment("att-003", "deployment.xml",
                "/download/att-003", "application/xml"),
            new ConfluenceAttachment("att-004", "unrelated-file.pdf",
                "/download/att-004", "application/pdf")
        );

        // When
        List<DrawioDiagramSource> sources = scanner.scanPage(page, attachments);

        // Then
        assertEquals(3, sources.size(), "Should match 3 macro references to attachments");

        // Verify all matched sources are marked as referenced by macro
        assertTrue(sources.stream().allMatch(DrawioDiagramSource::referencedByMacro),
            "All sources should be marked as referenced by macro");

        // Verify attachment IDs are correctly associated
        assertTrue(sources.stream().anyMatch(s -> s.attachmentId().equals("att-001")));
        assertTrue(sources.stream().anyMatch(s -> s.attachmentId().equals("att-002")));
        assertTrue(sources.stream().anyMatch(s -> s.attachmentId().equals("att-003")));
    }

    /**
     * Test 4: Discovering .drawio attachments not referenced by macros
     *
     * Verifies that the scanner includes .drawio attachment files
     * that exist on the page but are not referenced by any macro.
     */
    @Test
    @DisplayName("Should discover .drawio attachments not referenced by macros")
    void shouldDiscoverOrphanDrawioAttachments() throws IOException {
        // Given
        String pageBody = loadTestResource("test-confluence-html/page-with-drawio-macro.html");
        ConfluencePage page = new ConfluencePage("789", "Page With Orphans", pageBody, 1);

        List<ConfluenceAttachment> attachments = List.of(
            // This one is referenced by the macro
            new ConfluenceAttachment("att-001", "system-architecture.drawio",
                "/download/att-001", "application/octet-stream"),
            // This one is NOT referenced by any macro (orphan)
            new ConfluenceAttachment("att-002", "orphan-diagram.drawio",
                "/download/att-002", "application/octet-stream"),
            // This is not a .drawio file, should be ignored
            new ConfluenceAttachment("att-003", "document.pdf",
                "/download/att-003", "application/pdf")
        );

        // When
        List<DrawioDiagramSource> sources = scanner.scanPage(page, attachments);

        // Then
        assertEquals(2, sources.size(), "Should find 2 diagram sources (1 macro + 1 orphan)");

        // Find the macro-referenced source
        DrawioDiagramSource macroSource = sources.stream()
            .filter(DrawioDiagramSource::referencedByMacro)
            .findFirst()
            .orElseThrow();
        assertEquals("system-architecture.drawio", macroSource.attachmentFileName());

        // Find the orphan source
        DrawioDiagramSource orphanSource = sources.stream()
            .filter(s -> !s.referencedByMacro())
            .findFirst()
            .orElseThrow();
        assertEquals("orphan-diagram.drawio", orphanSource.attachmentFileName());
        assertFalse(orphanSource.referencedByMacro(), "Orphan source should not be marked as macro reference");
    }

    /**
     * Test 5: Handling page with no draw.io content returns empty list
     *
     * Verifies that pages without any draw.io macros or attachments
     * return an empty list of diagram sources.
     */
    @Test
    @DisplayName("Should return empty list for page with no draw.io content")
    void shouldReturnEmptyListForPageWithNoDiagrams() throws IOException {
        // Given
        String pageBody = loadTestResource("test-confluence-html/page-without-diagrams.html");
        ConfluencePage page = new ConfluencePage("999", "No Diagrams Page", pageBody, 1);

        List<ConfluenceAttachment> attachments = List.of(
            new ConfluenceAttachment("att-001", "document.pdf",
                "/download/att-001", "application/pdf"),
            new ConfluenceAttachment("att-002", "image.png",
                "/download/att-002", "image/png")
        );

        // When
        List<DrawioDiagramSource> sources = scanner.scanPage(page, attachments);

        // Then
        assertTrue(sources.isEmpty(), "Should return empty list when no draw.io content exists");
    }

    /**
     * Additional edge case test: Page with null body storage
     */
    @Test
    @DisplayName("Should handle page with null body storage gracefully")
    void shouldHandleNullBodyStorage() {
        // Given
        ConfluencePage page = new ConfluencePage("111", "Empty Page", null, 1);

        List<ConfluenceAttachment> attachments = List.of(
            new ConfluenceAttachment("att-001", "diagram.drawio",
                "/download/att-001", "application/octet-stream")
        );

        // When
        List<DrawioDiagramSource> sources = scanner.scanPage(page, attachments);

        // Then - should still find orphan .drawio attachment
        assertEquals(1, sources.size());
        assertFalse(sources.get(0).referencedByMacro());
    }

    /**
     * Helper method to load test resource files.
     */
    private String loadTestResource(String resourcePath) throws IOException {
        try (var inputStream = getClass().getClassLoader().getResourceAsStream(resourcePath)) {
            if (inputStream == null) {
                throw new IOException("Resource not found: " + resourcePath);
            }
            return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
