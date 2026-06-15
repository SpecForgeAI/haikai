package com.example.archtool.service;

import com.example.archtool.exception.ConfluenceApiException;
import com.example.archtool.exception.DiagramParsingException;
import com.example.archtool.model.confluence.ConfluenceAttachment;
import com.example.archtool.model.confluence.ConfluencePage;
import com.example.archtool.model.dto.*;
import com.example.archtool.model.internal.DrawioDiagramSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for ConfluenceDiagramService orchestration service.
 *
 * <p>These tests verify that the orchestration service correctly:
 * <ul>
 *   <li>Coordinates calls to ConfluenceClient, DrawioScanner, and DrawioParser</li>
 *   <li>Handles child page traversal when requested</li>
 *   <li>Respects maxDepth parameter for child page traversal</li>
 *   <li>Produces warnings for individual failures without aborting</li>
 *   <li>Calculates accurate summary statistics</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
class ConfluenceDiagramServiceTest {

    @Mock
    private ConfluenceClient confluenceClient;

    @Mock
    private DrawioScanner drawioScanner;

    @Mock
    private DrawioParser drawioParser;

    private ConfluenceDiagramService service;

    @BeforeEach
    void setUp() {
        service = new ConfluenceDiagramService(confluenceClient, drawioScanner, drawioParser);
    }

    // ========================================================================
    // Test 1: Single page with one diagram returns correct response structure
    // ========================================================================
    @Test
    @DisplayName("Single page with one diagram returns correct response structure")
    void singlePageWithOneDiagram_returnsCorrectResponseStructure() {
        // Given: A Confluence page with one draw.io diagram
        String pageId = "123456";
        ConfluencePage rootPage = new ConfluencePage(
            pageId,
            "Test Page",
            "<p>Content with draw.io macro</p>",
            1
        );

        ConfluenceAttachment attachment = new ConfluenceAttachment(
            "att789",
            "diagram.drawio",
            "/download/att789",
            "application/xml"
        );

        DrawioDiagramSource diagramSource = DrawioDiagramSource.fromMacroReference(
            "att789",
            "diagram.drawio",
            "/download/att789"
        );

        DiagramSourceDto sourceDto = new DiagramSourceDto(
            DiagramSourceDto.TYPE_CONFLUENCE_DRAWIO_ATTACHMENT,
            pageId,
            "att789",
            "diagram.drawio"
        );

        DiagramNodeDto node = new DiagramNodeDto(
            "n1",
            "Test Node",
            new DiagramGeometryDto(100.0, 200.0, 120.0, 60.0),
            new DiagramStyleDto("rounded=1;", "#aaffaa", "#000000", null, "rectangle", true, null, null, null, null, null),
            "1"
        );

        DiagramEdgeDto edge = new DiagramEdgeDto(
            "e1",
            "n1",
            "n2",
            "Connection",
            List.of(new DiagramPointDto(160.0, 230.0), new DiagramPointDto(300.0, 230.0)),
            new DiagramStyleDto("endArrow=classic;", null, "#666666", null, null, null, null, null, "classic", null, null)
        );

        DiagramGraphDto diagram = new DiagramGraphDto(
            "diag_123456_att789_0",
            "diagram.drawio",
            0,
            "Overview",
            sourceDto,
            List.of(node),
            List.of(edge)
        );

        byte[] xmlContent = "<mxfile>...</mxfile>".getBytes();

        // Set up mocks
        when(confluenceClient.getPage(pageId)).thenReturn(rootPage);
        when(confluenceClient.getAttachments(pageId)).thenReturn(List.of(attachment));
        when(drawioScanner.scanPage(eq(rootPage), anyList())).thenReturn(List.of(diagramSource));
        when(confluenceClient.downloadAttachment(pageId, attachment)).thenReturn(xmlContent);
        when(drawioParser.parse(eq(xmlContent), any(DiagramSourceDto.class))).thenReturn(List.of(diagram));

        // When: Fetching diagrams for single page
        ConfluenceDiagramResponse response = service.fetchDiagrams(pageId, false, 10);

        // Then: Response structure is correct
        assertThat(response).isNotNull();
        assertThat(response.rootPageId()).isEqualTo(pageId);
        assertThat(response.rootPageTitle()).isEqualTo("Test Page");
        assertThat(response.includeAllChildPages()).isFalse();
        assertThat(response.maxDepth()).isEqualTo(10);

        // And: Pages list contains the root page with its diagram
        assertThat(response.pages()).hasSize(1);
        ConfluencePageDiagramsDto pageDiagrams = response.pages().get(0);
        assertThat(pageDiagrams.pageId()).isEqualTo(pageId);
        assertThat(pageDiagrams.pageTitle()).isEqualTo("Test Page");
        assertThat(pageDiagrams.diagrams()).hasSize(1);

        // And: Summary is accurate
        assertThat(response.summary().totalPages()).isEqualTo(1);
        assertThat(response.summary().totalDiagrams()).isEqualTo(1);
        assertThat(response.summary().totalNodes()).isEqualTo(1);
        assertThat(response.summary().totalEdges()).isEqualTo(1);
        assertThat(response.summary().warnings()).isEmpty();
    }

    // ========================================================================
    // Test 2: includeAllChildPages=true fetches and includes child pages
    // ========================================================================
    @Test
    @DisplayName("includeAllChildPages=true fetches and includes child pages")
    void includeAllChildPagesTrue_fetchesAndIncludesChildPages() {
        // Given: A root page with two child pages
        String rootPageId = "root123";
        ConfluencePage rootPage = new ConfluencePage(rootPageId, "Root Page", "<p>Root content</p>", 1);
        ConfluencePage childPage1 = new ConfluencePage("child1", "Child Page 1", "<p>Child 1 content</p>", 1);
        ConfluencePage childPage2 = new ConfluencePage("child2", "Child Page 2", "<p>Child 2 content</p>", 1);

        // Set up mocks for page fetching
        when(confluenceClient.getPage(rootPageId)).thenReturn(rootPage);
        when(confluenceClient.getChildPages(rootPageId, 10)).thenReturn(List.of(childPage1, childPage2));

        // All pages have no attachments (for simplicity in this test)
        when(confluenceClient.getAttachments(anyString())).thenReturn(List.of());
        when(drawioScanner.scanPage(any(ConfluencePage.class), anyList())).thenReturn(List.of());

        // When: Fetching diagrams with child pages included
        ConfluenceDiagramResponse response = service.fetchDiagrams(rootPageId, true, 10);

        // Then: All pages are included in response
        assertThat(response.pages()).hasSize(3);
        assertThat(response.pages().stream().map(ConfluencePageDiagramsDto::pageId))
            .containsExactlyInAnyOrder(rootPageId, "child1", "child2");

        // And: includeAllChildPages flag is reflected in response
        assertThat(response.includeAllChildPages()).isTrue();

        // And: Summary reflects all pages
        assertThat(response.summary().totalPages()).isEqualTo(3);

        // And: getChildPages was called
        verify(confluenceClient).getChildPages(rootPageId, 10);
    }

    // ========================================================================
    // Test 3: maxDepth parameter limits child page traversal
    // ========================================================================
    @Test
    @DisplayName("maxDepth parameter limits child page traversal")
    void maxDepthParameter_limitsChildPageTraversal() {
        // Given: A root page
        String rootPageId = "root123";
        ConfluencePage rootPage = new ConfluencePage(rootPageId, "Root Page", "<p>Content</p>", 1);
        int maxDepth = 3;

        when(confluenceClient.getPage(rootPageId)).thenReturn(rootPage);
        when(confluenceClient.getChildPages(rootPageId, maxDepth)).thenReturn(List.of());
        when(confluenceClient.getAttachments(anyString())).thenReturn(List.of());
        when(drawioScanner.scanPage(any(ConfluencePage.class), anyList())).thenReturn(List.of());

        // When: Fetching diagrams with specific maxDepth
        ConfluenceDiagramResponse response = service.fetchDiagrams(rootPageId, true, maxDepth);

        // Then: Response reflects the maxDepth
        assertThat(response.maxDepth()).isEqualTo(maxDepth);

        // And: getChildPages was called with the correct maxDepth
        verify(confluenceClient).getChildPages(rootPageId, maxDepth);
    }

    // ========================================================================
    // Test 4: Parsing failure for one diagram adds warning but continues processing
    // ========================================================================
    @Test
    @DisplayName("Parsing failure for one diagram adds warning but continues processing")
    void parsingFailure_addsWarningButContinuesProcessing() {
        // Given: A page with two diagrams, one of which fails to parse
        String pageId = "page123";
        ConfluencePage page = new ConfluencePage(pageId, "Test Page", "<p>Content</p>", 1);

        ConfluenceAttachment goodAttachment = new ConfluenceAttachment(
            "att1",
            "good-diagram.drawio",
            "/download/att1",
            "application/xml"
        );

        ConfluenceAttachment badAttachment = new ConfluenceAttachment(
            "att2",
            "corrupt-diagram.drawio",
            "/download/att2",
            "application/xml"
        );

        DrawioDiagramSource goodSource = DrawioDiagramSource.fromMacroReference("att1", "good-diagram.drawio", "/download/att1");
        DrawioDiagramSource badSource = DrawioDiagramSource.fromMacroReference("att2", "corrupt-diagram.drawio", "/download/att2");

        byte[] goodXml = "<mxfile>good</mxfile>".getBytes();
        byte[] badXml = "invalid xml".getBytes();

        DiagramSourceDto goodSourceDto = new DiagramSourceDto(
            DiagramSourceDto.TYPE_CONFLUENCE_DRAWIO_ATTACHMENT,
            pageId,
            "att1",
            "good-diagram.drawio"
        );

        DiagramGraphDto goodDiagram = new DiagramGraphDto(
            "diag_page123_att1_0",
            "good-diagram.drawio",
            0,
            "Good Tab",
            goodSourceDto,
            List.of(new DiagramNodeDto("n1", "Node", null, null, null)),
            List.of()
        );

        when(confluenceClient.getPage(pageId)).thenReturn(page);
        when(confluenceClient.getAttachments(pageId)).thenReturn(List.of(goodAttachment, badAttachment));
        when(drawioScanner.scanPage(eq(page), anyList())).thenReturn(List.of(goodSource, badSource));
        when(confluenceClient.downloadAttachment(pageId, goodAttachment)).thenReturn(goodXml);
        when(confluenceClient.downloadAttachment(pageId, badAttachment)).thenReturn(badXml);
        when(drawioParser.parse(eq(goodXml), any(DiagramSourceDto.class))).thenReturn(List.of(goodDiagram));
        when(drawioParser.parse(eq(badXml), any(DiagramSourceDto.class)))
            .thenThrow(new DiagramParsingException("page123/att2/corrupt-diagram.drawio", "Invalid XML structure"));

        // When: Fetching diagrams
        ConfluenceDiagramResponse response = service.fetchDiagrams(pageId, false, 10);

        // Then: The good diagram is included
        assertThat(response.pages()).hasSize(1);
        assertThat(response.pages().get(0).diagrams()).hasSize(1);
        assertThat(response.pages().get(0).diagrams().get(0).diagramId()).isEqualTo("diag_page123_att1_0");

        // And: A warning is recorded for the parsing failure
        assertThat(response.summary().warnings()).hasSize(1);
        assertThat(response.summary().warnings().get(0))
            .contains("corrupt-diagram.drawio")
            .containsIgnoringCase("failed")
            .containsIgnoringCase("parse");

        // And: Summary counts reflect only the successful diagram
        assertThat(response.summary().totalDiagrams()).isEqualTo(1);
        assertThat(response.summary().totalNodes()).isEqualTo(1);
    }

    // ========================================================================
    // Test 5: Missing attachment adds warning but continues processing
    // ========================================================================
    @Test
    @DisplayName("Missing attachment adds warning but continues processing")
    void missingAttachment_addsWarningButContinuesProcessing() {
        // Given: A page where the scanner reports a diagram but download fails
        String pageId = "page123";
        ConfluencePage page = new ConfluencePage(pageId, "Test Page", "<p>Content</p>", 1);

        ConfluenceAttachment attachment = new ConfluenceAttachment(
            "att1",
            "missing-diagram.drawio",
            "/download/att1",
            "application/xml"
        );

        DrawioDiagramSource diagramSource = DrawioDiagramSource.fromMacroReference(
            "att1",
            "missing-diagram.drawio",
            "/download/att1"
        );

        when(confluenceClient.getPage(pageId)).thenReturn(page);
        when(confluenceClient.getAttachments(pageId)).thenReturn(List.of(attachment));
        when(drawioScanner.scanPage(eq(page), anyList())).thenReturn(List.of(diagramSource));
        when(confluenceClient.downloadAttachment(pageId, attachment))
            .thenThrow(new ConfluenceApiException(404, "Attachment not found"));

        // When: Fetching diagrams
        ConfluenceDiagramResponse response = service.fetchDiagrams(pageId, false, 10);

        // Then: The page is still included (just with no diagrams)
        assertThat(response.pages()).hasSize(1);
        assertThat(response.pages().get(0).diagrams()).isEmpty();

        // And: A warning is recorded for the missing attachment
        assertThat(response.summary().warnings()).hasSize(1);
        assertThat(response.summary().warnings().get(0))
            .contains("missing-diagram.drawio")
            .containsIgnoringCase("download");

        // And: Summary counts reflect no diagrams
        assertThat(response.summary().totalDiagrams()).isEqualTo(0);
    }

    // ========================================================================
    // Test 6: Summary counts (totalPages, totalDiagrams, totalNodes, totalEdges) are correct
    // ========================================================================
    @Test
    @DisplayName("Summary counts are correct across multiple pages and diagrams")
    void summaryCounts_areCorrectAcrossMultiplePagesAndDiagrams() {
        // Given: Root page with child page, each having diagrams with multiple nodes/edges
        String rootPageId = "root123";
        ConfluencePage rootPage = new ConfluencePage(rootPageId, "Root Page", "<p>Root</p>", 1);
        ConfluencePage childPage = new ConfluencePage("child1", "Child Page", "<p>Child</p>", 1);

        // Root page has one attachment with 2 tabs (diagrams)
        ConfluenceAttachment rootAttachment = new ConfluenceAttachment("attRoot", "root.drawio", "/download/attRoot", "application/xml");
        DrawioDiagramSource rootSource = DrawioDiagramSource.fromMacroReference("attRoot", "root.drawio", "/download/attRoot");
        byte[] rootXml = "<mxfile>root</mxfile>".getBytes();

        // Create diagrams for root page - 2 tabs/diagrams
        DiagramSourceDto rootSourceDto = new DiagramSourceDto(
            DiagramSourceDto.TYPE_CONFLUENCE_DRAWIO_ATTACHMENT, rootPageId, "attRoot", "root.drawio"
        );
        DiagramGraphDto rootDiagram1 = new DiagramGraphDto(
            "diag_root123_attRoot_0", "root.drawio", 0, "Tab1", rootSourceDto,
            List.of(
                new DiagramNodeDto("r1n1", "Node1", null, null, null),
                new DiagramNodeDto("r1n2", "Node2", null, null, null),
                new DiagramNodeDto("r1n3", "Node3", null, null, null)
            ),
            List.of(
                new DiagramEdgeDto("r1e1", "r1n1", "r1n2", "Edge1", List.of(), null),
                new DiagramEdgeDto("r1e2", "r1n2", "r1n3", "Edge2", List.of(), null)
            )
        );
        DiagramGraphDto rootDiagram2 = new DiagramGraphDto(
            "diag_root123_attRoot_1", "root.drawio", 1, "Tab2", rootSourceDto,
            List.of(
                new DiagramNodeDto("r2n1", "Node1", null, null, null),
                new DiagramNodeDto("r2n2", "Node2", null, null, null)
            ),
            List.of(
                new DiagramEdgeDto("r2e1", "r2n1", "r2n2", "Edge1", List.of(), null)
            )
        );

        // Child page has one diagram
        ConfluenceAttachment childAttachment = new ConfluenceAttachment("attChild", "child.drawio", "/download/attChild", "application/xml");
        DrawioDiagramSource childSource = DrawioDiagramSource.fromMacroReference("attChild", "child.drawio", "/download/attChild");
        byte[] childXml = "<mxfile>child</mxfile>".getBytes();

        DiagramSourceDto childSourceDto = new DiagramSourceDto(
            DiagramSourceDto.TYPE_CONFLUENCE_DRAWIO_ATTACHMENT, "child1", "attChild", "child.drawio"
        );
        DiagramGraphDto childDiagram = new DiagramGraphDto(
            "diag_child1_attChild_0", "child.drawio", 0, "Tab1", childSourceDto,
            List.of(
                new DiagramNodeDto("c1n1", "ChildNode1", null, null, null),
                new DiagramNodeDto("c1n2", "ChildNode2", null, null, null),
                new DiagramNodeDto("c1n3", "ChildNode3", null, null, null),
                new DiagramNodeDto("c1n4", "ChildNode4", null, null, null)
            ),
            List.of(
                new DiagramEdgeDto("c1e1", "c1n1", "c1n2", "ChildEdge1", List.of(), null),
                new DiagramEdgeDto("c1e2", "c1n2", "c1n3", "ChildEdge2", List.of(), null),
                new DiagramEdgeDto("c1e3", "c1n3", "c1n4", "ChildEdge3", List.of(), null)
            )
        );

        // Set up mocks
        when(confluenceClient.getPage(rootPageId)).thenReturn(rootPage);
        when(confluenceClient.getChildPages(rootPageId, 10)).thenReturn(List.of(childPage));

        when(confluenceClient.getAttachments(rootPageId)).thenReturn(List.of(rootAttachment));
        when(confluenceClient.getAttachments("child1")).thenReturn(List.of(childAttachment));

        when(drawioScanner.scanPage(eq(rootPage), anyList())).thenReturn(List.of(rootSource));
        when(drawioScanner.scanPage(eq(childPage), anyList())).thenReturn(List.of(childSource));

        when(confluenceClient.downloadAttachment(rootPageId, rootAttachment)).thenReturn(rootXml);
        when(confluenceClient.downloadAttachment("child1", childAttachment)).thenReturn(childXml);

        when(drawioParser.parse(eq(rootXml), any(DiagramSourceDto.class)))
            .thenReturn(List.of(rootDiagram1, rootDiagram2));
        when(drawioParser.parse(eq(childXml), any(DiagramSourceDto.class)))
            .thenReturn(List.of(childDiagram));

        // When: Fetching diagrams with child pages
        ConfluenceDiagramResponse response = service.fetchDiagrams(rootPageId, true, 10);

        // Then: Summary counts are accurate
        // Total pages: root + child = 2
        assertThat(response.summary().totalPages()).isEqualTo(2);

        // Total diagrams: 2 (from root) + 1 (from child) = 3
        assertThat(response.summary().totalDiagrams()).isEqualTo(3);

        // Total nodes: 3 (root tab1) + 2 (root tab2) + 4 (child) = 9
        assertThat(response.summary().totalNodes()).isEqualTo(9);

        // Total edges: 2 (root tab1) + 1 (root tab2) + 3 (child) = 6
        assertThat(response.summary().totalEdges()).isEqualTo(6);

        // And: No warnings
        assertThat(response.summary().warnings()).isEmpty();
    }
}
