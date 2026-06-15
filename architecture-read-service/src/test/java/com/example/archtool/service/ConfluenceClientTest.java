package com.example.archtool.service;

import com.example.archtool.config.ConfluenceProperties;
import com.example.archtool.exception.ConfluenceApiException;
import com.example.archtool.model.confluence.ConfluenceAttachment;
import com.example.archtool.model.confluence.ConfluencePage;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.util.Base64;
import java.util.List;

import static org.assertj.core.api.Assertions.*;

/**
 * Unit tests for ConfluenceClient service using MockWebServer.
 *
 * <p>These tests verify that the client correctly:
 * <ul>
 *   <li>Calls Confluence REST API endpoints with proper URLs and parameters</li>
 *   <li>Parses JSON responses into domain objects</li>
 *   <li>Handles pagination for attachments and child pages</li>
 *   <li>Maps HTTP errors to ConfluenceApiException</li>
 *   <li>Includes authentication headers on all requests</li>
 *   <li>Uses the REST API download endpoint for attachment downloads</li>
 * </ul>
 *
 * <p>All HTTP calls go through a single RestClient configured with the API base URL.</p>
 */
class ConfluenceClientTest {

    private MockWebServer mockApiServer;
    private ConfluenceClient confluenceClient;
    private static final String TEST_USERNAME = "testuser@example.com";
    private static final String TEST_API_TOKEN = "test-api-token";

    @BeforeEach
    void setUp() throws IOException {
        mockApiServer = new MockWebServer();
        mockApiServer.start();

        String apiBaseUrl = mockApiServer.url("/wiki").toString();

        ConfluenceProperties properties = new ConfluenceProperties(
            apiBaseUrl,
            TEST_USERNAME,
            TEST_API_TOKEN,
            5000,
            30000,
            10
        );

        // Create single RestClient configured for the mock server
        RestClient apiRestClient = RestClient.builder()
            .baseUrl(apiBaseUrl)
            .build();

        confluenceClient = new ConfluenceClient(apiRestClient, properties);
    }

    @AfterEach
    void tearDown() throws IOException {
        mockApiServer.shutdown();
    }

    // ========================================================================
    // Test 1: getPage() returns ConfluencePage with body.storage (uses apiRestClient)
    // ========================================================================
    @Test
    @DisplayName("getPage() returns ConfluencePage with body.storage using apiRestClient")
    void getPage_returnsConfluencePageWithBodyStorage() throws Exception {
        // Given: A mock Confluence page response
        String pageJson = """
            {
                "id": "123456",
                "title": "Test Page Title",
                "body": {
                    "storage": {
                        "value": "<p>Page content with <ac:structured-macro ac:name=\\"drawio\\">diagram</ac:structured-macro></p>"
                    }
                },
                "version": {
                    "number": 5
                }
            }
            """;

        mockApiServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(pageJson));

        // When: Fetching the page
        ConfluencePage page = confluenceClient.getPage("123456");

        // Then: Page is parsed correctly
        assertThat(page).isNotNull();
        assertThat(page.id()).isEqualTo("123456");
        assertThat(page.title()).isEqualTo("Test Page Title");
        assertThat(page.bodyStorage()).contains("drawio");
        assertThat(page.version()).isEqualTo(5);

        // And: The correct endpoint was called on the API server
        RecordedRequest request = mockApiServer.takeRequest();
        assertThat(request.getPath()).isEqualTo("/wiki/rest/api/content/123456?expand=body.storage,version");
        assertThat(request.getMethod()).isEqualTo("GET");

        // And: Authentication header was included
        String authHeader = request.getHeader("Authorization");
        assertThat(authHeader).isNotNull();
        assertThat(authHeader).startsWith("Basic ");
        String expectedCredentials = Base64.getEncoder()
            .encodeToString((TEST_USERNAME + ":" + TEST_API_TOKEN).getBytes());
        assertThat(authHeader).isEqualTo("Basic " + expectedCredentials);
    }

    // ========================================================================
    // Test 2: getChildPages() returns list of child pages (uses apiRestClient)
    // ========================================================================
    @Test
    @DisplayName("getChildPages() returns list of child pages using apiRestClient")
    void getChildPages_returnsListOfChildPages() throws Exception {
        // Given: A mock Confluence child pages response
        String childPagesJson = """
            {
                "results": [
                    {
                        "id": "child1",
                        "title": "Child Page 1",
                        "body": {
                            "storage": {
                                "value": "<p>Child 1 content</p>"
                            }
                        },
                        "version": {
                            "number": 1
                        }
                    },
                    {
                        "id": "child2",
                        "title": "Child Page 2",
                        "body": {
                            "storage": {
                                "value": "<p>Child 2 content</p>"
                            }
                        },
                        "version": {
                            "number": 2
                        }
                    }
                ],
                "size": 2,
                "_links": {}
            }
            """;

        // First call for parent page's children
        mockApiServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(childPagesJson));

        // No more children for child1
        mockApiServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody("{\"results\": [], \"size\": 0, \"_links\": {}}"));

        // No more children for child2
        mockApiServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody("{\"results\": [], \"size\": 0, \"_links\": {}}"));

        // When: Fetching child pages
        List<ConfluencePage> childPages = confluenceClient.getChildPages("parent123", 2);

        // Then: Child pages are returned
        assertThat(childPages).hasSize(2);
        assertThat(childPages.get(0).id()).isEqualTo("child1");
        assertThat(childPages.get(0).title()).isEqualTo("Child Page 1");
        assertThat(childPages.get(1).id()).isEqualTo("child2");
        assertThat(childPages.get(1).title()).isEqualTo("Child Page 2");

        // And: The correct endpoint was called on API server
        RecordedRequest request = mockApiServer.takeRequest();
        assertThat(request.getPath()).contains("/rest/api/content/parent123/child/page");
        assertThat(request.getPath()).contains("expand=body.storage,version");
    }

    // ========================================================================
    // Test 3: getAttachments() handles pagination correctly (uses apiRestClient)
    // ========================================================================
    @Test
    @DisplayName("getAttachments() handles pagination correctly using apiRestClient")
    void getAttachments_handlesPaginationCorrectly() throws Exception {
        // Given: First page of attachments with a next link
        String firstPageJson = """
            {
                "results": [
                    {
                        "id": "att1",
                        "title": "diagram1.drawio",
                        "_links": {
                            "download": "/download/attachments/123456/diagram1.drawio"
                        },
                        "metadata": {
                            "mediaType": "application/vnd.jgraph.mxfile"
                        }
                    }
                ],
                "size": 1,
                "_links": {
                    "next": "/rest/api/content/123456/child/attachment?limit=25&start=25"
                }
            }
            """;

        // Second page of attachments (no more pages)
        String secondPageJson = """
            {
                "results": [
                    {
                        "id": "att2",
                        "title": "diagram2.drawio",
                        "_links": {
                            "download": "/download/attachments/123456/diagram2.drawio"
                        },
                        "metadata": {
                            "mediaType": "application/vnd.jgraph.mxfile"
                        }
                    }
                ],
                "size": 1,
                "_links": {}
            }
            """;

        mockApiServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(firstPageJson));

        mockApiServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/json")
            .setBody(secondPageJson));

        // When: Fetching attachments
        List<ConfluenceAttachment> attachments = confluenceClient.getAttachments("123456");

        // Then: All attachments from both pages are returned
        assertThat(attachments).hasSize(2);
        assertThat(attachments.get(0).id()).isEqualTo("att1");
        assertThat(attachments.get(0).title()).isEqualTo("diagram1.drawio");
        assertThat(attachments.get(1).id()).isEqualTo("att2");
        assertThat(attachments.get(1).title()).isEqualTo("diagram2.drawio");

        // And: Two requests were made to API server (pagination)
        assertThat(mockApiServer.getRequestCount()).isEqualTo(2);
    }

    // ========================================================================
    // Test 4: downloadAttachment() uses REST API endpoint with pageId and attachmentId
    // ========================================================================
    @Test
    @DisplayName("downloadAttachment() uses REST API endpoint with pageId and attachmentId")
    void downloadAttachment_usesRestApiEndpointWithPageIdAndAttachmentId() throws Exception {
        // Given: A mock attachment download response on the API server
        String diagramXml = """
            <mxfile>
              <diagram name="Test">
                <mxGraphModel>
                  <root>
                    <mxCell id="0"/>
                  </root>
                </mxGraphModel>
              </diagram>
            </mxfile>
            """;

        mockApiServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/xml")
            .setBody(diagramXml));

        // Attachment with downloadUrl that should be IGNORED
        ConfluenceAttachment attachment = new ConfluenceAttachment(
            "131287",
            "test.drawio",
            "/download/attachments/page123/test.drawio",  // This should be ignored
            "application/xml"
        );

        String pageId = "98433";

        // When: Downloading the attachment
        byte[] content = confluenceClient.downloadAttachment(pageId, attachment);

        // Then: Content is returned as byte array
        assertThat(content).isNotNull();
        assertThat(new String(content)).contains("<mxfile>");
        assertThat(new String(content)).contains("<diagram name=\"Test\">");

        // And: Request was made to the REST API endpoint (not the downloadUrl)
        RecordedRequest request = mockApiServer.takeRequest();
        assertThat(request.getPath())
            .isEqualTo("/wiki/rest/api/content/98433/child/attachment/131287/download");
        assertThat(request.getMethod()).isEqualTo("GET");

        // And: Authentication header was included
        String authHeader = request.getHeader("Authorization");
        assertThat(authHeader).isNotNull();
        assertThat(authHeader).startsWith("Basic ");
    }

    // ========================================================================
    // Test 5: downloadAttachment() constructs correct URL path
    // ========================================================================
    @Test
    @DisplayName("downloadAttachment() constructs correct REST API download path")
    void downloadAttachment_constructsCorrectRestApiPath() throws Exception {
        // Given: Various pageId and attachmentId combinations
        mockApiServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setBody("test content"));

        ConfluenceAttachment attachment = new ConfluenceAttachment(
            "att-12345",
            "architecture.drawio",
            "/ignored/path",
            "application/xml"
        );

        // When: Downloading with specific pageId
        confluenceClient.downloadAttachment("page-67890", attachment);

        // Then: URL is constructed as /rest/api/content/{pageId}/child/attachment/{attachmentId}/download
        RecordedRequest request = mockApiServer.takeRequest();
        assertThat(request.getPath())
            .isEqualTo("/wiki/rest/api/content/page-67890/child/attachment/att-12345/download");
    }

    // ========================================================================
    // Test 6: 401 response throws ConfluenceApiException with UNAUTHORIZED
    // ========================================================================
    @Test
    @DisplayName("401 response throws ConfluenceApiException with UNAUTHORIZED")
    void unauthorizedResponse_throwsConfluenceApiExceptionWithUnauthorized() {
        // Given: A 401 Unauthorized response
        String errorJson = """
            {
                "statusCode": 401,
                "message": "Invalid credentials"
            }
            """;

        mockApiServer.enqueue(new MockResponse()
            .setResponseCode(401)
            .setHeader("Content-Type", "application/json")
            .setBody(errorJson));

        // When/Then: Fetching page throws ConfluenceApiException
        assertThatThrownBy(() -> confluenceClient.getPage("123456"))
            .isInstanceOf(ConfluenceApiException.class)
            .satisfies(ex -> {
                ConfluenceApiException cae = (ConfluenceApiException) ex;
                assertThat(cae.getStatusCode()).isEqualTo(401);
                assertThat(cae.isUnauthorized()).isTrue();
            });
    }

    // ========================================================================
    // Test 7: 404 response throws ConfluenceApiException with NOT_FOUND
    // ========================================================================
    @Test
    @DisplayName("404 response throws ConfluenceApiException with NOT_FOUND")
    void notFoundResponse_throwsConfluenceApiExceptionWithNotFound() {
        // Given: A 404 Not Found response
        String errorJson = """
            {
                "statusCode": 404,
                "message": "Page not found"
            }
            """;

        mockApiServer.enqueue(new MockResponse()
            .setResponseCode(404)
            .setHeader("Content-Type", "application/json")
            .setBody(errorJson));

        // When/Then: Fetching page throws ConfluenceApiException
        assertThatThrownBy(() -> confluenceClient.getPage("nonexistent"))
            .isInstanceOf(ConfluenceApiException.class)
            .satisfies(ex -> {
                ConfluenceApiException cae = (ConfluenceApiException) ex;
                assertThat(cae.getStatusCode()).isEqualTo(404);
                assertThat(cae.isNotFound()).isTrue();
            });
    }

    // ========================================================================
    // Test 8: downloadAttachment() throws ConfluenceApiException on 404
    // ========================================================================
    @Test
    @DisplayName("downloadAttachment() throws ConfluenceApiException on 404 with correct error message format")
    void downloadAttachment_throwsExceptionOnNotFound() {
        // Given: A 404 response from the API server
        mockApiServer.enqueue(new MockResponse()
            .setResponseCode(404)
            .setHeader("Content-Type", "text/plain")
            .setBody("Not Found"));

        ConfluenceAttachment attachment = new ConfluenceAttachment(
            "att123",
            "missing.drawio",
            "/download/attachments/page123/missing.drawio",
            "application/xml"
        );

        String pageId = "page123";

        // When/Then: Downloading throws ConfluenceApiException with correct format
        assertThatThrownBy(() -> confluenceClient.downloadAttachment(pageId, attachment))
            .isInstanceOf(ConfluenceApiException.class)
            .satisfies(ex -> {
                ConfluenceApiException cae = (ConfluenceApiException) ex;
                assertThat(cae.getStatusCode()).isEqualTo(404);
                assertThat(cae.getMessage()).contains("Failed to download attachment via REST API");
                assertThat(cae.getMessage()).contains("missing.drawio");
                assertThat(cae.getMessage()).contains("pageId=page123");
                assertThat(cae.getMessage()).contains("attachmentId=att123");
            });
    }

    // ========================================================================
    // Test 9: downloadAttachment() throws ConfluenceApiException on 401
    // ========================================================================
    @Test
    @DisplayName("downloadAttachment() throws ConfluenceApiException on 401 unauthorized")
    void downloadAttachment_throwsExceptionOnUnauthorized() {
        // Given: A 401 response from the API server
        mockApiServer.enqueue(new MockResponse()
            .setResponseCode(401)
            .setHeader("Content-Type", "text/plain")
            .setBody("Unauthorized"));

        ConfluenceAttachment attachment = new ConfluenceAttachment(
            "att456",
            "secure.drawio",
            "/download/attachments/page789/secure.drawio",
            "application/xml"
        );

        // When/Then: Downloading throws ConfluenceApiException
        assertThatThrownBy(() -> confluenceClient.downloadAttachment("page789", attachment))
            .isInstanceOf(ConfluenceApiException.class)
            .satisfies(ex -> {
                ConfluenceApiException cae = (ConfluenceApiException) ex;
                assertThat(cae.getStatusCode()).isEqualTo(401);
            });
    }

    // ========================================================================
    // Test 10: downloadAttachment() returns byte[] content for successful download
    // ========================================================================
    @Test
    @DisplayName("downloadAttachment() returns byte[] content for successful download")
    void downloadAttachment_returnsByteArrayOnSuccess() throws Exception {
        // Given: A large binary content response
        byte[] binaryContent = new byte[10000];
        for (int i = 0; i < binaryContent.length; i++) {
            binaryContent[i] = (byte) (i % 256);
        }

        mockApiServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "application/octet-stream")
            .setBody(new okio.Buffer().write(binaryContent)));

        ConfluenceAttachment attachment = new ConfluenceAttachment(
            "largefile123",
            "large.drawio",
            "/ignored",
            "application/octet-stream"
        );

        // When: Downloading the attachment
        byte[] content = confluenceClient.downloadAttachment("page999", attachment);

        // Then: Full binary content is returned
        assertThat(content).hasSize(10000);
        assertThat(content).isEqualTo(binaryContent);
    }
}
