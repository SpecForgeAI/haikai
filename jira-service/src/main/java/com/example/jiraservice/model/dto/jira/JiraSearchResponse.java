package com.example.jiraservice.model.dto.jira;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/**
 * Represents the response from the Jira Cloud REST API search endpoint.
 *
 * <p>Maps the JSON response from {@code POST /rest/api/3/search/jql}.
 * The new endpoint returns {@code issues}, {@code isLast}, and optionally
 * {@code nextPageToken}. The old fields ({@code startAt}, {@code maxResults},
 * {@code total}) are no longer returned by the new endpoint.</p>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record JiraSearchResponse(
    List<JiraIssue> issues,
    boolean isLast,
    String nextPageToken
) {}
