package com.example.jiraservice.service;

import com.example.jiraservice.model.dto.jira.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestClient;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link JiraSearchService}.
 *
 * <p>Uses Mockito to mock the {@link RestClient} and verify that the service
 * correctly calls the Jira search endpoint via POST, passes the right request body,
 * and parses the response.</p>
 */
@ExtendWith(MockitoExtension.class)
class JiraSearchServiceTest {

    @Mock
    private RestClient restClient;

    @Mock
    private RestClient.RequestBodyUriSpec requestBodyUriSpec;

    @Mock
    private RestClient.RequestBodySpec requestBodySpec;

    @Mock
    private RestClient.ResponseSpec responseSpec;

    private JiraSearchService jiraSearchService;

    @BeforeEach
    void setUp() {
        jiraSearchService = new JiraSearchService(restClient);
    }

    private void setupMockChain(JiraSearchResponse response) {
        when(restClient.post()).thenReturn(requestBodyUriSpec);
        when(requestBodyUriSpec.uri("/rest/api/3/search/jql")).thenReturn(requestBodySpec);
        when(requestBodySpec.contentType(MediaType.APPLICATION_JSON)).thenReturn(requestBodySpec);
        when(requestBodySpec.body(any(JiraSearchRequest.class))).thenReturn(requestBodySpec);
        when(requestBodySpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.toEntity(JiraSearchResponse.class)).thenReturn(ResponseEntity.ok(response));
    }

    @Test
    @DisplayName("searchIssues parses mock Jira JSON response into issue objects")
    void searchIssuesParsesResponseIntoIssueObjects() {
        // Arrange
        JiraSearchResponse mockResponse = new JiraSearchResponse(
            List.of(
                new JiraIssue("PROJ-1", new JiraIssueFields(
                    "First issue",
                    new JiraNamedField("Story"),
                    new JiraNamedField("To Do"),
                    new JiraPriorityField("3", "Medium"),
                    null,
                    "2026-01-15T10:30:00.000+0000",
                    "2026-01-20T14:00:00.000+0000",
                    "Description text"
                )),
                new JiraIssue("PROJ-2", new JiraIssueFields(
                    "Second issue",
                    new JiraNamedField("Epic"),
                    new JiraNamedField("In Progress"),
                    new JiraPriorityField("1", "Highest"),
                    new JiraParentField("PROJ-1"),
                    "2026-01-16T09:00:00.000+0000",
                    "2026-01-21T11:00:00.000+0000",
                    null
                ))
            ),
            false,
            null
        );
        setupMockChain(mockResponse);

        // Act
        JiraSearchResponse result = jiraSearchService.searchIssues(
            "project = PROJ ORDER BY created DESC", 50);

        // Assert
        assertNotNull(result, "Response should not be null");
        assertEquals(2, result.issues().size(), "Should return 2 issues");
        assertEquals("PROJ-1", result.issues().get(0).key(), "First issue key should be PROJ-1");
        assertEquals("First issue", result.issues().get(0).fields().summary());
        assertEquals("PROJ-2", result.issues().get(1).key(), "Second issue key should be PROJ-2");
        assertEquals("Epic", result.issues().get(1).fields().issuetype().name());
        assertEquals("PROJ-1", result.issues().get(1).fields().parent().key());
    }

    @Test
    @DisplayName("searchIssues uses the provided JQL query string and maxResults")
    void searchIssuesUsesProvidedJqlQuery() {
        // Arrange
        JiraSearchResponse mockResponse = new JiraSearchResponse(List.of(), true, null);
        setupMockChain(mockResponse);

        String customJql = "project = PROJ AND status = 'In Progress'";

        // Act
        jiraSearchService.searchIssues(customJql, 25);

        // Assert -- capture the request body and verify its fields
        ArgumentCaptor<JiraSearchRequest> requestCaptor = ArgumentCaptor.forClass(JiraSearchRequest.class);
        verify(requestBodySpec).body(requestCaptor.capture());

        JiraSearchRequest capturedRequest = requestCaptor.getValue();
        assertEquals(customJql, capturedRequest.jql(), "JQL should match the provided query string");
        assertEquals(25, capturedRequest.maxResults(), "maxResults should be 25");
    }

    @Test
    @DisplayName("searchIssues requests correct fields parameter")
    void searchIssuesRequestsCorrectFieldsParameter() {
        // Arrange
        JiraSearchResponse mockResponse = new JiraSearchResponse(List.of(), true, null);
        setupMockChain(mockResponse);

        // Act
        jiraSearchService.searchIssues("project = PROJ", 50);

        // Assert -- capture the request body and verify the fields list
        ArgumentCaptor<JiraSearchRequest> requestCaptor = ArgumentCaptor.forClass(JiraSearchRequest.class);
        verify(requestBodySpec).body(requestCaptor.capture());

        JiraSearchRequest capturedRequest = requestCaptor.getValue();
        assertEquals(JiraSearchService.REQUESTED_FIELDS, capturedRequest.fields(),
            "Fields should match REQUESTED_FIELDS list");
        assertEquals(
            List.of("summary", "issuetype", "status", "priority", "parent", "created", "updated", "description"),
            capturedRequest.fields(),
            "Fields should contain the expected eight field names");
    }

    @Test
    @DisplayName("searchIssues sets Content-Type application/json and uses POST /rest/api/3/search/jql")
    void searchIssuesSetsContentTypeAndUsesPostEndpoint() {
        // Arrange
        JiraSearchResponse mockResponse = new JiraSearchResponse(List.of(), true, null);
        setupMockChain(mockResponse);

        // Act
        jiraSearchService.searchIssues("project = PROJ", 50);

        // Assert -- verify POST is called (not GET)
        verify(restClient).post();
        verify(restClient, never()).get();

        // Assert -- verify the correct URI is used
        verify(requestBodyUriSpec).uri("/rest/api/3/search/jql");

        // Assert -- verify Content-Type: application/json is set on the request
        verify(requestBodySpec).contentType(MediaType.APPLICATION_JSON);
    }
}
