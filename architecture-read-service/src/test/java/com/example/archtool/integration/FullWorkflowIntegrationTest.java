package com.example.archtool.integration;

import com.example.archtool.config.ConfluenceProperties;
import com.example.archtool.model.dto.*;
import com.example.archtool.service.ConfluenceClient;
import com.example.archtool.service.ConfluenceDiagramService;
import com.example.archtool.service.DrawioParser;
import com.example.archtool.service.DrawioScanner;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end integration tests for the Confluence Draw.io diagram workflow.
 *
 * <p>These tests verify the complete flow from HTTP request to parsed diagram response,
 * using MockWebServer to simulate Confluence API. They focus on integration points
 * between services and realistic usage scenarios.</p>
 *
 * <p>All HTTP calls go through a single RestClient configured with the API base URL.</p>
 */
class FullWorkflowIntegrationTest {

    private MockWebServer mockWebServer;
    private ConfluenceDiagramService diagramService;
    private ObjectMapper objectMapper;
    private static final String TEST_USERNAME = "testuser@example.com";
    private static final String TEST_API_TOKEN = "test-api-token";

    @BeforeEach
    void setUp() throws IOException {
        mockWebServer = new MockWebServer();
        mockWebServer.start();

        String baseUrl = mockWebServer.url("/wiki").toString();

        ConfluenceProperties properties = new ConfluenceProperties(
            baseUrl,   // apiBaseUrl
            TEST_USERNAME,
            TEST_API_TOKEN,
            5000,
            30000,
            10
        );

        RestClient apiRestClient = RestClient.builder()
            .baseUrl(baseUrl)
            .build();

        ConfluenceClient confluenceClient = new ConfluenceClient(apiRestClient, properties);
        DrawioScanner drawioScanner = new DrawioScanner();
        DrawioParser drawioParser = new DrawioParser();

        diagramService = new ConfluenceDiagramService(confluenceClient, drawioScanner, drawioParser);
        objectMapper = new ObjectMapper();
    }

    @AfterEach
    void tearDown() throws IOException {
        mockWebServer.shutdown();
    }

    // ========================================================================
    // Test 1: Full request/response cycle with real parsing
    // ========================================================================
    @Test
    @DisplayName("Full request/response cycle with mocked Confluence returns parsed diagrams")
    void fullRequestResponseCycle_withMockedConfluence_returnsParsedDiagrams() throws Exception {
        // Given: Mock Confluence responses for page, attachments, and download
        String pageId = "12345";

        // Page response
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createPageResponse(pageId, "Architecture Overview",
                "<ac:structured-macro ac:name=\"drawio\"><ac:parameter ac:name=\"diagramName\">architecture.drawio</ac:parameter></ac:structured-macro>")));

        // Attachments response
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createAttachmentsResponse("att001", "architecture.drawio", pageId)));

        // Diagram download response via REST API endpoint
        String diagramXml = loadTestResource("test-diagrams/simple.drawio");
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/xml")
            .setBody(diagramXml));

        // When: Fetch diagrams
        ConfluenceDiagramResponse response = diagramService.fetchDiagrams(pageId, false, 10);

        // Then: Response structure is correct
        assertThat(response.rootPageId()).isEqualTo(pageId);
        assertThat(response.rootPageTitle()).isEqualTo("Architecture Overview");
        assertThat(response.pages()).hasSize(1);

        // And: Diagrams are parsed correctly
        ConfluencePageDiagramsDto pageDiagrams = response.pages().get(0);
        assertThat(pageDiagrams.diagrams()).isNotEmpty();

        DiagramGraphDto diagram = pageDiagrams.diagrams().get(0);
        assertThat(diagram.nodes()).hasSize(3);  // simple.drawio has 3 nodes
        assertThat(diagram.edges()).hasSize(2);  // simple.drawio has 2 edges

        // And: Summary is accurate
        assertThat(response.summary().totalPages()).isEqualTo(1);
        assertThat(response.summary().totalDiagrams()).isEqualTo(1);
        assertThat(response.summary().totalNodes()).isEqualTo(3);
        assertThat(response.summary().totalEdges()).isEqualTo(2);
        assertThat(response.summary().warnings()).isEmpty();
    }

    // ========================================================================
    // Test 2: Multi-page hierarchy with multiple diagrams per page
    // ========================================================================
    @Test
    @DisplayName("Multi-page hierarchy with multiple diagrams per page")
    void multiPageHierarchy_withMultipleDiagramsPerPage() throws Exception {
        // Given: Root page with one child page, each having diagrams
        String rootPageId = "root001";
        String childPageId = "child001";

        // Root page response
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createPageResponse(rootPageId, "Root Page",
                "<ac:structured-macro ac:name=\"drawio\"><ac:parameter ac:name=\"diagramName\">root-diagram.drawio</ac:parameter></ac:structured-macro>")));

        // Child pages response
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createChildPagesResponse(childPageId, "Child Page",
                "<ac:structured-macro ac:name=\"drawio\"><ac:parameter ac:name=\"diagramName\">child-diagram.drawio</ac:parameter></ac:structured-macro>")));

        // Empty children for child page (recursive termination)
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody("{\"results\": [], \"size\": 0, \"_links\": {}}"));

        // Root page attachments
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createAttachmentsResponse("att_root", "root-diagram.drawio", rootPageId)));

        // Root diagram download (multi-tab)
        String multiTabXml = loadTestResource("test-diagrams/multi-tab.drawio");
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/xml")
            .setBody(multiTabXml));

        // Child page attachments
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createAttachmentsResponse("att_child", "child-diagram.drawio", childPageId)));

        // Child diagram download
        String simpleXml = loadTestResource("test-diagrams/simple.drawio");
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/xml")
            .setBody(simpleXml));

        // When: Fetch diagrams including child pages
        ConfluenceDiagramResponse response = diagramService.fetchDiagrams(rootPageId, true, 10);

        // Then: Both pages are included
        assertThat(response.pages()).hasSize(2);
        assertThat(response.summary().totalPages()).isEqualTo(2);

        // And: Multi-tab diagram results in multiple DiagramGraphDto entries
        ConfluencePageDiagramsDto rootPageDiagrams = response.pages().stream()
            .filter(p -> p.pageId().equals(rootPageId))
            .findFirst()
            .orElseThrow();
        assertThat(rootPageDiagrams.diagrams()).hasSize(2);  // multi-tab.drawio has 2 tabs

        // And: Child page diagram is included
        ConfluencePageDiagramsDto childPageDiagrams = response.pages().stream()
            .filter(p -> p.pageId().equals(childPageId))
            .findFirst()
            .orElseThrow();
        assertThat(childPageDiagrams.diagrams()).hasSize(1);

        // And: Summary totals are accurate
        assertThat(response.summary().totalDiagrams()).isEqualTo(3);  // 2 from root + 1 from child
    }

    // ========================================================================
    // Test 3: Graceful degradation when some diagrams fail
    // ========================================================================
    @Test
    @DisplayName("Graceful degradation when some diagrams fail to parse")
    void gracefulDegradation_whenSomeDiagramsFailToParse() throws Exception {
        // Given: Page with two diagrams, one valid, one corrupt
        String pageId = "page001";

        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createPageResponse(pageId, "Mixed Content Page",
                "<ac:structured-macro ac:name=\"drawio\"><ac:parameter ac:name=\"diagramName\">good.drawio</ac:parameter></ac:structured-macro>" +
                "<ac:structured-macro ac:name=\"drawio\"><ac:parameter ac:name=\"diagramName\">bad.drawio</ac:parameter></ac:structured-macro>")));

        // Two attachments
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createMultipleAttachmentsResponse(pageId,
                new String[]{"att_good", "good.drawio"},
                new String[]{"att_bad", "bad.drawio"})));

        // Good diagram download
        String goodXml = loadTestResource("test-diagrams/simple.drawio");
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/xml")
            .setBody(goodXml));

        // Bad diagram download - corrupt XML
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/xml")
            .setBody("This is not valid XML <unclosed"));

        // When: Fetch diagrams
        ConfluenceDiagramResponse response = diagramService.fetchDiagrams(pageId, false, 10);

        // Then: Good diagram is included
        assertThat(response.pages()).hasSize(1);
        assertThat(response.pages().get(0).diagrams()).hasSize(1);

        // And: Warning is recorded for the failed diagram
        assertThat(response.summary().warnings()).hasSize(1);
        assertThat(response.summary().warnings().get(0))
            .containsIgnoringCase("bad.drawio");
    }

    // ========================================================================
    // Test 4: Empty page with no diagrams returns empty list
    // ========================================================================
    @Test
    @DisplayName("Page with no diagrams returns empty diagrams list")
    void pageWithNoDiagrams_returnsEmptyDiagramsList() throws Exception {
        // Given: Page with no draw.io content
        String pageId = "empty001";

        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createPageResponse(pageId, "No Diagrams Page", "<p>Just text content</p>")));

        // No attachments
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody("{\"results\": [], \"size\": 0, \"_links\": {}}"));

        // When: Fetch diagrams
        ConfluenceDiagramResponse response = diagramService.fetchDiagrams(pageId, false, 10);

        // Then: Response is valid but with no diagrams
        assertThat(response.rootPageId()).isEqualTo(pageId);
        assertThat(response.pages()).hasSize(1);
        assertThat(response.pages().get(0).diagrams()).isEmpty();
        assertThat(response.summary().totalDiagrams()).isEqualTo(0);
        assertThat(response.summary().totalNodes()).isEqualTo(0);
        assertThat(response.summary().totalEdges()).isEqualTo(0);
    }

    // ========================================================================
    // Test 5: Unicode labels and special characters are preserved
    // ========================================================================
    @Test
    @DisplayName("Unicode labels and special characters are preserved in parsing")
    void unicodeLabels_arePreservedInParsing() throws Exception {
        // Given: Page with diagram containing unicode content
        String pageId = "unicode001";

        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createPageResponse(pageId, "Unicode Test",
                "<ac:structured-macro ac:name=\"drawio\"><ac:parameter ac:name=\"diagramName\">unicode.drawio</ac:parameter></ac:structured-macro>")));

        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createAttachmentsResponse("att_unicode", "unicode.drawio", pageId)));

        // Diagram with unicode content
        String unicodeDiagram = """
            <mxfile>
              <diagram id="unicode" name="Unicde Tst">
                <mxGraphModel>
                  <root>
                    <mxCell id="0"/>
                    <mxCell id="1" parent="0"/>
                    <mxCell id="n1" value="Japanese Label" style="rounded=1;" vertex="1" parent="1">
                      <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
                    </mxCell>
                    <mxCell id="n2" value="Greek &amp; Symbols &lt;>&quot;" style="rounded=1;" vertex="1" parent="1">
                      <mxGeometry x="300" y="100" width="120" height="60" as="geometry"/>
                    </mxCell>
                    <mxCell id="e1" value="Link Connection" style="endArrow=classic;" edge="1" parent="1" source="n1" target="n2">
                      <mxGeometry relative="1" as="geometry"/>
                    </mxCell>
                  </root>
                </mxGraphModel>
              </diagram>
            </mxfile>
            """;

        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/xml; charset=utf-8")
            .setBody(unicodeDiagram));

        // When: Fetch diagrams
        ConfluenceDiagramResponse response = diagramService.fetchDiagrams(pageId, false, 10);

        // Then: Unicode content is preserved
        DiagramGraphDto diagram = response.pages().get(0).diagrams().get(0);
        assertThat(diagram.tabName()).isEqualTo("Unicde Tst");

        DiagramNodeDto node1 = diagram.nodes().stream()
            .filter(n -> n.id().equals("n1"))
            .findFirst()
            .orElseThrow();
        assertThat(node1.label()).isEqualTo("Japanese Label");

        DiagramNodeDto node2 = diagram.nodes().stream()
            .filter(n -> n.id().equals("n2"))
            .findFirst()
            .orElseThrow();
        // HTML entities should be unescaped
        assertThat(node2.label()).contains("Greek");
        assertThat(node2.label()).contains("&");

        DiagramEdgeDto edge = diagram.edges().get(0);
        assertThat(edge.label()).contains("Link");
    }

    // ========================================================================
    // Test 6: Response serialization matches exact JSON specification
    // ========================================================================
    @Test
    @DisplayName("Response serialization matches exact JSON specification")
    void responseSerialization_matchesJsonSpecification() throws Exception {
        // Given: Page with diagram
        String pageId = "json001";

        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createPageResponse(pageId, "JSON Test",
                "<ac:structured-macro ac:name=\"drawio\"><ac:parameter ac:name=\"diagramName\">test.drawio</ac:parameter></ac:structured-macro>")));

        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createAttachmentsResponse("att001", "test.drawio", pageId)));

        String diagramXml = loadTestResource("test-diagrams/styled.drawio");
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/xml")
            .setBody(diagramXml));

        // When: Fetch diagrams and serialize to JSON
        ConfluenceDiagramResponse response = diagramService.fetchDiagrams(pageId, false, 10);
        String json = objectMapper.writeValueAsString(response);

        // Then: JSON contains expected structure
        assertThat(json).contains("\"rootPageId\"");
        assertThat(json).contains("\"rootPageTitle\"");
        assertThat(json).contains("\"includeAllChildPages\"");
        assertThat(json).contains("\"maxDepth\"");
        assertThat(json).contains("\"pages\"");
        assertThat(json).contains("\"diagrams\"");
        assertThat(json).contains("\"nodes\"");
        assertThat(json).contains("\"edges\"");
        assertThat(json).contains("\"geometry\"");
        assertThat(json).contains("\"style\"");
        assertThat(json).contains("\"summary\"");
        assertThat(json).contains("\"totalPages\"");
        assertThat(json).contains("\"totalDiagrams\"");
        assertThat(json).contains("\"totalNodes\"");
        assertThat(json).contains("\"totalEdges\"");
        assertThat(json).contains("\"warnings\"");

        // And: Can deserialize back without errors
        ConfluenceDiagramResponse deserialized = objectMapper.readValue(json, ConfluenceDiagramResponse.class);
        assertThat(deserialized.rootPageId()).isEqualTo(pageId);
    }

    // ========================================================================
    // Test 7: Orphan attachments (not referenced by macro) are included
    // ========================================================================
    @Test
    @DisplayName("Orphan .drawio attachments not referenced by macro are included")
    void orphanAttachments_areIncluded() throws Exception {
        // Given: Page with no macro but has .drawio attachment
        String pageId = "orphan001";

        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createPageResponse(pageId, "Orphan Attachment Page", "<p>No macro here</p>")));

        // Attachment exists but no macro references it
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createAttachmentsResponse("att_orphan", "orphan-diagram.drawio", pageId)));

        String diagramXml = loadTestResource("test-diagrams/simple.drawio");
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/xml")
            .setBody(diagramXml));

        // When: Fetch diagrams
        ConfluenceDiagramResponse response = diagramService.fetchDiagrams(pageId, false, 10);

        // Then: Orphan attachment is still processed
        assertThat(response.pages().get(0).diagrams()).isNotEmpty();
        assertThat(response.summary().totalDiagrams()).isEqualTo(1);
    }

    // ========================================================================
    // Test 8: Download failure produces warning without aborting
    // ========================================================================
    @Test
    @DisplayName("Download failure for attachment produces warning without aborting")
    void downloadFailure_producesWarning_withoutAborting() throws Exception {
        // Given: Page with attachment that fails to download
        String pageId = "fail001";

        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createPageResponse(pageId, "Download Fail Page",
                "<ac:structured-macro ac:name=\"drawio\"><ac:parameter ac:name=\"diagramName\">missing.drawio</ac:parameter></ac:structured-macro>")));

        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(createAttachmentsResponse("att_missing", "missing.drawio", pageId)));

        // Download fails with 404
        mockWebServer.enqueue(new MockResponse()
            .setResponseCode(404)
            .setBody("{\"message\": \"Attachment not found\"}"));

        // When: Fetch diagrams
        ConfluenceDiagramResponse response = diagramService.fetchDiagrams(pageId, false, 10);

        // Then: Response is still returned
        assertThat(response.rootPageId()).isEqualTo(pageId);
        assertThat(response.pages()).hasSize(1);
        assertThat(response.pages().get(0).diagrams()).isEmpty();

        // And: Warning is recorded
        assertThat(response.summary().warnings()).isNotEmpty();
    }

    // ========================================================================
    // Helper methods
    // ========================================================================

    private String createPageResponse(String pageId, String title, String bodyContent) {
        return String.format("""
            {
                "id": "%s",
                "title": "%s",
                "body": {
                    "storage": {
                        "value": "%s"
                    }
                },
                "version": {
                    "number": 1
                }
            }
            """, pageId, title, escapeJson(bodyContent));
    }

    private String createChildPagesResponse(String childId, String childTitle, String bodyContent) {
        return String.format("""
            {
                "results": [
                    {
                        "id": "%s",
                        "title": "%s",
                        "body": {
                            "storage": {
                                "value": "%s"
                            }
                        },
                        "version": {
                            "number": 1
                        }
                    }
                ],
                "size": 1,
                "_links": {}
            }
            """, childId, childTitle, escapeJson(bodyContent));
    }

    private String createAttachmentsResponse(String attachmentId, String filename, String pageId) {
        return String.format("""
            {
                "results": [
                    {
                        "id": "%s",
                        "title": "%s",
                        "_links": {
                            "download": "/wiki/download/attachments/%s/%s"
                        },
                        "metadata": {
                            "mediaType": "application/vnd.jgraph.mxfile"
                        }
                    }
                ],
                "size": 1,
                "_links": {}
            }
            """, attachmentId, filename, pageId, filename);
    }

    private String createMultipleAttachmentsResponse(String pageId, String[]... attachments) {
        StringBuilder results = new StringBuilder("[");
        for (int i = 0; i < attachments.length; i++) {
            if (i > 0) results.append(",");
            String id = attachments[i][0];
            String filename = attachments[i][1];
            results.append(String.format("""
                {
                    "id": "%s",
                    "title": "%s",
                    "_links": {
                        "download": "/wiki/download/attachments/%s/%s"
                    },
                    "metadata": {
                        "mediaType": "application/vnd.jgraph.mxfile"
                    }
                }
                """, id, filename, pageId, filename));
        }
        results.append("]");

        return String.format("""
            {
                "results": %s,
                "size": %d,
                "_links": {}
            }
            """, results.toString(), attachments.length);
    }

    private String escapeJson(String value) {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
    }

    private String loadTestResource(String resourcePath) throws IOException {
        try (InputStream is = getClass().getClassLoader().getResourceAsStream(resourcePath)) {
            if (is == null) {
                throw new IOException("Resource not found: " + resourcePath);
            }
            return new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
