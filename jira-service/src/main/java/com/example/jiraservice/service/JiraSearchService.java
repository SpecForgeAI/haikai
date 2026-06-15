package com.example.jiraservice.service;

import com.example.jiraservice.model.dto.jira.JiraSearchRequest;
import com.example.jiraservice.model.dto.jira.JiraSearchResponse;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Map;

/**
 * Service for querying the Jira Cloud REST API search endpoint.
 *
 * <p>Calls {@code POST /rest/api/3/search/jql} with a JSON request body containing
 * JQL query, pagination, and field parameters, and parses the paginated response
 * into {@link JiraSearchResponse} objects.</p>
 */
@Service
@Slf4j
public class JiraSearchService {

    /** The specific fields to request from the Jira search API */
    public static final List<String> REQUESTED_FIELDS = List.of(
        "summary", "issuetype", "status", "priority", "parent", "created", "updated", "description");

    private final RestClient jiraRestClient;

    public JiraSearchService(@Qualifier("jiraRestClient") RestClient jiraRestClient) {
        this.jiraRestClient = jiraRestClient;
    }

    static <T> T logAndUnwrap(ResponseEntity<T> entity) {
        if(entity != null) {
            log.info("Jira HTTP status: {}", entity.getStatusCode());
            return entity.getBody();
        } else {
            return null;
        }
    }

    /**
     * Searches Jira issues using the given JQL query.
     *
     * <p>Uses {@code POST /rest/api/3/search/jql} which does not support {@code startAt}.
     * Pagination is via {@code nextPageToken} (not yet implemented).</p>
     *
     * @param jql        the JQL query string to execute
     * @param maxResults the maximum number of results to return
     * @return the parsed Jira search response containing matching issues
     */
    public JiraSearchResponse searchIssues(String jql, int maxResults) {
        log.debug("Executing Jira search with JQL: {}", jql);

        JiraSearchRequest requestDto = new JiraSearchRequest(jql, maxResults, REQUESTED_FIELDS);

        /*
        JiraSearchResponse response = jiraRestClient.post()
            .uri("/rest/api/3/search/jql")
            .contentType(MediaType.APPLICATION_JSON)
            .body(requestDto)
            .retrieve()
            .body(JiraSearchResponse.class);
        */
        JiraSearchResponse response = logAndUnwrap(
                jiraRestClient.post()
                        .uri("/rest/api/3/search/jql")
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(requestDto)
                        .retrieve()
                        .toEntity(JiraSearchResponse.class)
        );

        if (response != null) {
            log.info("Jira search returned {} issues", response.issues().size());
        }

        return response;
    }

    /**
     * Fetches the issue types available in a Jira project plus an optional
     * "anchor" issue's type. Used by the dynamic-mapping sync flow.
     */
    public ProjectIssueTypesResponse getProjectIssueTypes(String projectKey, String anchorKey) {
        // 1) Project info (includes issueTypes with hierarchyLevel)
        ProjectInfoResponse project = logAndUnwrap(
            jiraRestClient.get()
                .uri("/rest/api/3/project/{key}", projectKey)
                .retrieve()
                .toEntity(ProjectInfoResponse.class)
        );

        List<JiraIssueTypeRef> types = (project != null && project.issueTypes() != null)
            ? project.issueTypes()
            : List.of();

        // 2) Optional anchor's raw issue type
        String anchorType = null;
        if (anchorKey != null && !anchorKey.isBlank()) {
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> issue = jiraRestClient.get()
                    .uri("/rest/api/3/issue/{key}?fields=issuetype", anchorKey)
                    .retrieve()
                    .body(Map.class);
                if (issue != null && issue.get("fields") instanceof Map<?, ?> fields) {
                    if (fields.get("issuetype") instanceof Map<?, ?> it && it.get("name") != null) {
                        anchorType = String.valueOf(it.get("name"));
                    }
                }
            } catch (Exception e) {
                log.warn("Could not resolve anchor type for {}: {}", anchorKey, e.getMessage());
            }
        }

        return new ProjectIssueTypesResponse(types, anchorType);
    }

    // ---------- DTOs for project-issue-types lookup ----------

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ProjectInfoResponse(List<JiraIssueTypeRef> issueTypes) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record JiraIssueTypeRef(String id, String name, Integer hierarchyLevel, Boolean subtask) {}

    /** Response shape returned by JiraIssueController for /jira/projects/{key}/issue-types. */
    public record ProjectIssueTypesResponse(List<JiraIssueTypeRef> types, String anchorType) {}
}
