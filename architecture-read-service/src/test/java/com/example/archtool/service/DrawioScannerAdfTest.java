package com.example.archtool.service;

import com.example.archtool.model.confluence.ConfluenceAttachment;
import com.example.archtool.model.confluence.ConfluencePage;
import com.example.archtool.model.internal.DrawioDiagramSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for DrawioScanner ADF (Atlassian Document Format) support.
 *
 * <p>These tests verify the scanner's ability to:</p>
 * <ul>
 *     <li>Find draw.io macros in ADF format (Forge-based Confluence Cloud)</li>
 *     <li>Match ADF macro references to attachments by ID</li>
 *     <li>Discover orphan mxfile attachments not referenced by macros</li>
 *     <li>Handle mixed legacy and ADF macro pages</li>
 * </ul>
 */
class DrawioScannerAdfTest {

    private DrawioScanner scanner;

    @BeforeEach
    void setUp() {
        scanner = new DrawioScanner();
    }

    // ==================== ADF Extension Macro Tests ====================

    @Nested
    @DisplayName("ADF Extension Macro Tests")
    class AdfExtensionMacroTests {

        @Test
        @DisplayName("Should extract ADF diagram references with migration-key")
        void shouldExtractAdfDiagramRefsWithMigrationKey() throws IOException {
            // Given
            String pageBody = loadTestResource("test-confluence-html/page-with-adf-drawio-macro.html");

            // When
            List<DrawioScanner.AdfDiagramRef> refs = scanner.extractAdfDiagramRefs(pageBody);

            // Then
            assertEquals(1, refs.size());
            assertEquals("131287", refs.get(0).attachmentId());
            assertEquals("My Architecture Diagram", refs.get(0).diagramName());
        }

        @Test
        @DisplayName("Should extract multiple ADF diagram references")
        void shouldExtractMultipleAdfDiagramRefs() throws IOException {
            // Given
            String pageBody = loadTestResource("test-confluence-html/page-with-multiple-adf-macros.html");

            // When
            List<DrawioScanner.AdfDiagramRef> refs = scanner.extractAdfDiagramRefs(pageBody);

            // Then
            assertEquals(3, refs.size());
            assertTrue(refs.stream().anyMatch(r -> r.attachmentId().equals("200001")));
            assertTrue(refs.stream().anyMatch(r -> r.attachmentId().equals("200002")));
            assertTrue(refs.stream().anyMatch(r -> r.attachmentId().equals("200003")));
        }

        @Test
        @DisplayName("Should match ADF macro to attachment by ID")
        void shouldMatchAdfMacroToAttachmentById() throws IOException {
            // Given
            String pageBody = loadTestResource("test-confluence-html/page-with-adf-drawio-macro.html");
            ConfluencePage page = new ConfluencePage("cloud-001", "Cloud Page", pageBody, 1);

            List<ConfluenceAttachment> attachments = List.of(
                new ConfluenceAttachment("131287", "architecture-diagram.mxfile",
                    "/download/131287", "application/vnd.jgraph.mxfile"),
                new ConfluenceAttachment("131288", "preview.png",
                    "/download/131288", "image/png")
            );

            // When
            List<DrawioDiagramSource> sources = scanner.scanPage(page, attachments);

            // Then
            assertEquals(1, sources.size());
            assertEquals("131287", sources.get(0).attachmentId());
            assertTrue(sources.get(0).referencedByMacro());
        }

        @Test
        @DisplayName("Should handle ADF macro with non-existent attachment ID")
        void shouldHandleAdfMacroWithNonExistentAttachmentId() throws IOException {
            // Given
            String pageBody = loadTestResource("test-confluence-html/page-with-adf-drawio-macro.html");
            ConfluencePage page = new ConfluencePage("cloud-002", "Missing Attachment Page", pageBody, 1);

            List<ConfluenceAttachment> attachments = List.of(
                new ConfluenceAttachment("999999", "other-file.pdf",
                    "/download/999999", "application/pdf")
            );

            // When
            List<DrawioDiagramSource> sources = scanner.scanPage(page, attachments);

            // Then
            assertTrue(sources.isEmpty());
        }

        @Test
        @DisplayName("Should return empty list for empty body storage")
        void shouldReturnEmptyListForEmptyBodyStorage() {
            List<DrawioScanner.AdfDiagramRef> refs = scanner.extractAdfDiagramRefs("");
            assertTrue(refs.isEmpty());
        }

        @Test
        @DisplayName("Should return empty list for null body storage")
        void shouldReturnEmptyListForNullBodyStorage() {
            List<DrawioScanner.AdfDiagramRef> refs = scanner.extractAdfDiagramRefs(null);
            assertTrue(refs.isEmpty());
        }
    }

    // ==================== Mixed Macro Tests ====================

    @Nested
    @DisplayName("Mixed Macro Format Tests")
    class MixedMacroTests {

        @Test
        @DisplayName("Should handle page with both legacy and ADF macros")
        void shouldHandleMixedMacroFormats() throws IOException {
            // Given
            String pageBody = loadTestResource("test-confluence-html/page-with-mixed-macros.html");
            ConfluencePage page = new ConfluencePage("mixed-001", "Mixed Format Page", pageBody, 1);

            List<ConfluenceAttachment> attachments = List.of(
                new ConfluenceAttachment("att-legacy-1", "legacy-architecture.drawio",
                    "/download/legacy-1", "application/octet-stream"),
                new ConfluenceAttachment("att-legacy-2", "data-model.drawio",
                    "/download/legacy-2", "application/octet-stream"),
                new ConfluenceAttachment("300001", "cloud-architecture.mxfile",
                    "/download/300001", "application/vnd.jgraph.mxfile"),
                new ConfluenceAttachment("300002", "preview.png",
                    "/download/300002", "image/png")
            );

            // When
            List<DrawioDiagramSource> sources = scanner.scanPage(page, attachments);

            // Then - should find all 3 diagrams (2 legacy + 1 ADF)
            assertEquals(3, sources.size());
            assertTrue(sources.stream().allMatch(DrawioDiagramSource::referencedByMacro));
        }

        @Test
        @DisplayName("Should not duplicate attachment matched by both name and ID")
        void shouldNotDuplicateMatchedAttachments() throws IOException {
            // Given
            String pageBody = loadTestResource("test-confluence-html/page-with-adf-drawio-macro.html");
            ConfluencePage page = new ConfluencePage("dup-001", "Potential Duplicate Page", pageBody, 1);

            List<ConfluenceAttachment> attachments = List.of(
                new ConfluenceAttachment("131287", "my-diagram.drawio",
                    "/download/131287", "application/vnd.jgraph.mxfile")
            );

            // When
            List<DrawioDiagramSource> sources = scanner.scanPage(page, attachments);

            // Then
            assertEquals(1, sources.size());
            assertTrue(sources.get(0).referencedByMacro());
        }
    }

    // ==================== MXFile Orphan Detection Tests ====================

    @Nested
    @DisplayName("MXFile Orphan Detection Tests")
    class MxfileOrphanTests {

        @Test
        @DisplayName("Should detect mxfile attachment as orphan when no macros present")
        void shouldDetectMxfileAsOrphan() throws IOException {
            // Given
            String pageBody = loadTestResource("test-confluence-html/page-with-no-macros-mxfile-attachment.html");
            ConfluencePage page = new ConfluencePage("orphan-001", "Page With Orphan MXFile", pageBody, 1);

            List<ConfluenceAttachment> attachments = List.of(
                new ConfluenceAttachment("mxf-001", "diagram.mxfile",
                    "/download/mxf-001", "application/vnd.jgraph.mxfile"),
                new ConfluenceAttachment("png-001", "preview.png",
                    "/download/png-001", "image/png")
            );

            // When
            List<DrawioDiagramSource> sources = scanner.scanPage(page, attachments);

            // Then
            assertEquals(1, sources.size());
            assertEquals("mxf-001", sources.get(0).attachmentId());
            assertFalse(sources.get(0).referencedByMacro());
        }

        @Test
        @DisplayName("Should detect mxfile with case-insensitive media type")
        void shouldDetectMxfileWithCaseInsensitiveMediaType() {
            // Given
            ConfluencePage page = new ConfluencePage("orphan-002", "Case Test Page", "", 1);

            List<ConfluenceAttachment> attachments = List.of(
                new ConfluenceAttachment("mxf-001", "diagram.mxfile",
                    "/download/mxf-001", "Application/VND.JGraph.MXFile")
            );

            // When
            List<DrawioDiagramSource> sources = scanner.scanPage(page, attachments);

            // Then
            assertEquals(1, sources.size());
            assertFalse(sources.get(0).referencedByMacro());
        }

        @Test
        @DisplayName("Should not include mxfile as orphan if already matched by ADF macro")
        void shouldNotIncludeMxfileOrphanIfAlreadyMatched() throws IOException {
            // Given
            String pageBody = loadTestResource("test-confluence-html/page-with-adf-drawio-macro.html");
            ConfluencePage page = new ConfluencePage("no-dup-001", "No Duplicate Page", pageBody, 1);

            List<ConfluenceAttachment> attachments = List.of(
                new ConfluenceAttachment("131287", "architecture.mxfile",
                    "/download/131287", "application/vnd.jgraph.mxfile")
            );

            // When
            List<DrawioDiagramSource> sources = scanner.scanPage(page, attachments);

            // Then
            assertEquals(1, sources.size());
            assertTrue(sources.get(0).referencedByMacro());
        }

        @Test
        @DisplayName("Should find both .drawio and mxfile orphans")
        void shouldFindBothDrawioAndMxfileOrphans() {
            // Given
            ConfluencePage page = new ConfluencePage("orphan-003", "Multiple Orphans Page", "", 1);

            List<ConfluenceAttachment> attachments = List.of(
                new ConfluenceAttachment("drawio-001", "diagram1.drawio",
                    "/download/drawio-001", "application/octet-stream"),
                new ConfluenceAttachment("mxf-001", "diagram2.mxfile",
                    "/download/mxf-001", "application/vnd.jgraph.mxfile"),
                new ConfluenceAttachment("pdf-001", "document.pdf",
                    "/download/pdf-001", "application/pdf")
            );

            // When
            List<DrawioDiagramSource> sources = scanner.scanPage(page, attachments);

            // Then
            assertEquals(2, sources.size());
            assertTrue(sources.stream().allMatch(s -> !s.referencedByMacro()));
        }
    }

    // ==================== Edge Case Tests ====================

    @Nested
    @DisplayName("Edge Case Tests")
    class EdgeCaseTests {

        @Test
        @DisplayName("Should handle ADF macro with whitespace in cust-content-id")
        void shouldHandleWhitespaceInContentId() {
            String pageBody = "<ac:adf-extension><ac:adf-node type=\"extension\">" +
                "<ac:adf-attribute key=\"extension-key\">drawio-sketch</ac:adf-attribute>" +
                "<ac:adf-node type=\"guest-params\">" +
                "<ac:adf-parameter key=\"diagram-name\">Test</ac:adf-parameter>" +
                "<ac:adf-parameter key=\"cust-content-id\">  12345  </ac:adf-parameter>" +
                "</ac:adf-node></ac:adf-node></ac:adf-extension>";

            List<DrawioScanner.AdfDiagramRef> refs = scanner.extractAdfDiagramRefs(pageBody);

            assertEquals(1, refs.size());
            assertEquals("12345", refs.get(0).attachmentId());
        }

        @Test
        @DisplayName("Should skip ADF macro with missing cust-content-id")
        void shouldSkipAdfMacroWithMissingContentId() {
            String pageBody = "<ac:adf-extension><ac:adf-node type=\"extension\">" +
                "<ac:adf-attribute key=\"extension-key\">drawio-sketch</ac:adf-attribute>" +
                "<ac:adf-node type=\"guest-params\">" +
                "<ac:adf-parameter key=\"diagram-name\">Test</ac:adf-parameter>" +
                "</ac:adf-node></ac:adf-node></ac:adf-extension>";

            List<DrawioScanner.AdfDiagramRef> refs = scanner.extractAdfDiagramRefs(pageBody);

            assertTrue(refs.isEmpty());
        }

        @Test
        @DisplayName("Should skip ADF macro with blank cust-content-id")
        void shouldSkipAdfMacroWithBlankContentId() {
            String pageBody = "<ac:adf-extension><ac:adf-node type=\"extension\">" +
                "<ac:adf-attribute key=\"extension-key\">drawio-sketch</ac:adf-attribute>" +
                "<ac:adf-node type=\"guest-params\">" +
                "<ac:adf-parameter key=\"diagram-name\">Test</ac:adf-parameter>" +
                "<ac:adf-parameter key=\"cust-content-id\">   </ac:adf-parameter>" +
                "</ac:adf-node></ac:adf-node></ac:adf-extension>";

            List<DrawioScanner.AdfDiagramRef> refs = scanner.extractAdfDiagramRefs(pageBody);

            assertTrue(refs.isEmpty());
        }

        @Test
        @DisplayName("Should detect ADF macro by extension-key containing drawio")
        void shouldDetectAdfMacroByExtensionKey() {
            String pageBody = "<ac:adf-extension><ac:adf-node type=\"extension\">" +
                "<ac:adf-attribute key=\"extension-key\">com.vendor:drawio-custom</ac:adf-attribute>" +
                "<ac:adf-node type=\"guest-params\">" +
                "<ac:adf-parameter key=\"diagram-name\">Custom</ac:adf-parameter>" +
                "<ac:adf-parameter key=\"cust-content-id\">99999</ac:adf-parameter>" +
                "</ac:adf-node></ac:adf-node></ac:adf-extension>";

            List<DrawioScanner.AdfDiagramRef> refs = scanner.extractAdfDiagramRefs(pageBody);

            assertEquals(1, refs.size());
            assertEquals("99999", refs.get(0).attachmentId());
        }

        @Test
        @DisplayName("Should ignore non-drawio ADF extensions")
        void shouldIgnoreNonDrawioAdfExtensions() {
            String pageBody = "<ac:adf-extension><ac:adf-node type=\"extension\">" +
                "<ac:adf-attribute key=\"extension-key\">com.vendor:other-app</ac:adf-attribute>" +
                "<ac:adf-node type=\"guest-params\">" +
                "<ac:adf-parameter key=\"cust-content-id\">88888</ac:adf-parameter>" +
                "</ac:adf-node></ac:adf-node></ac:adf-extension>";

            List<DrawioScanner.AdfDiagramRef> refs = scanner.extractAdfDiagramRefs(pageBody);

            assertTrue(refs.isEmpty());
        }
    }

    // ==================== Helper Methods ====================

    private String loadTestResource(String resourcePath) throws IOException {
        try (var inputStream = getClass().getClassLoader().getResourceAsStream(resourcePath)) {
            if (inputStream == null) {
                throw new IOException("Resource not found: " + resourcePath);
            }
            return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
