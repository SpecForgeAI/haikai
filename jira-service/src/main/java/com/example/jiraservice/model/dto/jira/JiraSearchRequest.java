package com.example.jiraservice.model.dto.jira;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.util.List;

/**
 * Request DTO for the Jira Cloud {@code POST /rest/api/3/search/jql} endpoint.
 *
 * <p>The {@code @JsonNaming(LowerCamelCaseStrategy.class)} annotation overrides
 * the global {@code SNAKE_CASE} Jackson strategy configured in {@code application.yml},
 * ensuring fields serialize as camelCase ({@code maxResults}) which
 * is required by the Jira API.</p>
 *
 * <p>Note: The new {@code /rest/api/3/search/jql} endpoint does NOT accept {@code startAt}.
 * Pagination uses {@code nextPageToken} instead (not yet implemented).</p>
 *
 * @param jql        the JQL query string to execute
 * @param maxResults the maximum number of results to return
 * @param fields     the list of Jira fields to include in the response
 */
@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)
public record JiraSearchRequest(
    String jql,
    int maxResults,
    List<String> fields
) {}
