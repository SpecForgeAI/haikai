package com.example.archtool.controller;

import com.example.archtool.config.ConfluenceProperties;
import com.example.archtool.exception.ConfluenceApiException;
import com.example.archtool.exception.GlobalExceptionHandler;
import com.example.archtool.model.dto.*;
import com.example.archtool.service.ConfluenceDiagramService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.hamcrest.Matchers.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Unit tests for ConfluenceDiagramController using @WebMvcTest.
 *
 * <p>These tests verify the REST API contract including:
 * <ul>
 *   <li>Successful request handling with valid parameters</li>
 *   <li>Parameter validation (required fields, value constraints)</li>
 *   <li>Error propagation from Confluence API errors</li>
 *   <li>Response JSON structure conformance</li>
 * </ul>
 */
@WebMvcTest(ConfluenceDiagramController.class)
@Import(GlobalExceptionHandler.class)
class ConfluenceDiagramControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ConfluenceDiagramService confluenceDiagramService;

    @MockBean
    private ConfluenceProperties confluenceProperties;

    private static final String DIAGRAMS_ENDPOINT = "/api/confluence/diagrams";

    // ========================================================================
    // Test 1: GET /api/confluence/diagrams with valid pageId returns 200 OK
    // ========================================================================
    @Test
    @DisplayName("GET /api/confluence/diagrams with valid pageId returns 200 OK")
    void getDiagrams_withValidPageId_returns200Ok() throws Exception {
        // Given: A valid pageId and service returns a response
        String pageId = "123456";

        ConfluenceDiagramResponse response = createSampleResponse(pageId, "Test Page");

        when(confluenceProperties.maxPageDepth()).thenReturn(10);
        when(confluenceDiagramService.fetchDiagrams(eq(pageId), eq(false), anyInt()))
            .thenReturn(response);

        // When/Then: GET request returns 200 OK
        mockMvc.perform(get(DIAGRAMS_ENDPOINT)
                .param("pageId", pageId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.rootPageId").value(pageId))
            .andExpect(jsonPath("$.rootPageTitle").value("Test Page"));
    }

    // ========================================================================
    // Test 2: Missing pageId returns 400 BAD_REQUEST
    // ========================================================================
    @Test
    @DisplayName("Missing pageId returns 400 BAD_REQUEST")
    void getDiagrams_missingPageId_returns400BadRequest() throws Exception {
        // When/Then: GET request without pageId returns 400
        mockMvc.perform(get(DIAGRAMS_ENDPOINT)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isBadRequest());
    }

    // ========================================================================
    // Test 3: Invalid maxDepth (negative) returns 400 BAD_REQUEST
    // ========================================================================
    @Test
    @DisplayName("Invalid maxDepth (negative) returns 400 BAD_REQUEST")
    void getDiagrams_negativeMaxDepth_returns400BadRequest() throws Exception {
        // When/Then: GET request with negative maxDepth returns 400
        mockMvc.perform(get(DIAGRAMS_ENDPOINT)
                .param("pageId", "123456")
                .param("maxDepth", "-1")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("BAD_REQUEST"))
            .andExpect(jsonPath("$.message").isNotEmpty());
    }

    // ========================================================================
    // Test 4: Confluence 401 error propagates as 401 response
    // ========================================================================
    @Test
    @DisplayName("Confluence 401 error propagates as 401 response")
    void getDiagrams_confluence401Error_returns401Unauthorized() throws Exception {
        // Given: Service throws ConfluenceApiException with 401 status
        String pageId = "123456";

        when(confluenceProperties.maxPageDepth()).thenReturn(10);
        when(confluenceDiagramService.fetchDiagrams(eq(pageId), eq(false), anyInt()))
            .thenThrow(new ConfluenceApiException(401, "Confluence authentication failed"));

        // When/Then: GET request returns 401 UNAUTHORIZED
        mockMvc.perform(get(DIAGRAMS_ENDPOINT)
                .param("pageId", pageId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("UNAUTHORIZED"))
            .andExpect(jsonPath("$.message").value("Confluence authentication failed"));
    }

    // ========================================================================
    // Test 5: Confluence 404 error propagates as 404 response
    // ========================================================================
    @Test
    @DisplayName("Confluence 404 error propagates as 404 response")
    void getDiagrams_confluence404Error_returns404NotFound() throws Exception {
        // Given: Service throws ConfluenceApiException with 404 status
        String pageId = "999999";

        when(confluenceProperties.maxPageDepth()).thenReturn(10);
        when(confluenceDiagramService.fetchDiagrams(eq(pageId), eq(false), anyInt()))
            .thenThrow(new ConfluenceApiException(404, "Page 999999 not found"));

        // When/Then: GET request returns 404 NOT_FOUND
        mockMvc.perform(get(DIAGRAMS_ENDPOINT)
                .param("pageId", pageId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("NOT_FOUND"))
            .andExpect(jsonPath("$.message").value("Page 999999 not found"));
    }

    // ========================================================================
    // Test 6: Response JSON structure matches specification
    // ========================================================================
    @Test
    @DisplayName("Response JSON structure matches specification")
    void getDiagrams_responseJsonStructure_matchesSpecification() throws Exception {
        // Given: A comprehensive response with all fields populated
        String pageId = "123456";

        DiagramSourceDto sourceDto = new DiagramSourceDto(
            DiagramSourceDto.TYPE_CONFLUENCE_DRAWIO_ATTACHMENT,
            pageId,
            "att789",
            "fi-rates-workflow.drawio"
        );

        DiagramGeometryDto geometry = new DiagramGeometryDto(100.0, 200.0, 120.0, 60.0);

        DiagramStyleDto nodeStyle = new DiagramStyleDto(
            "rounded=1;fillColor=#aaffaa;strokeColor=#000000;",
            "#aaffaa",
            "#000000",
            null,
            "rectangle",
            true,
            null,
            null,
            null,
            null,
            null
        );

        DiagramNodeDto node = new DiagramNodeDto(
            "n1",
            "Flow Pricing",
            geometry,
            nodeStyle,
            null
        );

        DiagramStyleDto edgeStyle = new DiagramStyleDto(
            "endArrow=classic;dashed=1;strokeColor=#666666;",
            null,
            "#666666",
            null,
            null,
            null,
            true,
            null,
            "classic",
            null,
            null
        );

        DiagramEdgeDto edge = new DiagramEdgeDto(
            "e1",
            "n1",
            "n2",
            "Enquiry",
            List.of(new DiagramPointDto(160.0, 230.0), new DiagramPointDto(300.0, 230.0)),
            edgeStyle
        );

        DiagramGraphDto diagram = new DiagramGraphDto(
            "diag_123456_att789_0",
            "FI Rates Trader Workflow",
            0,
            "Overview",
            sourceDto,
            List.of(node),
            List.of(edge)
        );

        ConfluencePageDiagramsDto pageDiagrams = new ConfluencePageDiagramsDto(
            pageId,
            "FI Rates Trader Workflow",
            List.of(diagram)
        );

        ResponseSummaryDto summary = new ResponseSummaryDto(
            1, 1, 1, 1,
            List.of("Warning: test warning message")
        );

        ConfluenceDiagramResponse response = new ConfluenceDiagramResponse(
            pageId,
            "FI Rates Trader Workflow",
            false,
            10,
            List.of(pageDiagrams),
            summary
        );

        when(confluenceProperties.maxPageDepth()).thenReturn(10);
        when(confluenceDiagramService.fetchDiagrams(eq(pageId), eq(false), anyInt()))
            .thenReturn(response);

        // When/Then: Response structure matches specification
        mockMvc.perform(get(DIAGRAMS_ENDPOINT)
                .param("pageId", pageId)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            // Root level fields
            .andExpect(jsonPath("$.rootPageId").value(pageId))
            .andExpect(jsonPath("$.rootPageTitle").value("FI Rates Trader Workflow"))
            .andExpect(jsonPath("$.includeAllChildPages").value(false))
            .andExpect(jsonPath("$.maxDepth").value(10))
            // Pages array
            .andExpect(jsonPath("$.pages").isArray())
            .andExpect(jsonPath("$.pages", hasSize(1)))
            .andExpect(jsonPath("$.pages[0].pageId").value(pageId))
            .andExpect(jsonPath("$.pages[0].pageTitle").value("FI Rates Trader Workflow"))
            // Diagrams array within page
            .andExpect(jsonPath("$.pages[0].diagrams").isArray())
            .andExpect(jsonPath("$.pages[0].diagrams", hasSize(1)))
            .andExpect(jsonPath("$.pages[0].diagrams[0].diagramId").value("diag_123456_att789_0"))
            .andExpect(jsonPath("$.pages[0].diagrams[0].diagramName").value("FI Rates Trader Workflow"))
            .andExpect(jsonPath("$.pages[0].diagrams[0].tabIndex").value(0))
            .andExpect(jsonPath("$.pages[0].diagrams[0].tabName").value("Overview"))
            // Source within diagram
            .andExpect(jsonPath("$.pages[0].diagrams[0].source.type").value("CONFLUENCE_DRAWIO_ATTACHMENT"))
            .andExpect(jsonPath("$.pages[0].diagrams[0].source.pageId").value(pageId))
            .andExpect(jsonPath("$.pages[0].diagrams[0].source.attachmentId").value("att789"))
            .andExpect(jsonPath("$.pages[0].diagrams[0].source.attachmentFileName").value("fi-rates-workflow.drawio"))
            // Nodes array
            .andExpect(jsonPath("$.pages[0].diagrams[0].nodes").isArray())
            .andExpect(jsonPath("$.pages[0].diagrams[0].nodes", hasSize(1)))
            .andExpect(jsonPath("$.pages[0].diagrams[0].nodes[0].id").value("n1"))
            .andExpect(jsonPath("$.pages[0].diagrams[0].nodes[0].label").value("Flow Pricing"))
            .andExpect(jsonPath("$.pages[0].diagrams[0].nodes[0].geometry.x").value(100.0))
            .andExpect(jsonPath("$.pages[0].diagrams[0].nodes[0].geometry.y").value(200.0))
            .andExpect(jsonPath("$.pages[0].diagrams[0].nodes[0].geometry.width").value(120.0))
            .andExpect(jsonPath("$.pages[0].diagrams[0].nodes[0].geometry.height").value(60.0))
            .andExpect(jsonPath("$.pages[0].diagrams[0].nodes[0].style.rawStyle").exists())
            .andExpect(jsonPath("$.pages[0].diagrams[0].nodes[0].style.fillColor").value("#aaffaa"))
            .andExpect(jsonPath("$.pages[0].diagrams[0].nodes[0].style.strokeColor").value("#000000"))
            .andExpect(jsonPath("$.pages[0].diagrams[0].nodes[0].style.shape").value("rectangle"))
            .andExpect(jsonPath("$.pages[0].diagrams[0].nodes[0].style.rounded").value(true))
            // Edges array
            .andExpect(jsonPath("$.pages[0].diagrams[0].edges").isArray())
            .andExpect(jsonPath("$.pages[0].diagrams[0].edges", hasSize(1)))
            .andExpect(jsonPath("$.pages[0].diagrams[0].edges[0].id").value("e1"))
            .andExpect(jsonPath("$.pages[0].diagrams[0].edges[0].sourceId").value("n1"))
            .andExpect(jsonPath("$.pages[0].diagrams[0].edges[0].targetId").value("n2"))
            .andExpect(jsonPath("$.pages[0].diagrams[0].edges[0].label").value("Enquiry"))
            .andExpect(jsonPath("$.pages[0].diagrams[0].edges[0].points").isArray())
            .andExpect(jsonPath("$.pages[0].diagrams[0].edges[0].points", hasSize(2)))
            .andExpect(jsonPath("$.pages[0].diagrams[0].edges[0].points[0].x").value(160.0))
            .andExpect(jsonPath("$.pages[0].diagrams[0].edges[0].points[0].y").value(230.0))
            .andExpect(jsonPath("$.pages[0].diagrams[0].edges[0].style.dashed").value(true))
            .andExpect(jsonPath("$.pages[0].diagrams[0].edges[0].style.endArrow").value("classic"))
            // Summary
            .andExpect(jsonPath("$.summary.totalPages").value(1))
            .andExpect(jsonPath("$.summary.totalDiagrams").value(1))
            .andExpect(jsonPath("$.summary.totalNodes").value(1))
            .andExpect(jsonPath("$.summary.totalEdges").value(1))
            .andExpect(jsonPath("$.summary.warnings").isArray())
            .andExpect(jsonPath("$.summary.warnings", hasSize(1)))
            .andExpect(jsonPath("$.summary.warnings[0]").value("Warning: test warning message"));
    }

    /**
     * Helper method to create a sample response for testing.
     */
    private ConfluenceDiagramResponse createSampleResponse(String pageId, String pageTitle) {
        DiagramSourceDto sourceDto = new DiagramSourceDto(
            DiagramSourceDto.TYPE_CONFLUENCE_DRAWIO_ATTACHMENT,
            pageId,
            "att789",
            "diagram.drawio"
        );

        DiagramGraphDto diagram = new DiagramGraphDto(
            "diag_" + pageId + "_att789_0",
            "Test Diagram",
            0,
            "Overview",
            sourceDto,
            List.of(),
            List.of()
        );

        ConfluencePageDiagramsDto pageDiagrams = new ConfluencePageDiagramsDto(
            pageId,
            pageTitle,
            List.of(diagram)
        );

        ResponseSummaryDto summary = new ResponseSummaryDto(1, 1, 0, 0, List.of());

        return new ConfluenceDiagramResponse(
            pageId,
            pageTitle,
            false,
            10,
            List.of(pageDiagrams),
            summary
        );
    }
}
